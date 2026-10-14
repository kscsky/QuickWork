import type { AgentTask, IssueChainStep } from "@quickwork/core/types";

/**
 * Where a running step's work actually stands.
 *
 * A step's `doing` state covers two very different situations: the task is
 * still sitting in the queue waiting for its holder's environment to pick it
 * up, or it is executing on that environment right now. The server already
 * models both (the task row's status); this reads them back so the UI can say
 * "waiting for X's machine" instead of flattening both into "in progress".
 * That matters most in a relay: when a step runs on someone else's machine,
 * "progress" is their side of the hand-off, not ours.
 */
export type StepRunState =
  | "none"
  /** `doing`, but no run has been claimed yet — waiting on the holder. */
  | "queued"
  /** Claimed by the holder's environment and executing (or about to). */
  | "running"
  /** The last run died without moving the relay. */
  | "interrupted";

const ACTIVE_STATUSES = new Set<AgentTask["status"]>([
  "queued",
  "dispatched",
  "waiting_local_directory",
  "running",
]);

export function stepRunState(
  issueId: string,
  step: IssueChainStep,
  tasks: readonly AgentTask[],
): StepRunState {
  if (step.state !== "doing" || !step.agent_id) return "none";
  const candidates = tasks
    .filter((task) => task.issue_id === issueId && task.agent_id === step.agent_id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const active = candidates.find((task) => ACTIVE_STATUSES.has(task.status));
  if (active) return active.status === "queued" ? "queued" : "running";
  const latest = candidates[0];
  if (!latest) return "none";
  if (latest.status === "failed" || latest.status === "cancelled") {
    return "interrupted";
  }
  // Completed but the step has not moved yet: the advance is in flight.
  return "running";
}
