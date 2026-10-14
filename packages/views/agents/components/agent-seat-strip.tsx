"use client";

import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import type { Agent, AgentRuntime } from "@quickwork/core/types";
import type { AgentPresenceDetail } from "@quickwork/core/agents";
import { Button } from "@quickwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@quickwork/ui/components/ui/dropdown-menu";
import { cn } from "@quickwork/ui/lib/utils";
import { AppLink } from "../../navigation";
import { ActorAvatar } from "../../common/actor-avatar";
import { useT, useTimeAgo } from "../../i18n";
import { CountUp } from "./count-up";
import { machineIdOf, machineShortLabel, runtimeHue } from "./machine-rail";

/**
 * The agent's 工位条 — the one-line seat that replaces the old hero. It carries
 * the machine's hue rail, the seat's identity (mono host + CLI family), the
 * live load (在跑/队列/容量) and the page's two actions; everything editable
 * lives in the module rack below it.
 */
export function AgentSeatStrip({
  agent,
  runtime,
  presence,
  backHref,
  backLabel,
  canAssign,
  onAssign,
  onArchive,
}: {
  agent: Agent;
  runtime: AgentRuntime | null;
  presence: AgentPresenceDetail | null;
  backHref: string;
  backLabel: string;
  canAssign: boolean;
  onAssign: () => void;
  /** Absent for QuickWork's built-in agents, which the server refuses to
   *  archive — the menu hides the action rather than offering a failure. */
  onArchive?: () => void;
}) {
  const { t } = useT("agents");
  const timeAgo = useTimeAgo();
  const isArchived = !!agent.archived_at;
  const bound = !!agent.runtime_id?.trim() || agent.runtime_bound !== false;
  const offline = !!runtime && runtime.status !== "online";
  const running = presence?.runningCount ?? 0;
  const queued = presence?.queuedCount ?? 0;
  const capacity = presence?.capacity ?? agent.max_concurrent_tasks;
  const hue = runtime ? runtimeHue(runtime) : null;

  // Same status language as the list: most specific state first.
  let tone: "ok" | "busy" | "off" | "none";
  let statusLabel: string;
  if (isArchived) {
    tone = "off";
    statusLabel = t(($) => $.row.archived);
  } else if (!bound) {
    tone = "none";
    statusLabel = t(($) => $.row.needs_runtime);
  } else if (offline) {
    tone = "off";
    statusLabel = t(($) => $.card.machine_offline);
  } else if (running > 0) {
    tone = "busy";
    statusLabel = t(($) => $.card.running);
  } else if (presence) {
    tone = "ok";
    statusLabel = t(($) => $.workload.idle);
  } else {
    tone = "off";
    statusLabel = "—";
  }

  const machineLine = runtime
    ? [machineIdOf(runtime), machineShortLabel(runtime)]
        .filter(Boolean)
        .join(" · ")
    : t(($) => $.rail.unbound);

  return (
    <header className="shrink-0 border-b bg-background px-4 pb-4 pt-3 sm:px-6">
      <div className="mx-auto max-w-[1440px]">
        <div className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
          <AppLink
            href={backHref}
            className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {backLabel}
          </AppLink>
          <span aria-hidden="true">/</span>
          <span className="truncate text-foreground">{agent.name}</span>
        </div>

        <div
          style={hue === null ? undefined : ({ "--mh": hue } as React.CSSProperties)}
          className={cn(
            "qw-mh relative mt-3 flex items-center gap-3.5 overflow-hidden rounded-[var(--radius)] border bg-surface px-4 py-3",
            "shadow-[var(--shadow-surface)]",
            (isArchived || !bound) && "border-dashed shadow-none",
          )}
        >
          {hue !== null && (
            <span
              aria-hidden="true"
              className="qw-seat-band pointer-events-none absolute inset-x-0 top-0 h-[3px]"
            />
          )}
          <span
            aria-hidden="true"
            className={cn(
              "absolute inset-y-0 left-0 w-[3px]",
              hue === null ? "bg-input" : "qw-seat-band qw-slide-rail",
            )}
          />
          <ActorAvatar
            actorType="agent"
            actorId={agent.id}
            size="xl"
            profileLink={false}
          />
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="min-w-0 truncate text-title font-semibold tracking-tight">
                {agent.name}
              </h1>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 text-caption whitespace-nowrap",
                  tone === "ok" && "qw-st-ok",
                  tone === "busy" && "text-inflight font-medium",
                  tone === "off" && "text-muted-foreground",
                  tone === "none" && "qw-st-none",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-2 shrink-0 rounded-[2px]",
                    tone === "ok" && "bg-success",
                    tone === "busy" && "bg-inflight qw-pulse",
                    tone === "off" && "bg-muted-foreground/40 qw-breathe",
                    tone === "none" && "bg-warning",
                  )}
                />
                {statusLabel}
              </span>
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-2 font-mono text-micro text-muted-foreground">
              <span className="truncate">{machineLine}</span>
              <span aria-hidden="true" className="shrink-0 text-faint-foreground">
                ·
              </span>
              <span className="shrink-0">
                {agent.model || t(($) => $.pickers.model_default)}
              </span>
              <span aria-hidden="true" className="shrink-0 text-faint-foreground">
                ·
              </span>
              <span className="shrink-0">
                {t(($) => $.detail.updated, { when: timeAgo(agent.updated_at) })}
              </span>
            </div>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-4">
            <span className="hidden items-start gap-4 md:flex">
              <Kpi label={t(($) => $.card.running)} value={running} hot={running > 0} />
              <Kpi label={t(($) => $.card.queued)} value={queued} />
              <Kpi label={t(($) => $.card.capacity)} value={capacity} />
            </span>
            {!isArchived && canAssign ? (
              <Button type="button" size="sm" onClick={onAssign}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t(($) => $.detail.assign_work)}
              </Button>
            ) : null}
            {!isArchived && onArchive ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon-sm" />}
                  aria-label={t(($) => $.detail.more_actions_aria)}
                >
                  <MoreHorizontal
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-auto">
                  <DropdownMenuItem variant="destructive" onClick={onArchive}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {t(($) => $.detail.more_archive)}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}

function Kpi({
  label,
  value,
  hot,
}: {
  label: string;
  value: number;
  hot?: boolean;
}) {
  return (
    <span className="text-micro tracking-normal text-muted-foreground">
      {label}
      <b
        className={cn(
          "block text-title-lg leading-none font-semibold tabular-nums",
          hot ? "text-inflight" : "text-foreground",
        )}
      >
        <CountUp value={value} />
      </b>
    </span>
  );
}
