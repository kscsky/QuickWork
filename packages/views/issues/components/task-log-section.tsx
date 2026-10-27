"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ListFilter } from "lucide-react";
import { api } from "@quickwork/core/api";
import { issueKeys } from "@quickwork/core/issues/queries";
import { cn } from "@quickwork/ui/lib/utils";

import { useLocale, useT } from "../../i18n";
import { formatDuration } from "./relay-chapters";

type LogKind = "run" | "sys";

interface LogRow {
  key: string;
  at: string | null;
  kind: LogKind;
  text: string;
}

const LOG_KIND_CLASS: Record<LogKind, string> = {
  run: "text-inflight",
  sys: "text-faint-foreground",
};

const ACTIVE_STATUSES = new Set([
  "queued",
  "dispatched",
  "running",
  "waiting_local_directory",
]);

/**
 * The solo task's log, using the squad task's log language: one vertical
 * timeline of real server timestamps, a kind column, and the same filters.
 * A solo task has no chain, so the rows are its creation plus every agent run.
 */
export function TaskLogSection({
  id,
  issueId,
  createdAt,
  agentNameOf,
}: {
  id?: string;
  issueId: string;
  createdAt: string;
  agentNameOf: (agentId: string) => string;
}) {
  const { t } = useT("issues");
  const locale = useLocale();
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState<LogKind | "all">("all");

  const { data: tasks = [] } = useQuery({
    queryKey: issueKeys.tasks(issueId),
    queryFn: () => api.listTasksByIssue(issueId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const rows = useMemo<LogRow[]>(() => {
    const out: LogRow[] = [
      {
        key: "created",
        at: createdAt,
        kind: "sys",
        text: t(($) => $.room.log_created_bare),
      },
    ];
    const ordered = [...tasks].sort((a, b) =>
      (a.started_at ?? a.dispatched_at ?? a.created_at).localeCompare(
        b.started_at ?? b.dispatched_at ?? b.created_at,
      ),
    );
    for (const task of ordered) {
      const from =
        task.started_at ?? task.dispatched_at ?? task.created_at ?? null;
      if (task.status === "completed" && task.completed_at && from) {
        out.push({
          key: `done-${task.id}`,
          at: task.completed_at,
          kind: "run",
          text: t(($) => $.room.log_run_done, {
            dur: formatDuration(
              new Date(task.completed_at).getTime() - new Date(from).getTime(),
            ),
          }),
        });
      } else if (
        task.status === "failed" ||
        task.status === "cancelled"
      ) {
        out.push({
          key: `failed-${task.id}`,
          at: task.completed_at ?? task.created_at,
          kind: "run",
          text: t(($) => $.room.log_run_failed, {
            agent: agentNameOf(task.agent_id),
          }),
        });
      } else if (from && ACTIVE_STATUSES.has(task.status)) {
        out.push({
          key: `active-${task.id}`,
          at: from,
          kind: "run",
          text: t(($) => $.room.log_run_active, {
            dur: formatDuration(Date.now() - new Date(from).getTime()),
          }),
        });
      }
    }
    return out.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  }, [tasks, createdAt, agentNameOf, t]);

  const shown = filter === "all" ? rows : rows.filter((row) => row.kind === filter);
  const kindLabels: Record<LogKind, string> = {
    run: t(($) => $.room.log_kind_run),
    sys: t(($) => $.room.log_kind_sys),
  };

  const timeLabel = (iso: string): string => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const now = new Date();
    const sameDay =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      ...(sameDay ? {} : { month: "numeric", day: "numeric" }),
    }).format(date);
  };

  return (
    <section
      id={id}
      className="overflow-hidden rounded-lg border border-surface-border bg-surface"
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 border-b border-border bg-muted/45 px-3.5 py-2.5 text-left text-caption font-semibold"
      >
        <ListFilter className="size-3.5 text-muted-foreground" />
        <span>{t(($) => $.execution_log.section)}</span>
        <span className="rounded-full bg-muted px-1.5 text-micro font-normal text-muted-foreground">
          {rows.length}
        </span>
        <span className="grow" />
        <ChevronDown
          className={cn(
            "size-3.5 text-muted-foreground transition-transform",
            !open && "-rotate-90",
          )}
        />
      </button>
      <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-2">
        {open
          ? (["all", "run", "sys"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={cn(
                  "rounded-full px-2 py-px font-mono text-micro transition-colors",
                  filter === key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {key === "all"
                  ? t(($) => $.room.log_filter_all)
                  : kindLabels[key]}
              </button>
            ))
          : null}
      </div>
      {open ? (
        <div>
          {shown.map((row) => (
            <div
              key={row.key}
              className="flex items-baseline gap-3 border-t border-border/60 px-3.5 py-2 text-caption"
            >
              <span className="w-14 shrink-0 font-mono text-micro text-faint-foreground">
                {row.at ? timeLabel(row.at) : ""}
              </span>
              <span
                className={cn(
                  "w-8 shrink-0 font-mono text-micro",
                  LOG_KIND_CLASS[row.kind],
                )}
              >
                {kindLabels[row.kind]}
              </span>
              <span className="min-w-0 flex-1">{row.text}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
