"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpDown,
  ArrowUpRight,
  Check,
  ChevronRight,
  Info,
  ListTodo,
  Plus,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuthStore } from "@quickwork/core/auth";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useWorkspacePaths } from "@quickwork/core/paths";
import { issueChainsOptions, issueListOptions } from "@quickwork/core/issues/queries";
import { inboxListOptions } from "@quickwork/core/inbox/queries";
import { useBatchDeleteIssues } from "@quickwork/core/issues/mutations";
import { agentTaskSnapshotOptions } from "@quickwork/core/agents/queries";
import { useActorName } from "@quickwork/core/workspace/hooks";
import { useModalStore } from "@quickwork/core/modals";
import { useIssueStatuses } from "@quickwork/core/issue-statuses/hooks";
import type { AgentTask, Issue, IssueChainForIssue, IssueChainStep, IssueStatusCategory } from "@quickwork/core/types";
import { Button } from "@quickwork/ui/components/ui/button";
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
import { cn } from "@quickwork/ui/lib/utils";

import { ActorAvatar } from "../common/actor-avatar";
import { stepRunState } from "../issues/components/chain-run-state";
import { useStatusLabel } from "../issues/utils/status-label";
import { CollapsedNavTrigger } from "../layout/page-header";
import { useT, useTimeAgo } from "../i18n";
import { useNavigation } from "../navigation";

/**
 * The task feed: solo tasks and squad relays in one list.
 *
 * The page is a ledger: a serif masthead, one line of live counts, then
 * hairline rows. A solo task answers "what is it, who has it"; a squad task
 * answers "whose turn is it" with the relay inline. The right column is the
 * one state that has to be visible without opening the row.
 */

/** How many tasks the feed draws. Chains are fetched for exactly this page,
 *  so the cap is also the bound on the bulk request. */
const FEED_LIMIT = 60;

/** How many relay legs the row strip draws before folding the rest into +N. */
const STRIP_LEGS = 4;

/** Tasks per page. The pager is pinned below the list; the feed itself is
 *  already capped at FEED_LIMIT, so pages stay few and page buttons stay
 *  countable (no ellipsis logic needed). */
const PAGE_SIZE = 10;

type FilterKey = "all" | "single" | "squad" | "mine" | "parked";
type SortKey = "recent" | "oldest";
type Tone = "running" | "review" | "parked" | "done" | "quiet";

const FILTERS: FilterKey[] = ["all", "single", "squad", "mine", "parked"];

const ROW_GRID =
  "grid grid-cols-[20px_76px_minmax(0,1fr)_156px_96px] items-center gap-x-[14px] " +
  "min-[1381px]:grid-cols-[20px_76px_minmax(0,1fr)_172px_96px]";

const TONE_TEXT: Record<Tone, string> = {
  running: "text-inflight",
  review: "text-review",
  parked: "text-warning",
  done: "text-success",
  quiet: "text-muted-foreground",
};

const TONE_LAMP: Record<Tone, string> = {
  running: "bg-inflight",
  review: "bg-review",
  parked: "bg-warning",
  done: "bg-success",
  quiet: "border border-input bg-background",
};

/** The viewer's own leg of a relay. Unfinished beats delivered — a person's
 *  row is always the thing still on them. */
function viewerStep(
  chain: IssueChainForIssue,
  userId: string | undefined,
): IssueChainStep | undefined {
  if (!userId) return undefined;
  return (
    chain.steps.find(
      (s) =>
        s.holder_user_id === userId &&
        s.state !== "done" &&
        s.state !== "skipped",
    ) ?? chain.steps.find((s) => s.holder_user_id === userId)
  );
}

/** The leg the relay is sitting on. Done and skipped legs are history. */
function activeStep(chain: IssueChainForIssue): IssueChainStep | undefined {
  return chain.steps.find((s) => s.state !== "done" && s.state !== "skipped");
}

function lastTouched(issue: Issue): string {
  return issue.last_activity_at ?? issue.updated_at;
}

function isSquadTask(issue: Issue, chain?: IssueChainForIssue): boolean {
  // A relay can be assigned to the person holding the active leg while the
  // issue still carries a chain. The chain is the stronger signal.
  return issue.assignee_type === "squad" || !!chain;
}

function categoryTone(category: IssueStatusCategory | undefined): Tone {
  switch (category) {
    case "in_progress":
      return "running";
    case "in_review":
      return "review";
    case "blocked":
      return "parked";
    case "done":
      return "done";
    default:
      return "quiet";
  }
}

function clockLabel(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function TaskListPage() {
  const { t } = useT("tasks");
  const wsId = useWorkspaceId();
  const navigation = useNavigation();
  const wsPaths = useWorkspacePaths();
  const { data: inboxItems = [] } = useQuery(inboxListOptions(wsId));
  const quickCreateFailures = inboxItems.filter(
    (item) => item.type === "quick_create_failed" && !item.archived,
  );
  const user = useAuthStore((s) => s.user);
  const timeAgo = useTimeAgo();
  const { getMemberName, getAgentName, getSquadName } = useActorName();
  const statusLabel = useStatusLabel(wsId);
  const { categoryOf } = useIssueStatuses(wsId);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [order, setOrder] = useState<SortKey>("recent");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [clock, setClock] = useState("--:--");
  const batchDelete = useBatchDeleteIssues();
  const listRef = useRef<HTMLDivElement | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const tabEls = useRef<Partial<Record<FilterKey, HTMLButtonElement | null>>>({});
  const [tabLine, setTabLine] = useState({ left: 0, width: 0, ready: false });
  const [tabGhost, setTabGhost] = useState({ left: 0, width: 0, show: false });

  const { data: issues = [], isPending } = useQuery(issueListOptions(wsId));

  useEffect(() => {
    const tick = () => setClock(clockLabel(new Date()));
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Newest activity first by default; the page cap is applied before the
  // chain fetch so the bulk request carries exactly the ids on screen.
  const feedIssues = useMemo(
    () =>
      [...issues]
        .sort((a, b) => {
          const diff =
            new Date(lastTouched(b)).getTime() - new Date(lastTouched(a)).getTime();
          return order === "recent" ? diff : -diff;
        })
        .slice(0, FEED_LIMIT),
    [issues, order],
  );

  const feedIds = useMemo(() => feedIssues.map((i) => i.id), [feedIssues]);
  const { data: chains = [] } = useQuery(issueChainsOptions(feedIds));
  // Run states for the relays on screen: a step marked `doing` that no
  // environment has claimed yet is waiting on its holder, not running.
  const { data: tasks = [] } = useQuery(agentTaskSnapshotOptions(wsId));

  const chainByIssue = useMemo(
    () => new Map(chains.map((c) => [c.issue_id, c])),
    [chains],
  );

  const isMine = useCallback(
    (issue: Issue, chain: IssueChainForIssue | undefined) => {
      if (chain) {
        // Mine = I hold a leg of it, matching what the row itself shows.
        return !!viewerStep(chain, user?.id);
      }
      return (
        !!user &&
        issue.assignee_type === "member" &&
        issue.assignee_id === user.id
      );
    },
    [user],
  );

  const counts = useMemo(() => {
    let single = 0;
    let squad = 0;
    let mine = 0;
    let parked = 0;
    for (const issue of feedIssues) {
      const chain = chainByIssue.get(issue.id);
      if (isSquadTask(issue, chain)) squad++;
      else single++;
      if (chain?.parked) parked++;
      if (isMine(issue, chain)) mine++;
    }
    return { all: feedIssues.length, single, squad, mine, parked };
  }, [feedIssues, chainByIssue, isMine]);

  const liveCounts = useMemo(() => {
    let running = 0;
    let review = 0;
    for (const issue of feedIssues) {
      const chain = chainByIssue.get(issue.id);
      if (chain) {
        if (chain.parked) continue;
        if (chain.reviewing) {
          review++;
          continue;
        }
        const current = activeStep(chain);
        if (current?.state === "doing") {
          if (stepRunState(issue.id, current, tasks) !== "queued") running++;
        } else if (current?.state === "reviewing") {
          review++;
        }
        continue;
      }
      const category = categoryOf(issue.status);
      if (category === "in_progress") running++;
      else if (category === "in_review") review++;
    }
    return {
      running,
      review,
      quiet: Math.max(0, feedIssues.length - running - review),
    };
  }, [feedIssues, chainByIssue, tasks, categoryOf]);

  const visible = useMemo(() => {
    switch (filter) {
      case "single":
        return feedIssues.filter((i) => !isSquadTask(i, chainByIssue.get(i.id)));
      case "squad":
        return feedIssues.filter((i) => isSquadTask(i, chainByIssue.get(i.id)));
      case "parked":
        return feedIssues.filter((i) => chainByIssue.get(i.id)?.parked);
      case "mine":
        return feedIssues.filter((i) => isMine(i, chainByIssue.get(i.id)));
      default:
        return feedIssues;
    }
  }, [feedIssues, chainByIssue, filter, isMine]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageItems = useMemo(
    () => visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [visible, safePage],
  );
  const goToPage = (next: number) => {
    setPage(next);
    // A page turn is a new first screen — land it at the top.
    listRef.current?.scrollTo?.({ top: 0 });
  };

  // Selection is the intersection of what the user ticked and what the feed
  // still contains, so a realtime delete never inflates the batch count.
  const selected = useMemo(
    () => feedIssues.filter((issue) => selectedIds.has(issue.id)).map((issue) => issue.id),
    [feedIssues, selectedIds],
  );
  const pageIds = pageItems.map((issue) => issue.id);
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const selectPage = useCallback(() => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const issue of pageItems) next.add(issue.id);
      return next;
    });
  }, [pageItems]);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const openDelete = useCallback((issue: Issue) => {
    useModalStore.getState().open("issue-delete-confirm", {
      issueId: issue.id,
      identifier: issue.identifier,
    });
  }, []);

  const openIssue = useCallback(
    (issueId: string) => navigation.push(wsPaths.issueDetail(issueId)),
    [navigation, wsPaths],
  );

  // Stable across row re-renders: a new object here would defeat TaskRow's memo.
  const resolveName = useMemo<NameResolver>(
    () => ({ member: getMemberName, agent: getAgentName, squad: getSquadName }),
    [getMemberName, getAgentName, getSquadName],
  );

  const handleBatchDelete = async () => {
    const ids = selected;
    try {
      await batchDelete.mutateAsync(ids);
      clearSelection();
      toast.success(t(($) => $.bulk.delete_success, { count: ids.length }));
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : t(($) => $.bulk.delete_failed),
      );
    }
  };

  const filterName = (key: FilterKey) => t(($) => $.filter_name[key]);

  const liveText = (key: "running" | "review" | "quiet") =>
    t(($) => $.mast[key]);

  const measureTab = useCallback((key: FilterKey) => {
    const container = tabsRef.current;
    const tab = tabEls.current[key];
    if (!container || !tab) return null;
    const c = container.getBoundingClientRect();
    const b = tab.getBoundingClientRect();
    return { left: b.left - c.left, width: b.width };
  }, []);

  const moveTabLine = useCallback(
    (key: FilterKey) => {
      const next = measureTab(key);
      if (!next) return;
      setTabLine((current) =>
        current.ready && current.left === next.left && current.width === next.width
          ? current
          : { ...next, ready: true },
      );
    },
    [measureTab],
  );

  useLayoutEffect(() => {
    moveTabLine(filter);
  }, [filter, moveTabLine]);

  useEffect(() => {
    const onResize = () => moveTabLine(filter);
    window.addEventListener("resize", onResize);
    void document.fonts?.ready.then(onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [filter, moveTabLine]);

  const hoverTab = (key: FilterKey) => {
    const next = measureTab(key);
    if (next) setTabGhost({ ...next, show: true });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-start gap-4 border-b border-foreground px-[34px] pb-[14px] pt-[22px]">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <div className="pt-1.5">
            <CollapsedNavTrigger />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-start gap-x-3.5 gap-y-2">
              <h1 className="font-serif text-[40px] font-semibold leading-[44px] tracking-[0.015em]">
                {t(($) => $.title)}
              </h1>
              <span className="flex items-start gap-[6px] border-l border-border pl-[14px] pt-px">
                <span className="font-serif text-[42px] leading-[42px] tracking-[-0.01em] tabular-nums">
                  {feedIssues.length}
                </span>
                <span className="pt-[5px] font-mono text-[8px] font-medium uppercase leading-none tracking-[0.16em] text-faint-foreground [writing-mode:vertical-rl]">
                  TASKS
                </span>
              </span>
              <Button
                size="sm"
                className="group/create mt-[3px] h-[38px] gap-[8px] rounded-[4px] border border-foreground bg-foreground px-[14px] text-[12px] font-semibold text-background shadow-none hover:border-brand hover:bg-brand"
                onClick={() => useModalStore.getState().open("quick-create-issue")}
              >
                <span className="grid size-[17px] place-items-center rounded-[3px] bg-brand text-background transition-colors group-hover/create:bg-background group-hover/create:text-brand">
                  <Plus aria-hidden="true" className="size-3" />
                </span>
                {t(($) => $.create)}
                <span
                  aria-hidden="true"
                  className="ml-[2px] inline-grid h-[17px] min-w-[18px] place-items-center rounded-[3px] border border-background/25 bg-background/10 px-[4px] font-mono text-[9px] font-medium leading-none text-background/70"
                >
                  C
                </span>
              </Button>
            </div>
            <p className="mt-[8px] flex flex-wrap items-center gap-[8px] text-[12px] text-secondary-foreground">
              <span className="flex items-center gap-1.5">
                <span className="relative size-[5px] shrink-0 rounded-[1px] bg-inflight" />
                <b className="font-mono text-[12px] font-semibold tabular-nums text-foreground">
                  {liveCounts.running}
                </b>
                {liveText("running")}
              </span>
              <span aria-hidden="true" className="text-input">
                ·
              </span>
              <span className="flex items-center gap-[8px]">
                <span className="size-[5px] shrink-0 rounded-[1px] bg-review" />
                <b className="font-mono text-[12px] font-semibold tabular-nums text-foreground">
                  {liveCounts.review}
                </b>
                {liveText("review")}
              </span>
              <span aria-hidden="true" className="text-input">
                ·
              </span>
              <span className="flex items-center gap-[8px] text-muted-foreground">
                <b className="font-mono text-[12px] font-semibold tabular-nums">
                  {liveCounts.quiet}
                </b>
                {liveText("quiet")}
              </span>
              <span className="group relative inline-flex items-center">
                <button
                  type="button"
                  aria-label={t(($) => $.mast.info)}
                  className="grid size-5 place-items-center rounded-full text-faint-foreground transition-colors hover:bg-surface hover:text-secondary-foreground"
                >
                  <Info aria-hidden="true" className="size-[11px]" />
                </button>
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-[-6px] top-[calc(100%+8px)] z-30 w-[270px] rounded-[5px] border border-input bg-popover px-[11px] py-[9px] text-[12px] leading-[18px] text-secondary-foreground opacity-0 shadow-[var(--menu-shadow)] transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                >
                  {t(($) => $.mast.info)}
                </span>
              </span>
            </p>
          </div>
        </div>
        <div className="hidden shrink-0 pt-[6px] text-right md:block">
          <span className="inline-flex items-center gap-[7px] font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-faint-foreground">
            <span className="size-[5px] rounded-full bg-success" />
            SYNCED
          </span>
          <span className="mt-[5px] block font-mono text-[10px] tabular-nums tracking-[0.04em] text-muted-foreground">
            {clock}
          </span>
          <span className="mt-[6px] block text-[11px] text-faint-foreground">
            {t(($) => $.mast.sync_hint)}
          </span>
        </div>
      </header>

      {quickCreateFailures.length > 0 ? (
        <div className="mx-[34px] mt-3 flex shrink-0 items-start gap-2.5 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-caption leading-5 text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <b className="font-semibold">
              {t(($) => $.quick_create_failed_banner, {
                count: quickCreateFailures.length,
              })}
            </b>
            <p className="mt-0.5 truncate text-muted-foreground">
              {quickCreateFailures[0]?.body ||
                t(($) => $.quick_create_failed_fallback)}
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 text-caption font-medium underline underline-offset-2"
            onClick={() => navigation.push(wsPaths.inbox())}
          >
            {t(($) => $.quick_create_failed_view)}
          </button>
        </div>
      ) : null}

      <div className="flex h-[45px] shrink-0 items-end border-b border-border px-[34px]">
        <div
          ref={tabsRef}
          className="relative flex min-w-0 items-center gap-[2px] overflow-x-auto"
          role="group"
          aria-label={t(($) => $.title)}
          onMouseLeave={() => setTabGhost((current) => ({ ...current, show: false }))}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-[-1px] left-0 h-[2px] rounded-[1px] bg-input transition-[left,width,opacity] duration-[230ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
            style={{ left: tabGhost.left, width: tabGhost.width, opacity: tabGhost.show ? 1 : 0 }}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-[-1px] left-0 h-[2px] rounded-[1px] bg-brand transition-[left,width] duration-[230ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
            style={{ left: tabLine.left, width: tabLine.width, opacity: tabLine.ready ? 1 : 0 }}
          />
          {FILTERS.map((key, i) => (
            <span key={key} className="flex shrink-0 items-center">
              {/* A hairline between the type filters and the personal ones:
                  they answer different questions ("what kind" vs "whose"). */}
              {i === 3 ? (
                <span aria-hidden="true" className="mx-[5px] h-[15px] w-px bg-input" />
              ) : null}
              <button
                type="button"
                ref={(el) => {
                  tabEls.current[key] = el;
                }}
                aria-pressed={filter === key}
                data-active={filter === key ? "" : undefined}
                onMouseEnter={() => hoverTab(key)}
                onClick={() => {
                  if (key !== filter) clearSelection();
                  setTabGhost((current) => ({ ...current, show: false }));
                  setFilter(key);
                  setPage(1);
                }}
                className={cn(
                  "inline-flex h-[45px] items-center gap-[7px] px-[11px] text-[12px] font-medium transition-colors",
                  filter === key
                    ? "font-[650] text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {key === "parked" ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-1 rounded-full",
                      counts.parked > 0 ? "bg-warning" : "border border-warning/60",
                    )}
                  />
                ) : null}
                {filterName(key)}{" "}
                <em
                  className={cn(
                    "font-mono text-[10px] not-italic",
                    filter === key ? "text-brand" : "text-faint-foreground",
                  )}
                >
                  {counts[key]}
                </em>
              </button>
            </span>
          ))}
        </div>
        <button
          type="button"
          aria-label={t(($) => $.mast.sort_label)}
          onClick={() => {
            setOrder((current) => (current === "recent" ? "oldest" : "recent"));
            setPage(1);
          }}
          className="ml-auto inline-flex h-[28px] shrink-0 items-center gap-[6px] rounded-[4px] px-[7px] text-[11px] text-muted-foreground transition-colors hover:border hover:border-border hover:bg-surface hover:text-foreground"
        >
          <ArrowUpDown
            aria-hidden="true"
            className={cn(
              "size-3 transition-transform duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
              order === "oldest" && "rotate-180",
            )}
          />
          {order === "recent"
            ? t(($) => $.mast.sort_recent)
            : t(($) => $.mast.sort_oldest)}
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          aria-hidden={selected.length === 0}
          inert={selected.length === 0}
          className={cn(
            "absolute left-1/2 top-3 z-30 flex h-[42px] origin-top -translate-x-1/2 items-center gap-1 rounded-[6px] bg-foreground py-0 pl-[14px] pr-[6px] text-background shadow-[0_18px_40px_-18px_rgba(0,0,0,.55)] transition-[opacity,translate,scale] duration-200 ease-out motion-reduce:transition-none",
            selected.length > 0
              ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
              : "pointer-events-none -translate-y-[10px] scale-[.98] opacity-0",
          )}
        >
            <span className="text-[11px] text-background/75">
              {t(($) => $.bulk.selected, { count: selected.length })}
            </span>
            <span aria-hidden="true" className="mx-1 h-3.5 w-px bg-background/20" />
            <button
              type="button"
              disabled={allPageSelected}
              onClick={selectPage}
              className="inline-flex h-[30px] items-center gap-[5px] rounded-[4px] px-[9px] text-[11px] font-medium transition-colors hover:bg-background/10 disabled:opacity-40"
            >
              <Check aria-hidden="true" className="size-3" />
              {t(($) => $.bulk.select_page)}
            </button>
            <button
              type="button"
              disabled={batchDelete.isPending}
              onClick={() => setDeleteOpen(true)}
              className="inline-flex h-[30px] items-center gap-[5px] rounded-[4px] px-[9px] text-[11px] font-medium text-[color-mix(in_oklab,var(--destructive)_52%,white)] transition-colors hover:bg-destructive/20 disabled:opacity-40"
            >
              <Trash2 aria-hidden="true" className="size-3" />
              {t(($) => $.bulk.delete)}
            </button>
            <button
              type="button"
              onClick={clearSelection}
              aria-label={t(($) => $.bulk.clear)}
              className="grid size-[30px] place-items-center rounded-[4px] text-background/70 transition-colors hover:bg-background/10 hover:text-background"
            >
              <X className="size-3.5" />
            </button>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-[34px]">
          {isPending ? null : feedIssues.length === 0 ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center px-5 py-10 text-center">
              <span className="grid size-[42px] place-items-center rounded-full border border-dashed border-input text-faint-foreground">
                <ListTodo aria-hidden="true" className="size-4" />
              </span>
              <h2 className="mt-[14px] font-serif text-[24px] font-semibold">
                {t(($) => $.empty.title)}
              </h2>
              <p className="mt-[6px] max-w-[420px] text-[11px] text-muted-foreground">
                {t(($) => $.empty.body)}
              </p>
            </div>
          ) : visible.length === 0 ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center px-5 py-10 text-center">
              <span className="grid size-[42px] place-items-center rounded-full border border-dashed border-input text-faint-foreground">
                <ListTodo aria-hidden="true" className="size-4" />
              </span>
              <h2 className="mt-[14px] font-serif text-[24px] font-semibold">
                {t(($) => $.empty.filtered_title)}
              </h2>
              <p className="mt-[6px] text-[11px] text-muted-foreground">
                {t(($) => $.empty.filtered_body)}
              </p>
            </div>
          ) : (
            <>
              <div
                className={cn(
                  "sticky top-0 z-20 h-[34px] border-b bg-[color-mix(in_oklab,var(--background)_90%,transparent)] px-[6px] font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-faint-foreground backdrop-blur",
                  ROW_GRID,
                )}
              >
                <span className="col-span-3">{t(($) => $.board.task)}</span>
                <span>{t(($) => $.board.state)}</span>
                <span className="hidden justify-self-end md:block">
                  {t(($) => $.board.actions)}
                </span>
              </div>
              {pageItems.map((issue, index) => {
                const chain = chainByIssue.get(issue.id);
                return (
                  <TaskRow
                    key={`${issue.id}-${filter}-${order}-${safePage}`}
                    enterIndex={index}
                    issue={issue}
                    chain={chain}
                    legStep={chain ? viewerStep(chain, user?.id) : undefined}
                    tasks={tasks}
                    resolveName={resolveName}
                    statusText={statusLabel(issue.status)}
                    statusCategory={categoryOf(issue.status)}
                    ago={timeAgo(lastTouched(issue))}
                    selected={selectedIds.has(issue.id)}
                    onToggleSelected={toggleSelected}
                    onDelete={openDelete}
                    onOpen={openIssue}
                  />
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* The pager sits outside the scroll area: it stays put while the rows
          scroll, so "where am I / how much is left" never scrolls away. */}
      {!isPending && visible.length > 0 ? (
        <footer className="flex h-[44px] flex-none flex-wrap items-center gap-2.5 border-t border-border px-[34px]">
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-faint-foreground">
            {t(($) => $.pager.sum, {
              count: visible.length,
              size: PAGE_SIZE,
              page: safePage,
              pages: pageCount,
            })}
          </span>
          <span className="flex-1" />
          <div className="flex items-center gap-0.5" role="group">
            <button
              type="button"
              onClick={() => goToPage(safePage - 1)}
              disabled={safePage <= 1}
              className={cn(PAGER_BUTTON_CLASS, "px-2.5 disabled:pointer-events-none disabled:opacity-35")}
            >
              ‹ {t(($) => $.pager.prev)}
            </button>
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                data-active={n === safePage ? "" : undefined}
                aria-current={n === safePage ? "page" : undefined}
                onClick={() => goToPage(n)}
                className={cn(
                  PAGER_BUTTON_CLASS,
                  "min-w-[27px] px-[5px] tabular-nums",
                  n === safePage &&
                    "border-foreground bg-foreground text-background hover:border-foreground hover:text-background",
                )}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              onClick={() => goToPage(safePage + 1)}
              disabled={safePage >= pageCount}
              className={cn(PAGER_BUTTON_CLASS, "px-2.5 disabled:pointer-events-none disabled:opacity-35")}
            >
              {t(($) => $.pager.next)} ›
            </button>
          </div>
        </footer>
      ) : null}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $.bulk.delete_title, { count: selected.length })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $.bulk.delete_desc, { count: selected.length })}
              <span className="mt-2 block text-caption text-muted-foreground">
                {t(($) => $.bulk.delete_warning)}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(($) => $.bulk.cancel)}</AlertDialogCancel>
            <AlertDialogAction
              disabled={batchDelete.isPending}
              onClick={() => void handleBatchDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t(($) => $.bulk.delete)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const PAGER_BUTTON_CLASS =
  "inline-flex h-[26px] items-center justify-center rounded-[3px] border border-transparent px-[5px] font-mono text-[10px] text-muted-foreground transition-colors " +
  "hover:border-border hover:bg-muted hover:text-foreground";

type NameResolver = {
  member: (id: string) => string;
  agent: (id: string) => string;
  squad: (id: string) => string;
};

/**
 * One task.
 *
 * The row is the whole story at this depth: a relay task draws its legs
 * inline (who handed off, who is working), a solo task draws its assignee.
 * The right column names the one state that needs acting on, and the whole
 * row is a doorway to the detail.
 */
const TaskRow = memo(function TaskRow({
  issue,
  chain,
  legStep,
  tasks,
  resolveName,
  statusText,
  statusCategory,
  ago,
  selected,
  enterIndex,
  onToggleSelected,
  onDelete,
  onOpen,
}: {
  issue: Issue;
  chain: IssueChainForIssue | undefined;
  /** The viewer's own leg of this relay, when they hold one: the row then
   *  speaks as THEIR subtask (编号 -N，标题), with the parent as context —
   *  a person's task list is the work actually on them. */
  legStep?: IssueChainStep;
  tasks: readonly AgentTask[];
  resolveName: NameResolver;
  statusText: string;
  statusCategory: IssueStatusCategory | undefined;
  ago: string;
  selected: boolean;
  enterIndex: number;
  onToggleSelected: (id: string) => void;
  onDelete: (issue: Issue) => void;
  onOpen: (issueId: string) => void;
}) {
  const { t } = useT("tasks");
  const squad = isSquadTask(issue, chain);
  const current = chain ? activeStep(chain) : undefined;
  const run = current && chain ? stepRunState(chain.issue_id, current, tasks) : "none";
  const parked = chain?.parked === true;
  const reviewing = chain?.reviewing === true || current?.state === "reviewing";
  const displayTitle = legStep ? legStep.title || issue.title : issue.title;
  const displayId = legStep ? `${issue.identifier}-${legStep.position + 1}` : issue.identifier;

  let tone: Tone;
  let word: string;
  let sub: string;
  let action: string;

  if (parked) {
    tone = "parked";
    word = t(($) => $.chain.chip_parked);
    sub = t(($) => $.state.needs_fill);
    action = t(($) => $.state.fill);
  } else if (reviewing) {
    tone = "review";
    word = t(($) => $.chain.chip_review);
    sub = t(($) => $.state.delivered);
    action = t(($) => $.state.review);
  } else if (squad && chain && current) {
    if (current.state === "doing") {
      if (run === "queued") {
        tone = "quiet";
        word = t(($) => $.chain.chip_queued);
        action = t(($) => $.state.open);
      } else {
        tone = "running";
        word = t(($) => $.chain.chip_doing);
        action = t(($) => $.state.view);
      }
    } else {
      tone = "quiet";
      word = t(($) => $.chain.chip_waiting);
      action = t(($) => $.state.open);
    }
    sub = ago;
  } else if (squad) {
    const hasRelay = !!chain && chain.steps.length > 0;
    tone = hasRelay ? categoryTone(statusCategory) : "quiet";
    word = hasRelay ? statusText : t(($) => $.chain.none);
    sub = ago;
    action = t(($) => $.state.open);
  } else {
    tone = categoryTone(statusCategory);
    word = statusText;
    sub = ago;
    action =
      statusCategory === "in_review"
        ? t(($) => $.state.review)
        : statusCategory === "in_progress"
          ? t(($) => $.state.view)
          : t(($) => $.state.open);
  }

  return (
    <div
      className={cn(
        "qw-row-enter group relative border-b border-border transition-colors hover:bg-surface",
        selected && "bg-surface-selected",
      )}
      style={{ animationDelay: `${Math.min(enterIndex * 22, 132)}ms` }}
    >
      <button
        type="button"
        onClick={() => onOpen(issue.id)}
        aria-label={`${displayId} ${displayTitle} ${word}`}
        className="absolute inset-0 z-0 w-full cursor-pointer focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      />

      <div
        className={cn(
          "pointer-events-none relative z-10 min-h-[68px] px-[6px]",
          ROW_GRID,
        )}
      >
        <label className="pointer-events-auto relative grid size-4 cursor-pointer place-items-center">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelected(issue.id)}
            aria-label={t(($) => $.row.select_task, { identifier: issue.identifier })}
            className="peer absolute inset-0 z-10 m-0 size-4 cursor-pointer opacity-0"
          />
          <span className="grid size-4 place-items-center rounded-[3px] border-[1.5px] border-input bg-background transition-colors peer-checked:border-foreground peer-checked:bg-foreground peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-checked:[&>svg]:scale-100 peer-checked:[&>svg]:opacity-100 group-hover:border-brand">
            <Check
              aria-hidden="true"
              className="size-3 scale-50 text-background opacity-0 transition-[opacity,transform]"
            />
          </span>
        </label>

        <span className="flex min-w-0 items-center gap-[7px]">
          <span
            title={parked ? t(($) => $.chain.parked_dot) : undefined}
            className={cn(
              "relative size-[5px] shrink-0 rounded-[1px]",
              TONE_LAMP[tone],
              tone === "running" && "animate-pulse",
            )}
          />
          <span className="whitespace-nowrap font-mono text-[11px] font-medium tracking-[0.015em] text-muted-foreground">
            {displayId}
          </span>
        </span>

        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold leading-[21px] tracking-[-0.004em] text-foreground transition-transform duration-[170ms] group-hover:translate-x-0.5">
            {displayTitle}
          </div>
          <div className="mt-[3px] flex min-w-0 items-center gap-[7px] overflow-hidden text-[11px] leading-[15px] text-muted-foreground">
              <span className="inline-flex shrink-0 items-center gap-[4px] text-[10px]">
              {squad ? (
                <Users aria-hidden="true" className="size-3 text-faint-foreground" />
              ) : (
                <UserRound aria-hidden="true" className="size-3 text-faint-foreground" />
              )}
              {squad ? t(($) => $.row.type_squad) : t(($) => $.row.type_single)}
            </span>
            <span aria-hidden="true" className="size-[3px] shrink-0 rounded-full bg-border" />
            {legStep && chain ? (
              <span className="flex min-w-0 items-center gap-[7px]">
                <span className="shrink-0 text-faint-foreground">
                  {t(($) => $.row.leg_parent)}
                </span>
                <span className="min-w-0 truncate">{issue.title}</span>
                <span className="shrink-0 font-mono text-[10px] text-faint-foreground">
                  {t(($) => $.row.leg_seq, {
                    seq: legStep.position + 1,
                    total: chain.steps.length,
                  })}
                </span>
              </span>
            ) : squad && chain && chain.steps.length > 0 ? (
              <RelayMiniStrip chain={chain} tasks={tasks} resolveName={resolveName} />
            ) : squad ? (
              <span className="shrink-0 text-faint-foreground">
                {t(($) => $.chain.none)}
              </span>
            ) : (
              <AssigneeCell issue={issue} resolveName={resolveName} />
            )}
          </div>
        </div>

        <div className="min-w-0">
          <div
            className={cn(
              "flex items-center gap-[6px] truncate text-[12px] font-semibold leading-4",
              TONE_TEXT[tone],
            )}
          >
            <span className="truncate">{word}</span>
            {tone === "running" ? (
              <span aria-hidden="true" className="flex h-2 shrink-0 items-end gap-[2px]">
                <span className="h-1 w-[2px] animate-pulse rounded-sm bg-current" />
                <span className="h-2 w-[2px] animate-pulse rounded-sm bg-current [animation-delay:120ms]" />
                <span className="h-1.5 w-[2px] animate-pulse rounded-sm bg-current [animation-delay:240ms]" />
              </span>
            ) : null}
          </div>
          <div className="mt-[2px] truncate font-mono text-[10px] leading-[13px] text-faint-foreground">
            {sub}
          </div>
        </div>

        <div className="pointer-events-auto flex items-center justify-end gap-0.5">
          <button
            type="button"
            onClick={() => onOpen(issue.id)}
            className={cn(
              "hidden h-[30px] shrink-0 items-center gap-[4px] whitespace-nowrap rounded-[4px] border px-[8px] text-[11px] font-semibold transition-colors md:inline-flex",
              tone === "review"
                ? "border-review bg-review text-brand-foreground hover:bg-review/90"
                : "border-input bg-transparent text-secondary-foreground hover:border-foreground hover:bg-foreground hover:text-background",
            )}
          >
            {action}
            <ArrowUpRight aria-hidden="true" className="size-3" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(issue)}
            aria-label={`${t(($) => $.row.delete_task)} ${issue.identifier}`}
            title={t(($) => $.row.delete_task)}
            className="grid size-[24px] place-items-center rounded-[3px] text-faint-foreground transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      </div>
    </div>
  );
});

/** Who holds a solo task: a person, one of their agents, a squad, or nobody. */
function AssigneeCell({
  issue,
  resolveName,
}: {
  issue: Issue;
  resolveName: NameResolver;
}) {
  const { t } = useT("tasks");
  if (!issue.assignee_type || !issue.assignee_id) {
    return <span>{t(($) => $.row.unassigned)}</span>;
  }
  const isAgent = issue.assignee_type === "agent";
  const isSquad = issue.assignee_type === "squad";
  const name = isAgent
    ? resolveName.agent(issue.assignee_id)
    : isSquad
      ? resolveName.squad(issue.assignee_id)
      : resolveName.member(issue.assignee_id);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <ActorAvatar
        actorType={isAgent ? "agent" : isSquad ? "squad" : "member"}
        actorId={issue.assignee_id}
        size="xs"
        profileLink={false}
      />
      <span className="max-w-[150px] truncate">{name}</span>
    </span>
  );
}

/**
 * The relay in one line: one node per leg, capped. The active leg's avatar
 * carries the state colour and the others fade; the words live in the state
 * column so the row stays a glance, not a timeline.
 */
function RelayMiniStrip({
  chain,
  tasks,
  resolveName,
}: {
  chain: IssueChainForIssue;
  tasks: readonly AgentTask[];
  resolveName: NameResolver;
}) {
  const shown = chain.steps.slice(0, STRIP_LEGS);
  const hidden = chain.steps.length - shown.length;
  return (
    <span className="hidden min-w-0 shrink-0 items-center gap-1.5 lg:flex">
      {shown.map((step, i) => {
        const run = stepRunState(chain.issue_id, step, tasks);
        const state = step.state;
        const activeRing =
          state === "doing" && run !== "queued"
            ? "ring-2 ring-inflight/60 ring-offset-1 ring-offset-background"
            : state === "reviewing"
              ? "ring-2 ring-brand/50 ring-offset-1 ring-offset-background"
              : state === "parked"
                ? "ring-2 ring-warning/60 ring-offset-1 ring-offset-background"
                : "";
        const stateWord =
          state === "done"
            ? "done"
            : state === "skipped"
              ? "skipped"
              : state === "parked"
                ? "parked"
                : state === "reviewing"
                  ? "reviewing"
                  : state === "doing" && run === "queued"
                    ? "queued"
                    : state === "doing"
                      ? "doing"
                      : "waiting";
        return (
          <span key={step.id} className="flex min-w-0 items-center gap-1.5">
            {i > 0 ? (
              <ChevronRight
                aria-hidden="true"
                className="size-3 shrink-0 text-faint-foreground"
              />
            ) : null}
            <ActorAvatar
              actorType="member"
              actorId={step.holder_user_id}
              size="xs"
              profileLink={false}
              className={cn(
                "shrink-0 transition-transform duration-[170ms] ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:-translate-y-px motion-reduce:transition-none",
                activeRing,
              )}
            />
            <span
              title={stateWord}
              className={cn(
                "max-w-[66px] truncate text-[11px] text-muted-foreground",
                stateWord === "done" && "text-faint-foreground",
                (stateWord === "doing" || stateWord === "reviewing") &&
                  "font-semibold text-foreground",
                stateWord === "parked" && "text-warning",
              )}
            >
              {resolveName.member(step.holder_user_id)}
            </span>
          </span>
        );
      })}
      {hidden > 0 ? (
            <span className="font-mono text-[10px] text-faint-foreground">+{hidden}</span>
      ) : null}
    </span>
  );
}
