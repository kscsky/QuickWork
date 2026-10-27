// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { Agent, AgentRuntime, AgentTask } from "@quickwork/core/types";
import type { AgentPresenceDetail } from "@quickwork/core/agents";
import {
  activeTasks,
  agentConsoleStats,
  classifyAgent,
  groupAgentRows,
  latestTerminalTask,
  providerMeta,
  UNBOUND_PROVIDER,
  type AgentConsoleRow,
} from "./agents-console-model";

function agent(id: string): Agent {
  return {
    id,
    name: id,
    runtime_id: "rt-claude",
    runtime_bound: true,
    max_concurrent_tasks: 2,
  } as Agent;
}

function runtime(provider: string, status: "online" | "offline" = "online"): AgentRuntime {
  return { id: "rt-" + provider, provider, status } as AgentRuntime;
}

function presence(overrides: Partial<AgentPresenceDetail> = {}): AgentPresenceDetail {
  return {
    availability: "online",
    workload: "idle",
    runningCount: 0,
    queuedCount: 0,
    capacity: 2,
    ...overrides,
  };
}

function task(overrides: Partial<AgentTask>): AgentTask {
  return {
    id: "t1",
    agent_id: "a1",
    runtime_id: "rt-claude",
    issue_id: "i1",
    status: "completed",
    priority: 0,
    dispatched_at: null,
    started_at: null,
    completed_at: null,
    result: null,
    error: null,
    created_at: "2026-10-20T00:00:00Z",
    ...overrides,
  } as AgentTask;
}

function row(overrides: Partial<AgentConsoleRow> = {}): AgentConsoleRow {
  return {
    agent: agent("a1"),
    runtime: runtime("claude"),
    provider: "claude",
    status: "idle",
    needsReason: null,
    running: 0,
    queued: 0,
    capacity: 2,
    activity: [],
    current: [],
    last: null,
    ...overrides,
  };
}

describe("classifyAgent", () => {
  it("marks an agent whose runtime record is gone as unbound", () => {
    const result = classifyAgent(
      { ...agent("a1"), runtime_bound: false } as Agent,
      null,
      presence(),
    );
    expect(result).toMatchObject({ provider: UNBOUND_PROVIDER, status: "needs", needsReason: "unbound" });
  });

  it("keeps the provider but flags an offline runtime", () => {
    const result = classifyAgent(agent("a1"), runtime("codex", "offline"), presence());
    expect(result).toMatchObject({ provider: "codex", status: "needs", needsReason: "offline" });
  });

  it("treats an unstable presence as needing attention", () => {
    const result = classifyAgent(
      agent("a1"),
      runtime("claude"),
      presence({ availability: "unstable" }),
    );
    expect(result).toMatchObject({ status: "needs", needsReason: "unstable" });
  });

  it("is working only while a task is running", () => {
    expect(
      classifyAgent(agent("a1"), runtime("claude"), presence({ runningCount: 1 })),
    ).toMatchObject({ status: "working", needsReason: null, running: 1 });
    expect(
      classifyAgent(agent("a1"), runtime("claude"), presence({ queuedCount: 2 })),
    ).toMatchObject({ status: "idle", queued: 2 });
  });

  it("falls back to the agent's capacity before presence lands", () => {
    expect(classifyAgent(agent("a1"), runtime("claude"), null)).toMatchObject({
      status: "idle",
      capacity: 2,
    });
  });
});

describe("groupAgentRows", () => {
  it("orders known providers by the design list and unbound last", () => {
    const groups = groupAgentRows([
      row({ agent: agent("a1"), provider: "unbound", status: "needs", needsReason: "unbound" }),
      row({ agent: agent("a2"), provider: "kimi" }),
      row({ agent: agent("a3"), provider: "codex" }),
      row({ agent: agent("a4"), provider: "claude" }),
    ]);
    expect(groups.map((group) => group.provider)).toEqual([
      "claude",
      "codex",
      "kimi",
      "unbound",
    ]);
  });

  it("aggregates running and capacity per provider", () => {
    const groups = groupAgentRows([
      row({ agent: agent("a1"), provider: "claude", running: 1, capacity: 2 }),
      row({ agent: agent("a2"), provider: "claude", running: 2, capacity: 3 }),
    ]);
    expect(groups[0]).toMatchObject({ provider: "claude", running: 3, capacity: 5 });
  });
});

describe("agentConsoleStats", () => {
  it("counts statuses, distinct bound runtimes and the queue", () => {
    const stats = agentConsoleStats([
      row({ status: "working", running: 1, queued: 1 }),
      row({ agent: agent("a2"), status: "idle" }),
      row({ agent: agent("a3"), provider: "codex", status: "idle" }),
      row({
        agent: agent("a4"),
        provider: "unbound",
        status: "needs",
        needsReason: "unbound",
        queued: 2,
      }),
    ]);
    expect(stats).toEqual({
      all: 4,
      working: 1,
      idle: 2,
      needs: 1,
      queued: 3,
      runtimes: 2,
    });
  });
});

describe("task snapshots", () => {
  it("keeps only active tasks, running first", () => {
    const tasks = [
      task({ id: "queued", status: "queued", created_at: "2026-10-20T00:00:00Z" }),
      task({ id: "running", status: "running", started_at: "2026-10-20T01:00:00Z" }),
      task({ id: "done", status: "completed", completed_at: "2026-10-20T02:00:00Z" }),
    ];
    expect(activeTasks(tasks).map((item) => item.id)).toEqual(["running", "queued"]);
  });

  it("picks the newest terminal task by its latest timestamp", () => {
    const tasks = [
      task({ id: "old", completed_at: "2026-10-18T00:00:00Z" }),
      task({ id: "new", completed_at: "2026-10-21T00:00:00Z" }),
      task({ id: "running", status: "running", started_at: "2026-10-21T03:00:00Z" }),
    ];
    expect(latestTerminalTask(tasks)?.id).toBe("new");
  });
});

describe("providerMeta", () => {
  it("capitalizes unknown custom providers", () => {
    expect(providerMeta("myruntime")).toMatchObject({ label: "Myruntime", vendor: "MYRUNTIME" });
  });
});
