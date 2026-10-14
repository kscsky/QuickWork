"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ListTodo } from "lucide-react";
import { useAuthStore } from "@quickwork/core/auth";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useWorkspacePaths } from "@quickwork/core/paths";
import { issueChainsOptions, issueListOptions } from "@quickwork/core/issues/queries";
import { agentTaskSnapshotOptions } from "@quickwork/core/agents/queries";
import { useActorName } from "@quickwork/core/workspace/hooks";
import type { AgentTask, Issue, IssueChainForIssue, IssueChainStep } from "@quickwork/core/types";
import { cn } from "@quickwork/ui/lib/utils";

import { stepRunState } from "../issues/components/chain-run-state";
import { CollectionPageState } from "../layout/collection-page";
import { PageHeader } from "../layout/page-header";
import { useT } from "../i18n";
import { useNavigation } from "../navigation";

/**
 * The task feed: every task, with its relay laid out as a row.
 *
 * Progress on this page is "which step, in whose hands" — never a percentage.
 * A chain with a parked step has no honest percentage, so the row says where
 * it stopped and who it is waiting on instead. Rows whose chain has reached
 * someone with no agent are the loudest thing on the page, because that is the
 * one state someone has to act on.
 */

/** How many tasks the feed draws. Chains are fetched for exactly this page,
 *  so the cap is also the bound on the bulk request. */
const FEED_LIMIT = 60;

type FilterKey = "all" | "mine" | "parked";

const FILTERS: FilterKey[] = ["all", "mine", "parked"];

/** The step whose turn it currently is: the parked one first (it is the story
 *  the page exists for), then the running one, then wherever the chain would
 *  start next. */
function currentStep(chain: IssueChainForIssue): IssueChainStep | undefined {
  return (
    chain.steps.find((s) => s.state === "parked") ??
    chain.steps.find((s) => s.state === "doing") ??
    chain.steps.find((s) => s.state === "pending")
  );
}

function lastTouched(issue: Issue): string {
  return issue.last_activity_at ?? issue.updated_at;
}

export function TaskListPage() {
  const { t } = useT("tasks");
  const wsId = useWorkspaceId();
  const navigation = useNavigation();
  const wsPaths = useWorkspacePaths();
  const user = useAuthStore((s) => s.user);
  const { getMemberName, getAgentName, getSquadName } = useActorName();
  const [filter, setFilter] = useState<FilterKey>("all");

  const { data: issues = [], isPending } = useQuery(issueListOptions(wsId));

  // Newest activity first; the page cap is applied before the chain fetch so
  // the bulk request carries exactly the ids on screen.
  const feedIssues = useMemo(
    () =>
      [...issues]
        .sort(
          (a, b) =>
            new Date(lastTouched(b)).getTime() - new Date(lastTouched(a)).getTime(),
        )
        .slice(0, FEED_LIMIT),
    [issues],
  );

  const feedIds = useMemo(() => feedIssues.map((i) => i.id), [feedIssues]);
  const { data: chains = [], isPending: chainsPending } = useQuery(
    issueChainsOptions(feedIds),
  );
  // Run states for the relays on screen: a step marked `doing` that no
  // environment has claimed yet is waiting on its holder, not running.
  const { data: tasks = [] } = useQuery(agentTaskSnapshotOptions(wsId));

  // One row open at a time: the list is a browse surface, and two open
  // timelines turn it back into the wall of detail this design removed.
  const [openId, setOpenId] = useState<string | null>(null);
  const chainByIssue = useMemo(
    () => new Map(chains.map((c) => [c.issue_id, c])),
    [chains],
  );

  const detail = (issue: Issue) => wsPaths.issueDetail(issue.id);

  const isMine = (issue: Issue, chain: IssueChainForIssue | undefined) => {
    if (chain) {
      const step = currentStep(chain);
      return !!user && step?.holder_user_id === user.id;
    }
    return (
      !!user &&
      issue.assignee_type === "member" &&
      issue.assignee_id === user.id
    );
  };

  const counts = useMemo(() => {
    let mine = 0;
    let parked = 0;
    for (const issue of feedIssues) {
      const chain = chainByIssue.get(issue.id);
      if (chain?.parked) parked++;
      if (isMine(issue, chain)) mine++;
    }
    return { all: feedIssues.length, mine, parked };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedIssues, chainByIssue, user?.id]);

  const visible = useMemo(() => {
    if (filter === "all") return feedIssues;
    if (filter === "parked")
      return feedIssues.filter((i) => chainByIssue.get(i.id)?.parked);
    return feedIssues.filter((i) => isMine(i, chainByIssue.get(i.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedIssues, chainByIssue, filter, user?.id]);

  const filterLabel = (key: FilterKey) =>
    t(($) => $.filter[key], { count: counts[key] });

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <PageHeader>
        <ListTodo aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
        <h1 className="text-body font-medium">{t(($) => $.title)}</h1>
        <div className="ml-auto flex items-center gap-1" role="group">
          {FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              data-active={filter === key ? "" : undefined}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={cn(
                "rounded-md px-2.5 py-1 text-caption tabular-nums transition-colors",
                filter === key
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:not-data-active:bg-muted/60",
              )}
            >
              {filterLabel(key)}
            </button>
          ))}
        </div>
      </PageHeader>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {isPending ? null : feedIssues.length === 0 ? (
          <CollectionPageState
            icon={ListTodo}
            title={t(($) => $.empty.title)}
            description={t(($) => $.empty.body)}
          />
        ) : visible.length === 0 ? (
          <CollectionPageState
            icon={ListTodo}
            title={t(($) => $.empty.filtered_title)}
            description={t(($) => $.empty.filtered_body)}
          />
        ) : (
          <div className="flex w-full flex-col gap-3 px-[22px] py-6">
            {visible.map((issue) => (
              <TaskRow
                key={issue.id}
                issue={issue}
                chain={chainByIssue.get(issue.id)}
                chainsPending={chainsPending}
                tasks={tasks}
                resolveName={{
                  member: getMemberName,
                  agent: getAgentName,
                  squad: getSquadName,
                }}
                open={openId === issue.id}
                onToggle={() =>
                  setOpenId((cur) => (cur === issue.id ? null : issue.id))
                }
                onOpen={() => navigation.push(detail(issue))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type NameResolver = {
  member: (id: string) => string;
  agent: (id: string) => string;
  squad: (id: string) => string;
};

/**
 * One task, folded.
 *
 * Collapsed it answers only "what is this and who is it for" — the timeline is
 * the detail you ask for, not the page you land on. The exception is the parked
 * dot: a stuck task has to be visible without opening anything, or the list
 * stops being scannable for the one thing worth scanning for.
 */
function TaskRow({
  issue,
  chain,
  chainsPending,
  tasks,
  resolveName,
  open,
  onToggle,
  onOpen,
}: {
  issue: Issue;
  chain: IssueChainForIssue | undefined;
  chainsPending: boolean;
  tasks: readonly AgentTask[];
  resolveName: NameResolver;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const { t } = useT("tasks");
  const parked = chain?.parked === true;
  const squad =
    issue.assignee_type === "squad" && issue.assignee_id
      ? resolveName.squad(issue.assignee_id)
      : "";

  return (
    <div
      className={cn(
        "group relative rounded-xl border bg-surface shadow-sm",
        "transition-[box-shadow,border-color] duration-200",
        "hover:border-input hover:shadow-md",
        open && "border-input shadow-md",
        parked ? "border-warning/40" : "border-surface-border",
      )}
    >
      {/* Height is animated rather than the colour, so the rail grows into the
          row instead of appearing on it. */}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-[3px]",
          "transition-[height] duration-200 ease-out",
          parked
            ? "h-[46%] bg-warning group-hover:h-[60%]"
            : cn("h-0 bg-brand group-hover:h-[46%]", open && "h-[60%]"),
        )}
      />
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-xl px-[18px] py-[15px] text-left"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-faint-foreground transition-transform duration-[240ms]",
            open && "rotate-90",
          )}
        />
        <span className="shrink-0 font-mono text-micro font-medium text-brand">
          {issue.identifier}
        </span>
        <span className="min-w-0 flex-1 truncate text-label font-medium transition-transform duration-200 group-hover:translate-x-0.5">
          {issue.title}
        </span>
        {parked ? (
          <span
            title={t(($) => $.chain.parked_dot)}
            className="size-[7px] shrink-0 animate-pulse rounded-full bg-warning [animation-duration:2.4s]"
          />
        ) : null}
        <span className="flex shrink-0 items-center gap-1.5 text-caption text-muted-foreground">
          {squad ? (
            <>
              <span className="grid size-[18px] place-items-center rounded-[5px] bg-gradient-to-br from-zone-1 to-zone-8 text-micro font-bold text-white">
                {squad.slice(0, 1)}
              </span>
              {squad}
            </>
          ) : (
            t(($) => $.row.unassigned)
          )}
        </span>
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        {/* Kept mounted so the fold can animate, but inert while closed —
            otherwise the buttons inside stay tabbable and screen-readable. */}
        <div className="overflow-hidden" inert={!open}>
        <div className="pb-3.5 pl-[54px] pr-5">
          {chainsPending && !chain ? (
            <span className="block h-10 w-full animate-pulse rounded bg-muted" />
          ) : chain && chain.steps.length > 0 ? (
            <ChainTimeline chain={chain} tasks={tasks} resolveName={resolveName} />
          ) : (
            <p className="text-caption text-muted-foreground">
              {t(($) => $.chain.none)}
            </p>
          )}
          <div className="mt-2.5 flex items-center border-t border-dashed pt-2.5 text-micro">
            <span className="flex-1" />
            <button type="button" onClick={onOpen} className="text-brand">
              {t(($) => $.chain.open_task)}
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

/**
 * What happened, in order, with the times.
 *
 * The collapsed row answers "whose turn is it"; this answers "how long has it
 * been their turn" — which is the question you open a task to ask.
 */
function ChainTimeline({
  chain,
  tasks,
  resolveName,
}: {
  chain: IssueChainForIssue;
  tasks: readonly AgentTask[];
  resolveName: NameResolver;
}) {
  const { t } = useT("tasks");
  return (
    <div>
      {chain.steps.map((step, i) => {
        const name = resolveName.member(step.holder_user_id);
        const isLast = i === chain.steps.length - 1;
        // A `doing` step is two different situations: theirs to pick up, or
        // already running on their machine. The same distinction the collapsed
        // row once made, kept here so the two cannot disagree.
        const run = stepRunState(chain.issue_id, step, tasks);
        const tone =
          step.state === "parked"
            ? "park"
            : step.state === "doing"
              ? "now"
              : step.state === "done" || step.state === "skipped"
                ? "done"
                : "wait";
        const text =
          step.state === "parked"
            ? t(($) => $.chain.parked_at, { name })
            : step.state === "done"
              ? t(($) => $.chain.delivered, { name })
              : step.state === "skipped"
                ? t(($) => $.chain.skipped_at, { name })
                : run === "running"
                  ? t(($) => $.chain.running, { name })
                  : run === "queued"
                    ? t(($) => $.chain.awaiting_pickup, { name })
                    : t(($) => $.chain.waiting, { name });
        const at =
          step.state === "done" || step.state === "skipped"
            ? step.completed_at
            : step.started_at;

        return (
          <div key={step.id} className="grid grid-cols-[15px_1fr_auto] gap-2.5">
            <span className="flex flex-col items-center">
              <span
                className={cn(
                  "mt-1 size-[7px] shrink-0 rounded-full",
                  tone === "park" && "bg-warning",
                  tone === "now" && "bg-inflight",
                  tone === "done" && "bg-success",
                  tone === "wait" && "bg-border",
                )}
              />
              {!isLast ? <span className="mt-1 w-px flex-1 bg-border" /> : null}
            </span>
            <span className="min-w-0 py-0.5">
              <span
                className={cn(
                  "block truncate text-caption",
                  tone === "park" && "font-medium text-warning",
                  tone === "now" && "text-inflight",
                )}
              >
                {text}
              </span>
              {step.title ? (
                <span className="block truncate text-micro text-faint-foreground">
                  {step.title}
                </span>
              ) : null}
            </span>
            {at ? (
              <span className="shrink-0 pt-0.5 text-micro tabular-nums text-faint-foreground">
                {formatClock(at)}
              </span>
            ) : null}
          </div>
        );
      })}

    </div>
  );
}

/** "18:03" — the clock time of one handoff. */
function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
