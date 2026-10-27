"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, FileText, Layers, ListFilter } from "lucide-react";
import type { AgentTask, Attachment, IssueChain, IssueChainStep } from "@quickwork/core/types";
import { cn } from "@quickwork/ui/lib/utils";

import { ActorAvatar } from "../../common/actor-avatar";
import { useLocale, useT } from "../../i18n";
import {
  chainStateKey,
  legRunTasks,
  stepRunState,
  type RelayView,
} from "./chain-run-state";
import { HandoffFileChip } from "./relay-leg-rail";
import { ChainStateTag } from "./squad-room";

/**
 * The squad task's page, Jira-shaped: one task is created and splits into one
 * subtask per person, in a fixed order. The parent page is the flow at a
 * glance — a fixed-flow rail and the subtask list — and every subtask opens
 * its own page where ONLY that person's conversation and outputs live. The
 * old chapter-stack mixing everyone into one stream is gone; per-leg
 * isolation is now structural, not visual.
 *
 * `doing` legs run on the holder's own environment, so the run-state overlay
 * (stepRunState) still decides "waiting for pickup" vs "running on their
 * machine" everywhere these rows surface.
 */

/** A person's seat with the brand's status lamp — the relay's own vocabulary. */
export function SeatMark({
  userId,
  state,
  size = "md",
}: {
  userId: string;
  state: string;
  size?: "sm" | "md";
}) {
  const key = chainStateKey(state);
  const lamp: Record<string, string> = {
    done: "bg-success",
    doing: "bg-inflight",
    reviewing: "bg-brand",
    parked: "bg-warning",
  };
  return (
    <span className="relative inline-flex shrink-0">
      <ActorAvatar actorType="member" actorId={userId} size={size} profileLink={false} />
      <span
        className={cn(
          "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-[3px] ring-2 ring-background",
          lamp[key] ?? "bg-muted-foreground/40",
        )}
      />
    </span>
  );
}

/** "2h40m" / "12m" / "38s" — how long a run (or a leg's runs together) took. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h${rest}m` : `${hours}h`;
}

/**
 * The parent page's one-line position under the title: this is a squad task
 * that has already been split, and how many runs it has taken so far. The
 * people and their order live on the flow rail below — repeating them here
 * would say everything twice.
 */
export function RelayMetaRow({
  subtaskCount,
  createdLabel,
  runsCount,
}: {
  subtaskCount: number;
  createdLabel: string;
  runsCount: number;
}) {
  const { t } = useT("issues");
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
      <span>{t(($) => $.room.subtasks_count, { count: subtaskCount })}</span>
      <span aria-hidden="true" className="text-border">
        |
      </span>
      <span>{t(($) => $.room.meta_created, { when: createdLabel })}</span>
      {runsCount > 0 ? (
        <>
          <span aria-hidden="true" className="text-border">
            |
          </span>
          <span>{t(($) => $.room.meta_runs, { count: runsCount })}</span>
        </>
      ) : null}
    </div>
  );
}

/**
 * The fixed flow: the people, in the order the relay was authored in, with
 * where each one stands. This is the parent page's map of the whole task —
 * the order is fixed at creation and never re-derived from what happened.
 */
export function RelayFlowRail({
  chain,
  view,
  issueId,
  tasks = [],
  nameOf,
  identifier,
}: {
  chain: IssueChain;
  view: RelayView;
  issueId: string;
  tasks?: readonly AgentTask[];
  nameOf: (userId: string) => string;
  /** Parent identifier; the chain chip reads KSCS-10-1 → -2 → …. */
  identifier?: string;
}) {
  const { t } = useT("issues");
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-1 gap-y-2 rounded-lg border border-surface-border bg-surface px-3.5 py-2.5 shadow-[var(--shadow-surface)]">
      <span className="mr-2 inline-flex shrink-0 items-center gap-1.5 font-mono text-micro text-faint-foreground">
        <Layers className="size-3" />
        {t(($) => $.room.flow_fixed)}
      </span>
      {chain.steps.map((step, i) => {
        const key = chainStateKey(step.state);
        const runState = stepRunState(issueId, step, tasks);
        const isActive = i === view.activeIndex;
        const agentless = !step.agent_id && key === "pending";
        return (
          <span key={step.id} className="flex shrink-0 items-center">
            {i > 0 ? (
              <span
                aria-hidden="true"
                className={cn(
                  "mx-2.5 block h-0.5 w-8 rounded-full",
                  (chainStateKey(chain.steps[i - 1]!.state) === "done" ||
                    chainStateKey(chain.steps[i - 1]!.state) === "skipped") &&
                    "bg-success",
                )}
                style={
                  chainStateKey(chain.steps[i - 1]!.state) === "done" ||
                  chainStateKey(chain.steps[i - 1]!.state) === "skipped"
                    ? undefined
                    : {
                        backgroundImage:
                          "repeating-linear-gradient(90deg, var(--input) 0 6px, transparent 6px 12px)",
                      }
                }
              />
            ) : null}
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-md px-1 py-0.5",
                isActive && "border border-brand bg-surface",
              )}
            >
              <SeatMark userId={step.holder_user_id} state={step.state} size="sm" />
              <span className="text-caption font-medium">
                {nameOf(step.holder_user_id)}
              </span>
            </span>
            {key === "done" ? (
              <span className="ml-1.5 shrink-0 rounded-full bg-success/15 px-1.5 py-px text-micro whitespace-nowrap text-success">
                {t(($) => $.room.flow_done)}
              </span>
            ) : (
              <span className="ml-1.5">
                <ChainStateTag state={step.state} runState={runState} />
              </span>
            )}
            {agentless ? (
              <span className="ml-1.5 shrink-0 rounded-full bg-warning/20 px-1.5 py-px text-micro whitespace-nowrap text-warning">
                {t(($) => $.room.flow_no_agent)}
              </span>
            ) : null}
          </span>
        );
      })}
      <span className="grow" />
      {identifier ? (
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-px font-mono text-micro text-muted-foreground">
          {identifier}-1
          {chain.steps.slice(1).map((step) => ` → -${step.position + 1}`).join("")}
        </span>
      ) : null}
    </div>
  );
}

/** The one right-hand cell: when it finished, or what it is doing right now. */
function SubtaskTimeCell({
  step,
  runState,
  formatTime,
}: {
  step: IssueChainStep;
  runState: ReturnType<typeof stepRunState>;
  formatTime: (iso: string) => string;
}) {
  const { t } = useT("issues");
  const key = chainStateKey(step.state);
  if (step.completed_at) {
    return (
      <span className="font-mono text-micro text-faint-foreground">
        {formatTime(step.completed_at)}
      </span>
    );
  }
  if (key === "parked") {
    return (
      <span className="font-mono text-micro text-warning">
        {t(($) => $.room.flow_no_agent)}
      </span>
    );
  }
  if (key === "pending") {
    return <span className="font-mono text-micro text-faint-foreground">—</span>;
  }
  if (runState === "running") {
    return (
      <span className="font-mono text-micro text-inflight">
        {t(($) => $.room.chat_running)} →
      </span>
    );
  }
  if (runState === "queued") {
    return (
      <span className="font-mono text-micro text-faint-foreground">
        {t(($) => $.room.state_waiting)}
      </span>
    );
  }
  return <span className="font-mono text-micro text-faint-foreground">—</span>;
}

/**
 * The parent page's subtask list: one row per leg — 编号 / 摘要 / 负责人 /
 * 状态 / 产出数 / 时间. Clicking a row opens that leg's own page. The row the
 * relay is sitting on is tinted, so "轮到谁" survives a glance.
 */
export function SubtaskList({
  chain,
  view,
  issueId,
  tasks,
  nameOf,
  identifier,
  formatTime,
  onOpenLeg,
}: {
  chain: IssueChain;
  view: RelayView;
  issueId: string;
  tasks: readonly AgentTask[];
  nameOf: (userId: string) => string;
  /** Parent identifier; each row's id reads `${identifier}-${seq}`. */
  identifier: string;
  formatTime: (iso: string) => string;
  /** Called with the leg's seq (position + 1). */
  onOpenLeg: (seq: number) => void;
}) {
  const { t } = useT("issues");
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-surface-border bg-surface shadow-[var(--shadow-surface)]">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/45 px-3.5 py-2.5 text-caption font-semibold">
        <Layers className="size-3.5 text-muted-foreground" />
        <span>{t(($) => $.room.subtasks_section)}</span>
        <span className="rounded-full bg-muted px-1.5 text-micro font-normal text-muted-foreground">
          {chain.steps.length}
        </span>
        <span className="hidden rounded-full bg-brand/10 px-1.5 py-px font-mono text-micro font-normal whitespace-nowrap text-brand sm:inline">
          {t(($) => $.room.subtasks_generated)}
        </span>
        <span className="grow" />
        <span className="text-micro font-normal text-faint-foreground">
          {t(($) => $.room.subtasks_hint)}
        </span>
      </header>
      <div>
        {chain.steps.map((step) => {
          const key = chainStateKey(step.state);
          const runState = stepRunState(issueId, step, tasks);
          const mine = !!view.currentUserId && step.holder_user_id === view.currentUserId;
          const isActive = view.activeStep?.id === step.id;
          const files = step.handoff?.files.length ?? 0;
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => onOpenLeg(step.position + 1)}
              className={cn(
                "grid w-full grid-cols-[84px_minmax(0,1.4fr)_140px_116px_96px_96px] items-center gap-x-3 px-3.5 py-2.5 text-left text-caption transition-colors",
                "border-t border-border/60 first:border-t-0 hover:bg-muted/40",
                isActive && "bg-brand/5 shadow-[inset_3px_0_0_var(--color-brand)]",
              )}
            >
              <span className="truncate font-mono text-micro text-muted-foreground">
                {identifier}-{step.position + 1}
              </span>
              <span className="min-w-0 truncate text-body font-medium">
                {step.title || t(($) => $.room.chapter_leg_bare, { seq: step.position + 1 })}
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                <SeatMark userId={step.holder_user_id} state={step.state} size="sm" />
                <span className="min-w-0 truncate">
                  {nameOf(step.holder_user_id)}
                  {mine ? <span className="text-faint-foreground"> · 我</span> : null}
                </span>
              </span>
              <span className="min-w-0">
                {key === "done" ? (
                  <span className="rounded-full bg-success/15 px-1.5 py-px text-micro whitespace-nowrap text-success">
                    {t(($) => $.room.flow_done)}
                  </span>
                ) : (
                  <ChainStateTag state={step.state} runState={runState} />
                )}
              </span>
              <span className="flex min-w-0 items-center gap-1.5 font-mono text-micro text-muted-foreground">
                {files > 0 ? (
                  <>
                    <FileText className="size-3" />
                    {t(($) => $.room.files_count, { count: files })}
                  </>
                ) : step.leg_comment_count ? (
                  // No package yet — the counts are the honest minimum about a
                  // leg whose interior this reader cannot open.
                  <span className="truncate text-faint-foreground">
                    {t(($) => $.room.talks_count, { count: step.leg_comment_count })}
                  </span>
                ) : (
                  <span className="text-faint-foreground">—</span>
                )}
              </span>
              <SubtaskTimeCell step={step} runState={runState} formatTime={formatTime} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

type LogKind = "sys" | "run" | "handoff" | "talk";

interface LogRow {
  key: string;
  at: string | null;
  kind: LogKind;
  text: ReactNode;
  extra?: ReactNode;
}

const LOG_KIND_CLASS: Record<LogKind, string> = {
  handoff: "text-success",
  run: "text-inflight",
  talk: "text-brand",
  sys: "text-faint-foreground",
};

/**
 * The whole relay's record, at the bottom of the page where a log belongs —
 * collapsed until asked for. Every row is a real server timestamp (task and
 * step transitions, run start/finish, approvals); comment counts are the one
 * row that carries no clock, because the chain deliberately exposes counts,
 * not the private timeline behind them.
 */
export function RelayLogSection({
  chain,
  issueId,
  tasks,
  nameOf,
  agentNameOf,
  createdAt,
  currentUserId,
  squadName,
  attachmentOf,
  action,
}: {
  chain: IssueChain;
  issueId: string;
  tasks: readonly AgentTask[];
  nameOf: (userId: string) => string;
  agentNameOf: (agentId: string) => string;
  createdAt: string;
  currentUserId?: string;
  squadName?: string;
  /** Resolves handoff files to their attachment records (view/edit/download). */
  attachmentOf?: (id: string) => Attachment | undefined;
  /** Rendered on the right of the header (the subscribe control). */
  action?: ReactNode;
}) {
  const { t } = useT("issues");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<LogKind | "all">("all");

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

  const rows = useMemo<LogRow[]>(() => {
    const out: LogRow[] = [];
    out.push({
      key: "created",
      at: createdAt,
      kind: "sys",
      text: squadName
        ? t(($) => $.room.log_created, { squad: squadName })
        : t(($) => $.room.log_created_bare),
    });
    for (const step of chain.steps) {
      const name = nameOf(step.holder_user_id);
      const mine = !!currentUserId && step.holder_user_id === currentUserId;
      const runs = legRunTasks(issueId, step, tasks)
        .slice()
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      if (step.started_at) {
        out.push({
          key: `start-${step.id}`,
          at: step.started_at,
          kind: "sys",
          text: t(($) => $.room.log_leg_start, { name, seq: step.position + 1 }),
        });
      }
      for (const task of runs) {
        const agentName = agentNameOf(task.agent_id);
        const from = task.started_at ?? task.dispatched_at;
        if (task.completed_at) {
          out.push({
            key: `run-done-${task.id}`,
            at: task.completed_at,
            kind: "run",
            text: t(($) => $.room.log_run_done, {
              agent: agentName,
              dur: formatDuration(
                new Date(task.completed_at).getTime() -
                  new Date(from ?? task.created_at).getTime(),
              ),
            }),
          });
        } else if (task.status === "failed" || task.status === "cancelled") {
          out.push({
            key: `run-failed-${task.id}`,
            at: task.created_at,
            kind: "run",
            text: t(($) => $.room.log_run_failed, { agent: agentName }),
          });
        } else if (from) {
          out.push({
            key: `run-active-${task.id}`,
            at: from,
            kind: "run",
            text: t(($) => $.room.log_run_active, {
              agent: agentName,
              dur: formatDuration(Date.now() - new Date(from).getTime()),
            }),
          });
        }
      }
      if (step.completed_at) {
        const next = chain.steps[step.position + 1];
        out.push({
          key: `approved-${step.id}`,
          at: step.completed_at,
          kind: "handoff",
          text: next
            ? t(($) => $.room.log_approved, { name })
            : t(($) => $.room.log_finished, { name }),
          extra: step.handoff?.files.length ? (
            <>
              {step.handoff.files.map((file, i) => (
                <HandoffFileChip
                  key={`${file.name}-${i}`}
                  file={file}
                  attachment={
                    file.attachment_id
                      ? attachmentOf?.(file.attachment_id)
                      : undefined
                  }
                />
              ))}
            </>
          ) : undefined,
        });
      }
      const commentCount = step.leg_comment_count ?? 0;
      if (commentCount > 0) {
        out.push({
          key: `talk-${step.id}`,
          at: null,
          kind: "talk",
          text: t(($) => $.room.log_leg_talk, {
            seq: step.position + 1,
            count: commentCount,
          }),
          extra: mine ? undefined : (
            <span className="font-mono text-micro text-faint-foreground">
              {t(($) => $.room.log_private)}
            </span>
          ),
        });
      }
    }
    return out;
  }, [chain, issueId, tasks, currentUserId, nameOf, agentNameOf, createdAt, squadName, attachmentOf, t]);

  const shown = filter === "all" ? rows : rows.filter((row) => row.kind === filter);
  const kindLabels: Record<LogKind, string> = {
    handoff: t(($) => $.room.log_kind_handoff),
    run: t(($) => $.room.log_kind_run),
    talk: t(($) => $.room.log_kind_talk),
    sys: t(($) => $.room.log_kind_sys),
  };

  return (
    <section className="overflow-hidden rounded-lg border border-surface-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 border-b border-border bg-muted/45 px-3.5 py-2.5 text-left text-caption font-semibold"
      >
        <ListFilter className="size-3.5 text-muted-foreground" />
        <span>{t(($) => $.room.log_title)}</span>
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
          ? (["all", "handoff", "run", "talk"] as const).map((key) => (
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
                {key === "all" ? t(($) => $.room.log_filter_all) : kindLabels[key]}
              </button>
            ))
          : null}
        <span className="grow" />
        {action}
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
              <span className={cn("w-8 shrink-0 font-mono text-micro", LOG_KIND_CLASS[row.kind])}>
                {kindLabels[row.kind]}
              </span>
              <span className="min-w-0 flex-1">{row.text}</span>
              {row.extra ? (
                <span className="flex flex-wrap items-center gap-1.5">{row.extra}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
