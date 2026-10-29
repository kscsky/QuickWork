"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { AgentTask } from "@quickwork/core/types";
import { ActorAvatar } from "../../common/actor-avatar";
import { formatDuration } from "../../agents/components/agent-activity-hover-content";
import { useLocale, useT } from "../../i18n";
import { RunLogDialog } from "./run-log-dialog";
import { useNow } from "./use-now";

function taskOutput(task: AgentTask): string {
  const result = task.result as { output?: unknown } | null;
  const output = typeof result?.output === "string" ? result.output.trim() : "";
  return output || task.error?.trim() || task.trigger_summary?.trim() || "";
}

export function RefreshRunLogCard({
  task,
  agentName,
}: {
  task: AgentTask;
  agentName: string;
}) {
  const { t } = useT("issues");
  const locale = useLocale();
  const [logOpen, setLogOpen] = useState(false);
  // Queued is not running: no process has picked the task up yet. Dispatched
  // is the claim handshake and reads as preparing; only `running` is a live
  // run with a process behind it.
  const queued =
    task.status === "queued" || task.status === "waiting_local_directory";
  const preparing = task.status === "dispatched";
  const running = task.status === "running";
  const live = running || preparing;
  const failed = task.status === "failed" || task.status === "cancelled";
  const now = useNow(live);
  const started = task.started_at ?? (queued ? task.created_at : task.dispatched_at ?? task.created_at);
  const duration = queued
    ? ""
    : started
      ? formatDuration(started, task.completed_at ? Date.parse(task.completed_at) : now)
      : "";
  const startedLabel = started
    ? new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(started))
    : "";
  const model = task.usage?.[0]?.model ?? "";
  const output = taskOutput(task);
  const status = failed
    ? t(($) => $.room.state_interrupted)
    : task.status === "completed"
      ? t(($) => $.room.state_done)
      : queued
        ? t(($) => $.room.state_waiting)
        : preparing
          ? t(($) => $.room.run_preparing)
          : running
            ? t(($) => $.room.chat_running)
            : t(($) => $.room.state_waiting);

  return (
    <>
      <div className="rd-runlog" data-failed={failed ? "" : undefined}>
        <div className="rd-runlog-head">
          <ActorAvatar
            actorType="agent"
            actorId={task.agent_id}
            size="md"
            profileLink={false}
            className="rd-runlog-ava"
          />
          <div className="rd-runlog-id">
            <div className="rd-runlog-title">
              <b>{agentName}</b>
              {model ? <span>{model}</span> : null}
            </div>
            <div className="rd-runlog-sub">
              {startedLabel}
              {duration ? ` · ${duration}` : ""}
            </div>
          </div>
          <span className="rd-runlog-state" data-live={live ? "" : undefined}>
            <i />
            {status}
          </span>
        </div>
        <div className="rd-runlog-body">
          <p>
            {output ||
              (queued
                ? t(($) => $.room.run_queued_waiting)
                : live
                  ? t(($) => $.room.run_live_waiting)
                  : t(($) => $.detail.execution_no_result))}
          </p>
          <div className="rd-runlog-meta">
            {model ? <span>{model}</span> : null}
            {duration ? <span>{duration}</span> : null}
            {task.attempt && task.attempt > 1 ? <span>#{task.attempt}</span> : null}
          </div>
        </div>
        <div className="rd-runlog-foot">
          <span>{startedLabel}</span>
          <button type="button" onClick={() => setLogOpen(true)}>
            {t(($) => $.detail.run_card_view_log)}
            <ExternalLink className="size-3" />
          </button>
        </div>
      </div>
      <RunLogDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        task={task}
        agentName={agentName}
      />
    </>
  );
}
