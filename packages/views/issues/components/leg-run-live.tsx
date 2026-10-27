"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Brain, CircleAlert, ScrollText, Wrench } from "lucide-react";
import { taskMessagesOptions } from "@quickwork/core/chat/queries";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { runtimeListOptions } from "@quickwork/core/runtimes/queries";
import type { AgentTask } from "@quickwork/core/types";
import { cn } from "@quickwork/ui/lib/utils";

import { formatDuration } from "../../agents/components/agent-activity-hover-content";
import { summarizeTaskMessage } from "../../common/task-transcript/preview-message";
import { useT } from "../../i18n";
import { ProviderLogo } from "../../runtimes/components/provider-logo";
import { useNow } from "./use-now";
import { RunLogDialog } from "./run-log-dialog";

/**
 * 执行实况 — the live work log strip beside a leg's dialog.
 *
 * While the leg's agent run is in flight this answers, without opening
 * anything: which CLI is executing (Claude / Codex / …), for how long, and
 * what it is doing right now — the transcript tail streaming in through the
 * shared `task:message` cache (the same feed the full transcript dialog
 * renders). It is the leg's own interior, so only the holder ever sees it.
 *
 * Not started yet (queued / waiting on the holder's machine): the strip says
 * so and shows nothing else — there is no run to narrate.
 */

const KIND_ICON = {
  tool: Wrench,
  result: ScrollText,
  thinking: Brain,
  error: CircleAlert,
  text: ScrollText,
} as const;

export function LegRunLive({
  task,
  agentName,
  stepLabel,
}: {
  task: AgentTask;
  agentName: string;
  /** "第 1/3 棒" — passed through to the log dialog's subtitle. */
  stepLabel?: string;
}) {
  const { t } = useT("issues");
  const wsId = useWorkspaceId();
  const [logOpen, setLogOpen] = useState(false);
  const terminal = task.status === "completed" || task.status === "failed" || task.status === "cancelled";
  // `dispatched` is the claim handshake — the run is about to execute, so it
  // reads as running (same mapping as stepRunState).
  const executing = !terminal && task.status !== "queued" && task.status !== "waiting_local_directory";
  const queued = !terminal && !executing;
  const now = useNow(!terminal);
  const startedIso = task.started_at ?? task.dispatched_at ?? null;

  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));
  const provider = runtimes.find((runtime) => runtime.id === task.runtime_id)?.provider ?? "";
  const providerLabel = provider ? provider[0]!.toUpperCase() + provider.slice(1) : "";

  const { data: messages = [] } = useQuery(taskMessagesOptions(task.id));
  // A finished run keeps a shorter tail: the strip stays a glance, the full
  // story lives behind 完整日志.
  const tail = messages.slice(terminal ? -5 : -12);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tail.length]);

  return (
    <section className="overflow-hidden rounded-lg border border-surface-border bg-surface shadow-[var(--shadow-surface)]">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/45 px-3.5 py-2.5">
        {provider ? <ProviderLogo provider={provider} className="size-4 shrink-0" /> : null}
        <span className="text-caption font-semibold">
          {providerLabel || agentName}
        </span>
        {provider && providerLabel !== agentName ? (
          <span className="min-w-0 truncate text-micro text-faint-foreground">{agentName}</span>
        ) : null}
        <span className="grow" />
        {executing ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-micro text-inflight">
            <span className="size-1.5 animate-pulse rounded-full bg-inflight" aria-hidden="true" />
            {t(($) => $.room.chat_running)}
            {startedIso ? (
              <span className="font-mono text-muted-foreground">{formatDuration(startedIso, now)}</span>
            ) : null}
          </span>
        ) : queued ? (
          <span className="shrink-0 text-micro text-muted-foreground">
            {t(($) => $.room.state_waiting)}
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-micro text-muted-foreground">
            <span className={cn("size-1.5 rounded-full", task.status === "completed" ? "bg-success" : "bg-warning")} aria-hidden="true" />
            {task.status === "completed" ? t(($) => $.room.state_done) : t(($) => $.room.state_interrupted)}
            {startedIso ? (
              <span className="font-mono text-faint-foreground">
                {formatDuration(startedIso, new Date(task.completed_at ?? Date.now()).getTime())}
              </span>
            ) : null}
          </span>
        )}
        <button
          type="button"
          onClick={() => setLogOpen(true)}
          title={t(($) => $.room.run_live_full)}
          aria-label={t(($) => $.room.run_live_full)}
          className="grid size-6 shrink-0 place-items-center rounded-[5px] border border-surface-border bg-surface text-muted-foreground transition-colors hover:text-foreground"
        >
          <ScrollText className="size-3" />
        </button>
      </header>
      <RunLogDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        task={task}
        agentName={agentName}
        stepLabel={stepLabel}
      />
      <div ref={scroller} className="max-h-44 overflow-y-auto px-3 py-2">
        {tail.length === 0 ? (
          <p className="text-caption text-faint-foreground">{t(($) => $.room.run_live_waiting)}</p>
        ) : (
          <div className="flex flex-col gap-1">
            {tail.map((message) => {
              const preview = summarizeTaskMessage(message);
              const Icon = KIND_ICON[preview.kind];
              return (
                <div key={message.seq} className="flex min-w-0 items-start gap-1.5">
                  <Icon
                    className={cn(
                      "mt-0.5 size-3 shrink-0",
                      preview.kind === "error"
                        ? "text-destructive"
                        : preview.kind === "thinking"
                          ? "text-faint-foreground"
                          : "text-muted-foreground",
                    )}
                  />
                  <span
                    className={cn(
                      "min-w-0 truncate text-micro leading-relaxed",
                      preview.kind === "thinking" || preview.kind === "result"
                        ? "text-faint-foreground"
                        : "text-muted-foreground",
                      preview.kind === "error" && "text-destructive",
                    )}
                  >
                    {preview.label ? (
                      <span className="font-mono text-foreground">{preview.label}</span>
                    ) : null}
                    {preview.label && preview.detail ? " · " : null}
                    {preview.detail}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
