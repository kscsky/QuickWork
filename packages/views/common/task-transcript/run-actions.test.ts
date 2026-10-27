// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { TaskMessagePayload } from "@quickwork/core/types/events";

import {
  buildRunActions,
  formatTokensCompact,
  isRunActionFold,
  totalRunUsage,
  type RunActionFold,
} from "./run-actions";

const msg = (over: Partial<TaskMessagePayload> & { seq: number; type: TaskMessagePayload["type"] }): TaskMessagePayload => ({
  task_id: "t1",
  issue_id: "i1",
  created_at: `2026-10-19T10:00:${String(over.seq).padStart(2, "0")}Z`,
  ...over,
});

const usage = (input: number, output: number) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
});

describe("buildRunActions (行动流)", () => {
  it("pairs a command with the result that follows it", () => {
    const entries = buildRunActions([
      msg({ seq: 1, type: "tool_use", tool: "Bash", input: { command: "ls -la" } }),
      msg({ seq: 2, type: "tool_result", tool: "Bash", output: "a.txt\nb.txt" }),
    ]);
    expect(entries).toHaveLength(1);
    const row = entries[0]!;
    if (isRunActionFold(row)) throw new Error("unexpected fold");
    expect(row.kind).toBe("tool");
    expect(row.label).toBe("Bash");
    expect(row.detail).toBe("ls -la");
    expect(row.output).toContain("a.txt");
  });

  it("keeps prose and thinking distinct and carries the turn's usage on the closing row", () => {
    const entries = buildRunActions([
      msg({ seq: 1, type: "thinking", content: "先看上下文" }),
      msg({ seq: 2, type: "text", content: "范围先拆四块。", usage: usage(1200, 324) }),
    ]);
    expect(entries).toHaveLength(2);
    const [think, say] = entries;
    expect(think && !isRunActionFold(think) ? think.kind : null).toBe("think");
    if (!say || isRunActionFold(say)) throw new Error("expected a say row");
    expect(say.kind).toBe("say");
    expect(say.content).toBe("范围先拆四块。");
    expect(say.usage?.total).toBe(1524);
    expect(say.usage?.input).toBe(1200);
  });

  it("folds a run of more than three command rows, summing their usage", () => {
    const entries = buildRunActions([
      msg({ seq: 1, type: "tool_use", tool: "Bash", input: { command: "a" }, usage: usage(10, 5) }),
      msg({ seq: 2, type: "tool_result", output: "ok" }),
      msg({ seq: 3, type: "tool_use", tool: "Bash", input: { command: "b" } }),
      msg({ seq: 4, type: "tool_result", output: "ok" }),
      msg({ seq: 5, type: "tool_use", tool: "Bash", input: { command: "c" } }),
      msg({ seq: 6, type: "tool_use", tool: "Bash", input: { command: "d" }, usage: usage(20, 10) }),
      msg({ seq: 7, type: "text", content: "完事" }),
    ]);
    expect(entries).toHaveLength(2);
    const fold = entries[0] as RunActionFold;
    expect(fold.kind).toBe("fold");
    expect(fold.count).toBe(4);
    expect(fold.usage?.total).toBe(45);
    expect(isRunActionFold(entries[1]!)).toBe(false);
  });

  it("does not fold at the threshold", () => {
    const entries = buildRunActions([
      msg({ seq: 1, type: "tool_use", tool: "Read", input: { file_path: "a" } }),
      msg({ seq: 2, type: "tool_use", tool: "Read", input: { file_path: "b" } }),
      msg({ seq: 3, type: "tool_use", tool: "Read", input: { file_path: "c" } }),
    ]);
    expect(entries).toHaveLength(3);
    expect(entries.some(isRunActionFold)).toBe(false);
  });

  it("never renders a fake zero: usage-less turns leave no badge", () => {
    const entries = buildRunActions([
      msg({ seq: 1, type: "text", content: "hello", usage: usage(0, 0) }),
    ]);
    const row = entries[0]!;
    expect(row && !isRunActionFold(row) ? row.usage : "x").toBeUndefined();
  });

  it("totals every reported delta across folds and rows", () => {
    const entries = buildRunActions([
      msg({ seq: 1, type: "text", content: "a", usage: usage(100, 10) }),
      msg({ seq: 2, type: "tool_use", tool: "Bash", input: { command: "x" } }),
      msg({ seq: 3, type: "tool_use", tool: "Bash", input: { command: "y" } }),
      msg({ seq: 4, type: "tool_use", tool: "Bash", input: { command: "z" } }),
      msg({ seq: 5, type: "tool_use", tool: "Bash", input: { command: "w" }, usage: usage(200, 20) }),
    ]);
    expect(totalRunUsage(entries)?.total).toBe(330);
  });
});

describe("formatTokensCompact", () => {
  it("compacts like the rest of the usage surfaces", () => {
    expect(formatTokensCompact(324)).toBe("324");
    expect(formatTokensCompact(1524)).toBe("1.5k");
    expect(formatTokensCompact(12400)).toBe("12k");
    expect(formatTokensCompact(1_250_000)).toBe("1.3M");
  });
});
