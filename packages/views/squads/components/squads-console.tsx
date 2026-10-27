"use client";

import { useMemo, type CSSProperties } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { Agent, MemberWithUser, Squad } from "@quickwork/core/types";
import {
  agentListOptions,
  memberListOptions,
  squadListOptions,
  squadMessagesOptions,
} from "@quickwork/core/workspace/queries";
import { resolvePublicFileUrl } from "@quickwork/core/workspace/avatar-url";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useModalStore } from "@quickwork/core/modals";
import { useWorkspacePaths } from "@quickwork/core/paths";
import { Skeleton } from "@quickwork/ui/components/ui/skeleton";
import { useNavigation } from "../../navigation";
import { useT } from "../../i18n";
import { useTimeAgo } from "../../i18n/use-time-ago";
import {
  formatSquadDate,
  squadAccent,
  squadInitial,
  squadLastMessage,
  squadLeaderPreview,
  squadMemberCount,
  squadStats,
} from "./squads-console-model";
import { SquadDisc } from "./squad-disc";

function SquadMark({ squad }: { squad: Squad }) {
  const url = resolvePublicFileUrl(squad.avatar_url);
  if (url) {
    return <img className="qw-sq-avatar" src={url} alt="" />;
  }
  return (
    <span
      className="qw-sq-avatar"
      style={{ "--ac": squadAccent(squad.id) } as CSSProperties}
      aria-hidden="true"
    >
      {squadInitial(squad.name)}
    </span>
  );
}

export function SquadsPage() {
  const { t } = useT("squads");
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const timeAgo = useTimeAgo();

  const {
    data: squads = [],
    isLoading,
    error,
    refetch,
  } = useQuery(squadListOptions(wsId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));

  const activeSquads = useMemo(
    () => squads.filter((squad) => !squad.archived_at),
    [squads],
  );
  const stats = useMemo(() => squadStats(activeSquads), [activeSquads]);

  const agentsById = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of agents) map.set(agent.id, agent);
    return map;
  }, [agents]);

  const membersById = useMemo(() => {
    const map = new Map<string, MemberWithUser>();
    for (const member of members) map.set(member.user_id, member);
    return map;
  }, [members]);

  // The directory's third column is the room's last line. The list payload
  // carries no message preview, so read each room's cached page (they are the
  // same query the detail room uses, so opening a squad costs no extra fetch).
  const roomResults = useQueries({
    queries: activeSquads.map((squad) => squadMessagesOptions(wsId, squad.id)),
  });
  const lastBySquad = useMemo(() => {
    const map = new Map<string, ReturnType<typeof squadLastMessage>>();
    activeSquads.forEach((squad, index) => {
      map.set(squad.id, squadLastMessage(roomResults[index]?.data));
    });
    return map;
  }, [activeSquads, roomResults]);

  const authorName = (squadId: string) => {
    const message = lastBySquad.get(squadId);
    if (!message || message.author_type === "system" || !message.author_id) {
      return t(($) => $.console.system_author);
    }
    if (message.author_type === "agent") {
      return (
        agentsById.get(message.author_id)?.name ??
        t(($) => $.console.unknown_member)
      );
    }
    return (
      membersById.get(message.author_id)?.name ??
      t(($) => $.console.unknown_member)
    );
  };

  return (
    <div className="qw-sq-page">
      <header className="qw-sq-masthead">
        <div className="qw-sq-mast-main">
          <div className="qw-sq-mast-line">
            <h1>{t(($) => $.page.title)}</h1>
            <span className="qw-sq-count">
              <b>{stats.squads}</b>
              <span>{t(($) => $.console.squads)}</span>
            </span>
            <button
              type="button"
              className="qw-sq-create"
              onClick={() => useModalStore.getState().open("create-squad")}
            >
              <span className="plus">
                <Plus className="size-3" aria-hidden="true" />
              </span>
              {t(($) => $.page.new_button)}
              <span className="kbd">S</span>
            </button>
          </div>
          <p className="qw-sq-live">
            <b>{stats.squads}</b> {t(($) => $.console.squad_unit)}
            <span className="sep">·</span>
            <b>{stats.members}</b> {t(($) => $.console.member_unit)}
          </p>
        </div>
        <div className="qw-sq-sync">
          <span className="sync">
            <i aria-hidden="true" />
            SYNCED
          </span>
          <span className="hint">{t(($) => $.console.sync_hint)}</span>
        </div>
      </header>

      {isLoading ? (
        <div className="qw-sq-board">
          <div className="qw-sq-loading">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-[82px] w-full rounded-none" />
            ))}
          </div>
        </div>
      ) : error ? (
        <div className="qw-sq-empty">
          <h3>{t(($) => $.console.load_failed)}</h3>
          <p>
            {error instanceof Error
              ? error.message
              : t(($) => $.console.load_failed_hint)}
          </p>
          <button type="button" className="qw-sq-primary" onClick={() => refetch()}>
            {t(($) => $.console.try_again)}
          </button>
        </div>
      ) : activeSquads.length === 0 ? (
        <div className="qw-sq-empty">
          <h3>{t(($) => $.console.empty_title)}</h3>
          <p>{t(($) => $.console.empty_hint)}</p>
          <button
            type="button"
            className="qw-sq-primary"
            onClick={() => useModalStore.getState().open("create-squad")}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            {t(($) => $.page.new_button)}
          </button>
        </div>
      ) : (
        <div className="qw-sq-board">
          <div className="qw-sq-thead">
            <span>{t(($) => $.console.col_squad)}</span>
            <span>{t(($) => $.console.col_members)}</span>
            <span>{t(($) => $.console.col_last)}</span>
            <span className="th-created">{t(($) => $.console.col_created)}</span>
            <span aria-hidden="true" />
          </div>
          {activeSquads.map((squad) => {
            const count = squadMemberCount(squad);
            const preview = squad.member_preview ?? [];
            const visible = preview.slice(0, 4);
            const overflow = Math.max(0, count - visible.length);
            const leaderPreview = squadLeaderPreview(squad);
            const leaderName =
              agentsById.get(squad.leader_id)?.name ??
              membersById.get(squad.leader_id)?.name ??
              (leaderPreview
                ? agentsById.get(leaderPreview.member_id)?.name ??
                  membersById.get(leaderPreview.member_id)?.name
                : undefined) ??
              t(($) => $.console.unknown_member);
            const message = lastBySquad.get(squad.id);
            return (
              <button
                key={squad.id}
                type="button"
                className="qw-sq-row"
                title={t(($) => $.console.enter, { name: squad.name })}
                onClick={() => navigation.push(paths.squadDetail(squad.id))}
              >
                <span className="qw-sq-main-cell">
                  <SquadMark squad={squad} />
                  <span className="qw-sq-main">
                    <span className="qw-sq-name">{squad.name}</span>
                    {squad.description ? (
                      <span className="qw-sq-desc">{squad.description}</span>
                    ) : null}
                    <span className="qw-sq-sub">
                      {t(($) => $.console.leader_line, { name: leaderName })}
                      {" · "}
                      {t(($) => $.console.member_count, { count })}
                    </span>
                  </span>
                </span>

                <span className="qw-sq-members">
                  <span className="qw-sq-stack">
                    {visible.map((member) => {
                      const agent =
                        member.member_type === "agent"
                          ? agentsById.get(member.member_id)
                          : null;
                      const person =
                        member.member_type === "member"
                          ? membersById.get(member.member_id)
                          : null;
                      const name =
                        agent?.name ??
                        person?.name ??
                        t(($) => $.console.unknown_member);
                      return (
                        <span
                          key={`${member.member_type}-${member.member_id}`}
                          className="qw-sq-stack-ava"
                          data-leader={member.role === "leader" ? "" : undefined}
                        >
                          <SquadDisc
                            id={member.member_id}
                            name={name}
                            avatarUrl={agent?.avatar_url ?? person?.avatar_url ?? null}
                          />
                        </span>
                      );
                    })}
                    {overflow > 0 ? (
                      <span className="qw-sq-stack-more">+{overflow}</span>
                    ) : null}
                  </span>
                  <span className="qw-sq-mcount">
                    {t(($) => $.console.member_count, { count })}
                  </span>
                </span>

                <span className="qw-sq-last">
                  {message ? (
                    <>
                      <span className="qw-sq-last-top">
                        <span className="qw-sq-last-who">
                          {authorName(squad.id)}
                        </span>
                        <span className="qw-sq-last-time">
                          {timeAgo(message.created_at)}
                        </span>
                      </span>
                      <span className="qw-sq-last-body">{message.body}</span>
                    </>
                  ) : (
                    <span className="qw-sq-last-body muted">
                      {t(($) => $.console.no_messages)}
                    </span>
                  )}
                </span>

                <span className="qw-sq-created">
                  {formatSquadDate(squad.created_at)}
                </span>
                <span className="qw-sq-chev" aria-hidden="true">
                  <ChevronRight className="size-3.5" />
                </span>
              </button>
            );
          })}
        </div>
      )}

      <footer className="qw-sq-pager">
        <span className="sum">
          {t(($) => $.console.summary, {
            count: stats.squads,
            squads: stats.squads,
            members: stats.members,
          })}
        </span>
        <span className="grow" />
        <span className="sum hint">{t(($) => $.console.footer_hint)}</span>
      </footer>
    </div>
  );
}
