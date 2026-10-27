import type { TaskMessagePayload, TaskMessageUsage } from "@quickwork/core/types/events";

import { summarizeToolInput } from "./preview-message";

/**
 * The 行动流: a run's event stream translated into readable actions.
 *
 * The transcript's raw rows are developer-shaped (tool_use / tool_result /
 * text …). This builder turns them into what the person reviewing the leg
 * actually asks: what did it read, what did it run, what did it write — with
 * consecutive small commands folded so the story stays scannable. Pure and
 * lossless: every row keeps its message seq as identity and its token delta
 * when the daemon reported one.
 */

export type RunActionKind = "say" | "think" | "tool" | "result" | "error";

/** One assistant turn's cost, shaped for display. */
export interface RunActionUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** input + output — the fresh tokens this step cost. */
  total: number;
}

export interface RunActionRow {
  /** "fold" is the fold entry's own kind; a row's kind is an action. */
  kind: RunActionKind;
  /** Stable within the run: "m" + message seq. */
  id: string;
  /** The message's server timestamp (ISO), when it has one. */
  at?: string;
  /** Tool name for tool rows; empty for prose. */
  label: string;
  /** One-line summary: the tool's most readable input, or the prose head. */
  detail: string;
  /** Full text for say/think/error rows. */
  content?: string;
  /** Paired tool_result output, when one followed. */
  output?: string;
  usage?: RunActionUsage;
}

export interface RunActionFold {
  kind: "fold";
  id: string;
  count: number;
  rows: RunActionRow[];
  usage?: RunActionUsage;
}

export type RunActionEntry = RunActionRow | RunActionFold;

export function isRunActionFold(entry: RunActionEntry): entry is RunActionFold {
  return entry.kind === "fold";
}

/** Consecutive command rows longer than this fold into one line. */
export const RUN_ACTION_FOLD_THRESHOLD = 3;

function toUsage(usage: TaskMessageUsage | undefined): RunActionUsage | undefined {
  if (!usage) return undefined;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_tokens ?? 0;
  const cacheWrite = usage.cache_write_tokens ?? 0;
  if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) return undefined;
  return { input, output, cacheRead, cacheWrite, total: input + output };
}

function mergeUsage(
  base: RunActionUsage | undefined,
  extra: RunActionUsage | undefined,
): RunActionUsage | undefined {
  if (!base) return extra;
  if (!extra) return base;
  return {
    input: base.input + extra.input,
    output: base.output + extra.output,
    cacheRead: base.cacheRead + extra.cacheRead,
    cacheWrite: base.cacheWrite + extra.cacheWrite,
    total: base.total + extra.total,
  };
}

/** "Bash · npm test" style prose head; lossy on purpose. */
function proseHead(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 120);
}

export function buildRunActions(
  messages: readonly TaskMessagePayload[],
): RunActionEntry[] {
  const rows: RunActionRow[] = [];
  let lastTool: RunActionRow | null = null;

  for (const message of [...messages].sort((a, b) => a.seq - b.seq)) {
    const usage = toUsage(message.usage);
    switch (message.type) {
      case "tool_use": {
        const row: RunActionRow = {
          kind: "tool",
          id: `m${message.seq}`,
          at: message.created_at,
          label: message.tool ?? "tool",
          detail: summarizeToolInput(message.input),
          usage,
        };
        rows.push(row);
        lastTool = row;
        break;
      }
      case "tool_result": {
        const output = message.output ?? message.content ?? "";
        if (lastTool && lastTool.output === undefined) {
          // The command and its result read as one action.
          lastTool.output = output;
          lastTool.usage = mergeUsage(lastTool.usage, usage);
        } else {
          rows.push({
            kind: "result",
            id: `m${message.seq}`,
            at: message.created_at,
            label: "",
            detail: "",
            output,
            usage,
          });
        }
        break;
      }
      case "thinking":
        rows.push({
          kind: "think",
          id: `m${message.seq}`,
          at: message.created_at,
          label: "",
          detail: proseHead(message.content ?? ""),
          content: message.content ?? "",
          usage,
        });
        break;
      case "error":
        rows.push({
          kind: "error",
          id: `m${message.seq}`,
          at: message.created_at,
          label: "",
          detail: proseHead(message.content ?? ""),
          content: message.content ?? "",
          usage,
        });
        break;
      default:
        rows.push({
          kind: "say",
          id: `m${message.seq}`,
          at: message.created_at,
          label: "",
          detail: proseHead(message.content ?? ""),
          content: message.content ?? "",
          usage,
        });
        break;
    }
  }

  return foldCommandRuns(rows);
}

/** Fold consecutive command rows so a burst of small commands stays one line. */
function foldCommandRuns(rows: RunActionRow[]): RunActionEntry[] {
  const out: RunActionEntry[] = [];
  let run: RunActionRow[] = [];
  const flushRun = () => {
    if (run.length === 0) return;
    if (run.length > RUN_ACTION_FOLD_THRESHOLD) {
      const usage = run.reduce<RunActionUsage | undefined>(
        (acc, row) => mergeUsage(acc, row.usage),
        undefined,
      );
      out.push({ kind: "fold", id: `fold-${run[0]!.id}`, count: run.length, rows: [...run], usage });
    } else {
      out.push(...run);
    }
    run = [];
  };
  for (const row of rows) {
    if (row.kind === "tool" || row.kind === "result") {
      run.push(row);
    } else {
      flushRun();
      out.push(row);
    }
  }
  flushRun();
  return out;
}

/** Sum of every reported turn delta — the run's fresh-token total. */
export function totalRunUsage(entries: readonly RunActionEntry[]): RunActionUsage | undefined {
  const all: RunActionRow[] = [];
  for (const entry of entries) {
    if (isRunActionFold(entry)) all.push(...entry.rows);
    else all.push(entry);
  }
  return all.reduce<RunActionUsage | undefined>(
    (acc, row) => mergeUsage(acc, row.usage),
    undefined,
  );
}

/** "12.4k" style compact number for token badges. */
export function formatTokensCompact(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) {
    const k = count / 1000;
    return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
  }
  return `${Math.round((count / 1_000_000) * 10) / 10}M`;
}
