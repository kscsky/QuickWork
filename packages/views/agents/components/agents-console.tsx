"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ChevronDown,
  Plus,
  Square,
  Terminal,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Agent,
  AgentRuntime,
  AgentTask,
  Issue,
} from "@quickwork/core/types";
import {
  useWorkspaceActivityMap,
  useWorkspacePresenceMap,
} from "@quickwork/core/agents";
import { agentTaskSnapshotOptions } from "@quickwork/core/agents/queries";
import { api } from "@quickwork/core/api";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { issuesByIdsOptions } from "@quickwork/core/issues/queries";
import { useModalStore } from "@quickwork/core/modals";
import { useWorkspacePaths } from "@quickwork/core/paths";
import { resolvePublicFileUrl } from "@quickwork/core/workspace/avatar-url";
import {
  agentListOptions,
  workspaceKeys,
} from "@quickwork/core/workspace/queries";
import { runtimeListOptions } from "@quickwork/core/runtimes";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@quickwork/ui/components/ui/alert-dialog";
import { Skeleton } from "@quickwork/ui/components/ui/skeleton";
import { useNavigation } from "../../navigation";
import { useTimeAgo } from "../../i18n/use-time-ago";
import { useT } from "../../i18n";
import { ProviderLogo } from "../../runtimes/components/provider-logo";
import {
  activeTasks,
  agentAccent,
  agentConsoleStats,
  agentStatusCounts,
  classifyAgent,
  groupAgentRows,
  latestTerminalTask,
  providerMeta,
  UNBOUND_PROVIDER,
  type AgentConsoleRow,
  type AgentConsoleStatus,
} from "./agents-console-model";

type StatusFilter = "all" | AgentConsoleStatus;

const STATUS_TABS: StatusFilter[] = ["all", "working", "idle", "needs"];

function shortClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

function formatElapsed(startIso: string | null, now: number): string {
  if (!startIso) return "";
  const started = Date.parse(startIso);
  if (!Number.isFinite(started)) return "";
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function useNowTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function StatusCell({ row }: { row: AgentConsoleRow }) {
  const { t } = useT("agents");
  const label =
    row.status === "working"
      ? t(($) => $.workload.working)
      : row.status === "idle"
        ? t(($) => $.workload.idle)
        : row.needsReason === "offline"
          ? t(($) => $.card.machine_offline)
          : row.needsReason === "unstable"
            ? t(($) => $.availability.unstable)
            : t(($) => $.console.filter_needs);
  return (
    <span className="qw-ag-status" data-state={row.status}>
      <i className="qw-ag-lamp" aria-hidden="true" />
      {label}
      {row.status === "working" ? (
        <span className="qw-ag-eq" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      ) : null}
    </span>
  );
}

function CapacityCell({ row }: { row: AgentConsoleRow }) {
  const slots = Math.max(1, Math.min(row.capacity, 6));
  return (
    <span className="qw-ag-cap">
      <span className="qw-ag-pips" aria-hidden="true">
        {Array.from({ length: slots }, (_, index) => (
          <i key={index} data-on={index < row.running ? "" : undefined} />
        ))}
      </span>
      <span>
        {row.running}/{row.capacity}
      </span>
    </span>
  );
}

function ActivityCell({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  return (
    <span className="qw-ag-spark" aria-hidden="true">
      {values.map((value, index) => (
        <i
          key={index}
          style={{ height: `${Math.max(2, Math.round((value / max) * 13))}px` }}
        />
      ))}
    </span>
  );
}

export function AgentsPage() {
  const { t } = useT("agents");
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const timeAgo = useTimeAgo();
  const qc = useQueryClient();

  const {
    data: agents = [],
    isLoading,
    error,
    refetch,
  } = useQuery(agentListOptions(wsId));
  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));
  const { data: snapshot = [] } = useQuery(agentTaskSnapshotOptions(wsId));
  const { byAgent: presenceMap } = useWorkspacePresenceMap(wsId);
  const { byAgent: activityMap } = useWorkspaceActivityMap(wsId);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(
    () => new Set(),
  );
  const [stopTarget, setStopTarget] = useState<AgentConsoleRow | null>(null);
  const stopPendingRef = useRef(false);

  const runtimesById = useMemo(() => {
    const map = new Map<string, AgentRuntime>();
    for (const runtime of runtimes) map.set(runtime.id, runtime);
    return map;
  }, [runtimes]);

  const tasksByAgent = useMemo(() => {
    const map = new Map<string, AgentTask[]>();
    for (const task of snapshot) {
      const list = map.get(task.agent_id);
      if (list) list.push(task);
      else map.set(task.agent_id, [task]);
    }
    return map;
  }, [snapshot]);

  const rows = useMemo<AgentConsoleRow[]>(() => {
    return agents
      .filter((agent) => !agent.archived_at)
      .map((agent) => {
        const runtime = runtimesById.get(agent.runtime_id) ?? null;
        const presence = presenceMap.get(agent.id) ?? null;
        const tasks = tasksByAgent.get(agent.id) ?? [];
        const activity = activityMap.get(agent.id);
        return {
          agent,
          runtime,
          ...classifyAgent(agent, runtime, presence),
          activity: (activity?.buckets ?? [])
            .slice(-7)
            .map((bucket) => bucket.total),
          current: activeTasks(tasks),
          last: latestTerminalTask(tasks),
        };
      });
  }, [agents, runtimesById, presenceMap, tasksByAgent, activityMap]);

  const stats = useMemo(() => agentConsoleStats(rows), [rows]);

  const issueIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of rows) {
      for (const task of row.current) if (task.issue_id) ids.add(task.issue_id);
      if (row.last?.issue_id) ids.add(row.last.issue_id);
    }
    return [...ids];
  }, [rows]);

  const { data: issues = [] } = useQuery(issuesByIdsOptions(wsId, issueIds));
  const issuesById = useMemo(() => {
    const map = new Map<string, Issue>();
    for (const issue of issues) map.set(issue.id, issue);
    return map;
  }, [issues]);

  const providerRows = useMemo(
    () =>
      providerFilter === "all"
        ? rows
        : rows.filter((row) => row.provider === providerFilter),
    [rows, providerFilter],
  );

  const tabCounts = useMemo(() => agentStatusCounts(providerRows), [providerRows]);

  const visibleRows = useMemo(
    () =>
      statusFilter === "all"
        ? providerRows
        : providerRows.filter((row) => row.status === statusFilter),
    [providerRows, statusFilter],
  );

  const groups = useMemo(() => groupAgentRows(visibleRows), [visibleRows]);

  const providers = useMemo(() => {
    const keys = new Set(rows.map((row) => row.provider));
    return [...keys].sort((a, b) => {
      const order: string[] = ["claude", "codex", "copilot", "cursor", "kimi"];
      const ia = a === UNBOUND_PROVIDER ? Number.MAX_SAFE_INTEGER : order.indexOf(a);
      const ib = b === UNBOUND_PROVIDER ? Number.MAX_SAFE_INTEGER : order.indexOf(b);
      const byOrder = (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib);
      return byOrder || a.localeCompare(b);
    });
  }, [rows]);

  const now = useNowTick(rows.some((row) => row.current.length > 0));
  const clock = shortClock(new Date());

  // Sliding tab underline: measured, so it tracks the label width as counts
  // change instead of assuming a fixed tab width.
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const [underline, setUnderline] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  });
  useEffect(() => {
    const list = tabListRef.current;
    if (!list) return;
    const measure = () => {
      const active = list.querySelector<HTMLElement>('[data-active]');
      if (!active) return;
      setUnderline({ left: active.offsetLeft, width: active.offsetWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [statusFilter, tabCounts.all, tabCounts.working, tabCounts.idle, tabCounts.needs]);

  const toggleGroup = (provider: string) => {
    setCollapsedProviders((current) => {
      const next = new Set(current);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  };

  const openAgent = (agent: Agent) => {
    navigation.push(paths.agentDetail(agent.id));
  };

  const openChat = (agent: Agent) => {
    navigation.push(paths.chatWithAgent(agent.id));
  };

  const assignTask = (row: AgentConsoleRow) => {
    useModalStore.getState().open("quick-create-issue", {
      agent_id: row.agent.id,
    });
  };

  const bindRuntime = (agent: Agent) => {
    navigation.push(paths.agentDetail(agent.id));
  };

  const confirmStop = async () => {
    if (!stopTarget || stopPendingRef.current) return;
    stopPendingRef.current = true;
    try {
      const { cancelled } = await api.cancelAgentTasks(stopTarget.agent.id);
      qc.invalidateQueries({ queryKey: workspaceKeys.agents(wsId) });
      toast.success(
        cancelled === 0
          ? t(($) => $.row_actions.no_tasks_to_cancel_toast)
          : t(($) => $.row_actions.cancelled_tasks_toast, { count: cancelled }),
      );
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t(($) => $.row_actions.cancel_failed_toast),
      );
    } finally {
      stopPendingRef.current = false;
      setStopTarget(null);
    }
  };

  const statusLabel = (status: StatusFilter) =>
    status === "all"
      ? t(($) => $.console.filter_all)
      : status === "working"
        ? t(($) => $.workload.working)
        : status === "idle"
          ? t(($) => $.workload.idle)
          : t(($) => $.console.filter_needs);

  const taskText = (task: AgentTask) => {
    const issue = issuesById.get(task.issue_id);
    if (issue) return { code: issue.identifier, title: issue.title };
    if (task.trigger_summary) return { code: "", title: task.trigger_summary };
    return { code: "", title: t(($) => $.console.unlinked_task) };
  };

  const openTask = (task: AgentTask) => {
    if (task.issue_id) navigation.push(paths.issueDetail(task.issue_id));
  };

  return (
    <div className="qw-ag-page">
      <header className="qw-ag-masthead">
        <div className="qw-ag-mast-main">
          <div className="qw-ag-mast-line">
            <h1>{t(($) => $.page.title)}</h1>
            <span className="qw-ag-count">
              <b>{stats.all}</b>
              <span>{t(($) => $.console.agents)}</span>
            </span>
            <button
              type="button"
              className="qw-ag-create"
              onClick={() => navigation.push(paths.newAgent())}
            >
              <span className="plus">
                <Plus className="size-3" aria-hidden="true" />
              </span>
              {t(($) => $.page.new_agent)}
              <span className="kbd">A</span>
            </button>
          </div>
          <p className="qw-ag-live">
            <span className="lamp live" aria-hidden="true" />
            <b>{stats.working}</b> {t(($) => $.workload.working)}
            <span className="sep">·</span>
            <span className="lamp" data-tone="done" aria-hidden="true" />
            <b>{stats.idle}</b> {t(($) => $.workload.idle)}
            <span className="sep">·</span>
            <span className="lamp" data-tone="needs" aria-hidden="true" />
            <b>{stats.needs}</b> {t(($) => $.console.filter_needs)}
            <span className="sep">·</span>
            <span className="quiet">
              <b>{stats.runtimes}</b> {t(($) => $.console.runtime_count)}
              {" · "}
              <b>{stats.queued}</b> {t(($) => $.console.tasks_queued)}
            </span>
          </p>
        </div>
        <div className="qw-ag-sync">
          <span className="sync">
            <i aria-hidden="true" />
            SYNCED
          </span>
          <span className="time">{clock}</span>
          <span className="hint">{t(($) => $.console.sync_hint)}</span>
        </div>
      </header>

      <div className="qw-ag-toolbar">
        <div className="qw-ag-tabs" role="tablist" ref={tabListRef}>
          <span
            className="qw-ag-tabline"
            style={{ left: underline.left, width: underline.width }}
            aria-hidden="true"
          />
          {STATUS_TABS.map((status) => (
            <button
              key={status}
              type="button"
              role="tab"
              aria-selected={statusFilter === status}
              data-active={statusFilter === status ? "" : undefined}
              className="qw-ag-tab"
              onClick={() => setStatusFilter(status)}
            >
              {statusLabel(status)}
              <em>{tabCounts[status]}</em>
            </button>
          ))}
        </div>
        <div className="qw-ag-toolbar-right">
          <span className="qw-ag-queue">
            <i aria-hidden="true" />
            <b>{stats.queued}</b> {t(($) => $.console.tasks_queued)}
          </span>
        </div>
      </div>

      <div className="qw-ag-strip">
        <span className="qw-ag-strip-label">
          {t(($) => $.console.runtime_label)}
        </span>
        <div className="qw-ag-chips">
          <button
            type="button"
            className="qw-ag-chip"
            data-active={providerFilter === "all" ? "" : undefined}
            aria-pressed={providerFilter === "all"}
            onClick={() => setProviderFilter("all")}
          >
            <span className="all-mark" aria-hidden="true">
              ∗
            </span>
            <span>{t(($) => $.console.runtime_all)}</span>
            <span className="cnt">{rows.length}</span>
          </button>
          {providers.map((provider) => {
            const meta = providerMeta(provider);
            const providerRowsForChip = rows.filter(
              (row) => row.provider === provider,
            );
            const running = providerRowsForChip.reduce(
              (sum, row) => sum + row.running,
              0,
            );
            return (
              <button
                key={provider}
                type="button"
                className="qw-ag-chip"
                data-active={providerFilter === provider ? "" : undefined}
                aria-pressed={providerFilter === provider}
                onClick={() =>
                  setProviderFilter((current) =>
                    current === provider ? "all" : provider,
                  )
                }
              >
                <span
                  className="logo"
                  data-provider={provider}
                  style={{ "--pc": meta.color } as CSSProperties}
                >
                  {provider === UNBOUND_PROVIDER ? (
                    <Unplug className="size-3" aria-hidden="true" />
                  ) : (
                    <ProviderLogo provider={provider} className="size-3.5" />
                  )}
                </span>
                <span>
                  {provider === UNBOUND_PROVIDER
                    ? t(($) => $.console.filter_needs)
                    : meta.label}
                </span>
                <span className="cnt">{providerRowsForChip.length}</span>
                {running > 0 ? (
                  <span
                    className="live"
                    title={t(($) => $.console.running_count, { count: running })}
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {isLoading ? (
        <div className="qw-ag-board">
          <div className="qw-ag-loading">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-[54px] w-full rounded-none" />
            ))}
          </div>
        </div>
      ) : error ? (
        <div className="qw-ag-empty">
          <h3>{t(($) => $.page.list_load_failed)}</h3>
          <p>
            {error instanceof Error
              ? error.message
              : t(($) => $.page.list_load_failed_default)}
          </p>
          <button type="button" className="qw-ag-primary" onClick={() => refetch()}>
            {t(($) => $.page.try_again)}
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="qw-ag-empty">
          <h3>{t(($) => $.empty.title)}</h3>
          <p>{t(($) => $.empty.description)}</p>
          <button
            type="button"
            className="qw-ag-primary"
            onClick={() => navigation.push(paths.newAgent())}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            {t(($) => $.page.new_agent)}
          </button>
        </div>
      ) : (
        <div className="qw-ag-board">
          <div className="qw-ag-thead">
            <span>{t(($) => $.console.col_agent)}</span>
            <span>{t(($) => $.console.col_status)}</span>
            <span>{t(($) => $.console.col_task)}</span>
            <span className="th-cap">{t(($) => $.console.col_capacity)}</span>
            <span className="th-activity">{t(($) => $.console.col_activity)}</span>
            <span className="th-act">{t(($) => $.console.col_actions)}</span>
          </div>
          {groups.length === 0 ? (
            <div className="qw-ag-filter-empty">
              <h3>{t(($) => $.console.no_filter_title)}</h3>
              <p>{t(($) => $.console.no_filter_hint)}</p>
            </div>
          ) : (
            groups.map((group) => {
              const meta = providerMeta(group.provider);
              const groupLabel =
                group.provider === UNBOUND_PROVIDER
                  ? t(($) => $.console.filter_needs)
                  : meta.label;
              const collapsed = collapsedProviders.has(group.provider);
              const rowsId = `qw-ag-group-${group.provider}`;
              return (
                <section
                  key={group.provider}
                  className="qw-ag-group"
                  data-provider={group.provider}
                  data-collapsed={collapsed ? "" : undefined}
                  style={{ "--pc": meta.color } as CSSProperties}
                >
                  <button
                    type="button"
                    className="qw-ag-group-head"
                    aria-expanded={!collapsed}
                    aria-controls={rowsId}
                    aria-label={t(($) => $.console.toggle_group, {
                      name: groupLabel,
                    })}
                    onClick={() => toggleGroup(group.provider)}
                  >
                    <span className="qw-ag-group-logo" data-provider={group.provider}>
                      {group.provider === UNBOUND_PROVIDER ? (
                        <Unplug className="size-3.5" aria-hidden="true" />
                      ) : (
                        <ProviderLogo provider={group.provider} className="size-4" />
                      )}
                    </span>
                    <span className="qw-ag-group-name">{groupLabel}</span>
                    {meta.vendor ? (
                      <span className="qw-ag-group-vendor">{meta.vendor}</span>
                    ) : null}
                    <span className="qw-ag-group-count">
                      {t(($) => $.console.group_count, {
                        count: group.rows.length,
                        running: group.running,
                      })}
                    </span>
                    <span className="qw-ag-group-cap">
                      <span className="qw-ag-pips" aria-hidden="true">
                        {Array.from(
                          { length: Math.max(1, Math.min(group.capacity, 8)) },
                          (_, index) => (
                            <i
                              key={index}
                              data-on={index < group.running ? "" : undefined}
                            />
                          ),
                        )}
                      </span>
                      <span>
                        {group.running}/{group.capacity}
                      </span>
                    </span>
                    <ChevronDown
                      className="qw-ag-group-chevron"
                      aria-hidden="true"
                    />
                  </button>
                  <div
                    id={rowsId}
                    className="qw-ag-rows-clip"
                    data-collapsed={collapsed ? "" : undefined}
                  >
                    <div className="qw-ag-rows">
                    {group.rows.map((row) => {
                      const metaRow = providerMeta(row.provider);
                      const accent = agentAccent(row.agent.id);
                      return (
                        <div
                          key={row.agent.id}
                          className="qw-ag-row"
                          data-state={row.status}
                          style={
                            {
                              "--pc": metaRow.color,
                              "--ac": accent,
                            } as CSSProperties
                          }
                        >
                          <button
                            type="button"
                            className="qw-ag-agent"
                            onClick={() => openAgent(row.agent)}
                            title={t(($) => $.console.open_agent, {
                              name: row.agent.name,
                            })}
                          >
                            {resolvePublicFileUrl(row.agent.avatar_url) ? (
                              <img
                                className="qw-ag-avatar"
                                src={resolvePublicFileUrl(row.agent.avatar_url) ?? ""}
                                alt=""
                              />
                            ) : (
                              <span className="qw-ag-avatar">
                                {row.agent.name.trim().charAt(0).toUpperCase() ||
                                  "A"}
                              </span>
                            )}
                            <span className="qw-ag-name">{row.agent.name}</span>
                          </button>

                          <StatusCell row={row} />

                          <div className="qw-ag-task">
                            {row.status === "working" ? (
                              row.current.length > 0 ? (
                                row.current.slice(0, 2).map((task) => {
                                  const text = taskText(task);
                                  return (
                                    <button
                                      key={task.id}
                                      type="button"
                                      className="qw-ag-line"
                                      onClick={() => openTask(task)}
                                      disabled={!task.issue_id}
                                    >
                                      {text.code ? (
                                        <span className="qw-ag-code">{text.code}</span>
                                      ) : null}
                                      <span className="qw-ag-title">{text.title}</span>
                                      <span className="qw-ag-time">
                                        {formatElapsed(
                                          task.started_at ?? task.dispatched_at,
                                          now,
                                        )}
                                      </span>
                                    </button>
                                  );
                                })
                              ) : (
                                <span className="qw-ag-line muted">
                                  {t(($) => $.console.running_no_task)}
                                </span>
                              )
                            ) : row.status === "needs" &&
                              row.needsReason !== "unbound" &&
                              row.last ? (
                              <button
                                type="button"
                                className="qw-ag-line"
                                onClick={() => openTask(row.last as AgentTask)}
                                disabled={!row.last.issue_id}
                              >
                                {taskText(row.last).code ? (
                                  <span className="qw-ag-code">
                                    {taskText(row.last).code}
                                  </span>
                                ) : null}
                                <span className="qw-ag-title">
                                  {taskText(row.last).title}
                                </span>
                                <span className="qw-ag-time quiet">
                                  {timeAgo(
                                    row.last.completed_at ??
                                      row.last.started_at ??
                                      row.last.created_at,
                                  )}
                                </span>
                              </button>
                            ) : row.status === "needs" ? (
                              <span className="qw-ag-line">
                                <span className="qw-ag-needs">
                                  {row.queued > 0 ? (
                                    <>
                                      {t(($) => $.console.queued_count, {
                                        count: row.queued,
                                      })}
                                      <span className="qw-ag-dot" aria-hidden="true" />
                                    </>
                                  ) : null}
                                  {row.needsReason === "offline"
                                    ? t(($) => $.card.machine_offline)
                                    : row.needsReason === "unstable"
                                      ? t(($) => $.availability.unstable)
                                      : t(($) => $.row.needs_runtime)}
                                </span>
                                {row.needsReason === "unbound" ? (
                                  <button
                                    type="button"
                                    className="qw-ag-bind"
                                    onClick={() => bindRuntime(row.agent)}
                                  >
                                    {t(($) => $.console.bind_runtime)}
                                  </button>
                                ) : null}
                              </span>
                            ) : row.last ? (
                              <button
                                type="button"
                                className="qw-ag-line"
                                onClick={() => openTask(row.last as AgentTask)}
                                disabled={!row.last.issue_id}
                              >
                                {taskText(row.last).code ? (
                                  <span className="qw-ag-code">
                                    {taskText(row.last).code}
                                  </span>
                                ) : null}
                                <span className="qw-ag-title">
                                  {taskText(row.last).title}
                                </span>
                                <span className="qw-ag-time quiet">
                                  {timeAgo(
                                    row.last.completed_at ??
                                      row.last.started_at ??
                                      row.last.created_at,
                                  )}
                                </span>
                              </button>
                            ) : (
                              <span className="qw-ag-line muted">
                                {t(($) => $.console.no_runs)}
                              </span>
                            )}
                          </div>

                          <span className="qw-ag-col-cap">
                            <CapacityCell row={row} />
                          </span>

                          <span className="qw-ag-activity">
                            <ActivityCell values={row.activity} />
                          </span>

                          <div className="qw-ag-actions">
                            <button
                              type="button"
                              className="qw-ag-icon"
                              aria-label={t(($) => $.console.chat_aria, {
                                name: row.agent.name,
                              })}
                              title={t(($) => $.console.chat)}
                              onClick={() => openChat(row.agent)}
                            >
                              <Terminal className="size-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="qw-ag-icon"
                              aria-label={t(($) => $.console.assign_aria, {
                                name: row.agent.name,
                              })}
                              title={t(($) => $.console.assign)}
                              onClick={() => assignTask(row)}
                            >
                              <Plus className="size-3.5" aria-hidden="true" />
                            </button>
                            {row.status === "working" ? (
                              <button
                                type="button"
                                className="qw-ag-icon danger"
                                aria-label={t(($) => $.console.stop_aria, {
                                  name: row.agent.name,
                                })}
                                title={t(($) => $.console.stop)}
                                onClick={() => setStopTarget(row)}
                              >
                                <Square className="size-3" aria-hidden="true" />
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                    </div>
                  </div>
                </section>
              );
            })
          )}
        </div>
      )}

      <footer className="qw-ag-pager">
        <span className="sum">
          {t(($) => $.console.footer_summary, {
            count: stats.all,
            agents: stats.all,
            runtimes: stats.runtimes,
            queued: stats.queued,
          })}
        </span>
        <span className="grow" />
        <span className="sum hint">{t(($) => $.console.footer_hint)}</span>
      </footer>

      <AlertDialog
        open={!!stopTarget}
        onOpenChange={(open) => {
          if (!open) setStopTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {stopTarget
                ? t(($) => $.row_actions.cancel_dialog_title, {
                    name: stopTarget.agent.name,
                  })
                : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {stopTarget
                ? t(($) => $.row_actions.cancel_dialog_impact, {
                    summary: t(($) => $.row_actions.cancel_dialog_running, {
                      count: stopTarget.running,
                    }),
                    count: stopTarget.running + stopTarget.queued,
                  })
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t(($) => $.row_actions.cancel_dialog_keep)}
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmStop()}>
              {t(($) => $.row_actions.cancel_dialog_confirm)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
