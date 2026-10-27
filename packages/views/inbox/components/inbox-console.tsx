"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCheck,
  ListChecks,
  MessagesSquare,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import type {
  Agent,
  InboxItem,
  Issue,
  MemberWithUser,
  Project,
  Squad,
} from "@quickwork/core/types";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useWorkspacePaths } from "@quickwork/core/paths";
import {
  archivedInboxListOptions,
  inboxListOptions,
} from "@quickwork/core/inbox/queries";
import {
  useArchiveInbox,
  useDeleteArchivedInbox,
  useDeleteInboxItem,
  useDeleteReadInbox,
  useMarkAllInboxRead,
  useMarkInboxRead,
  useMarkInboxUnread,
  useUnarchiveInbox,
} from "@quickwork/core/inbox/mutations";
import { issuesByIdsOptions } from "@quickwork/core/issues/queries";
import { projectListOptions } from "@quickwork/core/projects/queries";
import {
  agentListOptions,
  memberListOptions,
  squadListOptions,
} from "@quickwork/core/workspace/queries";
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
import { useNavigation } from "../../navigation";
import { ActorAvatar } from "../../common/actor-avatar";
import { useT, useTimeAgo } from "../../i18n";
import { useStatusLabel } from "../../issues/utils/status-label";
import { priorityLabel } from "../../issues/utils/priority-label";
import { getInboxDisplayTitle } from "./inbox-display";
import { useTypeLabels } from "./inbox-detail-label";
import { useRetrySourceContextQuickCreate } from "@quickwork/core/inbox/mutations";

type ConsoleFilter = "all" | "unread" | "task" | "chat" | "archived";

const FILTERS: ConsoleFilter[] = ["all", "unread", "task", "chat", "archived"];

function isChatItem(item: InboxItem): boolean {
  return item.type === "squad_message";
}

function statusTone(status: string | null | undefined): string {
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

function ActorDisc({ item }: { item: InboxItem }) {
  const { t } = useT("inbox");
  if (item.actor_type === "member" || item.actor_type === "agent") {
    return (
      <span className="qw-nt-avatar">
        <ActorAvatar
          actorType={item.actor_type}
          actorId={item.actor_id ?? ""}
          size="lg"
        />
      </span>
    );
  }
  return (
    <span className="qw-nt-avatar qw-nt-avatar-system" aria-hidden="true">
      {t(($) => $.console.system_actor).charAt(0)}
    </span>
  );
}

export function InboxPage() {
  const { t } = useT("inbox");
  const { t: tIssues } = useT("issues");
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const timeAgo = useTimeAgo();
  const typeLabels = useTypeLabels();
  const statusLabelOf = useStatusLabel(wsId);
  const retrySourceContext = useRetrySourceContextQuickCreate();

  const {
    data: activeItems = [],
    isLoading,
    error,
    refetch,
  } = useQuery(inboxListOptions(wsId));
  const { data: archivedItems = [], isLoading: archivedLoading } = useQuery(
    archivedInboxListOptions(wsId),
  );
  const { data: squads = [] } = useQuery(squadListOptions(wsId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: projects = [] } = useQuery(projectListOptions(wsId));

  const squadsById = useMemo(() => {
    const map = new Map<string, Squad>();
    for (const squad of squads) map.set(squad.id, squad);
    return map;
  }, [squads]);
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
  const projectsById = useMemo(() => {
    const map = new Map<string, Project>();
    for (const project of projects) map.set(project.id, project);
    return map;
  }, [projects]);

  const issueIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of [...activeItems, ...archivedItems]) {
      if (item.issue_id) ids.add(item.issue_id);
    }
    return [...ids];
  }, [activeItems, archivedItems]);
  const { data: issues = [] } = useQuery(issuesByIdsOptions(wsId, issueIds));
  const issuesById = useMemo(() => {
    const map = new Map<string, Issue>();
    for (const issue of issues) map.set(issue.id, issue);
    return map;
  }, [issues]);

  const [filter, setFilter] = useState<ConsoleFilter>("all");
  const [selectedId, setSelectedId] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<InboxItem | null>(null);
  const [cleanupMode, setCleanupMode] = useState<"read" | "archived" | null>(
    null,
  );

  const markRead = useMarkInboxRead();
  const markUnread = useMarkInboxUnread();
  const archiveMutation = useArchiveInbox();
  const unarchiveMutation = useUnarchiveInbox();
  const markAllRead = useMarkAllInboxRead();
  const deleteItem = useDeleteInboxItem();
  const deleteRead = useDeleteReadInbox();
  const deleteArchived = useDeleteArchivedInbox();

  const counts = useMemo(() => {
    let unread = 0;
    let task = 0;
    let chat = 0;
    for (const item of activeItems) {
      if (!item.read) unread++;
      if (isChatItem(item)) chat++;
      else task++;
    }
    return {
      all: activeItems.length,
      unread,
      task,
      chat,
      archived: archivedItems.length,
    };
  }, [activeItems, archivedItems]);

  const visibleItems = useMemo(() => {
    if (filter === "archived") return archivedItems;
    if (filter === "unread") return activeItems.filter((item) => !item.read);
    if (filter === "task") return activeItems.filter((item) => !isChatItem(item));
    if (filter === "chat") return activeItems.filter(isChatItem);
    return activeItems;
  }, [filter, activeItems, archivedItems]);

  const groups = useMemo(() => {
    const tasks = visibleItems.filter((item) => !isChatItem(item));
    const chats = visibleItems.filter(isChatItem);
    return [
      { kind: "task" as const, items: tasks },
      { kind: "chat" as const, items: chats },
    ].filter((group) => group.items.length > 0);
  }, [visibleItems]);

  const selected = useMemo(
    () => visibleItems.find((item) => item.id === selectedId) ?? null,
    [visibleItems, selectedId],
  );

  const itemsLoading = isLoading || (filter === "archived" && archivedLoading);

  // Keep a valid selection as the filter, list, or archive changes.
  useEffect(() => {
    if (itemsLoading) return;
    if (selectedId && visibleItems.some((item) => item.id === selectedId)) {
      return;
    }
    const linkedIssue = navigation.searchParams.get("issue") ?? "";
    const linked = linkedIssue
      ? visibleItems.find(
          (item) => item.issue_id === linkedIssue || item.id === linkedIssue,
        )
      : undefined;
    setSelectedId(linked?.id ?? visibleItems[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsLoading, visibleItems, selectedId]);

  const nextSelectionAfter = useCallback(
    (id: string) => {
      const list = visibleItems;
      const index = list.findIndex((item) => item.id === id);
      if (index === -1) return;
      const next = list[index + 1] ?? list[index - 1] ?? null;
      setSelectedId(next?.id ?? "");
    },
    [visibleItems],
  );

  const handleArchive = (item: InboxItem) => {
    nextSelectionAfter(item.id);
    archiveMutation.mutate(item.id, {
      onSuccess: () => toast.success(t(($) => $.toasts.archived)),
      onError: (err) =>
        toast.error(
          err instanceof Error ? err.message : t(($) => $.errors.archive_failed),
        ),
    });
  };

  const handleUnarchive = (item: InboxItem) => {
    nextSelectionAfter(item.id);
    unarchiveMutation.mutate(item.id, {
      onSuccess: () => toast.success(t(($) => $.toasts.unarchived)),
      onError: (err) =>
        toast.error(
          err instanceof Error ? err.message : t(($) => $.errors.unarchive_failed),
        ),
    });
  };

  const handleMarkUnread = (item: InboxItem) => {
    markUnread.mutate(item.id, {
      onError: (err) =>
        toast.error(
          err instanceof Error
            ? err.message
            : t(($) => $.errors.mark_unread_failed),
        ),
    });
  };

  const handleMarkRead = (item: InboxItem) => {
    markRead.mutate(item.id, {
      onError: (err) =>
        toast.error(
          err instanceof Error ? err.message : t(($) => $.errors.mark_read_failed),
        ),
    });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    nextSelectionAfter(target.id);
    try {
      await deleteItem.mutateAsync(target.id);
      toast.success(t(($) => $.console.deleted_toast));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t(($) => $.console.delete_failed),
      );
    }
  };

  const handleCleanup = async () => {
    const mode = cleanupMode;
    setCleanupMode(null);
    if (!mode) return;
    try {
      if (mode === "archived") {
        const result = await deleteArchived.mutateAsync();
        setSelectedId("");
        setFilter("all");
        toast.success(
          t(($) => $.console.cleared_toast, { count: result.count }),
        );
      } else {
        const result = await deleteRead.mutateAsync();
        toast.success(
          t(($) => $.console.cleaned_toast, { count: result.count }),
        );
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : mode === "archived"
            ? t(($) => $.console.clear_failed)
            : t(($) => $.console.cleanup_failed),
      );
    }
  };

  const handleMarkAllRead = () => {
    markAllRead.mutate(undefined, {
      onSuccess: () => toast.success(t(($) => $.console.marked_all_toast)),
      onError: (err) =>
        toast.error(
          err instanceof Error
            ? err.message
            : t(($) => $.errors.mark_all_read_failed),
        ),
    });
  };

  const actorName = (item: InboxItem) => {
    if (item.actor_type === "agent" && item.actor_id) {
      return agentsById.get(item.actor_id)?.name;
    }
    if (item.actor_type === "member" && item.actor_id) {
      return membersById.get(item.actor_id)?.name;
    }
    return undefined;
  };

  const assigneeName = (issue: Issue | undefined) => {
    if (!issue?.assignee_id) return t(($) => $.console.no_assignee);
    if (issue.assignee_type === "agent") {
      return agentsById.get(issue.assignee_id)?.name;
    }
    if (issue.assignee_type === "squad") {
      return squadsById.get(issue.assignee_id)?.name;
    }
    return membersById.get(issue.assignee_id)?.name;
  };

  const clock = (() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes(),
    ).padStart(2, "0")}`;
  })();

  const tabLabel = (key: ConsoleFilter) =>
    key === "all"
      ? t(($) => $.console.filter_all)
      : key === "unread"
        ? t(($) => $.console.filter_unread)
        : key === "task"
          ? t(($) => $.console.filter_task)
          : key === "chat"
            ? t(($) => $.console.filter_chat)
            : t(($) => $.console.filter_archived);

  // Sliding tab underline, measured like the agents ledger.
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const [underline, setUnderline] = useState({ left: 0, width: 0 });
  useEffect(() => {
    const list = tabListRef.current;
    if (!list) return;
    const measure = () => {
      const active = list.querySelector<HTMLElement>("[data-active]");
      if (!active) return;
      setUnderline({ left: active.offsetLeft, width: active.offsetWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [filter, counts.all, counts.unread, counts.task, counts.chat, counts.archived]);

  const cleanupCount =
    filter === "archived" ? counts.archived : activeItems.filter((item) => item.read).length;
  const cleanupLabel =
    filter === "archived"
      ? t(($) => $.console.clear_archived)
      : t(($) => $.console.cleanup_read);

  const selectItem = (item: InboxItem) => {
    setSelectedId(item.id);
    setDetailOpen(true);
    if (!item.read && !item.archived) {
      markRead.mutate(item.id, {
        onError: (err) =>
          toast.error(
            err instanceof Error
              ? err.message
              : t(($) => $.errors.mark_read_failed),
          ),
      });
    }
  };

  return (
    <div className="qw-nt-page" data-detail={detailOpen ? "" : undefined}>
      <header className="qw-nt-masthead">
        <div className="qw-nt-mast-main">
          <div className="qw-nt-mast-line">
            <h1>{t(($) => $.page.title)}</h1>
            <span className="qw-nt-count">
              <b>{counts.unread}</b>
              <span>{t(($) => $.console.unread_cap)}</span>
            </span>
          </div>
          <p className="qw-nt-live">
            <b>{counts.task}</b> {t(($) => $.console.live_task)}
            <span className="sep">·</span>
            <b>{counts.chat}</b> {t(($) => $.console.live_chat)}
            <span className="sep">·</span>
            <span className="quiet">
              {t(($) => $.console.live_total, { count: counts.all })}
            </span>
          </p>
        </div>
        <div className="qw-nt-sync">
          <span className="sync">
            <i aria-hidden="true" />
            SYNCED
          </span>
          <span className="time">{clock}</span>
          <span className="hint">{t(($) => $.console.sync_hint)}</span>
        </div>
      </header>

      <div className="qw-nt-toolbar">
        <div className="qw-nt-tabs" role="tablist" ref={tabListRef}>
          <span
            className="qw-nt-tabline"
            style={{ left: underline.left, width: underline.width }}
            aria-hidden="true"
          />
          {FILTERS.map((key) => (
            <span key={key} className="qw-nt-tab-slot">
              {key === "archived" ? (
                <span className="qw-nt-tab-div" aria-hidden="true" />
              ) : null}
              <button
                type="button"
                role="tab"
                aria-selected={filter === key}
                data-active={filter === key ? "" : undefined}
                className="qw-nt-tab"
                onClick={() => setFilter(key)}
              >
                {tabLabel(key)}
                <em>{counts[key]}</em>
              </button>
            </span>
          ))}
        </div>
        <div className="qw-nt-toolbar-right">
          <button
            type="button"
            className="qw-nt-tool"
            onClick={() => setCleanupMode(filter === "archived" ? "archived" : "read")}
            disabled={cleanupCount === 0}
          >
            <Trash2 className="size-3" aria-hidden="true" />
            {cleanupLabel}
          </button>
          {filter !== "archived" ? (
            <button
              type="button"
              className="qw-nt-tool"
              onClick={handleMarkAllRead}
              disabled={counts.unread === 0 || markAllRead.isPending}
            >
              <CheckCheck className="size-3" aria-hidden="true" />
              {t(($) => $.console.mark_all_read)}
            </button>
          ) : null}
        </div>
      </div>

      <div className="qw-nt-body">
        <div className="qw-nt-list">
          {itemsLoading ? (
            <div className="qw-nt-loading">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="qw-nt-skeleton" />
              ))}
            </div>
          ) : error ? (
            <div className="qw-nt-empty">
              <h3>{t(($) => $.console.load_failed)}</h3>
              <button type="button" className="qw-nt-primary" onClick={() => refetch()}>
                {t(($) => $.console.try_again)}
              </button>
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="qw-nt-empty">{t(($) => $.console.empty)}</div>
          ) : (
            groups.map((group) => (
              <section key={group.kind} className="qw-nt-section">
                <div className="qw-nt-sec-head">
                  {group.kind === "task" ? (
                    <ListChecks className="size-3" aria-hidden="true" />
                  ) : (
                    <MessagesSquare className="size-3" aria-hidden="true" />
                  )}
                  {group.kind === "task"
                    ? t(($) => $.console.task_info)
                    : t(($) => $.console.chat_info)}
                  <span className="n">{group.items.length}</span>
                </div>
                {group.items.map((item) => {
                  const chat = isChatItem(item);
                  const issue = item.issue_id
                    ? issuesById.get(item.issue_id)
                    : undefined;
                  const status = item.issue_status ?? issue?.status ?? null;
                  const squad = chat
                    ? squadsById.get(item.details?.squad_id ?? "")
                    : undefined;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="qw-nt-row"
                      data-unread={!item.read && !item.archived ? "" : undefined}
                      data-active={selectedId === item.id ? "" : undefined}
                      aria-current={selectedId === item.id ? "true" : undefined}
                      onClick={() => selectItem(item)}
                    >
                      <ActorDisc item={item} />
                      <span className="qw-nt-row-main">
                        <span className="qw-nt-title">
                          {getInboxDisplayTitle(item)}
                        </span>
                        <span className="qw-nt-meta">
                          <span className="qw-nt-type">
                            {typeLabels[item.type]}
                          </span>
                          {chat ? (
                            <span className="qw-nt-status">
                              {squad?.name ?? t(($) => $.console.chat_info)}
                              {squad
                                ? ` · ${t(($) => $.console.squad_members, {
                                    count: squad.member_count ?? 0,
                                  })}`
                                : ""}
                            </span>
                          ) : issue?.identifier ? (
                            <>
                              <span className="qw-nt-code">
                                {issue.identifier}
                              </span>
                              {status ? (
                                <span
                                  className="qw-nt-status"
                                  data-tone={statusTone(status)}
                                >
                                  <i aria-hidden="true" />
                                  {statusLabelOf(status)}
                                </span>
                              ) : null}
                            </>
                          ) : null}
                        </span>
                      </span>
                      <span className="qw-nt-side">
                        <span className="qw-nt-time">
                          {timeAgo(item.created_at)}
                        </span>
                        {!item.read && !item.archived ? (
                          <i
                            className="qw-nt-unread"
                            aria-label={t(($) => $.console.filter_unread)}
                          />
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </section>
            ))
          )}
        </div>

        <aside className="qw-nt-context" aria-label={t(($) => $.console.select_prompt)}>
          {selected ? (
            <div className="qw-nt-ctx">
              <header className="qw-nt-ctx-head">
                <div className="qw-nt-ctx-top">
                  <button
                    type="button"
                    className="qw-nt-ctx-back"
                    onClick={() => setDetailOpen(false)}
                  >
                    <ArrowLeft className="size-3.5" aria-hidden="true" />
                    {t(($) => $.console.back)}
                  </button>
                  <div className="qw-nt-ctx-kicker">
                    {isChatItem(selected)
                      ? t(($) => $.console.chat_info)
                      : t(($) => $.console.task_info)}
                    <span className="type">
                      · {typeLabels[selected.type]}
                      {selected.archived ? ` · ${t(($) => $.console.archived_tag)}` : ""}
                    </span>
                  </div>
                  <div className="qw-nt-ctx-actions">
                    <button
                      type="button"
                      className="qw-nt-ctx-btn"
                      onClick={() =>
                        selected.read
                          ? handleMarkUnread(selected)
                          : handleMarkRead(selected)
                      }
                    >
                      <Check className="size-3" aria-hidden="true" />
                      <span className="lbl">
                        {selected.read
                          ? t(($) => $.console.mark_unread)
                          : t(($) => $.console.mark_read)}
                      </span>
                    </button>
                    {selected.archived ? (
                      <button
                        type="button"
                        className="qw-nt-ctx-btn"
                        onClick={() => handleUnarchive(selected)}
                      >
                        <ArchiveRestore className="size-3" aria-hidden="true" />
                        <span className="lbl">{t(($) => $.console.unarchive)}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="qw-nt-ctx-btn"
                        onClick={() => handleArchive(selected)}
                      >
                        <Archive className="size-3" aria-hidden="true" />
                        <span className="lbl">{t(($) => $.console.archive)}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="qw-nt-ctx-btn danger"
                      onClick={() => setDeleteTarget(selected)}
                    >
                      <Trash2 className="size-3" aria-hidden="true" />
                      <span className="lbl">{t(($) => $.console.delete)}</span>
                    </button>
                  </div>
                </div>
                <h2 className="qw-nt-ctx-title">
                  {getInboxDisplayTitle(selected)}
                </h2>
                <div className="qw-nt-ctx-actor">
                  <ActorDisc item={selected} />
                  {actorName(selected) ?? (
                    <span className="muted">{typeLabels[selected.type]}</span>
                  )}
                  <span className="qw-nt-ctx-time">
                    {timeAgo(selected.created_at)}
                  </span>
                </div>
              </header>

              {selected.body ? (
                <blockquote className="qw-nt-quote">{selected.body}</blockquote>
              ) : null}

              {selected.type === "quick_create_failed" &&
              selected.details?.source_context_id &&
              selected.details?.task_id ? (
                <button
                  type="button"
                  className="qw-nt-retry"
                  disabled={retrySourceContext.isPending}
                  onClick={async () => {
                    try {
                      await retrySourceContext.mutateAsync(
                        selected.details?.task_id ?? "",
                      );
                      toast.success(
                        t(($) => $.toasts.source_context_retry_started),
                      );
                    } catch {
                      toast.error(t(($) => $.errors.source_context_retry_failed));
                    }
                  }}
                >
                  {t(($) => $.detail.retry_with_context)}
                </button>
              ) : null}

              {isChatItem(selected) ? (
                squadSource(selected) ?? null
              ) : selected.issue_id ? (
                issueSource(selected) ?? null
              ) : null}
            </div>
          ) : (
            <div className="qw-nt-ctx-empty">
              {t(($) => $.console.select_prompt)}
            </div>
          )}
        </aside>
      </div>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(($) => $.console.delete_title)}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? t(($) => $.console.delete_body, {
                    title: getInboxDisplayTitle(deleteTarget),
                  })
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(($) => $.console.cancel)}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void handleDelete()}
            >
              {t(($) => $.console.confirm_delete)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!cleanupMode}
        onOpenChange={(open) => {
          if (!open) setCleanupMode(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {cleanupMode === "archived"
                ? t(($) => $.console.clear_archived_title)
                : t(($) => $.console.cleanup_read_title)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {cleanupMode === "archived"
                ? t(($) => $.console.clear_archived_body, {
                    count: counts.archived,
                  })
                : t(($) => $.console.cleanup_read_body, {
                    count: activeItems.filter((item) => item.read).length,
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(($) => $.console.cancel)}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void handleCleanup()}
            >
              {cleanupMode === "archived"
                ? t(($) => $.console.clear_archived)
                : t(($) => $.console.cleanup_read)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  function issueSource(item: InboxItem) {
    const issue = item.issue_id ? issuesById.get(item.issue_id) : undefined;
    if (!issue) return null;
    const status = item.issue_status ?? issue.status;
    const priority = item.issue_priority ?? issue.priority;
    const project = issue.project_id
      ? projectsById.get(issue.project_id)
      : undefined;
    return (
      <section className="qw-nt-source">
        <div className="qw-nt-label">{t(($) => $.console.source_issue)}</div>
        <div className="qw-nt-source-code">{issue.identifier}</div>
        <div className="qw-nt-source-title">{issue.title}</div>
        <div className="qw-nt-source-meta">
          <span className="qw-nt-status" data-tone={statusTone(status)}>
            <i aria-hidden="true" />
            {statusLabelOf(status)}
          </span>
          <span className="sep">·</span>
          <span>
            {t(($) => $.console.priority, {
              value: priorityLabel(priority, tIssues),
            })}
          </span>
          <span className="sep">·</span>
          <span>{assigneeName(issue) ?? t(($) => $.console.no_assignee)}</span>
          <span className="sep">·</span>
          <span>{project?.title ?? t(($) => $.console.no_project)}</span>
        </div>
        <button
          type="button"
          className="qw-nt-open"
          onClick={() =>
            item.issue_id && navigation.push(paths.issueDetail(item.issue_id))
          }
        >
          {t(($) => $.console.open_task)}
          <ArrowUpRight className="size-3" aria-hidden="true" />
        </button>
      </section>
    );
  }

  function squadSource(item: InboxItem) {
    const squadId = item.details?.squad_id ?? "";
    const squad = squadsById.get(squadId);
    if (!squad) return null;
    const leader = squad.member_preview?.find(
      (member) => member.role === "leader",
    );
    const leaderName =
      agentsById.get(squad.leader_id)?.name ??
      membersById.get(squad.leader_id)?.name ??
      (leader
        ? agentsById.get(leader.member_id)?.name ??
          membersById.get(leader.member_id)?.name
        : undefined);
    return (
      <section className="qw-nt-source">
        <div className="qw-nt-label">{t(($) => $.console.source_squad)}</div>
        <div className="qw-nt-source-code">
          {t(($) => $.console.squad_members, {
            count: squad.member_count ?? 0,
          })}
          {leaderName
            ? ` · ${t(($) => $.console.squad_leader, { name: leaderName })}`
            : ""}
        </div>
        <div className="qw-nt-source-title">{squad.name}</div>
        <div className="qw-nt-source-meta">{squad.description}</div>
        <button
          type="button"
          className="qw-nt-open"
          onClick={() => navigation.push(paths.squadDetail(squadId))}
        >
          {t(($) => $.console.open_squad)}
          <ArrowUpRight className="size-3" aria-hidden="true" />
        </button>
      </section>
    );
  }
}
