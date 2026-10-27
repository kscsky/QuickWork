"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Issue, MemberRole } from "@quickwork/core/types";
import { api } from "@quickwork/core/api";
import { useAuthStore } from "@quickwork/core/auth";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useWorkspacePaths } from "@quickwork/core/paths";
import {
  agentListOptions,
  memberListOptions,
  workspaceKeys,
} from "@quickwork/core/workspace/queries";
import { runtimeListOptions } from "@quickwork/core/runtimes";
import { useWorkspacePresenceMap } from "@quickwork/core/agents";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@quickwork/ui/components/ui/dropdown-menu";
import { Skeleton } from "@quickwork/ui/components/ui/skeleton";
import { ActorAvatar as ActorAvatarBase } from "@quickwork/ui/components/common/actor-avatar";
import { resolvePublicFileUrl } from "@quickwork/core/workspace/avatar-url";
import { AppLink, useNavigation } from "../navigation";
import { ActorAvatar } from "../common/actor-avatar";
import { useLocale, useT } from "../i18n";
import { useTimeAgo } from "../i18n/use-time-ago";
import { useStatusLabel } from "../issues/utils/status-label";

function statusTone(status: string): string {
  switch (status) {
    case "in_progress":
      return "brand";
    case "in_review":
      return "review";
    case "done":
      return "done";
    case "blocked":
      return "danger";
    default:
      return "muted";
  }
}

export function MemberDetailPage({ userId }: { userId: string }) {
  const { t } = useT("members");
  const locale = useLocale();
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const timeAgo = useTimeAgo();
  const statusLabelOf = useStatusLabel(wsId);

  const { data: members = [], isLoading } = useQuery(memberListOptions(wsId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));
  const { byAgent: presence } = useWorkspacePresenceMap(wsId);
  const { data: tasks = [] } = useQuery<Issue[]>({
    queryKey: ["issues", "member-assigned", wsId, userId],
    queryFn: async () => {
      const response = await api.listIssues({
        assignee_ids: [userId],
        assignee_types: ["member"],
        limit: 20,
        sort_by: "updated_at",
        sort_direction: "desc",
      });
      return response.issues;
    },
    enabled: !!wsId && !!userId,
  });

  const [removeOpen, setRemoveOpen] = useState(false);

  const member = members.find((m) => m.user_id === userId) ?? null;
  const me = members.find((m) => m.user_id === currentUser?.id) ?? null;
  const isAdmin = me?.role === "owner" || me?.role === "admin";
  const canManage =
    !!member &&
    isAdmin &&
    member.user_id !== currentUser?.id &&
    member.role !== "owner";

  const runtimesById = useMemo(() => {
    const map = new Map(runtimes.map((runtime) => [runtime.id, runtime]));
    return map;
  }, [runtimes]);

  const ownedAgents = useMemo(
    () => agents.filter((agent) => agent.owner_id === userId),
    [agents, userId],
  );
  const memberTasks = useMemo(
    () =>
      tasks.filter(
        (issue) =>
          issue.assignee_type === "member" && issue.assignee_id === userId,
      ),
    [tasks, userId],
  );

  const roleMutation = useMutation({
    mutationFn: (role: MemberRole) =>
      api.updateMember(wsId, member?.id ?? "", { role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workspaceKeys.members(wsId) });
      toast.success(t(($) => $.console.role_updated));
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t(($) => $.console.role_update_failed),
      ),
  });

  const removeMutation = useMutation({
    mutationFn: () => api.deleteMember(wsId, member?.id ?? ""),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workspaceKeys.members(wsId) });
      toast.success(t(($) => $.console.removed));
      navigation.push(paths.members());
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t(($) => $.console.remove_failed),
      ),
  });

  const roleLabel = (role: MemberRole) =>
    role === "owner"
      ? t(($) => $.role.owner)
      : role === "admin"
        ? t(($) => $.role.admin)
        : t(($) => $.role.member);

  const activity = useMemo(() => {
    if (!member) return [];
    const entries: { time: string; text: string }[] = [
      {
        time: member.created_at,
        text: `${member.name} ${t(($) => $.console.joined_space)}`,
      },
      ...ownedAgents.map((agent) => ({
        time: agent.created_at,
        text: t(($) => $.console.created_agent, { name: agent.name }),
      })),
      ...memberTasks.slice(0, 4).map((issue) => ({
        time: issue.updated_at,
        text: t(($) => $.console.updated_task, {
          code: issue.identifier,
          title: issue.title,
        }),
      })),
    ];
    return entries
      .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
      .slice(0, 6);
  }, [member, ownedAgents, memberTasks, t]);

  if (isLoading && !member) {
    return (
      <div className="qw-md-page">
        <div className="qw-md-loading">
          <Skeleton className="h-[46px] w-full rounded-none" />
          <Skeleton className="mt-6 h-24 w-full rounded-none" />
          <Skeleton className="mt-4 h-64 w-full rounded-none" />
        </div>
      </div>
    );
  }

  if (!member) {
    return (
      <div className="qw-md-page">
        <div className="qw-md-statepage">
          <UserRound className="size-7" aria-hidden="true" />
          <h3>{t(($) => $.detail.not_found_title)}</h3>
          <p>{t(($) => $.detail.not_found_description)}</p>
          <AppLink href={paths.members()} className="qw-md-btn">
            {t(($) => $.console.back)}
          </AppLink>
        </div>
      </div>
    );
  }

  const initials = member.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const joined = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(member.created_at));

  const roleOptions: MemberRole[] =
    me?.role === "owner" && member.role !== "owner"
      ? ["admin", "member"]
      : ["member"];

  return (
    <div className="qw-md-page">
      <header className="qw-md-topbar">
        <AppLink href={paths.members()} className="qw-md-back">
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          {t(($) => $.console.back)}
        </AppLink>
        <span className="qw-md-crumb">
          {t(($) => $.detail.members_breadcrumb)} / {member.name}
        </span>
        <span className="qw-md-role">{roleLabel(member.role)}</span>
      </header>

      <div className="qw-md-scroll">
        <div className="qw-md-wrap">
          <header className="qw-md-head">
            <span className="qw-md-avatar">
              <ActorAvatarBase
                name={member.name}
                initials={initials}
                avatarUrl={resolvePublicFileUrl(member.avatar_url)}
                size="xl"
              />
            </span>
            <div className="qw-md-head-main">
              <h1>
                {member.name}
                {member.user_id === currentUser?.id ? (
                  <em className="qw-md-you">{t(($) => $.console.you)}</em>
                ) : null}
              </h1>
              <p>
                {member.email} · {roleLabel(member.role)}
              </p>
            </div>
            {canManage ? (
              <div className="qw-md-actions">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button type="button" className="qw-md-btn">
                        {t(($) => $.console.manage_role)}
                        <ChevronDown className="size-3" aria-hidden="true" />
                      </button>
                    }
                  />
                  <DropdownMenuContent align="end" className="w-auto">
                    {roleOptions.map((role) => (
                      <DropdownMenuItem
                        key={role}
                        disabled={roleMutation.isPending || member.role === role}
                        onClick={() => roleMutation.mutate(role)}
                      >
                        {roleLabel(role)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <button
                  type="button"
                  className="qw-md-btn danger"
                  onClick={() => setRemoveOpen(true)}
                >
                  <Trash2 className="size-3" aria-hidden="true" />
                  {t(($) => $.console.remove_member)}
                </button>
              </div>
            ) : null}
          </header>

          <div className="qw-md-body">
            <div className="qw-md-main">
              <section className="qw-md-sec">
                <div className="qw-md-sec-head">
                  {t(($) => $.console.agents)}
                  <em>{ownedAgents.length}</em>
                </div>
                {ownedAgents.length === 0 ? (
                  <p className="qw-md-empty">{t(($) => $.console.no_agents)}</p>
                ) : (
                  ownedAgents.map((agent) => {
                    const runtime = runtimesById.get(agent.runtime_id);
                    const state = presence.get(agent.id);
                    return (
                      <div key={agent.id} className="qw-md-agent">
                        <ActorAvatar
                          actorType="agent"
                          actorId={agent.id}
                          size="md"
                        />
                        <span className="qw-md-agent-main">
                          <b>{agent.name}</b>
                          <span>
                            {runtime?.name ?? "—"} · {agent.model || "—"}
                          </span>
                        </span>
                        <span
                          className="qw-md-state"
                          data-on={
                            state?.workload === "working" ? "" : undefined
                          }
                        >
                          <i aria-hidden="true" />
                          {state?.workload === "working"
                            ? t(($) => $.console.running)
                            : t(($) => $.console.idle)}
                        </span>
                      </div>
                    );
                  })
                )}
              </section>

              <section className="qw-md-sec">
                <div className="qw-md-sec-head">
                  {t(($) => $.console.tasks)}
                  <em>{memberTasks.length}</em>
                </div>
                {memberTasks.length === 0 ? (
                  <p className="qw-md-empty">{t(($) => $.console.no_tasks)}</p>
                ) : (
                  memberTasks.slice(0, 8).map((issue) => (
                    <AppLink
                      key={issue.id}
                      href={paths.issueDetail(issue.id)}
                      className="qw-md-task"
                    >
                      <span className="qw-md-task-code">{issue.identifier}</span>
                      <span className="qw-md-task-main">{issue.title}</span>
                      <span
                        className="qw-md-task-state"
                        data-tone={statusTone(issue.status)}
                      >
                        <i aria-hidden="true" />
                        {statusLabelOf(issue.status)}
                      </span>
                    </AppLink>
                  ))
                )}
              </section>
            </div>

            <aside className="qw-md-side">
              <section className="qw-md-sec">
                <div className="qw-md-sec-head">{t(($) => $.console.profile)}</div>
                <div className="qw-md-fact">
                  <span>{t(($) => $.console.joined)}</span>
                  <b>{joined}</b>
                </div>
                <div className="qw-md-fact">
                  <span>{t(($) => $.console.role_label)}</span>
                  <b>{roleLabel(member.role)}</b>
                </div>
                <div className="qw-md-fact">
                  <span>{t(($) => $.console.agents_short)}</span>
                  <b>{ownedAgents.length}</b>
                </div>
                <div className="qw-md-fact">
                  <span>{t(($) => $.console.tasks_short)}</span>
                  <b>{memberTasks.length}</b>
                </div>
              </section>

              <section className="qw-md-sec">
                <div className="qw-md-sec-head">{t(($) => $.console.activity)}</div>
                {activity.length === 0 ? (
                  <p className="qw-md-empty">{t(($) => $.console.activity_empty)}</p>
                ) : (
                  <div className="qw-md-activity">
                    {activity.map((entry, index) => (
                      <div key={index} className="qw-md-act">
                        <b>{entry.text}</b>
                        <span>{timeAgo(entry.time)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <p className="qw-md-note">{t(($) => $.console.note)}</p>
            </aside>
          </div>
        </div>
      </div>

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(($) => $.console.remove_title)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $.console.remove_body, { name: member.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(($) => $.console.cancel)}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removeMutation.isPending}
              onClick={() => {
                setRemoveOpen(false);
                removeMutation.mutate();
              }}
            >
              {t(($) => $.console.confirm_remove)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
