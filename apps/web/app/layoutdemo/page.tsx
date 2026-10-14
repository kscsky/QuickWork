"use client";

// TEMPORARY layout preview for the main interface. Four arrangements of the same
// product story — a workflow being orchestrated and its context being handed on
// — so the choice can be made by looking at them. Delete once one is chosen.

const PANE = "rounded-xl bg-[#0F1116] ring-1 ring-white/10 overflow-hidden";
const RAIL = "flex w-11 shrink-0 flex-col items-center gap-3 border-r border-white/8 py-3";
const LABEL = "font-mono text-[9px] uppercase tracking-[0.22em] text-white/35";
const MUTED = "text-white/45";
const CARD =
  "rounded-md border border-white/10 bg-white/[0.05] px-2 py-1.5 font-mono text-[10px] text-white/85";

function Rail() {
  return (
    <div className={RAIL}>
      <span className="size-5 rounded bg-[#FFB020]" />
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={i === 1 ? "size-4 rounded-sm bg-white/70" : "size-4 rounded-sm bg-white/15"}
        />
      ))}
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className={`${PANE} flex h-[380px] w-full`}>{children}</div>;
}

/* A — orchestration pipeline: the flow is the page. */
function Pipeline() {
  const cols = ["受理", "派发", "运行", "验收"];
  const cards: Record<number, string[]> = { 0: ["Q-42", "Q-43"], 1: ["Q-41"], 2: ["Q-42", "Q-40"], 3: ["Q-39"] };
  return (
    <Frame>
      <Rail />
      <div className="flex min-w-0 flex-1 gap-3 p-4">
        {cols.map((c, i) => (
          <div key={c} className="flex min-w-0 flex-1 flex-col gap-2">
            <span className={`${LABEL} flex items-center gap-1.5`}>
              <span className={i === 2 ? "size-1.5 rounded-full bg-[#FFB020]" : "size-1.5 rounded-full bg-white/25"} />
              {c}
            </span>
            {cards[i]?.map((k, j) => (
              <div key={k} className={CARD}>
                <div className="flex items-center justify-between">
                  <span>{k}</span>
                  {i === 2 && <span className="size-1.5 rounded-full bg-[#FFB020]" />}
                </div>
                {i === 2 && j === 0 && (
                  <div className="mt-1 flex items-center gap-1">
                    <span className="flex size-3 items-center justify-center rounded-full bg-[#FFB020]/20 text-[7px] text-[#FFB020]">
                      F
                    </span>
                    <span className={`text-[9px] ${MUTED}`}>Fleet</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="w-52 shrink-0 border-l border-white/8 p-4">
        <span className={LABEL}>上下文 · Q-42</span>
        <dl className="mt-3 flex flex-col gap-2 text-[10px]">
          {[["目标", "季度对账"], ["交接", "2 次"], ["证据", "12 条"], ["决策", "3 条"]].map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <dt className={MUTED}>{k}</dt>
              <dd className="text-white/85">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Frame>
  );
}

/* B — orchestration canvas: nodes you rearrange, context beside them. */
function Canvas() {
  const node = (x: number, y: number, t: string, hot = false) => (
    <div
      key={t}
      className={`absolute w-[76px] rounded-md border px-2 py-1.5 text-center text-[10px] ${
        hot ? "border-[#FFB020]/60 bg-[#FFB020]/10 text-[#FFB020]" : "border-white/15 bg-white/[0.05] text-white/80"
      }`}
      style={{ left: x, top: y }}
    >
      {t}
    </div>
  );
  return (
    <Frame>
      <Rail />
      <div className="relative min-w-0 flex-1">
        <svg className="absolute inset-0 size-full" aria-hidden>
          <line x1="118" y1="70" x2="188" y2="70" stroke="rgba(255,255,255,.25)" strokeWidth="1" />
          <line x1="226" y1="86" x2="226" y2="150" stroke="rgba(255,255,255,.25)" strokeWidth="1" />
          <line x1="188" y1="166" x2="118" y2="166" stroke="rgba(255,255,255,.25)" strokeWidth="1" />
        </svg>
        {node(40, 58, "受理")}
        {node(188, 58, "派发")}
        {node(188, 152, "执行", true)}
        {node(40, 152, "验收")}
      </div>
      <div className="w-56 shrink-0 border-l border-white/8 p-4">
        <span className={LABEL}>节点 · 执行</span>
        <div className="mt-3 flex flex-col gap-3 text-[10px]">
          <div>
            <div className={MUTED}>传入 ← 上游</div>
            <div className="mt-1 text-white/85">台账权限</div>
            <div className="text-white/85">3 笔不符</div>
          </div>
          <div>
            <div className={MUTED}>产出 → 下游</div>
            <div className="mt-1 text-white/85">diff · 测试报告</div>
          </div>
        </div>
      </div>
    </Frame>
  );
}

/* C — context stream: no board at all, the handoffs are the page. */
function Stream() {
  const rows = [
    ["09:12", "Fleet → 你", "对账完成 · 3 笔不符 · diff 已附", "#4ADE80"],
    ["09:07", "你 → Fleet", "台账权限 · 口径 · 期限", "#FFB020"],
    ["09:02", "你 → 目标区", "指派 Fleet 接手", "#FFB020"],
    ["09:00", "你创建 Q-42", "季度对账", "rgba(255,255,255,.3)"],
  ];
  return (
    <Frame>
      <Rail />
      <div className="min-w-0 flex-1 p-5">
        <span className={LABEL}>上下文流 · 今天</span>
        <div className="mt-4 flex flex-col">
          {rows.map(([t, who, what, dot], i) => (
            <div key={t} className="flex gap-3">
              <div className="flex w-3 shrink-0 flex-col items-center">
                <span className="mt-1 size-2 shrink-0 rounded-full" style={{ background: dot }} />
                {i < rows.length - 1 && <span className="w-px flex-1 bg-white/12" />}
              </div>
              <div className={`flex min-w-0 flex-1 gap-3 ${i < rows.length - 1 ? "pb-5" : ""}`}>
                <span className="w-10 shrink-0 font-mono text-[10px] text-white/35">{t}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-white/85">{who}</div>
                  <div className={`truncate text-[10px] ${MUTED}`}>{what}</div>
                </div>
                <span className="shrink-0 rounded border border-white/12 px-1.5 py-0.5 font-mono text-[9px] text-white/45">
                  包 #{rows.length - i}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}

/* D — three-pane console: list, timeline, fleet. */
function Console() {
  const tasks = [
    ["Q-42", "季度对账", true],
    ["Q-43", "客户周报", false],
    ["Q-40", "依赖升级", false],
    ["Q-38", "日志归档", false],
  ];
  const events = [
    ["09:00", "受理", "你"],
    ["09:02", "派发", "→ 目标区"],
    ["09:07", "运行中", "Fleet"],
    ["09:09", "回执", "← 本区"],
    ["09:12", "待验收", "你"],
  ];
  return (
    <Frame>
      <Rail />
      <div className="w-40 shrink-0 border-r border-white/8 p-3">
        <span className={LABEL}>我的</span>
        <div className="mt-3 flex flex-col gap-1">
          {tasks.map(([k, t, active]) => (
            <div
              key={k as string}
              className={`rounded px-2 py-1.5 text-[10px] ${active ? "bg-white/10 text-white" : "text-white/55"}`}
            >
              <span className="font-mono">{k}</span>
              <span className="ml-2">{t}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1 p-3">
        <span className={LABEL}>Q-42 · 季度对账</span>
        <div className="mt-3 flex flex-col gap-2">
          {events.map(([t, what, who]) => (
            <div key={t} className="flex items-center gap-3 text-[10px]">
              <span className="w-9 shrink-0 font-mono text-white/35">{t}</span>
              <span className="w-14 shrink-0 text-white/80">{what}</span>
              <span className={MUTED}>{who}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="w-44 shrink-0 border-l border-white/8 p-3">
        <span className={LABEL}>运行时</span>
        <div className="mt-3 flex flex-col gap-2 text-[10px]">
          {[["mac", "空闲", "rgba(255,255,255,.3)"], ["srv", "运行", "#FFB020"], ["box", "运行", "#FFB020"]].map(
            ([n, s, c]) => (
              <div key={n} className="flex items-center gap-2">
                <span className="size-1.5 rounded-full" style={{ background: c }} />
                <span className="font-mono text-white/80">{n}</span>
                <span className={MUTED}>{s}</span>
              </div>
            ),
          )}
        </div>
        <span className={`${LABEL} mt-5 block`}>智能体</span>
        <div className="mt-2 flex items-center gap-2 text-[10px]">
          <span className="size-1.5 rounded-full bg-[#4ADE80]" />
          <span className="text-white/80">Fleet</span>
        </div>
      </div>
    </Frame>
  );
}

const LAYOUTS: Array<[string, string, () => React.ReactElement]> = [
  ["A · 编排流水线", "列是阶段，工作是卡；右栏是选中卡的上下文。编排在首屏，交互仍是拖放。", Pipeline],
  ["B · 编排画布", "可拖的节点图 + 节点上下文面板。最像「编排器」，差异度最高。", Canvas],
  ["C · 上下文流", "没有看板，按时间倒序列出每次交接和它传了什么。最押在「上下文」上。", Stream],
  ["D · 三栏指挥台", "任务列表 + 时间线 + 运行时状态。密度最高，偏工具感。", Console],
];

export default function LayoutDemoPage() {
  return (
    <div className="h-full overflow-y-auto bg-[#08090C] p-8">
      <div className="mx-auto flex max-w-[860px] flex-col gap-10">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-white">
            主界面排版 · 四个方向
          </h1>
          <p className="text-[13px] leading-relaxed text-white/50">
            同一个产品故事（工作流在被编排、上下文在被交接）的四种摆法。配色沿用你选的深色 + 琥珀，
            所以现在比较的是<b className="text-white/75">布局</b>，不是皮肤。
          </p>
        </header>
        {LAYOUTS.map(([name, note, C]) => (
          <section key={name} className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-6">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-white">{name}</h2>
              <p className="max-w-[52ch] text-right text-[11px] leading-relaxed text-white/40">{note}</p>
            </div>
            <C />
          </section>
        ))}
      </div>
    </div>
  );
}
