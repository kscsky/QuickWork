"use client";

import { useState, useRef } from "react";
import { FolderOpen, GitBranch, Pencil, Search, X as XIcon } from "lucide-react";

/**
 * GitHub mark — lucide-react v1 dropped brand icons, so we inline the
 * Octicon-style mark here (24×24 viewBox, currentColor fill so it inherits
 * the parent's text color). Stays in this file because there's only one
 * caller; promote to packages/ui if a second use crops up.
 */
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 .5C5.73.5.66 5.57.66 11.84c0 5.01 3.25 9.26 7.76 10.76.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.13-3.16.69-3.83-1.34-3.83-1.34-.52-1.31-1.27-1.66-1.27-1.66-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.52-.29-5.18-1.26-5.18-5.62 0-1.24.45-2.26 1.18-3.06-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.15 1.17a10.93 10.93 0 0 1 5.74 0c2.19-1.48 3.15-1.17 3.15-1.17.62 1.57.23 2.73.11 3.02.74.8 1.18 1.82 1.18 3.06 0 4.37-2.67 5.32-5.21 5.61.41.35.78 1.04.78 2.1 0 1.52-.01 2.74-.01 3.11 0 .3.21.66.79.55 4.51-1.5 7.76-5.75 7.76-10.76C23.34 5.57 18.27.5 12 .5Z" />
    </svg>
  );
}
import { useQuery } from "@tanstack/react-query";
import { useCreateProject } from "@quickwork/core/projects/mutations";
import { useProjectDraftStore } from "@quickwork/core/projects";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useCurrentWorkspace, useWorkspacePaths } from "@quickwork/core/paths";
import { cn } from "@quickwork/ui/lib/utils";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@quickwork/ui/components/ui/dialog";
import { Popover, PopoverTrigger, PopoverContent } from "@quickwork/ui/components/ui/popover";
import { Tooltip, TooltipTrigger, TooltipContent } from "@quickwork/ui/components/ui/tooltip";
import { Button } from "@quickwork/ui/components/ui/button";
import { EmojiPicker } from "@quickwork/ui/components/common/emoji-picker";
import { ContentEditor, type ContentEditorRef, TitleEditor } from "../editor";
import { useNavigation } from "../navigation";
import { useT } from "../i18n";
import { githubShortLabel } from "../common/github-url";
import {
  isDesktopShell,
  pickDirectory,
  validateLocalDirectory,
} from "../platform/local-directory";
import { useLocalDaemonStatus } from "../platform/use-local-daemon-status";
import {
  runtimeAdvertisesLocalWorktree,
  runtimeListOptions,
} from "@quickwork/core/runtimes";
import { useConfigStore } from "@quickwork/core/config";
import type { LocalDirectoryExecutionMode } from "@quickwork/core/types";
import { LocalDirectoryModeOptions } from "../projects/components/local-directory-mode-dialog";

/**
 * Builds the resource_ref for a local directory attached during project
 * creation.
 *
 * Exported so the execution-mode contract can be asserted directly: this is
 * the payload the server stores and the daemon later reads to decide whether
 * tasks edit the user's folder or hand back a branch, and getting `execution_mode`
 * wrong here is invisible until a task runs.
 */
export function buildLocalDirectoryResourceRef({
  localPath,
  daemonId,
  label,
  mode,
}: {
  localPath: string;
  daemonId: string;
  label: string | null;
  mode: LocalDirectoryExecutionMode;
}): Record<string, unknown> {
  return {
    local_path: localPath,
    daemon_id: daemonId,
    ...(label ? { label } : {}),
    execution_mode: mode,
  };
}

function RepoUrlText({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className={cn("truncate flex-1 text-left", className)}>
            {githubShortLabel(url)}
          </span>
        }
      />
      <TooltipContent side="top" align="start" className="max-w-sm break-all">
        {url}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * 新建项目 — the ink console card.
 *
 * Only the three things a project is created with: its name, one line saying
 * what it is, and where it lands (repos or a local directory). Status,
 * priority, lead and dates are deliberately absent — they are decisions for
 * after the project exists, and carrying them here made the dialog a form.
 *
 * The dark surface is scoped with the `.qw-ink` token set (base.css), so every
 * token-based control inside — editors, buttons, borders — re-themes without
 * touching the rest of the app. Portaled pickers stay on the light surface.
 */
export function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const { t } = useT("modals");
  const { t: tProjects } = useT("projects");
  const router = useNavigation();
  const workspace = useCurrentWorkspace();
  const workspaceName = workspace?.name;
  const wsPaths = useWorkspacePaths();
  const wsId = useWorkspaceId();

  const draft = useProjectDraftStore((s) => s.draft);
  const setDraft = useProjectDraftStore((s) => s.setDraft);
  const clearDraft = useProjectDraftStore((s) => s.clearDraft);

  const [title, setTitle] = useState(draft.title);
  const descEditorRef = useRef<ContentEditorRef>(null);
  const [icon, setIcon] = useState<string | undefined>(draft.icon);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Repos selected to attach as github_repo resources after the project is
  // created. Stored as URLs (not full ProjectResource rows) — they're not
  // persisted until handleSubmit fires the createProjectResource calls.
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [repoPopoverOpen, setRepoPopoverOpen] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");
  const [customRepoUrl, setCustomRepoUrl] = useState("");
  const workspaceRepos = workspace?.repos ?? [];
  const repoQuery = repoSearch.trim().toLowerCase();
  const filteredWorkspaceRepos = workspaceRepos.filter((repo) =>
    repo.url.toLowerCase().includes(repoQuery),
  );

  // A project's source is binary: either a set of GitHub repos OR a local
  // working directory — never both. Mode is the source of truth for what
  // gets persisted on submit; switching mode does NOT clear the other
  // side's stash, so toggling back and forth restores the user's prior
  // selection. Only the mode-matching side is sent to the API. Local mode
  // is hidden entirely on web (no daemon to bind the path to).
  const desktop = isDesktopShell();
  const daemonStatus = useLocalDaemonStatus();
  const [sourceMode, setSourceMode] = useState<"repos" | "local">("repos");
  const [selectedLocalPath, setSelectedLocalPath] = useState<string | null>(null);
  const [selectedLocalLabel, setSelectedLocalLabel] = useState<string | null>(null);
  const [localPickError, setLocalPickError] = useState<string | null>(null);
  const [localPicking, setLocalPicking] = useState(false);
  // Execution mode is chosen here rather than after creation: it decides
  // whether tasks edit this folder or hand back a branch, which is part of
  // what the user is setting up, not a setting to discover later.
  //
  // null means "the user has not picked one" — distinct from an explicit
  // in_place. Only then does the folder-derived preselection apply, so an
  // explicit choice is never overridden by a later folder change.
  const [localMode, setLocalMode] = useState<LocalDirectoryExecutionMode | null>(null);
  // undefined = could not check (older desktop build); the daemon re-checks
  // authoritatively, so unknown stays permissive.
  const [localIsGitRepo, setLocalIsGitRepo] = useState<boolean | undefined>(undefined);
  const [localModeOpen, setLocalModeOpen] = useState(false);

  // Worktree mode needs a daemon new enough to implement it; the server refuses
  // to save the resource otherwise. In this flow the resource is attached in the
  // same call that creates the project, so an un-caught rejection would fail the
  // whole creation — check up front and disable the option instead.
  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));
  // Capability, not version: a dev-built daemon reports a git-describe string
  // that the version floor exempts, so the version check passed for a binary
  // with no worktree implementation (MUL-5707). A backend too old to record the
  // capability at all is its own answer — blaming this machine for that sent a
  // user off to update the one piece already on the newest release (#7113).
  // Preselection only — the server gates the save, including on this bundled
  // create path, and rejects with a message the modal surfaces.
  const localAdvertisesWorktree = runtimeAdvertisesLocalWorktree(
    runtimes,
    daemonStatus.daemonId,
  );
  // One declared boolean from the live server. Servers older than the worktree
  // save gate drop execution_mode and answer 201, so "the backend will check"
  // is only true once the backend says it checks (#7113).
  const serverValidatesWorktree = useConfigStore((state) => state.localWorktreeSupported);
  const worktreeUnavailableReason =
    localIsGitRepo === false
      ? ("not_git" as const)
      : !serverValidatesWorktree
        ? ("server_outdated" as const)
        : undefined;
  // Preselection, not a default behavior change: when the folder is a git repo
  // and the machine has advertised that it can run worktree mode, parallel is
  // the better fit, so it starts selected — visibly, in a control the user can
  // flip in one click before creating anything. A plain folder starts on
  // direct, and so does a machine that has not advertised: it may still be able
  // to (an old row proves nothing), but choosing it FOR the user is how a
  // rejected save would turn into a failed project creation.
  //
  // `localIsGitRepo === undefined` (an older desktop build that doesn't report
  // it) preselects direct. The asymmetry is deliberate: permissive about what
  // the user MAY choose, conservative about what we choose FOR them.
  const preselectedLocalMode: LocalDirectoryExecutionMode =
    localIsGitRepo === true && localAdvertisesWorktree && worktreeUnavailableReason === undefined
      ? "worktree"
      : "in_place";
  // Never submit a mode the picker would have blocked — the folder can change
  // after a mode was chosen (pick a git repo, choose worktree, then pick a
  // plain folder), and the stale choice would fail at task time.
  const effectiveLocalMode: LocalDirectoryExecutionMode =
    worktreeUnavailableReason !== undefined
      ? "in_place"
      : (localMode ?? preselectedLocalMode);

  const handleSourceModeChange = (mode: "repos" | "local") => {
    setSourceMode(mode);
    setLocalPickError(null);
  };

  const handlePickLocalDirectory = async () => {
    if (localPicking) return;
    setLocalPickError(null);
    setLocalPicking(true);
    try {
      const picked = await pickDirectory(selectedLocalPath ?? undefined);
      if (!picked.ok || !picked.path) {
        if (picked.reason && picked.reason !== "cancelled") {
          setLocalPickError(
            picked.error ?? t(($) => $.create_project.local_pick_failed),
          );
        }
        return;
      }
      const validation = await validateLocalDirectory(picked.path);
      if (!validation.ok) {
        setLocalPickError(
          validation.error ?? t(($) => $.create_project.local_invalid_dir),
        );
        return;
      }
      setSelectedLocalPath(picked.path);
      setSelectedLocalLabel(picked.basename ?? null);
      setLocalIsGitRepo(validation.is_git_repo);
    } finally {
      setLocalPicking(false);
    }
  };

  const clearLocalDirectory = () => {
    setSelectedLocalPath(null);
    setSelectedLocalLabel(null);
    setLocalPickError(null);
    setLocalIsGitRepo(undefined);
    setLocalMode(null);
  };

  const updateTitle = (v: string) => { setTitle(v); setDraft({ title: v }); };
  const updateIcon = (v: string | undefined) => { setIcon(v); setDraft({ icon: v }); };

  const createProject = useCreateProject();

  const handleSubmit = async () => {
    if (!title.trim() || submitting) return;
    // `sourceMode` decides which side's stash gets persisted — the other
    // side is silently dropped, so repos picked then abandoned for local
    // mode don't leak into the project.
    let resources:
      | Array<{ resource_type: "github_repo" | "local_directory"; resource_ref: Record<string, unknown> }>
      | undefined;
    if (sourceMode === "repos" && selectedRepos.length > 0) {
      resources = selectedRepos.map((url) => ({
        resource_type: "github_repo" as const,
        resource_ref: { url },
      }));
    } else if (
      sourceMode === "local" &&
      selectedLocalPath &&
      daemonStatus.daemonId
    ) {
      resources = [
        {
          resource_type: "local_directory" as const,
          resource_ref: buildLocalDirectoryResourceRef({
            localPath: selectedLocalPath,
            daemonId: daemonStatus.daemonId,
            label: selectedLocalLabel,
            mode: effectiveLocalMode,
          }),
        },
      ];
    }
    setSubmitting(true);
    try {
      const project = await createProject.mutateAsync({
        title: title.trim(),
        description: descEditorRef.current?.getMarkdown()?.trim() || undefined,
        icon,
        // Server attaches these in the same transaction as the project.
        resources,
      });
      clearDraft();
      onClose();
      toast.success(t(($) => $.create_project.toast_created));
      router.push(wsPaths.projectDetail(project.id));
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : t(($) => $.create_project.toast_failed),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const toggleRepo = (url: string) => {
    setSelectedRepos((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url],
    );
  };

  const addCustomRepo = () => {
    const url = customRepoUrl.trim();
    if (!url) return;
    setSelectedRepos((prev) => (prev.includes(url) ? prev : [...prev, url]));
    setCustomRepoUrl("");
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "qw-ink flex w-full flex-col gap-0 overflow-hidden p-0",
          "!top-1/2 !left-1/2 !-translate-x-1/2 !-translate-y-1/2",
          "!w-[calc(100vw-1.5rem)] !max-w-[440px]",
        )}
      >
        <DialogTitle className="sr-only">{t(($) => $.create_project.title)}</DialogTitle>

        {/* Console strip: the workspace prompt line. */}
        <header className="flex items-center gap-2 px-4 pt-3">
          <span className="size-2 shrink-0 rounded-full bg-[oklch(0.62_0.17_65)]" aria-hidden="true" />
          <span className="min-w-0 truncate font-mono text-micro tracking-[0.06em] text-muted-foreground">
            {workspaceName} ~ {t(($) => $.create_project.title)}
          </span>
          <span className="grow" />
          <button
            type="button"
            onClick={onClose}
            aria-label={t(($) => $.common.close)}
            className="grid size-6 place-items-center rounded-sm text-faint-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
        </header>

        <div className="px-4 pb-1 pt-3">
          <div className="flex items-start gap-2.5">
            <Popover open={iconPickerOpen} onOpenChange={setIconPickerOpen}>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    className="-ml-1 grid size-8 shrink-0 place-items-center rounded-md text-title-lg transition-colors hover:bg-accent/60"
                    title={t(($) => $.create_project.icon_tooltip)}
                  >
                    {icon || "📁"}
                  </button>
                }
              />
              <PopoverContent align="start" className="w-auto p-0">
                <EmojiPicker
                  onSelect={(emoji) => {
                    updateIcon(emoji);
                    setIconPickerOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
            <div className="min-w-0 flex-1">
              <TitleEditor
                autoFocus
                defaultValue={draft.title}
                placeholder={t(($) => $.create_project.title_placeholder)}
                className="text-title font-semibold"
                onChange={(v) => updateTitle(v)}
                onSubmit={handleSubmit}
              />
              <div className="max-h-36 overflow-y-auto">
                <ContentEditor
                  ref={descEditorRef}
                  defaultValue={draft.description}
                  placeholder={t(($) => $.create_project.description_placeholder)}
                  onUpdate={(md) => setDraft({ description: md })}
                  debounceMs={500}
                />
              </div>
            </div>
          </div>

          {/* The landing: repos or a local directory, inline. */}
          <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
            <span className="font-mono text-micro tracking-wider text-faint-foreground">
              {t(($) => $.create_project.dest_label)}
            </span>
            <div className="inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5">
              <button
                type="button"
                onClick={() => handleSourceModeChange("repos")}
                className={cn(
                  "rounded-[4px] px-2 py-0.5 text-micro transition-colors",
                  sourceMode === "repos"
                    ? "bg-foreground/10 font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(($) => $.create_project.source_tab_repos)}
              </button>
              {desktop && (
                <button
                  type="button"
                  onClick={() => handleSourceModeChange("local")}
                  className={cn(
                    "rounded-[4px] px-2 py-0.5 text-micro transition-colors",
                    sourceMode === "local"
                      ? "bg-foreground/10 font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(($) => $.create_project.source_tab_local)}
                </button>
              )}
            </div>
          </div>

          {sourceMode === "repos" ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {selectedRepos.map((url) => (
                <span
                  key={url}
                  className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-surface-border bg-surface px-2 py-1 font-mono text-micro"
                >
                  <GithubIcon className="size-3 shrink-0 text-muted-foreground" />
                  <RepoUrlText url={url} className="max-w-[13rem] text-micro" />
                  <button
                    type="button"
                    onClick={() => toggleRepo(url)}
                    aria-label={t(($) => $.create_project.local_clear)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <XIcon className="size-3" />
                  </button>
                </span>
              ))}
              <Popover
                open={repoPopoverOpen}
                onOpenChange={(v) => {
                  setRepoPopoverOpen(v);
                  if (!v) setRepoSearch("");
                }}
              >
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md border border-dashed border-input px-2 py-1 font-mono text-micro text-muted-foreground transition-colors hover:text-foreground"
                    >
                      ＋ {t(($) => $.create_project.repo_pick)}
                    </button>
                  }
                />
                <PopoverContent align="start" className="w-72 p-2 space-y-2">
                  {workspaceRepos.length > 0 ? (
                    <>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <input
                          type="text"
                          value={repoSearch}
                          onChange={(e) => setRepoSearch(e.target.value)}
                          aria-label={t(($) => $.create_project.repos_search_placeholder)}
                          placeholder={t(($) => $.create_project.repos_search_placeholder)}
                          className="h-8 w-full rounded-md border border-border bg-transparent pl-7 pr-2 text-caption outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
                        />
                      </div>
                      <div className="max-h-48 space-y-1 overflow-y-auto">
                        {filteredWorkspaceRepos.length === 0 && repoQuery && (
                          <p className="py-2 text-center text-caption text-muted-foreground">
                            {t(($) => $.create_project.repos_search_empty)}
                          </p>
                        )}
                        {filteredWorkspaceRepos.map((repo) => {
                          const checked = selectedRepos.includes(repo.url);
                          return (
                            <button
                              type="button"
                              key={repo.url}
                              onClick={() => toggleRepo(repo.url)}
                              className={cn(
                                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-caption hover:bg-accent transition-colors",
                                checked && "bg-accent",
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                readOnly
                                className="size-3.5"
                              />
                              <GithubIcon className="size-3.5" />
                              <RepoUrlText url={repo.url} />
                            </button>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <p className="text-caption text-muted-foreground">
                      {t(($) => $.create_project.repos_empty)}
                    </p>
                  )}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      addCustomRepo();
                    }}
                    className="flex items-center gap-1.5 border-t pt-2"
                  >
                    <input
                      type="text"
                      value={customRepoUrl}
                      onChange={(e) => setCustomRepoUrl(e.target.value)}
                      placeholder={t(($) => $.create_project.repos_url_placeholder)}
                      className="min-w-0 flex-1 bg-transparent px-1 py-1 text-caption outline-none placeholder:text-muted-foreground"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-caption"
                      disabled={!customRepoUrl.trim()}
                    >
                      {t(($) => $.create_project.repos_add)}
                    </Button>
                  </form>
                </PopoverContent>
              </Popover>
            </div>
          ) : (
            <div className="mt-2.5 space-y-2">
              {/* Daemon must be online — daemon_id is required to bind
                  the resource. If it's offline, surface why and disable
                  the picker; once it boots we re-render automatically
                  via useLocalDaemonStatus. */}
              {daemonStatus.daemonId && daemonStatus.running ? (
                <p className="text-micro text-muted-foreground">
                  {t(($) => $.create_project.local_on_device, {
                    device: daemonStatus.deviceName ?? t(($) => $.create_project.local_this_machine),
                  })}
                </p>
              ) : (
                <p className="text-micro text-warning">
                  {t(($) => $.create_project.local_daemon_offline)}
                </p>
              )}

              {selectedLocalPath ? (
                <div className="space-y-2 rounded-md border border-surface-border bg-surface px-2.5 py-2">
                  <div className="flex items-start gap-2 text-caption">
                    <FolderOpen className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      {selectedLocalLabel && (
                        <div className="truncate font-medium">{selectedLocalLabel}</div>
                      )}
                      <div className="break-all font-mono text-micro text-muted-foreground">
                        {selectedLocalPath}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={clearLocalDirectory}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={t(($) => $.create_project.local_clear)}
                    >
                      <XIcon className="size-3" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Popover open={localModeOpen} onOpenChange={setLocalModeOpen}>
                      <PopoverTrigger
                        render={
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-6 shrink-0 text-caption"
                          >
                            {effectiveLocalMode === "worktree" ? (
                              <GitBranch className="size-3 shrink-0" />
                            ) : (
                              <Pencil className="size-3 shrink-0" />
                            )}
                            <span className="truncate">
                              {effectiveLocalMode === "worktree"
                                ? tProjects(($) => $.resources.mode_badge_worktree)
                                : tProjects(($) => $.resources.mode_badge_in_place)}
                            </span>
                          </Button>
                        }
                      />
                      <PopoverContent align="start" className="w-80 p-2">
                        <LocalDirectoryModeOptions
                          value={effectiveLocalMode}
                          onChange={(mode) => {
                            setLocalMode(mode);
                            setLocalModeOpen(false);
                          }}
                          unavailableReason={worktreeUnavailableReason}
                        />
                      </PopoverContent>
                    </Popover>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 min-w-0 flex-1 text-caption"
                      onClick={handlePickLocalDirectory}
                      disabled={localPicking || !daemonStatus.running}
                    >
                      <span className="truncate">
                        {t(($) => $.create_project.local_change)}
                      </span>
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-full text-caption"
                  onClick={handlePickLocalDirectory}
                  disabled={localPicking || !daemonStatus.running}
                >
                  <FolderOpen className="size-3" />
                  {localPicking
                    ? t(($) => $.create_project.local_picking)
                    : t(($) => $.create_project.local_pick)}
                </Button>
              )}

              {localPickError && (
                <p className="text-micro text-destructive">{localPickError}</p>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center gap-2 px-4 pb-3.5 pt-2.5">
          <span className="font-mono text-micro tracking-[0.04em] text-faint-foreground">
            {t(($) => $.create_project.shortcut_hint)}
          </span>
          <Button
            size="sm"
            className="ml-auto"
            onClick={handleSubmit}
            disabled={!title.trim() || submitting}
          >
            {submitting ? t(($) => $.create_project.submitting) : t(($) => $.create_project.submit)}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
