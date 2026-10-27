"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@quickwork/core/api";
import { issueKeys } from "@quickwork/core/issues/queries";
import type { AgentTask } from "@quickwork/core/types";
import { Button } from "@quickwork/ui/components/ui/button";
import { cn } from "@quickwork/ui/lib/utils";

import { ActorAvatar } from "../../common/actor-avatar";
import { formatDuration } from "../../agents/components/agent-activity-hover-content";
import { useT } from "../../i18n";
import { RailCard } from "./rail-card";
import { useStatusLabel } from "./task-run-labels";

const ACTIVE_STATUSES = new Set([
  "queued",
  "dispatched",
  "running",
  "waiting_local_directory",
]);

function taskTime(task: AgentTask): number {
  return (
    Date.parse(task.completed_at ?? task.started_at ?? task.created_at ?? "") ||
    0
  );
}

function statusTone(status: AgentTask["status"]): string {
  if (status === "completed") return "bg-success/15 text-success";
  if (status === "failed" || status === "cancelled") {
    return "bg-destructive/10 text-destructive";
  }
  if (ACTIVE_STATUSES.has(status)) return "bg-inflight-surface text-inflight";
  return "bg-muted text-faint-foreground";
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-muted/30 px-2 py-1.5">
      <div className="truncate font-mono text-body font-semibold leading-tight text-foreground">
        {value}
      </div>
      <div className="mt-0.5 truncate text-micro text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

/**
 * The rail's "current run" card: the one piece of live state people open a
 * task for. Reuses the same listTasksByIssue query as ExecutionLogSection, so
 * the two always name the same run and React Query serves it from one cache.
 */
export function TaskRunSummaryCard({
  issueId,
  agentNameOf,
  locale,
  onViewLog,
}: {
  issueId: string;
  agentNameOf: (agentId: string) => string;
  locale: string;
  onViewLog: () => void;
}) {
  const { t } = useT("issues");
  const { data: tasks = [] } = useQuery({
    queryKey: issueKeys.tasks(issueId),
    queryFn: () => api.listTasksByIssue(issueId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const active = tasks.find((task) => ACTIVE_STATUSES.has(task.status));
  const latest =
    active ??
    [...tasks]
      .filter((task) => !ACTIVE_STATUSES.has(task.status))
      .sort((a, b) => taskTime(b) - taskTime(a))[0];
  const statusLabel = useStatusLabel(latest?.status ?? "queued");

  const endMs = latest?.completed_at
    ? Date.parse(latest.completed_at)
    : Date.now();
  const duration =
    latest?.started_at && Number.isFinite(endMs)
      ? formatDuration(latest.started_at, endMs)
      : "";
  const lastTime = latest
    ? new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(taskTime(latest) || Date.now()))
    : "";

  return (
    <RailCard title={t(($) => $.detail.run_card_title)}>
      {!latest ? (
        <p className="text-caption text-muted-foreground">
          {t(($) => $.detail.run_card_empty)}
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2.5">
            <ActorAvatar
              actorType="agent"
              actorId={latest.agent_id}
              size="md"
              profileLink={false}
            />
            <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
              {agentNameOf(latest.agent_id)}
            </span>
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-micro font-medium",
                statusTone(latest.status),
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full bg-current",
                  ACTIVE_STATUSES.has(latest.status) && "animate-pulse",
                )}
              />
              {statusLabel}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Metric
              label={t(($) => $.detail.run_card_duration)}
              value={duration || t(($) => $.detail.run_card_waiting)}
            />
            <Metric
              label={t(($) => $.detail.run_card_runs)}
              value={String(tasks.length)}
            />
            <Metric
              label={t(($) => $.detail.run_card_last)}
              value={lastTime}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="mt-3 w-full justify-center"
            onClick={onViewLog}
          >
            {t(($) => $.detail.run_card_view_log)}
          </Button>
        </>
      )}
    </RailCard>
  );
}
