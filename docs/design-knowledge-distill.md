# 技术方案 · 知识蒸馏管道(v1 草案)

> 对应 PRD:`prd-knowledge-distill.md`。原则:不引入新基础设施——状态在 PG,检索用 pgvector(镜像已带),生成复用 agent_task_queue,事件走现有 events/WS,前端进 packages/views。

## 1. 数据模型(migration 447+)

```sql
-- 知识条目:一行一个"主题",版本链挂在 revision 上
kb_entry        id uuid pk, workspace_id fk, module text,      -- sales|finance|inventory|recycle|member|hr|...
                topic text,                                     -- 主题短名(冲突判定粒度:module+topic 归一化串)
                status text check (draft|published|retired),
                current_revision uuid,                          -- 指向已发布/最新草稿的内容行
                created_by_type/created_by_id, updated_at

-- 内容版本:不可变;草稿和已发布版本同表,靠 entry.status+current_revision 区分可见性
kb_revision     id uuid pk, entry_id fk, body_md text,
                summary text,                                   -- 30 行内电梯摘要(抽屉列表+检索 snippet 用)
                source jsonb,                                   -- 出生证明:{run_id,task_id,issue_id,jira_key,agent,model,generated_at}
                parent_revision uuid null,                      -- revision 链:换版指旧版
                created_at

-- 草稿↔发布 的冲突挂起态(铁律 4 的落点)
kb_conflict     id uuid pk, entry_id fk, draft_revision uuid, vs_revision uuid,
                similarity real, state text check (open|resolved|dismissed), resolved_by, resolved_at
```

检索不建独立表:`kb_entry.published 版本的 body_md+summary` 物化进 `kb_search`(id, entry_id, tsvector 列 + embedding vector(1024))——发布/换版/retire 时由 service 层重写该行,保证"draft 永不进索引"是**物理隔离**而非查询条件忘记加。

## 2. 生成链路(复用任务系统,零新调度器)

```
「沉淀此卡结论」按钮 (issue头/chat尾部)
  → POST /api/kb/drafts {issue_id} 
  → 服务端向 assignee 对应 runtime 派发一个 kind=kb_draft 的 agent_task_queue 任务
     (prompt 模板固定:通读该 issue 的 run 记录+diff → 提炼「功能/耦合/注意事项/决策」四段)
  → agent 完成 → 回调写 kb_revision(draft) + entry(status=draft)
  → issue:updated 事件 → WS 推「有草稿待沉淀」角标;企微摘要由站报任务聚合
```

开发 agent 自动顺手落 draft(PR-约定):写进 runtime brief 的交付红线段(与 skill 未加载上报同机制),产出通道同上——**agent 只有 draft 权限**,API 面直接不给 agent 令牌 publish 端点(路由层按 actor 类型收口,不靠提示词自觉)。

## 3. 编辑态抽屉 & diff & 冲突(铁律 1/3/4)

- 抽屉:`packages/views/kb/distill-drawer.tsx`,左草稿只读右 `initialValue=草稿` 的编辑器,提交按钮文案「发布」,**无纯 approve 路径**
- 重新生成:`POST /api/kb/entries/{id}/redraft` → 新 draft revision(parent 指 current)→ `GET /entries/{id}/draft-diff` 用现成 diff 库出**行级 delta**,抽屉只渲染 hunk
- 冲突闸:draft 落库时异步比对——同 module 下 embedding cosine ≥0.82 或 topic 归一化相等 → 建 kb_conflict(open) → 该草稿发布路径改走「对比发布」双栏视图;裁决动作 = 选边/手动合并文本,落 resolved 后进正常发布

## 4. 检索与「问系统」

`GET /api/kb/search?q=` :tsvector(精确词) UNION pgvector(语义) RRF 合并,published-only(物理),返回带出处(issue/jira/rev)。
chat 入口 = 把 search 注册成 agent 工具(MCP 或 CLI `quickwork kb search`),**开发 run 开局先查本模块 published** ——写进 dev-workflow 流程第一步,知识从"存起来"变成"用起来"的闭环点。

## 5. git 导出(单向,发布事务的尾巴)

publish 成功后 fire-and-forget:渲染 md(front-matter = 出生证明 + kb 链接)→ 以 bot 提交推团队文档仓库的 `kb/main` 分支(`docs/kb/<module>/<topic-slug>.md`)。失败进 outbox 重试;git 侧永不回流编辑。

## 6. API 面(handler/kb.go)

```
POST /api/kb/drafts            人工触发草稿      member
POST /api/kb/drafts/self       agent 顺手落稿    agent-token only(issue 参数锁任务上下文)
GET  /api/kb/entries  /entries/{id}  /draft-diff  阅读态   member
PUT  /entries/{id}/publish        人审发布      member(owner/admin 可发布他人草稿)
POST /entries/{id}/retire                       member
PUT  /conflicts/{id}/resolve      裁决          member
GET  /api/kb/search               消费          member+agent
```

审计复用现有 activity_log;env 端点 MUL-2600 的教训直接套用:**publish 权限判定在服务端 actor 解析层,不写进 agent 提示词**。

## 7. 里程碑 → 工程切分

| | 交付 | 预估 |
|---|---|---|
| M1 | 447-449 migration + kb service/handler + 派发草稿任务 + 抽屉(无 diff)+ search + WS 角标 | 3~4d |
| M2 | redraft/diff + 冲突闸 + 对比视图 + revision 链 UI | 2~3d |
| M3 | git exporter + 站报草稿积压段 + agent 自动 draft 契约(skill/brief) | 2d |

风险预告:① 生成 run 的质量决定天花板,prompt 模板要拿 PROJ-14 这类真实已评审卡先离线试跑 20 张再上线;② 冲突阈值先松(0.82)后收紧,宁可多弹对比也不漏矛盾;③ GC 事故换来的纪律——exporter 这类"会写盘"的后台组件,路径必须白名单 + dry-run 开关。
