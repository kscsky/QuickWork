import type { TaskMessagePayload } from "@quickwork/core/types/events";

/**
 * One compact line for the live run feed (执行实况): what kind of event it is,
 * a label (a tool's name, or nothing for prose), and a one-line detail.
 *
 * The full transcript dialog renders the rich form of the same events; this
 * is the skim view — it must stay lossy and cheap, and it must never throw on
 * a kind a newer daemon streams (unknown kinds fall back to prose).
 */
export interface TaskMessagePreview {
  kind: "text" | "thinking" | "tool" | "result" | "error";
  label: string;
  detail: string;
}

const MAX_DETAIL = 160;

function fromString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** The input keys worth surfacing, in the order they read best. */
const INPUT_KEYS = ["command", "file_path", "path", "pattern", "query", "url", "prompt", "description"] as const;

export function summarizeToolInput(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  for (const key of INPUT_KEYS) {
    const value = fromString(input[key]);
    if (value) return value;
  }
  for (const value of Object.values(input)) {
    const str = fromString(value);
    if (str) return str;
  }
  return "";
}

export function summarizeTaskMessage(message: TaskMessagePayload): TaskMessagePreview {
  const detail = (raw: string) => raw.replace(/\s+/g, " ").trim().slice(0, MAX_DETAIL);
  switch (message.type) {
    case "tool_use":
      return {
        kind: "tool",
        label: message.tool ?? "tool",
        detail: detail(summarizeToolInput(message.input)),
      };
    case "tool_result":
      return { kind: "result", label: "", detail: detail(message.output ?? message.content ?? "") };
    case "thinking":
      return { kind: "thinking", label: "", detail: detail(message.content ?? "") };
    case "error":
      return { kind: "error", label: "", detail: detail(message.content ?? "") };
    default:
      return { kind: "text", label: "", detail: detail(message.content ?? "") };
  }
}
