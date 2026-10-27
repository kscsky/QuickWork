// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { AgentTask, IssueChain, IssueChainStep } from "@quickwork/core/types";

import { chainStateKey, latestLegRun, deriveRelayView, selectProducedLegComment } from "./chain-run-state";

/**
 * The workbench speaks per reader ("现在是你" / "等你交棒" / "你已经交棒"),
 * so deriveRelayView is the one place that decides which leg is active, which
 * one is the reader's, and whether they hold the 通过. Every surface — strip,
 * status line, chat header, rail — renders this verdict; these cases pin it.
 */

const ME = "user-me";
const OTHER = "user-other";

function step(over: Partial<IssueChainStep> & { position: number; state: string }): IssueChainStep {
  return {
    id: `s${over.position}`,
    holder_user_id: OTHER,
    title: "",
    ...over,
  };
}

const chain = (steps: IssueChainStep[]): IssueChain => ({ steps, parked: false, reviewing: false });

describe("chainStateKey", () => {
  it("passes through every state this build knows", () => {
    for (const state of ["pending", "doing", "reviewing", "done", "parked", "skipped"]) {
      expect(chainStateKey(state)).toBe(state);
    }
  });

  it("keeps a state from a newer backend renderable instead of blank", () => {
    expect(chainStateKey("fast_forwarding")).toBe("unknown");
  });
});

describe("deriveRelayView", () => {
  it("names the reader's leg as the active one while they work it", () => {
    const view = deriveRelayView(
      chain([
        step({ position: 0, holder_user_id: ME, state: "doing" }),
        step({ position: 1, state: "pending" }),
      ]),
      ME,
    );
    expect(view.activeIndex).toBe(0);
    expect(view.myIndex).toBe(0);
    expect(view.canApprove).toBe(false);
    expect(view.nextAfterMineStep?.holder_user_id).toBe(OTHER);
    expect(view.myDeliveredStep).toBeNull();
    expect(view.done).toBe(false);
  });

  it("opens the 通过 only to the leg's own holder", () => {
    const mine = deriveRelayView(
      chain([
        step({ position: 0, holder_user_id: ME, state: "done" }),
        step({ position: 1, holder_user_id: ME, state: "reviewing" }),
        step({ position: 2, state: "pending" }),
      ]),
      ME,
    );
    expect(mine.canApprove).toBe(true);
    expect(mine.nextStep?.holder_user_id).toBe(OTHER);

    const theirs = deriveRelayView(
      chain([
        step({ position: 0, holder_user_id: ME, state: "done" }),
        step({ position: 1, holder_user_id: OTHER, state: "reviewing" }),
        step({ position: 2, holder_user_id: ME, state: "pending" }),
      ]),
      ME,
    );
    expect(theirs.canApprove).toBe(false);
    expect(theirs.myStep?.position).toBe(2);
    // The baton still lands on leg 2 when that review passes — the reader
    // just does not hold the button that passes it.
    expect(theirs.nextStep?.position).toBe(2);
  });

  it("reports a delivered leg instead of pretending the reader is waiting", () => {
    const view = deriveRelayView(
      chain([
        step({ position: 0, holder_user_id: ME, state: "done" }),
        step({ position: 1, state: "doing" }),
      ]),
      ME,
    );
    expect(view.myStep).toBeNull();
    expect(view.myDeliveredStep?.position).toBe(0);
    expect(view.activeStep?.position).toBe(1);
  });

  it("keeps a skipped leg out of both slots — it is neither a turn nor a delivery", () => {
    const view = deriveRelayView(
      chain([
        step({ position: 0, holder_user_id: ME, state: "skipped" }),
        step({ position: 1, state: "doing" }),
      ]),
      ME,
    );
    expect(view.myStep).toBeNull();
    expect(view.myDeliveredStep).toBeNull();
  });

  it("counts a chain with nothing left to run as done, including skips", () => {
    const view = deriveRelayView(
      chain([
        step({ position: 0, state: "done" }),
        step({ position: 1, state: "skipped" }),
      ]),
      ME,
    );
    expect(view.done).toBe(true);
    expect(view.activeStep).toBeNull();
  });

  it("treats the parked leg as the active one — the relay is sitting there", () => {
    const view = deriveRelayView(
      chain([step({ position: 0, state: "parked" })]),
      ME,
    );
    expect(view.activeIndex).toBe(0);
    expect(view.activeStep?.state).toBe("parked");
  });

  it("answers a reader who is not in the chain without inventing a leg", () => {
    const view = deriveRelayView(
      chain([step({ position: 0, state: "doing" })]),
      ME,
    );
    expect(view.myIndex).toBe(-1);
    expect(view.myStep).toBeNull();
    expect(view.myDeliveredStep).toBeNull();
    expect(view.canApprove).toBe(false);
  });
});

/**
 * The leg-output lift: the produced document is the first agent comment AFTER
 * the pre-ask baseline, never the timeline's oldest match. The regression
 * these pin: an older leg message (the pre-fix dispatch report) being lifted
 * on every evaluation, and two comments taking turns re-lifting each other.
 */
describe("selectProducedLegComment", () => {
  const LEG = "step-0";
  const entry = (id: string, actor: string, created: string, content = "x", stepId: string | null = LEG) => ({
    id,
    actor_type: actor,
    chain_step_id: stepId,
    content,
    created_at: created,
  });
  const timeline = [
    entry("old-report", "agent", "t1", "派发没成功"),
    entry("member-ask", "member", "t2", "你调查一下"),
    entry("baseline-md", "agent", "t3", "# 初版产出"),
    entry("new-md", "agent", "t4", "# 新版产出"),
  ];
  const baselineGone = [timeline[0]!, timeline[1]!, timeline[3]!];

  it("skips the old leg message and picks the first agent comment after the baseline", () => {
    const picked = selectProducedLegComment(timeline, "baseline-md", LEG);
    expect(picked?.id).toBe("new-md");
  });

  it("scans from the start when the leg had no agent comment yet", () => {
    const picked = selectProducedLegComment([timeline[0]!, timeline[1]!], "", LEG);
    expect(picked?.id).toBe("old-report");
  });

  it("refuses to fall back to the start when the baseline is gone", () => {
    // Re-scanning history is exactly the re-lift bug; no answer beats a wrong one.
    expect(selectProducedLegComment(baselineGone, "gone", LEG)).toBeNull();
  });

  it("stays inside the leg and skips empty and non-agent comments", () => {
    const mixed = [
      entry("baseline-md", "agent", "t3"),
      entry("other-leg", "agent", "t4", "# 别人的棒", "step-9"),
      entry("member-note", "member", "t5"),
      entry("empty-agent", "agent", "t6", ""),
      entry("mine", "agent", "t7", "# 我的产出"),
    ];
    const picked = selectProducedLegComment(mixed, "baseline-md", LEG);
    expect(picked?.id).toBe("mine");
  });
});

/**
 * The 执行实况 strip renders the leg's newest run — terminal included, because
 * a finished run's log is exactly what the holder opens while reviewing.
 */
describe("latestLegRun", () => {
  const task = (over: Partial<AgentTask> & { id: string; status: string; created_at: string }) => ({
    issue_id: "issue-1",
    agent_id: "a1",
    runtime_id: "rt-1",
    priority: 0,
    dispatched_at: null,
    started_at: null,
    completed_at: null,
    result: null,
    error: null,
    ...over,
  }) as AgentTask;
  const leg = step({ position: 0, state: "reviewing", agent_id: "a1" });

  it("picks the newest run even when it already finished", () => {
    const runs = [
      task({ id: "t1", status: "completed", created_at: "2026-10-16T01:00:00Z" }),
      task({ id: "t2", status: "completed", created_at: "2026-10-16T03:00:00Z" }),
      task({ id: "t3", status: "queued", created_at: "2026-10-16T02:00:00Z" }),
    ];
    expect(latestLegRun("issue-1", leg, runs)?.id).toBe("t2");
  });

  it("ignores other agents and other issues", () => {
    const runs = [
      task({ id: "other-agent", status: "completed", created_at: "2026-10-16T03:00:00Z", agent_id: "a2" }),
      task({ id: "other-issue", status: "completed", created_at: "2026-10-16T03:00:00Z", issue_id: "issue-2" }),
    ];
    expect(latestLegRun("issue-1", leg, runs)).toBeNull();
  });

  it("stays null for an agentless leg", () => {
    const runs = [task({ id: "t1", status: "completed", created_at: "2026-10-16T03:00:00Z" })];
    expect(latestLegRun("issue-1", step({ position: 1, state: "parked" }), runs)).toBeNull();
  });
});
