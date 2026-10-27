"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  FolderGit,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  Trash2,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  projectListOptions,
  useDeleteProject,
  useUpdateProject,
} from "@quickwork/core/projects";
import { pinListOptions, useCreatePin, useDeletePin } from "@quickwork/core/pins";
import { projectTaskListOptions } from "@quickwork/core/issues/queries";
import { issueBehavesAs } from "@quickwork/core/issues";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useWorkspacePaths } from "@quickwork/core/paths";
import { useAuthStore } from "@quickwork/core/auth";
import { useModalStore } from "@quickwork/core/modals";
import { useActorName } from "@quickwork/core/workspace/hooks";
import { memberListOptions } from "@quickwork/core/workspace/queries";
import { useStatusLabel } from "../../issues/utils/status-label";
import { ActorAvatar } from "../../common/actor-avatar";
import { AppLink, useNavigation } from "../../navigation";
import { ContentEditor, TitleEditor } from "../../editor";
import { Skeleton } from "@quickwork/ui/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@quickwork/ui/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@quickwork/ui/components/ui/popover";
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
import type {
  MemberWithUser,
  Project,
  ProjectStatus,
} from "@quickwork/core/types";
import { PROJECT_PRIORITY_ORDER, PROJECT_STATUS_ORDER } from "@quickwork/core/projects/config";
import { useT } from "../../i18n";
import { cn } from "@quickwork/ui/lib/utils";
import {
  useFormatRelativeDate,
  useProjectPriorityLabels,
  useProjectStatusLabels,
} from "./labels";

type ConsoleFilter = "all" | "in_progress" | "planned" | "paused";

const FILTERS: ConsoleFilter[] = ["all", "in_progress", "planned", "paused"];

function projectPct(project: Project): number {
  return project.issue_count > 0
    ? Math.round((project.done_count / project.issue_count) * 100)
    : 0;
}

function projectMode(project: Project): "in_place" | "worktree" {
  return project.local_directory?.execution_mode === "worktree"
    ? "worktree"
    : "in_place";
}

function projectPath(project: Project): string | null {
  return project.local_directory?.local_path ?? project.repo_url ?? null;
}

function projectGlyph(project: Project): string {
  if (project.icon) return project.icon;
  return project.title.trim().slice(0, 1).toUpperCase() || "·";
}

function statusState(status: ProjectStatus): "running" | "planned" | "paused" | "done" {
  if (status === "in_progress") return "running";
  if (status === "paused") return "paused";
  if (status === "completed" || status === "cancelled") return "done";
  return "planned";
}

export function ProjectsPage({ initialProjectId }: { initialProjectId?: string }) {
  const { t } = useT("projects");
  const wsId = useWorkspaceId();
  const wsPaths = useWorkspacePaths();
  const statusLabels = useProjectStatusLabels();
  const priorityLabels = useProjectPriorityLabels();
  const relativeDate = useFormatRelativeDate();
  const stateLabel = useStatusLabel(wsId);
  const { getActorName } = useActorName();
  const currentUser = useAuthStore((s) => s.user);
  const navigation = useNavigation();

  const { data: projects = [], isLoading } = useQuery(projectListOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: pins = [] } = useQuery({
    ...pinListOptions(wsId, currentUser?.id ?? ""),
    enabled: !!currentUser?.id,
  });
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  const createPin = useCreatePin();
  const deletePin = useDeletePin();

  const [filter, setFilter] = useState<ConsoleFilter>("all");
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialProjectId ?? null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const isAdmin = useMemo(() => {
    if (!currentUser) return false;
    const me = members.find((member: MemberWithUser) => member.user_id === currentUser.id);
    return me?.role === "owner" || me?.role === "admin";
  }, [members, currentUser]);

  const counts = useMemo(() => {
    const byStatus = (status: ProjectStatus) =>
      projects.filter((project) => project.status === status).length;
    return {
      all: projects.length,
      in_progress: byStatus("in_progress"),
      planned: byStatus("planned"),
      paused: byStatus("paused"),
      unowned: projects.filter((project) => !project.lead_id).length,
      tasks: projects.reduce((sum, project) => sum + project.issue_count, 0),
      done: projects.reduce((sum, project) => sum + project.done_count, 0),
    };
  }, [projects]);

  const visible = useMemo(() => {
    const filtered =
      filter === "all"
        ? projects
        : projects.filter((project) => project.status === filter);
    return [...filtered].sort((a, b) => {
      const diff = Date.parse(a.updated_at) - Date.parse(b.updated_at);
      return sortAsc ? diff : -diff;
    });
  }, [projects, filter, sortAsc]);

  useEffect(() => {
    if (projects.length === 0) return;
    if (selectedId && visible.some((project) => project.id === selectedId)) return;
    if (
      !selectedId &&
      initialProjectId &&
      projects.some((project) => project.id === initialProjectId)
    ) {
      setSelectedId(initialProjectId);
      return;
    }
    setSelectedId(visible[0]?.id ?? null);
  }, [selectedId, visible, initialProjectId, projects]);

  const selected = useMemo(
    () => projects.find((project) => project.id === selectedId) ?? null,
    [projects, selectedId],
  );
  const selectedIndex = selected
    ? projects.findIndex((project) => project.id === selected.id) + 1
    : 0;
  const selectedTasksQuery = useQuery({
    ...projectTaskListOptions(wsId, selected?.id ?? ""),
    enabled: !!selected,
  });
  const selectedTasks = useMemo(
    () => (selected ? selectedTasksQuery.data ?? [] : []),
    [selected, selectedTasksQuery.data],
  );
  const pinIds = useMemo(
    () =>
      new Set(
        pins
          .filter((pin) => pin.item_type === "project")
          .map((pin) => pin.item_id),
      ),
    [pins],
  );
  const pinned = selected ? pinIds.has(selected.id) : false;
  const mode = selected ? projectMode(selected) : "in_place";
  const path = selected ? projectPath(selected) : null;
  const pct = selected ? projectPct(selected) : 0;

  const selectProject = (id: string) => {
    setSelectedId(id);
    if (initialProjectId) navigation.replace(wsPaths.projectDetail(id));
  };

  const openNewTask = () => {
    if (!selected) return;
    useModalStore.getState().open("quick-create-issue", { project_id: selected.id });
  };

  const openCreateProject = () => {
    useModalStore.getState().open("create-project");
  };

  const handleDelete = () => {
    if (!selected) return;
    const id = selected.id;
    deleteProject.mutate(id, {
      onSuccess: () => {
        toast.success(t(($) => $.detail.toast_project_deleted));
        setDeleteOpen(false);
        setSelectedId(null);
      },
    });
  };

  const handlePin = () => {
    if (!selected) return;
    if (pinned) deletePin.mutate({ itemType: "project", itemId: selected.id });
    else createPin.mutate({ item_type: "project", item_id: selected.id });
  };

  const copyPath = () => {
    if (!path) return;
    void navigator.clipboard?.writeText(path);
    toast.success(t(($) => $.console.path_copied));
  };

  const activity = useMemo(() => {
    if (!selected) return [];
    const taskRows = [...selectedTasks]
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
      .slice(0, 4)
      .map((task) => ({
        id: `task:${task.id}`,
        text: `${task.identifier} ${task.title} · ${stateLabel(task.status)}`,
        time: relativeDate(task.updated_at),
        done: issueBehavesAs(task, "done"),
      }));
    return [
      {
        id: "created",
        text: t(($) => $.console.project_created),
        time: relativeDate(selected.created_at),
        done: false,
      },
      {
        id: "updated",
        text: t(($) => $.console.project_updated),
        time: relativeDate(selected.updated_at),
        done: false,
      },
      ...taskRows,
    ];
  }, [selected, selectedTasks, relativeDate, stateLabel, t]);

  const filterLabel = (key: ConsoleFilter) =>
    key === "all"
      ? t(($) => $.console.all)
      : key === "in_progress"
        ? t(($) => $.console.in_progress)
        : key === "planned"
          ? t(($) => $.console.planned)
          : t(($) => $.console.paused);

  const now = new Date();
  const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  return (
    <div className="qw-pj-page">
      <header className="qw-pj-masthead">
        <div className="qw-pj-mast-main">
          <div className="qw-pj-mast-line">
            <h1>{t(($) => $.page.title)}</h1>
            <span className="qw-pj-count">
              <b>{projects.length}</b>
              <span>{t(($) => $.console.projects)}</span>
            </span>
            <button type="button" className="qw-pj-create" onClick={openCreateProject}>
              <span className="plus">
                <Plus className="size-3" />
              </span>
              {t(($) => $.console.new_project)}
              <span className="kbd">P</span>
            </button>
          </div>
          <p className="qw-pj-live">
            <b>{counts.in_progress}</b> {t(($) => $.console.in_progress)}
            <span>·</span>
            <b>{counts.planned}</b> {t(($) => $.console.planned)}
            <span>·</span>
            <b>{counts.paused}</b> {t(($) => $.console.paused)}
            <span>·</span>
            <em>
              <b>{counts.tasks}</b> {t(($) => $.console.tasks)} ·{" "}
              <b>{counts.done}</b> {t(($) => $.console.done)}
            </em>
            <span>·</span>
            <em>
              <b>{counts.unowned}</b> {t(($) => $.console.unowned)}
            </em>
          </p>
        </div>
        <div className="qw-pj-sync">
          <span className="sync">
            <i />
            SYNCED
          </span>
          <span className="time">{clock}</span>
          <span className="hint">{t(($) => $.console.sync_hint)}</span>
        </div>
      </header>

      <div className="qw-pj-toolbar">
        <div className="qw-pj-tabs" role="tablist">
          {FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              data-active={filter === key ? "" : undefined}
              onClick={() => setFilter(key)}
              className="qw-pj-tab"
            >
              {filterLabel(key)}
              <em>{counts[key]}</em>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="qw-pj-sort"
          aria-label={t(($) => $.console.sort_recent)}
          onClick={() => setSortAsc((value) => !value)}
        >
          {sortAsc ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />}
          {sortAsc ? t(($) => $.console.sort_oldest) : t(($) => $.console.sort_recent)}
        </button>
      </div>

      {isLoading ? (
        <div className="qw-pj-loading">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-[68px] w-full rounded-none" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="qw-pj-empty">
          <h3>{t(($) => $.page.empty)}</h3>
          <p>{t(($) => $.console.empty_filter_hint)}</p>
          <button type="button" className="qw-pj-primary" onClick={openCreateProject}>
            <Plus className="size-3.5" />
            {t(($) => $.console.new_project)}
          </button>
        </div>
      ) : (
        <div className="qw-pj-desk">
          <section className="qw-pj-list" aria-label={t(($) => $.page.title)}>
            <div className="qw-pj-head">
              <span className="col-project">{t(($) => $.console.list_project)}</span>
              <span className="col-state">{t(($) => $.console.list_state)}</span>
              <span className="col-progress">{t(($) => $.console.list_progress)}</span>
              <span className="col-owner">{t(($) => $.console.list_owner)}</span>
              <span className="col-time">{t(($) => $.console.list_time)}</span>
            </div>
            <div className="qw-pj-scroll">
              {visible.length === 0 ? (
                <div className="qw-pj-empty small">
                  <h3>{t(($) => $.console.empty_filter)}</h3>
                  <p>{t(($) => $.console.empty_filter_hint)}</p>
                </div>
              ) : (
                visible.map((project, index) => {
                  const done = project.done_count;
                  const total = project.issue_count;
                  const progress = projectPct(project);
                  const projectModeValue = projectMode(project);
                  const projectPathValue = projectPath(project);
                  const active = project.id === selectedId;
                  const lead =
                    project.lead_type && project.lead_id
                      ? getActorName(project.lead_type, project.lead_id)
                      : null;
                  return (
                    <button
                      key={project.id}
                      type="button"
                      className="qw-pj-row"
                      data-active={active ? "" : undefined}
                      style={{ animationDelay: `${Math.min(index * 24, 120)}ms` }}
                      onClick={() => selectProject(project.id)}
                    >
                      <span className="qw-pj-glyph">{projectGlyph(project)}</span>
                      <span className="qw-pj-row-main">
                        <b>{project.title}</b>
                        <span className="desc">{project.description || "—"}</span>
                        <span className="meta">
                          <span className={cn("priority", project.priority === "urgent" && "urgent")}>
                            {t(($) => $.table.priority)} {priorityLabels[project.priority]}
                          </span>
                          <span className="mode">{projectModeValue === "worktree" ? t(($) => $.console.worktree) : t(($) => $.console.in_place)}</span>
                          <span className="path">
                            <FolderGit className="size-2.5" />
                            {projectPathValue || t(($) => $.console.no_path)}
                          </span>
                        </span>
                      </span>
                      <span className="qw-pj-state" data-state={statusState(project.status)}>
                        <i />
                        {statusLabels[project.status]}
                      </span>
                      <span className="qw-pj-progress" data-empty={total === 0 ? "" : undefined} data-state={statusState(project.status)}>
                        <span className="bar">
                          <i style={{ width: `${progress}%` }} />
                        </span>
                        <span className="num">
                          <span>{total ? `${t(($) => $.console.tasks_count, { done, total })} ${t(($) => $.console.tasks)}` : "—"}</span>
                          <span>{total ? `${progress}%` : "—"}</span>
                        </span>
                      </span>
                      <span className="qw-pj-owner">
                        {project.lead_type && project.lead_id ? (
                          <>
                            <ActorAvatar
                              actorType={project.lead_type}
                              actorId={project.lead_id}
                              size="xs"
                              profileLink={false}
                              className="qw-pj-owner-ava"
                            />
                            <span>{lead}</span>
                          </>
                        ) : (
                          <>
                            <span className="dash">?</span>
                            <span>{t(($) => $.console.no_owner)}</span>
                          </>
                        )}
                      </span>
                      <span className="qw-pj-time">{relativeDate(project.updated_at)}</span>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <aside className="qw-pj-pane" aria-label={t(($) => $.console.pane_hint)}>
            {!selected ? (
              <div className="qw-pj-pane-empty">{t(($) => $.console.pane_empty)}</div>
            ) : (
              <div className="qw-pj-pane-body" key={selected.id}>
                <div className="qw-pj-pane-head">
                  <div className="qw-pj-pane-kicker">
                    {t(($) => $.console.pane_kicker, {
                      index: String(selectedIndex).padStart(2, "0"),
                      priority: priorityLabels[selected.priority],
                      mode: mode === "worktree" ? t(($) => $.console.worktree) : t(($) => $.console.in_place),
                    })}
                  </div>
                  <div className="qw-pj-pane-title-row">
                    <span className="qw-pj-pane-glyph">{projectGlyph(selected)}</span>
                    <TitleEditor
                      key={selected.id}
                      defaultValue={selected.title}
                      placeholder={t(($) => $.detail.title_placeholder)}
                      className="qw-pj-pane-title"
                      onBlur={(value) => {
                        const title = value.trim();
                        if (title && title !== selected.title) {
                          updateProject.mutate({ id: selected.id, title });
                        }
                      }}
                    />
                  </div>
                  <div className="qw-pj-pane-status">
                    <span className="qw-pj-pstate" data-state={statusState(selected.status)}>
                      <i />
                      {statusLabels[selected.status]}
                    </span>
                    <span className="qw-pj-pane-time">{relativeDate(selected.updated_at)}</span>
                    <div className="qw-pj-pane-actions">
                      <Popover>
                        <PopoverTrigger
                          render={
                            <button type="button" className="qw-pj-btn">
                              {t(($) => $.console.edit)}
                            </button>
                          }
                        />
                        <PopoverContent align="end" className="qw-pj-edit-pop">
                          <div className="qw-pj-edit-label">{t(($) => $.table.status)}</div>
                          <div className="qw-pj-edit-options">
                            {PROJECT_STATUS_ORDER.map((status) => (
                              <button
                                key={status}
                                type="button"
                                data-active={status === selected.status ? "" : undefined}
                                onClick={() => updateProject.mutate({ id: selected.id, status })}
                              >
                                {statusLabels[status]}
                              </button>
                            ))}
                          </div>
                          <div className="qw-pj-edit-label">{t(($) => $.table.priority)}</div>
                          <div className="qw-pj-edit-options">
                            {PROJECT_PRIORITY_ORDER.map((priority) => (
                              <button
                                key={priority}
                                type="button"
                                data-active={priority === selected.priority ? "" : undefined}
                                onClick={() => updateProject.mutate({ id: selected.id, priority })}
                              >
                                {priorityLabels[priority]}
                              </button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <button type="button" className="qw-pj-btn primary" onClick={openNewTask}>
                        {t(($) => $.console.new_task)}
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <button type="button" className="qw-pj-iconbtn" aria-label={t(($) => $.console.edit)}>
                              <MoreHorizontal className="size-3.5" />
                            </button>
                          }
                        />
                        <DropdownMenuContent align="end" className="w-auto">
                          <DropdownMenuItem onClick={handlePin}>
                            {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                            {pinned ? t(($) => $.detail.unpin_tooltip) : t(($) => $.detail.pin_tooltip)}
                          </DropdownMenuItem>
                          {isAdmin ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                                <Trash2 className="size-3.5" />
                                {t(($) => $.console.delete)}
                              </DropdownMenuItem>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  <div className="qw-pj-pane-progress">
                    <span className="num"><b>{selected.done_count}</b> / {selected.issue_count}</span>
                    <span className="bar"><i style={{ width: `${pct}%` }} /></span>
                    <span className="pct">{pct}%</span>
                  </div>
                </div>

                <div className="qw-pj-pane-scroll">
                  <section className="qw-pj-sec">
                    <div className="qw-pj-label">{t(($) => $.console.goal)}</div>
                    <ContentEditor
                      key={`${selected.id}-goal`}
                      value={selected.description || ""}
                      placeholder={t(($) => $.detail.description_placeholder)}
                      className="qw-pj-goal-editor"
                      onUpdate={(markdown) =>
                        updateProject.mutate({ id: selected.id, description: markdown || null })
                      }
                      debounceMs={1200}
                    />
                    <div className="qw-pj-note">{t(($) => $.console.goal_note)}</div>
                  </section>

                  <section className="qw-pj-sec">
                    <div className="qw-pj-label">
                      {t(($) => $.console.tasks_section)}
                      <span>{t(($) => $.console.tasks_count, { done: selected.done_count, total: selected.issue_count })}</span>
                    </div>
                    <div className="qw-pj-tasks">
                      {selectedTasksQuery.isLoading ? (
                        <Skeleton className="h-10 w-full" />
                      ) : selectedTasks.length === 0 ? (
                        <div className="qw-pj-task-empty">
                          {t(($) => $.console.no_tasks)}
                          <button type="button" className="qw-pj-btn" onClick={openNewTask}>
                            {t(($) => $.console.new_task)}
                          </button>
                        </div>
                      ) : (
                        selectedTasks.map((task) => (
                          <AppLink
                            key={task.id}
                            href={wsPaths.issueDetail(task.id)}
                            className="qw-pj-task"
                            data-done={issueBehavesAs(task, "done") ? "" : undefined}
                          >
                            <div className="qw-pj-task-top">
                              <span className="qw-pj-task-title">{task.title}</span>
                              <span className="qw-pj-task-open">{t(($) => $.console.task_open)}</span>
                            </div>
                            <div className="qw-pj-task-sub">
                              <span>{task.identifier}</span>
                              <span className="qw-pj-task-state" data-done={issueBehavesAs(task, "done") ? "" : undefined}>
                                <i />
                                {stateLabel(task.status)}
                              </span>
                              <span>{relativeDate(task.updated_at)}</span>
                            </div>
                          </AppLink>
                        ))
                      )}
                    </div>
                  </section>

                  <section className="qw-pj-sec">
                    <div className="qw-pj-label">
                      {t(($) => $.console.workspace)}
                      <span>{mode === "worktree" ? t(($) => $.console.worktree) : t(($) => $.console.in_place)}</span>
                    </div>
                    <div className="qw-pj-pathbox">
                      <FolderGit className="size-3" />
                      <code>{path || t(($) => $.console.no_path)}</code>
                      {path ? (
                        <button type="button" onClick={copyPath} aria-label={t(($) => $.console.copy_path)}>
                          {t(($) => $.console.copy_path)}
                        </button>
                      ) : null}
                    </div>
                    <div className="qw-pj-note">
                      {mode === "worktree"
                        ? t(($) => $.console.path_note_worktree)
                        : t(($) => $.console.path_note_in_place)}
                    </div>
                  </section>

                  <section className="qw-pj-sec">
                    <div className="qw-pj-label">
                      {t(($) => $.console.activity)}
                      <span>{t(($) => $.console.activity_count, { count: activity.length })}</span>
                    </div>
                    <div className="qw-pj-acts">
                      {activity.map((entry) => (
                        <div key={entry.id} className="qw-pj-act" data-done={entry.done ? "" : undefined}>
                          <i />
                          <span className="text">{entry.text}</span>
                          <span className="time">{entry.time}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      <footer className="qw-pj-foot">
        <span>
          {t(($) => $.console.summary, {
            projects: visible.length,
            tasks: visible.reduce((sum, project) => sum + project.issue_count, 0),
            done: visible.reduce((sum, project) => sum + project.done_count, 0),
          })}
        </span>
        <span className="grow" />
        <span>{t(($) => $.console.pane_hint)}</span>
      </footer>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(($) => $.console.delete_title)}</AlertDialogTitle>
            <AlertDialogDescription>{t(($) => $.console.delete_desc)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(($) => $.console.cancel)}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {t(($) => $.console.delete)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
