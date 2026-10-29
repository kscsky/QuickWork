import { useEffect } from "react";
import { createMemoryRouter, Outlet, useMatches } from "react-router-dom";
import type { RouteObject } from "react-router-dom";
import { IssueDetailPage } from "./pages/issue-detail-page";
import { ProjectDetailPage } from "./pages/project-detail-page";
import { AutopilotDetailPage } from "./pages/autopilot-detail-page";
import { SkillDetailPage } from "./pages/skill-detail-page";
import { AgentDetailPage } from "./pages/agent-detail-page";
import { AiBuilderSessionPage } from "./pages/ai-builder-session-page";
import { MemberDetailPage } from "./pages/member-detail-page";
import { MembersDirectoryPage } from "./pages/members-directory-page";
import {
  RuntimeDetailPage,
  RuntimeSettingsPage,
} from "./pages/runtime-detail-page";
import { AttachmentPreviewRoute } from "./pages/attachment-preview-page";
import { ProjectsPage } from "@quickwork/views/projects/components";
import { DashboardPage } from "@quickwork/views/dashboard";
import { AutopilotsPage } from "@quickwork/views/autopilots/components";
import { MyIssuesPage } from "@quickwork/views/my-issues";
import { TaskListPage } from "@quickwork/views/tasks";
import { CreateSkillPage, SkillsPage } from "@quickwork/views/skills";
import { DesktopRuntimesPage } from "./components/desktop-runtimes-page";
import { ModelsPage } from "@quickwork/views/models";
import { DesktopAgentsPage } from "./components/desktop-agents-page";
import {
  AiCreateAgentPage,
  ChooseCreateMethodPage,
  ManualCreateAgentPage,
} from "@quickwork/views/agents";
import { SquadsPage, SquadDetailPage as SquadDetailPageView } from "@quickwork/views/squads/components";
import { InboxPage } from "@quickwork/views/inbox";
import { ActivityPage } from "@quickwork/views/activity";
import {
  AccountSettingsPage,
  ConfigOverviewPage,
  GitHubSettingsPage,
  IntegrationsSettingsPage,
  McpSettingsPage,
  TokensSettingsPage,
  WorkspaceSettingsPage,
} from "@quickwork/views/settings";
import { DaemonSettingsTab } from "./components/daemon-settings-tab";
import { UpdatesSettingsTab } from "./components/updates-settings-tab";
import { WorkspaceRouteLayout } from "./components/workspace-route-layout";
import { DesktopRouteErrorPage } from "./components/route-error-page";

/** Account settings plus the desktop-only daemon/update sections. */
function DesktopAccountSettingsRoute() {
  return (
    <AccountSettingsPage
      extraSections={
        <>
          <DaemonSettingsTab />
          <UpdatesSettingsTab />
        </>
      }
    />
  );
}

/**
 * Sets document.title from the deepest matched route's handle.title.
 * The tab system observes document.title via MutationObserver.
 * Pages with dynamic titles (e.g. issue detail) override by setting
 * document.title directly via useDocumentTitle().
 */
function TitleSync() {
  const matches = useMatches();
  const title = [...matches]
    .reverse()
    .find((m) => (m.handle as { title?: string })?.title)
    ?.handle as { title?: string } | undefined;

  useEffect(() => {
    if (title?.title) document.title = title.title;
  }, [title?.title]);

  return null;
}

/** Wrapper that renders route children + TitleSync */
function PageShell() {
  return (
    <>
      <TitleSync />
      <Outlet />
    </>
  );
}

/**
 * Route definitions shared by all tabs.
 *
 * Every tab path is workspace-scoped: `/{slug}/{route}/...`. Pre-workspace
 * flows (create workspace, accept invite) are NOT routes — they render as a
 * window-level overlay via `WindowOverlay`, dispatched by the navigation
 * adapter's transition-path interception. The `activeWorkspaceSlug` in the
 * tab store decides which workspace's tabs are visible in the TabBar;
 * workspace-less state (zero-workspace user) shows the overlay instead.
 *
 * The root index route stays as a harmless safety net. With per-workspace
 * tabs, nothing should construct a tab at `/` — but if one ever slips
 * through (malformed persisted state that dodges the migration, direct
 * router.navigate from unforeseen code), the index falls back to null
 * rather than 404; App.tsx's bootstrap repoints activeWorkspaceSlug on the
 * next render pass.
 */
export const appRoutes: RouteObject[] = [
  {
    element: <PageShell />,
    errorElement: <DesktopRouteErrorPage />,
    children: [
      { index: true, element: null },
      {
        path: ":workspaceSlug",
        element: <WorkspaceRouteLayout />,
        children: [
          // A bare `/{slug}` URL is normalized to `/{slug}/tasks` by
          // sanitizeTabPath before it ever becomes a session, so the index
          // route is unreachable in practice; null keeps it a harmless
          // safety net instead of an in-router <Navigate> (MUL-4741
          // invariant 1: the router never self-navigates).
          { index: true, element: null },
          {
            path: "dispatch",
            element: <TaskListPage />,
            handle: { title: "Dispatch" },
          },
          {
            path: "tasks",
            element: <TaskListPage />,
            handle: { title: "Tasks" },
          },
          {
            path: "issues/:id",
            element: <IssueDetailPage />,
            handle: { title: "Issue" },
          },
          {
            path: "projects",
            element: <ProjectsPage />,
            handle: { title: "Projects" },
          },
          {
            path: "projects/:id",
            element: <ProjectDetailPage />,
            handle: { title: "Project" },
          },
          {
            path: "autopilots",
            element: <AutopilotsPage />,
            handle: { title: "Autopilot" },
          },
          {
            path: "autopilots/:id",
            element: <AutopilotDetailPage />,
            handle: { title: "Autopilot" },
          },
          {
            path: "my-issues",
            element: <MyIssuesPage />,
            handle: { title: "My Issues" },
          },
          {
            path: "runtimes",
            element: <DesktopRuntimesPage />,
            handle: { title: "Runtimes" },
          },
          {
            path: "runtimes/:id",
            element: <RuntimeDetailPage />,
            handle: { title: "Machine" },
          },
          {
            path: "runtimes/:id/runtime/:runtimeId",
            element: <RuntimeSettingsPage />,
            handle: { title: "Runtime" },
          },
          { path: "skills", element: <SkillsPage />, handle: { title: "Skills" } },
          {
            path: "skills/new",
            element: <CreateSkillPage />,
            handle: { title: "New skill" },
          },
          {
            path: "skills/:id",
            element: <SkillDetailPage />,
            handle: { title: "Skill" },
          },
          { path: "agents", element: <DesktopAgentsPage />, handle: { title: "Agents" } },
          {
            path: "agents/new",
            element: <ChooseCreateMethodPage />,
            handle: { title: "Create Agent" },
          },
          {
            path: "agents/new/manual",
            element: <ManualCreateAgentPage />,
            handle: { title: "Create Agent" },
          },
          {
            path: "agents/new/ai",
            element: <AiCreateAgentPage />,
            handle: { title: "Create Agent" },
          },
          {
            path: "agents/new/ai/:sessionId",
            element: <AiBuilderSessionPage />,
            handle: { title: "Create Agent" },
          },
          {
            path: "agents/:id",
            element: <AgentDetailPage />,
            handle: { title: "Agent" },
          },
          {
            path: "members",
            element: <MembersDirectoryPage />,
            handle: { title: "Members" },
          },
          {
            path: "members/:id",
            element: <MemberDetailPage />,
            handle: { title: "Member" },
          },
          { path: "squads", element: <SquadsPage />, handle: { title: "Squads" } },
          {
            path: "squads/:id",
            element: <SquadDetailPageView />,
            handle: { title: "Squad" },
          },
          { path: "inbox", element: <InboxPage />, handle: { title: "Notifications" } },
          { path: "activity", element: <ActivityPage />, handle: { title: "Activity" } },
          {
            path: "attachments/:id/preview",
            element: <AttachmentPreviewRoute />,
            handle: { title: "Attachment" },
          },
          {
            path: "usage",
            element: <DashboardPage />,
            handle: { title: "Usage" },
          },
          { path: "config", element: <ConfigOverviewPage />, handle: { title: "Config" } },
          { path: "mcp", element: <McpSettingsPage />, handle: { title: "MCP" } },
          { path: "models", element: <ModelsPage />, handle: { title: "Model pool" } },
          { path: "github", element: <GitHubSettingsPage />, handle: { title: "GitHub" } },
          { path: "integrations", element: <IntegrationsSettingsPage />, handle: { title: "Integrations" } },
          { path: "tokens", element: <TokensSettingsPage />, handle: { title: "API Tokens" } },
          { path: "account", element: <DesktopAccountSettingsRoute />, handle: { title: "Account" } },
          { path: "workspace-settings", element: <WorkspaceSettingsPage />, handle: { title: "Workspace settings" } },
          // Alias for tabs/bookmarks from the retired monolith.
          { path: "settings", element: <ConfigOverviewPage />, handle: { title: "Config" } },
        ],
      },
    ],
  },
];

/**
 * Create THE app router (MUL-4741 single-router session architecture).
 * There is exactly one instance, owned by the tab Coordinator; it projects
 * the active tab session's URL and is never navigated by anything else.
 */
export function createAppRouter() {
  return createMemoryRouter(appRoutes, {
    initialEntries: ["/"],
  });
}
