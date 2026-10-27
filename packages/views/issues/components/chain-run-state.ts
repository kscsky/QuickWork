import type { AgentTask, IssueChain, IssueChainStep } from "@quickwork/core/types";

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

/**
 * The runs that belong to one leg: same issue, the leg's agent, created while
 * the leg was live. The window is what does the real work — the same agent
 * runs again on the next issue, and a leg that handed off yesterday must not
 * absorb today's run.
 */
export function legRunTasks(
  issueId: string,
  step: IssueChainStep,
  tasks: readonly AgentTask[],
): AgentTask[] {
  const from = step.started_at ? new Date(step.started_at).getTime() : 0;
  const to = step.completed_at ? new Date(step.completed_at).getTime() : Infinity;
  return tasks.filter((task) => {
    if (task.issue_id !== issueId) return false;
    if (step.agent_id && task.agent_id !== step.agent_id) return false;
    const at = task.created_at ? new Date(task.created_at).getTime() : 0;
    return at >= from && at <= to;
  });
}

/**
 * The comment carrying a leg's produced output (产出 md).
 *
 * The output is the FIRST agent comment that lands AFTER the pre-ask
 * baseline, scoped to the leg — never the whole timeline's first match, or an
 * older leg message gets re-selected on every evaluation. `baselineId` is the
 * leg's latest agent comment at ask time ("": none yet, scan from the start).
 * A baseline that is no longer present yields null rather than falling back
 * to a start-of-timeline scan: re-lifting history is the bug this guards.
 */
export function selectProducedLegComment<T extends {
  id: string;
  actor_type: string;
  chain_step_id?: string | null;
  content?: string | null;
}>(
  timeline: readonly T[],
  baselineId: string | null,
  legStepId: string | null,
): T | null {
  const baselineIdx = baselineId
    ? timeline.findIndex((entry) => entry.id === baselineId)
    : -1;
  const start =
    baselineId === null || baselineId === ""
      ? 0
      : baselineIdx >= 0
        ? baselineIdx + 1
        : timeline.length;
  const produced = timeline.slice(start).find(
    (entry) =>
      entry.actor_type === "agent" &&
      (entry.content ?? "") !== "" &&
      (!legStepId || entry.chain_step_id === legStepId),
  );
  return produced ?? null;
}

/**
 * The leg's newest run, terminal included — the 执行实况 strip's subject, and
 * what 完整日志 opens. A completed run is not clutter: reviewing the leg means
 * reading exactly that run.
 *
 * Deliberately NOT windowed by legRunTasks: while a reviewing leg waits, the
 * holder can still talk to its agent, and that fresh run belongs to this leg
 * even though it outlived the leg's completed_at. Same agent filter as
 * stepRunState — the leg's own agent on this issue.
 */
export function latestLegRun(
  issueId: string,
  step: IssueChainStep,
  tasks: readonly AgentTask[],
): AgentTask | null {
  if (!step.agent_id) return null;
  const runs = tasks
    .filter((task) => task.issue_id === issueId && task.agent_id === step.agent_id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return runs[0] ?? null;
}

/** Keeps a state from a newer backend renderable instead of blank. */
export function chainStateKey(
  state: string,
): "pending" | "doing" | "reviewing" | "done" | "parked" | "skipped" | "unknown" {
  switch (state) {
    case "pending":
    case "doing":
    case "reviewing":
    case "done":
    case "parked":
    case "skipped":
      return state;
    default:
      return "unknown";
  }
}

/**
 * Everything the room's reader-specific pieces need, derived once.
 *
 * The strip, the status line, the chat header and the rail all speak from the
 * viewer's seat ("现在是你" vs "等你交棒"), so they must agree on which leg is
 * active and which one is theirs — derived here rather than four times.
 */
export interface RelayView {
  currentUserId?: string;
  /** The leg the relay is sitting on: doing / reviewing / parked. */
  activeStep: IssueChainStep | null;
  activeIndex: number;
  /** The viewer's first unfinished leg — the one they write a plan for. */
  myStep: IssueChainStep | null;
  myIndex: number;
  /** The viewer's leg that already passed — the relay runs on without them. */
  myDeliveredStep: IssueChainStep | null;
  reviewingStep: IssueChainStep | null;
  canApprove: boolean;
  /** Where the baton goes when the reviewing leg passes. */
  nextStep: IssueChainStep | null;
  /** Where the baton goes when the viewer's own leg passes. */
  nextAfterMineStep: IssueChainStep | null;
  /** Every leg delivered. */
  done: boolean;
}

const DELIVERED_STATES = new Set(["done", "skipped"]);

export function deriveRelayView(
  chain: IssueChain,
  currentUserId: string | undefined,
): RelayView {
  const steps = chain.steps;
  const activeIndex = steps.findIndex(
    (s) => s.state === "doing" || s.state === "reviewing" || s.state === "parked",
  );
  const myIndex = currentUserId
    ? steps.findIndex(
        (s) => s.holder_user_id === currentUserId && !DELIVERED_STATES.has(s.state),
      )
    : -1;
  const reviewingIndex = steps.findIndex((s) => s.state === "reviewing");
  const stepAt = (index: number): IssueChainStep | null =>
    index >= 0 && index < steps.length ? steps[index] ?? null : null;
  return {
    currentUserId,
    activeStep: stepAt(activeIndex),
    activeIndex,
    myStep: stepAt(myIndex),
    myIndex,
    myDeliveredStep:
      currentUserId
        ? steps.find(
            (s) => s.holder_user_id === currentUserId && s.state === "done",
          ) ?? null
        : null,
    reviewingStep: stepAt(reviewingIndex),
    canApprove:
      reviewingIndex >= 0 &&
      !!currentUserId &&
      steps[reviewingIndex]?.holder_user_id === currentUserId,
    nextStep: stepAt(reviewingIndex + 1),
    nextAfterMineStep: stepAt(myIndex + 1),
    done: steps.length > 0 && steps.every((s) => DELIVERED_STATES.has(s.state)),
  };
}
