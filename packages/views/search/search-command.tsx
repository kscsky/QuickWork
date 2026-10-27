"use client";

import { issueStatusCategory } from "@quickwork/core/issues";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  FileText,
  Link2,
  Loader2,
  MessageSquare,
  Plus,
  SearchIcon,
  ListChevronsDownUp,
  ListChevronsUpDown,
  Monitor,
  Moon,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { Command as CommandPrimitive } from "cmdk";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  MemberWithUser,
  SearchIssueResult,
  SearchProjectResult,
} from "@quickwork/core/types";
import { api } from "@quickwork/core/api";
import { partitionAggregatedSearchResults } from "@quickwork/core/search/cancelled-rank";
import {
  openCreateIssue,
  selectRecentIssues,
  useCommentCollapseStore,
  useRecentIssuesStore,
  useResolvedExpandStore,
} from "@quickwork/core/issues/stores";
import { issueDetailOptions, issueTimelineOptions } from "@quickwork/core/issues/queries";
import { useWorkspaceId } from "@quickwork/core";
import {
  useCurrentWorkspace,
  useWorkspacePaths,
  WORKSPACE_PAGES,
} from "@quickwork/core/paths";
import type { WorkspacePageKey, WorkspacePaths } from "@quickwork/core/paths";
import { useModalStore } from "@quickwork/core/modals";
import { memberListOptions } from "@quickwork/core/workspace/queries";
import { resolvePublicFileUrl } from "@quickwork/core/workspace/avatar-url";
import { StatusIcon } from "../issues/components";
import { resolvedThreadRootIds, rootCommentIds } from "../issues/components/thread-utils";
import { ProjectIcon } from "../projects/components/project-icon";
import { useProjectStatusLabels } from "../projects/components/labels";
import { routeIconForPath } from "../layout/route-icon-components";
import { PROJECT_STATUS_CONFIG } from "@quickwork/core/projects/config";
import type { ProjectStatus } from "@quickwork/core/types";
import { ActorAvatar } from "../common/actor-avatar";
import { ActorAvatar as ActorAvatarBase } from "@quickwork/ui/components/common/actor-avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@quickwork/ui/components/ui/dialog";
import { useTheme } from "@quickwork/ui/components/common/theme-provider";
import { copyText } from "@quickwork/ui/lib/clipboard";
import {
  resolveClickIntent,
  useIntentNavigate,
  useNavigation,
  type LinkClickIntent,
} from "../navigation";
import { useT } from "../i18n";
import { matchesPinyin } from "../editor/extensions/pinyin-match";
import { HighlightText } from "./highlight-text";
import { useSearchStore } from "./search-store";

// The palette's Pages group is generated from WORKSPACE_PAGES, the same
// registry the sidebar nav and the desktop tab bar read. It used to be a
// hand-written list, which silently went stale every time a page was added:
// Chat, Autopilot, Squads and Analytics shipped in the sidebar but were
// unreachable from the palette (MUL-6272). Deriving the list means a new
// workspace page is in the palette the moment it is in the registry.
//
// Page keys double as WorkspacePaths method names, so `p[key]()` resolves the
// destination against the current workspace slug at render time. Every
// WorkspacePageKey must therefore stay a parameterless path builder.

// Extra query aliases per page, on top of the localized label. Declared as a
// total Record so adding a workspace page is a compile error until its
// keywords are filled in.
const PAGE_KEYWORDS: Record<WorkspacePageKey, string[]> = {
  inbox: ["inbox", "notifications", "收件箱", "通知"],
  dispatch: ["dispatch", "tower", "orchestrate", "queue", "调度", "编排", "派发"],
  tasks: ["tasks", "relay", "chain", "handoff", "任务", "链路", "交接"],
  myIssues: ["my", "issues", "assigned", "mine", "我的", "任务"],
  projects: ["projects", "kanban", "项目"],
  autopilots: ["autopilot", "autopilots", "automation", "schedule", "cron", "webhook", "自动化", "定时"],
  agents: ["agents", "bots", "ai", "智能体"],
  squads: ["squads", "teams", "小队", "团队"],
  usage: ["usage", "analytics", "stats", "metrics", "统计", "分析", "用量"],
  runtimes: ["runtimes", "environments", "machines", "运行时"],
  skills: ["skills", "library", "技能"],
  config: ["config", "settings", "configuration", "配置", "设置"],
  models: ["models", "model pool", "free models", "模型", "模型池", "免费模型"],
  mcp: ["mcp", "servers", "tools", "服务", "工具"],
  github: ["github", "git", "pull request", "pr", "仓库"],
  integrations: ["integrations", "slack", "lark", "telegram", "集成", "飞书"],
  tokens: ["tokens", "api tokens", "pat", "令牌"],
  account: ["account", "profile", "账号", "个人资料"],
  workspaceSettings: ["workspace", "settings", "空间", "设置"],
};

const NAV_PAGE_KEYS = Object.keys(WORKSPACE_PAGES) as WorkspacePageKey[];

// No `icon` field: like the sidebar nav, a page's icon is derived from its
// destination path via routeIconForPath, so all navigation surfaces show the
// same icon for the same route.
interface NavPage {
  key: WorkspacePageKey;
  label: string;
  keywords: string[];
}

type ThemeValue = "light" | "dark" | "system";

function memberInitials(name: string) {
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// Row matcher shared by the Pages and Commands groups.
//
// Keywords match by prefix, not substring. They are invisible synonyms, so a
// substring hit reads as a bug from the outside: "s" used to surface Inbox
// (via "notifications") and "i" surfaced nearly every page. The visible label
// still matches anywhere, because there the user can see what they hit.
//
// Pinyin is included for the same reason member search has it: under a Chinese
// UI the localized label is the only thing the user can aim at, so typing
// "renwu" has to reach "任务".
function matchesRow(label: string, keywords: string[], query: string) {
  return (
    label.toLowerCase().includes(query) ||
    keywords.some((kw) => kw.startsWith(query)) ||
    matchesPinyin(label, query)
  );
}

function matchesMember(member: MemberWithUser, query: string) {
  return (
    member.name.toLowerCase().includes(query) ||
    member.email.toLowerCase().includes(query) ||
    (query.length >= 3 && member.role.startsWith(query)) ||
    matchesPinyin(member.name, query)
  );
}

function IssueAssigneeAvatar({
  assigneeType,
  assigneeId,
}: {
  assigneeType?: string | null;
  assigneeId?: string | null;
}) {
  if (!assigneeType || !assigneeId) return null;
  return (
    <ActorAvatar
      actorType={assigneeType}
      actorId={assigneeId}
      size="sm"
      profileLink={false}
      className="shrink-0"
    />
  );
}

// Project / issue rows are rendered from three groups (Projects, Issues,
// Cancelled — see the partition note on the results list), so the row markup
// lives in one component each instead of being duplicated per group.
function ProjectResultRow({
  project,
  query,
  disabled,
  onSelect,
}: {
  project: SearchProjectResult;
  query: string;
  disabled?: boolean;
  onSelect: (value: string) => void;
}) {
  const projectStatusLabels = useProjectStatusLabels();
  const status = project.status as ProjectStatus;

  return (
    <CommandPrimitive.Item
      key={`project:${project.id}`}
      value={`project:${project.id}`}
      disabled={disabled}
      onSelect={onSelect}
      className="qw-cmd-row"
    >
      <span className="qw-cmd-row-ico">
        <ProjectIcon project={project} size="md" />
      </span>
      <div className="qw-cmd-row-main">
        <span className="qw-cmd-row-title">
          <HighlightText text={project.title} query={query} />
        </span>
        {project.match_source === "description" && project.matched_snippet ? (
          <span className="qw-cmd-row-sub">
            <HighlightText text={project.matched_snippet} query={query} />
          </span>
        ) : null}
      </div>
      <span className="qw-cmd-row-tail">
        <span
          className={PROJECT_STATUS_CONFIG[status]?.color ?? "text-muted-foreground"}
        >
          {projectStatusLabels[status] ?? project.status}
        </span>
        <span className="qw-cmd-enter" aria-hidden="true">
          ↵
        </span>
      </span>
    </CommandPrimitive.Item>
  );
}

function IssueResultRow({
  issue,
  query,
  disabled,
  onSelect,
}: {
  issue: SearchIssueResult;
  query: string;
  disabled?: boolean;
  onSelect: (value: string) => void;
}) {
  return (
    <CommandPrimitive.Item
      key={issue.id}
      value={issue.id}
      disabled={disabled}
      onSelect={onSelect}
      className="qw-cmd-row"
    >
      <span className="qw-cmd-row-ico">
        <StatusIcon
          status={issue.status}
          category={issueStatusCategory(issue) ?? undefined}
          className="size-3.5 shrink-0"
        />
      </span>
      <div className="qw-cmd-row-main">
        <span className="qw-cmd-row-title">
          <HighlightText text={issue.title} query={query} />
        </span>
        <span className="qw-cmd-row-sub">
          {issue.identifier}
          {issue.matched_description_snippet ? (
            <>
              {" · "}
              <FileText className="qw-cmd-inline-ico" aria-hidden="true" />
              <HighlightText
                text={issue.matched_description_snippet}
                query={query}
              />
            </>
          ) : null}
          {issue.matched_comment_snippet ? (
            <>
              {" · "}
              <MessageSquare className="qw-cmd-inline-ico" aria-hidden="true" />
              <HighlightText
                text={issue.matched_comment_snippet}
                query={query}
              />
            </>
          ) : null}
        </span>
      </div>
      <span className="qw-cmd-row-tail">
        <IssueAssigneeAvatar
          assigneeType={issue.assignee_type}
          assigneeId={issue.assignee_id}
        />
        <span className="qw-cmd-enter" aria-hidden="true">
          ↵
        </span>
      </span>
    </CommandPrimitive.Item>
  );
}

interface CommandItem {
  key: string;
  label: string;
  icon: LucideIcon;
  keywords: string[];
  trailing?: React.ReactNode;
  onSelect: () => void;
}

interface SearchResults {
  /**
   * The trimmed query these rows answer. Rows outlive the query that fetched
   * them — they stay painted while the next request is in flight — so every
   * result set carries the question it is the answer to, and anything that can
   * act on a row checks that it still matches what the user typed.
   */
  query: string;
  issues: SearchIssueResult[];
  projects: SearchProjectResult[];
}

const NO_RESULTS: SearchResults = { query: "", issues: [], projects: [] };

// One heading treatment for every group. Headings go through cmdk's `heading`
// prop rather than a hand-rolled div: cmdk renders it into a
// [cmdk-group-heading] node and points the group's aria-labelledby at it, so a
// screen reader announces which group a row belongs to.
const GROUP_CLASS = "qw-cmd-group";

function GroupHeading({
  label,
  cap,
  count,
}: {
  label: string;
  cap: string;
  count: number;
}) {
  return (
    <>
      <span className="qw-cmd-group-label">{label}</span>
      {label.toLowerCase() === cap.toLowerCase() ? null : (
        <span className="qw-cmd-group-cap">/ {cap}</span>
      )}
      <span className="qw-cmd-group-count">
        {String(count).padStart(2, "0")}
      </span>
    </>
  );
}

export function SearchCommand() {
  const { t } = useT("search");
  // Page names come from the sidebar's own namespace rather than a private
  // copy under `search.pages`: one translated string per page, so the palette
  // can never disagree with the sidebar about what a page is called.
  const { t: tNav } = useT("layout");
  const navPages = useMemo<NavPage[]>(
    () =>
      NAV_PAGE_KEYS.map((key) => ({
        key,
        label: tNav(($) => $.nav[WORKSPACE_PAGES[key].navKey]),
        keywords: PAGE_KEYWORDS[key],
      })),
    [tNav],
  );
  const { pathname, getShareableUrl } = useNavigation();
  const intentNavigate = useIntentNavigate();
  const open = useSearchStore((s) => s.open);
  const setOpen = useSearchStore((s) => s.setOpen);

  // cmdk's onSelect carries no event, so the activating gesture's modifiers
  // are recorded on the capture phase (click on a result, Enter in the input)
  // and consumed by the select handlers below: cmd+click / cmd+Enter opens a
  // result in a new tab instead of navigating in place.
  const pendingIntentRef = useRef<LinkClickIntent>("push");
  const recordIntent = useCallback(
    (e: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey">) => {
      pendingIntentRef.current = resolveClickIntent(e);
    },
    [],
  );
  const consumeIntent = useCallback(() => {
    const intent = pendingIntentRef.current;
    pendingIntentRef.current = "push";
    return intent;
  }, []);
  const wsId = useWorkspaceId();
  const recentItems = useRecentIssuesStore(selectRecentIssues(wsId));
  const p: WorkspacePaths = useWorkspacePaths();
  const workspace = useCurrentWorkspace();
  const { theme, setTheme } = useTheme();
  const { data: members = [] } = useQuery(memberListOptions(wsId));

  // Resolve each recent issue via its cached detail entry. Recent items are
  // typically already in the detail cache because the user has opened them;
  // if not, this triggers a lookup per id so Recent never depends on whether
  // the issue falls inside the paginated list cache.
  //
  // Gated on `open`: the palette is mounted for the whole session, and the
  // store keeps up to 20 recent ids, so an ungated list fired up to 20 issue
  // detail requests on every cold app load for a surface the user may never
  // open.
  const recentDetailQueries = useQueries({
    queries: open ? recentItems.map((item) => issueDetailOptions(wsId, item.id)) : [],
  });
  const recentIssues = useMemo(
    () =>
      recentDetailQueries.flatMap((q) => (q.data ? [q.data] : [])),
    [recentDetailQueries],
  );

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(NO_RESULTS);
  const [isLoading, setIsLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const filteredPages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return navPages.filter((page) => matchesRow(page.label, page.keywords, q));
  }, [navPages, query]);

  // Detect if current route is an issue detail page — /{slug}/issues/{id}.
  // Falls back to null on any other route; used to gate issue-specific commands.
  const currentIssueId = useMemo(() => {
    const match = pathname.match(/\/issues\/([^/]+)$/);
    const raw = match?.[1];
    return raw ? decodeURIComponent(raw) : null;
  }, [pathname]);
  const { data: currentIssue = null } = useQuery({
    ...issueDetailOptions(wsId, currentIssueId ?? ""),
    enabled: !!currentIssueId,
  });
  const queryClient = useQueryClient();

  const commands = useMemo<CommandItem[]>(() => {
    const activeThemeCheck = (value: ThemeValue) =>
      theme === value ? (
        <Check
          aria-label={t(($) => $.commands.current_theme_aria)}
          className="ml-auto size-4 shrink-0 text-muted-foreground"
        />
      ) : undefined;

    const items: CommandItem[] = [
      {
        key: "new-issue",
        label: t(($) => $.commands.new_issue),
        icon: Plus,
        keywords: ["new", "issue", "create", "add"],
        onSelect: () => {
          openCreateIssue();
          setOpen(false);
        },
      },
      {
        key: "new-project",
        label: t(($) => $.commands.new_project),
        icon: Plus,
        keywords: ["new", "project", "create", "add"],
        onSelect: () => {
          useModalStore.getState().open("create-project");
          setOpen(false);
        },
      },
    ];

    if (currentIssueId && currentIssue) {
      const identifier = currentIssue.identifier;
      items.push(
        {
          key: "copy-issue-link",
          label: t(($) => $.commands.copy_issue_link),
          icon: Link2,
          keywords: ["copy", "link", "share", "url", identifier.toLowerCase()],
          onSelect: () => {
            void copyText(getShareableUrl(pathname)).then((ok) => {
              if (ok) toast.success(t(($) => $.toast.link_copied));
            });
            setOpen(false);
          },
        },
        {
          key: "copy-issue-identifier",
          label: t(($) => $.commands.copy_identifier, { identifier }),
          icon: Copy,
          keywords: ["copy", "id", "identifier", identifier.toLowerCase()],
          onSelect: () => {
            void copyText(identifier).then((ok) => {
              if (ok) toast.success(t(($) => $.toast.copied_identifier, { identifier }));
            });
            setOpen(false);
          },
        },
        {
          key: "fold-all-comments",
          label: t(($) => $.commands.fold_all_comments),
          icon: ListChevronsDownUp,
          keywords: ["fold", "collapse", "comments", "收起", "折叠", "评论"],
          onSelect: () => {
            // The timeline is already cached whenever the issue page has
            // rendered; ensureQueryData only fetches on a cold cache. If it
            // still can't load, no comments are on screen — dropping the
            // action matches the visible state.
            void queryClient
              .ensureQueryData(issueTimelineOptions(currentIssueId))
              .then((entries) => {
                useCommentCollapseStore
                  .getState()
                  .collapseAll(currentIssueId, rootCommentIds(entries));
                useResolvedExpandStore.getState().collapseAll(currentIssueId);
              })
              .catch(() => {});
            setOpen(false);
          },
        },
        {
          key: "unfold-all-comments",
          label: t(($) => $.commands.unfold_all_comments),
          icon: ListChevronsUpDown,
          keywords: ["unfold", "expand", "comments", "展开", "评论"],
          onSelect: () => {
            void queryClient
              .ensureQueryData(issueTimelineOptions(currentIssueId))
              .then((entries) => {
                useCommentCollapseStore.getState().expandAll(currentIssueId);
                useResolvedExpandStore
                  .getState()
                  .expandAll(currentIssueId, resolvedThreadRootIds(entries));
              })
              .catch(() => {});
            setOpen(false);
          },
        },
      );
    }

    items.push(
      {
        key: "theme-light",
        label: t(($) => $.commands.switch_to_light),
        icon: Sun,
        keywords: ["light", "theme", "appearance", "mode", "bright"],
        trailing: activeThemeCheck("light"),
        onSelect: () => {
          setTheme("light");
          setOpen(false);
        },
      },
      {
        key: "theme-dark",
        label: t(($) => $.commands.switch_to_dark),
        icon: Moon,
        keywords: ["dark", "theme", "appearance", "mode", "night"],
        trailing: activeThemeCheck("dark"),
        onSelect: () => {
          setTheme("dark");
          setOpen(false);
        },
      },
      {
        key: "theme-system",
        label: t(($) => $.commands.use_system_theme),
        icon: Monitor,
        keywords: ["system", "theme", "appearance", "mode", "auto"],
        trailing: activeThemeCheck("system"),
        onSelect: () => {
          setTheme("system");
          setOpen(false);
        },
      },
    );

    return items;
  }, [currentIssue, currentIssueId, getShareableUrl, pathname, queryClient, setOpen, setTheme, theme, t]);

  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    // No query: only surface the primary creation action. Other commands
    // (theme switches, copy actions, New Project) are revealed as the user
    // types, leaving the empty-state space to Recent.
    if (!q) return commands.filter((c) => c.key === "new-issue");
    return commands.filter((c) => matchesRow(c.label, c.keywords, q));
  }, [commands, query]);

  const filteredMembers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const wantsAllMembers =
      q.length >= 3 &&
      ("members".startsWith(q) ||
        "people".startsWith(q) ||
        "users".startsWith(q) ||
        "team".startsWith(q));
    return members
      .filter((member) => wantsAllMembers || matchesMember(member, q))
      .slice(0, 10);
  }, [members, query]);

  const hasResults =
    results.issues.length > 0 ||
    results.projects.length > 0 ||
    filteredMembers.length > 0;

  // Rows answering an earlier query are still painted while the next request
  // is in flight — that is what keeps the list from strobing on every
  // keystroke — but they must not be actionable: cmdk re-selects the first
  // valid item whenever the input changes, so a live stale row turns the next
  // Enter into a jump to a result the user has already typed past.
  const resultsAreStale = results.query !== query.trim();

  // Cross-type cancelled demotion (MUL-5824). The two searches are ranked
  // independently server-side, so the partition has to happen here, where they
  // are aggregated for display. See the render note on the results list.
  const partitionedResults = useMemo(
    () =>
      partitionAggregatedSearchResults({
        issues: results.issues,
        projects: results.projects,
        // The partition describes these rows, so it keys off the query they
        // answer — not what the user has typed since.
        query: results.query,
      }),
    [results],
  );

  const shownResultCount =
    filteredPages.length +
    filteredCommands.length +
    filteredMembers.length +
    partitionedResults.liveProjects.length +
    partitionedResults.liveIssues.length +
    partitionedResults.cancelledProjects.length +
    partitionedResults.cancelledIssues.length;

  // Close on single ESC — capture phase fires before base-ui Dialog's handlers
  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleEsc, true);
    return () => document.removeEventListener("keydown", handleEsc, true);
  }, [open, setOpen]);

  // Cleanup debounce/abort on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults(NO_RESULTS);
      setIsLoading(false);
    }
  }, [open]);

  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    if (!q.trim()) {
      setResults(NO_RESULTS);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const [issueRes, projectRes] = await Promise.all([
          api.searchIssues({
            q: q.trim(),
            limit: 20,
            include_closed: true,
            signal: controller.signal,
          }),
          api.searchProjects({
            q: q.trim(),
            limit: 10,
            include_closed: true,
            signal: controller.signal,
          }),
        ]);
        if (!controller.signal.aborted) {
          setResults({
            query: q.trim(),
            issues: issueRes.issues,
            projects: projectRes.projects,
          });
          setIsLoading(false);
        }
      } catch {
        if (!controller.signal.aborted) {
          // Drop the previous query's rows rather than leaving them on screen
          // permanently greyed out: the request that would have replaced them
          // is never coming. The list falls through to the empty state.
          setResults({ query: q.trim(), issues: [], projects: [] });
          setIsLoading(false);
        }
      }
    }, 300);
  }, []);

  const handleValueChange = useCallback(
    (value: string) => {
      setQuery(value);
      search(value);
    },
    [search],
  );

  const handleSelect = useCallback(
    (value: string) => {
      setOpen(false);
      const href = value.startsWith("project:")
        ? // value is "project:<id>" — slice off the 8-char prefix to extract the id.
          p.projectDetail(value.slice(8))
        : p.issueDetail(value);
      intentNavigate(href, consumeIntent());
    },
    [intentNavigate, consumeIntent, setOpen, p],
  );

  const handlePageSelect = useCallback(
    (key: WorkspacePageKey) => {
      setOpen(false);
      intentNavigate(p[key](), consumeIntent());
    },
    [intentNavigate, consumeIntent, setOpen, p],
  );

  const handleMemberSelect = useCallback(
    (userId: string) => {
      intentNavigate(p.memberDetail(userId), consumeIntent());
      setOpen(false);
    },
    [intentNavigate, consumeIntent, setOpen, p],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        finalFocus={false}
        overlayClassName="qw-cmd-overlay-bg"
        className="qw-cmd-content"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t(($) => $.title)}</DialogTitle>
          <DialogDescription>{t(($) => $.description)}</DialogDescription>
        </DialogHeader>
        <CommandPrimitive
          shouldFilter={false}
          onPointerDownCapture={recordIntent}
          onClickCapture={recordIntent}
          onKeyDownCapture={(e) => {
            if (e.key === "Enter") {
              recordIntent({
                button: 0,
                metaKey: e.metaKey,
                ctrlKey: e.ctrlKey,
                shiftKey: e.shiftKey,
              });
            }
          }}
          className="qw-cmd-root"
        >
          <header className="qw-cmd-head">
            <div className="qw-cmd-search">
              <SearchIcon className="qw-cmd-search-ico" aria-hidden="true" />
              <CommandPrimitive.Input
                placeholder={t(($) => $.palette.placeholder)}
                value={query}
                onValueChange={handleValueChange}
                onKeyDown={(e) => {
                  if (e.key === "Home" || e.key === "End") {
                    e.stopPropagation();
                  }
                }}
                aria-label={t(($) => $.palette.placeholder)}
                className="qw-cmd-input"
              />
              <button
                type="button"
                className="qw-cmd-close"
                onClick={() => setOpen(false)}
                aria-label={t(($) => $.palette.close)}
              >
                <span className="qw-cmd-key">{t(($) => $.palette.esc)}</span>
              </button>
            </div>
            <div className="qw-cmd-strip">
              <span className="qw-cmd-scope">
                {t(($) => $.palette.scope, {
                  slug: workspace?.slug ?? "—",
                  count: 6,
                })}
              </span>
              <span className="qw-cmd-count">
                {query.trim()
                  ? shownResultCount
                    ? t(($) => $.palette.result_count, {
                        count: shownResultCount,
                      })
                    : t(($) => $.palette.no_results_count)
                  : t(($) => $.palette.recent_count, {
                      count: recentIssues.length,
                    })}
              </span>
            </div>
          </header>

          <CommandPrimitive.List className="qw-cmd-results" role="listbox">
            {filteredPages.length > 0 && (
              <CommandPrimitive.Group
                heading={
                  <GroupHeading
                    label={t(($) => $.groups.pages)}
                    cap={t(($) => $.caps.pages)}
                    count={filteredPages.length}
                  />
                }
                className={GROUP_CLASS}
              >
                {filteredPages.map((page) => {
                  const PageIcon = routeIconForPath(p[page.key]());
                  return (
                    <CommandPrimitive.Item
                      key={page.key}
                      value={`page:${page.key}`}
                      onSelect={() => handlePageSelect(page.key)}
                      className="qw-cmd-row"
                    >
                      <span className="qw-cmd-row-ico">
                        <PageIcon className="size-3.5" aria-hidden="true" />
                      </span>
                      <div className="qw-cmd-row-main">
                        <span className="qw-cmd-row-title">
                          <HighlightText text={page.label} query={query} />
                        </span>
                      </div>
                      <span className="qw-cmd-row-tail">
                        <span className="qw-cmd-enter" aria-hidden="true">
                          ↵
                        </span>
                      </span>
                    </CommandPrimitive.Item>
                  );
                })}
              </CommandPrimitive.Group>
            )}

            {filteredCommands.length > 0 && (
              <CommandPrimitive.Group
                heading={
                  <GroupHeading
                    label={t(($) => $.groups.commands)}
                    cap={t(($) => $.caps.commands)}
                    count={filteredCommands.length}
                  />
                }
                className={GROUP_CLASS}
              >
                {filteredCommands.map((cmd) => (
                  <CommandPrimitive.Item
                    key={cmd.key}
                    value={`command:${cmd.key}`}
                    onSelect={cmd.onSelect}
                    className="qw-cmd-row"
                  >
                    <span className="qw-cmd-row-ico">
                      <cmd.icon className="size-3.5" aria-hidden="true" />
                    </span>
                    <div className="qw-cmd-row-main">
                      <span className="qw-cmd-row-title">
                        <HighlightText text={cmd.label} query={query} />
                      </span>
                    </div>
                    <span className="qw-cmd-row-tail">
                      {cmd.trailing}
                      <span className="qw-cmd-enter" aria-hidden="true">
                        ↵
                      </span>
                    </span>
                  </CommandPrimitive.Item>
                ))}
              </CommandPrimitive.Group>
            )}

            {filteredMembers.length > 0 && (
              <CommandPrimitive.Group
                heading={
                  <GroupHeading
                    label={t(($) => $.groups.members)}
                    cap={t(($) => $.caps.members)}
                    count={filteredMembers.length}
                  />
                }
                className={GROUP_CLASS}
              >
                {filteredMembers.map((member) => (
                  <CommandPrimitive.Item
                    key={member.user_id}
                    value={`member:${member.user_id}`}
                    onSelect={() => handleMemberSelect(member.user_id)}
                    className="qw-cmd-row"
                  >
                    <span className="qw-cmd-row-ico qw-cmd-row-ava">
                      <ActorAvatarBase
                        name={member.name}
                        initials={memberInitials(member.name)}
                        avatarUrl={resolvePublicFileUrl(member.avatar_url)}
                        size="md"
                      />
                    </span>
                    <div className="qw-cmd-row-main">
                      <div className="qw-cmd-row-title">
                        <HighlightText text={member.name} query={query} />
                      </div>
                      <div className="qw-cmd-row-sub">
                        <HighlightText text={member.email} query={query} />
                      </div>
                    </div>
                    <span className="qw-cmd-row-tail">
                      <span className="qw-cmd-enter" aria-hidden="true">
                        ↵
                      </span>
                    </span>
                  </CommandPrimitive.Item>
                ))}
              </CommandPrimitive.Group>
            )}

            {isLoading && !hasResults && (
              <div className="qw-cmd-loading">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              </div>
            )}

            {!isLoading &&
              query.trim() &&
              !hasResults &&
              filteredPages.length === 0 &&
              filteredCommands.length === 0 && (
                <CommandPrimitive.Empty className="qw-cmd-empty">
                  <b>
                    {t(($) => $.palette.no_results_title, {
                      query: query.trim(),
                    })}
                  </b>
                  <span>{t(($) => $.palette.no_results_hint)}</span>
                </CommandPrimitive.Empty>
              )}

            {partitionedResults.liveProjects.length > 0 && (
              <CommandPrimitive.Group
                heading={
                  <GroupHeading
                    label={t(($) => $.groups.projects)}
                    cap={t(($) => $.caps.projects)}
                    count={partitionedResults.liveProjects.length}
                  />
                }
                className={GROUP_CLASS}
              >
                {partitionedResults.liveProjects.map((project) => (
                  <ProjectResultRow
                    key={`project:${project.id}`}
                    project={project}
                    query={results.query}
                    disabled={resultsAreStale}
                    onSelect={handleSelect}
                  />
                ))}
              </CommandPrimitive.Group>
            )}

            {partitionedResults.liveIssues.length > 0 && (
              <CommandPrimitive.Group
                heading={
                  <GroupHeading
                    label={t(($) => $.groups.issues)}
                    cap={t(($) => $.caps.issues)}
                    count={partitionedResults.liveIssues.length}
                  />
                }
                className={GROUP_CLASS}
              >
                {partitionedResults.liveIssues.map((issue) => (
                  <IssueResultRow
                    key={issue.id}
                    issue={issue}
                    query={results.query}
                    disabled={resultsAreStale}
                    onSelect={handleSelect}
                  />
                ))}
              </CommandPrimitive.Group>
            )}

            {partitionedResults.hasCancelled && (
              <CommandPrimitive.Group
                heading={
                  <GroupHeading
                    label={t(($) => $.groups.cancelled)}
                    cap={t(($) => $.caps.cancelled)}
                    count={
                      partitionedResults.cancelledProjects.length +
                      partitionedResults.cancelledIssues.length
                    }
                  />
                }
                className={GROUP_CLASS}
              >
                {partitionedResults.cancelledProjects.map((project) => (
                  <ProjectResultRow
                    key={`project:${project.id}`}
                    project={project}
                    query={results.query}
                    disabled={resultsAreStale}
                    onSelect={handleSelect}
                  />
                ))}
                {partitionedResults.cancelledIssues.map((issue) => (
                  <IssueResultRow
                    key={issue.id}
                    issue={issue}
                    query={results.query}
                    disabled={resultsAreStale}
                    onSelect={handleSelect}
                  />
                ))}
              </CommandPrimitive.Group>
            )}

            {!query.trim() && recentIssues.length > 0 && (
              <CommandPrimitive.Group
                heading={
                  <GroupHeading
                    label={t(($) => $.groups.recent)}
                    cap={t(($) => $.caps.recent)}
                    count={recentIssues.length}
                  />
                }
                className={GROUP_CLASS}
              >
                {recentIssues.map((item) => (
                  <CommandPrimitive.Item
                    key={item.id}
                    value={item.id}
                    onSelect={handleSelect}
                    className="qw-cmd-row"
                  >
                    <span className="qw-cmd-row-ico">
                      <StatusIcon
                        status={item.status}
                        category={issueStatusCategory(item) ?? undefined}
                        className="size-3.5 shrink-0"
                      />
                    </span>
                    <div className="qw-cmd-row-main">
                      <span className="qw-cmd-row-title">{item.title}</span>
                      <span className="qw-cmd-row-sub">{item.identifier}</span>
                    </div>
                    <span className="qw-cmd-row-tail">
                      <IssueAssigneeAvatar
                        assigneeType={item.assignee_type}
                        assigneeId={item.assignee_id}
                      />
                      <span className="qw-cmd-enter" aria-hidden="true">
                        ↵
                      </span>
                    </span>
                  </CommandPrimitive.Item>
                ))}
              </CommandPrimitive.Group>
            )}

            {!isLoading && !query.trim() && recentIssues.length === 0 && (
              <div className="qw-cmd-empty" role="status">
                <b>{t(($) => $.palette.idle_title)}</b>
                <span>{t(($) => $.palette.idle_hint)}</span>
              </div>
            )}
          </CommandPrimitive.List>

          <footer className="qw-cmd-foot">
            <span className="qw-cmd-mark">{t(($) => $.palette.mark)}</span>
            <span className="qw-cmd-hints">
              <span className="qw-cmd-hint">
                <kbd className="qw-cmd-key">↑</kbd>
                <kbd className="qw-cmd-key">↓</kbd>
                {t(($) => $.palette.hint_select)}
              </span>
              <span className="qw-cmd-hint">
                <kbd className="qw-cmd-key">↵</kbd>
                {t(($) => $.palette.hint_open)}
              </span>
              <span className="qw-cmd-hint">
                <kbd className="qw-cmd-key">{t(($) => $.palette.esc)}</kbd>
                {t(($) => $.palette.hint_close)}
              </span>
            </span>
          </footer>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  );
}
