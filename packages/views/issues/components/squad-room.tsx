"use client";

import { ChevronRight } from "lucide-react";
import { Button, buttonVariants } from "@quickwork/ui/components/ui/button";
import { ReactionBar, type ReactionItem } from "@quickwork/ui/components/common/reaction-bar";
import { cn } from "@quickwork/ui/lib/utils";
import type { AgentTask, IssueChain, IssueChainStep, TimelineEntry } from "@quickwork/core/types";

import { ActorAvatar } from "../../common/actor-avatar";
import { ReadonlyContent } from "../../editor";
import { useT, useTimeAgo } from "../../i18n";
import { AppLink } from "../../navigation";
import { stepRunState, type StepRunState } from "./chain-run-state";

/**
 * The room a squad task runs in.
 *
 * A task handed to a squad is shared: every member sees the same timeline, the
 * agent reports land in it beside the people's messages, and the relay's
 * current holder is always visible. These pieces render that — the parked bar
 * is the action center when the relay has reached someone with no agent.
 */

const STATE_TONE: Record<string, string> = {
  pending: "bg-muted text-faint-foreground",
  doing: "bg-inflight-surface text-inflight font-medium",
  done: "bg-success/15 text-success",
  parked: "bg-warning/20 text-warning font-medium",
  skipped: "bg-muted text-faint-foreground line-through",
};

/** Keeps a state from a newer backend renderable instead of blank. */
export function chainStateKey(state: string): "pending" | "doing" | "done" | "parked" | "skipped" | "unknown" {
  switch (state) {
    case "pending":
    case "doing":
    case "done":
    case "parked":
    case "skipped":
      return state;
    default:
      return "unknown";
  }
}

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

/** Where the relay stands: one node per step, left to right. */
export function ChainStepsStrip({
  chain,
  issueId,
  tasks = [],
  nameOf,
}: {
  chain: IssueChain;
  /** Whose tasks the run states are read from (see stepRunState). */
  issueId?: string;
  tasks?: readonly AgentTask[];
  nameOf: (userId: string) => string;
}) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto py-2.5">
      {chain.steps.map((step, i) => (
        <span key={step.id} className="flex shrink-0 items-center gap-1.5">
          {i > 0 && (
            <ChevronRight aria-hidden="true" className="size-3 text-faint-foreground" />
          )}
          <span className="flex items-center gap-1.5">
            <ActorAvatar
              actorType="member"
              actorId={step.holder_user_id}
              size="sm"
              profileLink={false}
            />
            <span className="text-caption">{nameOf(step.holder_user_id)}</span>
            <ChainStateTag
              state={step.state}
              runState={issueId ? stepRunState(issueId, step, tasks) : "none"}
            />
          </span>
        </span>
      ))}
    </div>
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
 * A member speaks in a bubble — their own line sits on the right in the brand
 * fill, so "what did I say" reads at a glance. An agent speaks in its own
 * card, because a run reporting back is not the same act as a person talking.
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
  const timeAgo = useTimeAgo();
  const isAgent = entry.actor_type === "agent";
  const own = !isAgent && entry.actor_type === "member" && entry.actor_id === currentUserId;
  const name = getActorName(entry.actor_type, entry.actor_id);
  const identity = !isAgent && entry.actor_type === "member" ? identityOf(entry.actor_id) : undefined;

  return (
    <div className={cn("flex gap-2.5 pb-1", own ? "flex-row-reverse" : "flex-row")}>
      <ActorAvatar
        actorType={entry.actor_type}
        actorId={entry.actor_id}
        size="md"
        className="mt-4 shrink-0"
        profileLink={false}
      />
      <div className={cn("flex min-w-0 max-w-[78%] flex-col", own ? "items-end" : "items-start")}>
        <div className={cn("mb-1 flex items-center gap-1.5", own && "flex-row-reverse")}>
          <span className="text-caption font-semibold text-foreground">{name}</span>
          {identity ? (
            <span className="rounded-full bg-muted px-1.5 text-micro text-muted-foreground">
              {identity}
            </span>
          ) : null}
          <span className="text-micro text-faint-foreground">{timeAgo(entry.created_at)}</span>
          {entry.resolved_at ? <ResolvedTag /> : null}
        </div>
        <div
          className={cn(
            "min-w-0 rounded-[2px_10px_10px_10px] border px-3 py-2",
            own
              ? "rounded-[10px_2px_10px_10px] border-transparent bg-brand-surface text-brand-surface-foreground"
              : "border-surface-border bg-surface",
            isAgent && "border-inflight/35 bg-inflight-surface",
          )}
        >
          <ReadonlyContent content={entry.content ?? ""} attachments={entry.attachments} />
        </div>
        <ReactionBar
          reactions={(entry.reactions ?? []) as ReactionItem[]}
          currentUserId={currentUserId}
          onToggle={(emoji) => onToggleReaction(entry.id, emoji)}
          getActorName={getActorName}
          className="mt-1"
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
 * The right rail's room roster: everyone in the relay, and whether the agent
 * they would run on is actually there. The warning line is the whole point —
 * it names the person the task will stop on before it stops.
 */
export function RoomMembersCard({
  chain,
  nameOf,
  identityOf,
  agentNameOf,
}: {
  chain: IssueChain;
  nameOf: (userId: string) => string;
  identityOf: (userId: string) => string | undefined;
  agentNameOf: (agentId: string) => string;
}) {
  const { t } = useT("issues");
  return (
    <section className="flex flex-col gap-1">
      <h3 className="px-1 text-caption font-semibold text-foreground">
        {t(($) => $.room.members_title)}
      </h3>
      <div className="flex flex-col">
        {chain.steps.map((step) => {
          const name = nameOf(step.holder_user_id);
          const identity = identityOf(step.holder_user_id);
          return (
            <div key={step.id} className="flex items-start gap-2.5 rounded-md px-1 py-1.5">
              <ActorAvatar
                actorType="member"
                actorId={step.holder_user_id}
                size="md"
                className="shrink-0"
                profileLink={false}
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-caption font-medium">{name}</span>
                  {identity ? (
                    <span className="shrink-0 rounded-full bg-muted px-1.5 text-micro text-muted-foreground">
                      {identity}
                    </span>
                  ) : null}
                </div>
                <span
                  className={cn(
                    "truncate text-micro",
                    step.agent_id ? "text-muted-foreground" : "text-warning",
                  )}
                >
                  {step.agent_id
                    ? t(($) => $.room.member_agent, { agent: agentNameOf(step.agent_id!) })
                    : t(($) => $.room.member_no_agent)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
