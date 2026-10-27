"use client";

import {
  issueBehavesAs,
  issueBehavesAsAny,
  issueStatusCategory,
  statusCategoryOfKey,
} from "@quickwork/core/issues";
import { useStatusLabel } from "../utils/status-label";
import { priorityLabel } from "../utils/priority-label";
import { useIssueStatuses } from "@quickwork/core/issue-statuses/hooks";
import { useState, useEffect, useCallback, useMemo, useRef, Fragment, type ReactNode } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { AppLink, useBackOrReplace } from "../../navigation";
import {
  Archive,
  ArrowUpRight,
  Calendar,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  Box,
  Bot,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  FileText,
  Flag,
  Loader2,
  Lock,
  Sparkles,
  MoreHorizontal,
  Pencil,
  ChevronUp,
  Link2,
  Pin,
  PinOff,
  Plus,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { BreadcrumbHeader, type BreadcrumbSegment } from "../../layout/breadcrumb-header";
import { Skeleton } from "@quickwork/ui/components/ui/skeleton";
import { Button, buttonVariants } from "@quickwork/ui/components/ui/button";
import { useIsMobile } from "@quickwork/ui/hooks/use-mobile";
import { ContentEditor, type ContentEditorRef, TitleEditor, type TitleEditorRef, useFileDropZone, FileDropOverlay, useLazyEditor, useEditorUpload, ImageSequenceProvider } from "../../editor";
import { collectImageSequence, type ImageSequenceBlock } from "@quickwork/core/attachments/image-sequence";
import { FileUploadButton } from "@quickwork/ui/components/common/file-upload-button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@quickwork/ui/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@quickwork/ui/components/ui/dropdown-menu";
import { Popover, PopoverTrigger, PopoverContent } from "@quickwork/ui/components/ui/popover";
import { Checkbox } from "@quickwork/ui/components/ui/checkbox";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@quickwork/ui/components/ui/command";
import { AvatarGroup, AvatarGroupCount } from "@quickwork/ui/components/ui/avatar";
import { ActorAvatar } from "../../common/actor-avatar";
import { PropertyIcon } from "../../common/property-icon";
import type { Attachment, Issue, IssueProperty, IssueStatus, IssueStatusCategory, IssuePriority, TimelineEntry, UpdateIssueRequest } from "@quickwork/core/types";
import { contentReferencesAttachment } from "@quickwork/core/types";
import { STATUS_CONFIG } from "@quickwork/core/issues/config";
import { formatDateOnly, isPastDateOnly } from "@quickwork/core/issues/date";
import {
  useApproveChainStep,
  useGenerateChainLegOutput,
  useSetChainStepPlan,
  useSkipChainStep,
  useUpdateIssue,
} from "@quickwork/core/issues/mutations";
import { toast } from "sonner";
import { api, errorCode } from "@quickwork/core/api";
import { formatDuration } from "../../agents/components/agent-activity-hover-content";
import { copyText } from "@quickwork/ui/lib/clipboard";
import { SoloIssueView } from "./solo/solo-issue-view";
import { SoloPropertyStrip } from "./solo/solo-property-strip";
import { SoloDeliverySection } from "./solo/solo-delivery-section";
import { useFileUpload } from "@quickwork/core/hooks/use-file-upload";
import { useDownloadAttachment } from "../../editor/use-download-attachment";
import { RefreshRunLogCard } from "./refresh-run-log";
import { useNow } from "./use-now";
import { StatusIcon, PriorityIcon, DueDatePicker, AssigneePicker, StatusPicker } from ".";
import { CustomPropertyValueDisplay } from "./pickers/custom-property-picker";
import { Switch } from "@quickwork/ui/components/ui/switch";
import { IssueActionsDropdown, useIssueActions, IssueActionsContextMenu, IssueContextMenuProvider } from "../actions";
import { LabelChip } from "../../labels/label-chip";
import { IssueAgentActivityIndicator } from "./issue-agent-activity-indicator";
import { SubIssuesAgentWorkingChip } from "./sub-issues-agent-working-chip";
import { LocalDirectoryHint } from "../../projects/components/local-directory-hint";
import { CommentCard } from "./comment-card";
import { ChainParkedBar, ChainStateTag, LockedLegBlock, RoomMessage } from "./squad-room";
import { chainStateKey, latestLegRun, legRunTasks, selectProducedLegComment, stepRunState } from "./chain-run-state";
import { LegRunLive } from "./leg-run-live";
import { deriveRelayView } from "./chain-run-state";
import {
  RelayFlowRail,
  RelayLogSection,
  RelayMetaRow,
  SeatMark,
  SubtaskList,
} from "./relay-chapters";
import {
  HandoffCard,
  HandoffFileChip,
  LegPlanSection,
  LegResourcesSection,
  type HandoffCandidate,
  type HandoffDraft,
} from "./relay-leg-rail";
import { SourceContextBadge } from "./source-context-viewer";
import { RevisionConflictCompare } from "./revision-conflict-compare";
import { CommentInput } from "./comment-input";
import { CurrentIssueRenderContextProvider } from "../current-issue-render-context";
import { ResolvedThreadBar } from "./resolved-thread-bar";
import { getShortcut, shortcutMatchesEvent } from "@quickwork/core/shortcuts";
import { isImeComposing } from "@quickwork/core/utils";
import { ThreadMinimap } from "./thread-minimap";
import { ThreadNavPanel, mentionsUser, type ThreadNavThread } from "./thread-nav-panel";
import { collectThreadReplies, deriveThreadResolution } from "./thread-utils";
import { IssueAgentHeaderChip } from "./issue-agent-header-chip";
import { RequirementClarificationCard } from "./requirement-clarification-card";
import { SoloRunLog } from "./solo-run-log";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@quickwork/core/auth";
import { useWorkspacePaths } from "@quickwork/core/paths";
import { useActorName } from "@quickwork/core/workspace/hooks";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useRecentContextStore } from "@quickwork/core/chat";
import { useModalStore } from "@quickwork/core/modals";
import { issueKeys, issueListOptions, issueDetailOptions, childIssuesOptions, childIssueProgressOptions, issueAttachmentsOptions, issueChainOptions } from "@quickwork/core/issues/queries";
import { projectDetailOptions } from "@quickwork/core/projects/queries";
import { ProjectIcon } from "../../projects/components/project-icon";
import { propertyListOptions } from "@quickwork/core/properties";
import { memberListOptions, agentListOptions } from "@quickwork/core/workspace/queries";
import { agentTaskSnapshotOptions } from "@quickwork/core/agents/queries";
import {
  selectExpandedResolved,
  useRecentIssuesStore,
  useResolvedExpandStore,
  useSubIssuesCollapseStore,
  useSubIssueDisplayStore,
  SUB_ISSUE_ROW_PROPERTY_KEYS,
  type SubIssueRowProperties,
  type SubIssueRowPropertyKey,
} from "@quickwork/core/issues/stores";
import { useIssueSelectionStore } from "@quickwork/core/issues/stores/selection-store";
import { BatchActionToolbar } from "./batch-action-toolbar";
import { useIssueTimeline } from "../hooks/use-issue-timeline";
import { useIssueReactions } from "../hooks/use-issue-reactions";
import { useIssueSubscribers } from "../hooks/use-issue-subscribers";
import { ReactionBar } from "@quickwork/ui/components/common/reaction-bar";
import { useLocale, useTimeAgo } from "../../i18n";
import {
  useRestoredScrollOffset,
  useRestoredScrollRef,
  useRestoredViewState,
  useViewStateWriter,
} from "../../platform";
import { cn } from "@quickwork/ui/lib/utils";
import { PAGE_GUTTER } from "../../layout/page-header";

import { ProgressRing } from "./progress-ring";
import { matchesPinyin } from "../../editor/extensions/pinyin-match";
import { useT } from "../../i18n";
import { useIssueDetailScrollRestore } from "../hooks/use-issue-detail-scroll-restore";
import { useInPageFind } from "../hooks/use-in-page-find";
import { useStickyComposer } from "../hooks/use-sticky-composer";
import { FindBar } from "./find-bar";

/**
 * Memento entry recording that the comment-highlight deep link for this
 * issue already landed on the current route (value: the consumed comment
 * id). Lets a remount that merely restores the view (tab switch back) skip
 * the jump-and-highlight, while a fresh selection — which clears the entry
 * (see InboxPage.handleSelect) — runs it again.
 */
export function issueHighlightMementoKey(issueId: string): string {
  return `highlight:${issueId}`;
}

// Shared by the subscribe button and the unsubscribe menu trigger so the two
// stay one control visually — they occupy the same slot and only differ in
// what a click does.
const SUBSCRIPTION_ACTION_CLASS =
  "text-caption text-muted-foreground hover:text-foreground transition-colors disabled:pointer-events-none disabled:opacity-50";

function SubscriberPopoverContent({
  members,
  agents,
  subscribers,
  toggleSubscriber,
  togglesDisabled,
  t,
}: {
  members: { user_id: string; name: string }[];
  agents: { id: string; name: string; archived_at?: string | null }[];
  subscribers: { user_type: string; user_id: string }[];
  toggleSubscriber: (id: string, type: "member" | "agent", subscribed: boolean) => void;
  /**
   * Every checkbox here is drawn from `subscribers`, which defaults to an empty
   * list until the query resolves — so an unresolved query renders everyone as
   * unsubscribed. Acting on that is not a harmless no-op: an explicit subscribe
   * rewrites the target's reason to 'manual' and clears any opt-out scope
   * (server/pkg/db/queries/subscriber.sql), which would quietly discard a
   * delegated subscription or someone's deliberate opt-out. So these rows wait
   * for a real answer, not just for the in-flight mutation (MUL-5714).
   */
  togglesDisabled: boolean;
  t: ActivityT;
}) {
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();

  const uniqueMembers = members.filter((m, i, arr) => arr.findIndex((x) => x.user_id === m.user_id) === i);
  const activeAgents = agents.filter((a) => !a.archived_at);

  const filteredMembers = q
    ? uniqueMembers.filter((m) => m.name.toLowerCase().includes(q) || matchesPinyin(m.name, q))
    : uniqueMembers;
  const filteredAgents = q
    ? activeAgents.filter((a) => a.name.toLowerCase().includes(q) || matchesPinyin(a.name, q))
    : activeAgents;

  return (
    <PopoverContent align="end" className="w-64 p-0">
      <Command shouldFilter={false}>
        <CommandInput
          placeholder={t(($) => $.detail.change_subscribers_placeholder)}
          value={search}
          onValueChange={setSearch}
        />
        <CommandList className="max-h-64">
          {filteredMembers.length === 0 && filteredAgents.length === 0 && (
            <CommandEmpty>{t(($) => $.detail.no_subscribers_results)}</CommandEmpty>
          )}
          {filteredMembers.length > 0 && (
            <CommandGroup heading={t(($) => $.detail.members_group)}>
              {filteredMembers.map((m) => {
                const sub = subscribers.find((s) => s.user_type === "member" && s.user_id === m.user_id);
                const isSubbed = !!sub;
                return (
                  <CommandItem
                    key={`member-${m.user_id}`}
                    onSelect={() => toggleSubscriber(m.user_id, "member", isSubbed)}
                    disabled={togglesDisabled}
                    className="flex items-center gap-2.5"
                  >
                    <Checkbox checked={isSubbed} className="pointer-events-none" />
                    <ActorAvatar actorType="member" actorId={m.user_id} size="md" />
                    <span className="truncate flex-1">{m.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}
          {filteredAgents.length > 0 && (
            <CommandGroup heading={t(($) => $.detail.agents_group)}>
              {filteredAgents.map((a) => {
                const sub = subscribers.find((s) => s.user_type === "agent" && s.user_id === a.id);
                const isSubbed = !!sub;
                return (
                  <CommandItem
                    key={`agent-${a.id}`}
                    onSelect={() => toggleSubscriber(a.id, "agent", isSubbed)}
                    disabled={togglesDisabled}
                    className="flex items-center gap-2.5"
                  >
                    <Checkbox checked={isSubbed} className="pointer-events-none" />
                    <ActorAvatar actorType="agent" actorId={a.id} size="md" showStatusDot />
                    <span className="truncate flex-1">{a.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </PopoverContent>
  );
}

function shortDate(date: string | null, locale: string): string {
  if (!date) return "—";
  return formatDateOnly(date, { month: "short", day: "numeric" }, locale);
}


type ActivityT = ReturnType<typeof useT<"issues">>["t"];

/**
 * Labels a status key from the activity feed. `resolveLabel` is the workspace
 * catalog resolver, which names custom statuses; without it — or for a status
 * since deleted — a built-in still gets its i18n name and anything else falls
 * back to the raw key. (MUL-6243)
 */
function statusLabel(
  status: string,
  t: ActivityT,
  resolveLabel?: (statusKey: string) => string,
): string {
  if (resolveLabel) return resolveLabel(status);
  if (status in STATUS_CONFIG) {
    return t(($) => $.status[statusCategoryOfKey(status)]);
  }
  return status;
}

function formatActivity(
  entry: TimelineEntry,
  t: ActivityT,
  locale: string,
  resolveActorName?: (type: string, id: string) => string,
  resolveStatusLabel?: (statusKey: string) => string,
): string {
  const details = (entry.details ?? {}) as Record<string, string>;
  switch (entry.action) {
    case "created":
      return t(($) => $.activity.created);
    case "status_changed":
      return t(($) => $.activity.status_changed, {
        from: statusLabel(details.from ?? "?", t, resolveStatusLabel),
        to: statusLabel(details.to ?? "?", t, resolveStatusLabel),
      });
    case "priority_changed":
      return t(($) => $.activity.priority_changed, {
        from: priorityLabel(details.from ?? "?", t),
        to: priorityLabel(details.to ?? "?", t),
      });
    case "assignee_changed": {
      const isSelfAssign = details.to_type === entry.actor_type && details.to_id === entry.actor_id;
      if (isSelfAssign) return t(($) => $.activity.self_assigned);
      const toName = details.to_id && details.to_type && resolveActorName
        ? resolveActorName(details.to_type, details.to_id)
        : null;
      if (toName) return t(($) => $.activity.assigned_to, { name: toName });
      if (details.from_id && !details.to_id) return t(($) => $.activity.removed_assignee);
      return t(($) => $.activity.changed_assignee);
    }
    case "start_date_changed": {
      if (!details.to) return t(($) => $.activity.start_date_removed);
      const formatted = formatDateOnly(details.to, { month: "short", day: "numeric" }, locale);
      return t(($) => $.activity.start_date_set, { date: formatted });
    }
    case "due_date_changed": {
      if (!details.to) return t(($) => $.activity.due_date_removed);
      const formatted = formatDateOnly(details.to, { month: "short", day: "numeric" }, locale);
      return t(($) => $.activity.due_date_set, { date: formatted });
    }
    case "title_changed":
      return t(($) => $.activity.title_renamed, {
        from: details.from ?? "?",
        to: details.to ?? "?",
      });
    case "description_updated":
      return t(($) => $.activity.description_updated);
    case "task_completed":
      return t(($) => $.activity.task_completed, { count: entry.coalesced_count ?? 1 });
    case "task_failed":
      return t(($) => $.activity.task_failed, { count: entry.coalesced_count ?? 1 });
    case "squad_leader_evaluated": {
      const reason = details.reason?.trim();
      switch (details.outcome) {
        case "action":
          return reason
            ? t(($) => $.activity.squad_leader_action_reason, { reason })
            : t(($) => $.activity.squad_leader_action);
        case "no_action":
          return reason
            ? t(($) => $.activity.squad_leader_no_action_reason, { reason })
            : t(($) => $.activity.squad_leader_no_action);
        case "failed":
          return reason
            ? t(($) => $.activity.squad_leader_failed_reason, { reason })
            : t(($) => $.activity.squad_leader_failed);
        default:
          return t(($) => $.activity.squad_leader_evaluated);
      }
    }
    default:
      return entry.action ?? "";
  }
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Stable reference for threads with no replies. Inline `[]` would create a
// new array on every render and bust React.memo on CommentCard / ResolvedThreadBar.
const EMPTY_REPLIES: TimelineEntry[] = [];

const SOLO_ACTIVE_TASK_STATUSES = new Set([
  "queued",
  "dispatched",
  "running",
  "waiting_local_directory",
]);

/** A run duration that ticks while the task is still executing. */
function LiveDuration({
  started,
  completed,
  active,
}: {
  started: string | null | undefined;
  completed: string | null | undefined;
  active: boolean;
}) {
  const now = useNow(active);
  if (!started) return null;
  return <>{formatDuration(started, completed ? Date.parse(completed) : now)}</>;
}

// groupSubIssuesByStage orders a parent's children for display: staged groups
// ascending by stage, then the unstaged group (stage === null) last. Callers
// render a per-group stage header only when the set is actually staged.
export function groupSubIssuesByStage(
  children: Issue[],
): { stage: number | null; items: Issue[] }[] {
  const byStage = new Map<number, Issue[]>();
  const unstaged: Issue[] = [];
  for (const c of children) {
    if (c.stage != null) {
      const arr = byStage.get(c.stage);
      if (arr) arr.push(c);
      else byStage.set(c.stage, [c]);
    } else {
      unstaged.push(c);
    }
  }
  const groups: { stage: number | null; items: Issue[] }[] = [...byStage.keys()]
    .sort((a, b) => a - b)
    .map((s) => ({ stage: s, items: byStage.get(s) as Issue[] }));
  if (unstaged.length > 0) groups.push({ stage: null, items: unstaged });
  return groups;
}

// Shallow array equality by element identity. Used to reuse the previous
// render's per-thread reply slice when nothing in *this* thread changed,
// even if the surrounding `timeline` array was rebuilt by a WS event in
// some unrelated thread.
function shallowEqualEntries(a: TimelineEntry[], b: TimelineEntry[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// Flat per-item shape consumed by <Virtuoso>. Virtuoso needs a flat array
// where each entry is one rendered row; we keep the grouping logic from
// `timelineView.groups` (consecutive same-actor activities still collapse
// into one activity-group row) but project it into a discriminated union
// the itemContent dispatcher can switch on.
type TimelineItem =
  | { kind: "comment"; id: string; entry: TimelineEntry }
  | { kind: "resolved-bar"; id: string; entry: TimelineEntry }
  | { kind: "activity-group"; id: string; entries: TimelineEntry[] };

type RawTimelineGroup = {
  type: "comment" | "activities";
  entries: TimelineEntry[];
};

function flattenGroups(
  groups: ReadonlyArray<RawTimelineGroup>,
  expandedResolved: ReadonlySet<string>,
): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const group of groups) {
    if (group.type === "comment") {
      const entry = group.entries[0]!;
      const isResolved = !!entry.resolved_at;
      const isExpanded = expandedResolved.has(entry.id);
      out.push(
        isResolved && !isExpanded
          ? { kind: "resolved-bar", id: entry.id, entry }
          : { kind: "comment", id: entry.id, entry },
      );
    } else {
      out.push({
        kind: "activity-group",
        id: group.entries[0]!.id,
        entries: group.entries,
      });
    }
  }
  return out;
}

function TimelineSkeleton() {
  return (
    <div className="mt-4 flex flex-col gap-3">
      {[0, 1].map((i) => (
        <div key={i} className="flex gap-3 p-4">
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

// When the trailing block is expanded, we still truncate its body to the most
// recent N entries — a single block of 50 status flips drowns the comment area
// as badly as N blocks of 1 would. Older entries fold behind a "Show N more
// activities" line that expands in place.
const LAST_ACTIVITY_BLOCK_VISIBLE_LIMIT = 8;

// Collapsible wrapper for an activity block. Older blocks default to a single
// "N activities" summary line so the timeline isn't dominated by status /
// priority / assignee churn; the trailing block stays expanded because it
// usually answers "what just happened?". Expansion state is owned by the
// parent so it survives Virtuoso's mount/unmount on scroll.
function ActivityBlock({
  entries,
  expanded,
  onToggle,
  truncateOlder,
  showOlder,
  onToggleShowOlder,
  getActorName,
  resolveStatusLabel,
  resolveStatusCategory,
  resolveStatusColor,
  t,
  timeAgo,
  locale,
}: {
  entries: TimelineEntry[];
  expanded: boolean;
  onToggle: () => void;
  // Trailing block only: when true, the body shows only the most recent
  // LAST_ACTIVITY_BLOCK_VISIBLE_LIMIT entries with the older ones folded
  // behind a "Show N more activities" inline toggle.
  truncateOlder: boolean;
  showOlder: boolean;
  onToggleShowOlder: () => void;
  getActorName: (type: string, id: string) => string;
  resolveStatusLabel: (statusKey: string) => string;
  resolveStatusCategory: (statusKey: string) => IssueStatusCategory;
  /** A custom status's own `#rrggbb`; null for built-ins and unknown keys. */
  resolveStatusColor: (statusKey: string) => string | null;
  t: ActivityT;
  timeAgo: (dateStr: string) => string;
  locale: string;
}) {
  if (!expanded) {
    const count = entries.length;
    return (
      <div className="pb-3 px-4 max-md:px-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-1.5 text-caption text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight className="h-3 w-3 shrink-0" />
          <span>{t(($) => $.activity.activity_count, { count })}</span>
        </button>
      </div>
    );
  }
  const hiddenOlderCount =
    truncateOlder && !showOlder && entries.length > LAST_ACTIVITY_BLOCK_VISIBLE_LIMIT
      ? entries.length - LAST_ACTIVITY_BLOCK_VISIBLE_LIMIT
      : 0;
  const visibleEntries =
    hiddenOlderCount > 0 ? entries.slice(-LAST_ACTIVITY_BLOCK_VISIBLE_LIMIT) : entries;
  // Hide the "v N activities" collapse header while we're in the truncated
  // default state. The "Show N more" link is the only control users need
  // when they're glancing at recent activity — stacking two chevron rows
  // looked like nested folds and added visual noise without value. Once the
  // user explicitly reveals older entries, the header reappears so they can
  // fold the whole block back to a single count line.
  const showHeader = hiddenOlderCount === 0;
  return (
    <div className="pb-3 px-4 max-md:px-3 flex flex-col gap-3">
      {showHeader && (
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-1.5 text-caption text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown className="h-3 w-3 shrink-0" />
          <span>{t(($) => $.activity.activity_count, { count: entries.length })}</span>
        </button>
      )}
      {hiddenOlderCount > 0 && (
        <button
          type="button"
          onClick={onToggleShowOlder}
          className="flex items-center gap-1.5 text-caption text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight className="h-3 w-3 shrink-0" />
          <span>{t(($) => $.activity.show_more_activities, { count: hiddenOlderCount })}</span>
        </button>
      )}
      {visibleEntries.map((entry) => {
        const details = (entry.details ?? {}) as Record<string, string>;
        const isStatusChange = entry.action === "status_changed";
        const isPriorityChange = entry.action === "priority_changed";
        const isStartDateChange = entry.action === "start_date_changed";
        const isDueDateChange = entry.action === "due_date_changed";

        let leadIcon: React.ReactNode;
        if (isStatusChange && details.to) {
          leadIcon = (
            <StatusIcon
              status={details.to as IssueStatus}
              category={resolveStatusCategory(details.to ?? "")}
              color={resolveStatusColor(details.to ?? "")}
              className="h-4 w-4 shrink-0"
            />
          );
        } else if (isPriorityChange && details.to) {
          leadIcon = <PriorityIcon priority={details.to as IssuePriority} className="h-4 w-4 shrink-0" />;
        } else if (isStartDateChange) {
          leadIcon = <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />;
        } else if (isDueDateChange) {
          leadIcon = <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />;
        } else {
          leadIcon = <ActorAvatar actorType={entry.actor_type} actorId={entry.actor_id} size="sm" />;
        }

        return (
          <div key={entry.id} className="flex items-center text-caption text-muted-foreground">
            <div className="mr-2 flex w-4 shrink-0 justify-center">
              {leadIcon}
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <span className="shrink-0 font-medium">{getActorName(entry.actor_type, entry.actor_id)}</span>
              <span className="truncate">{formatActivity(entry, t, locale, getActorName, resolveStatusLabel)}</span>
              {(entry.coalesced_count ?? 1) > 1 &&
                entry.action !== "task_completed" &&
                entry.action !== "task_failed" && (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-caption font-medium tabular-nums text-muted-foreground">
                    {t(($) => $.activity.coalesced_badge, { count: entry.coalesced_count ?? 1 })}
                  </span>
                )}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="ml-auto shrink-0 cursor-default">
                      {timeAgo(entry.created_at)}
                    </span>
                  }
                />
                <TooltipContent side="top">
                  {new Date(entry.created_at).toLocaleString(locale)}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SubIssueRow — sub-issue list item with inline status & assignee editing
// ---------------------------------------------------------------------------

function SubIssueRow({
  child,
  childProgress,
  rowProps,
  customProperties,
}: {
  child: Issue;
  /** The sub-issue's OWN children progress (it can itself be a parent). */
  childProgress?: { done: number; total: number };
  /** User-level display preference: which built-in fields the row shows. */
  rowProps: SubIssueRowProperties;
  /** Workspace custom properties the user opted into showing on rows. */
  customProperties: IssueProperty[];
}) {
  const { t } = useT("issues");
  const locale = useLocale();
  const paths = useWorkspacePaths();
  const updateIssue = useUpdateIssue();
  const selected = useIssueSelectionStore((s) => s.selectedIds.has(child.id));
  const toggleSelected = useIssueSelectionStore((s) => s.toggle);
  // Category, not key: a custom status in the done/cancelled categories is
  // finished work and has to strike through like any other. (MUL-6243)
  const isDone = issueBehavesAsAny(child, ["done", "cancelled"]);
  const labels = rowProps.labels ? (child.labels ?? []) : [];
  const customPropsWithValue = customProperties.filter(
    (p) => child.properties?.[p.id] !== undefined,
  );

  const handleUpdate = useCallback(
    (updates: Partial<UpdateIssueRequest>) => {
      updateIssue.mutate(
        {
          id: child.id,
          ...updates,
        },
        {
          onError: (err) =>
            toast.error(
              err instanceof Error && err.message
                ? err.message
                : t(($) => $.detail.update_failed),
            ),
        },
      );
    },
    [child.id, updateIssue, t],
  );

  // AppLink wraps only the title/identifier area. Pickers and checkbox are
  // siblings, so their clicks never navigate — no stopPropagation acrobatics
  // and no risk of the native checkbox / picker triggers being blocked.
  // Right-click anywhere on the row opens the shared issue actions menu
  // (priority, labels, dates, delete, …) — the same menu as list rows.
  return (
    <IssueActionsContextMenu issue={child}>
      <div
        className={cn(
          "flex items-center gap-2.5 px-3 py-2 hover:bg-accent/50 transition-colors group/row",
          selected && "bg-accent/30",
        )}
      >
        {/* Priority ⇄ checkbox slot, mirroring the main list rows: the
            priority icon yields to the selection checkbox on hover/focus.
            Opacity (not display) swap keeps the checkbox keyboard-tabbable. */}
        <div className="relative flex h-4 w-4 shrink-0 items-center justify-center">
          {rowProps.priority && (
            <PriorityIcon
              priority={child.priority}
              className={cn(
                "transition-opacity",
                selected
                  ? "opacity-0"
                  : "group-hover/row:opacity-0 group-focus-within/row:opacity-0",
              )}
            />
          )}
          <input
            type="checkbox"
            checked={selected}
            onChange={() => toggleSelected(child.id)}
            aria-label={t(($) => $.detail.select_sub_issue_aria, {
              identifier: child.identifier,
            })}
            className={cn(
              "absolute inset-0 cursor-pointer accent-primary transition-opacity",
              selected
                ? "opacity-100"
                : "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100",
            )}
          />
        </div>
        <StatusPicker
          status={child.status}
          onUpdate={handleUpdate}
          align="start"
          trigger={
            <StatusIcon
              status={child.status}
              className="h-[15px] w-[15px] shrink-0"
            />
          }
        />
        <AppLink
          href={paths.issueDetail(child.id)}
          className="flex min-w-0 flex-1 items-center gap-2.5"
        >
          <span className="text-micro text-muted-foreground tabular-nums font-medium shrink-0">
            {child.identifier}
          </span>
          <IssueAgentActivityIndicator issueId={child.id} />
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span
              className={cn(
                "text-body truncate",
                isDone
                  ? "text-muted-foreground"
                  : "group-hover/row:text-foreground",
              )}
            >
              {child.title}
            </span>
            {labels.length > 0 && (
              <span className="hidden max-w-[200px] shrink-0 items-center gap-1 overflow-hidden md:inline-flex">
                {labels.slice(0, 2).map((label) => (
                  <LabelChip key={label.id} label={label} />
                ))}
                {labels.length > 2 && (
                  <span className="text-micro text-muted-foreground">
                    +{labels.length - 2}
                  </span>
                )}
              </span>
            )}
            {customPropsWithValue.length > 0 && (
              <span className="hidden max-w-[260px] shrink-0 items-center gap-1 overflow-hidden md:inline-flex">
                {customPropsWithValue.slice(0, 3).map((property) => (
                  <span
                    key={property.id}
                    className="inline-flex max-w-[120px] items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-micro text-muted-foreground"
                  >
                    <PropertyIcon property={property} className="size-3 text-micro" />
                    <CustomPropertyValueDisplay
                      property={property}
                      value={child.properties?.[property.id]}
                    />
                  </span>
                ))}
              </span>
            )}
            {rowProps.childProgress && childProgress && childProgress.total > 0 && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5">
                <ProgressRing
                  done={childProgress.done}
                  total={childProgress.total}
                  size={11}
                />
                <span className="text-micro text-muted-foreground tabular-nums font-medium">
                  {childProgress.done}/{childProgress.total}
                </span>
              </span>
            )}
          </span>
        </AppLink>
        {rowProps.dueDate && child.due_date && (
          <DueDatePicker
            dueDate={child.due_date}
            onUpdate={handleUpdate}
            align="end"
            trigger={
              <span
                className={cn(
                  "flex shrink-0 items-center gap-1 text-caption tabular-nums",
                  !isDone && isPastDateOnly(child.due_date)
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                <CalendarDays className="size-3" />
                {shortDate(child.due_date, locale)}
              </span>
            }
          />
        )}
        {rowProps.assignee && (
          <AssigneePicker
            assigneeType={child.assignee_type}
            assigneeId={child.assignee_id}
            onUpdate={handleUpdate}
            align="end"
            trigger={
              child.assignee_type && child.assignee_id ? (
                <ActorAvatar
                  actorType={child.assignee_type}
                  actorId={child.assignee_id}
                  size="sm"
                  className="shrink-0"
                />
              ) : (
                <span
                  aria-hidden
                  className="h-5 w-5 rounded-full border border-dashed border-muted-foreground/30 shrink-0"
                />
              )
            }
          />
        )}
      </div>
    </IssueActionsContextMenu>
  );
}

// ---------------------------------------------------------------------------
// SubIssueDisplayPopover — per-user "which properties do rows show" control
// ---------------------------------------------------------------------------

// Reuses the main Display panel's `card_*` labels — the property names are
// identical, so the sub-issues control needs no locale keys of its own.
const SUB_ISSUE_ROW_PROPERTY_LABEL_KEY: Record<
  SubIssueRowPropertyKey,
  "card_priority" | "card_labels" | "card_child_progress" | "card_due_date" | "card_assignee"
> = {
  priority: "card_priority",
  labels: "card_labels",
  childProgress: "card_child_progress",
  dueDate: "card_due_date",
  assignee: "card_assignee",
};

function SubIssueDisplayPopover({
  workspaceProperties,
}: {
  workspaceProperties: IssueProperty[];
}) {
  const { t } = useT("issues");
  const rowProperties = useSubIssueDisplayStore((s) => s.rowProperties);
  const rowPropertyIds = useSubIssueDisplayStore((s) => s.rowPropertyIds);
  const toggleRowProperty = useSubIssueDisplayStore((s) => s.toggleRowProperty);
  const toggleRowPropertyId = useSubIssueDisplayStore((s) => s.toggleRowPropertyId);

  return (
    <Popover>
      <Tooltip>
        <PopoverTrigger
          render={
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  aria-label={t(($) => $.display.tooltip)}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                </button>
              }
            />
          }
        />
        <TooltipContent side="bottom">{t(($) => $.display.tooltip)}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-56 p-0">
        <div className="px-3 py-2.5">
          <div className="space-y-2">
            {SUB_ISSUE_ROW_PROPERTY_KEYS.map((key) => (
              <label
                key={key}
                className="flex cursor-pointer items-center justify-between"
              >
                <span className="text-body">
                  {t(($) => $.display[SUB_ISSUE_ROW_PROPERTY_LABEL_KEY[key]])}
                </span>
                <Switch
                  size="sm"
                  checked={rowProperties[key]}
                  onCheckedChange={() => toggleRowProperty(key)}
                />
              </label>
            ))}
            {workspaceProperties.map((property) => (
              <label
                key={property.id}
                className="flex cursor-pointer items-center justify-between gap-3"
              >
                <span className="flex min-w-0 items-center gap-1.5 truncate text-body">
                  <PropertyIcon property={property} className="size-3.5 text-caption" />
                  <span className="truncate">{property.name}</span>
                </span>
                <Switch
                  size="sm"
                  checked={rowPropertyIds.includes(property.id)}
                  onCheckedChange={() => toggleRowPropertyId(property.id)}
                />
              </label>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface IssueDetailProps {
  issueId: string;
  /**
   * Full-route pages use the refresh archive layout; embedded panes (the
   * inbox) keep the denser legacy reading layout.
   */
  layout?: "legacy" | "refresh";
  onDelete?: () => void;
  /** Called after the issue is marked as done via the toolbar button. */
  onDone?: () => void;
  /** When set, the issue detail will auto-scroll to this comment and briefly highlight it. */
  highlightCommentId?: string;
  /**
   * Bump to replay the `highlightCommentId` landing on an already-mounted
   * detail. A remount replays it by itself (fresh mount, cleared memento
   * entry); this token is for the one path with neither remount nor
   * guaranteed re-render — re-clicking the notification row that is already
   * open (see InboxPage.handleSelect). The bump both re-arms the landing
   * guard and forces the render that re-reads the cleared memento entry.
   */
  highlightRequestToken?: number;
  /**
   * Far-left header slot, replacing the mobile sidebar trigger. A host that
   * embeds this detail one level deep (the inbox, on a phone) passes its own
   * "back" control here instead of stacking a second 48px bar above us — the
   * breadcrumb this header already renders names the issue's container, not
   * the surface the reader arrived from, so only the host can spell that trip.
   */
  leadingAction?: ReactNode;
}

// ---------------------------------------------------------------------------
// Not found
// ---------------------------------------------------------------------------

/**
 * Exported so `IssueDetailRoute` can render it for an identifier that names no
 * issue. The route must NOT fall through to `IssueDetail` in that case: doing
 * so mounts a second observer on the already-failed query, which refetches it
 * and restarts the resolve/remount cycle indefinitely.
 */
export function IssueNotFound({
  showBackLink = true,
  leading,
}: {
  showBackLink?: boolean;
  /**
   * Host-supplied way back, mirrored from `IssueDetailProps.leadingAction`. A
   * host that hands its whole screen to this component (the inbox, on a phone)
   * has no bar of its own left, so this state has to carry the trip back or
   * there is none.
   */
  leading?: ReactNode;
}) {
  const { t } = useT("issues");
  const backOrReplace = useBackOrReplace();
  const paths = useWorkspacePaths();

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {leading && (
        <div className={cn("flex h-12 shrink-0 items-center gap-2 border-b", PAGE_GUTTER)}>{leading}</div>
      )}
      <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-3 text-body text-muted-foreground">
        <p>{t(($) => $.detail.not_found)}</p>
        {showBackLink && (
          <Button variant="outline" size="sm" onClick={() => backOrReplace(paths.tasks())}>
            <ChevronLeft className="mr-1 h-3.5 w-3.5" />
            {t(($) => $.detail.back)}
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

/**
 * Exported so `IssueDetailRoute` can show the identical frame while it resolves
 * an identifier URL to its issue — the two waits are indistinguishable to the
 * user, and rendering the same skeleton keeps them that way.
 */
export function IssueDetailSkeleton({ leading }: { leading?: ReactNode } = {}) {
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* The way back is real from the first frame, not once the issue lands:
          a host that gave up its own bar for `leadingAction` has nothing else
          to offer while this skeleton owns the screen. */}
      <div className={cn("flex h-12 shrink-0 items-center gap-2 border-b", PAGE_GUTTER)}>
        {leading ?? (
          <>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 w-24" />
          </>
        )}
      </div>
      <div className="flex flex-1 min-h-0">
        {/* Same scrollbar-gutter as the loaded scroller below, so the skeleton
            column doesn't shift sideways when real content mounts. */}
        <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]">
          {/* Gutters match the loaded column exactly (see its comment), so the
              skeleton doesn't reflow sideways when real content mounts. */}
          <div data-issue-column className="mx-auto w-full max-w-none px-3 py-6 space-y-6 md:px-8 md:py-8">
            <Skeleton className="h-8 w-3/4" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
            <Skeleton className="h-px w-full" />
            <div className="space-y-3">
              <Skeleton className="h-4 w-20" />
              <div className="flex items-start gap-3">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-16 w-full rounded-lg" />
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="hidden md:block w-[356px] border-l p-4 space-y-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="h-3 w-16 shrink-0" />
              <Skeleton className="h-5 w-24" />
            </div>
          ))}
          <Skeleton className="h-px w-full" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="h-3 w-16 shrink-0" />
              <Skeleton className="h-4 w-28" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// IssueDetail
// ---------------------------------------------------------------------------

export function IssueDetail({ issueId, layout = "legacy", onDelete, onDone, highlightCommentId, highlightRequestToken, leadingAction }: IssueDetailProps) {
  const { t } = useT("issues");
  const locale = useLocale();
  const timeAgo = useTimeAgo();
  const id = issueId;
  const user = useAuthStore((s) => s.user);
  const paths = useWorkspacePaths();
  const openModal = useModalStore((state) => state.open);
  const backOrReplace = useBackOrReplace();
  const downloadAttachment = useDownloadAttachment();

  // Issue navigation — read from TQ list cache
  const wsId = useWorkspaceId();
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  // Workspace owners and admins moderate any comment authored by anyone
  // (mirrors backend `comment.go:507-512`). Computed here so per-comment
  // rendering doesn't have to re-derive it for every row.
  const currentUserRole =
    members.find((m) => m.user_id === user?.id)?.role ?? null;
  const canModerateComments =
    currentUserRole === "owner" || currentUserRole === "admin";
  const { data: allIssues = [] } = useQuery(issueListOptions(wsId));
  const { getActorName, getMemberName, getAgentName, getSquadName } = useActorName();
  // A task handed to a squad runs as a relay, and this page reads top-to-bottom
  // as that relay: one chapter per leg, the reader's own leg open as their
  // workbench, and the whole record folded at the bottom.
  const { data: chain } = useQuery(issueChainOptions(id));
  // The relay's run states (waiting for pickup vs executing on whose machine)
  // are read from the task rows the chain's dispatch created.
  const { data: relayTasks = [] } = useQuery(agentTaskSnapshotOptions(wsId));
  const isRoom = !!chain && chain.steps.length > 0;
  const skipChainStep = useSkipChainStep(id);
  // Everything the reader-specific room pieces need, derived once: which leg
  // is active, which one is theirs, whether they hold the 通过.
  const relayView = useMemo(
    () => (chain ? deriveRelayView(chain, user?.id) : null),
    [chain, user?.id],
  );
  const approveChainStep = useApproveChainStep(id);
  const setChainStepPlan = useSetChainStepPlan(id);
  // ── The subtask page (B 式重构) ───────────────────────────────────────
  // One squad task = a parent + one subtask per person, in a fixed order.
  // `openLeg` is the leg seq the reader is inside: null = land by default
  // (the reader's own unfinished leg — their task IS that subtask), "parent"
  // = explicitly back at the parent, a number = that leg's own page.
  const [openLeg, setOpenLeg] = useState<number | "parent" | null>(null);
  useEffect(() => {
    setOpenLeg(null);
  }, [id]);
  const defaultLegSeq = relayView?.myStep ? relayView.myStep.position + 1 : null;
  const openLegSeq =
    openLeg === null ? defaultLegSeq : openLeg === "parent" ? null : openLeg;
  const openLegStep =
    chain && openLegSeq != null
      ? chain.steps.find((step) => step.position + 1 === openLegSeq) ?? null
      : null;
  const openLegIsMine =
    !!openLegStep && !!user?.id && openLegStep.holder_user_id === user.id;
  const openLegRunState = openLegStep
    ? stepRunState(id, openLegStep, relayTasks)
    : "none";
  // The leg's newest run, terminal included — the 执行实况 strip's subject and
  // what 完整日志 opens. Full per-issue history (the snapshot above keeps only
  // each agent's latest outcome overall, so a run finished here can fall out
  // of it once the agent works somewhere else). Only the holder sees the leg.
  const { data: issueTasks = [] } = useQuery({
    queryKey: issueKeys.tasks(id),
    queryFn: () => api.listTasksByIssue(id),
  });
  const openLegLatestRun = openLegStep
    ? latestLegRun(id, openLegStep, issueTasks)
    : null;
  const openLegHolding =
    openLegIsMine &&
    !!openLegStep &&
    (openLegStep.state === "doing" || openLegStep.state === "reviewing");

  // The composer speaks for the page it is on: inside the reader's own live
  // leg it talks to that leg's agent by name; the parent's box is the room's.
  const roomComposerPlaceholder = isRoom
    ? openLegHolding && openLegStep?.agent_id
      ? t(($) => $.room.composer_mine, { agent: getAgentName(openLegStep.agent_id) })
      : t(($) => $.room.composer_placeholder)
    : undefined;
  // What the composer posts INTO: only the reader's own live leg, and only
  // from that leg's own page (单流分界: the room reads what a person says to
  // the room; the leg keeps the rest).
  const composerLegScopeId =
    isRoom && openLegStep && openLegHolding ? openLegStep.id : undefined;
  const playerNames = useMemo(() => {
    const byUserId = new Map(members.map((m) => [m.user_id, m.identity ?? ""]));
    return {
      nameOf: (userId: string) => getMemberName(userId),
      identityOf: (userId: string) => {
        const identity = byUserId.get(userId);
        return identity ? identity : undefined;
      },
    };
  }, [members, getMemberName]);
  const resolveStatusLabel = useStatusLabel(wsId);
  // The glyph set is per CATEGORY (MUL-6243), so a status-change entry for a
  // custom status drew the same icon as the built-in it sits beside — an
  // "In Review → Awaiting Response" line looked like nothing had moved. Colour
  // is what carries a custom status's own identity, as the inbox row and the
  // status-changed detail label already render it. `colorOf` is what keeps a
  // built-in on its semantic token instead of the catalog's seed hex.
  const { categoryOf: resolveStatusCategory, colorOf: resolveStatusColor } =
    useIssueStatuses(wsId);
  // Description autosave is deliberately NOT gated (no explicit submit; the
  // editor already strips `blob:` before serializing and binds ids on the
  // later save). It still needs the failure toast, or a failed upload just
  // erases its own placeholder and the file disappears unexplained.
  const { uploadWithToast } = useEditorUpload();
  const isMobile = useIsMobile();
  // Virtuoso's `customScrollParent` wants the HTMLElement, not a ref. A plain
  // `useRef.current` does not trigger a re-render when it populates, so the
  // Virtuoso prop would never receive the element. Callback ref + state fixes
  // that: setState triggers the re-render that hands Virtuoso the element.
  const [scrollContainerEl, setScrollContainerEl] = useState<HTMLDivElement | null>(null);
  // Bottom comment composer. Measured when scrolling a freshly posted comment
  // into view so its bottom lands above the composer rather than behind it.
  const composerRef = useRef<HTMLDivElement | null>(null);
  // Pull-based scroll restoration (MUL-4741): the platform serves the offset
  // captured when this route was last left. The ref-attach assignment covers
  // the flat render modes (real heights at commit); the virtualized browsing
  // mode feeds the offset into Virtuoso's initialScrollTop below so the
  // list's first render already materializes the rows around it.
  //
  // The container key carries the issue id: on the issue route that is
  // redundant with the route scoping, but in the inbox the selection lives
  // in the query string while memento entries key by pathname — a bare
  // "main" would restore notification A's offset into notification B's
  // detail.
  const scrollContainerKey = `main:${id}`;
  const restoredScrollTop = useRestoredScrollOffset(scrollContainerKey);
  const restoreScrollRef = useRestoredScrollRef(scrollContainerKey);
  // Whether this issue's comment-highlight deep link already landed here
  // (survives the tab's unmount, unlike didHighlightRef below): a remount
  // that restores the view must not re-run the jump.
  //
  // The landing effect reads it through a ref, NOT through its dependency
  // array: recording the landing writes this very value, and as an effect
  // dependency that write would re-fire the effect one commit after the
  // jump — whose cleanup cancels the centering rAF loop and the highlight
  // fade before a single frame ran. Every path that must re-evaluate the
  // landing already re-runs the effect through another dependency (mount,
  // items arriving, token bump), and the render that precedes it refreshes
  // this ref.
  const consumedHighlightId = useRestoredViewState(issueHighlightMementoKey(id));
  const consumedHighlightRef = useRef(consumedHighlightId);
  consumedHighlightRef.current = consumedHighlightId;
  const writeViewState = useViewStateWriter();
  const attachScrollContainer = useCallback(
    (el: HTMLDivElement | null) => {
      setScrollContainerEl(el);
      restoreScrollRef(el);
    },
    [restoreScrollRef],
  );
  const [pendingPostedCommentId, setPendingPostedCommentId] = useState<string | null>(null);
  const scrollToTimelineBottom = useCallback((commentId: string) => {
    setPendingPostedCommentId(commentId);
  }, []);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  // User preference: pin the bottom comment bar to the scroll viewport. Off
  // below `md` regardless of the preference — see the hook.
  const stickyComposer = useStickyComposer();

  // Per-session: which resolved threads the user has temporarily expanded.
  // Not persisted (matches Linear) — reload collapses everything back to bars.
  // Store-backed (not component state) so the command palette's fold/unfold
  // all-comments commands can drive it from outside this page.
  const expandedResolved = useResolvedExpandStore(selectExpandedResolved(id));
  const setResolvedExpanded = useResolvedExpandStore((s) => s.setExpanded);
  const toggleResolvedExpand = useCallback((commentId: string, expand: boolean) => {
    setResolvedExpanded(id, commentId, expand);
    // On collapse the thread shrinks and the viewport would jump to whatever was
    // below; pull the just-folded thread back into view with the smallest
    // movement. rAF waits for the collapse to land before measuring.
    if (!expand) {
      requestAnimationFrame(() =>
        document.getElementById(`comment-${commentId}`)?.scrollIntoView({ block: "nearest" }),
      );
    }
  }, [id, setResolvedExpanded]);
  const clearResolvedExpand = useCallback((commentId: string) => {
    setResolvedExpanded(id, commentId, false);
  }, [id, setResolvedExpanded]);

  // Per-session activity-block expansion overrides. The default rule is
  // "only the trailing block is expanded" (computed from timelineView.groups
  // below); these two sets capture user clicks that diverge from the default.
  // Two sets are needed because "default" can flip when a new activity block
  // appends — without an explicit collapse override, a manually-collapsed
  // older block would re-expand when it stops being the trailing one (or vice
  // versa). Not persisted, matches the resolved-thread behaviour above.
  const [expandedActivityIds, setExpandedActivityIds] = useState<Set<string>>(() => new Set());
  const [collapsedActivityIds, setCollapsedActivityIds] = useState<Set<string>>(() => new Set());
  // Block IDs where the user has explicitly chosen to also reveal the older
  // (pre-last-8) entries within the trailing block. Kept independent of the
  // expanded/collapsed sets so collapsing then re-expanding preserves the
  // "show all" choice, and so the choice survives the block losing its
  // trailing position when a new comment lands after it.
  const [showOlderActivityIds, setShowOlderActivityIds] = useState<Set<string>>(() => new Set());
  const toggleActivityBlock = useCallback((id: string, currentlyExpanded: boolean) => {
    if (currentlyExpanded) {
      setCollapsedActivityIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      setExpandedActivityIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } else {
      setExpandedActivityIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      setCollapsedActivityIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);
  const showOlderActivities = useCallback((id: string) => {
    setShowOlderActivityIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);
  const didHighlightRef = useRef<string | null>(null);
  // Last seen highlightRequestToken; a bump re-arms didHighlightRef so the
  // landing effect below replays on an already-mounted detail.
  const lastHighlightRequestTokenRef = useRef(highlightRequestToken);

  // Issue data from TQ — uses detail query, seeded from list cache if available.
  // Only seed when description is present; the list API omits it, so a partial
  // list row must not masquerade as a hydrated issue detail.
  const { data: issue = null, isLoading: issueLoading, refetch: refetchIssue } = useQuery({
    ...issueDetailOptions(wsId, id),
    // List rows and issue-created realtime payloads intentionally omit the
    // detail-only source-context snapshot. They can still seed this query via
    // initialData, so always reconcile with the authoritative detail endpoint
    // when the detail view mounts. Without this, the global Infinity staleTime
    // hides source context until a full page refresh.
    refetchOnMount: "always",
    initialData: () => {
      const cached = allIssues.find((i) => i.id === id);
      return cached?.description != null ? cached : undefined;
    },
  });
  const openCommentSubIssue = useCallback((commentId: string) => {
    if (!issue) return;
    openModal("quick-create-issue", {
      anchor_comment_id: commentId,
      parent_issue_id: issue.id,
      parent_issue_identifier: issue.identifier,
      ...(issue.project_id ? { project_id: issue.project_id } : {}),
      ...(issue.assignee_type && issue.assignee_id
        ? { assignee_type: issue.assignee_type, assignee_id: issue.assignee_id }
        : {}),
    });
  }, [issue, openModal]);

  // Record recent visit
  const recordVisit = useRecentIssuesStore((s) => s.recordVisit);
  const recordRecentContext = useRecentContextStore((s) => s.recordVisit);
  useEffect(() => {
    if (issue) {
      recordVisit(wsId, issue.id);
      recordRecentContext(wsId, {
        type: "issue",
        id: issue.id,
        label: issue.identifier,
        subtitle: issue.title,
        status: issue.status,
      });
    }
  }, [issue?.id, wsId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fire `onDelete` once when the issue transitions from loaded to missing.
  // Delete goes through a shell-level modal, so the caller (e.g. inbox) can't
  // be notified directly — instead, the detail page observes its own cache
  // clearing and runs the callback. We navigate via `onDeletedFallbackPath` on
  // the actions menu when no callback is supplied (standalone routes).
  const hadIssueRef = useRef(false);
  const firedDeleteCallbackRef = useRef(false);
  useEffect(() => {
    if (issue) {
      hadIssueRef.current = true;
      firedDeleteCallbackRef.current = false;
      return;
    }
    if (
      hadIssueRef.current &&
      !issueLoading &&
      !firedDeleteCallbackRef.current &&
      onDelete
    ) {
      firedDeleteCallbackRef.current = true;
      onDelete();
    }
  }, [issue, issueLoading, onDelete]);

  // Custom hooks — encapsulate timeline, reactions, subscribers
  const {
    timeline, loading: timelineLoading,
    submitComment, submitReply,
    editComment, deleteComment, toggleResolveComment, toggleReaction: handleToggleReaction,
  } = useIssueTimeline(id, user?.id);

  // Resolve / unresolve must always clear the per-session expand entry so
  // re-resolving an already-expanded thread folds it back to the bar (the
  // expand Set is keyed only on commentId, not on resolution state). Without
  // this wrapper, an expand → unresolve → resolve sequence keeps the thread
  // visually expanded after the second resolve.
  const handleResolveToggle = useCallback(
    (commentId: string, resolved: boolean) => {
      // Fold the thread back on any resolve change: clear the thread ROOT's
      // expand entry (expand state is keyed on root id, but a resolve target
      // can be a reply). Walk parent_id up to the root.
      const byId = new Map(timeline.map((e) => [e.id, e]));
      let cur = byId.get(commentId);
      while (cur?.parent_id && byId.get(cur.parent_id)) cur = byId.get(cur.parent_id)!;
      clearResolvedExpand(cur?.id ?? commentId);
      toggleResolveComment(commentId, resolved);
    },
    [timeline, clearResolvedExpand, toggleResolveComment],
  );

  // Memoized timeline grouping. Each render rebuilds the per-parent map from
  // the latest timeline, then pre-flattens each thread's reply subtree into a
  // dedicated `threadReplies` slice per root. Slices are stabilized against
  // the previous render via `prevThreadRepliesRef`: if a thread's flat list
  // is shallow-equal to the previous one, we reuse the previous array so
  // React.memo on CommentCard / ResolvedThreadBar can short-circuit. Without
  // this, every WS event (including reactions, edits, AI streaming on an
  // unrelated thread) hands every card a brand-new prop reference and forces
  // every thread subtree to re-render in lockstep.
  const prevThreadRepliesRef = useRef<Map<string, TimelineEntry[]>>(new Map());
  const timelineView = useMemo(() => {
    // Group entries: top-level = activities + root comments; replies are
    // bucketed under their parent's id and rendered nested inside CommentCard.
    // No orphan rescue needed: the timeline is fetched in full, so every
    // reply's parent is always in the same array.
    const topLevel = timeline.filter(
      (e) => e.type === "activity" || !e.parent_id,
    );
    const repliesByParent = new Map<string, TimelineEntry[]>();
    for (const e of timeline) {
      if (e.type === "comment" && e.parent_id) {
        const list = repliesByParent.get(e.parent_id) ?? [];
        list.push(e);
        repliesByParent.set(e.parent_id, list);
      }
    }

    // Pre-flatten each top-level comment's thread subtree (parent + every
    // descendant in render order). Reuse the previous array reference when
    // the thread is unchanged so unrelated CommentCards keep their memo.
    const prevThreadReplies = prevThreadRepliesRef.current;
    const threadReplies = new Map<string, TimelineEntry[]>();
    for (const root of topLevel) {
      if (root.type !== "comment") continue;
      const fresh = collectThreadReplies(root.id, repliesByParent);
      const previous = prevThreadReplies.get(root.id);
      threadReplies.set(
        root.id,
        previous && shallowEqualEntries(previous, fresh) ? previous : fresh,
      );
    }
    prevThreadRepliesRef.current = threadReplies;

    // Coalesce consecutive activities from the same actor + action.
    // - task_completed / task_failed: no time limit (these repeat across runs)
    // - all other actions: within a 2-minute window
    // - squad_leader_evaluated: never coalesce; outcome/reason are audit data
    const COALESCE_MS = 2 * 60 * 1000;
    const NO_TIME_LIMIT_ACTIONS = new Set(["task_completed", "task_failed"]);
    const NEVER_COALESCE_ACTIONS = new Set(["squad_leader_evaluated"]);
    const coalesced: TimelineEntry[] = [];
    for (const entry of topLevel) {
      if (entry.type === "activity") {
        const prev = coalesced[coalesced.length - 1];
        if (
          !NEVER_COALESCE_ACTIONS.has(entry.action!) &&
          prev?.type === "activity" &&
          prev.action === entry.action &&
          prev.actor_type === entry.actor_type &&
          prev.actor_id === entry.actor_id &&
          (NO_TIME_LIMIT_ACTIONS.has(entry.action!) ||
            Math.abs(new Date(entry.created_at).getTime() - new Date(prev.created_at).getTime()) <= COALESCE_MS)
        ) {
          coalesced[coalesced.length - 1] = { ...entry, coalesced_count: (prev.coalesced_count ?? 1) + 1 };
          continue;
        }
      }
      coalesced.push(entry);
    }

    // Group consecutive activities together so the connector line works
    const groups: { type: "activities" | "comment"; entries: TimelineEntry[] }[] = [];
    for (const entry of coalesced) {
      if (entry.type === "activity") {
        const last = groups[groups.length - 1];
        if (last?.type === "activities") {
          last.entries.push(entry);
        } else {
          groups.push({ type: "activities", entries: [entry] });
        }
      } else {
        groups.push({ type: "comment", entries: [entry] });
      }
    }

    return { threadReplies, groups };
  }, [timeline]);

  // Flat array consumed by <Virtuoso>. Recomputed when timelineView.groups
  // changes (timeline events) or expandedResolved flips (user toggles a
  // resolved thread). Kept in a useMemo so Virtuoso's data identity is stable
  // across unrelated re-renders.
  const items = useMemo<TimelineItem[]>(
    () => flattenGroups(timelineView.groups, expandedResolved),
    [timelineView.groups, expandedResolved],
  );

  // The stream's display list: server entries plus the synthetic inserts the
  // chain contributes (published handoff packages; later, locked leg blocks).
  // The merge walks both chronologically; `items` itself stays untouched so
  // find-search and the length-keyed effects keep counting server entries.
  // How many runs the relay has taken across every leg — the meta row's one
  // number. Read from the same snapshot the run states read from.
  const relayRunsCount = useMemo(
    () =>
      chain
        ? chain.steps.reduce(
            (sum, step) => sum + legRunTasks(id, step, relayTasks).length,
            0,
          )
        : 0,
    [chain, id, relayTasks],
  );

  // One leg's conversation is exactly its own scoped entries; the parent's
  // stream keeps everything else (room comments and system activity). This is
  // the point of the split — no more "who is talking to whom" in one feed.
  const legItems = useMemo(
    () =>
      openLegStep
        ? items.filter(
            (it) =>
              (it.kind === "comment" || it.kind === "resolved-bar") &&
              it.entry.chain_step_id === openLegStep.id,
          )
        : [],
    [items, openLegStep],
  );
  const parentItems = useMemo(
    () =>
      items.filter((it) =>
        it.kind === "activity-group" ? true : !it.entry.chain_step_id,
      ),
    [items],
  );

  // The discussion's display list for a solo task: comments plus human
  // activity. Agent bookkeeping (status flips an agent made, run completion)
  // belongs to Execution and audit, not the conversation. A group that
  // contains any of those agent actions is dropped whole; human status/date
  // changes still render. Room pages keep their full stream.
  const discussionItems = useMemo(
    () => {
      if (isRoom) return items;
      const hiddenAgentActions = new Set([
        "status_changed",
        "task_completed",
        "task_failed",
        "task_cancelled",
      ]);
      return items.filter((it) => {
        if (it.kind === "comment" || it.kind === "resolved-bar") return true;
        if (it.kind === "activity-group") {
          return !it.entries.some(
            (entry) =>
              entry.actor_type === "agent" &&
              !!entry.action &&
              hiddenAgentActions.has(entry.action),
          );
        }
        return false;
      });
    },
    [items, isRoom],
  );

  // In-page find (Cmd/Ctrl+F). `items.length` is the content signal that
  // triggers a match recompute when comments are added/removed; text edits
  // are caught by the hook's own MutationObserver. Opening find forces the
  // timeline to render flat below so every comment is in the DOM to match.
  const find = useInPageFind({
    container: scrollContainerEl,
    contentKey: discussionItems.length,
    enabled: !!issue,
  });
  // Close the bar (and drop highlights) when navigating to another issue —
  // the web route reuses this component instead of remounting.
  const closeFind = find.closeFind;
  useEffect(() => {
    closeFind();
  }, [id, closeFind]);

  // ID of the trailing activity block — the only one expanded by default.
  const lastActivityGroupId = useMemo(() => {
    for (let i = timelineView.groups.length - 1; i >= 0; i--) {
      const g = timelineView.groups[i]!;
      if (g.type === "activities") return g.entries[0]!.id;
    }
    return null;
  }, [timelineView.groups]);

  // Map of reply-comment id → root-comment id, so a deep-link to a reply
  // (which lives inside a CommentCard, not in the flat items array) can fall
  // back to scrolling the root thread into view. Without this, an inbox
  // notification on a reply would land at items[-1] and short-circuit.
  const replyToRoot = useMemo(() => {
    const map = new Map<string, string>();
    for (const [rootId, replies] of timelineView.threadReplies) {
      for (const reply of replies) {
        map.set(reply.id, rootId);
      }
    }
    return map;
  }, [timelineView.threadReplies]);

  // Deep-link target index in the flat items array. For root comments this is
  // a direct findIndex hit; for reply ids we look up the enclosing root.
  const targetIdx = useMemo(() => {
    if (!highlightCommentId) return -1;
    const direct = discussionItems.findIndex((it) => it.id === highlightCommentId);
    if (direct >= 0) return direct;
    const rootId = replyToRoot.get(highlightCommentId);
    if (!rootId) return -1;
    return discussionItems.findIndex((it) => it.id === rootId);
  }, [discussionItems, highlightCommentId, replyToRoot]);

  // One entry per comment thread (folded resolved bars included), activity
  // groups skipped. Derived from the same flat `items` array Virtuoso renders
  // so the order always matches the page. Feeds both thread navigators — the
  // right-edge rail and the header panel — from one derivation, so they can
  // never disagree about what the threads are or what order they are in.
  //
  // The resolved flag comes from `deriveThreadResolution`, not from the
  // `resolved-bar` kind: that kind only covers root resolutions that are
  // currently folded, so it would miss reply resolutions and would flip off
  // as soon as the user expanded a resolved thread.
  const minimapThreads = useMemo<ThreadNavThread[]>(
    () =>
      items.flatMap((it) => {
        if (it.kind !== "comment" && it.kind !== "resolved-bar") return [];
        const replies = timelineView.threadReplies.get(it.id) ?? EMPTY_REPLIES;
        const currentUserId = user?.id ?? "";
        // "@me" means the thread concerns this reader: they started it,
        // answered in it, or were @mentioned anywhere in it. Authorship counts
        // because a thread you spoke in is one you are expected to follow —
        // narrowing to literal mentions would drop most of them.
        const involvesMe =
          currentUserId !== "" &&
          ([it.entry, ...replies].some(
            (entry) =>
              (entry.actor_type === "member" && entry.actor_id === currentUserId) ||
              mentionsUser(entry.content, currentUserId),
          ));
        return [
          {
            id: it.id,
            entry: it.entry,
            resolved: deriveThreadResolution(it.entry, replies).kind !== "none",
            replyCount: replies.length,
            involvesMe,
          },
        ];
      }),
    [items, timelineView.threadReplies, user?.id],
  );

  // When the timeline renders flat (deep-link or in-page find), there is no
  // Virtuoso instance — minimap jumps drive the scroll container directly.
  const isFlatTimeline = !!highlightCommentId || find.open;
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  // Scroll a freshly posted comment into view, aligned so its bottom sits just
  // above the sticky composer (never behind it). A reply lives inside its root
  // CommentCard, so the containing top-level row is the scroll target. Flat and
  // virtualized timelines need separate scroll drivers, so they split into two
  // effects below — kept apart because only the flat one depends on
  // `scrollContainerEl`, and adding that dep to the virtualized effect would
  // let a container re-measure cancel its in-flight scroll mid-flight.

  // Virtualized mode: Virtuoso owns the scroll. The first jump materializes the
  // row at its estimated height; once measured, the repeat aligns using the
  // real height. The extra `offset` lifts the row's bottom clear of the sticky
  // composer.
  useEffect(() => {
    if (!pendingPostedCommentId || isFlatTimeline) return;
    const rootId = replyToRoot.get(pendingPostedCommentId) ?? pendingPostedCommentId;
    const index = discussionItems.findIndex((item) => item.id === rootId);
    if (index < 0) return;
    let timer: number | undefined;
    const scrollEnd = () => {
      const composerHeight = composerRef.current?.getBoundingClientRect().height ?? 0;
      virtuosoRef.current?.scrollToIndex({ index, align: "end", offset: composerHeight });
    };
    const frame = requestAnimationFrame(() => {
      scrollEnd();
      timer = window.setTimeout(() => {
        scrollEnd();
        setPendingPostedCommentId(null);
      }, 100);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [pendingPostedCommentId, discussionItems, replyToRoot, isFlatTimeline]);

  // Flat mode (find bar / deep link) has no Virtuoso, so drive scrollTop by
  // hand: align the row's bottom to the composer's top edge. The comment's
  // async layout (markdown, code highlight, images) keeps shifting its height,
  // so re-align each frame until it settles (within 1px) or ~0.5s elapses — the
  // same rAF stabilization the deep-link landing uses.
  useEffect(() => {
    if (!pendingPostedCommentId || !isFlatTimeline) return;
    const rootId = replyToRoot.get(pendingPostedCommentId) ?? pendingPostedCommentId;
    if (discussionItems.findIndex((item) => item.id === rootId) < 0) return;
    let rafId = 0;
    let frames = 0;
    let last = -1;
    const alignBottom = () => {
      const el = document.getElementById(`comment-${rootId}`);
      const container = scrollContainerEl;
      if (el && container) {
        const c = container.getBoundingClientRect();
        const e = el.getBoundingClientRect();
        const composerHeight = composerRef.current?.getBoundingClientRect().height ?? 0;
        const target = Math.max(0, container.scrollTop + (e.bottom - c.bottom) + composerHeight);
        container.scrollTop = target;
        if (Math.abs(target - last) > 1 && ++frames < 30) {
          last = target;
          rafId = requestAnimationFrame(alignBottom);
          return;
        }
      }
      setPendingPostedCommentId(null);
    };
    rafId = requestAnimationFrame(alignBottom);
    return () => cancelAnimationFrame(rafId);
  }, [pendingPostedCommentId, discussionItems, replyToRoot, isFlatTimeline, scrollContainerEl]);
  const jumpFlashTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (jumpFlashTimerRef.current !== null) window.clearTimeout(jumpFlashTimerRef.current);
    },
    [],
  );
  const jumpToThread = useCallback(
    (threadId: string) => {
      if (isFlatTimeline) {
        // Flat mode mounts every row, so the anchor is always in the DOM.
        // Drive the container's scrollTop directly — never native
        // scrollIntoView, which also scrolls the desktop shell (#3929).
        const el = document.getElementById(`comment-${threadId}`);
        const container = scrollContainerEl;
        if (!el || !container) return;
        const c = container.getBoundingClientRect();
        const e = el.getBoundingClientRect();
        container.scrollTop = Math.max(0, container.scrollTop + (e.top - c.top) - 16);
      } else {
        // Virtualized mode: the target row may not be mounted, so scroll by
        // index and let Virtuoso mount it. Offset leaves a small top gap.
        const index = discussionItems.findIndex((it) => it.id === threadId);
        if (index < 0) return;
        virtuosoRef.current?.scrollToIndex({ index, align: "start", offset: -16 });
      }
      // Flash the landed thread the same way inbox deep-links do, so the eye
      // has an anchor after the instant jump. (Folded resolved bars don't
      // take the highlight prop — the scroll itself is the feedback there.)
      setHighlightedId(threadId);
      if (jumpFlashTimerRef.current !== null) window.clearTimeout(jumpFlashTimerRef.current);
      jumpFlashTimerRef.current = window.setTimeout(() => setHighlightedId(null), 2000);
    },
    [isFlatTimeline, discussionItems, scrollContainerEl],
  );

  // Header thread navigator. `open` and `pinned` live here rather than inside
  // the panel because the global shortcut has to be able to open it already
  // pinned, and because the rail needs `threadNavHoverId` to light the tick
  // the panel's pointer is resting on — the two navigators share one
  // coordinate system (MUL-5755).
  const [threadNavOpen, setThreadNavOpen] = useState(false);
  const [threadNavPinned, setThreadNavPinned] = useState(false);
  const [threadNavHoverId, setThreadNavHoverId] = useState<string | null>(null);
  const handleThreadNavOpenChange = useCallback((open: boolean, pinned: boolean) => {
    setThreadNavOpen(open);
    setThreadNavPinned(pinned);
    if (!open) setThreadNavHoverId(null);
  }, []);

  // Global Mod+Shift+O. Scoped to the mounted issue detail and gated on
  // visibility the same way Cmd+F is, so on desktop only the visible tab
  // intercepts the key.
  useEffect(() => {
    if (minimapThreads.length === 0) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || isImeComposing(e)) return;
      if (!shortcutMatchesEvent(getShortcut("openThreadNav"), e)) return;
      if (!scrollContainerEl || scrollContainerEl.getClientRects().length === 0) return;
      e.preventDefault();
      // The shortcut is a deliberate act, so it opens the pinned state
      // directly. Pressing it again over a hover preview pins that preview
      // rather than closing it, matching what pressing the button does.
      if (threadNavOpen && threadNavPinned) {
        handleThreadNavOpenChange(false, false);
      } else {
        handleThreadNavOpenChange(true, true);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    handleThreadNavOpenChange,
    minimapThreads.length,
    scrollContainerEl,
    threadNavOpen,
    threadNavPinned,
  ]);

  const {
    reactions: issueReactions,
    toggleReaction: handleToggleIssueReaction,
  } = useIssueReactions(id, user?.id);

  const {
    subscribers, isSubscribed, subscriptionReason, subscriptionKnown,
    togglePending, subtreePending,
    toggleSubscribe: handleToggleSubscribe, toggleSubscriber,
    unsubscribeFromSubtree: handleUnsubscribeSubtree,
  } = useIssueSubscribers(id, user?.id);

  // Attachments uploaded against this issue. Drives the description
  // editor's click-time fresh-sign download: NodeViews match
  // `src`/`href` against this list to resolve an attachment id before
  // calling `/api/attachments/{id}`.
  const { data: issueAttachments } = useQuery(issueAttachmentsOptions(id));

  // Handoff files reference attachments by id; the page owns the list, so one
  // map resolves each package chip (and each log row's file chip) to its
  // record — which is what makes view / edit / download real buttons.
  const attachmentById = useMemo(
    () => new Map((issueAttachments ?? []).map((a) => [a.id, a])),
    [issueAttachments],
  );
  const attachmentOf = useCallback(
    (attachmentId: string) => attachmentById.get(attachmentId),
    [attachmentById],
  );

  // --- Handoff collection (审核 = 交接单) ---
  // While the reader's leg waits on review, its candidates are gathered
  // automatically: everything attached to the task during the leg's window,
  // plus the branches this leg's runs delivered on. The holder curates the
  // selection; the approve button publishes it.
  const reviewingStep = relayView?.reviewingStep ?? null;
  // The leg's generated output (产出 md) — see startLegOutput below; rides
  // with the collected candidates.
  const [outputCandidates, setOutputCandidates] = useState<HandoffCandidate[]>([]);
  const handoffCandidates = useMemo<HandoffCandidate[]>(() => {
    if (!reviewingStep || !relayView?.canApprove) return [];
    const from = reviewingStep.started_at
      ? new Date(reviewingStep.started_at).getTime()
      : 0;
    const out: HandoffCandidate[] = [];
    for (const att of issueAttachments ?? []) {
      const at = att.created_at ? new Date(att.created_at).getTime() : 0;
      if (at < from) continue;
      out.push({
        id: `att:${att.id}`,
        name: att.filename,
        size: att.size_bytes,
        kind: "attachment",
        attachment_id: att.id,
      });
    }
    for (const task of relayTasks) {
      if (task.issue_id !== id || !task.branch_name) continue;
      if (reviewingStep.agent_id && task.agent_id !== reviewingStep.agent_id) {
        continue;
      }
      const at = task.created_at ? new Date(task.created_at).getTime() : 0;
      if (at < from) continue;
      out.push({
        id: `branch:${task.id}`,
        name: task.branch_name,
        kind: "branch",
      });
    }
    // Deduped: the auto-scan above may already have collected the same file
    // once the generated output's upload lands on the issue.
    for (const candidate of outputCandidates) {
      if (!out.some((existing) => existing.id === candidate.id)) {
        out.push(candidate);
      }
    }
    return out;
  }, [reviewingStep, relayView?.canApprove, issueAttachments, relayTasks, id, outputCandidates]);
  const [handoffPicked, setHandoffPicked] = useState<Set<string>>(
    () => new Set(),
  );
  const [handoffSummary, setHandoffSummary] = useState("");
  // The output (产出 md) flow: the holder asks their leg's agent to summarize
  // this leg into the handoff document. `outputAsked` marks that the ask ran,
  // so an approve click with an empty summary asks exactly once.
  const generateLegOutput = useGenerateChainLegOutput(id);
  const { uploadWithToast: uploadLegOutputFile } = useFileUpload(api);
  const [outputProducing, setOutputProducing] = useState(false);
  const [outputAsked, setOutputAsked] = useState(false);
  const [outputBaselineId, setOutputBaselineId] = useState<string | null>(null);
  // Raise-once bookkeeping. A ref, not state: the lift effect re-runs on every
  // timeline refetch, and a single-slot state guard let the previous comment
  // and a newer one take turns re-lifting each other.
  const outputLiftedRef = useRef<Set<string>>(new Set());
  // Whether the current summary text came from a lift (safe to replace on a
  // regenerate) rather than from the holder's own typing (never replaced).
  const [outputSummaryFromLift, setOutputSummaryFromLift] = useState(false);
  const reviewingStepId = reviewingStep?.id ?? null;
  // A new review round starts with nothing ticked and no summary…
  useEffect(() => {
    setHandoffPicked(new Set());
    setHandoffSummary("");
    setOutputProducing(false);
    setOutputAsked(false);
    setOutputBaselineId(null);
    outputLiftedRef.current = new Set();
    setOutputSummaryFromLift(false);
    setOutputCandidates([]);
  }, [reviewingStepId]);
  // …then everything the collector found arrives already ticked ("自动收集").
  // Only additions: a file the holder un-ticked is not re-ticked by the next
  // refetch, but a candidate that lands mid-review still joins the package.
  useEffect(() => {
    if (handoffCandidates.length === 0) return;
    setHandoffPicked((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const candidate of handoffCandidates) {
        if (!next.has(candidate.id)) {
          next.add(candidate.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [handoffCandidates]);
  const handoffDraft = useMemo<HandoffDraft | undefined>(() => {
    if (!relayView?.canApprove) return undefined;
    return {
      candidates: handoffCandidates,
      picked: handoffPicked,
      onToggle: (candidateId: string) =>
        setHandoffPicked((prev) => {
          const next = new Set(prev);
          if (next.has(candidateId)) next.delete(candidateId);
          else next.add(candidateId);
          return next;
        }),
      summary: handoffSummary,
      onSummaryChange: setHandoffSummary,
    };
  }, [relayView?.canApprove, handoffCandidates, handoffPicked, handoffSummary]);
  const approveWithHandoff = () =>
    approveChainStep.mutate(
      {
        summary: handoffSummary.trim(),
        files: handoffCandidates
          .filter((candidate) => handoffPicked.has(candidate.id))
          .map((candidate) => ({
            name: candidate.name,
            size: candidate.size,
            kind: candidate.kind,
            attachment_id: candidate.attachment_id,
          })),
      },
      { onError: () => toast.error(t(($) => $.room.approve_failed)) },
    );

  // The leg's output: one summary per finished leg, written by the leg's own
  // agent — not one document per question. The ask queues a run; the document
  // arrives as the run's comment in this leg, and this handler lifts it into
  // the handoff summary and carries it as a .md file, so the delivered output
  // previews/edits/downloads like every other handoff file.
  const startLegOutput = () => {
    if (outputProducing || !relayView?.canApprove) return;
    // Baseline: the leg's latest agent comment BEFORE the ask. Anything after
    // it in the leg is the output — clock-skew-proof where a timestamp
    // compare is not.
    const latest = [...timeline]
      .reverse()
      .find(
        (entry) =>
          entry.actor_type === "agent" &&
          (!reviewingStep || entry.chain_step_id === reviewingStep.id),
      );
    setOutputBaselineId(latest?.id ?? "");
    // A regenerate replaces our own earlier lift — never the holder's words.
    if (outputSummaryFromLift) {
      setHandoffSummary("");
      setOutputSummaryFromLift(false);
    }
    setOutputAsked(true);
    setOutputProducing(true);
    generateLegOutput.mutate(undefined, {
      onError: (err) => {
        setOutputProducing(false);
        const message = err instanceof Error ? err.message : "";
        toast.error(
          /already running/i.test(message)
            ? t(($) => $.room.output_agent_busy)
            : t(($) => $.room.output_failed),
        );
      },
    });
  };
  // Keyed on the ASK, not on the producing flag: a real run can outlast any
  // progress timer, and a late-landing document must still be lifted. The
  // holder's own words always win over an auto-fill.
  useEffect(() => {
    if (!outputAsked) return;
    // The document is the FIRST agent comment AFTER the pre-ask baseline —
    // see selectProducedLegComment for why scanning the whole timeline is
    // the wrong shape.
    const produced = selectProducedLegComment(
      timeline,
      outputBaselineId,
      reviewingStep?.id ?? null,
    );
    if (!produced?.content) return;
    if (outputLiftedRef.current.has(produced.id)) return;
    outputLiftedRef.current.add(produced.id);
    setOutputProducing(false);
    const markdown = produced.content;
    setHandoffSummary((prev) => (prev.trim() === "" ? markdown : prev));
    setOutputSummaryFromLift(true);
    const seq = (reviewingStep?.position ?? 0) + 1;
    void (async () => {
      const uploaded = await uploadLegOutputFile(
        new File(
          [markdown],
          t(($) => $.room.output_file_name, { seq }),
          { type: "text/markdown" },
        ),
        { issueId: id },
      );
      // The summary above still carries the document; the file is what makes
      // it renderable/editable/downloadable downstream, so a failed upload
      // only costs the attachment, never the text.
      if (!uploaded) return;
      setOutputCandidates((prev) =>
        prev.some((candidate) => candidate.attachment_id === uploaded.id)
          ? prev
          : [
              ...prev,
              {
                id: `att:${uploaded.id}`,
                name: uploaded.filename,
                size: uploaded.size_bytes,
                kind: "attachment",
                attachment_id: uploaded.id,
              },
            ],
      );
    })();
  }, [outputAsked, outputBaselineId, timeline, reviewingStep, id, uploadLegOutputFile, t]);
  // A run that never reports back must not leave the button frozen. Generous
  // on purpose — real legs run for minutes, and the late-lift above still
  // catches a document that lands after this fires.
  useEffect(() => {
    if (!outputProducing) return;
    const timer = setTimeout(() => {
      setOutputProducing(false);
      toast.error(t(($) => $.room.output_timeout));
    }, 15 * 60_000);
    return () => clearTimeout(timer);
  }, [outputProducing, t]);

  // Sub-issue queries
  const parentIssueId = issue?.parent_issue_id;
  const { data: parentIssue = null } = useQuery({
    ...issueDetailOptions(wsId, parentIssueId ?? ""),
    enabled: !!parentIssueId,
    initialData: () => allIssues.find((i) => i.id === parentIssueId),
  });

  // Project segment in the breadcrumb. The issue's project_id is the source of
  // truth — same URL renders the same breadcrumb regardless of entry path.
  const issueProjectId = issue?.project_id;
  const { data: breadcrumbProject = null } = useQuery({
    ...projectDetailOptions(wsId, issueProjectId ?? ""),
    enabled: !!issueProjectId,
  });
  const {
    data: childIssues = [],
    isSuccess: childIssuesLoaded,
    isFetching: childIssuesFetching,
  } = useQuery({
    ...childIssuesOptions(wsId, id),
    enabled: !!issue,
  });
  // Whether this issue has sub-issues, as opposed to "we have not looked yet".
  // childIssuesOptions sets refetchOnMount: "always", so a cached snapshot is
  // re-fetched on every mount and isSuccess alone still describes the previous
  // visit. The unsubscribe control below picks a different server write from
  // this answer, so a defaulted or stale empty array must not count as "no
  // sub-issues" (MUL-5714).
  const childCountKnown = childIssuesLoaded && !childIssuesFetching;
  // Parent's children — used to render the "x/y" progress next to the
  // "Sub-issue of …" breadcrumb under the title.
  const { data: parentChildIssues = [] } = useQuery({
    ...childIssuesOptions(wsId, parentIssueId ?? ""),
    enabled: !!parentIssueId,
  });
  // Workspace-wide parent→(done/total) map; lets each sub-issue row show its
  // OWN nested progress ring without opening it. Same query the list
  // surfaces use, so it's usually already cached.
  const { data: subIssueProgress } = useQuery({
    ...childIssueProgressOptions(wsId),
    enabled: childIssues.length > 0,
  });
  // User-level display preference for sub-issue rows (built-in field toggles
  // + opted-in workspace custom properties). `subIssueCustomProps` resolves
  // the persisted ids against this workspace's live, non-archived property
  // definitions — ids from other workspaces or archived properties drop out.
  const subIssueRowProps = useSubIssueDisplayStore((s) => s.rowProperties);
  const subIssueRowPropertyIds = useSubIssueDisplayStore((s) => s.rowPropertyIds);
  // Store-backed (not useState) so the collapsed state survives leaving the
  // issue and navigating back within the session.
  const subIssuesCollapsed = useSubIssuesCollapseStore((s) =>
    s.collapsedIssueIds.has(issueId),
  );
  const setSubIssuesCollapsedFor = useSubIssuesCollapseStore(
    (s) => s.setCollapsed,
  );
  const setSubIssuesCollapsed = useCallback(
    (update: boolean | ((prev: boolean) => boolean)) => {
      const prev = useSubIssuesCollapseStore
        .getState()
        .collapsedIssueIds.has(issueId);
      setSubIssuesCollapsedFor(
        issueId,
        typeof update === "function" ? update(prev) : update,
      );
    },
    [issueId, setSubIssuesCollapsedFor],
  );

  // Selection store is global (workspace-scoped); clear it whenever this
  // issue detail is mounted or switched, so leftover selections from the
  // main list view (or another sub-issue list) don't leak into this one.
  const clearSelection = useIssueSelectionStore((s) => s.clear);
  const selectedIds = useIssueSelectionStore((s) => s.selectedIds);
  const selectIds = useIssueSelectionStore((s) => s.select);
  const deselectIds = useIssueSelectionStore((s) => s.deselect);
  useEffect(() => {
    clearSelection();
    return clearSelection;
  }, [id, clearSelection]);

  const childIssueIds = useMemo(() => childIssues.map((c) => c.id), [childIssues]);
  const childSelectedCount = childIssueIds.filter((cid) =>
    selectedIds.has(cid),
  ).length;
  const allChildrenSelected =
    childIssueIds.length > 0 && childSelectedCount === childIssueIds.length;
  const someChildrenSelected = childSelectedCount > 0;
  const handleToggleSelectAllChildren = useCallback(() => {
    if (allChildrenSelected) deselectIds(childIssueIds);
    else selectIds(childIssueIds);
  }, [allChildrenSelected, childIssueIds, deselectIds, selectIds]);

  const loading = issueLoading;

  // Deep-link landing. Semantically equivalent to navigating to
  // `#comment-${id}`: find the element with that id, scrollIntoView it.
  // When `highlightCommentId` is set the timeline below renders flat (no
  // virtualization), so every comment id is in the DOM by the time this
  // effect runs after commit.
  //
  // For a reply inside a folded resolved thread, the reply is not in items
  // (only the resolved-bar root is). Auto-expand the thread first; the
  // effect re-runs once items re-flatten.
  //
  // `scrollContainerEl` is in deps because the component early-returns a
  // loading skeleton while the issue query is pending. The scroll-container
  // ref populates only on the post-loading render, so it's the signal that
  // the timeline (and the deep-link target id) has actually rendered.
  useEffect(() => {
    if (!highlightCommentId || discussionItems.length === 0) return;
    // An explicit replay request (re-click on the already-open notification
    // row): the host cleared the memento entry and bumped the token, so
    // re-arm the landing guard and fall through to the jump.
    if (lastHighlightRequestTokenRef.current !== highlightRequestToken) {
      lastHighlightRequestTokenRef.current = highlightRequestToken;
      didHighlightRef.current = null;
    }
    if (didHighlightRef.current === highlightCommentId) return;
    // The deep link already landed before this mount (memento entry — a tab
    // switch back or an in-tab return). The restored scroll offset is the
    // state the user left, and the jump must not fight it. A fresh selection
    // clears the entry, so this only ever suppresses a *repeat* landing.
    if (consumedHighlightRef.current === highlightCommentId) {
      didHighlightRef.current = highlightCommentId;
      return;
    }

    const rootId = replyToRoot.get(highlightCommentId);
    if (rootId && rootId !== highlightCommentId) {
      // Root resolved → the whole thread is a folded bar.
      if (discussionItems[targetIdx]?.kind === "resolved-bar") {
        toggleResolvedExpand(rootId, true);
        return;
      }
      // A reply is the resolution → the other replies fold behind the
      // "N comments" bar; expand if the target is one of those folded replies.
      const rootItem = discussionItems[targetIdx];
      if (rootItem?.kind === "comment" && !expandedResolved.has(rootId)) {
        const resolution = deriveThreadResolution(
          rootItem.entry,
          timelineView.threadReplies.get(rootId) ?? EMPTY_REPLIES,
        );
        if (resolution.kind === "reply" && resolution.resolutionId !== highlightCommentId) {
          toggleResolvedExpand(rootId, true);
          return;
        }
      }
    }

    const el = document.getElementById(`comment-${highlightCommentId}`);
    const container = scrollContainerEl;
    if (!el || !container) return;

    didHighlightRef.current = highlightCommentId;
    // Record the landing in the memento so a remount that merely restores
    // this view (tab switch back) skips the jump instead of replaying it
    // over the restored scroll position.
    writeViewState(issueHighlightMementoKey(id), highlightCommentId);

    // Center the target comment WITHIN its own scroll container by driving the
    // container's scrollTop directly — never native scrollIntoView. Native
    // scrollIntoView is spec'd to scroll EVERY scrollable ancestor: on a cold
    // mount where the timeline is still growing (streaming agent), the inner
    // scroller can't satisfy centering on its own, so the scroll propagates up
    // and moves the desktop shell's `overflow:hidden` wrapper — shoving the
    // whole page, header included, off the top with no scrollbar to recover,
    // until a resize reflows it (#3929). Scoping the scroll to `container`
    // keeps it contained; re-centering across frames lands the comment
    // precisely once async heights (markdown, code highlight, streamed replies)
    // settle, instead of leaning on the ancestor scroll the way native did.
    let rafId = 0;
    let frames = 0;
    let last = -1;
    const center = () => {
      const c = container.getBoundingClientRect();
      const e = el.getBoundingClientRect();
      const target = Math.max(
        0,
        container.scrollTop + (e.top - c.top) - (container.clientHeight - e.height) / 2,
      );
      container.scrollTop = target;
      // Content is still laying out → the centered offset keeps shifting; keep
      // re-centering until it stabilizes (within 1px) or we hit ~0.5s of frames.
      if (Math.abs(target - last) > 1 && ++frames < 30) {
        last = target;
        rafId = requestAnimationFrame(center);
      }
    };
    rafId = requestAnimationFrame(center);

    setHighlightedId(highlightCommentId);
    const fade = window.setTimeout(() => setHighlightedId(null), 2500);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(fade);
    };
  }, [highlightCommentId, highlightRequestToken, id, writeViewState, discussionItems, targetIdx, scrollContainerEl, replyToRoot, expandedResolved, timelineView, toggleResolvedExpand]);

  const descEditorRef = useRef<ContentEditorRef>(null);
  const descriptionEditingRef = useRef(false);
  const [descriptionConflictDraft, setDescriptionConflictDraft] = useState<string | null>(null);
  const descriptionAttachmentIdsRef = useRef<string[]>([]);
  const descriptionSaveInFlightRef = useRef(false);
  const descriptionSaveIssueIdRef = useRef(id);
  const pendingDescriptionSaveRef = useRef<{
    markdown: string;
    baseMarkdown: string;
    attachmentIds: string[];
  } | null>(null);
  // Keep the description editor mounted from the start. Unlike the empty
  // composer shells, a long rendered description cannot swap between
  // react-markdown and ProseMirror without small per-block height differences
  // accumulating into a visible scroll/layout jump. The chunked Markdown path
  // keeps this single eager editor affordable; title and composers stay lazy.
  const titleEditorRef = useRef<TitleEditorRef>(null);
  const titleBaseRef = useRef<string | undefined>(issue?.title);
  const [titleConflictDraft, setTitleConflictDraft] = useState<string | null>(null);
  // Bumped when a conflicting title draft is discarded. TitleEditor reads its
  // text from `defaultValue` at mount and exposes no imperative setter, so
  // remounting is the only way to put the server's title back in the editor.
  const [titleResetToken, setTitleResetToken] = useState(0);
  const [soloBriefCollapsed, setSoloBriefCollapsed] = useState(false);
  useEffect(() => {
    setTitleConflictDraft(null);
    setDescriptionConflictDraft(null);
    titleBaseRef.current = undefined;
    descriptionAttachmentIdsRef.current = [];
    descriptionSaveInFlightRef.current = false;
    descriptionSaveIssueIdRef.current = id;
    pendingDescriptionSaveRef.current = null;
  }, [id]);
  const titleLazy = useLazyEditor({ editorRef: titleEditorRef, resetKey: id });
  const { isDragOver: descDragOver, dropZoneProps: descDropZoneProps } = useFileDropZone({
    onDrop: (files) => files.forEach((file) => descEditorRef.current?.uploadFile(file)),
  });
  // Pending uploads in the description editor. We don't pass `issueId` on
  // upload (to avoid orphaning attachments when the user deletes the file
  // from the markdown), so they start unattached and we re-bind them via
  // `attachment_ids` on the next description save. Drives editor previews
  // so text/code attachments show an Eye before the bind round-trips.
  const [descPendingAttachments, setDescPendingAttachments] = useState<Attachment[]>([]);
  const descPendingAttachmentsRef = useRef<Attachment[]>([]);
  // Memoized because the image sequence below keys off this array: without it
  // the concat branch hands a fresh reference to every render and rebuilds the
  // whole issue's sequence on each one.
  const descEditorAttachments = useMemo(
    () =>
      descPendingAttachments.length > 0
        ? [...(issueAttachments ?? []), ...descPendingAttachments]
        : issueAttachments,
    [issueAttachments, descPendingAttachments],
  );

  // Every image in this issue, in the order the page renders them: the
  // description first, then each timeline comment with its thread replies
  // nested under it (MUL-5752). Built from `items` rather than the flat
  // timeline so a reply sits next to the root it renders under, and from data
  // rather than the DOM because Virtuoso only mounts the visible window.
  //
  // A resolved thread that is currently collapsed still contributes its
  // images: they belong to the issue and are one click from being on screen,
  // so leaving them out would make the counter change depending on which
  // threads happen to be folded.
  const imageSequence = useMemo(() => {
    const blocks: ImageSequenceBlock[] = [
      { content: issue?.description, attachments: descEditorAttachments },
    ];
    for (const item of items) {
      if (item.kind === "activity-group") continue;
      blocks.push({
        content: item.entry.content,
        attachments: item.entry.attachments,
      });
      for (const reply of timelineView.threadReplies.get(item.entry.id) ?? []) {
        blocks.push({ content: reply.content, attachments: reply.attachments });
      }
    }
    return collectImageSequence(blocks);
  }, [issue?.description, descEditorAttachments, items, timelineView.threadReplies]);

  const handleDescriptionUpload = useCallback(
    async (file: File) => {
      const result = await uploadWithToast(file);
      if (result) {
        descPendingAttachmentsRef.current = [
          ...descPendingAttachmentsRef.current,
          result,
        ];
        setDescPendingAttachments(descPendingAttachmentsRef.current);
      }
      return result;
    },
    [uploadWithToast],
  );

  useEffect(() => {
    descPendingAttachmentsRef.current = [];
    setDescPendingAttachments([]);
  }, [id]);

  // Shared issue actions (mutations, pin, copy-link, modal dispatch, etc.).
  // Called before the `if (!issue)` early return so hook order stays stable.
  const actions = useIssueActions(issue);
  const handleUpdateField = actions.updateField;

  // Custom property catalog. Includes archived definitions: an issue can
  // still carry a value written before the archive, and that row must stay
  // renderable (read-only) until someone clears it.
  const { data: workspaceProperties = [] } = useQuery(propertyListOptions(wsId, true));

  // Sub-issue rows only surface live definitions: the display picker offers
  // non-archived properties, and chips render only ids that resolve here.
  const activeWorkspaceProperties = useMemo(
    () => workspaceProperties.filter((p) => p.archived !== true),
    [workspaceProperties],
  );
  const subIssueCustomProps = useMemo(
    () =>
      subIssueRowPropertyIds
        .map((pid) => activeWorkspaceProperties.find((p) => p.id === pid))
        .filter((p): p is IssueProperty => !!p),
    [subIssueRowPropertyIds, activeWorkspaceProperties],
  );

  useIssueDetailScrollRestore({
    restoreKey: `${wsId}:${id}`,
    scrollContainerEl,
    ready: !!issue && !loading && !timelineLoading,
    // Disabled only while the comment deep link still has a landing to run —
    // the jump owns the scroll then. Once the landing is consumed (a tab
    // switch back), this hook's retry loop IS the restore: the one-shot
    // ref-attach assignment clamps against a container whose async content
    // (markdown, images) hasn't reached its captured height yet.
    disabled: !!highlightCommentId && consumedHighlightId !== highlightCommentId,
    // The tab memento's offset, when the platform serves one. It must win
    // over this hook's module-level map — see the parameter doc.
    overrideTop: restoredScrollTop,
  });

  // Keep the identity value stable across unrelated issue-detail updates so
  // context consumers only re-render when the owning issue changes identity.
  const resolvedIssueId = issue?.id;
  const resolvedIssueIdentifier = issue?.identifier;
  const currentIssueRenderContext = useMemo(
    () =>
      resolvedIssueId && resolvedIssueIdentifier
        ? { id: resolvedIssueId, identifier: resolvedIssueIdentifier }
        : null,
    [resolvedIssueId, resolvedIssueIdentifier],
  );

  const soloStepCount = useMemo(
    () => ((issue?.description ?? "").match(/^\s*\d+\./gm) ?? []).length,
    [issue?.description],
  );

  const soloDeliveredAttachments = useMemo(() => {
    const all = issueAttachments ?? [];
    const fromComments = all.filter((attachment) => attachment.comment_id);
    return fromComments.length > 0 ? fromComments : all;
  }, [issueAttachments]);
  const soloImageCount = useMemo(
    () =>
      soloDeliveredAttachments.filter((attachment) =>
        attachment.content_type.startsWith("image/"),
      ).length,
    [soloDeliveredAttachments],
  );
  const soloFileCount = soloDeliveredAttachments.length - soloImageCount;
  const soloHasDelivery = soloDeliveredAttachments.length > 0;

  const soloRun = useMemo(() => {
    if (isRoom) return null;
    const active = issueTasks.find((task) =>
      SOLO_ACTIVE_TASK_STATUSES.has(task.status),
    );
    const latest =
      active ??
      [...issueTasks]
        .filter((task) => !SOLO_ACTIVE_TASK_STATUSES.has(task.status))
        .sort(
          (a, b) =>
            (Date.parse(b.completed_at ?? b.started_at ?? b.created_at ?? "") || 0) -
            (Date.parse(a.completed_at ?? a.started_at ?? a.created_at ?? "") || 0),
        )[0] ??
      null;
    if (!latest) return null;
    const started = latest.started_at ?? latest.dispatched_at ?? latest.created_at;
    return {
      task: latest,
      active: SOLO_ACTIVE_TASK_STATUSES.has(latest.status),
      started,
    };
  }, [issueTasks, isRoom]);

  // ── Refresh archive (full-route layout) ───────────────────────────────
  // A squad task opens on the leg the relay is sitting on; the right rail
  // switches legs without leaving the page. A solo task uses the same shell
  // with its own run and outputs.
  const refreshIsSquad = !!isRoom && !!chain;
  const refreshStep = refreshIsSquad && chain
    ? typeof openLeg === "number"
      ? chain.steps.find((step) => step.position + 1 === openLeg)
        ?? relayView?.activeStep
        ?? chain.steps[0]
        ?? null
      : relayView?.activeStep ?? chain.steps[0] ?? null
    : null;
  const refreshSeq = refreshStep ? refreshStep.position + 1 : null;
  const refreshRunState = refreshStep
    ? stepRunState(id, refreshStep, relayTasks)
    : "none";
  const refreshLatestRun = refreshStep
    ? latestLegRun(id, refreshStep, issueTasks)
    : null;
  const refreshStepIsMine =
    !!refreshStep && !!user?.id && refreshStep.holder_user_id === user.id;
  const refreshStepHolding =
    refreshStepIsMine &&
    (refreshStep?.state === "doing" || refreshStep?.state === "reviewing");
  const refreshCanApprove =
    !!refreshStep &&
    refreshStepIsMine &&
    chainStateKey(refreshStep.state) === "reviewing";
  const refreshNextStep =
    refreshStep && chain
      ? chain.steps[refreshStep.position + 1] ?? null
      : null;
  const refreshStepAgentName =
    refreshStep?.agent_id
      ? getAgentName(refreshStep.agent_id)
      : refreshIsSquad
        ? null
        : issue?.assignee_type === "agent" && issue.assignee_id
          ? getAgentName(issue.assignee_id)
          : null;
  const refreshRunTask = refreshIsSquad
    ? refreshLatestRun
    : soloRun?.task ?? null;
  const refreshLegItems = useMemo(
    () =>
      refreshStep
        ? items.filter(
            (item) =>
              (item.kind === "comment" || item.kind === "resolved-bar") &&
              item.entry.chain_step_id === refreshStep.id,
          )
        : [],
    [items, refreshStep],
  );
  const refreshDiscussionItems = refreshStep ? refreshLegItems : discussionItems;
  const refreshLegDelivery = useMemo(() => {
    if (!refreshStep) return null;
    for (let i = timeline.length - 1; i >= 0; i--) {
      const entry = timeline[i];
      if (
        entry?.chain_step_id === refreshStep.id &&
        (entry.attachments?.length ?? 0) > 0
      ) {
        return entry;
      }
    }
    return null;
  }, [timeline, refreshStep]);

  const soloAccepted = issue ? issueBehavesAs(issue, "done") : false;
  const soloCancelled = issue ? issueBehavesAs(issue, "cancelled") : false;
  const acceptDelivery = useCallback(() => {
    if (!issue || soloAccepted || soloCancelled) return;
    handleUpdateField({ status: "done" });
    onDone?.();
    toast.success(t(($) => $.detail.accept_delivery_toast));
  }, [issue, handleUpdateField, onDone, soloAccepted, soloCancelled, t]);

  if (loading) {
    return <IssueDetailSkeleton leading={leadingAction} />;
  }

  if (!issue) {
    return <IssueNotFound showBackLink={!onDelete} leading={leadingAction} />;
  }

  const persistDescriptionSave = (
    draft: { markdown: string; baseMarkdown: string; attachmentIds: string[] },
  ) => {
    descriptionSaveInFlightRef.current = true;
    handleUpdateField(
      {
        description: draft.markdown,
        description_base: draft.baseMarkdown,
        attachment_ids:
          draft.attachmentIds.length > 0 ? draft.attachmentIds : undefined,
      },
      {
        onSuccess: (serverIssue) => {
          if (descriptionSaveIssueIdRef.current !== id) return;
          setDescriptionConflictDraft(null);
          descriptionSaveInFlightRef.current = false;
          const pending = pendingDescriptionSaveRef.current;
          pendingDescriptionSaveRef.current = null;
          if (pending) {
            // Usually the accepted document is exactly what we submitted. If
            // the server appended late channel media, keep the submitted body
            // as the next editor baseline: the server can recognize that the
            // only delta is media the editor never saw and preserve it again.
            const nextBase = serverIssue.description === draft.markdown
              ? serverIssue.description
              : draft.markdown;
            persistDescriptionSave({ ...pending, baseMarkdown: nextBase });
          }
        },
        onError: (error) => {
          if (descriptionSaveIssueIdRef.current !== id) return;
          descriptionSaveInFlightRef.current = false;
          const pending = pendingDescriptionSaveRef.current;
          pendingDescriptionSaveRef.current = null;
          if (errorCode(error) === "revision_conflict") {
            const latest = pending ?? draft;
            descriptionAttachmentIdsRef.current = latest.attachmentIds;
            setDescriptionConflictDraft(latest.markdown);
          }
        },
      },
    );
  };

  const queueDescriptionSave = (
    draft: { markdown: string; baseMarkdown: string; attachmentIds: string[] },
  ) => {
    descriptionAttachmentIdsRef.current = draft.attachmentIds;
    if (descriptionSaveInFlightRef.current) {
      pendingDescriptionSaveRef.current = draft;
      return;
    }
    persistDescriptionSave(draft);
  };

  // Shared row renderer for both timeline render modes (flat / virtualized).
  // The wrapper `id="comment-..."` is the deep-link target — equivalent to
  // a native `<a href="#comment-...">` anchor.
  const renderItem = (_i: number, item: TimelineItem): React.ReactElement => {
    if (item.kind === "resolved-bar") {
      return (
        <div className="pb-3" id={`comment-${item.id}`}>
          <ResolvedThreadBar
            entry={item.entry}
            replies={timelineView.threadReplies.get(item.id) ?? EMPTY_REPLIES}
            onExpand={() => toggleResolvedExpand(item.id, true)}
          />
        </div>
      );
    }
    if (item.kind === "comment") {
      // On a relay task the stream is the room: people speak in bubbles and
      // agents report in their own cards, in one chronological flow. The full
      // CommentCard (edit, resolve, thread folds) stays for plain issues —
      // the room trades those affordances for reading like the conversation
      // it actually is.
      if (isRoom) {
        return (
          <div className="pb-2 pt-2" id={`comment-${item.id}`}>
            <RoomMessage
              entry={item.entry}
              replies={timelineView.threadReplies.get(item.id) ?? EMPTY_REPLIES}
              currentUserId={user?.id}
              identityOf={playerNames.identityOf}
              getActorName={getActorName}
              onToggleReaction={handleToggleReaction}
            />
          </div>
        );
      }
      const isResolved = !!item.entry.resolved_at;
      const attachmentCount = item.entry.attachments?.length ?? 0;
      return (
        <div className="pb-3" id={`comment-${item.id}`}>
          <CommentCard
            issueId={id}
            entry={item.entry}
            replies={timelineView.threadReplies.get(item.id) ?? EMPTY_REPLIES}
            currentUserId={user?.id}
            canModerate={canModerateComments}
            onReply={submitReply}
            onReplyAccepted={scrollToTimelineBottom}
            onEdit={editComment}
            onDelete={deleteComment}
            onToggleReaction={handleToggleReaction}
            onCreateSubIssue={openCommentSubIssue}
            onResolveToggle={handleResolveToggle}
            onCollapseResolved={isResolved ? () => toggleResolvedExpand(item.id, false) : undefined}
            expandedResolvedIds={expandedResolved}
            onResolvedExpandChange={toggleResolvedExpand}
            highlightedCommentId={highlightedId}
            hideAttachments={!isRoom}
          />
          {!isRoom && attachmentCount > 0 ? (
            <button
              type="button"
              className="qw-solo-archived"
              onClick={() => {
                document
                  .getElementById("solo-delivery")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              <FileText className="size-3.5" />
              {t(($) => $.detail.attachments_archived, {
                count: attachmentCount,
              })}
            </button>
          ) : null}
        </div>
      );
    }
    // activity-group
    const expanded = expandedActivityIds.has(item.id)
      ? true
      : collapsedActivityIds.has(item.id)
        ? false
        : item.id === lastActivityGroupId;
    const truncateOlder = item.id === lastActivityGroupId;
    const showOlder = showOlderActivityIds.has(item.id);
    return (
      <ActivityBlock
        entries={item.entries}
        expanded={expanded}
        onToggle={() => toggleActivityBlock(item.id, expanded)}
        truncateOlder={truncateOlder}
        showOlder={showOlder}
        onToggleShowOlder={() => showOlderActivities(item.id)}
        getActorName={getActorName}
        resolveStatusLabel={resolveStatusLabel}
        resolveStatusCategory={resolveStatusCategory}
        resolveStatusColor={resolveStatusColor}
        t={t}
        timeAgo={timeAgo}
        locale={locale}
      />
    );
  };

  // The subscribe cluster (delegated badge / subscribe control / subscribers)
  // is shared: the plain issue's activity header and the relay log's header
  // both carry it, and it must not be built twice.
  const subscriptionControls = (
    <>
                  {/* A delegated subscription is one the user never opted into
                      by hand — their agent created this issue for them. Saying
                      so is what keeps it from reading as the product quietly
                      adding them to things (MUL-5483). */}
                  {isSubscribed && subscriptionReason === "delegated" && (
                    <Tooltip>
                      {/* Quiet surface, not plain body text: this is metadata
                          explaining a state, and must not read as a second
                          action sitting next to Unsubscribe. Uses the shared
                          caption role rather than an ad-hoc size (MUL-5451). */}
                      <TooltipTrigger className="cursor-default rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground">
                        {t(($) => $.detail.delegated_subscription_badge)}
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-64">
                        {t(($) => $.detail.delegated_subscription_hint)}
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {/* Nothing until the subscribers query resolves: the default
                      empty list reads as "not subscribed" for everyone, so
                      rendering it flashes Subscribe at someone who is already
                      subscribed, and a click landing in that window sends a
                      subscribe instead of the unsubscribe they meant. An
                      unresolved state is better shown as no control than as the
                      wrong one (MUL-5714). */}
                  {subscriptionKnown &&
                    (!isSubscribed || (childCountKnown && childIssues.length === 0) ? (
                      /* One button, no menu, when there is nothing for the
                         subtree option to cover. This is the root-only path
                         (opt_out_scope='issue'), NOT the subtree one: even at
                         zero children the two are different server writes,
                         because a subtree tombstone also keeps FUTURE children
                         from re-subscribing the user
                         (server/pkg/db/queries/subscriber.sql). Declining one
                         issue must not silently opt someone out of a tree that
                         does not exist yet. While the child count is unknown we
                         keep the menu below — it never picks a scope for the
                         user. */
                      <button
                        type="button"
                        onClick={handleToggleSubscribe}
                        disabled={togglePending || !user?.id}
                        className={SUBSCRIPTION_ACTION_CLASS}
                      >
                        {isSubscribed
                          ? t(($) => $.detail.unsubscribe)
                          : t(($) => $.detail.subscribe)}
                      </button>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          disabled={togglePending || subtreePending || !user?.id}
                          className={SUBSCRIPTION_ACTION_CLASS}
                        >
                          {t(($) => $.detail.unsubscribe)}
                        </DropdownMenuTrigger>
                        {/* onClick, not onSelect: Base UI's Menu.Item exposes no
                            onSelect (that is the Radix spelling), and because its
                            props extend the full div attribute set, an onSelect
                            typechecks and silently lands on the DOM node as the
                            native text-selection event — the handler never runs
                            (MUL-5710). */}
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={handleToggleSubscribe}
                            disabled={togglePending}
                          >
                            {t(($) => $.detail.unsubscribe_this)}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={handleUnsubscribeSubtree}
                            disabled={subtreePending}
                          >
                            {t(($) => $.detail.unsubscribe_subtree)}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ))}
                  <Popover>
                    <PopoverTrigger className="cursor-pointer hover:opacity-80 transition-opacity">
                      {subscribers.length > 0 ? (
                        <AvatarGroup>
                          {subscribers.slice(0, 4).map((sub) => (
                            <ActorAvatar
                              key={`${sub.user_type}-${sub.user_id}`}
                              actorType={sub.user_type}
                              actorId={sub.user_id}
                              size="md"
                              enableHoverCard
                            />
                          ))}
                          {subscribers.length > 4 && (
                            <AvatarGroupCount>+{subscribers.length - 4}</AvatarGroupCount>
                          )}
                        </AvatarGroup>
                      ) : (
                        <span className="flex items-center justify-center h-6 w-6 rounded-full border border-dashed border-muted-foreground/30 text-muted-foreground">
                          <Users className="h-3 w-3" />
                        </span>
                      )}
                    </PopoverTrigger>
                    <SubscriberPopoverContent
                      members={members}
                      agents={agents}
                      subscribers={subscribers}
                      toggleSubscriber={toggleSubscriber}
                      togglesDisabled={
                        !subscriptionKnown || togglePending || !user?.id
                      }
                      t={t}
                    />
                  </Popover>
    </>
  );

  // The timeline body (skeleton / virtualized / flat). The parent page renders
  // it over the room-level entries; the solo page over everything.
  const renderTimeline = (list: TimelineItem[]) => (
              timelineLoading && timelineView.groups.length === 0 ? (
                <TimelineSkeleton />
              ) : (
                // Two render modes:
                //   - `highlightCommentId` set (came from inbox deep-link) →
                //     render flat. Every comment mounts, every height is real,
                //     the target id is in the DOM the instant the useEffect
                //     above runs `scrollIntoView`. No virtualization estimate
                //     errors, no spacer reflow drift. Pays cold-mount cost
                //     proportional to items.length (markdown + lowlight per
                //     comment), which is acceptable in the deep-link case —
                //     the user has explicit intent to land on a specific item.
                //   - `find.open` (in-page Cmd/Ctrl+F) → also render flat, so
                //     every comment is in the DOM for the find walk to match
                //     and highlight. Same explicit-intent cold-mount trade-off.
                //   - otherwise → Virtuoso. Browsing mode, virtualization
                //     wins on first-paint perf for long timelines.
                //
                // The split is deliberate: virtualization and "land precisely
                // on a target" have fundamentally opposed contracts (estimated
                // heights vs real heights). Trying to satisfy both in one
                // path is what produced the bug history this PR closes.
                !highlightCommentId && !find.open ? (
                  !scrollContainerEl ? (
                    // Skeleton while the callback ref populates so the gap
                    // between IssueDetail mount and Virtuoso mount doesn't
                    // flash empty.
                    <TimelineSkeleton />
                  ) : (
                    <div className="mt-4">
                      <Virtuoso
                        key={`${wsId}:${id}`}
                        ref={virtuosoRef}
                        customScrollParent={scrollContainerEl}
                        data={list}
                        initialScrollTop={restoredScrollTop}
                        increaseViewportBy={{ top: 800, bottom: 800 }}
                        computeItemKey={(_i, item) => `${item.kind}:${item.id}`}
                        skipAnimationFrameInResizeObserver
                        // followOutput intentionally NOT set. Virtuoso treats
                        // it as a sticky "is at bottom" flag and resets
                        // scrollTop to maxScrollTop on every height-change
                        // tick — issue-detail is document-shaped, not chat.
                        itemContent={renderItem}
                      />
                    </div>
                  )
                ) : (
                  <div className="mt-4">
                    {list.map((item, i) => (
                      <Fragment key={`${item.kind}:${item.id}`}>
                        {renderItem(i, item)}
                      </Fragment>
                    ))}
                  </div>
                )
              )
  );

  // The workbench slots the relay chapters receive. Built here because they
  // need this page's handlers; the chapters own only the layout.
  const roomPlan = relayView ? (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-caption font-semibold text-muted-foreground">
        <Flag className="size-3.5" />
        {t(($) => $.room.leg_plan_label)}
        <span className="grow" />
        <span className="rounded-full bg-muted px-1.5 text-micro font-normal">
          {t(($) => $.room.leg_plan_only_you)}
        </span>
      </div>
      <LegPlanSection
        view={relayView}
        planPending={setChainStepPlan.isPending}
        handoff={handoffDraft}
        onSavePlan={(plan) =>
          setChainStepPlan.mutate(plan, {
            onSuccess: () => toast.success(t(($) => $.room.leg_plan_saved)),
            onError: () => toast.error(t(($) => $.room.leg_plan_save_failed)),
          })
        }
      />
    </section>
  ) : null;
  const roomStream = (
    <section className="flex flex-col gap-1">
      <h2 className="text-title-sm font-semibold">
        {t(($) => $.detail.activity_section)}
      </h2>
      {renderTimeline(parentItems)}
    </section>
  );
  const roomResources = relayView ? (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-caption font-semibold text-muted-foreground">
        <Box className="size-3.5" />
        {t(($) => $.room.res_title)}
        <span className="grow" />
        <span className="rounded-full bg-muted px-1.5 text-micro font-normal">
          {t(($) => $.room.res_locked)}
        </span>
      </div>
      <LegResourcesSection
        view={relayView}
        agentNameOf={getAgentName}
        projectId={issue.project_id}
      />
    </section>
  ) : null;
  // The next holder without an agent parks the relay the moment the baton
  // moves — said here, at the decision, instead of discovered after.
  const nextAgentlessStep =
    relayView?.nextAfterMineStep &&
    !relayView.nextAfterMineStep.agent_id &&
    chainStateKey(relayView.nextAfterMineStep.state) === "pending"
      ? relayView.nextAfterMineStep
      : null;
  const roomSquadName =
    issue.assignee_type === "squad" && issue.assignee_id
      ? getSquadName(issue.assignee_id)
      : undefined;
  const roomBindHref = issue.assignee_id
    ? paths.squadDetail(issue.assignee_id)
    : paths.tasks();
  const handleSkipParkedStep = () =>
    skipChainStep.mutate(undefined, {
      onError: () => toast.error(t(($) => $.room.skip_failed)),
    });
  const roomDecide = chain && relayView ? (
    <div className="overflow-hidden rounded-lg border border-surface-border bg-surface shadow-[var(--shadow-surface)]">
      {nextAgentlessStep ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-warning/25 bg-warning/10 px-3.5 py-2 text-caption text-warning">
          <span className="min-w-0">
            {t(($) => $.room.decide_warn_agentless, {
              name: playerNames.nameOf(nextAgentlessStep.holder_user_id),
            })}
          </span>
          <span className="grow" />
          <AppLink
            href={roomBindHref}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            {t(($) => $.room.parked_bar_action, {
              name: playerNames.nameOf(nextAgentlessStep.holder_user_id),
            })}
          </AppLink>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
        {relayView.canApprove ? (
          <Button size="sm" className="bg-success text-white hover:bg-success/90"
            disabled={approveChainStep.isPending || outputProducing}
            onClick={() => {
              // 交棒之前先有产出：summary 还空着、且这一轮还没让智能体总结过
              // ——那这次点击就是「让本棒智能体把对话和结果总结成产出 md」，
              // 产出落地后摘要自动填好，再点一次交棒。
              if (!handoffSummary.trim() && !outputAsked) {
                startLegOutput();
                return;
              }
              approveWithHandoff();
            }}
          >
            {outputProducing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <CircleCheck className="size-3.5" />
            )}
            {outputProducing
              ? t(($) => $.room.output_producing)
              : relayView.nextStep
                ? t(($) => $.room.approve_pass_to, {
                    name: playerNames.nameOf(relayView.nextStep.holder_user_id),
                  })
                : t(($) => $.room.approve_finish)}
          </Button>
        ) : null}
        {relayView.canApprove && !outputProducing ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={approveChainStep.isPending}
            onClick={startLegOutput}
          >
            <Sparkles className="size-3.5" />
            {outputAsked
              ? t(($) => $.room.output_regenerate)
              : t(($) => $.room.output_generate)}
          </Button>
        ) : null}
        <span className="min-w-0 text-caption text-muted-foreground">
          {outputProducing
            ? t(($) => $.room.output_waiting)
            : relayView.nextAfterMineStep
              ? t(($) => $.room.approve_hint, {
                  name: playerNames.nameOf(relayView.nextAfterMineStep.holder_user_id),
                })
              : t(($) => $.room.approve_hint_last)}
        </span>
      </div>
    </div>
  ) : null;


  // ── The leg's own page (child) ────────────────────────────────────────
  // Only this person's conversation, plan, resources and outputs. The parent
  // list is the only place the legs meet.
  const legSubtaskBody = openLegStep && chain && relayView ? (() => {
    const step = openLegStep;
    const seq = step.position + 1;
    const key = chainStateKey(step.state);
    const prevStep = chain.steps[step.position - 1] ?? null;
    const nextStep = chain.steps[step.position + 1] ?? null;
    const agentName = step.agent_id ? getAgentName(step.agent_id) : null;
    const runCount = legRunTasks(id, step, relayTasks).length;
    return (
      <>
        <div className="flex flex-wrap items-center gap-2 text-caption">
          <button
            type="button"
            onClick={() => setOpenLeg("parent")}
            className="inline-flex items-center gap-1 rounded-[5px] border border-surface-border bg-surface px-2 py-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" />
            {t(($) => $.room.back_to_parent)}
          </button>
          <span className="font-mono text-micro text-faint-foreground">
            {issue.identifier}-{seq}
          </span>
          <span className="text-faint-foreground">·</span>
          <span className="text-faint-foreground">
            {t(($) => $.room.parent_label)} {issue.identifier}
          </span>
        </div>
        <h2 className="mt-3 text-title-lg font-semibold leading-snug">
          {step.title || t(($) => $.room.chapter_leg_bare, { seq })}
        </h2>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-caption text-muted-foreground">
          <SeatMark userId={step.holder_user_id} state={step.state} size="sm" />
          <span className="font-medium text-foreground">
            {playerNames.nameOf(step.holder_user_id)}
          </span>
          {t(($) => $.room.chat_leg, { seq, total: chain.steps.length })}
          {prevStep ? (
            <>
              <span aria-hidden="true" className="text-border">|</span>
              <span>{t(($) => $.room.leg_from_prev)}</span>
              {prevStep.handoff ? (
                prevStep.handoff.files.map((file, i) => (
                  <HandoffFileChip
                    key={`${file.name}-${i}`}
                    file={file}
                    attachment={
                      file.attachment_id
                        ? attachmentOf(file.attachment_id)
                        : undefined
                    }
                  />
                ))
              ) : (
                <span className="text-faint-foreground">
                  {t(($) => $.room.chapter_no_handoff)}
                </span>
              )}
            </>
          ) : null}
          <span aria-hidden="true" className="text-border">|</span>
          {nextStep ? (
            <>
              <span>
                {t(($) => $.room.leg_next_label)} ·{" "}
                {playerNames.nameOf(nextStep.holder_user_id)}
              </span>
              {!nextStep.agent_id && chainStateKey(nextStep.state) === "pending" ? (
                <span className="rounded-full bg-warning/20 px-1.5 py-px text-micro whitespace-nowrap text-warning">
                  {t(($) => $.room.flow_no_agent)}
                </span>
              ) : null}
            </>
          ) : (
            <span>{t(($) => $.room.leg_last_label)}</span>
          )}
        </div>

        <div className="mt-4 grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* 独立对话框 —— 只有这一棒的对话 */}
          <section className="min-w-0 overflow-hidden rounded-lg border border-surface-border bg-surface shadow-[var(--shadow-surface)]">
            <header className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/45 px-3.5 py-2.5">
              <SeatMark userId={step.holder_user_id} state={step.state} size="sm" />
              <span className="text-caption font-semibold">
                {openLegIsMine
                  ? t(($) => $.room.leg_dialog_mine)
                  : t(($) => $.room.leg_dialog_their, {
                      name: playerNames.nameOf(step.holder_user_id),
                    })}
              </span>
              <span className="grow" />
              {step.agent_id && (key === "doing" || key === "reviewing") ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-inflight/35 bg-inflight-surface px-1.5 py-px text-micro whitespace-nowrap text-inflight">
                  <Bot className="size-2.5" />
                  <span className="font-mono">{agentName}</span>
                  {openLegRunState === "running" ? (
                    <>
                      <span>· {t(($) => $.room.chat_running)}</span>
                      <span
                        className="size-1.5 animate-pulse rounded-full bg-inflight"
                        aria-hidden="true"
                      />
                    </>
                  ) : openLegRunState === "queued" ? (
                    <span>· {t(($) => $.room.state_waiting)}</span>
                  ) : null}
                </span>
              ) : null}
              <ChainStateTag state={step.state} runState={openLegRunState} />
            </header>
            <div className="px-1 pb-2 pt-1">
              {openLegIsMine ? (
                legItems.length > 0 ? (
                  <div>
                    {legItems.map((item) => (
                      <Fragment key={`${item.kind}:${item.id}`}>
                        {renderItem(0, item)}
                      </Fragment>
                    ))}
                  </div>
                ) : (
                  <p className="px-3 py-4 text-caption text-faint-foreground">
                    {key === "done"
                      ? t(($) => $.room.leg_delivered_note)
                      : key === "pending"
                        ? t(($) => $.room.leg_waiting)
                        : t(($) => $.room.leg_thread_empty)}
                  </p>
                )
              ) : (
                <div className="px-3 py-2">
                  <LockedLegBlock
                    seq={seq}
                    holderName={playerNames.nameOf(step.holder_user_id)}
                    commentCount={step.leg_comment_count ?? 0}
                    runCount={runCount}
                    active={key !== "done"}
                  />
                </div>
              )}
            </div>
            {openLegIsMine || key === "done" ? (
              <div className="border-t border-border bg-success/5 px-3.5 py-2.5">
                <div className="flex items-center gap-1.5 font-mono text-micro text-faint-foreground">
                  <FileText className="size-3" />
                  {t(($) => $.room.outputs_title)}
                </div>
                {key === "done" && step.handoff?.files.length ? (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {step.handoff.files.map((file, i) => (
                      <HandoffFileChip
                        key={`${file.name}-${i}`}
                        file={file}
                        attachment={
                          file.attachment_id
                            ? attachmentOf(file.attachment_id)
                            : undefined
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <p className="mt-1.5 text-caption text-faint-foreground">
                    {openLegHolding
                      ? t(($) => $.room.outputs_running)
                      : t(($) => $.room.outputs_pending)}
                  </p>
                )}
              </div>
            ) : null}
          </section>

          {/* 右栏：实况 / 方案 / 资源 / 交棒 */}
          <aside className="flex min-w-0 flex-col gap-3.5">
            {openLegIsMine && openLegStep?.agent_id && openLegLatestRun ? (
              <LegRunLive
                task={openLegLatestRun}
                agentName={getAgentName(openLegStep.agent_id)}
                stepLabel={t(($) => $.room.chat_leg, {
                  seq: openLegStep.position + 1,
                  total: chain.steps.length,
                })}
              />
            ) : null}
            {openLegIsMine ? roomPlan : null}
            {openLegHolding ? roomResources : null}
            {openLegIsMine && key === "done" && step.handoff ? (
              <HandoffCard
                step={step}
                nameOf={playerNames.nameOf}
                attachmentOf={attachmentOf}
              />
            ) : null}
            {openLegHolding ? roomDecide : null}
            {key === "parked" ? (
              <ChainParkedBar
                step={step}
                nameOf={playerNames.nameOf}
                bindHref={roomBindHref}
                onSkip={handleSkipParkedStep}
                skipPending={skipChainStep.isPending}
              />
            ) : null}
            {!openLegIsMine && key !== "parked" ? (
              <div className="flex items-start gap-2 rounded-lg border border-dashed border-surface-border bg-muted/30 px-3.5 py-3 text-caption leading-relaxed text-muted-foreground">
                <Lock className="mt-0.5 size-3.5 shrink-0" />
                <span>{t(($) => $.room.leg_page_other_note)}</span>
              </div>
            ) : null}
          </aside>
        </div>
      </>
    );
  })() : null;

  // Breadcrumb shows the single most-direct container, never a fabricated chain.
  // project_id and parent_issue_id are orthogonal (a sub-issue can live in a
  // different project than its parent), so we never render both: parent wins,
  // else project, else nothing. The project is still shown in the properties
  // panel. The workspace name is intentionally absent — "all issues" is a view,
  // not a container.
  const breadcrumbSegments: BreadcrumbSegment[] = parentIssue
    ? [{ href: paths.issueDetail(parentIssue.id), label: parentIssue.identifier }]
    : breadcrumbProject
      ? [
          {
            href: paths.projectDetail(breadcrumbProject.id),
            className: "flex items-center gap-1 min-w-0 max-w-72",
            label: (
              <>
                <ProjectIcon project={breadcrumbProject} size="sm" />
                <span className="min-w-0 truncate">{breadcrumbProject.title}</span>
              </>
            ),
          },
        ]
      : [];

  const titleEditorBlock = (
    <>
          {titleLazy.active && (
            <div className={titleLazy.ready ? undefined : "hidden"}>
              <TitleEditor
                key={`title-${id}-${titleResetToken}`}
                ref={titleEditorRef}
                defaultValue={titleConflictDraft ?? issue.title}
                placeholder={t(($) => $.detail.title_placeholder)}
                className={layout === "refresh"
                  ? "rd-title-editor"
                  : "w-full text-display-sm font-semibold leading-[1.38] tracking-tight"}
                onReady={titleLazy.onReady}
                onBlur={(value) => {
                  const trimmed = value.trim();
                  if (trimmed && trimmed !== issue.title) {
                    handleUpdateField({
                      title: trimmed,
                      title_base: titleBaseRef.current,
                    }, {
                      onSuccess: (serverIssue) => {
                        setTitleConflictDraft(null);
                        titleBaseRef.current = serverIssue.title;
                      },
                      onError: (error) => {
                        if (errorCode(error) === "revision_conflict") {
                          setTitleConflictDraft(trimmed);
                        }
                      },
                    });
                  }
                }}
              />
            </div>
          )}
          {!titleLazy.ready && (
            <div
              role="button"
              tabIndex={0}
              className={layout === "refresh"
                ? "rd-title-editor cursor-text"
                : "w-full cursor-text text-display-sm font-semibold leading-[1.38] tracking-tight"}
              onClick={(e) => {
                // A drag-selection (copying the title) must not summon the editor.
                const sel = window.getSelection();
                if (sel && !sel.isCollapsed) return;
                titleBaseRef.current = issue.title;
                titleLazy.activate({ x: e.clientX, y: e.clientY });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  titleBaseRef.current = issue.title;
                  titleLazy.activate();
                }
              }}
            >
              {issue.title}
            </div>
          )}
          {titleConflictDraft !== null ? (
            <RevisionConflictCompare
              className="mt-2"
              title={t(($) => $.revision.compare_title)}
              serverLabel={t(($) => $.revision.server_version)}
              localLabel={t(($) => $.revision.local_version)}
              serverValue={issue.title}
              localValue={titleConflictDraft}
              serverAction={(
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    // Local-only: the server already holds this title, so
                    // discarding writes nothing. The remount is what puts it
                    // back into the editor (see titleResetToken).
                    setTitleConflictDraft(null);
                    titleBaseRef.current = issue.title;
                    setTitleResetToken((token) => token + 1);
                  }}
                >
                  {t(($) => $.revision.use_server)}
                </Button>
              )}
              localAction={(
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const draft = titleConflictDraft.trim();
                    if (!draft) return;
                    handleUpdateField(
                      { title: draft, title_base: issue.title },
                      {
                        onSuccess: (serverIssue) => {
                          setTitleConflictDraft(null);
                          titleBaseRef.current = serverIssue.title;
                        },
                      },
                    );
                  }}
                >
                  {t(($) => $.revision.keep_local)}
                </Button>
              )}
            />
          ) : null}
    </>
  );

  const parentLinkBlock = (
    <>
          {parentIssue && !issue.source_context && (
            <AppLink
              href={paths.issueDetail(parentIssue.id)}
              className="mt-2 inline-flex max-w-full items-center gap-1.5 text-caption text-muted-foreground hover:text-foreground transition-colors group/parent"
            >
              <span className="font-medium shrink-0">{t(($) => $.detail.sub_issue_of)}</span>
              <StatusIcon
                  status={parentIssue.status}
                  category={issueStatusCategory(parentIssue) ?? undefined}
                  className="h-3.5 w-3.5 shrink-0"
                />
              <span className="tabular-nums shrink-0">{parentIssue.identifier}</span>
              <span className="truncate group-hover/parent:text-foreground">
                {parentIssue.title}
              </span>
              {parentChildIssues.length > 0 && (() => {
                const done = parentChildIssues.filter((c) => issueBehavesAs(c, "done")).length;
                return (
                  <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 shrink-0">
                    <ProgressRing done={done} total={parentChildIssues.length} size={11} />
                    <span className="tabular-nums text-micro font-medium">
                      {done}/{parentChildIssues.length}
                    </span>
                  </span>
                );
              })()}
            </AppLink>
          )}

          {issue.source_context && (
            <SourceContextBadge
              context={issue.source_context}
              parentIssue={parentIssue}
              parentProgress={parentChildIssues.length > 0
                ? {
                    done: parentChildIssues.filter((child) => issueBehavesAs(child, "done")).length,
                    total: parentChildIssues.length,
                  }
                : undefined}
              refetchIssue={async () => {
                const result = await refetchIssue();
                return result.isError ? null : result.data;
              }}
            />
          )}

          {/* The relay's position line: the people in order, when the task was
              filed, and how many runs it has taken so far. The states
              themselves live in the chapters below — the line does not repeat
              them, it only says where in the relay you are looking. */}
    </>
  );

  const descriptionEditorBlock = (
    <>
            <ContentEditor
              ref={descEditorRef}
              className={isRoom ? undefined : "qw-solo-rich"}
              key={id}
              value={descriptionConflictDraft ?? issue.description ?? ""}
              placeholder={t(($) => $.detail.desc_placeholder)}
              onUpdate={(md, baseMarkdown) => {
                // Bind any pending uploads still referenced in the markdown
                // so they appear in `issueAttachments` after refresh and the
                // editor's text/code preview keeps working past reload.
                //
                // Match with `contentReferencesAttachment`, NOT `md.includes(a.url)`:
                // the editor persists the durable `markdownLink`
                // (`/api/attachments/<id>/download` / `markdown_url`) into the
                // body, never the raw storage `a.url`. A bare `md.includes(a.url)`
                // therefore never matches, so the upload is never linked via
                // `attachment_ids`. After reload it's absent from
                // `issueAttachments`, the renderer can't resolve it to a
                // freshly-signed `download_url`, and the persisted auth-gated
                // download endpoint fails to load as a native <img> on clients
                // whose origin isn't the API host (Desktop/Electron, mobile
                // webview) — while still working on web via the cookie/proxy.
                // This mirrors the comment/reply/chat composers, which already
                // bind via `contentReferencesAttachment` (MUL-3130 / MUL-3192).
                const ids = descPendingAttachmentsRef.current
                  .filter((a) => contentReferencesAttachment(md, a))
                  .map((a) => a.id);
                queueDescriptionSave({
                  markdown: md,
                  baseMarkdown,
                  attachmentIds: ids,
                });
              }}
              onUploadFile={handleDescriptionUpload}
              debounceMs={1500}
              // Closing the issue modal must save what the user last saw —
              // without the flush, a paste followed by a quick close loses
              // the image markdown and its attachment_ids bind (MUL-3254).
              flushPendingOnUnmount
              currentIssueId={id}
              attachments={descEditorAttachments}
            />

            {descriptionConflictDraft !== null ? (
              <RevisionConflictCompare
                className="mt-3"
                title={t(($) => $.revision.compare_description)}
                serverLabel={t(($) => $.revision.server_version)}
                localLabel={t(($) => $.revision.local_version)}
                serverValue={issue.description || ""}
                localValue={descriptionConflictDraft}
                serverAction={(
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      // The editor is dirty — that is why this conflict
                      // exists — so the `value` prop cannot land: ContentEditor
                      // deliberately refuses to clobber unsaved bytes.
                      // adoptContent is the explicit "take this content"
                      // channel and applies without emitting an update, so
                      // discarding never writes.
                      descEditorRef.current?.adoptContent(issue.description || "");
                      descriptionAttachmentIdsRef.current = [];
                      pendingDescriptionSaveRef.current = null;
                      setDescriptionConflictDraft(null);
                    }}
                  >
                    {t(($) => $.revision.use_server)}
                  </Button>
                )}
                localAction={(
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      handleUpdateField(
                        {
                          description: descriptionConflictDraft,
                          description_base: issue.description || "",
                          attachment_ids:
                            descriptionAttachmentIdsRef.current.length > 0
                              ? descriptionAttachmentIdsRef.current
                              : undefined,
                        },
                        {
                          onSuccess: () => {
                            setDescriptionConflictDraft(null);
                          },
                        },
                      );
                    }}
                  >
                    {t(($) => $.revision.keep_local)}
                  </Button>
                )}
              />
            ) : null}

            <div className={cn("flex items-center gap-1 mt-3", layout === "refresh" && "hidden")}>
              <ReactionBar
                reactions={issueReactions}
                currentUserId={user?.id}
                onToggle={handleToggleIssueReaction}
                getActorName={getActorName}
              />
              <FileUploadButton
                size="sm"
                multiple
                onSelect={(file) => descEditorRef.current?.uploadFile(file)}
              />
            </div>
    </>
  );



  const soloAcceptButton = soloCancelled ? null : (
    <Button
      type="button"
      size="sm"
      className="h-[31px] px-3 text-[12.5px]"
      onClick={acceptDelivery}
      disabled={soloAccepted}
    >
      <CircleCheck className="size-3.5" />
      {soloAccepted
        ? t(($) => $.detail.accepted_delivery)
        : t(($) => $.detail.accept_delivery)}
    </Button>
  );

  const soloHeaderActions = (
    <div className="qw-solo-actions">
      {!soloHasDelivery ? soloAcceptButton : null}
      {subscriptionControls}
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label={t(($) => $.detail.copy_link)}
        onClick={() => {
          void copyText(window.location.href);
          toast.success(t(($) => $.detail.link_copied));
        }}
      >
        <Link2 />
      </Button>
      <IssueActionsDropdown
        issue={issue}
        align="end"
        onDeletedFallbackPath={onDelete ? undefined : paths.tasks()}
        trigger={
          <Button
            variant="outline"
            size="icon-sm"
            className="text-muted-foreground"
          >
            <MoreHorizontal />
          </Button>
        }
      />
    </div>
  );

  const soloHeader = (
    <div>
      {leadingAction ? <div className="qw-solo-leading">{leadingAction}</div> : null}
      <div className="qw-solo-crumbs">
        <AppLink href={paths.tasks()}>{t(($) => $.detail.tasks_crumb)}</AppLink>
        {breadcrumbProject ? (
          <>
            <span className="sep">/</span>
            <AppLink
              href={paths.projectDetail(breadcrumbProject.id)}
              className="flex min-w-0 items-center gap-1"
            >
              <ProjectIcon project={breadcrumbProject} size="sm" />
              <span className="min-w-0 truncate">{breadcrumbProject.title}</span>
            </AppLink>
          </>
        ) : null}
        <span className="sep">/</span>
        <span className="id">{issue.identifier}</span>
      </div>
      <div className="qw-solo-title-row">
        <span className="qw-solo-title-state">
          <StatusIcon
            status={issue.status}
            category={issueStatusCategory(issue) ?? undefined}
            className="size-[17px]"
          />
        </span>
        <div className="qw-solo-title-main">{titleEditorBlock}</div>
        <span className="qw-solo-hash">#{issue.number}</span>
        {soloHeaderActions}
      </div>
      <div className="qw-solo-meta">
        <ActorAvatar
          actorType={issue.creator_type}
          actorId={issue.creator_id}
          size="xs"
          profileLink={false}
        />
        <span>
          <b>{getActorName(issue.creator_type, issue.creator_id)}</b>{" "}
          {t(($) => $.detail.prop_created)}{" "}
          <span className="dt">{shortDate(issue.created_at, locale)}</span>
        </span>
        {soloRun ? (
          <>
            <span className="dot">·</span>
            <span className={soloRun.active ? "run-live" : "run-done"}>
              {soloRun.active
                ? t(($) => $.detail.execution_running)
                : t(($) => $.detail.execution_done)}
            </span>
            {soloRun.started ? (
              <span className="dt">
                <LiveDuration
                  started={soloRun.started}
                  completed={soloRun.task.completed_at}
                  active={soloRun.active}
                />
              </span>
            ) : null}
          </>
        ) : null}
        <span className="dot">·</span>
        <span>
          {t(($) => $.detail.delivery_images, { count: soloImageCount })}
          {" · "}
          {t(($) => $.detail.delivery_files, { count: soloFileCount })}
        </span>
        <span className="dot">·</span>
        <span>
          {t(($) => $.detail.prop_updated)}{" "}
          <span className="dt">{shortDate(issue.updated_at, locale)}</span>
        </span>
        <IssueAgentHeaderChip issueId={id} />
      </div>
      {parentLinkBlock}
    </div>
  );

  const soloSticky = (
    <>
      <StatusIcon
        status={issue.status}
        category={issueStatusCategory(issue) ?? undefined}
        className="size-4"
      />
      <span className="font-mono text-[11px] text-faint-foreground">
        {issue.identifier}
      </span>
      <span className="min-w-0 truncate text-[12.5px] font-semibold">
        {issue.title}
      </span>
      <span className="qw-solo-spacer" />
      {soloRun ? (
        <span
          className={cn("qw-solo-runstate", soloRun.active ? "run" : "done")}
        >
          <i className="dot" />
          {soloRun.active
            ? t(($) => $.detail.execution_running)
            : t(($) => $.detail.execution_done)}
          {soloRun.started ? (
            <>
              {" · "}
              <LiveDuration
                started={soloRun.started}
                completed={soloRun.task.completed_at}
                active={soloRun.active}
              />
            </>
          ) : null}
        </span>
      ) : null}
      {soloAcceptButton}
    </>
  );

  const soloBrief = (
    <section className="qw-solo-brief">
      <div className="qw-solo-section-head">
        <h2 className="qw-solo-section-title">
          {t(($) => $.detail.section_description)}
        </h2>
        {soloStepCount > 0 ? (
          <span className="qw-solo-section-count">
            {t(($) => $.detail.brief_steps, { count: soloStepCount })}
          </span>
        ) : null}
        <span className="qw-solo-spacer" />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label={t(($) => $.detail.brief_edit)}
          onClick={() => {
            setSoloBriefCollapsed(false);
            window.requestAnimationFrame(() => descEditorRef.current?.focus());
          }}
        >
          <Pencil />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label={t(($) => $.detail.brief_toggle)}
          onClick={() => setSoloBriefCollapsed((value) => !value)}
        >
          {soloBriefCollapsed ? <ChevronDown /> : <ChevronUp />}
        </Button>
      </div>
      <div
        {...descDropZoneProps}
        className={cn(
          "relative qw-solo-brief-body",
          soloBriefCollapsed && "hidden",
        )}
        onFocusCapture={() => {
          if (!descriptionEditingRef.current) {
            descriptionEditingRef.current = true;
          }
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            descriptionEditingRef.current = false;
          }
        }}
      >
        {descriptionEditorBlock}
        {descDragOver && <FileDropOverlay />}
      </div>
    </section>
  );

  const soloDelivery = soloHasDelivery ? (
    <SoloDeliverySection
      attachments={issueAttachments ?? []}
      state={
        soloAccepted
          ? "done"
          : soloRun?.active
            ? "running"
            : "review"
      }
      action={soloAcceptButton}
    />
  ) : null;

  const soloSubIssues =
    childIssues.length > 0 ? (
      <IssueContextMenuProvider>
        <section className="mt-8">
          <div className="qw-solo-section-head">
            <h2 className="qw-solo-section-title">
              {t(($) => $.detail.sub_issues_label)}
            </h2>
            <span className="qw-solo-section-count">
              {childIssues.filter((child) => issueBehavesAs(child, "done")).length}
              /{childIssues.length}
            </span>
            <span className="qw-solo-spacer" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => actions.openCreateSubIssue()}
            >
              <Plus />
              {t(($) => $.detail.add_sub_issue_tooltip)}
            </Button>
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-card/30 divide-y divide-border/60">
            {groupSubIssuesByStage(childIssues).map(({ stage, items: groupItems }) => (
              <Fragment key={stage ?? "unstaged"}>
                {childIssues.some((child) => child.stage != null) ? (
                  <div className="bg-muted/40 px-3 py-1 text-micro font-medium uppercase tracking-wider text-muted-foreground">
                    {stage == null
                      ? t(($) => $.stage.none)
                      : t(($) => $.stage.value, { n: stage })}
                  </div>
                ) : null}
                {groupItems.map((child) => (
                  <SubIssueRow
                    key={child.id}
                    child={child}
                    childProgress={subIssueProgress?.get(child.id)}
                    rowProps={subIssueRowProps}
                    customProperties={subIssueCustomProps}
                  />
                ))}
              </Fragment>
            ))}
          </div>
        </section>
      </IssueContextMenuProvider>
    ) : null;

  const soloDiscussion = (
    <>
      <div className="qw-solo-section-head">
        <h2 className="qw-solo-section-title">
          {t(($) => $.detail.discussion_section)}
        </h2>
        <span className="qw-solo-section-count">
          {timeline.filter((entry) => entry.type === "comment").length}
        </span>
      </div>
      <LocalDirectoryHint projectId={issue?.project_id} />
      <div className="qw-solo-timeline">{renderTimeline(discussionItems)}</div>
    </>
  );

  const soloComposer = (
    <div
      ref={composerRef}
      className={cn(
        "qw-solo-composer",
        stickyComposer &&
          "sticky bottom-0 z-10 -mb-4 bg-background pb-4 before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-4 before:bg-gradient-to-t before:from-background before:to-transparent",
      )}
    >
      <CommentInput
        key={id}
        issueId={id}
        onSubmit={submitComment}
        onAccepted={scrollToTimelineBottom}
        variant="solo"
      />
    </div>
  );

  const soloBody = (
    <SoloIssueView
      scrollContainerEl={scrollContainerEl}
      sticky={soloSticky}
      header={soloHeader}
      propsStrip={
        <SoloPropertyStrip issue={issue} onUpdate={handleUpdateField} />
      }
      delivery={soloDelivery}
      brief={soloBrief}
      clarification={<RequirementClarificationCard issue={issue} />}
      execution={<SoloRunLog issueId={id} agentNameOf={getAgentName} />}
      subIssues={soloSubIssues}
      discussion={soloDiscussion}
      composer={soloComposer}
    />
  );

  // ── Refresh archive: the full-route detail layout ─────────────────────
  const refreshCrumb = refreshStep
    ? `${issue.identifier}-${refreshSeq}`
    : issue.identifier;
  const refreshKicker = refreshStep
    ? t(($) => $.detail.refresh_kicker_squad, { seq: refreshSeq ?? 1 })
    : t(($) => $.detail.refresh_kicker_solo);
  const refreshTypeLabel = refreshStep
    ? t(($) => $.detail.refresh_leg_type, {
        seq: refreshSeq ?? 1,
        total: chain?.steps.length ?? 1,
      })
    : t(($) => $.detail.refresh_solo_type);
  const refreshTitle = refreshStep
    ? refreshStep.title || t(($) => $.room.chapter_leg_bare, { seq: refreshSeq ?? 1 })
    : issue.title;
  const refreshStepStateLabel = refreshStep
    ? refreshStep.state === "reviewing"
      ? t(($) => $.room.state_reviewing)
      : refreshStep.state === "done"
        ? t(($) => $.room.state_done)
        : refreshStep.state === "parked"
          ? t(($) => $.room.state_parked)
          : refreshStep.state === "skipped"
            ? t(($) => $.room.state_skipped)
            : refreshStep.state === "doing"
              ? refreshRunState === "queued"
                ? t(($) => $.room.state_waiting)
                : t(($) => $.room.state_doing)
              : t(($) => $.room.state_pending)
    : resolveStatusLabel(issue.status);
  const refreshStateTone = refreshStep
    ? chainStateKey(refreshStep.state) === "reviewing"
      ? "review"
      : chainStateKey(refreshStep.state) === "done" ||
          chainStateKey(refreshStep.state) === "skipped"
        ? "done"
        : chainStateKey(refreshStep.state) === "parked"
          ? "parked"
          : chainStateKey(refreshStep.state) === "doing"
            ? refreshRunState === "queued"
              ? "planned"
              : "running"
            : "planned"
    : issueStatusCategory(issue) === "done"
      ? "done"
      : issueStatusCategory(issue) === "in_review"
        ? "review"
        : issueStatusCategory(issue) === "in_progress"
          ? "running"
          : issueStatusCategory(issue) === "blocked"
            ? "parked"
            : "planned";
  const refreshTime = timeAgo(
    refreshStep
      ? refreshStep.completed_at ?? refreshStep.started_at ?? issue.updated_at
      : issue.updated_at,
  );
  const refreshOwnerName = refreshStep
    ? playerNames.nameOf(refreshStep.holder_user_id)
    : getActorName(issue.creator_type, issue.creator_id);
  const refreshOwnerType = refreshStep ? "member" : issue.creator_type;
  const refreshOwnerId = refreshStep ? refreshStep.holder_user_id : issue.creator_id;
  const refreshParentCode = refreshStep ? issue.identifier : parentIssue?.identifier;
  const refreshParentTitle = refreshStep ? issue.title : parentIssue?.title;
  const refreshPriority = priorityLabel(issue.priority, t);
  const refreshProjectName = breadcrumbProject?.title ?? "—";
  const refreshDueLabel = issue.due_date
    ? formatDateOnly(issue.due_date, { month: "short", day: "numeric" }, locale)
    : t(($) => $.pickers.due_date.none);
  const refreshRunAgentName = refreshRunTask
    ? getAgentName(refreshRunTask.agent_id)
    : refreshStepAgentName ?? refreshOwnerName;
  const refreshRunModel = refreshRunTask?.usage?.[0]?.model ?? "";
  const refreshRunStarted = refreshRunTask
    ? refreshRunTask.started_at ?? refreshRunTask.dispatched_at ?? refreshRunTask.created_at
    : null;
  const refreshRunActive =
    !!refreshRunTask && SOLO_ACTIVE_TASK_STATUSES.has(refreshRunTask.status);
  const refreshDeliveryFile = refreshStep?.handoff?.files?.[0] ?? null;
  const refreshDeliveryAttachment = refreshLegDelivery?.attachments?.[0] ?? null;
  const refreshDeliverySummary =
    refreshStep?.handoff?.summary ?? refreshLegDelivery?.content ?? "";
  const refreshHasDeliverable = !!(
    refreshDeliveryFile ||
    refreshDeliveryAttachment ||
    (refreshStep && refreshDeliverySummary)
  );
  const refreshDeliveryName =
    refreshDeliveryFile?.name ??
    refreshDeliveryAttachment?.filename ??
    (refreshStep?.title || t(($) => $.detail.refresh_output));
  const refreshDeliveryMeta = refreshDeliveryAttachment
    ? `${refreshDeliveryAttachment.content_type} · ${Math.max(1, Math.round(refreshDeliveryAttachment.size_bytes / 1024))} KB`
    : refreshDeliveryFile
      ? `${refreshDeliveryFile.kind ?? "file"}`
      : "";
  const refreshDownloadDeliverable = () => {
    const attachmentId =
      refreshDeliveryFile?.attachment_id ?? refreshDeliveryAttachment?.id;
    if (attachmentId) void downloadAttachment(attachmentId);
  };
  const refreshAllAttachments = soloDeliveredAttachments;
  const refreshDownloadAll = () => {
    refreshAllAttachments.forEach((attachment) => {
      void downloadAttachment(attachment.id);
    });
  };
  const refreshPrimarySquadAction = () => {
    if (!refreshCanApprove) return;
    if (!handoffSummary.trim() && !outputAsked) {
      startLegOutput();
      return;
    }
    approveWithHandoff();
  };
  const refreshSelectStep = (step: NonNullable<typeof refreshStep>) => {
    setOpenLeg(step.position + 1);
    scrollContainerEl?.scrollTo({ top: 0, behavior: "smooth" });
  };
  const refreshComposerStepId =
    refreshStepIsMine && refreshStepHolding ? refreshStep?.id : undefined;
  const refreshComposerPlaceholder = refreshStep
    ? refreshStepHolding && refreshStep.agent_id
      ? t(($) => $.room.composer_mine, {
          agent: getAgentName(refreshStep.agent_id),
        })
      : t(($) => $.room.composer_placeholder)
    : t(($) => $.comment.leave_comment_placeholder);

  const refreshTopbar = (
    <header className="rd-topbar">
      <button
        type="button"
        className="rd-back"
        onClick={() => backOrReplace(paths.tasks())}
      >
        <ChevronLeft className="size-3.5" />
        {t(($) => $.detail.tasks_crumb)}
      </button>
      <span className="rd-crumb">
        {t(($) => $.detail.refresh_crumb_task)} / {refreshCrumb}
      </span>
      <div className="rd-top-actions">
        <button
          type="button"
          className="rd-textbtn"
          onClick={() => {
            void copyText(window.location.href);
            toast.success(t(($) => $.detail.link_copied));
          }}
        >
          {t(($) => $.detail.copy_link)}
        </button>
        {subscriptionKnown ? (
          <button
            type="button"
            className="rd-textbtn"
            disabled={togglePending || !user?.id}
            onClick={handleToggleSubscribe}
          >
            {isSubscribed
              ? t(($) => $.detail.unsubscribe)
              : t(($) => $.detail.subscribe)}
          </button>
        ) : null}
        <IssueActionsDropdown
          issue={issue}
          align="end"
          onDeletedFallbackPath={onDelete ? undefined : paths.tasks()}
          trigger={
            <button type="button" className="rd-iconbtn" aria-label={t(($) => $.detail.refresh_more)}>
              <MoreHorizontal className="size-4" />
            </button>
          }
        />
      </div>
    </header>
  );

  const refreshHeader = (
    <header className="rd-head">
      <div className="rd-kicker">{refreshKicker}</div>
      <div className="rd-title-row">
        <div className="rd-title">
          {refreshStep ? (
            <h2 className="rd-title-text">{refreshTitle}</h2>
          ) : (
            titleEditorBlock
          )}
        </div>
        <div className="rd-head-state" data-state={refreshStateTone}>
          <div className="rd-state-word">
            <i />
            {refreshStepStateLabel}
          </div>
          <span className="rd-state-time">{refreshTime}</span>
        </div>
      </div>
      <div className="rd-meta">
        <ActorAvatar
          actorType={refreshOwnerType}
          actorId={refreshOwnerId}
          size="xs"
          profileLink={false}
        />
        <span>{refreshOwnerName}</span>
        <span className="rd-dot" />
        <span>{refreshTypeLabel}</span>
        {refreshStepAgentName ? (
          <span className="rd-cli-chip">
            <Bot className="size-3" />
            <span>{refreshStepAgentName}</span>
          </span>
        ) : !refreshStep ? (
          <IssueAgentHeaderChip issueId={id} />
        ) : null}
        <span className="rd-dot" />
        <span>{refreshTime}</span>
        {refreshParentCode ? (
          <>
            <span className="rd-dot" />
            <span className="rd-parent">
              {t(($) => $.detail.refresh_parent)} {refreshParentCode}
              {refreshParentTitle ? ` · ${refreshParentTitle}` : ""}
            </span>
          </>
        ) : null}
      </div>
    </header>
  );

  const refreshBrief = (
    <section className="rd-section">
      <div className="rd-section-head">
        <span>{refreshStep
          ? t(($) => $.detail.refresh_this_leg)
          : t(($) => $.detail.refresh_brief)}</span>
        <i />
      </div>
      <div
        {...descDropZoneProps}
        className="rd-brief"
        onFocusCapture={() => {
          if (!descriptionEditingRef.current) descriptionEditingRef.current = true;
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            descriptionEditingRef.current = false;
          }
        }}
      >
        {descriptionEditorBlock}
        {descDragOver && <FileDropOverlay />}
        <div className="rd-brief-facts">
          <span><b>{t(($) => $.detail.prop_project)}</b>{refreshProjectName}</span>
          <span><b>{t(($) => $.detail.prop_priority)}</b>{refreshPriority}</span>
          <span><b>{t(($) => $.detail.prop_due_date)}</b>{refreshDueLabel}</span>
        </div>
      </div>
    </section>
  );

  const refreshRunSection = (
    <section className="rd-section">
      <div className="rd-section-head">
        <span>{t(($) => $.detail.refresh_runlog)}</span>
        <i />
        {refreshRunTask && refreshRunStarted ? (
          <em>
            <LiveDuration
              started={refreshRunStarted}
              completed={refreshRunTask.completed_at}
              active={refreshRunActive}
            />
          </em>
        ) : null}
      </div>
      {refreshRunTask ? (
        <RefreshRunLogCard task={refreshRunTask} agentName={refreshRunAgentName} />
      ) : (
        <p className="rd-empty">{t(($) => $.detail.refresh_no_run)}</p>
      )}
    </section>
  );

  const refreshDeliverable = refreshHasDeliverable ? (
    <section className="rd-section">
      <div className="rd-section-head">
        <span>{t(($) => $.detail.refresh_output)}</span>
        <i />
      </div>
      <div className="rd-deliverable">
        <span className="rd-file-ico">
          {(refreshDeliveryFile?.name.split(".").pop() ??
            refreshDeliveryAttachment?.filename.split(".").pop() ??
            "MD").slice(0, 4).toUpperCase()}
        </span>
        <div className="rd-deliverable-main">
          <div className="rd-deliverable-name">{refreshDeliveryName}</div>
          {refreshDeliveryMeta ? <div className="rd-deliverable-meta">{refreshDeliveryMeta}</div> : null}
          {refreshDeliverySummary ? (
            <div className="rd-deliverable-desc">{refreshDeliverySummary}</div>
          ) : null}
        </div>
        {refreshDeliveryFile?.attachment_id || refreshDeliveryAttachment ? (
          <button type="button" className="rd-deliverable-open" onClick={refreshDownloadDeliverable}>
            {t(($) => $.detail.delivery_download)}
            <ArrowUpRight className="size-3" />
          </button>
        ) : null}
      </div>
    </section>
  ) : null;

  const refreshOutputSection = !refreshStep && soloHasDelivery ? (
    <section className="rd-section rd-output">
      <div className="rd-section-head">
        <span>{t(($) => $.detail.refresh_output)}</span>
        <i />
        <em>
          {t(($) => $.detail.delivery_images, { count: soloImageCount })}
          {" · "}
          {t(($) => $.detail.delivery_files, { count: soloFileCount })}
        </em>
      </div>
      <SoloDeliverySection
        attachments={issueAttachments ?? []}
        state={soloAccepted ? "done" : soloRun?.active ? "running" : "review"}
        showChrome={false}
      />
    </section>
  ) : null;

  const refreshDiscussion = (
    <section className="rd-section rd-discussion">
      <div className="rd-section-head">
        <span>{refreshStep
          ? t(($) => $.detail.refresh_room)
          : t(($) => $.detail.refresh_discussion)}</span>
        <i />
        <em>{refreshDiscussionItems.length}</em>
      </div>
      <div className="rd-timeline">
        {refreshStep && !refreshStepIsMine && refreshDiscussionItems.length === 0 ? (
          <p className="rd-empty">{t(($) => $.room.leg_page_other_note)}</p>
        ) : (
          renderTimeline(refreshDiscussionItems)
        )}
      </div>
      {!refreshStep || refreshStepIsMine ? (
        <div className="rd-composer">
          <CommentInput
            key={`${id}:${refreshStep?.id ?? "solo"}`}
            issueId={id}
            onSubmit={submitComment}
            onAccepted={scrollToTimelineBottom}
            placeholder={refreshComposerPlaceholder}
            chainStepId={refreshComposerStepId}
          />
        </div>
      ) : null}
    </section>
  );

  const refreshSquadRail = refreshStep && chain && relayView ? (
    <>
      <div className="rd-card">
        <div className="rd-card-label">{t(($) => $.detail.refresh_chain)}</div>
        <div className="rd-chain">
          {chain.steps.map((step) => {
            const key = chainStateKey(step.state);
            const selected = step.id === refreshStep.id;
            return (
              <button
                key={step.id}
                type="button"
                className="rd-chain-node"
                data-active={selected ? "" : undefined}
                data-state={key}
                onClick={() => refreshSelectStep(step)}
              >
                <span className="rd-chain-dot" />
                <ActorAvatar
                  actorType="member"
                  actorId={step.holder_user_id}
                  size="xs"
                  profileLink={false}
                  className="rd-chain-ava"
                />
                <span className="rd-chain-main">
                  <b>{playerNames.nameOf(step.holder_user_id)}</b>
                  <span>
                    {t(($) => $.room.chat_leg, {
                      seq: step.position + 1,
                      total: chain.steps.length,
                    })}
                    {step.title ? ` · ${step.title}` : ""}
                  </span>
                </span>
                <span className="rd-chain-state">
                  {step.state === "reviewing"
                    ? t(($) => $.room.state_reviewing)
                    : step.state === "done"
                      ? t(($) => $.room.state_done)
                      : step.state === "doing"
                        ? t(($) => $.room.state_doing)
                        : step.state === "parked"
                          ? t(($) => $.room.state_parked)
                          : t(($) => $.room.state_pending)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rd-card">
        <div className="rd-card-label">{t(($) => $.detail.refresh_state)}</div>
        <div className="rd-rail-state" data-state={refreshStateTone}>
          <i />
          <span className="word">{refreshStepStateLabel}</span>
          <span className="time">{refreshTime}</span>
        </div>
        <div className="rd-next">
          <ActorAvatar
            actorType="member"
            actorId={refreshNextStep?.holder_user_id ?? refreshStep.holder_user_id}
            size="xs"
            profileLink={false}
            className="rd-next-ava"
          />
          <div>
            <b>
              {refreshNextStep
                ? `${t(($) => $.detail.refresh_next)} · ${playerNames.nameOf(refreshNextStep.holder_user_id)}`
                : t(($) => $.room.leg_last_label)}
            </b>
            <span>
              {refreshNextStep
                ? refreshNextStep.agent_id
                  ? t(($) => $.detail.refresh_next)
                  : t(($) => $.room.flow_no_agent)
                : t(($) => $.room.approve_hint_last)}
            </span>
          </div>
          <span className="rd-next-go">{refreshNextStep ? "→" : "✓"}</span>
        </div>
      </div>

      <div className="rd-card rd-facts">
        <div className="rd-fact"><span>OWNER</span><b>{refreshOwnerName}</b></div>
        <div className="rd-fact"><span>PRIORITY</span><b>{refreshPriority}</b></div>
        <div className="rd-fact"><span>{t(($) => $.detail.prop_updated)}</span><b>{refreshTime}</b></div>
        <div className="rd-fact">
          <span>{t(($) => $.room.parent_label)}</span>
          <b>{issue.identifier} · {issue.title}</b>
        </div>
      </div>

      <div className="rd-actions">
        <button
          type="button"
          className="rd-primary"
          disabled={
            !refreshCanApprove ||
            approveChainStep.isPending ||
            outputProducing
          }
          onClick={refreshPrimarySquadAction}
        >
          {refreshCanApprove
            ? outputProducing
              ? t(($) => $.room.output_producing)
              : refreshNextStep
                ? t(($) => $.detail.refresh_pass)
                : t(($) => $.detail.refresh_pass_finish)
            : refreshStep.state === "done"
              ? t(($) => $.detail.refresh_delivered)
              : refreshStep.state === "pending"
                ? t(($) => $.room.state_pending)
                : refreshStep.state === "doing"
                  ? t(($) => $.room.state_doing)
                  : refreshStep.state === "parked"
                    ? t(($) => $.room.state_parked)
                    : refreshStep.state === "skipped"
                      ? t(($) => $.room.state_skipped)
                      : t(($) => $.detail.refresh_waiting_review, {
                          name: playerNames.nameOf(refreshStep.holder_user_id),
                        })}
        </button>
        {refreshCanApprove ? (
          <button
            type="button"
            className="rd-secondary"
            disabled={outputProducing}
            onClick={startLegOutput}
          >
            {outputAsked
              ? t(($) => $.detail.refresh_regenerate)
              : t(($) => $.room.output_generate)}
          </button>
        ) : null}
        <button
          type="button"
          className="rd-delete"
          onClick={() => actions.openDeleteConfirm({ onDeletedFallbackPath: paths.tasks() })}
        >
          {t(($) => $.detail.refresh_delete)}
        </button>
      </div>
    </>
  ) : null;

  const refreshSoloRail = (
    <>
      <div className="rd-card">
        <div className="rd-card-label">{t(($) => $.detail.refresh_task_info)}</div>
        <div className="rd-rail-state" data-state={refreshStateTone}>
          <i />
          <span className="word">{refreshStepStateLabel}</span>
          <span className="time">{refreshTime}</span>
        </div>
        <div className="rd-rail-sub">
          {refreshTypeLabel} · {refreshOwnerName}
        </div>
        <div className="rd-facts rd-facts-tight">
          <div className="rd-fact"><span>OWNER</span><b>{refreshOwnerName}</b></div>
          <div className="rd-fact"><span>PRIORITY</span><b>{refreshPriority}</b></div>
          <div className="rd-fact"><span>CREATED</span><b>{shortDate(issue.created_at, locale)}</b></div>
          <div className="rd-fact"><span>UPDATED</span><b>{shortDate(issue.updated_at, locale)}</b></div>
          <div className="rd-fact"><span>SOURCE</span><b>{t(($) => $.detail.refresh_source_solo)}</b></div>
        </div>
      </div>

      <div className="rd-card">
        <div className="rd-card-label">{t(($) => $.detail.refresh_runtime)}</div>
        {refreshRunTask ? (
          <>
            <div className="rd-runtime">
              <ActorAvatar
                actorType="agent"
                actorId={refreshRunTask.agent_id}
                size="sm"
                profileLink={false}
                className="rd-runtime-ava"
              />
              <div>
                <b>{refreshRunAgentName}</b>
                <span>{refreshRunModel || refreshRunTask.status}</span>
              </div>
            </div>
            <div className="rd-facts rd-facts-tight">
              <div className="rd-fact">
                <span>DURATION</span>
                <b>
                  {refreshRunTask && refreshRunStarted ? (
                    <LiveDuration
                      started={refreshRunStarted}
                      completed={refreshRunTask.completed_at}
                      active={refreshRunActive}
                    />
                  ) : (
                    "—"
                  )}
                </b>
              </div>
              <div className="rd-fact"><span>MODEL</span><b>{refreshRunModel || "—"}</b></div>
            </div>
          </>
        ) : (
          <p className="rd-empty">{t(($) => $.detail.refresh_no_run)}</p>
        )}
      </div>

      <div className="rd-card">
        <div className="rd-card-label">{t(($) => $.detail.refresh_output)}</div>
        {refreshAllAttachments.length > 0 ? (
          <>
            <div className="rd-output-row">
              <span>
                {t(($) => $.detail.delivery_images, { count: soloImageCount })}
                {" · "}
                {t(($) => $.detail.delivery_files, { count: soloFileCount })}
              </span>
              <button type="button" onClick={refreshDownloadAll}>
                {t(($) => $.detail.delivery_download)}
              </button>
            </div>
            <div className="rd-output-list">
              {refreshAllAttachments.slice(0, 4).map((attachment) => (
                <span key={attachment.id}>
                  <FileText className="size-3" />
                  {attachment.filename}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="rd-empty">{t(($) => $.detail.refresh_no_output)}</p>
        )}
      </div>

      <div className="rd-actions">
        <button
          type="button"
          className="rd-primary"
          disabled={soloAccepted}
          onClick={soloHasDelivery ? refreshDownloadAll : acceptDelivery}
        >
          {soloHasDelivery
            ? t(($) => $.detail.delivery_download_all)
            : soloAccepted
              ? t(($) => $.detail.accepted_delivery)
              : t(($) => $.detail.accept_delivery)}
        </button>
        {soloHasDelivery && !soloAccepted ? (
          <button type="button" className="rd-secondary" onClick={acceptDelivery}>
            {t(($) => $.detail.accept_delivery)}
          </button>
        ) : null}
        <button
          type="button"
          className="rd-delete"
          onClick={() => actions.openDeleteConfirm({ onDeletedFallbackPath: paths.tasks() })}
        >
          {t(($) => $.detail.refresh_delete)}
        </button>
      </div>
    </>
  );

  const refreshBody = (
    <div className="rd-enter" key={`${id}:${refreshStep?.id ?? "solo"}`}>
      {refreshHeader}
      <div className="rd-body">
        <div className="rd-canvas">
          {refreshBrief}
          {refreshDeliverable}
          {refreshRunSection}
          {refreshOutputSection}
          {refreshDiscussion}
        </div>
        <aside className="rd-rail">
          {refreshStep ? refreshSquadRail : refreshSoloRail}
        </aside>
      </div>
    </div>
  );

  const detailContent = (
    // Hosts the one image viewer this issue's images page through — see
    // ImageSequenceProvider. Wraps the whole column so the description
    // editor's images and the timeline's images share one sequence.
    <CurrentIssueRenderContextProvider value={currentIssueRenderContext}>
    <ImageSequenceProvider items={imageSequence}>
    <div className="relative flex h-full min-w-0 flex-1 flex-col">
        {/* In-page find bar — floats over the top-right of the content column
            (below the breadcrumb header), outside the scroll container so it
            stays put while the timeline scrolls and its own text isn't walked.
            z-30: must beat every sticky affordance pinned at the timeline's
            top-0 (comment headers z-10, resolve collapse bars z-20) — at equal
            z the later-in-DOM sticky bar paints over the find bar and orphans
            its close button (MUL-4414). On desktop it also steps inside the
            thread rail's right-edge strip, so an open find bar can't cover
            the topmost ticks. */}
        {find.open && (
          <FindBar
            find={find}
            className={cn(layout === "refresh" || isRoom ? "absolute top-14 z-30" : "absolute top-4 z-30", isMobile ? "right-4" : "right-10")}
          />
        )}
        {layout === "refresh" ? refreshTopbar : isRoom && (
        <BreadcrumbHeader
          leading={leadingAction}
          className="border-b border-border/60"
          segments={breadcrumbSegments}
          leaf={
            <AppLink
              href={paths.issueDetail(issue.id)}
              className="flex min-w-0 items-center gap-2 transition-opacity hover:opacity-80"
            >
              {/* The identifier reads as a machine handle, not a word: mono
                  in its own bordered chip, the way this product writes ids
                  everywhere else. */}
              <span className="shrink-0 rounded-[4px] border border-border bg-muted/50 px-1.5 py-px font-mono text-micro text-muted-foreground">
                {issue.identifier}
              </span>
              <span className="truncate font-medium text-foreground">
                {issue.title}
              </span>
            </AppLink>
          }
          actions={
            <>
            {/* Solo tasks keep the live "agent is working" chip here. A relay
                task does not: the run belongs to one leg, so the signal lives
                on that leg's chapter instead of floating in the chrome. */}
            {!isRoom ? <IssueAgentHeaderChip issueId={id} /> : null}
            {/* Thread navigator. Leftmost of the action buttons because it
                navigates the document, while everything to its right acts on
                the issue. Hidden on mobile with the rail: the panel would work
                there, but it needs a sheet rather than a popover to be usable
                one-handed, which is its own change. */}
            {!isMobile && (
              <ThreadNavPanel
                threads={minimapThreads}
                onJump={jumpToThread}
                onHoverThread={setThreadNavHoverId}
                open={threadNavOpen}
                pinned={threadNavPinned}
                onOpenChange={handleThreadNavOpenChange}
              />
            )}
            {onDone && !isRoom && !issueBehavesAsAny(issue, ["done", "cancelled"]) && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon-sm"
                      className="text-muted-foreground"
                      onClick={() => { handleUpdateField({ status: "done" }); onDone?.(); }}
                    >
                      <CircleCheck />
                    </Button>
                  }
                />
                <TooltipContent side="bottom">{t(($) => $.detail.mark_done_tooltip)}</TooltipContent>
              </Tooltip>
            )}
            {onDone && issueBehavesAs(issue, "done") && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon-sm"
                      className="text-muted-foreground"
                      onClick={() => { onDone(); }}
                    >
                      <Archive />
                    </Button>
                  }
                />
                <TooltipContent side="bottom">{t(($) => $.detail.archive_tooltip)}</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon-sm"
                    className={cn("text-muted-foreground", actions.isPinned && "text-foreground")}
                    onClick={actions.togglePin}
                  >
                    {actions.isPinned ? <PinOff /> : <Pin />}
                  </Button>
                }
              />
              <TooltipContent side="bottom">{actions.isPinned ? t(($) => $.detail.unpin_tooltip) : t(($) => $.detail.pin_tooltip)}</TooltipContent>
            </Tooltip>
            <IssueActionsDropdown
              issue={issue}
              align="end"
              // When a parent passes `onDelete`, we detect deletion via effect
              // above and skip navigation. Otherwise the modal takes us back
              // to the list we came from, falling back to all issues.
              onDeletedFallbackPath={onDelete ? undefined : paths.tasks()}
              trigger={
                <Button variant="outline" size="icon-sm" className="text-muted-foreground">
                  <MoreHorizontal />
                </Button>
              }
            />
            </>
          }
        />
        )}

        {/* scrollbar-gutter both-edges: with classic (space-taking) scrollbars —
            macOS with a mouse or "always show", Windows, Linux — the global
            `scrollbar-width: thin` carves ~11px off the right side only, so the
            centered column reads 32px left vs 43px right (MUL-4404). Mirroring
            the gutter restores symmetry; overlay-scrollbar platforms reserve
            nothing and render unchanged. */}
        <div
          ref={attachScrollContainer}
          data-tab-scroll-root={scrollContainerKey}
          className="relative flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]"
        >
        {/* Gutters: 32px is a comfortable reading margin on a desktop column
            but eats 16% of a 393px phone, so below `md` they drop to 12px.
            `max-md:pb-chat-launcher` reserves the launcher's corner at the end
            of the scroll: below `md` the composer is not pinned (see
            `useStickyComposer`), so it lands here — right where the launcher
            floats — once the reader scrolls to the bottom.
            Width: a relay page has no properties rail beside it (see the
            isRoom branch below), so the 4xl reading column would just strand
            space on both sides of the screen — it uses the room there is
            (capped at 1400px so an ultrawide monitor still reads). Plain
            issues keep the capped column their side panel pairs with. */}
        <div
          data-issue-column
          className={layout === "refresh"
            ? "rd-content"
            : cn(
                "mx-auto w-full px-3 py-6 max-md:pb-chat-launcher md:px-8 md:py-8",
                isRoom ? "max-w-[1400px]" : "max-w-[1352px]",
              )}
        >
          {/* A subtask page replaces the whole column: the leg's own dialog,
              plan and outputs. The parent mast belongs to the parent page. */}
          {layout === "refresh" ? refreshBody : isRoom && chain && relayView && openLegStep ? (
            legSubtaskBody
          ) : isRoom ? (
          <>
          {titleEditorBlock}

          {!isRoom ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-caption text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-0.5">
                <StatusIcon
                  status={issue.status}
                  category={issueStatusCategory(issue) ?? undefined}
                  className="h-3.5 w-3.5 shrink-0"
                />
                <span className="text-foreground">
                  {resolveStatusLabel(issue.status)}
                </span>
              </span>
              {issue.assignee_type && issue.assignee_id ? (
                <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-muted/60 px-2 py-0.5">
                  <ActorAvatar
                    actorType={issue.assignee_type}
                    actorId={issue.assignee_id}
                    size="sm"
                    profileLink={false}
                  />
                  <span className="truncate text-foreground">
                    {getActorName(issue.assignee_type, issue.assignee_id)}
                  </span>
                </span>
              ) : null}
              <span className="font-mono text-micro">
                {t(($) => $.detail.prop_created)}{" "}
                {shortDate(issue.created_at, locale)}
              </span>
              <span className="font-mono text-micro">
                {t(($) => $.detail.prop_updated)}{" "}
                {shortDate(issue.updated_at, locale)}
              </span>
            </div>
          ) : null}

          {parentLinkBlock}
          {isRoom && chain && relayView ? (
            <RelayMetaRow
              subtaskCount={chain.steps.length}
              createdLabel={shortDate(issue.created_at, locale)}
              runsCount={relayRunsCount}
            />
          ) : null}

          <div
            {...descDropZoneProps}
            className={cn(
              "relative mt-5 rounded-lg",
              // On a relay task the description is the shared context of the
              // whole relay — everyone works from it — so it reads as a
              // labelled callout, not a bare document body. A solo task gets
              // the same card treatment so both task kinds share one surface
              // language.
              isRoom &&
                "border border-surface-border border-l-[3px] border-l-brand bg-brand/5 px-4 py-3 shadow-[var(--shadow-surface)]",
              !isRoom &&
                "border border-surface-border bg-surface px-4 py-3 shadow-[var(--shadow-surface)]",
            )}
            onFocusCapture={() => {
              if (!descriptionEditingRef.current) {
                descriptionEditingRef.current = true;
              }
            }}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                descriptionEditingRef.current = false;
              }
            }}
          >
            {isRoom ? (
              <div className="mb-2 flex items-center gap-2 text-caption font-semibold text-muted-foreground">
                <Flag className="size-3.5" />
                {t(($) => $.room.ctx_title)}
                <span className="grow" />
                <span className="rounded-full bg-muted px-1.5 text-micro font-normal">
                  {t(($) => $.room.ctx_shared)}
                </span>
              </div>
            ) : (
              <div className="mb-2 flex items-center gap-2 text-caption font-semibold text-muted-foreground">
                {t(($) => $.detail.section_description)}
              </div>
            )}
            {descriptionEditorBlock}
            {descDragOver && <FileDropOverlay />}
          </div>

          {/* Sub-issues — a solo-task structure. A relay's legs ARE its
              substructure, so squad tasks never offer the affordance. */}
          {!isRoom && childIssues.length === 0 && (
            <div className="mt-6">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-caption text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => actions.openCreateSubIssue()}
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{t(($) => $.detail.add_sub_issues)}</span>
              </button>
            </div>
          )}
          {childIssues.length > 0 && (() => {
            const doneCount = childIssues.filter((c) => issueBehavesAs(c, "done")).length;
            return (
              // Provider hosts the shared right-click actions menu the rows
              // delegate to (one singleton menu, not one per row).
              <IssueContextMenuProvider>
              <div className="mt-10 group/sub-issues">
                {/* Header */}
                <div className="flex items-center gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setSubIssuesCollapsed((v) => !v)}
                    className="flex items-center gap-1.5 text-body font-medium text-foreground hover:text-foreground/80 transition-colors"
                  >
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 text-muted-foreground transition-transform",
                        subIssuesCollapsed && "-rotate-90",
                      )}
                    />
                    <span>{t(($) => $.detail.sub_issues_label)}</span>
                  </button>
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2 py-0.5">
                    <ProgressRing done={doneCount} total={childIssues.length} size={11} />
                    <span className="text-micro text-muted-foreground tabular-nums font-medium">
                      {doneCount}/{childIssues.length}
                    </span>
                  </div>
                  {/* issue.id, not the route param — the endpoint takes a
                      UUID and the route may carry a human-readable id. */}
                  <SubIssuesAgentWorkingChip parentIssueId={issue.id} />
                  <input
                    type="checkbox"
                    checked={allChildrenSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someChildrenSelected && !allChildrenSelected;
                    }}
                    onChange={handleToggleSelectAllChildren}
                    aria-label={t(($) => $.detail.select_all_sub_issues_aria)}
                    className={cn(
                      "ml-1 cursor-pointer accent-primary transition-opacity",
                      someChildrenSelected
                        ? "opacity-100"
                        : "opacity-0 group-hover/sub-issues:opacity-100 focus-visible:opacity-100",
                    )}
                  />
                  <div className="ml-auto flex items-center gap-0.5">
                    <SubIssueDisplayPopover workspaceProperties={activeWorkspaceProperties} />
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                            onClick={() => actions.openCreateSubIssue()}
                            aria-label={t(($) => $.detail.add_sub_issue_aria)}
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        }
                      />
                      <TooltipContent side="bottom">{t(($) => $.detail.add_sub_issue_tooltip)}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>

                {/* Inline batch toolbar — appears next to the rows when
                    selections exist, instead of as a far-away fixed bar. */}
                <BatchActionToolbar issues={childIssues} placement="inline" />

                {/* List */}
                {!subIssuesCollapsed && (() => {
                  const groups = groupSubIssuesByStage(childIssues);
                  const staged = childIssues.some((c) => c.stage != null);
                  return (
                    <div className="overflow-hidden rounded-lg border bg-card/30 divide-y divide-border/60">
                      {groups.map(({ stage: groupStage, items }) => (
                        <Fragment key={groupStage ?? "unstaged"}>
                          {staged && (
                            <div className="bg-muted/40 px-3 py-1 text-micro font-medium uppercase tracking-wider text-muted-foreground">
                              {groupStage == null
                                ? t(($) => $.stage.none)
                                : t(($) => $.stage.value, { n: groupStage })}
                            </div>
                          )}
                          {items.map((child) => (
                            <SubIssueRow
                              key={child.id}
                              child={child}
                              childProgress={subIssueProgress?.get(child.id)}
                              rowProps={subIssueRowProps}
                              customProperties={subIssueCustomProps}
                            />
                          ))}
                        </Fragment>
                      ))}
                    </div>
                  );
                })()}
              </div>
              </IssueContextMenuProvider>
            );
          })()}

          <div className="my-8 border-t" />

          {isRoom && chain && relayView ? (
            <>
              <RelayFlowRail
                chain={chain}
                view={relayView}
                issueId={id}
                tasks={relayTasks}
                nameOf={playerNames.nameOf}
                identifier={issue.identifier}
              />
              <SubtaskList
                chain={chain}
                view={relayView}
                issueId={id}
                tasks={relayTasks}
                nameOf={playerNames.nameOf}
                identifier={issue.identifier}
                formatTime={(iso) => shortDate(iso, locale)}
                onOpenLeg={(seq) => setOpenLeg(seq)}
              />
              <div className="my-8 border-t" />
              {roomStream}
              <div className="my-8 border-t" />
              {/* The full relay record, at the bottom of the page. */}
              <RelayLogSection
                chain={chain}
                issueId={id}
                tasks={relayTasks}
                nameOf={playerNames.nameOf}
                agentNameOf={getAgentName}
                createdAt={issue.created_at}
                currentUserId={user?.id}
                squadName={roomSquadName}
                attachmentOf={attachmentOf}
                action={subscriptionControls}
              />
            </>
          ) : (
            <>
          <div>
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <h2 className="text-title-sm font-semibold">{t(($) => $.detail.activity_section)}</h2>
              </div>
              <div className="flex items-center gap-2">
                {subscriptionControls}
              </div>
            </div>

            <LocalDirectoryHint projectId={issue?.project_id} />

            {/* The "agent is working" live signal now lives in the header
                (IssueAgentHeaderChip) so it stays in one fixed place and
                doesn't compete with sticky banners in this content column.
                The per-task timeline + past runs live in the right panel
                via ExecutionLogSection. */}

            {/* Timeline entries — virtualized via react-virtuoso to keep
                first-paint cost O(viewport) instead of O(N). On a 500-comment
                issue the unvirtualized .map froze the page for several
                seconds (markdown parse + lowlight code highlight runs per
                CommentCard on mount).

                customScrollParent guard: callback ref populates after the
                first commit. Without this null guard Virtuoso falls back to
                its own scroller, grabs 0 height inside overflow-y-auto, and
                miscomputes total-height on first paint. */}
            {renderTimeline(items)}
          </div>
            </>
          )}
          </>
          ) : (
            soloBody
          )}

          {/* Bottom comment input — no avatar, full width. Direct child of
              the content column (not the Activity section): a sticky box
              can't leave its containing block, and the Activity div only
              spans the timeline — at column level `sticky bottom-0` can pin
              the composer across the whole scroll range.

              Sticky treatment mirrors list-grid's sticky header, bottom
              edge: opaque bg-background under/around the card (its rounded
              corners would otherwise leak scrolled text), a 16px gradient
              fade above (exactly the mt-4 gap, so at rest it sits over the
              page background and is invisible), and pb-4 so the card floats
              off the viewport edge — with -mb-4 giving the padding back to
              the column's py-8 so the at-rest layout doesn't shift. */}
          {layout !== "refresh" && isRoom && (isRoom && openLegStep && !openLegHolding ? null : (
          <div
            ref={composerRef}
            className={cn(
              "mt-4",
              stickyComposer &&
                "sticky bottom-0 z-10 -mb-4 bg-background pb-4 before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-4 before:bg-gradient-to-t before:from-background before:to-transparent",
            )}
          >
            {/* key={id}: web's /issues/[id] route doesn't remount on
                issueId change, so without an explicit key the editor
                keeps the previous issue's in-memory content and the
                next keystroke would flush it into the new issue's
                draft key. */}
            <CommentInput
              key={id}
              issueId={id}
              onSubmit={submitComment}
              onAccepted={scrollToTimelineBottom}
              placeholder={roomComposerPlaceholder}
              chainStepId={composerLegScopeId}
            />
          </div>
          ))}
        </div>
        </div>

        {/* Thread quick-jump rail — rides the scroll container's right edge,
            next to the scrollbar, where the pointer already is while
            scrolling (MUL-4522). right-3 is the inset that works in both
            scrollbar modes: it clears a classic scrollbar's ~11px gutter,
            and the rail's own 20px width lands it exactly on the content
            column's px-8 padding when the gutter is 0 (overlay scrollbars),
            so it covers neither the scrollbar nor body text. It also clears
            the resize handle's 4px drag strip at the panel edge. Hover
            previews a thread, click jumps to it. Hidden on mobile: no
            hover, and the gutter is too tight. */}
        {!isMobile && layout !== "refresh" && (
          <ThreadMinimap
            threads={minimapThreads}
            scrollContainerEl={scrollContainerEl}
            onJump={jumpToThread}
            highlightedThreadId={threadNavHoverId}
            className="absolute bottom-0 right-3 top-12"
          />
        )}
      </div>
    </ImageSequenceProvider>
    </CurrentIssueRenderContextProvider>
  );

  return <div className="flex flex-1 min-h-0">{detailContent}</div>;
}
