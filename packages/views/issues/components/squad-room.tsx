"use client";

import { Lock, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, buttonVariants } from "@quickwork/ui/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quickwork/ui/components/ui/select";
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
  legStatus,
}: {
  state: string;
  /** Optional overlay over `doing`: a step whose run has not been claimed is
   *  waiting on its holder's environment, not executing — say so. */
  runState?: StepRunState;
  /** Server-derived leg status; preferred over local recombination when present. */
  legStatus?: string;
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
  if (legStatus === "queued") {
    text = t(($) => $.room.state_waiting);
    tone = STATE_TONE.pending;
  } else if (legStatus === "preparing") {
    text = t(($) => $.room.run_preparing);
    tone = STATE_TONE.pending;
  } else if (legStatus === "running") {
    text = t(($) => $.room.state_doing);
    tone = STATE_TONE.doing;
  } else if (key === "doing" && runState === "queued") {
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
  machineHref,
  onSkip,
  skipPending,
}: {
  step: IssueChainStep;
  nameOf: (userId: string) => string;
  /** Where the holder goes to bind an agent — the squad page's roster. */
  bindHref: string;
  /** The workspace's machines page: the fix for reasons that are about a
   *  machine (offline, unusable CLI, private to someone else), not a binding. */
  machineHref?: string;
  onSkip: () => void;
  skipPending: boolean;
}) {
  const { t } = useT("issues");
  const name = nameOf(step.holder_user_id);
  // The reason code names the actual blocker, and the fixes are not
  // interchangeable: binding an agent, sharing a machine, reinstalling a CLI,
  // and replacing an archived agent send the holder to different places.
  // "He has not bound an agent" shown to someone who has one is misleading.
  let body: string;
  let action: string;
  let machineFix = false;
  switch (step.parked_reason) {
    case "runtime_private_foreign":
      body = t(($) => $.room.parked_bar_name_private, { name });
      action = t(($) => $.room.parked_bar_action_private, { name });
      machineFix = true;
      break;
    case "runtime_offline":
      body = t(($) => $.room.parked_bar_name_offline, { name });
      action = t(($) => $.room.parked_bar_action_fallback, { name });
      machineFix = true;
      break;
    case "runtime_unusable":
      body = t(($) => $.room.parked_bar_name_unusable, { name });
      action = t(($) => $.room.parked_bar_action_unusable, { name });
      machineFix = true;
      break;
    case "agent_runtime_required":
      body = t(($) => $.room.parked_bar_name_unbound, { name });
      action = t(($) => $.room.parked_bar_action_unbound, { name });
      break;
    case "target_unavailable":
      body = t(($) => $.room.parked_bar_name_unavailable, { name });
      action = t(($) => $.room.parked_bar_action_unavailable, { name });
      break;
    case "no_agent":
    case undefined:
    case "":
      body = t(($) => $.room.parked_bar_name, { name });
      action = t(($) => $.room.parked_bar_action, { name });
      break;
    default:
      // A reason this client does not know: stay honest about the wait
      // without inventing a cause.
      body = t(($) => $.room.parked_bar_name_fallback, { name });
      action = t(($) => $.room.parked_bar_action_fallback, { name });
  }
  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
      <ActorAvatar actorType="member" actorId={step.holder_user_id} size="sm" profileLink={false} />
      <span className="min-w-0 text-caption text-foreground">{body}</span>
      <span className="grow" />
      {machineFix && machineHref ? (
        <AppLink
          href={machineHref}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          {t(($) => $.room.parked_bar_machine)}
        </AppLink>
      ) : null}
      <AppLink
        href={bindHref}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      >
        {action}
      </AppLink>
      <Button size="sm" variant="ghost" onClick={onSkip} disabled={skipPending}>
        {t(($) => $.room.parked_bar_skip)}
      </Button>
    </div>
  );
}

/**
 * Owner/admin fallback for a leg that cannot move on its own: the holder is
 * gone, or their review never comes. Reassign moves the baton without
 * touching the work; skipping a REVIEWING leg throws the pending judgment
 * away, so it takes two clicks. A parked leg already has its own skip.
 */
export function ChainAdminBar({
  step,
  people,
  onReassign,
  reassignPending,
  onSkipReview,
  skipPending,
}: {
  step: IssueChainStep;
  /** The squad's people, in roster order; the current holder is filtered out. */
  people: { userId: string; name: string }[];
  onReassign: (userId: string) => void;
  reassignPending: boolean;
  onSkipReview?: () => void;
  skipPending: boolean;
}) {
  const { t } = useT("issues");
  const [target, setTarget] = useState("");
  const [confirmSkip, setConfirmSkip] = useState(false);
  useEffect(() => {
    setTarget("");
    setConfirmSkip(false);
  }, [step.id]);
  const reviewing = chainStateKey(step.state) === "reviewing";
  const options = people.filter((p) => p.userId !== step.holder_user_id);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-surface-border bg-muted/30 px-3.5 py-3">
      <div className="flex items-center gap-1.5 text-caption font-semibold text-muted-foreground">
        <ShieldAlert className="size-3.5" />
        {t(($) => $.room.admin_bar_title)}
      </div>
      <p className="text-caption leading-relaxed text-muted-foreground">
        {reviewing
          ? t(($) => $.room.admin_bar_review_note)
          : t(($) => $.room.admin_bar_parked_note)}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Select
          items={options.map((p) => ({ value: p.userId, label: p.name }))}
          value={target}
          onValueChange={(v) => {
            if (v) setTarget(v);
          }}
        >
          <SelectTrigger
            size="sm"
            className="min-w-36 flex-1"
            aria-label={t(($) => $.room.admin_bar_pick_member)}
          >
            <SelectValue placeholder={t(($) => $.room.admin_bar_pick_member)} />
          </SelectTrigger>
          <SelectContent align="start">
            {options.map((p) => (
              <SelectItem key={p.userId} value={p.userId}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={!target || reassignPending || options.length === 0}
          onClick={() => target && onReassign(target)}
        >
          {t(($) => $.room.admin_bar_reassign)}
        </Button>
        {reviewing && onSkipReview ? (
          <Button
            size="sm"
            variant={confirmSkip ? "destructive" : "ghost"}
            disabled={skipPending}
            onClick={() => {
              if (!confirmSkip) {
                setConfirmSkip(true);
                return;
              }
              setConfirmSkip(false);
              onSkipReview();
            }}
          >
            {confirmSkip
              ? t(($) => $.room.admin_bar_skip_confirm)
              : t(($) => $.room.admin_bar_skip)}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The halt card: the relay cannot move, and the page says so at the bottom
 * where the conversation ends. Two columns — what stopped on the left, who
 * can decide on the right. Reassigning only moves the baton, never the work.
 */
export function ChainHaltBar({
  step,
  seq,
  total,
  nameOf,
  bindHref,
  machineHref,
  reviewing = false,
  canAdminister,
  people,
  onReassign,
  reassignPending,
  onSkip,
  skipPending,
  onSkipReview,
}: {
  step: IssueChainStep;
  seq: number;
  total: number;
  nameOf: (userId: string) => string;
  /** Where the holder fixes a missing agent / bad binding — the squad roster. */
  bindHref: string;
  /** The workspace's machines page, for reasons that are about a machine. */
  machineHref?: string;
  reviewing?: boolean;
  canAdminister: boolean;
  people: { userId: string; name: string; hasAgent: boolean }[];
  onReassign: (userId: string) => void;
  reassignPending: boolean;
  onSkip: () => void;
  skipPending: boolean;
  onSkipReview?: () => void;
}) {
  const { t } = useT("issues");
  const name = nameOf(step.holder_user_id);
  const [confirmSkip, setConfirmSkip] = useState(false);
  useEffect(() => {
    setConfirmSkip(false);
  }, [step.id, reviewing]);
  let reason: string;
  let machineFix = false;
  switch (step.parked_reason) {
    case "runtime_private_foreign":
      reason = t(($) => $.room.halt_reason_private);
      machineFix = true;
      break;
    case "runtime_offline":
      reason = t(($) => $.room.halt_reason_offline);
      machineFix = true;
      break;
    case "runtime_unusable":
      reason = t(($) => $.room.halt_reason_unusable);
      machineFix = true;
      break;
    case "agent_runtime_required":
      reason = t(($) => $.room.halt_reason_unbound);
      break;
    case "target_unavailable":
      reason = t(($) => $.room.halt_reason_unavailable);
      break;
    case "no_agent":
    case undefined:
    case "":
      reason = t(($) => $.room.halt_reason_no_agent);
      break;
    default:
      reason = t(($) => $.room.halt_reason_fallback);
  }
  const title = reviewing
    ? t(($) => $.room.halt_title_review, { name })
    : t(($) => $.room.halt_title_parked, { name });
  const nameAt = title.indexOf(name);
  const titleNode =
    nameAt >= 0 ? (
      <>
        {title.slice(0, nameAt)}
        <b>{name}</b>
        {title.slice(nameAt + name.length)}
      </>
    ) : (
      title
    );
  const options = people.filter((person) => person.userId !== step.holder_user_id);
  return (
    <section className="rd-section rd-halt-section">
      <div className="rd-section-head">
        <span>{t(($) => $.room.halt_section)}</span>
        <i />
        <em>{t(($) => $.room.halt_section_note)}</em>
      </div>
      <div className="rd-halt" data-kind={reviewing ? "review" : "parked"}>
        <div className="rd-halt-left">
          <div className="rd-halt-label">
            <i />
            {reviewing
              ? t(($) => $.room.halt_label_review)
              : t(($) => $.room.halt_label_parked)}
            <em>· {reviewing ? "REVIEW" : "PARKED"}</em>
          </div>
          <h2 className="rd-halt-title">{titleNode}</h2>
          <p className="rd-halt-desc">
            {reviewing ? (
              t(($) => $.room.halt_desc_review, { seq })
            ) : (
              <>
                <b>{name}</b>
                {reason}
              </>
            )}
          </p>
          <div className="rd-halt-meta">
            <span className="rd-halt-ava">{Array.from(name).slice(0, 2).join("")}</span>
            <span className="rd-halt-who">
              <b>{name}</b>
              <small>{t(($) => $.room.halt_meta_leg, { seq, total })}</small>
            </span>
          </div>
        </div>
        <div className="rd-halt-right">
          <div className="rd-halt-decide">{t(($) => $.room.halt_decide)}</div>
          <div className="rd-halt-members">
            {canAdminister ? (
              options.map((person) => (
                <button
                  key={person.userId}
                  type="button"
                  className="rd-halt-member"
                  disabled={reassignPending || (!reviewing && !person.hasAgent)}
                  onClick={() => onReassign(person.userId)}
                >
                  <ActorAvatar
                    actorType="member"
                    actorId={person.userId}
                    size="xs"
                    profileLink={false}
                  />
                  <span className="rd-halt-member-main">
                    <b>{person.name}</b>
                    <small>
                      {person.hasAgent
                        ? t(($) => $.room.halt_member_agent)
                        : t(($) => $.room.halt_member_no_agent)}
                    </small>
                  </span>
                  <em>
                    {reviewing || person.hasAgent
                      ? t(($) => $.room.halt_member_action)
                      : t(($) => $.room.halt_member_undispatchable)}
                  </em>
                </button>
              ))
            ) : (
              <AppLink className="rd-halt-member" href={bindHref}>
                <span className="rd-halt-member-main">
                  <b>{t(($) => $.room.halt_go_squad)}</b>
                  <small>{t(($) => $.room.halt_go_squad_hint)}</small>
                </span>
                <em>→</em>
              </AppLink>
            )}
          </div>
          <div className="rd-halt-subactions">
            {machineFix && machineHref ? (
              <AppLink className="rd-halt-link" href={machineHref}>
                {t(($) => $.room.halt_machine)} ↗
              </AppLink>
            ) : null}
            {reviewing ? (
              onSkipReview ? (
                <button
                  type="button"
                  className="rd-halt-link is-danger"
                  disabled={skipPending}
                  onClick={() => {
                    if (!confirmSkip) {
                      setConfirmSkip(true);
                      return;
                    }
                    setConfirmSkip(false);
                    onSkipReview();
                  }}
                >
                  {confirmSkip
                    ? t(($) => $.room.halt_skip_review_confirm)
                    : t(($) => $.room.halt_skip_review)}
                </button>
              ) : null
            ) : (
              <button
                type="button"
                className="rd-halt-link is-danger"
                disabled={skipPending}
                onClick={onSkip}
              >
                {t(($) => $.room.halt_skip)}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
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
