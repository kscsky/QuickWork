"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Agent,
  Invitation,
  MemberRole,
  MemberWithUser,
} from "@quickwork/core/types";
import { api } from "@quickwork/core/api";
import { useAuthStore } from "@quickwork/core/auth";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useCurrentWorkspace, useWorkspacePaths } from "@quickwork/core/paths";
import {
  agentListOptions,
  invitationListOptions,
  memberListOptions,
  workspaceKeys,
} from "@quickwork/core/workspace/queries";
import { resolvePublicFileUrl } from "@quickwork/core/workspace/avatar-url";
import { ActorAvatar as ActorAvatarBase } from "@quickwork/ui/components/common/actor-avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@quickwork/ui/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quickwork/ui/components/ui/dialog";
import { useNavigation } from "../navigation";
import { useLocale, useT } from "../i18n";

type DirectoryFilter = "all" | "admin" | "pending" | "agents";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

export function MembersDirectoryPage() {
  const { t } = useT("members");
  const locale = useLocale();
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const qc = useQueryClient();
  const workspace = useCurrentWorkspace();
  const currentUser = useAuthStore((s) => s.user);

  const { data: members = [], isLoading } = useQuery(memberListOptions(wsId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const me = members.find((member) => member.user_id === currentUser?.id) ?? null;
  const canManage = me?.role === "owner" || me?.role === "admin";

  const { data: invitations = [] } = useQuery({
    ...invitationListOptions(wsId),
    enabled: canManage,
  });

  const [filter, setFilter] = useState<DirectoryFilter>("all");
  const [query, setQuery] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("member");
  const [inviting, setInviting] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<Invitation | null>(null);
  const [revoking, setRevoking] = useState(false);

  const pendingInvitations = useMemo(
    () => invitations.filter((invitation) => invitation.status === "pending"),
    [invitations],
  );
  const activeAgents = useMemo(
    () => agents.filter((agent) => !agent.archived_at),
    [agents],
  );
  const agentsByOwner = useMemo(() => {
    const map = new Map<string, Agent[]>();
    for (const agent of activeAgents) {
      if (!agent.owner_id) continue;
      const list = map.get(agent.owner_id) ?? [];
      list.push(agent);
      map.set(agent.owner_id, list);
    }
    return map;
  }, [activeAgents]);

  const admins = members.filter(
    (member) => member.role === "owner" || member.role === "admin",
  );
  const total = members.length + pendingInvitations.length;
  const membersWithAgents = members.filter(
    (member) => (agentsByOwner.get(member.user_id)?.length ?? 0) > 0,
  ).length;

  const roleLabel = (role: MemberRole) =>
    role === "owner"
      ? t(($) => $.role.owner)
      : role === "admin"
        ? t(($) => $.role.admin)
        : t(($) => $.role.member);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }),
    [locale],
  );
  const formatDate = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date);
  };
  const syncTime = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = (member: MemberWithUser) => {
    if (!normalizedQuery) return true;
    const agentNames = (agentsByOwner.get(member.user_id) ?? [])
      .map((agent) => agent.name)
      .join(" ");
    return [member.name, member.email, roleLabel(member.role), agentNames]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  };

  const visibleMembers = members.filter((member) => {
    if (filter === "admin" && member.role !== "owner" && member.role !== "admin") {
      return false;
    }
    if (
      filter === "agents" &&
      (agentsByOwner.get(member.user_id)?.length ?? 0) === 0
    ) {
      return false;
    }
    if (filter === "pending") return false;
    return matchesQuery(member);
  });
  const visibleInvitations =
    canManage && (filter === "all" || filter === "pending")
      ? pendingInvitations.filter((invitation) => {
          if (!normalizedQuery) return true;
          return invitation.invitee_email
            .toLowerCase()
            .includes(normalizedQuery);
        })
      : [];
  const visibleCount = visibleMembers.length + visibleInvitations.length;

  const tabs: { id: DirectoryFilter; label: string; count: number }[] = [
    { id: "all", label: t(($) => $.directory.tabs.all), count: total },
    { id: "admin", label: t(($) => $.directory.tabs.admin), count: admins.length },
    ...(canManage
      ? [
          {
            id: "pending" as const,
            label: t(($) => $.directory.tabs.pending),
            count: pendingInvitations.length,
          },
        ]
      : []),
    {
      id: "agents",
      label: t(($) => $.directory.tabs.agents),
      count: membersWithAgents,
    },
  ];

  const clearFilters = () => {
    setFilter("all");
    setQuery("");
  };

  const handleInvite = async () => {
    if (!workspace) return;
    const email = inviteEmail.trim();
    if (!email) return;
    setInviting(true);
    try {
      await api.createMember(workspace.id, { email, role: inviteRole });
      qc.invalidateQueries({ queryKey: workspaceKeys.invitations(wsId) });
      toast.success(t(($) => $.directory.invite_sent));
      setInviteEmail("");
      setInviteRole("member");
      setInviteOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t(($) => $.directory.invite_failed),
      );
    } finally {
      setInviting(false);
    }
  };

  const handleRevoke = async () => {
    if (!workspace || !revokeTarget) return;
    setRevoking(true);
    try {
      await api.revokeInvitation(workspace.id, revokeTarget.id);
      qc.invalidateQueries({ queryKey: workspaceKeys.invitations(wsId) });
      toast.success(t(($) => $.directory.revoke_done));
      setRevokeTarget(null);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t(($) => $.directory.revoke_failed),
      );
    } finally {
      setRevoking(false);
    }
  };

  const agentStack = (member: MemberWithUser) => {
    const owned = agentsByOwner.get(member.user_id) ?? [];
    if (owned.length === 0) {
      return (
        <span className="qw-mbr-agents-empty">
          {t(($) => $.directory.no_agents)}
        </span>
      );
    }
    const shown = owned.slice(0, 2);
    const extra = owned.length - shown.length;
    return (
      <>
        <span
          className="qw-mbr-agents-stack"
          title={owned.map((agent) => agent.name).join(" · ")}
        >
          {shown.map((agent) => (
            <span key={agent.id} className="qw-mbr-agent-ava">
              <ActorAvatarBase
                name={agent.name}
                initials={initialsOf(agent.name)}
                avatarUrl={resolvePublicFileUrl(agent.avatar_url)}
                isAgent
                size="xs"
              />
            </span>
          ))}
          {extra > 0 ? (
            <span className="qw-mbr-agent-ava qw-mbr-agent-more">+{extra}</span>
          ) : null}
        </span>
        <span className="qw-mbr-agents-count">{owned.length}</span>
      </>
    );
  };

  return (
    <div className="qw-mbr-page">
      <header className="qw-mbr-masthead">
        <div className="qw-mbr-mast-main">
          <div className="qw-mbr-mast-line">
            <h1>{t(($) => $.directory.title)}</h1>
            <span className="qw-mbr-count">
              <b>{total}</b>
              <span>{t(($) => $.directory.cap)}</span>
            </span>
            {canManage ? (
              <div className="qw-mbr-mast-actions">
                <button
                  type="button"
                  className="qw-mbr-create"
                  onClick={() => setInviteOpen(true)}
                >
                  <span className="plus">
                    <Plus className="size-3" aria-hidden="true" />
                  </span>
                  {t(($) => $.directory.invite)}
                </button>
              </div>
            ) : null}
          </div>
          <p className="qw-mbr-live">
            <b>{members.length}</b>
            {t(($) => $.directory.members_unit, { count: members.length })}
            <span className="sep">·</span>
            <b>{admins.length}</b>
            {t(($) => $.directory.admins_unit, { count: admins.length })}
            {canManage ? (
              <>
                <span className="sep">·</span>
                <span className="lamp pending" aria-hidden="true" />
                <b>{pendingInvitations.length}</b>
                {t(($) => $.directory.pending_unit, {
                  count: pendingInvitations.length,
                })}
              </>
            ) : null}
            <span className="sep">·</span>
            <span className="quiet">
              <b>{activeAgents.length}</b>
              {t(($) => $.directory.agents_unit, {
                count: activeAgents.length,
              })}
            </span>
          </p>
        </div>
        <div className="qw-mbr-sync">
          <span className="sync">
            <i aria-hidden="true" />
            SYNCED
          </span>
          <span className="time">{syncTime}</span>
          <span className="hint">{t(($) => $.directory.sync_hint)}</span>
        </div>
      </header>

      <div className="qw-mbr-toolbar">
        <div
          className="qw-mbr-tabs"
          role="tablist"
          aria-label={t(($) => $.directory.tabs_aria)}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={filter === tab.id}
              className="qw-mbr-tab"
              data-on={filter === tab.id ? "" : undefined}
              onClick={() => setFilter(tab.id)}
            >
              {tab.label}
              <em>{tab.count}</em>
            </button>
          ))}
        </div>
        <div className="qw-mbr-toolbar-right">
          <label className="qw-mbr-search">
            <Search className="size-3" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setQuery("");
              }}
              placeholder={t(($) => $.directory.search_placeholder)}
              aria-label={t(($) => $.directory.search_aria)}
              autoComplete="off"
            />
          </label>
        </div>
      </div>

      <div className="qw-mbr-board">
        <div className="qw-mbr-thead">
          <span>{t(($) => $.directory.columns.member)}</span>
          <span>{t(($) => $.directory.columns.role)}</span>
          <span className="th-agents">
            {t(($) => $.directory.columns.agents)}
          </span>
          <span>{t(($) => $.directory.columns.state)}</span>
          <span className="th-joined">{t(($) => $.directory.columns.joined)}</span>
          <span />
        </div>

        {isLoading ? (
          <div className="qw-mbr-empty">{t(($) => $.directory.loading)}</div>
        ) : visibleCount === 0 ? (
          <div className="qw-mbr-empty">
            <span>{t(($) => $.directory.no_matches)}</span>
            <button type="button" onClick={clearFilters}>
              {t(($) => $.directory.clear)}
            </button>
          </div>
        ) : (
          <>
            {visibleMembers.map((member) => {
              const isMe = member.user_id === currentUser?.id;
              return (
                <button
                  key={member.id}
                  type="button"
                  className="qw-mbr-row"
                  aria-label={t(($) => $.directory.open_member, {
                    name: member.name,
                  })}
                  onClick={() => navigation.push(paths.memberDetail(member.user_id))}
                >
                  <span className="qw-mbr-person">
                    <span className="qw-mbr-avatar">
                      <ActorAvatarBase
                        name={member.name}
                        initials={initialsOf(member.name)}
                        avatarUrl={resolvePublicFileUrl(member.avatar_url)}
                        size="lg"
                      />
                    </span>
                    <span className="qw-mbr-id">
                      <span className="qw-mbr-name">
                        {member.name}
                        {isMe ? (
                          <em className="qw-mbr-you">
                            {t(($) => $.directory.you)}
                          </em>
                        ) : null}
                      </span>
                      <span className="qw-mbr-email">{member.email}</span>
                    </span>
                  </span>
                  <span className="qw-mbr-role" data-role={member.role}>
                    {roleLabel(member.role)}
                  </span>
                  <span className="qw-mbr-agents">{agentStack(member)}</span>
                  <span className="qw-mbr-state" data-state="member">
                    <i aria-hidden="true" />
                    {t(($) => $.directory.state_member)}
                  </span>
                  <span className="qw-mbr-joined">
                    {formatDate(member.created_at)}
                  </span>
                  <span className="qw-mbr-go">
                    <ArrowRight className="size-3" aria-hidden="true" />
                  </span>
                </button>
              );
            })}

            {visibleInvitations.map((invitation) => (
              <button
                key={invitation.id}
                type="button"
                className="qw-mbr-row pending"
                aria-label={
                  canManage
                    ? t(($) => $.directory.revoke_aria, {
                        email: invitation.invitee_email,
                      })
                    : invitation.invitee_email
                }
                onClick={() => {
                  if (canManage) setRevokeTarget(invitation);
                }}
              >
                <span className="qw-mbr-person">
                  <span className="qw-mbr-avatar pending">
                    <ActorAvatarBase
                      name={invitation.invitee_email}
                      initials={initialsOf(invitation.invitee_email)}
                      size="lg"
                    />
                  </span>
                  <span className="qw-mbr-id">
                    <span className="qw-mbr-name">
                      {invitation.invitee_email}
                    </span>
                    <span className="qw-mbr-email">
                      {t(($) => $.directory.invited_email)}
                    </span>
                  </span>
                </span>
                <span className="qw-mbr-role" data-role={invitation.role}>
                  {roleLabel(invitation.role)}
                </span>
                <span className="qw-mbr-agents">
                  <span className="qw-mbr-agents-empty">
                    {t(($) => $.directory.no_agents)}
                  </span>
                </span>
                <span className="qw-mbr-state" data-state="pending">
                  <i aria-hidden="true" />
                  {t(($) => $.directory.state_pending)}
                </span>
                <span className="qw-mbr-joined">
                  {formatDate(invitation.created_at)}
                </span>
                <span className="qw-mbr-go qw-mbr-go-revoke">
                  <X className="size-3" aria-hidden="true" />
                </span>
              </button>
            ))}
          </>
        )}
      </div>

      <footer className="qw-mbr-pager">
        <span className="sum">
          {visibleCount === total
            ? t(($) => $.directory.summary, {
                members: members.length,
                admins: admins.length,
                pending: pendingInvitations.length,
                agents: activeAgents.length,
              })
            : t(($) => $.directory.summary_filtered, {
                shown: visibleCount,
                total,
                pending: pendingInvitations.length,
                agents: activeAgents.length,
              })}
        </span>
        <span className="grow" />
        <span className="sum">{t(($) => $.directory.footer_hint)}</span>
      </footer>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="qw-mbr-dialog sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t(($) => $.directory.invite_title)}</DialogTitle>
            <DialogDescription>
              {t(($) => $.directory.invite_description)}
            </DialogDescription>
          </DialogHeader>
          <div className="qw-mbr-dialog-body">
            <label className="qw-mbr-field">
              <span>{t(($) => $.directory.invite_email)}</span>
              <input
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder={t(($) => $.directory.invite_email_placeholder)}
                autoComplete="email"
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleInvite();
                }}
              />
            </label>
            <label className="qw-mbr-field">
              <span>{t(($) => $.directory.invite_role)}</span>
              <select
                value={inviteRole}
                onChange={(event) =>
                  setInviteRole(event.target.value as MemberRole)
                }
              >
                <option value="member">{t(($) => $.role.member)}</option>
                <option value="admin">{t(($) => $.role.admin)}</option>
              </select>
            </label>
          </div>
          <DialogFooter className="qw-mbr-dialog-foot">
            <button
              type="button"
              className="qw-mbr-btn"
              onClick={() => setInviteOpen(false)}
              disabled={inviting}
            >
              {t(($) => $.directory.cancel)}
            </button>
            <button
              type="button"
              className="qw-mbr-btn primary"
              onClick={() => void handleInvite()}
              disabled={inviting || !inviteEmail.trim()}
            >
              {inviting
                ? t(($) => $.directory.inviting)
                : t(($) => $.directory.invite_button)}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!revokeTarget}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $.directory.revoke_title)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $.directory.revoke_description, {
                email: revokeTarget?.invitee_email ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>
              {t(($) => $.directory.cancel)}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={revoking}
              onClick={() => void handleRevoke()}
            >
              {revoking
                ? t(($) => $.directory.revoking)
                : t(($) => $.directory.revoke_confirm)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
