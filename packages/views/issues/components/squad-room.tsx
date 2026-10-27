"use client";

import { Lock } from "lucide-react";
import { Button, buttonVariants } from "@quickwork/ui/components/ui/button";
import { ReactionBar, type ReactionItem } from "@quickwork/ui/components/common/reaction-bar";
import { cn } from "@quickwork/ui/lib/utils";
import type { IssueChainStep, TimelineEntry } from "@quickwork/core/types";

import { ActorAvatar } from "../../common/actor-avatar";
import { ReadonlyContent } from "../../editor";
import { useT, useTimeAgo } from "../../i18n";
import { AppLink } from "../../navigation";
import { chainStateKey, type StepRunState } from "./chain-run-state";

/**
 * The room a squad task runs in.
 *
 * A task handed to a squad is a relay: the task detail page is the holder's
 * workbench while the baton is with them — plan, chat, and the 审核通过 that
 * ends their leg — and everyone else sees the same page as the place to
 * follow the relay and read the shared context. These pieces render that.
 */

const STATE_TONE: Record<string, string> = {
  pending: "bg-muted text-faint-foreground",
  doing: "bg-inflight-surface text-inflight font-medium",
  reviewing: "bg-brand/10 text-brand font-medium",
  done: "bg-success/15 text-success",
  parked: "bg-warning/20 text-warning font-medium",
  skipped: "bg-muted text-faint-foreground line-through",
};

export function ChainStateTag({
  state,
  runState = "none",
}: {
  state: string;
  /** Optional overlay over `doing`: a step whose run has not been claimed is
   *  waiting on its holder's environment, not executing — say so. */
  runState?: StepRunState;
}) {
  const { t } = useT("issues");
  const key = chainStateKey(state);
  const labels: Record<string, string> = {
    pending: t(($) => $.room.state_pending),
    doing: t(($) => $.room.state_doing),
    reviewing: t(($) => $.room.state_reviewing),
    done: t(($) => $.room.state_done),
    parked: t(($) => $.room.state_parked),
    skipped: t(($) => $.room.state_skipped),
    unknown: t(($) => $.room.state_unknown),
  };
  let text = labels[key];
  let tone = STATE_TONE[key] ?? STATE_TONE.pending;
  if (key === "doing" && runState === "queued") {
    text = t(($) => $.room.state_waiting);
    tone = STATE_TONE.pending;
  } else if (key === "doing" && runState === "interrupted") {
    text = t(($) => $.room.state_interrupted);
    tone = STATE_TONE.parked;
  }
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-px text-micro whitespace-nowrap",
        tone,
      )}
    >
      {text}
    </span>
  );
}

/**
 * The bar that owns the page while the relay is parked: who it is waiting on
 * and the two ways out — they bind an agent, or the squad goes around them.
 */
export function ChainParkedBar({
  step,
  nameOf,
  bindHref,
  onSkip,
  skipPending,
}: {
  step: IssueChainStep;
  nameOf: (userId: string) => string;
  /** Where the holder goes to bind an agent — the squad page's roster. */
  bindHref: string;
  onSkip: () => void;
  skipPending: boolean;
}) {
  const { t } = useT("issues");
  const name = nameOf(step.holder_user_id);
  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
      <ActorAvatar actorType="member" actorId={step.holder_user_id} size="sm" profileLink={false} />
      <span className="min-w-0 text-caption text-foreground">
        {t(($) => $.room.parked_bar_name, { name })}
      </span>
      <span className="grow" />
      <AppLink
        href={bindHref}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      >
        {t(($) => $.room.parked_bar_action, { name })}
      </AppLink>
      <Button size="sm" variant="ghost" onClick={onSkip} disabled={skipPending}>
        {t(($) => $.room.parked_bar_skip)}
      </Button>
    </div>
  );
}

/**
 * One person's message in the room.
 *
 * One row per message: avatar on the left, then a name + time line and the
 * bubble under it. The reader's own words keep the primary fill and sit to
 * the right of the row, so "what did I say" reads at a glance without the
 * whole row flipping sides. An agent reports in its own inflight card,
 * because a run reporting back is not the same act as a person talking.
 * Replies hang under their root at a smaller size; the room does not need a
 * second fold layer, it needs to be readable top to bottom.
 */
export function RoomMessage({
  entry,
  replies,
  currentUserId,
  identityOf,
  getActorName,
  onToggleReaction,
}: {
  entry: TimelineEntry;
  replies: TimelineEntry[];
  currentUserId?: string;
  identityOf: (userId: string) => string | undefined;
  getActorName: (type: string, id: string) => string;
  onToggleReaction: (commentId: string, emoji: string) => void;
}) {
  const { t } = useT("issues");
  const timeAgo = useTimeAgo();
  const isAgent = entry.actor_type === "agent";
  const own = !isAgent && entry.actor_type === "member" && entry.actor_id === currentUserId;
  const name = getActorName(entry.actor_type, entry.actor_id);
  const identity = !isAgent && entry.actor_type === "member" ? identityOf(entry.actor_id) : undefined;

  return (
    <div className="flex gap-2.5 py-1.5">
      <ActorAvatar
        actorType={entry.actor_type}
        actorId={entry.actor_id}
        size="md"
        className="shrink-0"
        profileLink={false}
      />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span className="text-caption font-semibold text-foreground">{name}</span>
          {identity ? (
            <span className="rounded-full bg-muted px-1.5 text-micro text-muted-foreground">
              {identity}
            </span>
          ) : null}
          <span className="text-micro text-faint-foreground">{timeAgo(entry.created_at)}</span>
          {/* Only the leg's holder ever receives a leg-scoped entry, so the
              tag always means "this one stays inside my leg". */}
          {entry.chain_step_id ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 text-micro text-muted-foreground">
              <Lock className="size-2.5" />
              {t(($) => $.room.leg_tag)}
            </span>
          ) : null}
          {entry.resolved_at ? <ResolvedTag /> : null}
        </div>
        <div
          className={cn(
            "w-fit max-w-[92%] rounded-lg border px-3 py-2 text-body leading-relaxed",
            own
              ? "ml-auto border-primary bg-primary text-primary-foreground"
              : "border-surface-border bg-surface",
            isAgent && !own && "border-inflight/35 bg-inflight-surface",
          )}
        >
          <ReadonlyContent content={entry.content ?? ""} attachments={entry.attachments} />
        </div>
        <ReactionBar
          reactions={(entry.reactions ?? []) as ReactionItem[]}
          currentUserId={currentUserId}
          onToggle={(emoji) => onToggleReaction(entry.id, emoji)}
          getActorName={getActorName}
          className={cn("mt-1", own && "justify-end")}
        />
        {replies.length > 0 ? (
          <div className="mt-1.5 flex w-full flex-col gap-2 border-l pl-3">
            {replies.map((reply) => (
              <RoomReply
                key={reply.id}
                entry={reply}
                own={reply.actor_type === "member" && reply.actor_id === currentUserId}
                name={getActorName(reply.actor_type, reply.actor_id)}
                isAgent={reply.actor_type === "agent"}
                timeAgo={timeAgo}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ResolvedTag() {
  const { t } = useT("issues");
  return (
    <span className="rounded-full bg-success/15 px-1.5 text-micro text-success">
      {t(($) => $.room.resolved)}
    </span>
  );
}

function RoomReply({
  entry,
  own,
  name,
  isAgent,
  timeAgo,
}: {
  entry: TimelineEntry;
  own: boolean;
  name: string;
  isAgent: boolean;
  timeAgo: (date: string) => string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", own ? "items-end" : "items-start")}>
      <span className="text-micro text-muted-foreground">
        {name} · {timeAgo(entry.created_at)}
      </span>
      <div
        className={cn(
          "min-w-0 rounded-lg border px-2.5 py-1.5 text-caption",
          own
            ? "border-transparent bg-brand-surface/90 text-brand-surface-foreground"
            : "border-surface-border bg-surface",
          isAgent && "border-inflight/35 bg-inflight-surface",
        )}
      >
        <ReadonlyContent content={entry.content ?? ""} attachments={entry.attachments} />
      </div>
    </div>
  );
}

/**
 * The locked placeholder for a leg whose work is not the reader's (单流分界).
 *
 * The room is shared; the work inside a leg is not. This block stands where
 * that leg's messages would be, naming exactly what stays hidden — the counts
 * are the honest minimum (it happened, this much of it), not a teaser: the
 * content reads back only for the leg's holder, forever.
 */
export function LockedLegBlock({
  seq,
  holderName,
  commentCount,
  runCount,
  active,
}: {
  seq: number;
  holderName: string;
  commentCount: number;
  runCount: number;
  active: boolean;
}) {
  const { t } = useT("issues");
  return (
    <div className="my-2 flex items-start gap-2.5 rounded-lg border border-dashed border-foreground/25 bg-muted/40 px-3.5 py-3">
      <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 text-caption leading-relaxed text-muted-foreground">
        <div className="font-semibold text-foreground">
          {t(($) => $.room.lock_block_title, { seq, name: holderName })}
        </div>
        <div className="mt-0.5">
          {commentCount > 0 || runCount > 0
            ? t(($) => $.room.lock_block_hint_counts, {
                count: commentCount,
                runs: runCount,
              })
            : active
              ? t(($) => $.room.lock_block_hint_active)
              : t(($) => $.room.lock_block_hint_counts, { count: 0, runs: 0 })}
        </div>
      </div>
    </div>
  );
}
