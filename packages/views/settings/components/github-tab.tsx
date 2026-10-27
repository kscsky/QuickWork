"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  Link2,
  LoaderCircle,
  PanelRight,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Badge } from "@quickwork/ui/components/ui/badge";
import { Button } from "@quickwork/ui/components/ui/button";
import { Card, CardContent } from "@quickwork/ui/components/ui/card";
import { Checkbox } from "@quickwork/ui/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quickwork/ui/components/ui/dialog";
import { Input } from "@quickwork/ui/components/ui/input";
import { Label } from "@quickwork/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quickwork/ui/components/ui/select";
import { Switch } from "@quickwork/ui/components/ui/switch";
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
import { useAuthStore } from "@quickwork/core/auth";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { paths, useCurrentWorkspace } from "@quickwork/core/paths";
import { memberListOptions, workspaceKeys } from "@quickwork/core/workspace/queries";
import {
  deriveGitHubSettings,
  githubInstallationRepositoriesOptions,
  githubInstallationsOptions,
} from "@quickwork/core/github";
import {
  projectListOptions,
  projectResourcesOptions,
  useCreateProject,
  useDeleteProjectResource,
  useUpdateProjectResource,
} from "@quickwork/core/projects";
import { api } from "@quickwork/core/api";
import type {
  GitHubRepository,
  GithubRepoResourceRef,
  Project,
  ProjectResource,
  Workspace,
} from "@quickwork/core/types";
import { githubShortLabel } from "../../common/github-url";
import { AppLink, useNavigation } from "../../navigation";
import { useT } from "../../i18n";
import { SettingsCard, SettingsSection, SettingsTab } from "./settings-layout";
import { GitHubMark } from "./github-mark";

type SettingsKey =
  | "github_enabled"
  | "github_pr_sidebar_enabled"
  | "co_authored_by_enabled"
  | "github_auto_link_prs_enabled";

function normalizeRepoKey(url: string): string {
  return url.trim().toLowerCase().replace(/\.git$/, "").replace(/\/+$/, "");
}

function isGithubRepoResource(
  resource: ProjectResource,
): resource is ProjectResource & { resource_ref: GithubRepoResourceRef } {
  return (
    resource.resource_type === "github_repo" &&
    typeof (resource.resource_ref as { url?: unknown })?.url === "string"
  );
}

export function GitHubTab() {
  const { t } = useT("settings");
  const workspace = useCurrentWorkspace();
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const navigation = useNavigation();
  const user = useAuthStore((s) => s.user);

  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const currentMember = members.find((m) => m.user_id === user?.id) ?? null;
  // `canView` gates the read-only installation list (every workspace member
  // sees it after MUL-2413); `canManage` gates the Connect / Disconnect
  // actions and comes from the backend response (`can_manage`) so the
  // frontend never claims management rights the server would reject.
  const canView = !!currentMember;

  const { data: installationData } = useQuery({
    ...githubInstallationsOptions(wsId),
    enabled: !!wsId && canView,
  });
  const installations = useMemo(
    () => installationData?.installations ?? [],
    [installationData?.installations],
  );
  const configured = installationData?.configured ?? false;
  const canManage = installationData?.can_manage === true;
  const connected = installations.length > 0;
  const primaryInstallation = installations[0] ?? null;

  const flags = deriveGitHubSettings(workspace);
  const [savingKey, setSavingKey] = useState<SettingsKey | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnectTarget, setDisconnectTarget] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  // GitHub-backed projects. A project carries a `github_repo` resource; the
  // list summary exposes its primary repo URL, which is enough to render the
  // ledger without fetching resources for every project up front.
  const githubBrowseConfigured =
    installationData?.repository_browse_configured === true;
  const { data: projects = [], isPending: projectsPending } = useQuery(
    projectListOptions(wsId),
  );
  const githubProjects = useMemo(
    () => projects.filter((project) => !!project.repo_url),
    [projects],
  );
  const importedRepoKeys = useMemo(
    () =>
      new Set(
        githubProjects.map((project) => normalizeRepoKey(project.repo_url!)),
      ),
    [githubProjects],
  );

  const [projectsPickerOpen, setProjectsPickerOpen] = useState(false);
  const [pickerInstallationID, setPickerInstallationID] = useState("");
  const [pickedRepos, setPickedRepos] = useState<
    Map<number, GitHubRepository>
  >(new Map());
  const [repoSearch, setRepoSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const createProject = useCreateProject();

  useEffect(() => {
    if (
      pickerInstallationID &&
      installations.some((installation) => installation.id === pickerInstallationID)
    ) {
      return;
    }
    setPickerInstallationID(installations[0]?.id ?? "");
  }, [installations, pickerInstallationID]);

  const repositoriesQuery = useInfiniteQuery({
    ...githubInstallationRepositoriesOptions(wsId, pickerInstallationID),
    enabled:
      projectsPickerOpen &&
      canManage &&
      githubBrowseConfigured &&
      !!pickerInstallationID,
  });
  const githubRepositories = useMemo(
    () =>
      repositoriesQuery.data?.pages.flatMap((page) => page.repositories) ?? [],
    [repositoriesQuery.data?.pages],
  );
  const filteredGithubRepositories = useMemo(() => {
    const search = repoSearch.trim().toLowerCase();
    if (!search) return githubRepositories;
    return githubRepositories.filter((repository) =>
      repository.full_name.toLowerCase().includes(search),
    );
  }, [githubRepositories, repoSearch]);

  async function persistSetting(key: SettingsKey, next: boolean) {
    if (!workspace || savingKey) return;
    setSavingKey(key);
    try {
      const merged = {
        ...((workspace.settings as Record<string, unknown>) ?? {}),
        [key]: next,
      };
      const updated = await api.updateWorkspace(workspace.id, { settings: merged });
      qc.setQueryData(workspaceKeys.list(), (old: Workspace[] | undefined) =>
        old?.map((ws) => (ws.id === updated.id ? updated : ws)),
      );
      toast.success(t(($) => $.auto_save.toast_saved), {
        id: "settings-auto-save",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t(($) => $.github.toast_failed));
    } finally {
      setSavingKey(null);
    }
  }

  async function handleConnect() {
    setConnecting(true);
    try {
      const resp = await api.getGitHubConnectURL(wsId);
      if (!resp.configured || !resp.url) {
        toast.error(t(($) => $.github.toast_not_configured));
        return;
      }
      window.open(resp.url, "_blank", "noopener");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t(($) => $.github.toast_open_failed));
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!disconnectTarget || disconnecting) return;
    setDisconnecting(true);
    try {
      await api.deleteGitHubInstallation(wsId, disconnectTarget);
      await qc.invalidateQueries({ queryKey: ["github", wsId] });
      toast.success(t(($) => $.github.toast_disconnected));
      setDisconnectTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t(($) => $.github.toast_disconnect_failed));
    } finally {
      setDisconnecting(false);
    }
  }

  function openProjectsPicker() {
    if (!canManage) return;
    if (!connected) {
      void handleConnect();
      return;
    }
    if (!githubBrowseConfigured) {
      toast.error(t(($) => $.repositories.github_browse_not_configured));
      return;
    }
    setProjectsPickerOpen(true);
  }

  function closeProjectsPicker() {
    setProjectsPickerOpen(false);
    setPickedRepos(new Map());
    setRepoSearch("");
  }

  function togglePickedRepo(repository: GitHubRepository, checked: boolean) {
    setPickedRepos((current) => {
      const next = new Map(current);
      if (checked) next.set(repository.id, repository);
      else next.delete(repository.id);
      return next;
    });
  }

  async function importProjects() {
    if (importing || pickedRepos.size === 0) return;
    setImporting(true);
    try {
      const results = await Promise.allSettled(
        [...pickedRepos.values()].map((repository) =>
          createProject.mutateAsync({
            title:
              repository.full_name.split("/").pop() || repository.full_name,
            ...(repository.description
              ? { description: repository.description }
              : {}),
            resources: [
              {
                resource_type: "github_repo",
                resource_ref: {
                  url: repository.clone_url,
                  default_branch_hint: repository.default_branch,
                },
              },
            ],
          }),
        ),
      );
      const imported = results.filter(
        (result) => result.status === "fulfilled",
      ).length;
      const failed = results.length - imported;
      closeProjectsPicker();
      if (imported > 0) {
        toast.success(
          t(($) => $.github.projects_imported, { count: imported }),
        );
      }
      if (failed > 0) {
        toast.error(
          t(($) => $.github.projects_import_failed, { count: failed }),
        );
      }
    } finally {
      setImporting(false);
    }
  }

  if (!workspace) return null;

  const repositoriesHref = `${navigation.pathname}?tab=repositories`;

  return (
    <SettingsTab
      title={t(($) => $.page.tabs.github)}
      description={t(($) => $.github.page_description)}
    >
      <section className="space-y-3">
        <Card>
          <CardContent>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="rounded-md border bg-muted/50 p-2 text-muted-foreground">
                  <GitHubMark className="h-4 w-4" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="github-master" className="text-body font-medium">
                    {t(($) => $.github.section_master)}
                  </Label>
                  <p className="text-body text-muted-foreground">
                    {flags.enabled
                      ? t(($) => $.github.master_description_on)
                      : t(($) => $.github.master_description_off)}
                  </p>
                </div>
              </div>
              <Switch
                id="github-master"
                checked={flags.enabled}
                onCheckedChange={(v) => persistSetting("github_enabled", v)}
                disabled={!canManage || savingKey === "github_enabled"}
              />
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-body font-semibold">{t(($) => $.github.section_connection)}</h2>
        <Card>
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <GitHubMark className="h-6 w-6 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-body font-medium">{t(($) => $.github.connection_title)}</p>
                  {connected ? (
                    <>
                      <p className="text-caption text-muted-foreground">
                        {t(($) => $.github.connected_to, {
                          login: installations.map((i) => i.account_login).join(", "),
                        })}
                      </p>
                      {primaryInstallation?.connected_by && (
                        <p className="text-caption text-muted-foreground">
                          {t(($) => $.github.connected_by, {
                            name: primaryInstallation.connected_by!,
                          })}
                        </p>
                      )}
                    </>
                  ) : canManage ? (
                    <p className="text-caption text-muted-foreground">
                      {t(($) => $.github.connection_description_prefix)}{" "}
                      <code className="rounded bg-muted px-1 py-0.5 text-micro">
                        {t(($) => $.github.connection_identifier_example)}
                      </code>{" "}
                      {t(($) => $.github.connection_description_suffix)}{" "}
                      <strong>{t(($) => $.github.connection_description_done)}</strong>.
                    </p>
                  ) : (
                    <p className="text-caption text-muted-foreground">
                      {t(($) => $.github.contact_admin_to_connect)}
                    </p>
                  )}
                </div>
              </div>
              {canManage && (
                <div className="flex items-center gap-2">
                  {connected && primaryInstallation ? (
                    // Disconnect must stay reachable even when the master switch
                    // is off — disconnect is a separate intent (revoke the App
                    // grant) from hiding the feature.
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDisconnectTarget(primaryInstallation.id)}
                    >
                      {t(($) => $.github.disconnect)}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={handleConnect}
                      disabled={connecting || !configured}
                      title={
                        !configured
                          ? t(($) => $.github.connect_disabled_tooltip)
                          : undefined
                      }
                    >
                      {connecting
                        ? t(($) => $.github.connect_opening)
                        : t(($) => $.github.connect_github)}
                    </Button>
                  )}
                </div>
              )}
            </div>

            {canManage && !configured && (
              <p className="text-caption text-muted-foreground">
                {t(($) => $.github.not_configured)}{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-micro">GITHUB_APP_SLUG</code>{" "}
                {t(($) => $.github.not_configured_and)}{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-micro">GITHUB_WEBHOOK_SECRET</code>.
              </p>
            )}

            {!canManage && connected && (
              <p className="text-caption text-muted-foreground">
                {t(($) => $.github.read_only_hint)}
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <SettingsSection
        title={
          <span className="flex items-center gap-2">
            {t(($) => $.github.section_projects)}
            <Badge variant="secondary">{githubProjects.length}</Badge>
          </span>
        }
        description={t(($) => $.github.projects_description)}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={openProjectsPicker}
            disabled={!canManage}
          >
            <Plus className="size-3.5" />
            {t(($) => $.github.projects_import)}
          </Button>
        }
      >
        <SettingsCard>
          {projectsPending ? (
            <div className="flex items-center justify-center gap-2 px-4 py-8 text-body text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              {t(($) => $.github.projects_loading)}
            </div>
          ) : githubProjects.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-body font-medium">
                {t(($) => $.github.projects_empty)}
              </p>
              <p className="mt-1 text-caption leading-5 text-muted-foreground">
                {t(($) => $.github.projects_empty_hint)}
              </p>
            </div>
          ) : (
            githubProjects.map((project) => (
              <GitHubProjectRow
                key={project.id}
                project={project}
                flags={flags}
                canManage={canManage}
              />
            ))
          )}
        </SettingsCard>
        <p className="px-0.5 text-caption leading-5 text-muted-foreground">
          {t(($) => $.github.projects_note)}
        </p>
      </SettingsSection>

      <section className="space-y-3">
        <h2 className="text-body font-semibold">{t(($) => $.github.section_features)}</h2>
        <Card className="gap-0 py-0">
          <CardContent className="divide-y divide-surface-border px-0">
            <FeatureRow
              id="github-pr-sidebar"
              icon={<PanelRight className="h-4 w-4" />}
              label={t(($) => $.github.feature_pr_sidebar_label)}
              description={
                <p className="text-body text-muted-foreground">
                  {t(($) => $.github.feature_pr_sidebar_description)}
                </p>
              }
              checked={flags.prSidebar}
              disabled={!canManage || !flags.enabled || savingKey === "github_pr_sidebar_enabled"}
              onCheckedChange={(v) => persistSetting("github_pr_sidebar_enabled", v)}
            />

            <FeatureRow
              id="github-coauthor"
              icon={<GitCommitHorizontal className="h-4 w-4" />}
              label={t(($) => $.github.feature_co_author_label)}
              description={
                <p className="text-body text-muted-foreground">
                  {t(($) => $.github.feature_co_author_description_prefix)}{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-caption">
                    {"Co-authored-by: quickwork-agent <github@quickwork.ai>"}
                  </code>{" "}
                  {t(($) => $.github.feature_co_author_description_suffix)}
                </p>
              }
              checked={flags.coAuthor}
              disabled={!canManage || !flags.enabled || savingKey === "co_authored_by_enabled"}
              onCheckedChange={(v) => persistSetting("co_authored_by_enabled", v)}
            />

            <FeatureRow
              id="github-auto-link"
              icon={<Link2 className="h-4 w-4" />}
              label={t(($) => $.github.feature_auto_link_label)}
              description={
                <p className="text-body text-muted-foreground">
                  {t(($) => $.github.feature_auto_link_description)}
                </p>
              }
              checked={flags.autoLinkPRs}
              disabled={!canManage || !flags.enabled || savingKey === "github_auto_link_prs_enabled"}
              onCheckedChange={(v) => persistSetting("github_auto_link_prs_enabled", v)}
            />
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-body font-semibold">{t(($) => $.github.section_repositories)}</h2>
        <Card>
          <CardContent>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-body font-medium">
                {t(($) => $.github.repositories_shortcut_label)}
              </p>
              <Button
                variant="outline"
                size="sm"
                render={<AppLink href={repositoriesHref} />}
                nativeButton={false}
              >
                <ExternalLink className="h-3 w-3" />
                {t(($) => $.github.repositories_shortcut_link)}
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <AlertDialog
        open={!!disconnectTarget}
        onOpenChange={(v) => {
          if (!v && !disconnecting) setDisconnectTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $.github.disconnect_confirm_title)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $.github.disconnect_confirm_description)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnecting}>
              {t(($) => $.github.disconnect_confirm_cancel)}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting
                ? t(($) => $.github.disconnecting)
                : t(($) => $.github.disconnect_confirm_action)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={projectsPickerOpen}
        onOpenChange={(open) => {
          if (!open) closeProjectsPicker();
        }}
      >
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-2xl">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle>
              {t(($) => $.repositories.github_picker_title)}
            </DialogTitle>
            <DialogDescription>
              {t(($) => $.github.projects_picker_description)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 px-6 py-4">
            {installations.length > 1 ? (
              <Select
                items={installations.map((installation) => ({
                  value: installation.id,
                  label: installation.account_login,
                }))}
                value={pickerInstallationID}
                onValueChange={(value) => setPickerInstallationID(value ?? "")}
              >
                <SelectTrigger
                  aria-label={t(($) => $.repositories.github_account)}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {installations.map((installation) => (
                    <SelectItem
                      key={installation.id}
                      value={installation.id}
                    >
                      {installation.account_login}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : installations[0] ? (
              <p className="text-caption text-muted-foreground">
                {t(($) => $.repositories.github_account)}:{" "}
                <span className="font-medium text-foreground">
                  {installations[0].account_login}
                </span>
              </p>
            ) : null}

            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={repoSearch}
                onChange={(event) => setRepoSearch(event.target.value)}
                placeholder={t(
                  ($) => $.repositories.github_search_placeholder,
                )}
                aria-label={t(
                  ($) => $.repositories.github_search_placeholder,
                )}
                className="pl-8"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto border-y">
            {repositoriesQuery.isPending ? (
              <div className="flex items-center justify-center gap-2 px-6 py-12 text-body text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                {t(($) => $.repositories.github_loading)}
              </div>
            ) : repositoriesQuery.isError ? (
              <div className="px-6 py-12 text-center text-body text-muted-foreground">
                {t(($) => $.repositories.github_load_failed)}
              </div>
            ) : filteredGithubRepositories.length === 0 ? (
              <div className="px-6 py-12 text-center text-body text-muted-foreground">
                {repoSearch
                  ? t(($) => $.repositories.github_no_search_results)
                  : t(($) => $.repositories.github_empty)}
              </div>
            ) : (
              <div className="divide-y">
                {filteredGithubRepositories.map((repository) => {
                  const alreadyImported = importedRepoKeys.has(
                    normalizeRepoKey(repository.clone_url),
                  );
                  const disabled = alreadyImported || repository.archived;
                  return (
                    <label
                      key={repository.id}
                      htmlFor={`github-project-${repository.id}`}
                      className="flex items-start gap-3 px-6 py-3.5"
                    >
                      <Checkbox
                        id={`github-project-${repository.id}`}
                        checked={
                          alreadyImported ||
                          pickedRepos.has(repository.id)
                        }
                        disabled={disabled}
                        onCheckedChange={(checked) =>
                          togglePickedRepo(repository, checked === true)
                        }
                        className="mt-0.5"
                      />
                      <span className="min-w-0 flex-1 space-y-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-body font-medium">
                            {repository.full_name}
                          </span>
                          {repository.private ? (
                            <Badge variant="secondary">
                              {t(($) => $.repositories.github_private)}
                            </Badge>
                          ) : null}
                          {repository.archived ? (
                            <Badge variant="outline">
                              {t(($) => $.repositories.github_archived)}
                            </Badge>
                          ) : null}
                          {alreadyImported ? (
                            <Badge variant="outline">
                              {t(($) => $.repositories.github_added)}
                            </Badge>
                          ) : null}
                        </span>
                        {repository.description ? (
                          <span className="block truncate text-caption text-muted-foreground">
                            {repository.description}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            {repositoriesQuery.hasNextPage ? (
              <div className="flex justify-center border-t p-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => repositoriesQuery.fetchNextPage()}
                  disabled={repositoriesQuery.isFetchingNextPage}
                >
                  {repositoriesQuery.isFetchingNextPage
                    ? t(($) => $.repositories.github_loading)
                    : t(($) => $.repositories.github_load_more)}
                </Button>
              </div>
            ) : null}
          </div>

          <DialogFooter className="m-0 border-t bg-muted/30 px-6 py-4">
            <p className="mr-auto text-caption text-muted-foreground">
              {t(($) => $.github.projects_selected, {
                count: pickedRepos.size,
              })}
            </p>
            <Button variant="ghost" onClick={closeProjectsPicker}>
              {t(($) => $.repositories.github_cancel)}
            </Button>
            <Button
              onClick={() => void importProjects()}
              disabled={pickedRepos.size === 0 || importing}
            >
              {importing ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                t(($) => $.github.projects_import_action, {
                  count: pickedRepos.size,
                })
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsTab>
  );
}

function GitHubProjectRow({
  project,
  flags,
  canManage,
}: {
  project: Project;
  flags: ReturnType<typeof deriveGitHubSettings>;
  canManage: boolean;
}) {
  const { t } = useT("settings");
  const wsId = useWorkspaceId();
  const workspace = useCurrentWorkspace();
  const [open, setOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [branchDraft, setBranchDraft] = useState("");
  const { data: resources = [] } = useQuery(
    projectResourcesOptions(wsId, project.id),
  );
  const githubResources = resources.filter(isGithubRepoResource);
  const repo =
    (project.repo_url
      ? githubResources.find(
          (resource) =>
            normalizeRepoKey(resource.resource_ref.url) ===
            normalizeRepoKey(project.repo_url!),
        )
      : undefined) ??
    githubResources[0] ??
    null;
  const updateResource = useUpdateProjectResource(wsId, project.id);
  const deleteResource = useDeleteProjectResource(wsId, project.id);
  const repoLabel = project.repo_url
    ? githubShortLabel(project.repo_url)
    : project.title;
  const currentRef =
    repo?.resource_ref.ref || repo?.resource_ref.default_branch_hint || "";
  const branchValue = branchDraft || currentRef;
  const projectHref = workspace
    ? paths.workspace(workspace.slug).projectDetail(project.id)
    : "#";

  async function saveBranch() {
    if (!repo) return;
    const ref = branchValue.trim();
    if (!ref || ref === currentRef) return;
    try {
      await updateResource.mutateAsync({
        resourceId: repo.id,
        data: {
          resource_ref: { ...repo.resource_ref, ref },
        },
      });
      setBranchDraft("");
      toast.success(t(($) => $.github.projects_saved));
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : t(($) => $.github.projects_save_failed),
      );
    }
  }

  async function removeProject() {
    if (!repo) return;
    try {
      await deleteResource.mutateAsync(repo.id);
      setRemoveOpen(false);
      toast.success(t(($) => $.github.projects_removed));
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : t(($) => $.github.projects_remove_failed),
      );
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground">
          <GitHubMark className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-body font-medium">{repoLabel}</span>
            {currentRef ? (
              <Badge variant="outline" className="gap-1 font-mono text-micro">
                <GitBranch className="size-3" />
                {currentRef}
              </Badge>
            ) : null}
            <Badge variant={repo ? "secondary" : "outline"}>
              {repo
                ? t(($) => $.github.projects_bound)
                : t(($) => $.github.projects_unlinked)}
            </Badge>
          </div>
          <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
            <span className="truncate">{project.repo_url}</span>
            <span aria-hidden>·</span>
            <AppLink
              href={projectHref}
              className="max-w-full truncate text-brand hover:underline"
            >
              {project.title}
            </AppLink>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen((value) => !value);
              setBranchDraft("");
            }}
            disabled={!repo}
          >
            {open
              ? t(($) => $.github.projects_collapse)
              : t(($) => $.github.projects_configure)}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            render={<AppLink href={projectHref} />}
            nativeButton={false}
          >
            {t(($) => $.github.projects_open)}
            <ExternalLink className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setRemoveOpen(true)}
            disabled={!repo || !canManage}
          >
            <Trash2 className="size-3" />
            {t(($) => $.github.projects_remove)}
          </Button>
        </div>
      </div>

      {open && repo ? (
        <div className="grid gap-4 border-t bg-muted/25 px-4 py-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-caption text-muted-foreground">
              {t(($) => $.github.projects_branch)}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                value={branchValue}
                onChange={(event) => setBranchDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void saveBranch();
                }}
                className="font-mono"
                aria-label={t(($) => $.github.projects_branch)}
                disabled={updateResource.isPending}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => void saveBranch()}
                disabled={
                  !branchValue.trim() ||
                  branchValue.trim() === currentRef ||
                  updateResource.isPending
                }
              >
                {t(($) => $.github.projects_save)}
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-caption text-muted-foreground">
              {t(($) => $.github.projects_linked_project)}
            </Label>
            <AppLink
              href={projectHref}
              className="flex items-center gap-1 text-body font-medium text-brand hover:underline"
            >
              {project.title}
              <ExternalLink className="size-3" />
            </AppLink>
            <p className="text-caption leading-5 text-muted-foreground">
              {t(($) => $.github.projects_configure_hint)}
            </p>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
            <div>
              <p className="text-body font-medium">
                {t(($) => $.github.projects_pr_preview)}
              </p>
              <p className="text-caption text-muted-foreground">
                {t(($) => $.github.projects_inherited)}
              </p>
            </div>
            <Switch
              checked={flags.prSidebar}
              disabled
              aria-label={t(($) => $.github.projects_pr_preview)}
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
            <div>
              <p className="text-body font-medium">
                {t(($) => $.github.projects_auto_link)}
              </p>
              <p className="text-caption text-muted-foreground">
                {t(($) => $.github.projects_inherited)}
              </p>
            </div>
            <Switch
              checked={flags.autoLinkPRs}
              disabled
              aria-label={t(($) => $.github.projects_auto_link)}
            />
          </div>
        </div>
      ) : null}

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $.github.projects_remove_title)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $.github.projects_remove_description, {
                name: repoLabel,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t(($) => $.github.projects_remove_cancel)}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void removeProject()}
              disabled={deleteResource.isPending}
            >
              {deleteResource.isPending
                ? t(($) => $.github.projects_removing)
                : t(($) => $.github.projects_remove_action)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FeatureRow({
  id,
  icon,
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  icon: React.ReactNode;
  label: string;
  description: React.ReactNode;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3.5">
      <div className="flex items-start gap-3">
        <div className="rounded-md border bg-muted/50 p-2 text-muted-foreground">{icon}</div>
        <div className="space-y-1">
          <Label htmlFor={id} className="text-body font-medium">
            {label}
          </Label>
          {description}
        </div>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}
