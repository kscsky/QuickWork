import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import type { Issue } from "@quickwork/core/types";
import { renderWithI18n } from "../../test/i18n";
import { NavigationProvider, type NavigationAdapter } from "../../navigation";
import { ProjectTaskList } from "./project-task-list";

const mocks = vi.hoisted(() => ({
  issues: [] as Issue[],
  isLoading: false,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mocks.issues, isLoading: mocks.isLoading }),
}));

vi.mock("@quickwork/core/issues/queries", () => ({
  projectTaskListOptions: () => ({ queryKey: ["project-tasks"] }),
}));

vi.mock("@quickwork/core/hooks", () => ({
  useWorkspaceId: () => "workspace-1",
}));

vi.mock("@quickwork/core/paths", () => ({
  useWorkspacePaths: () => ({
    issueDetail: (id: string) => `/test-workspace/issues/${id}`,
  }),
}));

vi.mock("@quickwork/core/workspace/hooks", () => ({
  useActorName: () => ({
    getActorName: (type: string) => (type === "agent" ? "Architect Agent" : "Zhang Wei"),
    getActorInitials: () => "AA",
    getActorAvatarUrl: () => null,
  }),
}));

vi.mock("../../issues/utils/status-label", () => ({
  useStatusLabel: () => (status: string) => (status === "todo" ? "To Do" : status),
}));

vi.mock("../../issues/components/status-icon", () => ({
  StatusIcon: () => null,
}));

vi.mock("../../common/actor-avatar", () => ({
  ActorAvatar: () => null,
}));

const ISSUE: Issue = {
  id: "issue-1",
  identifier: "KS-471",
  title: "Empty state for the console",
  status: "todo",
  priority: "medium",
  assignee_type: "agent",
  assignee_id: "agent-1",
  project_id: "project-1",
} as Issue;

function makeAdapter(): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/test-workspace/projects/project-1",
    searchParams: new URLSearchParams(),
    hash: "",
    getShareableUrl: (p) => p,
  };
}

function renderList() {
  return renderWithI18n(
    <NavigationProvider value={makeAdapter()}>
      <ProjectTaskList projectId="project-1" />
    </NavigationProvider>,
  );
}

beforeEach(() => {
  mocks.issues = [ISSUE];
  mocks.isLoading = false;
});

describe("ProjectTaskList", () => {
  // The column answers "what is on this project", so a row has to carry the
  // identifier, the title, who holds it, and where it stands.
  it("renders a flat row per task with its holder and status", () => {
    renderList();

    expect(screen.getByText("KS-471")).toBeInTheDocument();
    expect(screen.getByText("Empty state for the console")).toBeInTheDocument();
    expect(screen.getByText("Architect Agent")).toBeInTheDocument();
    expect(screen.getByText("To Do")).toBeInTheDocument();
  });

  it("links each row into the task", () => {
    renderList();

    expect(
      screen.getByRole("link", { name: /Empty state for the console/ }),
    ).toHaveAttribute("href", "/test-workspace/issues/issue-1");
  });

  // An unassigned task still has to render a row; "—" matches how the projects
  // table shows an absent assignee.
  it("renders an unassigned task without dropping the row", () => {
    mocks.issues = [{ ...ISSUE, assignee_type: null, assignee_id: null } as Issue];
    renderList();

    expect(screen.getByText("KS-471")).toBeInTheDocument();
    expect(screen.queryByText("Architect Agent")).not.toBeInTheDocument();
  });

  it("says so when the project has no tasks", () => {
    mocks.issues = [];
    renderList();

    expect(screen.getByText("No issues linked")).toBeInTheDocument();
  });
});
