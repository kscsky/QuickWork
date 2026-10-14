// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Agent, AgentTask, Issue } from "@quickwork/core/types";
import { deriveRunningRuns, isActiveTask, type RunningRun } from "./derive";

function task(over: Partial<AgentTask> & { id: string }): AgentTask {
  return {
    agent_id: "agent-1",
    runtime_id: "rt-1",
    issue_id: "issue-1",
    status: "running",
    priority: 0,
    dispatched_at: "2026-10-08T10:00:00Z",
    created_at: "2026-10-08T10:00:00Z",
    ...over,
  } as AgentTask;
}

function issue(over: Partial<Issue> & { id: string }): Issue {
  return {
    workspace_id: "ws-1",
    title: "",
    identifier: "KS-1",
    status: "todo",
    priority: "none",
    ...over,
  } as Issue;
}

function agent(id: string, name: string): Agent {
  return { id, name } as Agent;
}

const agents = new Map([["agent-1", agent("agent-1", "Architect")]]);
const issues = new Map([["issue-1", issue({ id: "issue-1", title: "Payments" })]]);

const ids = (runs: RunningRun[]) => runs.map((r) => r.taskId);

describe("isActiveTask", () => {
  it("counts every status where someone still holds the work", () => {
    for (const status of [
      "queued",
      "dispatched",
      "waiting_local_directory",
      "running",
    ] as const) {
      expect(isActiveTask(task({ id: "t", status }))).toBe(true);
    }
  });

  it("does not count settled runs", () => {
    for (const status of ["completed", "failed", "cancelled"] as const) {
      expect(isActiveTask(task({ id: "t", status }))).toBe(false);
    }
  });
});

describe("deriveRunningRuns", () => {
  it("drops terminal runs", () => {
    const runs = deriveRunningRuns(
      [task({ id: "a", status: "completed" }), task({ id: "b" })],
      issues,
      agents,
    );
    expect(ids(runs)).toEqual(["b"]);
  });

  // A run dispatched but not yet started has to stay on the list, so its clock
  // falls back to dispatch time rather than reading as untimed.
  it("falls back to dispatch time when the process has not started", () => {
    const runs = deriveRunningRuns(
      [task({ id: "a", started_at: undefined, dispatched_at: "2026-10-08T09:00:00Z" })],
      issues,
      agents,
    );
    expect(runs[0]!.startedAtIso).toBe("2026-10-08T09:00:00Z");
  });

  it("orders longest-held first", () => {
    const runs = deriveRunningRuns(
      [
        task({ id: "newer", dispatched_at: "2026-10-08T11:00:00Z" }),
        task({ id: "older", dispatched_at: "2026-10-08T08:00:00Z" }),
      ],
      issues,
      agents,
    );
    expect(ids(runs)).toEqual(["older", "newer"]);
  });

  // Untimed runs sink rather than sorting as epoch 0 and claiming to be the
  // longest-held thing on screen.
  it("sinks untimed runs to the bottom", () => {
    const runs = deriveRunningRuns(
      [
        task({ id: "untimed", started_at: undefined, dispatched_at: undefined }),
        task({ id: "timed", dispatched_at: "2026-10-08T11:00:00Z" }),
      ],
      issues,
      agents,
    );
    expect(ids(runs)).toEqual(["timed", "untimed"]);
  });

  // Chat-spawned runs carry issue_id === "" by contract: nothing to name, and
  // no place in a list of what each agent holds.
  it("skips runs with no issue", () => {
    const runs = deriveRunningRuns([task({ id: "a", issue_id: "" })], issues, agents);
    expect(runs).toEqual([]);
  });

  it("names the run from the issue, falling back to its identifier", () => {
    const withoutTitle = deriveRunningRuns(
      [task({ id: "a" })],
      new Map([["issue-1", issue({ id: "issue-1", title: "", identifier: "KS-9" })]]),
      agents,
    );
    expect(withoutTitle[0]!.title).toBe("KS-9");

    const missing = deriveRunningRuns([task({ id: "a" })], new Map(), agents);
    expect(missing[0]!.title).toBe("");
  });

  // A task outliving its agent's visibility is drift the page should show,
  // not swallow.
  it("keeps runs whose agent is missing from the roster", () => {
    const runs = deriveRunningRuns([task({ id: "a" })], issues, new Map());
    expect(runs).toHaveLength(1);
    expect(runs[0]!.agentName).toBe("");
  });
});
