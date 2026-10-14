"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Bot,
  Plus,
  TriangleAlert,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type {
  Agent,
  AgentRuntime,
  MemberWithUser,
} from "@quickwork/core/types";
import {
  type AgentActivity,
  agentRunCounts30dOptions,
  effectiveAccessScope,
  useWorkspaceActivityMap,
  useWorkspacePresenceMap,
  type AgentPresenceDetail,
} from "@quickwork/core/agents";
import {
  type AgentListFilters,
  useAgentsViewStore,
  AGENT_SCOPES,
  type AgentsScope,
} from "@quickwork/core/agents/stores";
import { useAuthStore } from "@quickwork/core/auth";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useWorkspacePaths } from "@quickwork/core/paths";
import {
  agentListOptions,
  memberListOptions,
} from "@quickwork/core/workspace/queries";
import { runtimeListOptions } from "@quickwork/core/runtimes";
import { Button } from "@quickwork/ui/components/ui/button";
import { ListGridCell } from "@quickwork/ui/components/ui/list-grid";
import { Skeleton } from "@quickwork/ui/components/ui/skeleton";
import { useNavigation } from "../../navigation";
import {
  CollectionPageHeader,
  CollectionPageHeaderAction,
  CollectionPageState,
} from "../../layout/collection-page";
import { AgentCard } from "./agent-card";
import { ALL_MACHINES, MachineRail, UNBOUND_MACHINE, machineKeyOf } from "./machine-rail";
import {
  AgentListToolbar,
  countActiveFilterDimensions,
} from "./agent-list-toolbar";
import { useT } from "../../i18n";
import { matchesPinyin } from "../../editor/extensions/pinyin-match";

// Column template — single source of truth for header, rows, and skeletons.
// Same conventions as the skills/autopilots lists (see list-grid.tsx):
// deterministic var-width tracks, two-zone responsiveness (≥@2xl WYSIWYG
// with min-width + horizontal-scroll escape valve; <@2xl static core set of
// name + status, toggles don't apply).
//
// Agents are identity-type entities (few, avatar + persona), so rows are

// Two-line rows; the virtualizer's fixed-size contract.

// Single source for hideable column widths: track vars and the grid's
// min-width derive from the same numbers.

// Fixed tracks (edges 12+12, checkbox 16, name min 200, kebab 28) plus the
// 11 gap-x-3 gaps between the wide template's 12 tracks (zero-width tracks
// still carry gaps).


export interface AgentListRow {
  agent: Agent;
  runtime: AgentRuntime | null;
  presence: AgentPresenceDetail | null;
  activity: AgentActivity | null;
  runCount: number;
  /** Days since the last bucket with runs; null = nothing in the window. */
  lastActiveDays: number | null;
  owner: MemberWithUser | null;
  isOwnedByMe: boolean;
  canManage: boolean;
}

// Most recent activity bucket with runs, as "days ago" (0 = today).
// Day-granularity by design — derived from the same 30-day buckets the
// detail page charts, no extra API.
function lastActiveDaysAgo(activity: AgentActivity | null): number | null {
  if (!activity) return null;
  for (let i = activity.buckets.length - 1; i >= 0; i--) {
    const bucket = activity.buckets[i];
    if (bucket && bucket.total > 0) return activity.buckets.length - 1 - i;
  }
  return null;
}

function matchesAgentSearch(row: AgentListRow, query: string): boolean {
  if (!query) return true;
  const { agent } = row;
  return (
    agent.name.toLowerCase().includes(query) ||
    matchesPinyin(agent.name, query) ||
    (agent.description?.toLowerCase().includes(query) ?? false) ||
    (agent.description ? matchesPinyin(agent.description, query) : false)
  );
}

/**
 * Pure row-filter predicate: returns true if the row matches all active
 * filter dimensions. Empty filter arrays are inactive (the row passes). The
 * `access` dimension derives its key via `effectiveAccessScope` so the column
 * and the filter share one derivation. Exported for testing — the page wires
 * it inside its `useMemo`.
 */
export function rowMatchesFilters(
  row: AgentListRow,
  filters: AgentListFilters,
  query: string,
): boolean {
  if (!matchesAgentSearch(row, query.trim().toLowerCase())) return false;
  if (
    filters.availability.length > 0 &&
    (!row.presence || !filters.availability.includes(row.presence.availability))
  ) {
    return false;
  }
  if (
    filters.runtimes.length > 0 &&
    !filters.runtimes.includes(row.agent.runtime_id)
  ) {
    return false;
  }
  if (
    filters.owners.length > 0 &&
    (!row.agent.owner_id || !filters.owners.includes(row.agent.owner_id))
  ) {
    return false;
  }
  if (
    filters.models.length > 0 &&
    !filters.models.includes(row.agent.model)
  ) {
    return false;
  }
  if (
    filters.access.length > 0 &&
    !filters.access.includes(
      effectiveAccessScope(
        row.agent.permission_mode,
        row.agent.invocation_targets,
      ),
    )
  ) {
    return false;
  }
  return true;
}

/**
 * Bulk-access dialog confirm-button enablement is centralized in
 * `@quickwork/core/agents` as `isAccessChangeReady` (MUL-3963). The dialog
 * consumes it; the picker also gates its internal Save button on the same
 * predicate (its own Save button is hidden via `hideFooter` in the bulk flow).
 */
import { isAccessChangeReady } from "@quickwork/core/agents";
export { isAccessChangeReady };

export interface AgentsPageProps {
  /** Desktop-only daemon wiring, currently unused by the list (kept for
   *  platform-layer compatibility; the runtime filter lists runtimes by
   *  name rather than grouped machines). */
  localDaemonId?: string | null;
  localMachineName?: string | null;
  hasLocalMachine?: boolean;
}

// ---------------------------------------------------------------------------
// Page header
// ---------------------------------------------------------------------------

function PageHeaderBar({
  totalCount,
  onCreate,
}: {
  totalCount: number;
  onCreate: () => void;
}) {
  const { t } = useT("agents");
  return (
    <CollectionPageHeader
      icon={Bot}
      title={t(($) => $.page.title)}
      count={totalCount}
      description={t(($) => $.page.tagline)}
      learnMore={{
        href: "https://quickwork.ai/docs/agents",
        label: t(($) => $.page.learn_more),
      }}
      actions={
        <CollectionPageHeaderAction
          icon={Plus}
          label={t(($) => $.page.new_agent)}
          onClick={onCreate}
        />
      }
    />
  );
}

function ListError({
  onCreate,
  listError,
  onRetry,
}: {
  onCreate: () => void;
  listError: unknown;
  onRetry: () => void;
}) {
  const { t } = useT("agents");
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <PageHeaderBar totalCount={0} onCreate={onCreate} />
      <CollectionPageState
        role="alert"
        tone="destructive"
        icon={AlertCircle}
        title={t(($) => $.page.list_load_failed)}
        description={
          listError instanceof Error
            ? listError.message
            : t(($) => $.page.list_load_failed_default)
        }
        actions={
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t(($) => $.page.try_again)}
          </Button>
        }
      />
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const { t } = useT("agents");
  return (
    <CollectionPageState
      icon={Bot}
      title={t(($) => $.empty.title)}
      description={t(($) => $.empty.description)}
      actions={
        <Button type="button" onClick={onCreate} size="sm">
          <Plus aria-hidden="true" className="size-3" />
          {t(($) => $.page.new_agent)}
        </Button>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

// Two-line identity cell: avatar left, name + description right. The
// documented exception to the single-line rule — agents are few and
// identity-rich, so this is the "team roster" form (GitHub org members,
// Slack member list).
// Availability dot + label, with the workload folded in as a suffix
// ("Online · 2 tasks") — a 0-2 integer doesn't earn its own column.
// Owner = the agent's owner_id, which is set to the creator at creation and
// never transferred (so owner ≡ creator). It carries management rights, so
// the column is "Owner", not "Created by".
// Effective access scope derived from permission_mode + invocation_targets
// (not the lossy derived `visibility`). Text label, not icon-only, so screen
// readers announce the scope.
export function AccessCell({ row }: { row: AgentListRow }) {
  const { t } = useT("agents");
  const scope = useMemo(
    () =>
      effectiveAccessScope(
        row.agent.permission_mode,
        row.agent.invocation_targets,
      ),
    [row.agent.permission_mode, row.agent.invocation_targets],
  );
  const label = t(($) =>
    scope === "workspace"
      ? $.access.scope_labels.workspace
      : scope === "specific-people"
        ? $.access.scope_labels.specific_people
        : $.access.scope_labels.owner_only,
  );
  return (
    <ListGridCell className="hidden @2xl:flex">
      <span className="min-w-0 truncate text-caption text-muted-foreground">
        {label}
      </span>
    </ListGridCell>
  );
}

// ---------------------------------------------------------------------------
// Header row + skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 px-[22px] pb-6 @container @3xl:grid-cols-2 @6xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          data-testid="skeleton"
          className="h-[124px] rounded-[var(--radius)] border bg-surface p-3.5 shadow-[var(--shadow-surface)]"
        >
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-8 shrink-0 rounded-[4px]" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-2.5 w-40" />
            </div>
          </div>
          <Skeleton className="mt-4 h-4 w-44" />
          <Skeleton className="mt-3 h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Batch toolbar — archive (with confirm; archiving cancels active tasks) and
// Page
// ---------------------------------------------------------------------------

export function AgentsPage(_props: AgentsPageProps = {}) {
  const { t } = useT("agents");
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const currentUser = useAuthStore((s) => s.user);

  const {
    data: agents = [],
    isLoading,
    error: listError,
    refetch: refetchList,
  } = useQuery(agentListOptions(wsId));
  const { data: runtimes = [] } = useQuery(
    runtimeListOptions(wsId),
  );
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: runCountsRaw = [], isPending: runCountsPending } = useQuery(
    agentRunCounts30dOptions(wsId),
  );
  const { byAgent: presenceMap, loading: presenceLoading } =
    useWorkspacePresenceMap(wsId);
  const { byAgent: activityMap, loading: activityLoading } =
    useWorkspaceActivityMap(wsId);

  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const [search, setSearch] = useState("");
  /** Machine rail selection: ALL_MACHINES, a runtime id, or UNBOUND_MACHINE. */
  const [machine, setMachine] = useState<string>(ALL_MACHINES);

  const rawScope = useAgentsViewStore((s) => s.scope);
  const scope = AGENT_SCOPES.includes(rawScope) ? rawScope : "mine";
  const setScope = useAgentsViewStore((s) => s.setScope);
  const sortField = useAgentsViewStore((s) => s.sortField);
  const sortDirection = useAgentsViewStore((s) => s.sortDirection);
  const hiddenColumns = useAgentsViewStore((s) => s.hiddenColumns);
  const filters = useAgentsViewStore((s) => s.filters);
  const handleSortFieldSelect = useAgentsViewStore((s) => s.setSortField);
  const setSortDirection = useAgentsViewStore((s) => s.setSortDirection);
  const toggleColumn = useAgentsViewStore((s) => s.toggleColumn);
  const toggleFilter = useAgentsViewStore((s) => s.toggleFilter);
  const clearFilters = useAgentsViewStore((s) => s.clearFilters);


  const runtimesById = useMemo(() => {
    const m = new Map<string, AgentRuntime>();
    for (const r of runtimes) m.set(r.id, r);
    return m;
  }, [runtimes]);

  const runCountsById = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of runCountsRaw) m.set(r.agent_id, r.run_count);
    return m;
  }, [runCountsRaw]);

  const membersById = useMemo(() => {
    const m = new Map<string, MemberWithUser>();
    for (const mem of members) m.set(mem.user_id, mem);
    return m;
  }, [members]);

  const isWorkspaceAdmin = useMemo(() => {
    if (!currentUser) return false;
    const me = members.find((m) => m.user_id === currentUser.id);
    return me?.role === "owner" || me?.role === "admin";
  }, [members, currentUser]);

  // Scope counts come from the FULL set (filters never affect them).
  // Archived ignores the ownership lens (see the view store comment).
  const scopeCounts = useMemo<Record<AgentsScope, number>>(() => {
    let mine = 0;
    let all = 0;
    let archived = 0;
    for (const a of agents) {
      if (a.archived_at) {
        archived++;
        continue;
      }
      all++;
      if (currentUser && a.owner_id === currentUser.id) mine++;
    }
    return { mine, all, archived };
  }, [agents, currentUser]);

  // Rows within the current scope, unfiltered, fully assembled — the
  // toolbar's option lists and the "n / total" denominator derive from
  // this; cells never pull their own queries.
  const scopeRows = useMemo<AgentListRow[]>(() => {
    const inScope = agents.filter((a) => {
      if (scope === "archived") return !!a.archived_at;
      if (a.archived_at) return false;
      if (scope === "mine") {
        return !!currentUser && a.owner_id === currentUser.id;
      }
      return true;
    });
    return inScope.map((agent) => {
      const isOwner = !!currentUser?.id && agent.owner_id === currentUser.id;
      const activity = activityMap.get(agent.id) ?? null;
      return {
        agent,
        runtime: runtimesById.get(agent.runtime_id) ?? null,
        presence: presenceMap.get(agent.id) ?? null,
        activity,
        runCount: runCountsById.get(agent.id) ?? 0,
        lastActiveDays: lastActiveDaysAgo(activity),
        owner: agent.owner_id ? membersById.get(agent.owner_id) ?? null : null,
        isOwnedByMe: isOwner,
        canManage: isWorkspaceAdmin || isOwner,
      };
    });
  }, [
    agents,
    scope,
    currentUser,
    runtimesById,
    membersById,
    presenceMap,
    activityMap,
    runCountsById,
    isWorkspaceAdmin,
  ]);

  // Visible rows: local search + filters, then sort.
  const rows = useMemo<AgentListRow[]>(() => {
    const filtered = scopeRows.filter((row) => rowMatchesFilters(row, filters, search));

    const dir = sortDirection === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      if (sortField === "name") {
        return a.agent.name.localeCompare(b.agent.name) * dir;
      }
      if (sortField === "runs") {
        return (a.runCount - b.runCount) * dir ||
          a.agent.name.localeCompare(b.agent.name);
      }
      if (sortField === "created") {
        return (
          (Date.parse(a.agent.created_at) - Date.parse(b.agent.created_at)) *
          dir
        );
      }
      // lastActive: smaller daysAgo = more recent. "desc" (the default)
      // means most recently active first; never-active rows sort last in
      // both directions. Run count breaks ties.
      const av = a.lastActiveDays ?? Number.POSITIVE_INFINITY;
      const bv = b.lastActiveDays ?? Number.POSITIVE_INFINITY;
      const byDays = sortDirection === "desc" ? av - bv : bv - av;
      return (
        byDays || b.runCount - a.runCount ||
        a.agent.name.localeCompare(b.agent.name)
      );
    });
    return filtered;
  }, [scopeRows, search, filters, sortField, sortDirection]);

  // The machine rail is the page's first question ("which machine holds
  // what"), so the list below it is scoped by the selected tile. Counts on the
  // tiles come from `rows` — the filtered set — so the rail always adds up to
  // what the list would show if every tile were selected.
  const visibleRows = useMemo<AgentListRow[]>(
    () =>
      machine === ALL_MACHINES
        ? rows
        : rows.filter(
            (row) => machineKeyOf(row.agent.runtime_id) === machine,
          ),
    [rows, machine],
  );

  // A selected machine with no runtime row left (removed, or never seen) is
  // treated as offline: its agents cannot run either way.
  const selectedMachineOffline = useMemo(() => {
    if (machine === ALL_MACHINES || machine === UNBOUND_MACHINE) return false;
    const runtime = runtimesById.get(machine);
    return !runtime || runtime.status !== "online";
  }, [machine, runtimesById]);

  const noMatchText = useMemo(() => {
    const query = search.trim();
    if (query) {
      if (scope === "archived") {
        return t(($) => $.no_matches.search_archived, { query });
      }
      if (countActiveFilterDimensions(filters) > 0) {
        return t(($) => $.no_matches.search_active_filtered, { query });
      }
      return t(($) => $.no_matches.search_active, { query });
    }
    if (scope === "archived") return t(($) => $.no_matches.no_archived);
    if (countActiveFilterDimensions(filters) > 0) {
      return t(($) => $.no_matches.no_filter_match);
    }
    return t(($) => $.no_matches.title);
  }, [filters, scope, search, t]);

  // Row virtualization — headless math, offsets as padding on the rows
  // wrapper, fixed-height rows. The scroll element is the SINGLE outer
  // scroller (both axes): splitting horizontal scrolling (wrapper) from
  // vertical scrolling (an inner element) connected by an h-full
  // percentage bridge caused a non-converging layout loop (flickering
  // double scrollbars) and clipped the last row under the horizontal
  // scrollbar. The sticky header pins inside this scroller; the vertical
  // scrollbar spans the full pane height (Linear's structure).
  // Straight to the manual form: a duplicate already has every field decided,
  // so the method chooser would be a step with nothing to choose.
  const duplicateHref = useCallback(
    (agent: Agent) =>
      `${paths.newAgentManual()}?duplicate=${encodeURIComponent(agent.id)}`,
    [paths],
  );

  if (listError) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <ListError
          onCreate={() => navigation.push(paths.newAgent())}
          listError={listError}
          onRetry={() => refetchList()}
        />
      </div>
    );
  }

  const totalCount = agents.filter((a) => !a.archived_at).length;
  const showEmpty = !isLoading && agents.length === 0;

  // The active sort field / availability filter reads columns that arrive in
  // separate queries from the main agent list (activity → lastActiveDays,
  // run-counts → runCount, presence → availability). Rendering real rows
  // before those land would sort on placeholder values (lastActiveDays
  // null→Infinity, runCount 0) and visibly re-order the list once each query
  // resolves. Gate the first real paint on exactly the auxiliary queries the
  // current sort / filter depends on — nothing for name/created, run-counts
  // for runs, activity + run-counts (its tiebreaker) for the default
  // lastActive, plus presence whenever an availability filter is active. The
  // queries still run in parallel, so this defers the first paint by at most
  // one extra round-trip (shown as skeleton) and never serialises them. An
  // empty workspace (showEmpty) skips the gate so the empty state is never
  // blocked on the auxiliary queries.
  const needsRunCounts = sortField === "lastActive" || sortField === "runs";
  const needsActivity = sortField === "lastActive";
  // Cards always paint live presence (lamp, counts) and the sparkline,
  // so presence is part of the gate regardless of the active filter.
  const needsPresence = true;
  const listReady =
    (!needsActivity || !activityLoading) &&
    (!needsRunCounts || !runCountsPending) &&
    (!needsPresence || !presenceLoading);

  return (
    // relative: positioning anchor for the batch toolbar (page-centered,
    // not viewport-centered).
    <div className="relative flex flex-1 min-h-0 flex-col">
      <PageHeaderBar
        totalCount={totalCount}
        onCreate={() => navigation.push(paths.newAgent())}
      />

      {isLoading || (!showEmpty && !listReady) ? (
        <div className="flex-1 overflow-y-auto @container">
          <LoadingSkeleton />
        </div>
      ) : showEmpty ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState onCreate={() => navigation.push(paths.newAgent())} />
        </div>
      ) : (
        <>
          <AgentListToolbar
            scope={scope}
            onScopeChange={setScope}
            scopeCounts={scopeCounts}
            search={search}
            onSearchChange={setSearch}
            filters={filters}
            onToggleFilter={toggleFilter}
            onClearFilters={clearFilters}
            sortField={sortField}
            sortDirection={sortDirection}
            onSortFieldChange={handleSortFieldSelect}
            onSortDirectionChange={setSortDirection}
            hiddenColumns={hiddenColumns}
            onToggleColumn={toggleColumn}
            allRows={scopeRows}
            members={members}
            visibleCount={visibleRows.length}
          />
          <MachineRail
            rows={rows}
            runtimes={runtimes}
            selected={machine}
            onSelect={setMachine}
          />
          {selectedMachineOffline && (
            <div className="mx-[22px] mb-2 flex shrink-0 items-center gap-2 rounded-[var(--radius)] border border-warning/40 bg-warning/10 px-3 py-2 text-caption">
              <TriangleAlert
                aria-hidden="true"
                className="size-3.5 shrink-0 text-warning"
              />
              <span className="min-w-0 text-foreground">{t(($) => $.rail.offline_band)}</span>
            </div>
          )}
          <div
            ref={listScrollRef}
            className="@container min-h-0 flex-1 overflow-auto"
          >
            {visibleRows.length === 0 ? (
              <div className="py-16 text-center text-body text-muted-foreground">
                {machine === ALL_MACHINES
                  ? noMatchText
                  : t(($) => $.rail.none_here)}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 px-[22px] pb-6 @3xl:grid-cols-2 @6xl:grid-cols-3">
                {visibleRows.map((row) => (
                  <AgentCard
                    key={row.agent.id}
                    row={row}
                    onOpen={() => navigation.push(paths.agentDetail(row.agent.id))}
                    duplicateHref={duplicateHref(row.agent)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}


    </div>
  );
}
