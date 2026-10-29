"use client";

import { issueStatusCategory } from "@quickwork/core/issues";
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@quickwork/ui/lib/utils";
import { useScrollFade } from "@quickwork/ui/hooks/use-scroll-fade";
import { AppLink, useNavigation, useNavigationActions } from "../navigation";
import { HelpLauncher } from "./help-launcher";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Layers,
  ChevronDown,
  ChevronRight,
  CircleUser,
  LogOut,
  Plus,
  Check,
  Settings,
  SquarePen,
  Users,
  X,
} from "lucide-react";
import { WorkspaceAvatar } from "../workspace/workspace-avatar";
import { ActorAvatar } from "@quickwork/ui/components/common/actor-avatar";
import { Tooltip, TooltipTrigger, TooltipContent } from "@quickwork/ui/components/ui/tooltip";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@quickwork/ui/components/ui/collapsible";
import { CappedNumberFlow } from "@quickwork/ui/components/ui/number-flow";
import { StatusIcon } from "../issues/components/status-icon";
import { useIssueDraftStore } from "@quickwork/core/issues/stores/draft-store";
import { openCreateIssue } from "@quickwork/core/issues/stores/create-mode-store";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@quickwork/ui/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@quickwork/ui/components/ui/dropdown-menu";
import { useAuthStore } from "@quickwork/core/auth";
import { issueViewDetailOptions } from "@quickwork/core/issue-views/queries";
import {
  issueViewContainerKey,
  useActiveIssueViewStore,
} from "@quickwork/core/issue-views/active-view-store";
import { useCurrentWorkspace, useWorkspacePaths, paths } from "@quickwork/core/paths";
import { workspaceListOptions, myInvitationListOptions, workspaceKeys } from "@quickwork/core/workspace/queries";
import { resolvePublicFileUrl } from "@quickwork/core/workspace/avatar-url";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { inboxKeys, deduplicateInboxItems, inboxUnreadSummaryOptions, hasOtherWorkspaceUnread, unreadWorkspaceIds } from "@quickwork/core/inbox/queries";
import { api, ApiError } from "@quickwork/core/api";
import { useConfigStore } from "@quickwork/core/config";
import { pinListOptions } from "@quickwork/core/pins/queries";
import { useDeletePin, useReorderPins } from "@quickwork/core/pins/mutations";
import { issueDetailOptions } from "@quickwork/core/issues/queries";
import { projectDetailOptions } from "@quickwork/core/projects/queries";
import type { PinnedItem } from "@quickwork/core/types";
import { useLogout } from "../auth";
import { ProjectIcon } from "../projects/components/project-icon";
import { routeIconForPath } from "./route-icon-components";
import { useRunningWork, type RunningWork } from "./sidebar-running-runs";
import { useT } from "../i18n";
import {
  useShortcut,
} from "@quickwork/core/shortcuts";
import { ShortcutKeycaps } from "../common/shortcut-keycaps";

// Top-level nav items stay active when the user is on a child route
// (e.g. "Projects" stays lit on /:slug/projects/:id). Pinned items keep
// strict equality elsewhere — a pinned project shouldn't highlight on
// sub-pages of itself.
function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * Shared by all four nav groups. The V3 card skin: each row is its own
 * rounded card, the icon sits in a tinted tile, and the selected one floats
 * (surface fill + border + shadow) with a brand rail on the sidebar's edge.
 *
 * Hover paints a card too, so selection survives it on the dimensions hover
 * does not touch: the shadow, the rail, the weight, and the text color. A
 * selected row keeps its surface fill while hovered (`data-active:hover:`)
 * rather than falling back to the hover tint.
 */
const NAV_BUTTON_CLASS =
  "my-px h-[36px] gap-[9px] rounded-[4px] border border-transparent " +
  "px-[8px] py-0 text-[14px] font-medium text-muted-foreground " +
  "hover:not-data-active:bg-foreground/5 hover:not-data-active:text-foreground " +
  "data-active:border-border data-active:bg-surface data-active:text-foreground " +
  "data-active:font-semibold data-active:hover:bg-surface data-active:hover:text-foreground " +
  "data-active:hover:border-border";

function NavTile({
  Icon,
  active,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  active: boolean;
}) {
  return (
    <Icon
      className={cn(
        "!size-[15px] shrink-0",
        active ? "text-brand" : "text-muted-foreground",
      )}
    />
  );
}

/** The one rail that travels between nav rows instead of being mounted per row. */
function SidebarBaton() {
  const { pathname } = useNavigation();
  const batonRef = useRef<HTMLElement>(null);
  const positioned = useRef(false);

  useLayoutEffect(() => {
    const baton = batonRef.current;
    // Measure against the baton's actual parent: the sidebar content can be
    // remounted by the responsive shell, and a ref captured at mount would
    // then point at a detached node.
    const container = baton?.parentElement;
    if (!container || !baton) return;
    let frame = 0;
    let retry = 0;
    let retries = 0;

    const position = () => {
      const active = container.querySelector<HTMLElement>('[data-sidebar-active="true"]');
      if (!active || !active.offsetHeight) {
        baton.style.opacity = "0";
        if (retries++ < 50) {
          window.clearTimeout(retry);
          retry = window.setTimeout(() => {
            frame = requestAnimationFrame(position);
          }, 100);
        }
        return;
      }
      const c = container.getBoundingClientRect();
      const a = active.getBoundingClientRect();
      const top = a.top - c.top + container.scrollTop + a.height / 2 - baton.offsetHeight / 2;
      if (!positioned.current) {
        baton.style.transition = "none";
        positioned.current = true;
      }
      baton.style.opacity = "1";
      baton.style.transform = `translateY(${top}px)`;
      if (baton.style.transition === "none") {
        requestAnimationFrame(() => {
          baton.style.transition = "";
        });
      }
    };

    position();
    // The nav items mount after workspace data resolves, and config groups
    // expand/collapse; keep the rail attached to the current item.
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(position);
    });
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-sidebar-active"],
    });
    window.addEventListener("resize", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.clearTimeout(retry);
      cancelAnimationFrame(frame);
    };
  }, [pathname]);

  return (
    <i
      ref={batonRef}
      aria-hidden="true"
      className="pointer-events-none absolute left-0 top-0 z-[3] h-[15px] w-[3px] rounded-[1px] bg-brand opacity-0 transition-transform duration-[280ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
    />
  );
}

/** Group headings: small, spaced, with a hairline running to the edge. */
const GROUP_LABEL_CLASS =
  "qw-sidebar-mono mt-1 h-auto gap-2 px-[8px] pt-[10px] pb-[6px] text-[10px] font-medium uppercase " +
  "tracking-[0.10em] text-muted-foreground after:h-px after:flex-1 after:bg-border";

/**
 * The one number a nav row is worth. Only the two surfaces that actually hold
 * live work carry one: a count on every row is noise that trains people to stop
 * reading any of them.
 */
function navCountText(
  work: RunningWork,
  t: ReturnType<typeof useT<"layout">>["t"],
): Partial<Record<NavKey, { text: string; hot: boolean }>> {
  const counts: Partial<Record<NavKey, { text: string; hot: boolean }>> = {};
  if (work.runs.length > 0) {
    counts.tasks = {
      text: t(($) => $.sidebar.nav_running, { count: work.runs.length }),
      hot: true,
    };
  }
  if (work.busyAgents > 0) {
    counts.agents = {
      text: t(($) => $.sidebar.nav_busy, { count: work.busyAgents }),
      hot: true,
    };
  }
  return counts;
}

function NavCount({ text, hot }: { text: string; hot: boolean }) {
  return (
    <span
      className={cn(
        "ml-auto shrink-0 font-mono text-[11px] tabular-nums",
        hot ? "text-inflight" : "text-faint-foreground",
      )}
    >
      {text}
    </span>
  );
}

// Stable empty arrays for query defaults. Using an inline `= []` default on
// `useQuery` creates a new array reference on every render when `data` is
// undefined (e.g. query disabled or loading) — which in turn breaks any
// `useEffect`/`useMemo` that depends on the value, and can trigger infinite
// re-render loops when the effect itself calls `setState`.
const EMPTY_PINS: PinnedItem[] = [];
const EMPTY_WORKSPACES: Awaited<ReturnType<typeof api.listWorkspaces>> = [];
const EMPTY_INVITATIONS: Awaited<ReturnType<typeof api.listMyInvitations>> = [];
const EMPTY_INBOX: Awaited<ReturnType<typeof api.listInbox>> = [];
const EMPTY_INBOX_SUMMARY: Awaited<ReturnType<typeof api.getInboxUnreadSummary>> = [];

// Nav items reference WorkspacePaths method names so they can be resolved
// against the current workspace slug at render time (see AppSidebar body).
// Only parameterless paths are valid nav destinations.
type NavKey =
  | "inbox"
  | "activity"
  | "knowledge"
  | "tasks"
  | "projects"
  | "autopilots"
  | "agents"
  | "squads"
  | "usage"
  | "runtimes"
  | "skills"
  | "config"
  | "models"
  | "mcp"
  | "github"
  | "integrations"
  | "tokens"
  | "settings";

// Static schema (key only) — labels resolved at render via useT("layout"),
// icons derived from the destination path via routeIconForPath.
type NavLabelKey =
  | "inbox"
  | "activity"
  | "knowledge"
  | "tasks"
  | "projects"
  | "autopilots"
  | "agents"
  | "squads"
  | "usage"
  | "runtimes"
  | "skills"
  | "config"
  | "models"
  | "mcp"
  | "github"
  | "integrations"
  | "tokens"
  | "settings";

// Nav icons are NOT declared here: they are derived from each item's
// destination path at render time, so the sidebar and the desktop tab bar
// always agree. See route-icon-components.tsx.
const workspaceNav: { key: NavKey; labelKey: NavLabelKey }[] = [
  { key: "activity", labelKey: "activity" },
  { key: "tasks", labelKey: "tasks" },
  { key: "projects", labelKey: "projects" },
  { key: "autopilots", labelKey: "autopilots" },
  { key: "agents", labelKey: "agents" },
  { key: "squads", labelKey: "squads" },
  { key: "knowledge", labelKey: "knowledge" },
  { key: "usage", labelKey: "usage" },
];

const configureNav: { key: NavKey; labelKey: NavLabelKey }[] = [
  { key: "config", labelKey: "config" },
  { key: "models", labelKey: "models" },
  { key: "runtimes", labelKey: "runtimes" },
  { key: "skills", labelKey: "skills" },
  { key: "mcp", labelKey: "mcp" },
  { key: "github", labelKey: "github" },
  { key: "integrations", labelKey: "integrations" },
  { key: "tokens", labelKey: "tokens" },
];

function DraftDot() {
  const hasDraft = useIssueDraftStore((s) => s.hasDraft());
  if (!hasDraft) return null;
  return <span className="absolute top-0 right-0 size-1.5 rounded-full bg-brand" />;
}

/**
 * Presentational pin row. The `label` and `iconNode` are computed by the
 * parent `PinRow` from cached issue / project detail queries — keeping
 * this component dumb means the dnd-kit / navigation wiring lives in
 * one place and the data flow is explicit.
 */
function SortablePinItem({
  pin,
  href,
  pathname,
  onUnpin,
  label,
  iconNode,
  onNavigate,
  isActiveOverride,
}: {
  pin: PinnedItem;
  href: string;
  pathname: string;
  onUnpin: () => void;
  label: string;
  iconNode: React.ReactNode;
  /** Runs on a real click (not a drag-release) before navigation. */
  onNavigate?: () => void;
  /** Overrides the plain path comparison (view pins carry extra state). */
  isActiveOverride?: boolean;
}) {
  const { t } = useT("layout");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: pin.id });
  const wasDragged = useRef(false);

  useEffect(() => {
    if (isDragging) wasDragged.current = true;
  }, [isDragging]);

  const style = { transform: CSS.Transform.toString(transform), transition };
  const isActive = isActiveOverride ?? pathname === href;

  return (
    <SidebarMenuItem
      ref={setNodeRef}
      style={style}
      className={cn("group/pin", isDragging && "opacity-30")}
      {...attributes}
      {...listeners}
    >
      <SidebarMenuButton
        size="sm"
        isActive={isActive}
        render={<AppLink href={href} newTabTitle={label} draggable={false} />}
        onClick={(event) => {
          if (wasDragged.current) {
            wasDragged.current = false;
            event.preventDefault();
            return;
          }
          onNavigate?.();
        }}
        className={cn(
          "text-muted-foreground hover:not-data-active:bg-sidebar-accent/70 data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground",
          isDragging && "pointer-events-none",
        )}
      >
        {iconNode}
        <span
          className="min-w-0 flex-1 overflow-hidden whitespace-nowrap"
          style={{
            maskImage: "linear-gradient(to right, black calc(100% - 12px), transparent)",
            WebkitMaskImage: "linear-gradient(to right, black calc(100% - 12px), transparent)",
          }}
        >{label}</span>
        <Tooltip>
          <TooltipTrigger
            render={<span role="button" />}
            className="hidden size-2.5 shrink-0 items-center justify-center rounded-sm text-muted-foreground group-hover/pin:flex hover:text-foreground"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onUnpin();
            }}
          >
            <X className="size-1" />
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>{t(($) => $.sidebar.unpin_tooltip)}</TooltipContent>
        </Tooltip>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * Smart wrapper that resolves a pin's display data (label + status/icon)
 * from the issue / project detail query cache. Both queries are declared
 * unconditionally with `enabled` gates so the hook order stays stable
 * regardless of `pin.item_type`.
 *
 * Loading: render a flat skeleton so the sidebar height doesn't jump.
 * Missing (deleted item / 404): render nothing — the row hides itself
 * until the user unpins manually or a server-side cascade catches up.
 */
function PinRow({
  pin,
  href,
  pathname,
  onUnpin,
  wsId,
}: {
  pin: PinnedItem;
  href: string;
  pathname: string;
  onUnpin: () => void;
  wsId: string;
}) {
  const isIssue = pin.item_type === "issue";
  const isView = pin.item_type === "view";
  const p = useWorkspacePaths();
  const setActiveView = useActiveIssueViewStore((s) => s.setActive);
  const issueQuery = useQuery({
    ...issueDetailOptions(wsId, pin.item_id),
    enabled: isIssue,
  });
  const projectQuery = useQuery({
    ...projectDetailOptions(wsId, pin.item_id),
    enabled: pin.item_type === "project",
  });
  const viewQuery = useQuery({
    ...issueViewDetailOptions(wsId, pin.item_id),
    enabled: isView,
  });

  const triggeredRef = useRef(false);
  useEffect(() => {
    // Views are exempt from 404-auto-unpin: an installed desktop client
    // talking to an older backend without the view endpoints sees 404 for
    // every view pin — auto-unpinning would permanently delete them all.
    // A deleted view's row simply hides instead.
    if (isView) return;
    const err = isIssue ? issueQuery.error : projectQuery.error;
    if (err instanceof ApiError && err.status === 404 && !triggeredRef.current) {
      triggeredRef.current = true;
      onUnpin();
    }
  }, [isIssue, isView, issueQuery.error, onUnpin, projectQuery.error]);

  const activeViewByContainer = useActiveIssueViewStore((s) => s.active);
  if (isView) {
    if (viewQuery.isPending) return <PinSkeleton />;
    if (viewQuery.isError || !viewQuery.data) return null;
    const view = viewQuery.data;
    // One resolved scope drives the path AND the container key so an
    // unrecognised scope_type from a newer backend degrades coherently.
    const scopeType: "workspace" | "my" | "project" =
      view.scope_type === "my"
        ? "my"
        : view.scope_type === "project" && view.scope_id
          ? "project"
          : "workspace";
    const viewPath =
      scopeType === "my"
        ? p.myIssues()
        : scopeType === "project"
          ? p.projectDetail(view.scope_id!)
          : p.tasks();
    const containerKey = issueViewContainerKey(wsId, {
      scope_type: scopeType,
      scope_id: scopeType === "project" ? view.scope_id : null,
    });
    return (
      <SortablePinItem
        pin={pin}
        // ?view= keeps a web reload on the view for the surfaces that mount
        // the URL-sync hook (/my-issues). Workspace-scoped saved views now open
        // the task feed, which does not read the query yet; project pages
        // don't sync either. Click-through activation still works everywhere
        // the surface mounts the hook.
        href={`${viewPath}?view=${view.id}`}
        pathname={pathname}
        onUnpin={onUnpin}
        label={view.name}
        iconNode={<Layers className="!size-3.5 shrink-0" />}
        // Active only when this exact view is open on its surface — the
        // path alone also matches the plain tab.
        isActiveOverride={
          pathname === viewPath && activeViewByContainer[containerKey] === view.id
        }
        onNavigate={() => setActiveView(containerKey, view.id)}
      />
    );
  }

  if (isIssue) {
    if (issueQuery.isPending) return <PinSkeleton />;
    if (issueQuery.isError || !issueQuery.data) return null;
    const issue = issueQuery.data;
    const label = issue.title;
    const iconNode = (
      /* Override parent [&_svg]:size-4 — pinned items need smaller icons to match sm size */
      <StatusIcon
        status={issue.status}
        category={issueStatusCategory(issue) ?? undefined}
        className="!size-3.5 shrink-0"
      />
    );
    return (
      <SortablePinItem
        pin={pin}
        href={href}
        pathname={pathname}
        onUnpin={onUnpin}
        label={label}
        iconNode={iconNode}
      />
    );
  }

  if (projectQuery.isPending) return <PinSkeleton />;
  if (projectQuery.isError || !projectQuery.data) return null;
  const project = projectQuery.data;
  const iconNode = <ProjectIcon project={project} size="sm" />;
  return (
    <SortablePinItem
      pin={pin}
      href={href}
      pathname={pathname}
      onUnpin={onUnpin}
      label={project.title}
      iconNode={iconNode}
    />
  );
}

function PinSkeleton() {
  return (
    <SidebarMenuItem>
      <div className="flex h-7 w-full items-center gap-2 px-2">
        <div className="size-3.5 shrink-0 rounded-sm bg-sidebar-accent/40" />
        <div className="h-3 w-24 rounded bg-sidebar-accent/40" />
      </div>
    </SidebarMenuItem>
  );
}

interface AppSidebarProps {
  /** Rendered above SidebarHeader (e.g. desktop traffic light spacer) */
  topSlot?: React.ReactNode;
  /** Rendered in the header between workspace switcher and new-issue button (e.g. search trigger) */
  searchSlot?: React.ReactNode;
  /** Extra className for SidebarHeader */
  headerClassName?: string;
  /** Extra style for SidebarHeader */
  headerStyle?: React.CSSProperties;
}

/**
 * One nav row. Memoized because the nav list re-renders on every pathname
 * change; only the two rows whose active state flipped need to.
 */
const SidebarNavItem = React.memo(function SidebarNavItem({
  href,
  label,
  isActive,
  inboxUnread,
  count,
}: {
  href: string;
  label: string;
  navKey: NavKey;
  isActive: boolean;
  inboxUnread?: number;
  count?: { text: string; hot: boolean };
}) {
  const Icon = routeIconForPath(href);
  return (
    <SidebarMenuItem data-sidebar-active={isActive ? "true" : undefined}>
      <SidebarMenuButton
        isActive={isActive}
        render={<AppLink href={href} />}
        className={NAV_BUTTON_CLASS}
      >
        <NavTile Icon={Icon} active={isActive} />
        <span className="min-w-0 truncate">{label}</span>
        {inboxUnread ? (
          <CappedNumberFlow
            value={inboxUnread}
            animated={false}
            className="ml-auto font-mono text-[11px] tabular-nums"
          />
        ) : null}
        {count ? <NavCount {...count} /> : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
});

/** The only part of the sidebar that tracks the active route. */
function SidebarNavigation({
  paths,
  visiblePinned,
  getPinHref,
  onUnpin,
  wsId,
  navCounts,
  sensors,
  onDragStart,
  onDragEnd,
}: {
  paths: ReturnType<typeof useWorkspacePaths>;
  visiblePinned: PinnedItem[];
  getPinHref: (pin: PinnedItem) => string;
  onUnpin: (pin: PinnedItem) => void;
  wsId: string;
  navCounts: Partial<Record<NavKey, { text: string; hot: boolean }>>;
  sensors: ReturnType<typeof useSensors>;
  onDragStart: () => void;
  onDragEnd: (event: DragEndEvent) => void;
}) {
  const { t } = useT("layout");
  const { pathname } = useNavigation();
  // View pins are absent here (their href resolves async): while a view pin
  // is active the plain nav row for its surface stays highlighted too.
  // Accepted — suppressing it would need every view detail lifted up here.
  const isActivePinnedRoute = visiblePinned.some((pin) => pathname === getPinHref(pin));

  return (
    <>
      {visiblePinned.length > 0 && (
        <Collapsible defaultOpen>
          <SidebarGroup className="group/pinned">
            <SidebarGroupLabel
              render={<CollapsibleTrigger />}
              className={cn(
                GROUP_LABEL_CLASS,
                "group/trigger cursor-pointer hover:text-foreground",
              )}
            >
              <span>{t(($) => $.sidebar.pinned_label)}</span>
              <ChevronRight className="!size-3 ml-1 stroke-[2.5] transition-transform duration-200 group-data-[panel-open]/trigger:rotate-90" />
              <span className="ml-auto text-micro text-muted-foreground opacity-0 transition-opacity group-hover/pinned:opacity-100">{visiblePinned.length}</span>
            </SidebarGroupLabel>
            <CollapsibleContent>
              <SidebarGroupContent>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
                  <SortableContext items={visiblePinned.map((pin) => pin.id)} strategy={verticalListSortingStrategy}>
                    <SidebarMenu className="gap-0.5">
                      {visiblePinned.map((pin: PinnedItem) => (
                        <PinRow
                          key={pin.id}
                          pin={pin}
                          href={getPinHref(pin)}
                          pathname={pathname}
                          onUnpin={() => onUnpin(pin)}
                          wsId={wsId}
                        />
                      ))}
                    </SidebarMenu>
                  </SortableContext>
                </DndContext>
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>
      )}

      <SidebarGroup>
        <SidebarGroupLabel className={GROUP_LABEL_CLASS}>
          {t(($) => $.sidebar.workspace_group)}
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu className="gap-[3px]">
            {workspaceNav.map((item) => {
              const href = paths[item.key]();
              return (
                <SidebarNavItem
                  key={item.key}
                  href={href}
                  navKey={item.key}
                  label={t(($) => $.nav[item.labelKey])}
                  isActive={!isActivePinnedRoute && isNavActive(pathname, href)}
                  count={navCounts[item.key]}
                />
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel className={GROUP_LABEL_CLASS}>
          {t(($) => $.sidebar.configure_group)}
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu className="gap-[3px]">
            {configureNav.map((item) => {
              const href = paths[item.key]();
              return (
                <SidebarNavItem
                  key={item.key}
                  href={href}
                  navKey={item.key}
                  label={t(($) => $.nav[item.labelKey])}
                  isActive={isNavActive(pathname, href)}
                />
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}

/** Mobile sheet dismissal on route change; pathname lives here, not in the shell. */
function CloseMobileSidebarOnNavigate() {
  const { pathname } = useNavigation();
  const { setOpenMobile } = useSidebar();
  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);
  return null;
}

export function AppSidebar({ topSlot, searchSlot, headerClassName, headerStyle }: AppSidebarProps = {}) {
  const { t } = useT("layout");
  const { push } = useNavigationActions();
  const user = useAuthStore((s) => s.user);
  const userId = useAuthStore((s) => s.user?.id);
  const logout = useLogout();
  const workspace = useCurrentWorkspace();
  const p = useWorkspacePaths();
  const { data: workspaces = EMPTY_WORKSPACES } = useQuery(workspaceListOptions());
  const { data: myInvitations = EMPTY_INVITATIONS } = useQuery(myInvitationListOptions());
  const workspaceCreationDisabled = useConfigStore((s) => s.workspaceCreationDisabled);

  const wsId = workspace?.id;
  const { data: inboxItems = EMPTY_INBOX } = useQuery({
    queryKey: wsId ? inboxKeys.list(wsId) : ["inbox", "disabled"],
    queryFn: () => api.listInbox(),
    enabled: !!wsId,
  });
  const unreadCount = React.useMemo(
    () => deduplicateInboxItems(inboxItems).filter((i) => !i.read).length,
    [inboxItems],
  );
  // Cross-workspace unread summary backs the workspace-switcher dot. One
  // shared cache entry across workspaces; gated on an active workspace since
  // the endpoint resolves through the workspace-member middleware.
  const { data: unreadSummary = EMPTY_INBOX_SUMMARY } = useQuery({
    ...inboxUnreadSummaryOptions(),
    enabled: !!wsId,
  });
  const otherWorkspaceUnread = React.useMemo(
    () => hasOtherWorkspaceUnread(unreadSummary, wsId),
    [unreadSummary, wsId],
  );
  // Which workspaces have unread, so the switcher dropdown can point at the
  // specific one(s) rather than just the aggregate avatar dot.
  const unreadWsIds = React.useMemo(() => unreadWorkspaceIds(unreadSummary), [unreadSummary]);
  const { data: pinnedItems = EMPTY_PINS } = useQuery({
    ...pinListOptions(wsId ?? "", userId ?? ""),
    enabled: !!wsId && !!userId,
  });
  const deletePin = useDeletePin();
  const reorderPins = useReorderPins();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const sidebarScrollRef = useRef<HTMLDivElement>(null);
  const sidebarFadeStyle = useScrollFade(sidebarScrollRef, 24);
  const getPinHref = useCallback(
    (pin: PinnedItem) =>
      pin.item_type === "issue"
        ? p.issueDetail(pin.item_id)
        : pin.item_type === "project"
          ? p.projectDetail(pin.item_id)
          // Views know their target only after their detail loads — the row
          // resolves its own href; this placeholder never renders as a link.
          : "",
    [p],
  );

  // Local presentational copy of pinnedItems for drop-animation stability.
  // Follows TQ at rest; frozen during a drag gesture so a mid-drag cache
  // write (our own optimistic update, or a WS refetch) cannot reorder the
  // DOM under dnd-kit while its drop animation is still interpolating.
  const [localPinned, setLocalPinned] = useState<PinnedItem[]>(pinnedItems);
  const [localPinnedWsId, setLocalPinnedWsId] = useState<string | null>(wsId ?? null);
  const isDraggingRef = useRef(false);
  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalPinned(pinnedItems);
    }
  }, [pinnedItems]);
  useEffect(() => {
    setLocalPinnedWsId(wsId ?? null);
  }, [wsId]);
  const visiblePinned = localPinnedWsId === (wsId ?? null) ? localPinned : EMPTY_PINS;
  // One subscription backs the "in flight" block, the per-nav counts and the
  // footer — see useRunningWork for why they share a derivation rather than
  // three separate queries.
  const runningWork = useRunningWork(wsId ?? "");
  const navCounts = React.useMemo(
    () => {
      const counts = navCountText(runningWork, t);
      if (unreadCount > 0) {
        counts.activity = { text: String(unreadCount), hot: true };
      }
      return counts;
    },
    [runningWork, t, unreadCount],
  );
  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true;
  }, []);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      isDraggingRef.current = false;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = localPinned.findIndex((p) => p.id === active.id);
      const newIndex = localPinned.findIndex((p) => p.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = arrayMove(localPinned, oldIndex, newIndex);
      setLocalPinned(reordered);
      reorderPins.mutate(reordered);
    },
    [localPinned, reorderPins],
  );
  const handleUnpin = useCallback(
    (pin: PinnedItem) => {
      deletePin.mutate({ itemType: pin.item_type, itemId: pin.item_id });
    },
    [deletePin],
  );

  const queryClient = useQueryClient();
  const acceptInvitationMut = useMutation({
    mutationFn: (id: string) => api.acceptInvitation(id),
    // After accepting an invitation, navigate INTO the newly-joined workspace.
    // Otherwise the user stays on their current workspace and just sees the
    // new one appear in the dropdown — silent and confusing (this is MUL-820).
    onSuccess: async (_, invitationId) => {
      const invitation = myInvitations.find((i) => i.id === invitationId);
      queryClient.invalidateQueries({ queryKey: workspaceKeys.myInvitations() });
      // staleTime: 0 forces a real network fetch — we need the joined workspace
      // in the list before we can resolve its slug for navigation.
      const list = await queryClient.fetchQuery({
        ...workspaceListOptions(),
        staleTime: 0,
      });
      const joined = invitation
        ? list.find((w) => w.id === invitation.workspace_id)
        : null;
      if (joined) {
        push(paths.workspace(joined.slug).tasks());
      }
    },
  });
  const declineInvitationMut = useMutation({
    mutationFn: (id: string) => api.declineInvitation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.myInvitations() });
    },
  });

  const createIssueShortcut = useShortcut("createIssue");

  return (
      <Sidebar variant="inset">
        {topSlot}
        {/* Workspace Switcher */}
        <SidebarHeader className={cn("py-3", headerClassName)} style={headerStyle}>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <SidebarMenuButton>
                      {/* Zone rail: where this workspace sits in the zone
                          palette, readable before the name is. Decorative —
                          the name beside it carries the meaning. */}
                      <span className="relative">
                        <WorkspaceAvatar
                          name={workspace?.name ?? "M"}
                          avatarUrl={workspace?.avatar_url}
                          size="sm"
                          className="!size-[30px] !rounded-[4px] !border-0 !bg-foreground !font-serif !text-[17px] !font-normal !text-background"
                        />
                        {/* Shared brand dot: a pending invitation OR another
                            workspace with unread inbox items. The active
                            workspace's own unread stays on the Inbox nav count
                            (below), so it is deliberately excluded here. */}
                        {(myInvitations.length > 0 || otherWorkspaceUnread) && (
                          <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-brand ring-1 ring-sidebar" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold leading-[17px] tracking-[-0.01em]">
                          {workspace?.name ?? "QuickWork"}
                        </span>
                        <span className="qw-sidebar-mono mt-[2px] block truncate text-[10px] font-medium uppercase leading-[13px] tracking-[0.06em] text-muted-foreground">
                          {workspace?.slug ?? "quickwork"}
                        </span>
                      </span>
                      <ChevronDown className="size-3 text-muted-foreground" />
                    </SidebarMenuButton>
                  }
                />
                <DropdownMenuContent
                  className="w-auto min-w-56"
                  align="start"
                  side="bottom"
                  sideOffset={4}
                >
                  <div className="flex items-center gap-2.5 px-2 py-1.5">
                    <ActorAvatar
                      name={user?.name ?? ""}
                      initials={(user?.name ?? "U").charAt(0).toUpperCase()}
                      avatarUrl={resolvePublicFileUrl(user?.avatar_url)}
                      size="lg"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-medium leading-tight">
                        {user?.name}
                      </p>
                      <p className="truncate text-caption text-muted-foreground leading-tight">
                        {user?.email}
                      </p>
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-caption text-muted-foreground">
                      {t(($) => $.sidebar.workspaces_label)}
                    </DropdownMenuLabel>
                    {workspaces.map((ws) => (
                      <DropdownMenuItem
                        key={ws.id}
                        render={
                          <AppLink href={paths.workspace(ws.slug).tasks()} />
                        }
                      >
                        <WorkspaceAvatar name={ws.name} avatarUrl={ws.avatar_url} size="sm" />
                        <span className="flex-1 truncate">{ws.name}</span>
                        {/* Points at the specific workspace holding unread
                            inbox items. Sits in the same right-edge slot as the
                            active-workspace check; the active workspace is
                            excluded (its unread is the Inbox nav count), so dot
                            and check never collide on one row. */}
                        {ws.id !== workspace?.id && unreadWsIds.has(ws.id) && (
                          <span className="size-2 rounded-full bg-brand" />
                        )}
                        {ws.id === workspace?.id && (
                          <Check className="h-3.5 w-3.5 text-primary" />
                        )}
                      </DropdownMenuItem>
                    ))}
                    {!workspaceCreationDisabled && (
                      <DropdownMenuItem
                        onClick={() => push(paths.newWorkspace())}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {t(($) => $.sidebar.create_workspace)}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      render={<AppLink href={p.account()} />}
                    >
                      <CircleUser className="h-3.5 w-3.5" />
                      {t(($) => $.sidebar.account_settings)}
                    </DropdownMenuItem>
                    {workspace && (
                      <>
                        <DropdownMenuItem
                          render={<AppLink href={p.members()} />}
                        >
                          <Users className="h-3.5 w-3.5" />
                          {t(($) => $.sidebar.members)}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          render={<AppLink href={p.workspaceSettings()} />}
                        >
                          <Settings className="h-3.5 w-3.5" />
                          {t(($) => $.sidebar.workspace_settings)}
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuGroup>
                  {myInvitations.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuLabel className="text-caption text-muted-foreground">
                          {t(($) => $.sidebar.pending_invitations_label)}
                        </DropdownMenuLabel>
                        {myInvitations.map((inv) => (
                          <div key={inv.id} className="flex items-center gap-2 px-2 py-1.5">
                            <WorkspaceAvatar name={inv.workspace_name ?? "W"} size="sm" />
                            <span className="flex-1 truncate text-body">{inv.workspace_name ?? t(($) => $.sidebar.invitation_workspace_fallback)}</span>
                            <button
                              type="button"
                              className="text-caption px-2 py-0.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                              disabled={acceptInvitationMut.isPending}
                              onClick={(e) => {
                                e.stopPropagation();
                                acceptInvitationMut.mutate(inv.id);
                              }}
                            >
                              {t(($) => $.sidebar.invitation_join)}
                            </button>
                            <button
                              type="button"
                              className="text-caption px-2 py-0.5 rounded bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-50"
                              disabled={declineInvitationMut.isPending}
                              onClick={(e) => {
                                e.stopPropagation();
                                declineInvitationMut.mutate(inv.id);
                              }}
                            >
                              {t(($) => $.sidebar.invitation_decline)}
                            </button>
                          </div>
                        ))}
                      </DropdownMenuGroup>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem variant="destructive" onClick={logout}>
                      <LogOut className="h-3.5 w-3.5" />
                      {t(($) => $.sidebar.log_out)}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
          <SidebarMenu>
            {searchSlot && (
              <SidebarMenuItem>
                {searchSlot}
              </SidebarMenuItem>
            )}
            <SidebarMenuItem>
              <SidebarMenuButton
                className={
                  "h-[40px] gap-[9px] rounded-[4px] border-0 border-b border-border bg-transparent " +
                  "px-[8px] py-0 text-[13px] leading-[18px] font-normal text-muted-foreground shadow-none " +
                  "hover:bg-foreground/[0.03] hover:text-foreground focus-visible:ring-0"
                }
                onClick={() => openCreateIssue()}
              >
                <span className="relative flex shrink-0 items-center justify-center text-muted-foreground">
                  <SquarePen className="!size-[16px]" />
                  <DraftDot />
                </span>
                <span className="min-w-0 truncate">{t(($) => $.sidebar.new_issue)}</span>
                {createIssueShortcut ? (
                  <ShortcutKeycaps
                    shortcut={createIssueShortcut}
                    decorative
                    className="pointer-events-none ml-auto shrink-0 gap-[3px]"
                    keyClassName="h-[19px] min-w-[20px] rounded-[3px] border-border bg-background px-1 font-mono text-[10px] font-medium text-muted-foreground shadow-none"
                  />
                ) : null}
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        {/* Navigation */}
        <SidebarContent ref={sidebarScrollRef} style={sidebarFadeStyle} className="relative">
          <SidebarBaton />
          <CloseMobileSidebarOnNavigate />
          <SidebarNavigation
            paths={p}
            visiblePinned={visiblePinned}
            getPinHref={getPinHref}
            onUnpin={handleUnpin}
            wsId={wsId ?? ""}
            navCounts={navCounts}
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          />
        </SidebarContent>

        <SidebarFooter className="p-2">
          {/* Fleet state at the foot of the rail: the whole roster as one
              figure, which is what you want when deciding whether there is room
              to file something. Deliberately a single phrase rather than a
              "busy" count plus a "free" count — two numbers that always sum to
              the roster say the same thing as one. */}
          <div className="flex items-center gap-2 px-2 pb-1 text-[11px]">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 tabular-nums",
                runningWork.busyAgents > 0
                  ? "text-inflight"
                  : "text-faint-foreground",
              )}
            >
              {runningWork.busyAgents > 0 ? (
                <span className="pulse size-1.5" aria-hidden="true" />
              ) : null}
              {t(($) => $.sidebar.fleet_state, {
                busy: runningWork.busyAgents,
                idle: runningWork.idleAgents,
              })}
            </span>
            <span className="ml-auto">
              <HelpLauncher />
            </span>
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
  );
}
