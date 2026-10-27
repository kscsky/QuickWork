"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Brain,
  CircleAlert,
  ChevronDown,
  ChevronRight,
  MessageSquareQuote,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import { taskMessagesOptions } from "@quickwork/core/chat/queries";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { runtimeListOptions } from "@quickwork/core/runtimes/queries";
import type { AgentTask } from "@quickwork/core/types";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@quickwork/ui/components/ui/dialog";
import { cn } from "@quickwork/ui/lib/utils";

import { formatDuration } from "../../agents/components/agent-activity-hover-content";
import { useT } from "../../i18n";
import { ProviderLogo } from "../../runtimes/components/provider-logo";
import {
  buildRunActions,
  formatTokensCompact,
  isRunActionFold,
  totalRunUsage,
  type RunActionEntry,
  type RunActionRow,
  type RunActionUsage,
} from "../../common/task-transcript/run-actions";

/**
 * 运行日志 — the 行动流 view of one agent run.
 *
 * One row per action, in the person's terms: what it read, what it ran (with
 * the command and a peek at its output), what it said, and — when the daemon
 * reported per-turn usage — what that step cost in tokens. Consecutive small
 * commands fold into one line; the fold opens in place. This replaces the
 * raw-event transcript on the relay leg's 完整日志 entry.
 */

const ROW_ICON: Record<RunActionRow["kind"], typeof Wrench> = {
  say: MessageSquareQuote,
  think: Brain,
  tool: TerminalSquare,
  result: TerminalSquare,
  error: CircleAlert,
};

function offsetLabel(startIso: string | null, atIso: string | undefined): string {
  if (!startIso || !atIso) return "";
  const start = new Date(startIso).getTime();
  const at = new Date(atIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(at) || at < start) return "";
  const sec = Math.round((at - start) / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function TokenBadge({ usage }: { usage: RunActionUsage }) {
  const { t } = useT("issues");
  return (
    <span
      className="shrink-0 rounded-[3px] bg-muted px-1.5 py-px font-mono text-micro text-faint-foreground"
      title={t(($) => $.room.run_log_token_detail, {
        input: formatTokensCompact(usage.input),
        output: formatTokensCompact(usage.output),
        cache: formatTokensCompact(usage.cacheRead),
      })}
    >
      {t(($) => $.room.run_log_tokens, { n: formatTokensCompact(usage.total) })}
    </span>
  );
}

function ActionRow({
  row,
  startIso,
}: {
  row: RunActionRow;
  startIso: string | null;
}) {
  const Icon = ROW_ICON[row.kind];
  const time = offsetLabel(startIso, row.at);
  return (
    <div className="grid grid-cols-[44px_20px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/40">
      <span className="pt-0.5 text-right font-mono text-micro text-faint-foreground">{time}</span>
      <span
        className={cn(
          "mt-0.5 grid size-5 place-items-center rounded-[5px] border",
          row.kind === "say" && "border-brand/35 bg-brand/5 text-brand",
          row.kind === "think" && "border-border text-muted-foreground",
          (row.kind === "tool" || row.kind === "result") && "border-border text-muted-foreground",
          row.kind === "error" && "border-destructive/40 bg-destructive/5 text-destructive",
        )}
      >
        <Icon className="size-3" />
      </span>
      <div className="min-w-0">
        {row.kind === "say" ? (
          <div className="whitespace-pre-wrap border-l-2 border-brand/40 bg-brand/5 px-2.5 py-1.5 text-caption leading-relaxed">
            {row.content}
          </div>
        ) : row.kind === "think" ? (
          <div className="whitespace-pre-wrap px-1 text-caption italic leading-relaxed text-muted-foreground">
            {row.content}
          </div>
        ) : row.kind === "error" ? (
          <div className="whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 font-mono text-micro leading-relaxed text-destructive">
            {row.content}
          </div>
        ) : (
          <>
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-mono text-micro font-semibold text-foreground">{row.label}</span>
              {row.detail ? (
                <span className="min-w-0 truncate font-mono text-micro text-muted-foreground">
                  {row.detail}
                </span>
              ) : null}
            </div>
            {row.output ? (
              <div className="mt-1 max-h-24 overflow-hidden whitespace-pre-wrap rounded-[4px] border border-border bg-foreground/[0.035] px-2 py-1 font-mono text-micro leading-relaxed text-muted-foreground">
                {row.output}
              </div>
            ) : null}
          </>
        )}
      </div>
      {row.usage ? <TokenBadge usage={row.usage} /> : <span />}
    </div>
  );
}

function FoldEntry({
  entry,
  startIso,
}: {
  entry: Extract<RunActionEntry, { kind: "fold" }>;
  startIso: string | null;
}) {
  const { t } = useT("issues");
  const [open, setOpen] = useState(false);
  const preview = entry.rows
    .map((row) => row.detail || row.label)
    .filter(Boolean)
    .slice(0, 4)
    .join(" · ");
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-muted/40"
      >
        {open ? (
          <ChevronDown className="size-3 shrink-0 text-faint-foreground" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-faint-foreground" />
        )}
        <span className="shrink-0 rounded-[3px] bg-muted px-1.5 py-px font-mono text-micro text-muted-foreground">
          {t(($) => $.room.run_log_fold, { count: entry.count })}
        </span>
        <span className="min-w-0 truncate font-mono text-micro text-faint-foreground">{preview}</span>
        <span className="grow" />
        {entry.usage ? <TokenBadge usage={entry.usage} /> : null}
      </button>
      {open ? (
        <div className="mt-0.5 border-l border-dashed border-border pl-2">
          {entry.rows.map((row) => (
            <ActionRow key={row.id} row={row} startIso={startIso} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function RunLogDialog({
  open,
  onOpenChange,
  task,
  agentName,
  stepLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: AgentTask;
  agentName: string;
  /** "第 1/3 棒" — names the leg this run belongs to. */
  stepLabel?: string;
}) {
  const { t } = useT("issues");
  const wsId = useWorkspaceId();
  const running = task.status !== "completed" && task.status !== "failed" && task.status !== "cancelled";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open || !running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open, running]);

  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));
  const provider = runtimes.find((runtime) => runtime.id === task.runtime_id)?.provider ?? "";
  const providerLabel = provider ? provider[0]!.toUpperCase() + provider.slice(1) : "";

  const { data: messages = [] } = useQuery({ ...taskMessagesOptions(task.id), enabled: open });
  const entries = buildRunActions(messages);
  const usage = totalRunUsage(entries);
  const commandCount = entries.reduce(
    (sum, entry) => sum + (isRunActionFold(entry) ? entry.count : entry.kind === "tool" ? 1 : 0),
    0,
  );
  const startedIso = task.started_at ?? task.dispatched_at ?? null;
  const elapsed = startedIso
    ? formatDuration(startedIso, running ? now : new Date(task.completed_at ?? Date.now()).getTime())
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[82vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[860px]">
        <header className="flex flex-wrap items-center gap-2.5 border-b border-border px-5 py-3.5 pr-12">
          {provider ? <ProviderLogo provider={provider} className="size-5 shrink-0" /> : null}
          <div className="flex min-w-0 flex-col leading-tight">
            <DialogTitle className="truncate text-body font-semibold">
              {t(($) => $.room.run_log_title)}
            </DialogTitle>
            <DialogDescription className="truncate text-micro text-faint-foreground">
              {[providerLabel || agentName, agentName, stepLabel].filter(Boolean).join(" · ")}
            </DialogDescription>
          </div>
          <span className="grow" />
          {running ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-micro text-inflight">
              <span className="size-1.5 animate-pulse rounded-full bg-inflight" aria-hidden="true" />
              {t(($) => $.room.chat_running)}
              {elapsed ? <span className="font-mono text-muted-foreground">{elapsed}</span> : null}
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-micro text-muted-foreground">
              {elapsed ? <span className="font-mono">{elapsed}</span> : null}
              {usage ? (
                <span className="rounded-[3px] bg-muted px-1.5 py-px font-mono text-micro text-muted-foreground">
                  {formatTokensCompact(usage.total)} tok
                </span>
              ) : null}
            </span>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
          {entries.length === 0 ? (
            <p className="px-2 py-6 text-center text-caption text-faint-foreground">
              {t(($) => $.room.run_live_waiting)}
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {entries.map((entry) =>
                isRunActionFold(entry) ? (
                  <FoldEntry key={entry.id} entry={entry} startIso={startedIso} />
                ) : (
                  <ActionRow key={entry.id} row={entry} startIso={startedIso} />
                ),
              )}
            </div>
          )}
        </div>
        <footer className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/30 px-5 py-2 text-micro text-muted-foreground">
          <span>{t(($) => $.room.run_log_actions, { count: entries.length })}</span>
          <span aria-hidden="true">·</span>
          <span>{t(($) => $.room.run_log_commands, { count: commandCount })}</span>
          {usage ? (
            <>
              <span aria-hidden="true">·</span>
              <span>
                {t(($) => $.room.run_log_total_tokens, { n: formatTokensCompact(usage.total) })}
              </span>
            </>
          ) : null}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
