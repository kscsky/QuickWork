import type { Agent, AgentRuntime, AgentTask } from "@quickwork/core/types";
import {
  isAgentRuntimeBound,
  type AgentPresenceDetail,
} from "@quickwork/core/agents";

export const UNBOUND_PROVIDER = "unbound";

export type AgentConsoleStatus = "working" | "idle" | "needs";
export type AgentNeedsReason = "unbound" | "offline" | "unstable";

export interface AgentConsoleRow {
  agent: Agent;
  runtime: AgentRuntime | null;
  provider: string;
  status: AgentConsoleStatus;
  needsReason: AgentNeedsReason | null;
  running: number;
  queued: number;
  capacity: number;
  activity: number[];
  current: AgentTask[];
  last: AgentTask | null;
}

export interface ProviderMeta {
  label: string;
  vendor: string;
  color: string;
}

// Fixed order mirrors the mockup's runtime strip: the families a team is
// likely to run lead, unknown custom families follow alphabetically, and the
// unbound bucket always sits last.
const PROVIDER_ORDER = ["claude", "codex", "copilot", "cursor", "kimi"];

const PROVIDER_META: Record<string, ProviderMeta> = {
  claude: { label: "Claude", vendor: "ANTHROPIC", color: "#d97757" },
  codex: { label: "Codex", vendor: "OPENAI", color: "#1f2328" },
  copilot: { label: "Copilot", vendor: "GITHUB", color: "#1f2328" },
  cursor: { label: "Cursor", vendor: "CURSOR", color: "#15120b" },
  kimi: { label: "Kimi", vendor: "MOONSHOT", color: "#1f1147" },
  unbound: { label: "Unbound", vendor: "", color: "#8a5a2a" },
};

export function providerMeta(provider: string): ProviderMeta {
  const key = provider.trim().toLowerCase();
  const known = PROVIDER_META[key];
  if (known) return known;
  const label = key ? key.charAt(0).toUpperCase() + key.slice(1) : "Runtime";
  return { label, vendor: key.toUpperCase(), color: "#5f6977" };
}

export function providerSortIndex(provider: string): number {
  if (provider === UNBOUND_PROVIDER) return Number.MAX_SAFE_INTEGER;
  const index = PROVIDER_ORDER.indexOf(provider);
  return index === -1 ? PROVIDER_ORDER.length : index;
}

/** Active statuses that count as work on the agent's plate. */
const ACTIVE_TASK_STATUSES = new Set<AgentTask["status"]>([
  "queued",
  "dispatched",
  "waiting_local_directory",
  "running",
]);

export function isActiveAgentTask(task: AgentTask): boolean {
  return ACTIVE_TASK_STATUSES.has(task.status);
}

function taskMoment(task: AgentTask): number {
  const raw = task.completed_at ?? task.started_at ?? task.dispatched_at ?? task.created_at;
  return raw ? Date.parse(raw) || 0 : 0;
}

export function latestTerminalTask(tasks: readonly AgentTask[]): AgentTask | null {
  let latest: AgentTask | null = null;
  for (const task of tasks) {
    if (isActiveAgentTask(task)) continue;
    if (!latest || taskMoment(task) > taskMoment(latest)) latest = task;
  }
  return latest;
}

export function activeTasks(tasks: readonly AgentTask[]): AgentTask[] {
  return tasks
    .filter(isActiveAgentTask)
    .sort((a, b) => {
      if (a.status === "running" && b.status !== "running") return -1;
      if (b.status === "running" && a.status !== "running") return 1;
      return taskMoment(a) - taskMoment(b);
    });
}

export function classifyAgent(
  agent: Agent,
  runtime: AgentRuntime | null,
  presence: AgentPresenceDetail | null | undefined,
): Pick<AgentConsoleRow, "provider" | "status" | "needsReason" | "running" | "queued" | "capacity"> {
  const running = presence?.runningCount ?? 0;
  const queued = presence?.queuedCount ?? 0;
  const capacity = presence?.capacity ?? agent.max_concurrent_tasks;
  const bound = isAgentRuntimeBound(agent) && !!runtime;
  if (!bound) {
    return {
      provider: UNBOUND_PROVIDER,
      status: "needs",
      needsReason: "unbound",
      running,
      queued,
      capacity,
    };
  }
  const provider = runtime.provider?.trim().toLowerCase() || UNBOUND_PROVIDER;
  if (runtime.status !== "online") {
    return { provider, status: "needs", needsReason: "offline", running, queued, capacity };
  }
  if (presence?.availability === "unstable") {
    return { provider, status: "needs", needsReason: "unstable", running, queued, capacity };
  }
  return {
    provider,
    status: running > 0 ? "working" : "idle",
    needsReason: null,
    running,
    queued,
    capacity,
  };
}

export interface AgentConsoleGroup {
  provider: string;
  rows: AgentConsoleRow[];
  running: number;
  capacity: number;
}

export function groupAgentRows(rows: readonly AgentConsoleRow[]): AgentConsoleGroup[] {
  const groups = new Map<string, AgentConsoleRow[]>();
  for (const row of rows) {
    const list = groups.get(row.provider);
    if (list) list.push(row);
    else groups.set(row.provider, [row]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      const byOrder = providerSortIndex(a) - providerSortIndex(b);
      return byOrder || a.localeCompare(b);
    })
    .map(([provider, groupRows]) => ({
      provider,
      rows: groupRows,
      running: groupRows.reduce((sum, row) => sum + row.running, 0),
      capacity: groupRows.reduce((sum, row) => sum + row.capacity, 0),
    }));
}

export interface AgentConsoleStats {
  all: number;
  working: number;
  idle: number;
  needs: number;
  queued: number;
  runtimes: number;
}

export function agentConsoleStats(rows: readonly AgentConsoleRow[]): AgentConsoleStats {
  let working = 0;
  let idle = 0;
  let needs = 0;
  let queued = 0;
  const providers = new Set<string>();
  for (const row of rows) {
    if (row.status === "working") working++;
    else if (row.status === "idle") idle++;
    else needs++;
    queued += row.queued;
    if (row.provider !== UNBOUND_PROVIDER) providers.add(row.provider);
  }
  return { all: rows.length, working, idle, needs, queued, runtimes: providers.size };
}

export function agentStatusCounts(rows: readonly AgentConsoleRow[]) {
  return {
    all: rows.length,
    working: rows.filter((row) => row.status === "working").length,
    idle: rows.filter((row) => row.status === "idle").length,
    needs: rows.filter((row) => row.status === "needs").length,
  };
}

// Stable per-agent avatar tint — the same agent keeps the same disc as the
// roster reorders or filters.
const AVATAR_COLORS = [
  "#c7745a",
  "#4f7d63",
  "#7a5aa6",
  "#4a6fa8",
  "#3f6b58",
  "#6a4a9e",
  "#a35d3a",
  "#8a5a2a",
];

export function agentAccent(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? "#7a5aa6";
}
