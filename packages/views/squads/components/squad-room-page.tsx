"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowUpRight,
} from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Agent,
  AgentRuntime,
  MemberWithUser,
  Squad,
  SquadMember,
  SquadMessage,
} from "@quickwork/core/types";
import { api } from "@quickwork/core/api";
import { useAuthStore } from "@quickwork/core/auth";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { resolvePublicFileUrl } from "@quickwork/core/workspace/avatar-url";
import { useWorkspacePaths } from "@quickwork/core/paths";
import {
  agentListOptions,
  appendSquadMessage,
  memberListOptions,
  squadMessagesOptions,
  SQUAD_ROOM_PAGE_SIZE,
  workspaceKeys,
} from "@quickwork/core/workspace/queries";
import { runtimeListOptions } from "@quickwork/core/runtimes";
import { isImeComposing } from "@quickwork/core/utils";
import {
  currentPath,
  useNavigation,
} from "../../navigation";
import { ProviderLogo } from "../../runtimes/components/provider-logo";
import { useLocale, useT } from "../../i18n";
import { SquadDisc } from "./squad-disc";
import { formatSquadDate } from "./squads-console-model";
import { isSquadRoomRole } from "./squad-room-tab";

type RoleT = ReturnType<typeof useT<"squads">>["t"];

function roleLabel(role: string, t: RoleT): string {
  return isSquadRoomRole(role) ? t(($) => $.room.role[role]) : role;
}

export function SquadRoomPage() {
  const { t } = useT("squads");
  const locale = useLocale();
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const squadId = navigation.pathname.split("/").pop() ?? "";

  const {
    data: squad,
    isLoading,
    isError,
  } = useQuery<Squad>({
    queryKey: [...workspaceKeys.squads(wsId), squadId],
    queryFn: () => api.getSquad(squadId),
    enabled: !!wsId && !!squadId,
  });
  const { data: members = [] } = useQuery<SquadMember[]>({
    queryKey: [...workspaceKeys.squads(wsId), squadId, "members"],
    queryFn: () => api.listSquadMembers(squadId),
    enabled: !!wsId && !!squadId,
  });
  const { data: room, isPending: roomPending } = useQuery(
    squadMessagesOptions(wsId, squadId),
  );
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: wsMembers = [] } = useQuery(memberListOptions(wsId));
  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));

  const agentsById = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of agents) map.set(agent.id, agent);
    return map;
  }, [agents]);
  const membersById = useMemo(() => {
    const map = new Map<string, MemberWithUser>();
    for (const member of wsMembers) map.set(member.user_id, member);
    return map;
  }, [wsMembers]);
  const runtimesById = useMemo(() => {
    const map = new Map<string, AgentRuntime>();
    for (const runtime of runtimes) map.set(runtime.id, runtime);
    return map;
  }, [runtimes]);

  const isWorkspaceAdmin = useMemo(() => {
    if (!currentUser) return false;
    const me = wsMembers.find((member) => member.user_id === currentUser.id);
    return me?.role === "owner" || me?.role === "admin";
  }, [wsMembers, currentUser]);
  const canManage =
    isWorkspaceAdmin || (!!currentUser && squad?.creator_id === currentUser.id);
  const canPost =
    canManage ||
    members.some(
      (member) =>
        member.member_type === "member" && member.member_id === currentUser?.id,
    );

  const messages = room?.messages ?? [];
  const lastMessageId = messages[messages.length - 1]?.id ?? "";
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastMessageId]);

  const [draft, setDraft] = useState("");
  const send = useMutation({
    mutationFn: (body: string) => api.createSquadMessage(squadId, { body }),
    onSuccess: (message) => {
      appendSquadMessage(queryClient, wsId, squadId, message);
      setDraft("");
      inputRef.current?.focus();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t(($) => $.room.send_failed),
      );
    },
  });

  const submit = () => {
    const body = draft.trim();
    if (!body || !canPost || send.isPending) return;
    send.mutate(body);
  };

  const formatTime = (iso: string) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const now = new Date();
    const time = new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
    if (date.toDateString() === now.toDateString()) return time;
    const day = new Intl.DateTimeFormat(locale, {
      month: "numeric",
      day: "numeric",
    }).format(date);
    return `${day} ${time}`;
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(
        navigation.getShareableUrl(currentPath(navigation)),
      );
      toast.success(t(($) => $.console.copied));
    } catch {
      toast.error(t(($) => $.console.copy_failed));
    }
  };

  const nameOf = (type: string, id: string | undefined) => {
    if (!id) return "";
    return type === "agent"
      ? agentsById.get(id)?.name
      : membersById.get(id)?.name;
  };

  const avatarOf = (type: string, id: string | undefined): string | null => {
    if (!id) return null;
    return type === "agent"
      ? (agentsById.get(id)?.avatar_url ?? null)
      : (membersById.get(id)?.avatar_url ?? null);
  };

  const memberRole = (type: string, id: string | undefined) => {
    if (!id) return "";
    return (
      members.find(
        (member) => member.member_type === type && member.member_id === id,
      )?.role ?? ""
    );
  };

  const providerFor = (member: SquadMember): string | null => {
    const agent =
      member.member_type === "agent"
        ? agentsById.get(member.member_id)
        : agentsById.get(member.agent_id ?? "");
    if (!agent) return null;
    return runtimesById.get(agent.runtime_id)?.provider ?? null;
  };

  const leaderMember = members.find((member) => member.role === "leader");
  const leaderName =
    leaderMember
      ? nameOf(leaderMember.member_type, leaderMember.member_id) ??
        nameOf("agent", squad?.leader_id)
      : squad
        ? nameOf("agent", squad.leader_id) ?? nameOf("member", squad.leader_id)
        : undefined;

  if (isLoading) {
    return (
      <div className="qw-sr-page">
        <div className="qw-sr-state">{t(($) => $.console.detail_loading)}</div>
      </div>
    );
  }

  if (isError || !squad) {
    return (
      <div className="qw-sr-page">
        <div className="qw-sr-state">
          <h3>{t(($) => $.console.room_load_failed)}</h3>
          <button
            type="button"
            className="qw-sr-primary"
            onClick={() => navigation.push(paths.squads())}
          >
            {t(($) => $.console.back_to_squads)}
          </button>
        </div>
      </div>
    );
  }

  const squadAvatarUrl = resolvePublicFileUrl(squad.avatar_url);
  const squadAvatar = squadAvatarUrl ? (
    <img className="qw-sr-head-avatar" src={squadAvatarUrl} alt="" />
  ) : (
    <span className="qw-sr-head-avatar" aria-hidden="true">
      {squad.name.trim().charAt(0).toUpperCase()}
    </span>
  );

  return (
    <div className="qw-sr-page">
      <header className="qw-sr-topbar">
        <button
          type="button"
          className="qw-sr-back"
          onClick={() => navigation.push(paths.squads())}
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          {t(($) => $.console.back)}
        </button>
        <span className="qw-sr-crumb">
          {t(($) => $.console.back)} / {squad.name}
        </span>
        <div className="qw-sr-top-actions">
          {canManage ? (
            <button
              type="button"
              className="qw-sr-textbtn"
              onClick={() => navigation.push(`${navigation.pathname}?manage=1`)}
            >
              {t(($) => $.console.manage)}
            </button>
          ) : null}
          <button type="button" className="qw-sr-textbtn" onClick={copyLink}>
            {t(($) => $.console.copy_link)}
          </button>
        </div>
      </header>

      <div className="qw-sr-body">
        <section className="qw-sr-chat">
          <header className="qw-sr-head">
            {squadAvatar}
            <div className="qw-sr-head-main">
              <div className="qw-sr-kicker">
                {t(($) => $.console.group_chat, { count: members.length })}
              </div>
              <h2 className="qw-sr-title">{squad.name}</h2>
              {squad.description ? (
                <p className="qw-sr-desc">{squad.description}</p>
              ) : null}
            </div>
            <div className="qw-sr-head-members">
              <span className="qw-sr-stack">
                {members.slice(0, 4).map((member) => (
                  <span
                    key={member.id}
                    className="qw-sr-stack-ava"
                    data-leader={member.role === "leader" ? "" : undefined}
                  >
                    <SquadDisc
                      id={member.member_id}
                      name={
                        nameOf(member.member_type, member.member_id) ||
                        t(($) => $.console.unknown_member)
                      }
                      avatarUrl={avatarOf(member.member_type, member.member_id)}
                      className="qw-sr-stack-disc"
                    />
                  </span>
                ))}
              </span>
              <span className="qw-sr-head-count">
                {t(($) => $.console.member_people, { count: members.length })}
              </span>
            </div>
          </header>

          <div className="qw-sr-scroll" ref={scrollRef}>
            {roomPending ? (
              <div className="qw-sr-room-state">
                {t(($) => $.room.loading)}
              </div>
            ) : messages.length === 0 ? (
              <div className="qw-sr-room-state">{t(($) => $.room.empty)}</div>
            ) : (
              <div className="qw-sr-stream">
                {room?.has_more ? (
                  <div className="qw-sr-older">
                    {t(($) => $.room.older_hidden, { count: SQUAD_ROOM_PAGE_SIZE })}
                  </div>
                ) : null}
                {messages.map((message) => (
                  <SquadMessageLine
                    key={message.id}
                    message={message}
                    mine={
                      message.author_type === "member" &&
                      message.author_id === currentUser?.id
                    }
                    nameOf={nameOf}
                    avatarOf={avatarOf}
                    roleOf={memberRole}
                    formatTime={formatTime}
                    t={t}
                  />
                ))}
              </div>
            )}
          </div>

          {canPost ? (
            <div className="qw-sr-composer">
              <input
                ref={inputRef}
                type="text"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (isImeComposing(event)) return;
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submit();
                  }
                }}
                placeholder={t(($) => $.room.composer_placeholder)}
                autoComplete="off"
                aria-label={t(($) => $.room.composer_placeholder)}
              />
              <button
                type="button"
                className="qw-sr-send"
                aria-label={t(($) => $.console.send_aria)}
                onClick={submit}
                disabled={!draft.trim() || send.isPending}
              >
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="qw-sr-composer-locked">
              {t(($) => $.room.join_to_speak)}
            </div>
          )}
        </section>

        <aside className="qw-sr-side">
          <section className="qw-sr-side-sec">
            <div className="qw-sr-side-label">{t(($) => $.console.info)}</div>
            <div className="qw-sr-facts">
              <div className="qw-sr-fact">
                <div className="k">{t(($) => $.console.info_leader)}</div>
                <div className="v">
                  {leaderName || t(($) => $.console.unknown_member)}
                </div>
              </div>
              <div className="qw-sr-fact">
                <div className="k">{t(($) => $.console.info_created)}</div>
                <div className="v">{formatSquadDate(squad.created_at)}</div>
              </div>
              <div className="qw-sr-fact">
                <div className="k">{t(($) => $.console.info_members)}</div>
                <div className="v">
                  {t(($) => $.console.member_people, { count: members.length })}
                </div>
              </div>
            </div>
            <div className="qw-sr-inst">
              {squad.instructions || t(($) => $.console.no_instructions)}
            </div>
          </section>

          <section className="qw-sr-side-sec">
            <div className="qw-sr-side-label">
              {t(($) => $.console.members_label)}
              <span className="cnt">
                {t(($) => $.console.member_people, { count: members.length })}
              </span>
            </div>
            <div className="qw-sr-members">
              {members.map((member) => {
                const provider = providerFor(member);
                return (
                  <div key={member.id} className="qw-sr-member">
                    <span
                      className="qw-sr-member-ava"
                      data-leader={member.role === "leader" ? "" : undefined}
                    >
                      <SquadDisc
                        id={member.member_id}
                        name={
                          nameOf(member.member_type, member.member_id) ||
                          t(($) => $.console.unknown_member)
                        }
                        avatarUrl={avatarOf(member.member_type, member.member_id)}
                        className="qw-sr-disc"
                      />
                    </span>
                    <span className="qw-sr-member-main">
                      <span className="qw-sr-member-name">
                        {nameOf(member.member_type, member.member_id) ||
                          t(($) => $.console.unknown_member)}
                      </span>
                      <span className="qw-sr-member-sub">
                        {roleLabel(member.role, t)}
                        {provider ? (
                          <span className="qw-sr-prov">
                            <ProviderLogo provider={provider} className="size-3" />
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function SquadMessageLine({
  message,
  mine,
  nameOf,
  avatarOf,
  roleOf,
  formatTime,
  t,
}: {
  message: SquadMessage;
  mine: boolean;
  nameOf: (type: string, id: string | undefined) => string | undefined;
  avatarOf: (type: string, id: string | undefined) => string | null;
  roleOf: (type: string, id: string | undefined) => string;
  formatTime: (iso: string) => string;
  t: ReturnType<typeof useT<"squads">>["t"];
}) {
  if (message.author_type === "system") {
    return (
      <div className="qw-sr-system">
        {message.body} · {formatTime(message.created_at)}
      </div>
    );
  }

  const role = roleLabel(
    roleOf(message.author_type, message.author_id),
    t,
  );

  if (message.kind === "receipt") {
    const meta = message.metadata as { from?: string; to?: string };
    return (
      <div className="qw-sr-receipt">
        <div className="qw-sr-receipt-head">
          <span>{t(($) => $.room.kind_receipt)}</span>
          <span className="time">{formatTime(message.created_at)}</span>
        </div>
        <div className="qw-sr-receipt-body">{message.body}</div>
        {meta.from || meta.to ? (
          <div className="qw-sr-receipt-route">
            {meta.from ? <span>{meta.from}</span> : null}
            <span aria-hidden="true">→</span>
            {meta.to ? <span>{meta.to}</span> : null}
          </div>
        ) : null}
      </div>
    );
  }

  const name = mine
    ? t(($) => $.room.you)
    : nameOf(message.author_type, message.author_id) ||
      t(($) => $.room.unknown_person);
  const avatar = mine
    ? null
    : avatarOf(message.author_type, message.author_id);

  return (
    <div className="qw-sr-msg" data-mine={mine ? "" : undefined}>
      {!mine ? (
        <SquadDisc
          id={message.author_id ?? message.id}
          name={name}
          avatarUrl={avatar}
          className="qw-sr-msga"
        />
      ) : null}
      <div className="qw-sr-msg-main">
        <div className="qw-sr-msg-meta">
          <span className="name">{name}</span>
          {!mine && role ? <span className="role">{role}</span> : null}
          <span className="time">{formatTime(message.created_at)}</span>
        </div>
        <div className="qw-sr-bubble">{message.body}</div>
      </div>
    </div>
  );
}
