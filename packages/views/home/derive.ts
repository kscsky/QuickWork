import type { Agent, AgentTask, Issue } from "@quickwork/core/types";

// Pure derivations behind the compose canvas. Everything here takes its inputs
// and its clock as arguments — no Date.now(), no hooks, no fetching — so the
// rules that decide what the page claims are readable and testable on their
// own. Anything that needs to know "now" gets it passed in.

/**
 * Statuses where a run is still being held by someone, in the same four-way
 * bucket every other consumer of `AgentTask.status` uses: `queued` counts as
 * held because the agent has already been chosen and the work is theirs, even
 * though the process has not started.
 */
const ACTIVE_TASK_STATUSES: ReadonlySet<AgentTask["status"]> = new Set([
  "queued",
  "dispatched",
  "waiting_local_directory",
  "running",
]);

export function isActiveTask(task: AgentTask): boolean {
  return ACTIVE_TASK_STATUSES.has(task.status);
}

/** The timestamp a run's clock starts from. `started_at` is absent until the
 *  process actually launches, so a dispatched-but-not-started run falls back
 *  to dispatch time rather than dropping out of the list. */
function taskStartIso(task: AgentTask): string | null {
  return task.started_at ?? task.dispatched_at ?? null;
}

export interface RunningRun {
  taskId: string;
  agentId: string;
  agentName: string;
  issueId: string;
  /** Issue title, or the identifier when the title has not loaded yet. */
  title: string;
  startedAtIso: string | null;
}

/** Title if there is one, else the identifier, else "". An empty title is a
 *  real state (the issue row is cached without one), so `??` would not do —
 *  it passes the empty string through and the row renders blank. */
function issueLabel(issue: Issue | undefined): string {
  if (!issue) return "";
  return issue.title || issue.identifier || "";
}

/**
 * Every run currently held, longest-held first.
 *
 * Longest-held rather than newest: this list exists to answer "what is stuck",
 * and a run that started six minutes ago cannot be the answer. Runs whose agent
 * is missing from the roster are still returned — a task outliving its agent's
 * visibility is exactly the kind of drift the page should show, not swallow.
 */
export function deriveRunningRuns(
  tasks: readonly AgentTask[],
  issuesById: ReadonlyMap<string, Issue>,
  agentsById: ReadonlyMap<string, Agent>,
): RunningRun[] {
  const runs: RunningRun[] = [];
  for (const task of tasks) {
    if (!isActiveTask(task)) continue;
    // Chat-spawned runs carry issue_id === "" by contract; they have no issue
    // to name and no place in a list of what each agent holds.
    if (!task.issue_id) continue;
    runs.push({
      taskId: task.id,
      agentId: task.agent_id,
      agentName: agentsById.get(task.agent_id)?.name ?? "",
      issueId: task.issue_id,
      title: issueLabel(issuesById.get(task.issue_id)),
      startedAtIso: taskStartIso(task),
    });
  }
  return runs.sort(byLongestHeld);
}

/** Oldest first. Runs with no usable timestamp sink to the bottom instead of
 *  sorting as epoch 0 and claiming to be the longest-held thing on screen. */
function byLongestHeld(a: RunningRun, b: RunningRun): number {
  const at = a.startedAtIso ? Date.parse(a.startedAtIso) : Number.NaN;
  const bt = b.startedAtIso ? Date.parse(b.startedAtIso) : Number.NaN;
  if (Number.isNaN(at) && Number.isNaN(bt)) return 0;
  if (Number.isNaN(at)) return 1;
  if (Number.isNaN(bt)) return -1;
  return at - bt;
}
