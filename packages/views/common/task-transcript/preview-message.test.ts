// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { TaskMessagePayload } from "@quickwork/core/types/events";

import { summarizeTaskMessage } from "./preview-message";

const msg = (over: Partial<TaskMessagePayload> & { type: TaskMessagePayload["type"] }): TaskMessagePayload => ({
  task_id: "t1",
  issue_id: "i1",
  seq: 1,
  ...over,
});

describe("summarizeTaskMessage (execution live feed lines)", () => {
  it("names the tool and its most readable input", () => {
    const line = summarizeTaskMessage(
      msg({ type: "tool_use", tool: "Bash", input: { command: "go test ./...", timeout: 120000 } }),
    );
    expect(line.kind).toBe("tool");
    expect(line.label).toBe("Bash");
    expect(line.detail).toBe("go test ./...");
  });

  it("falls back through common input keys, then any string", () => {
    expect(summarizeTaskMessage(msg({ type: "tool_use", tool: "Read", input: { file_path: "a/b.ts" } })).detail).toBe("a/b.ts");
    expect(summarizeTaskMessage(msg({ type: "tool_use", tool: "X", input: { note: "hello" } })).detail).toBe("hello");
    expect(summarizeTaskMessage(msg({ type: "tool_use", tool: "X", input: {} })).detail).toBe("");
  });

  it("flattens whitespace and caps the detail at a skim length", () => {
    const long = "line one\n\n   line two " + "x".repeat(400);
    const line = summarizeTaskMessage(msg({ type: "text", content: long }));
    expect(line.detail.startsWith("line one line two x")).toBe(true);
    expect(line.detail.length).toBe(160);
  });

  it("keeps prose, thinking, results and errors distinct", () => {
    expect(summarizeTaskMessage(msg({ type: "thinking", content: "why" })).kind).toBe("thinking");
    expect(summarizeTaskMessage(msg({ type: "tool_result", output: "ok" })).kind).toBe("result");
    expect(summarizeTaskMessage(msg({ type: "error", content: "boom" })).kind).toBe("error");
    expect(summarizeTaskMessage(msg({ type: "text", content: "hi" })).kind).toBe("text");
  });

  it("never throws on an unknown kind from a newer daemon", () => {
    const line = summarizeTaskMessage(msg({ type: "future_kind" as TaskMessagePayload["type"], content: "?" }));
    expect(line.kind).toBe("text");
  });
});
