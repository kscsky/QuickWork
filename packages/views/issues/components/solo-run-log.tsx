"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { api } from "@quickwork/core/api";
import { issueKeys } from "@quickwork/core/issues/queries";
import type { AgentTask } from "@quickwork/core/types";
import { ActorAvatar } from "../../common/actor-avatar";
import { formatDuration } from "../../agents/components/agent-activity-hover-content";
import { useLocale, useT } from "../../i18n";
import { RunLogDialog } from "./run-log-dialog";
import { useNow } from "./use-now";

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

function taskOutput(task: AgentTask): string {
  const result = task.result as { output?: unknown } | null;
  return typeof result?.output === "string" ? result.output.trim() : "";
}

/**
 * The solo task's execution record, inline in the page.
 *
 * This is the old side-rail run strip, moved into the document and reduced to
 * one card: agent, outcome, duration and result excerpt. The full transcript
 * (tool calls, outputs, closing message) stays one click away.
 */
export function SoloRunLog({
  issueId,
  agentNameOf,
}: {
  issueId: string;
  agentNameOf: (agentId: string) => string;
}) {
  const { t } = useT("issues");
  const locale = useLocale();
  const { data: tasks = [] } = useQuery({
    queryKey: issueKeys.tasks(issueId),
    queryFn: () => api.listTasksByIssue(issueId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const latest = useMemo(() => {
    const active = tasks.find((task) => ACTIVE_STATUSES.has(task.status));
    return (
      active ??
      [...tasks]
        .filter((task) => !ACTIVE_STATUSES.has(task.status))
        .sort((a, b) => taskTime(b) - taskTime(a))[0] ??
      null
    );
  }, [tasks]);

  const [logOpen, setLogOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const active = latest ? ACTIVE_STATUSES.has(latest.status) : false;
  const terminal = latest
    ? latest.status === "completed" ||
      latest.status === "failed" ||
      latest.status === "cancelled"
    : false;
  const now = useNow(active);
  const startedIso = latest?.started_at ?? latest?.dispatched_at ?? null;
  const endMs = latest?.completed_at ? Date.parse(latest.completed_at) : now;
  const duration = startedIso ? formatDuration(startedIso, endMs) : "";
  const output = latest ? taskOutput(latest) : "";

  const timeLabel = useMemo(() => {
    if (!latest) return "";
    const formatter = new Intl.DateTimeFormat(locale, {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const from = startedIso ? formatter.format(new Date(startedIso)) : "";
    const to = latest.completed_at
      ? formatter.format(new Date(latest.completed_at))
      : "";
    return from && to ? `${from} → ${to}` : from || to;
  }, [latest, locale, startedIso]);

  const statusLabel = !latest
    ? t(($) => $.detail.run_card_empty)
    : latest.status === "completed"
      ? t(($) => $.room.state_done)
      : latest.status === "failed" || latest.status === "cancelled"
        ? t(($) => $.room.state_interrupted)
        : active && latest.status !== "queued" && latest.status !== "waiting_local_directory"
          ? t(($) => $.room.chat_running)
          : t(($) => $.room.state_waiting);

  return (
    <section className="qw-solo-exec" id="solo-execution">
      <div className="qw-solo-section-head">
        <h2 className="qw-solo-section-title">
          {t(($) => $.detail.execution_section)}
        </h2>
        <span className="qw-solo-section-count">
          {t(($) => $.detail.execution_runs, { count: tasks.length })}
        </span>
        <span className="qw-solo-spacer" />
        {latest ? (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-caption font-medium text-brand hover:underline"
            onClick={() => setLogOpen(true)}
          >
            {t(($) => $.detail.run_card_view_log)}
            <ExternalLink className="size-3" />
          </button>
        ) : null}
      </div>

      {latest ? (
        <div className="qw-solo-exec-card">
          <div className="qw-solo-exec-head">
            <ActorAvatar
              actorType="agent"
              actorId={latest.agent_id}
              size="lg"
              profileLink={false}
            />
            <div className="qw-solo-exec-who">
              <div className="nm">{agentNameOf(latest.agent_id)}</div>
              <div className="meta">
                {timeLabel}
                {timeLabel && duration ? " · " : ""}
                {duration}
              </div>
            </div>
            <span className="qw-solo-spacer" />
            <span
              className={`qw-solo-runstate ${
                latest.status === "completed"
                  ? "done"
                  : terminal
                    ? "wait"
                    : active
                      ? "run"
                      : "wait"
              }`}
            >
              <i className="dot" />
              {latest.status === "completed"
                ? t(($) => $.room.state_done)
                : terminal
                  ? t(($) => $.room.state_interrupted)
                  : statusLabel}
            </span>
          </div>
          <div className={`qw-solo-exec-result${expanded ? " is-expanded" : ""}`}>
            <span className="k">{t(($) => $.detail.execution_result)}</span>
            <div className="min-w-0">
              <p>
                {output || t(($) => $.detail.execution_no_result)}
              </p>
              {output.length > 120 ? (
                <button
                  type="button"
                  className="mt-1 inline-flex text-caption font-medium text-brand hover:underline"
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded
                    ? t(($) => $.detail.execution_collapse)
                    : t(($) => $.detail.execution_expand)}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <p className="qw-solo-exec-empty">{t(($) => $.detail.run_card_empty)}</p>
      )}

      {latest ? (
        <RunLogDialog
          open={logOpen}
          onOpenChange={setLogOpen}
          task={latest}
          agentName={agentNameOf(latest.agent_id)}
        />
      ) : null}
    </section>
  );
}
