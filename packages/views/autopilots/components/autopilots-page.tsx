"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  Bug,
  ChevronDown,
  Clock,
  Code,
  FileSearch,
  Filter,
  GitPullRequest,
  Newspaper,
  Plus,
  Shield,
  Webhook,
  X,
  Zap,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { autopilotListOptions } from "@quickwork/core/autopilots/queries";
import {
  useAutopilotsViewStore,
  AUTOPILOT_SCOPES,
  type AutopilotListFilters,
  type AutopilotScope,
} from "@quickwork/core/autopilots/stores";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useWorkspacePaths } from "@quickwork/core/paths";
import { useActorName } from "@quickwork/core/workspace/hooks";
import type { Autopilot } from "@quickwork/core/types";
import { cn } from "@quickwork/ui/lib/utils";
import { Button } from "@quickwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@quickwork/ui/components/ui/dropdown-menu";
import { Skeleton } from "@quickwork/ui/components/ui/skeleton";
import { useRowLink } from "../../navigation";
import { ActorAvatar } from "../../common/actor-avatar";
import { FILTER_ITEM_CLASS, HoverCheck } from "../../common/hover-check";
import {
  CollectionPageHeader,
  CollectionPageHeaderAction,
  CollectionPageState,
} from "../../layout/collection-page";
import { AutopilotDialog } from "./autopilot-dialog";
import { AutopilotRowActions } from "./autopilot-list-actions";
import { parseCron } from "./schedule-editor/cron-mapping";
import { describeSchedule } from "./schedule-editor/describe";
import type { ScheduleConfig } from "./schedule-editor/model";
import { useT } from "../../i18n";

// Composite "type:id" value for polymorphic actor filter dimensions, so the
// string[] filter store can hold agent/squad/member references alike.
function actorFilterValue(type: string, id: string): string {
  return `${type}:${id}`;
}

const TRIGGER_KINDS = ["schedule", "webhook", "api"] as const;

const TRIGGER_ICONS: Record<string, typeof Zap> = {
  schedule: Clock,
  webhook: Webhook,
  api: Code,
};

// Board rows: the schedule is the spine, so active rows read as a departure
// board ordered by their next run; paused rows sit below it.
const ROW_GRID =
  "md:grid-cols-[10.5rem_minmax(0,1fr)_15rem_11rem] md:items-center";

// ---------------------------------------------------------------------------
// Templates for the empty state. Prompts stay raw English because they're
// injected directly into the agent's task input.
// ---------------------------------------------------------------------------

type TemplateId =
  | "daily_news"
  | "pr_review"
  | "bug_triage"
  | "weekly_progress"
  | "dependency_audit"
  | "documentation_check";

interface AutopilotTemplate {
  id: TemplateId;
  prompt: string;
  icon: typeof Zap;
  schedule: Pick<ScheduleConfig, "time" | "days">;
}

const WEEKDAYS: ScheduleConfig["days"] = { kind: "weekly", daysOfWeek: [1, 2, 3, 4, 5] };
const MONDAY: ScheduleConfig["days"] = { kind: "weekly", daysOfWeek: [1] };

const TEMPLATES: AutopilotTemplate[] = [
  {
    id: "daily_news",
    prompt: `1. Search the web for news and announcements published today only (strictly today's date)
2. Filter for topics relevant to our team and industry
3. For each item, write a short summary including: title, source, key takeaways
4. Compile everything into a single digest post
5. Post the digest as a comment on this issue and @mention all workspace members`,
    icon: Newspaper,
    schedule: { time: { kind: "at", time: "09:00" }, days: { kind: "every" } },
  },
  {
    id: "pr_review",
    prompt: `1. List all open pull requests in the repository
2. Identify PRs that have been open for more than 24 hours without a review
3. For each stale PR, note the author, age, and a one-line summary of the change
4. Post a comment on this issue listing all stale PRs with links
5. @mention the team to remind them to review`,
    icon: GitPullRequest,
    schedule: { time: { kind: "at", time: "10:00" }, days: WEEKDAYS },
  },
  {
    id: "bug_triage",
    prompt: `1. List all backlog issues that have not been prioritized
2. For each issue, read the description and any attached logs or screenshots
3. Assess severity (critical / high / medium / low) based on user impact and scope
4. Set the priority field on the issue accordingly
5. Add a comment explaining your assessment and suggested next steps`,
    icon: Bug,
    schedule: { time: { kind: "at", time: "09:00" }, days: WEEKDAYS },
  },
  {
    id: "weekly_progress",
    prompt: `1. Gather all issues completed (status "done") in the past 7 days
2. Gather all issues currently in progress
3. Identify any blocked issues and their blockers
4. Calculate key metrics: issues closed, issues opened, net change
5. Write a structured weekly report with sections: Completed, In Progress, Blocked, Metrics
6. Post the report as a comment on this issue`,
    icon: BarChart3,
    schedule: { time: { kind: "at", time: "17:00" }, days: MONDAY },
  },
  {
    id: "dependency_audit",
    prompt: `1. Run dependency audit tools on the project (npm audit, go vuln check, etc.)
2. Identify any packages with known security vulnerabilities
3. List outdated packages that are more than 2 major versions behind
4. For each finding, note the severity, affected package, and recommended fix
5. Post a summary report as a comment with actionable items`,
    icon: Shield,
    schedule: { time: { kind: "at", time: "08:00" }, days: MONDAY },
  },
  {
    id: "documentation_check",
    prompt: `1. List all code changes merged in the past 7 days (via git log)
2. For each significant change, check if related documentation was updated
3. Identify any new APIs, config options, or features missing documentation
4. Create a list of documentation gaps with file paths and suggested content
5. Post the findings as a comment on this issue`,
    icon: FileSearch,
    schedule: { time: { kind: "at", time: "14:00" }, days: MONDAY },
  },
];

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** "明天 09:00" / "周四 10:00" / "10月24日 09:00" in the viewer's locale. The
 *  scheduler stores UTC instants; the board reads them in the viewer's zone. */
function formatNextRun(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const now = new Date();
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  if (days >= 0 && days <= 2) {
    return `${new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(days, "day")} ${time}`;
  }
  if (days > 2 && days < 7) {
    return `${new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date)} ${time}`;
  }
  return `${new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(date)} ${time}`;
}

function runDotClass(status: string | null): string {
  switch (status) {
    case "completed":
    case "issue_created":
      return "bg-success/70";
    case "failed":
      return "bg-destructive/60";
    case "skipped":
      return "bg-warning/70";
    case "running":
      return "bg-inflight animate-pulse";
    default:
      return "bg-muted-foreground/20";
  }
}

// ---------------------------------------------------------------------------
// Board row
// ---------------------------------------------------------------------------

function BoardRow({ row }: { row: Autopilot }) {
  const { t, i18n } = useT("autopilots");
  const { getActorName } = useActorName();
  const rowLink = useRowLink();
  const wsPaths = useWorkspacePaths();

  const running = row.status === "active" && row.last_run_status === "running";
  const paused = row.status === "paused";
  const pausedRuntime = paused && row.pause_reason === "agent_runtime_required";
  const nextLabel = row.next_run_at
    ? formatNextRun(row.next_run_at, i18n.language)
    : null;

  // Cadence is derived from the enabled schedule trigger the server attached
  // to the row. The board's "next" cell already carries the clock time, so it
  // is stripped here; a malformed or advanced expression degrades to the raw
  // cron rather than inventing a cadence.
  const cadence = useMemo(() => {
    if (!row.schedule_cron) return null;
    try {
      const config = parseCron(row.schedule_cron, row.schedule_timezone ?? "UTC");
      const described = describeSchedule(t, config);
      if (described === null) {
        return { label: row.schedule_cron, title: row.schedule_cron };
      }
      let label = described;
      if (config.raw === null && config.time.kind === "at") {
        label = label.replace(/^\d{1,2}:\d{2} · /, "");
      } else if (config.raw === null) {
        const everyDay = t(($) => $.schedule_editor.describe.days_every);
        const suffix = ` · ${everyDay}`;
        if (label.endsWith(suffix)) label = label.slice(0, -suffix.length);
      }
      const title = row.schedule_timezone
        ? `${described} · ${row.schedule_timezone}`
        : described;
      return {
        // The zone matters for a fixed time ("09:00 · Asia/Shanghai"); for an
        // interval it is already implied by the trigger and eats the column.
        label:
          row.schedule_timezone && config.time.kind === "at"
            ? `${label} · ${row.schedule_timezone}`
            : label,
        title,
      };
    } catch {
      return { label: row.schedule_cron, title: row.schedule_cron };
    }
  }, [row.schedule_cron, row.schedule_timezone, t]);

  const triggerKinds = (row.trigger_kinds ?? []).filter((kind) =>
    TRIGGER_KINDS.includes(kind as (typeof TRIGGER_KINDS)[number]),
  );
  const eventDrivenHeadline = triggerKinds.includes("webhook")
    ? t(($) => $.trigger_kind.webhook)
    : triggerKinds.includes("api")
      ? t(($) => $.trigger_kind.api)
      : null;

  const statuses = [...(row.recent_run_statuses ?? [])]
    .slice(0, 7)
    .reverse();
  const slots = Array.from(
    { length: 7 },
    (_, i) => statuses[i - (7 - statuses.length)] ?? null,
  );

  // Server-driven enums: known values localize, unknown values render raw.
  const runStatusLabel = (status: string) => {
    switch (status) {
      case "issue_created":
      case "running":
      case "completed":
      case "failed":
      case "skipped":
        return t(($) => $.run_status[status]);
      default:
        return status;
    }
  };
  const modeLabel =
    row.execution_mode === "run_only" || row.execution_mode === "create_issue"
      ? t(($) => $.execution_mode[row.execution_mode])
      : row.execution_mode;

  const statusLine = (() => {
    if (paused) {
      return pausedRuntime
        ? `${t(($) => $.status.paused)} · ${t(($) => $.page.paused_runtime_short)}`
        : t(($) => $.status.paused);
    }
    if (cadence !== null) return cadence.label;
    if (eventDrivenHeadline !== null) return t(($) => $.page.event_driven);
    return t(($) => $.page.manual);
  })();

  const headline = running
    ? t(($) => $.run_status.running)
    : paused && !nextLabel
      ? t(($) => $.status.paused)
      : nextLabel ?? eventDrivenHeadline ?? t(($) => $.page.manual);

  return (
    <div
      {...rowLink(wsPaths.autopilotDetail(row.id), row.title)}
      className={cn(
        "group/row grid cursor-pointer gap-2 border-t border-dashed border-border px-4 py-3.5 transition-colors first:border-t-0 hover:bg-surface-hover/60",
        ROW_GRID,
      )}
    >
      <div className="min-w-0">
        <div
          className={cn(
            "truncate text-title-sm font-semibold tracking-tight tabular-nums",
            running && "text-inflight",
            paused && !running && "text-faint-foreground",
          )}
        >
          {headline}
        </div>
        <div
          className={cn(
            "mt-0.5 truncate text-caption",
            pausedRuntime ? "text-warning" : "text-muted-foreground",
          )}
          title={cadence?.title ?? statusLine}
        >
          {statusLine}
        </div>
      </div>

      <div className="min-w-0">
        <div className="truncate text-body font-medium">{row.title}</div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
          {triggerKinds.map((kind) => {
            const Icon = TRIGGER_ICONS[kind] ?? Zap;
            const label =
              kind === "schedule" || kind === "webhook" || kind === "api"
                ? t(($) => $.trigger_kind[kind])
                : kind;
            return (
              <span
                key={kind}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-micro font-medium",
                  kind === "schedule"
                    ? "bg-brand/10 text-brand"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <Icon className="size-3" />
                {label}
              </span>
            );
          })}
          {row.description && (
            <span className="truncate">{row.description}</span>
          )}
        </div>
      </div>

      <div className="hidden min-w-0 items-center gap-2 md:flex">
        <ActorAvatar
          actorType={row.assignee_type}
          actorId={row.assignee_id}
          size="sm"
          showStatusDot={row.assignee_type === "agent"}
        />
        <span className="min-w-0 truncate text-caption text-muted-foreground">
          {getActorName(row.assignee_type, row.assignee_id)}
        </span>
        <span className="ml-auto shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-micro font-medium text-muted-foreground">
          {modeLabel}
        </span>
      </div>

      <div className="flex min-w-0 items-center gap-2 md:justify-end">
        {pausedRuntime ? (
          <span
            title={t(($) => $.page.last_skipped_agent_offline)}
            className="min-w-0 truncate text-micro font-medium text-warning"
          >
            {t(($) => $.page.last_skipped)}
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1">
            {slots.map((status, i) => (
              <span
                key={i}
                title={status ? runStatusLabel(status) : undefined}
                className={cn("size-[7px] rounded-[2px]", runDotClass(status))}
              />
            ))}
          </span>
        )}
        <span
          aria-hidden="true"
          className={cn(
            "size-[7px] shrink-0 rounded-full",
            running
              ? "animate-pulse bg-inflight"
              : paused
                ? "bg-warning"
                : "bg-success",
          )}
        />
        <AutopilotRowActions row={row} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar: scope + trigger pills, and the deeper filter menu
// ---------------------------------------------------------------------------

function BoardToolbar({
  scope,
  onScopeChange,
  scopeCounts,
  filters,
  onToggleFilter,
  onClearFilters,
  allRows,
}: {
  scope: AutopilotScope;
  onScopeChange: (scope: AutopilotScope) => void;
  scopeCounts: Record<AutopilotScope, number>;
  filters: AutopilotListFilters;
  onToggleFilter: (key: keyof AutopilotListFilters, value: string) => void;
  onClearFilters: () => void;
  allRows: Autopilot[];
}) {
  const { t } = useT("autopilots");
  const { getActorName } = useActorName();

  const assigneeOptions = new Map<
    string,
    { type: string; id: string; count: number }
  >();
  const creatorOptions = new Map<
    string,
    { type: string; id: string; count: number }
  >();
  const modeCounts = new Map<string, number>();
  const triggerKindCounts = new Map<string, number>();
  for (const row of allRows) {
    const aKey = actorFilterValue(row.assignee_type, row.assignee_id);
    const a = assigneeOptions.get(aKey);
    if (a) a.count += 1;
    else
      assigneeOptions.set(aKey, {
        type: row.assignee_type,
        id: row.assignee_id,
        count: 1,
      });
    const cKey = actorFilterValue(row.created_by_type, row.created_by_id);
    const c = creatorOptions.get(cKey);
    if (c) c.count += 1;
    else
      creatorOptions.set(cKey, {
        type: row.created_by_type,
        id: row.created_by_id,
        count: 1,
      });
    modeCounts.set(
      row.execution_mode,
      (modeCounts.get(row.execution_mode) ?? 0) + 1,
    );
    for (const kind of row.trigger_kinds ?? []) {
      triggerKindCounts.set(kind, (triggerKindCounts.get(kind) ?? 0) + 1);
    }
  }

  const hasActiveFilters =
    filters.assignees.length > 0 ||
    filters.modes.length > 0 ||
    filters.triggerKinds.length > 0 ||
    filters.creators.length > 0;

  const SCOPE_LABELS: Record<AutopilotScope, string> = {
    all: t(($) => $.page.scope_all),
    active: t(($) => $.status.active),
    paused: t(($) => $.status.paused),
  };

  const countBadge = (n: number) => (
    <span className="ml-auto pl-3 font-mono text-micro text-muted-foreground">
      {n}
    </span>
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {AUTOPILOT_SCOPES.map((s) => {
        const on = scope === s;
        return (
          <button
            key={s}
            type="button"
            aria-pressed={on}
            onClick={() => onScopeChange(s)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-caption transition-colors",
              on
                ? "border-primary bg-primary font-medium text-primary-foreground"
                : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {SCOPE_LABELS[s]}
            <span
              className={cn(
                "font-mono text-micro tabular-nums",
                on ? "text-primary-foreground/70" : "text-faint-foreground",
              )}
            >
              {scopeCounts[s]}
            </span>
          </button>
        );
      })}

      <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

      {TRIGGER_KINDS.filter((kind) => triggerKindCounts.has(kind)).map(
        (kind) => {
          const on = filters.triggerKinds.includes(kind);
          const Icon = TRIGGER_ICONS[kind] ?? Zap;
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={on}
              onClick={() => onToggleFilter("triggerKinds", kind)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-caption transition-colors",
                on
                  ? "border-brand bg-brand/10 font-medium text-brand"
                  : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-3" />
              {t(($) => $.trigger_kind[kind])}
              <span className="font-mono text-micro tabular-nums text-faint-foreground">
                {triggerKindCounts.get(kind) ?? 0}
              </span>
            </button>
          );
        },
      )}

      <div className="ml-auto flex items-center gap-1.5">
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-caption text-muted-foreground"
            onClick={onClearFilters}
          >
            <X className="size-3" />
            {t(($) => $.toolbar.clear_filters)}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "gap-1.5",
                  hasActiveFilters && "border-brand/40 text-brand",
                )}
              >
                <Filter className="size-3.5" />
                {t(($) => $.toolbar.filter_label)}
                <ChevronDown className="size-3 text-muted-foreground" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-auto">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span className="flex-1">{t(($) => $.toolbar.section_assignee)}</span>
                {filters.assignees.length > 0 && (
                  <span className="text-caption font-medium text-primary">
                    {filters.assignees.length}
                  </span>
                )}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 w-auto min-w-48 overflow-y-auto">
                {[...assigneeOptions.entries()].map(([value, { type, id, count }]) => (
                  <DropdownMenuCheckboxItem
                    key={value}
                    checked={filters.assignees.includes(value)}
                    onCheckedChange={() => onToggleFilter("assignees", value)}
                    className={FILTER_ITEM_CLASS}
                  >
                    <HoverCheck checked={filters.assignees.includes(value)} />
                    <ActorAvatar actorType={type} actorId={id} size="sm" />
                    <span className="min-w-0 truncate">{getActorName(type, id)}</span>
                    {countBadge(count)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span className="flex-1">{t(($) => $.toolbar.section_mode)}</span>
                {filters.modes.length > 0 && (
                  <span className="text-caption font-medium text-primary">
                    {filters.modes.length}
                  </span>
                )}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-auto min-w-44">
                {(["create_issue", "run_only"] as const).map((mode) => (
                  <DropdownMenuCheckboxItem
                    key={mode}
                    checked={filters.modes.includes(mode)}
                    onCheckedChange={() => onToggleFilter("modes", mode)}
                    className={FILTER_ITEM_CLASS}
                  >
                    <HoverCheck checked={filters.modes.includes(mode)} />
                    {t(($) => $.execution_mode[mode])}
                    {countBadge(modeCounts.get(mode) ?? 0)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span className="flex-1">{t(($) => $.toolbar.section_creator)}</span>
                {filters.creators.length > 0 && (
                  <span className="text-caption font-medium text-primary">
                    {filters.creators.length}
                  </span>
                )}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 w-auto min-w-48 overflow-y-auto">
                {[...creatorOptions.entries()].map(([value, { type, id, count }]) => (
                  <DropdownMenuCheckboxItem
                    key={value}
                    checked={filters.creators.includes(value)}
                    onCheckedChange={() => onToggleFilter("creators", value)}
                    className={FILTER_ITEM_CLASS}
                  >
                    <HoverCheck checked={filters.creators.includes(value)} />
                    <ActorAvatar actorType={type} actorId={id} size="sm" />
                    <span className="min-w-0 truncate">{getActorName(type, id)}</span>
                    {countBadge(count)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function BoardSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto px-4 pb-10 pt-1">
      <div className="mx-auto w-full max-w-[1180px]">
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-20 rounded-full" />
          <Skeleton className="h-7 w-20 rounded-full" />
          <Skeleton className="h-7 w-20 rounded-full" />
        </div>
        <div className="mt-3 overflow-hidden rounded-xl border border-surface-border bg-surface-raised">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "grid gap-3 px-4 py-4 md:grid-cols-[9.5rem_minmax(0,1fr)_13rem_11rem] md:items-center",
                i > 0 && "border-t border-dashed border-border",
              )}
            >
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-64 max-w-full" />
              </div>
              <div className="hidden items-center gap-2 md:flex">
                <Skeleton className="size-5 rounded-full" />
                <Skeleton className="h-3 w-20" />
              </div>
              <div className="flex items-center gap-1.5 md:justify-end">
                {Array.from({ length: 7 }).map((_, dot) => (
                  <Skeleton key={dot} className="size-[7px] rounded-[2px]" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AutopilotsPage() {
  const { t } = useT("autopilots");
  const wsId = useWorkspaceId();
  const {
    data: autopilots = [],
    isLoading,
    error: listError,
    refetch: refetchList,
  } = useQuery(autopilotListOptions(wsId));

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] =
    useState<AutopilotTemplate | null>(null);
  const templateGridRef = useRef<HTMLDivElement | null>(null);

  // Persisted scope may hold a retired value (e.g. "archived" from an older
  // build) — fall back to "all" instead of stranding the user on an
  // unreachable scope.
  const rawScope = useAutopilotsViewStore((s) => s.scope);
  const scope = AUTOPILOT_SCOPES.includes(rawScope) ? rawScope : "all";
  const setScope = useAutopilotsViewStore((s) => s.setScope);
  const filters = useAutopilotsViewStore((s) => s.filters);
  const toggleFilter = useAutopilotsViewStore((s) => s.toggleFilter);
  const clearFilters = useAutopilotsViewStore((s) => s.clearFilters);

  // Scope counts come from the FULL set (filters never affect them — they
  // are stage inventories, not result counts). API-archived rows (no UI
  // flow creates them) are excluded everywhere.
  const scopeCounts = useMemo<Record<AutopilotScope, number>>(() => {
    let active = 0;
    let paused = 0;
    for (const a of autopilots) {
      if (a.status === "archived") continue;
      if (a.status === "paused") paused++;
      else active++;
    }
    return { all: active + paused, active, paused };
  }, [autopilots]);

  // Rows within the current scope, unfiltered — filter option lists derive
  // from this set.
  const scopeRows = useMemo<Autopilot[]>(() => {
    if (scope === "all") {
      return autopilots.filter((a) => a.status !== "archived");
    }
    return autopilots.filter((a) => a.status === scope);
  }, [autopilots, scope]);

  // Visible rows: filters, then departure order — active jobs by next run,
  // paused jobs below them.
  const rows = useMemo<Autopilot[]>(() => {
    const filtered = scopeRows.filter((a) => {
      if (
        filters.assignees.length > 0 &&
        !filters.assignees.includes(
          actorFilterValue(a.assignee_type, a.assignee_id),
        )
      ) {
        return false;
      }
      if (filters.modes.length > 0 && !filters.modes.includes(a.execution_mode)) {
        return false;
      }
      if (
        filters.triggerKinds.length > 0 &&
        !(a.trigger_kinds ?? []).some((k) => filters.triggerKinds.includes(k))
      ) {
        return false;
      }
      if (
        filters.creators.length > 0 &&
        !filters.creators.includes(
          actorFilterValue(a.created_by_type, a.created_by_id),
        )
      ) {
        return false;
      }
      return true;
    });

    return filtered.sort((a, b) => {
      const aPaused = a.status === "paused";
      const bPaused = b.status === "paused";
      if (aPaused !== bPaused) return aPaused ? 1 : -1;
      const av = a.next_run_at ? Date.parse(a.next_run_at) : Number.POSITIVE_INFINITY;
      const bv = b.next_run_at ? Date.parse(b.next_run_at) : Number.POSITIVE_INFINITY;
      if (av !== bv) return av - bv;
      return a.title.localeCompare(b.title);
    });
  }, [scopeRows, filters]);

  const openCreate = (template?: AutopilotTemplate) => {
    setSelectedTemplate(template ?? null);
    setCreateOpen(true);
  };

  const totalCount = autopilots.length;
  const showEmpty = !isLoading && !listError && totalCount === 0;

  return (
    <div className="relative flex flex-1 min-h-0 flex-col">
      <CollectionPageHeader
        icon={Zap}
        title={t(($) => $.page.title)}
        count={totalCount}
        leadingAction={
          <CollectionPageHeaderAction
            variant="default"
            icon={Plus}
            label={t(($) => $.page.new_autopilot)}
            onClick={() => openCreate()}
          />
        }
      />

      {listError ? (
        <CollectionPageState
          role="alert"
          tone="destructive"
          icon={AlertCircle}
          title={
            listError instanceof Error ? listError.message : String(listError)
          }
          actions={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => refetchList()}
            >
              {t(($) => $.page.retry)}
            </Button>
          }
        />
      ) : isLoading ? (
        <BoardSkeleton />
      ) : showEmpty ? (
        <div className="relative flex-1 overflow-y-auto px-5 pb-14 pt-6">
          <div className="pointer-events-none absolute left-1/2 top-0 h-64 w-[560px] -translate-x-1/2 rounded-full bg-brand/5 blur-3xl" />
          <div className="relative mx-auto flex max-w-3xl flex-col items-center">
            {/* A timetable waiting for its first departure — the empty state
                keeps the board's shape instead of collapsing to a blank page. */}
            <div className="w-full max-w-[520px] overflow-hidden rounded-xl border border-dashed border-input bg-surface-raised/70">
              <div className="flex items-center gap-2 border-b border-dashed border-border px-3.5 py-2 text-caption font-medium text-faint-foreground">
                <span>{t(($) => $.page.empty_schedule)}</span>
                <span className="ml-auto">{t(($) => $.page.empty_runs)}</span>
              </div>
              {[
                t(($) => $.page.skeleton_daily),
                t(($) => $.page.skeleton_interval),
                t(($) => $.page.skeleton_event),
              ].map((when, i) => (
                <div
                  key={when}
                  className={cn(
                    "grid grid-cols-[96px_minmax(0,1fr)_12px] items-center gap-3 px-3.5 py-2.5",
                    i > 0 && "border-t border-dashed border-border",
                  )}
                >
                  <span className="text-caption text-faint-foreground">
                    {when}
                  </span>
                  <span className="h-2 w-[62%] rounded-sm bg-muted" />
                  <span className="size-[7px] justify-self-end rounded-full bg-border" />
                </div>
              ))}
            </div>

            <h2 className="mt-7 text-title-sm font-semibold">
              {t(($) => $.page.empty.title)}
            </h2>
            <p className="mt-1.5 max-w-md text-center text-caption text-muted-foreground">
              {t(($) => $.page.empty.hint)}
            </p>
            <div className="mt-4 flex items-center gap-2">
              <Button size="sm" onClick={() => openCreate()}>
                <Plus className="mr-1 size-3.5" />
                {t(($) => $.page.new_autopilot)}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  templateGridRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  })
                }
              >
                {t(($) => $.page.browse_templates)}
              </Button>
            </div>

            <div className="mt-8 w-full">
              <div className="text-caption font-medium text-faint-foreground">
                {t(($) => $.page.templates_hint)}
              </div>
              <div
                ref={templateGridRef}
                className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
              >
                {TEMPLATES.map((tpl) => {
                  const Icon = tpl.icon;
                  const scheduleLabel = describeSchedule(t, {
                    raw: null,
                    timezone: "UTC",
                    time: tpl.schedule.time,
                    days: tpl.schedule.days,
                  });
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => openCreate(tpl)}
                      className={cn(
                        "flex flex-col items-start rounded-lg border border-border bg-surface-raised p-3 text-left",
                        "shadow-[var(--shadow-surface)] transition-colors hover:border-input hover:bg-surface-hover/70",
                      )}
                    >
                      <span className="flex items-center gap-2 text-label font-medium">
                        <Icon className="size-4 text-muted-foreground" />
                        {t(($) => $.templates[tpl.id].title)}
                      </span>
                      <span className="mt-1 line-clamp-2 text-caption leading-4 text-muted-foreground">
                        {t(($) => $.templates[tpl.id].summary)}
                      </span>
                      <span className="mt-2 text-caption font-medium text-brand">
                        {scheduleLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-1">
          <div className="mx-auto w-full max-w-[1180px]">
            <BoardToolbar
              scope={scope}
              onScopeChange={setScope}
              scopeCounts={scopeCounts}
              filters={filters}
              onToggleFilter={toggleFilter}
              onClearFilters={clearFilters}
              allRows={scopeRows}
            />

            <div className="mt-3 overflow-hidden rounded-xl border border-surface-border bg-surface-raised shadow-[var(--shadow-surface)]">
              <div
                className={cn(
                  "hidden gap-3 border-b border-border px-4 py-2 text-caption font-medium text-faint-foreground md:grid",
                  ROW_GRID,
                )}
              >
                <span>{t(($) => $.page.board_next)}</span>
                <span>{t(($) => $.page.table.name)}</span>
                <span>{t(($) => $.page.board_executor)}</span>
                <span className="text-right">{t(($) => $.page.board_recent)}</span>
              </div>

              {rows.length === 0 ? (
                <div className="py-16 text-center text-body text-muted-foreground">
                  {t(($) => $.page.no_matches)}
                </div>
              ) : (
                rows.map((row) => <BoardRow key={row.id} row={row} />)
              )}
            </div>
          </div>
        </div>
      )}

      {createOpen && (
        <AutopilotDialog
          mode="create"
          open={createOpen}
          onOpenChange={setCreateOpen}
          initial={
            selectedTemplate
              ? {
                  // Template title pulls from i18n so the user-visible default
                  // matches their locale, while the prompt body stays raw EN
                  // since it's injected directly into the agent task.
                  title: t(($) => $.templates[selectedTemplate.id].title),
                  description: selectedTemplate.prompt,
                }
              : undefined
          }
          initialSchedule={selectedTemplate ? selectedTemplate.schedule : undefined}
        />
      )}
    </div>
  );
}
