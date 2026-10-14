"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SendHorizontal } from "lucide-react";
import { api } from "@quickwork/core/api";
import { useAuthStore } from "@quickwork/core/auth";
import { useWorkspaceId } from "@quickwork/core/hooks";
import {
  agentListOptions,
  appendSquadMessage,
  memberListOptions,
  squadMessagesOptions,
  SQUAD_ROOM_PAGE_SIZE,
} from "@quickwork/core/workspace/queries";
import { isImeComposing } from "@quickwork/core/utils";
import type {
  Agent,
  MemberWithUser,
  Squad,
  SquadMember,
  SquadMemberStatus,
  SquadMessage,
} from "@quickwork/core/types";
import { Button } from "@quickwork/ui/components/ui/button";
import { cn } from "@quickwork/ui/lib/utils";
import { toast } from "sonner";

import { ActorAvatar } from "../../common/actor-avatar";
import { useTimeAgo, useT } from "../../i18n";

/** Room-role vocabulary. Free text on the wire; this is the only writer. */
export const SQUAD_ROOM_ROLES = ["leader", "executor", "reviewer", "observer"] as const;
export type SquadRoomRole = (typeof SQUAD_ROOM_ROLES)[number];

export function isSquadRoomRole(value: string): value is SquadRoomRole {
  return (SQUAD_ROOM_ROLES as readonly string[]).includes(value);
}

/**
 * The identity a person registered under, rendered for the room.
 *
 * The onboarding questionnaire is the only place this is collected, and it
 * records a coarse bucket (engineer / product / designer …) rather than a job
 * title, so the room shows the bucket. `other` carries the person's own words.
 * Returns "" when they never declared one — the caller hides the tag rather
 * than printing a placeholder, because an unidentified person is a normal state.
 */
function useIdentityLabel() {
  const { t } = useT("onboarding");
  // Spelled out rather than indexed: the selector API resolves statically, and
  // an explicit switch is also what keeps an unknown bucket from rendering as
  // `undefined`. The fallback is the raw value, because the tag is
  // information — a newer backend inventing a role should still say something.
  return (member: MemberWithUser | undefined): string => {
    switch (member?.identity ?? "") {
      case "": return "";
      case "engineer": return t(($) => $.questions.role.engineer);
      case "product": return t(($) => $.questions.role.product);
      case "designer": return t(($) => $.questions.role.designer);
      case "founder": return t(($) => $.questions.role.founder);
      case "marketing": return t(($) => $.questions.role.marketing);
      case "writer": return t(($) => $.questions.role.writer);
      case "research": return t(($) => $.questions.role.research);
      case "ops": return t(($) => $.questions.role.ops);
      case "student": return t(($) => $.questions.role.student);
      case "other":
        return member?.identity_other?.trim() || t(($) => $.questions.role.other);
      default: return member?.identity ?? "";
    }
  };
}

/**
 * The squad room: what the squad is talking about, and who is in it.
 *
 * A room has three kinds of speaker — a human account, an agent reporting in,
 * and the room narrating its own membership and handoffs — so the stream is not
 * a chat transcript with a wider audience, and the three render differently.
 * `member.identity` is the person's registered identity; `agentsByOwner` is
 * what each person brings to the room.
 */
export function SquadRoomTab({
  squad,
  members,
  memberStatusById,
  canManage,
}: {
  squad: Squad;
  members: SquadMember[];
  memberStatusById: Map<string, SquadMemberStatus>;
  canManage: boolean;
}) {
  const { t } = useT("squads");
  const identityLabel = useIdentityLabel();
  const wsId = useWorkspaceId();
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  const { data: room, isPending } = useQuery(squadMessagesOptions(wsId, squad.id));
  const { data: wsMembers = [] } = useQuery(memberListOptions(wsId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId));

  const membersByUserId = useMemo(() => {
    const map = new Map<string, MemberWithUser>();
    for (const m of wsMembers) map.set(m.user_id, m);
    return map;
  }, [wsMembers]);

  // An agent belongs to whoever owns it; that is the only link between a person
  // and the agents they bring into a room.
  const agentsByOwner = useMemo(() => {
    const map = new Map<string, Agent[]>();
    for (const agent of agents) {
      if (agent.archived_at) continue;
      const owner = agent.owner_id ?? "";
      if (!owner) continue;
      const list = map.get(owner) ?? [];
      list.push(agent);
      map.set(owner, list);
    }
    return map;
  }, [agents]);

  const people = useMemo(
    () => members.filter((m) => m.member_type === "member"),
    [members],
  );
  const roster = useMemo(
    () =>
      [...people].sort((a, b) => {
        const aWorking = memberStatusById.get(a.member_id)?.active_issues.length ?? 0;
        const bWorking = memberStatusById.get(b.member_id)?.active_issues.length ?? 0;
        return bWorking - aWorking;
      }),
    [people, memberStatusById],
  );

  const messages = room?.messages ?? [];
  const streamRef = useRef<HTMLDivElement>(null);
  const lastId = messages[messages.length - 1]?.id ?? "";
  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  const [draft, setDraft] = useState("");
  const queryClient = useQueryClient();
  const send = useMutation({
    mutationFn: (body: string) => api.createSquadMessage(squad.id, { body }),
    onSuccess: (message) => {
      // The WS echo carries the same row back; appending here is what makes the
      // poster's own line appear without waiting for the round trip, and the
      // append is id-deduped so the echo is a no-op.
      appendSquadMessage(queryClient, wsId, squad.id, message);
      setDraft("");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t(($) => $.room.send_failed),
      );
    },
  });

  const canPost = canManage || people.some((m) => m.member_id === currentUserId);
  const submit = () => {
    const body = draft.trim();
    if (!body || !canPost || send.isPending) return;
    send.mutate(body);
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={streamRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {isPending ? (
            <div className="py-10 text-center text-caption text-faint-foreground">
              {t(($) => $.room.loading)}
            </div>
          ) : messages.length === 0 ? (
            <div className="py-10 text-center text-caption text-faint-foreground">
              {t(($) => $.room.empty)}
            </div>
          ) : (
            <div className="flex flex-col gap-3.5">
              {room?.has_more ? (
                <div className="text-center text-micro text-faint-foreground">
                  {t(($) => $.room.older_hidden, { count: SQUAD_ROOM_PAGE_SIZE })}
                </div>
              ) : null}
              {messages.map((message) => (
                <RoomLine
                  key={message.id}
                  message={message}
                  identityFor={(userId) => identityLabel(membersByUserId.get(userId))}
                  authorName={(userId) => membersByUserId.get(userId)?.name ?? ""}
                  mine={message.author_type === "member" && message.author_id === currentUserId}
                />
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t bg-surface px-4 py-3">
          {canPost ? (
            <div className="rounded-lg border px-3 py-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (isImeComposing(e)) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={1}
                placeholder={t(($) => $.room.composer_placeholder)}
                className="max-h-32 min-h-9 w-full resize-none bg-transparent text-body leading-5 outline-none placeholder:text-faint-foreground"
              />
              <div className="mt-1.5 flex items-center gap-2 border-t pt-2">
                <span className="text-micro text-faint-foreground">
                  {t(($) => $.room.composer_hint)}
                </span>
                <span className="flex-1" />
                <Button
                  size="sm"
                  onClick={submit}
                  disabled={!draft.trim() || send.isPending}
                >
                  <SendHorizontal aria-hidden="true" className="size-3.5" />
                  {t(($) => $.room.send)}
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed px-3 py-3 text-center text-caption text-muted-foreground">
              {t(($) => $.room.join_to_speak)}
            </div>
          )}
        </div>
      </div>

      <aside className="flex w-72 shrink-0 flex-col border-l bg-sidebar">
        <div className="flex shrink-0 items-center gap-2 px-3.5 pt-3.5 pb-2.5">
          <span className="text-caption font-semibold">{t(($) => $.room.members)}</span>
          <span className="rounded-full bg-muted px-1.5 text-micro text-muted-foreground tabular-nums">
            {people.length}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
          {roster.map((member) => {
            const profile = membersByUserId.get(member.member_id);
            const status = memberStatusById.get(member.member_id);
            const own = agentsByOwner.get(member.member_id) ?? [];
            const holding = status?.active_issues.length ?? 0;
            const identity = identityLabel(profile);

            return (
              <div
                key={member.id}
                className="flex gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-sidebar-accent"
              >
                <ActorAvatar
                  actorType="member"
                  actorId={member.member_id}
                  size="md"
                  className="shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-label font-medium">
                      {profile?.name || t(($) => $.room.unknown_person)}
                    </span>
                    {member.member_id === currentUserId ? (
                      <span className="shrink-0 rounded-full bg-primary px-1.5 text-micro text-primary-foreground">
                        {t(($) => $.room.you)}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {identity ? (
                      <span className="rounded-full bg-muted px-1.5 text-micro text-muted-foreground">
                        {identity}
                      </span>
                    ) : null}
                    {isSquadRoomRole(member.role) ? (
                      <span className="rounded-full border px-1.5 text-micro text-faint-foreground">
                        {t(($) => $.room.role[member.role as SquadRoomRole])}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-1.5 flex items-center gap-1.5 text-micro">
                    {own.length === 0 ? (
                      <span className="text-faint-foreground">
                        {t(($) => $.room.no_agents)}
                      </span>
                    ) : (
                      <>
                        <span className="flex">
                          {own.slice(0, 3).map((agent) => (
                            <ActorAvatar
                              key={agent.id}
                              actorType="agent"
                              actorId={agent.id}
                              size="xs"
                              className="-ml-1 first:ml-0"
                            />
                          ))}
                        </span>
                        <span className={cn(holding > 0 ? "text-inflight" : "text-faint-foreground")}>
                          {holding > 0
                            ? t(($) => $.room.agent_holding, { count: holding })
                            : t(($) => $.room.agent_idle, { count: own.length })}
                        </span>
                      </>
                    )}
                    {/* can_receive_work is absent on backends that predate it and
                        true is the meaning there, so only an explicit false is
                        reported. */}
                    {member.can_receive_work === false ? (
                      <span className="ml-auto shrink-0 text-faint-foreground">
                        {t(($) => $.room.not_taking_work)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}

function RoomLine({
  message,
  identityFor,
  authorName,
  mine,
}: {
  message: SquadMessage;
  identityFor: (userId: string) => string;
  authorName: (userId: string) => string;
  mine: boolean;
}) {
  const { t } = useT("squads");
  const timeAgo = useTimeAgo();

  if (message.author_type === "system") {
    return (
      <div className="flex items-center gap-2 text-micro text-faint-foreground">
        <span className="h-px flex-1 bg-border" />
        <span>{message.body}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    );
  }

  const authorId = message.author_id ?? "";
  const isAgent = message.author_type === "agent";
  const label = authorName(authorId);
  const identity = isAgent ? "" : identityFor(authorId);

  // A cross-zone receipt is the room's most important non-prose line, so it
  // gets its own card rather than being flattened into a bubble.
  if (message.kind === "receipt") {
    const meta = message.metadata as { from?: string; to?: string };
    return (
      <div className="max-w-[85%] self-start rounded-lg border bg-surface px-3 py-2.5">
        <div className="flex items-center gap-2 text-caption text-muted-foreground">
          {label ? <span className="font-medium text-foreground">{label}</span> : null}
          <span>{t(($) => $.room.kind_receipt)}</span>
          <span className="ml-auto">{timeAgo(message.created_at)}</span>
        </div>
        <div className="mt-1.5 text-body leading-5">{message.body}</div>
        {meta.from || meta.to ? (
          <div className="mt-2 flex items-center gap-1.5 border-t pt-2 text-micro text-faint-foreground">
            {meta.from ? <span>{meta.from}</span> : null}
            <span>→</span>
            {meta.to ? <span>{meta.to}</span> : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex max-w-[85%] gap-2.5",
        mine ? "flex-row-reverse self-end" : "self-start",
      )}
    >
      <ActorAvatar
        actorType={isAgent ? "agent" : "member"}
        actorId={authorId}
        size="md"
        className="shrink-0"
      />
      <div className="min-w-0">
        <div className={cn("mb-1 flex items-center gap-1.5", mine && "justify-end")}>
          <span className="text-caption font-semibold">
            {label || t(($) => $.room.unknown_person)}
          </span>
          {identity ? (
            <span className="rounded-full bg-muted px-1.5 text-micro text-muted-foreground">
              {identity}
            </span>
          ) : null}
          <span className="text-micro text-faint-foreground">
            {timeAgo(message.created_at)}
          </span>
        </div>
        <div
          className={cn(
            "whitespace-pre-wrap rounded-lg px-3 py-2 text-body leading-5",
            isAgent
              ? "border border-inflight/35 bg-inflight-surface"
              : mine
                ? "bg-brand-surface text-brand-surface-foreground"
                : "border bg-surface",
          )}
        >
          {message.body}
        </div>
      </div>
    </div>
  );
}
