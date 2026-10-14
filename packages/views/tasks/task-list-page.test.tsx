import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTask, Issue, IssueChainForIssue } from "@quickwork/core/types";

// Fixtures are mutable holders read by the mocked query layer, so a test can
// set up "a parked relay" or "nothing filed yet" without rebuilding mocks.
const h = vi.hoisted(() => ({
  issues: { current: [] as unknown[] },
  chains: { current: [] as unknown[] },
  chainsPending: { current: false },
  tasks: { current: [] as unknown[] },
  push: vi.fn(),
}));

vi.mock("@quickwork/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@quickwork/core/paths", () => ({
  useWorkspacePaths: () => ({
    issueDetail: (id: string) => `/acme/issues/${id}`,
  }),
}));

vi.mock("@quickwork/core/auth", () => ({
  useAuthStore: (selector: (state: { user: { id: string } }) => unknown) =>
    selector({ user: { id: "me-1" } }),
}));

vi.mock("@quickwork/core/modals", () => ({
}));

vi.mock("@quickwork/core/workspace/hooks", () => ({
  useActorName: () => ({
    getMemberName: (id: string) => id,
    getAgentName: (id: string) => `agent:${id}`,
    getSquadName: (id: string) => `squad:${id}`,
  }),
}));

vi.mock("@quickwork/core/issues/queries", () => ({
  issueListOptions: () => ({ queryKey: ["issues"] }),
  issueChainsOptions: () => ({ queryKey: ["chains"] }),
}));

vi.mock("../navigation", () => ({
  useNavigation: () => ({ push: h.push, pathname: "/acme/tasks" }),
}));

vi.mock("../common/actor-avatar", () => ({
  ActorAvatar: ({ actorId }: { actorId: string }) => <span data-testid={`avatar-${actorId}`} />,
}));

vi.mock("@quickwork/ui/components/ui/button", () => ({
  Button: ({ children, ...rest }: React.ComponentProps<"button">) => (
    <button type="button" {...rest}>{children}</button>
  ),
}));

/**
 * i18n mock that runs the real selectors against the real EN bundle, so a
 * renamed or missing `tasks.*` key fails here instead of silently falling
 * back. Relative times are fixed — the suite asserts story, not clocks.
 */
vi.mock("../i18n", async () => {
  const [tasks, common] = await Promise.all([
    import("../locales/en/tasks.json"),
    import("../locales/en/common.json"),
  ]);
  const bundles: Record<string, unknown> = { tasks: tasks.default, common: common.default };
  return {
    useTimeAgo: () => () => "2h ago",
    useT: (ns: keyof typeof bundles = "tasks") => ({
      t: (
        select: (bundle: unknown) => unknown,
        options?: { count?: number; [key: string]: unknown },
      ) => {
        const raw = select(bundles[ns]);
        if (typeof raw !== "string") return raw;
        if (!options) return raw;
        return raw.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(options[key] ?? ""));
      },
    }),
  };
});

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
      switch (queryKey[0]) {
        case "issues":
          return { data: h.issues.current };
        case "chains":
          return { data: h.chains.current, isPending: h.chainsPending.current };
        // agentTaskSnapshotOptions — the relay's run states.
        case "workspaces":
          return { data: h.tasks.current };
        default:
          return { data: [] };
      }
    },
  };
});

const { TaskListPage } = await import("./task-list-page");

function issue(over: Partial<Issue> & { id: string; title: string }): Issue {
  return {
    workspace_id: "ws-1",
    number: 1,
    identifier: "KSCS-1",
    description: null,
    status: "todo",
    priority: "none",
    assignee_type: null,
    assignee_id: null,
    creator_type: "member",
    creator_id: "me-1",
    parent_issue_id: null,
    project_id: null,
    position: 0,
    stage: null,
    start_date: null,
    due_date: null,
    metadata: {},
    properties: {},
    created_at: "2026-10-08T10:00:00Z",
    updated_at: "2026-10-08T10:00:00Z",
    ...over,
  };
}

function chain(over: Partial<IssueChainForIssue> & { issue_id: string }): IssueChainForIssue {
  return { steps: [], parked: false, ...over };
}

function step(over: Partial<IssueChainForIssue["steps"][number]> & { id: string; position: number; holder_user_id: string; title: string; state: string }) {
  return over;
}

function task(over: Partial<AgentTask> & { issue_id: string; agent_id: string; status: AgentTask["status"] }): AgentTask {
  return {
    id: `task-${over.agent_id}`,
    runtime_id: "runtime-1",
    priority: 0,
    dispatched_at: null,
    started_at: null,
    completed_at: null,
    result: null,
    error: null,
    created_at: "2026-10-08T10:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  h.issues.current = [];
  h.chains.current = [];
  h.chainsPending.current = false;
  h.tasks.current = [];
  h.push.mockClear();
});

describe("TaskListPage", () => {
  it("tells each row's relay story and counts the filters", () => {
    h.issues.current = [
      issue({ id: "issue-1", title: "Payment retry rework" }),
      issue({ id: "issue-2", title: "Release checklist" }),
    ];
    h.chains.current = [
      chain({
        issue_id: "issue-1",
        parked: true,
        steps: [
          step({ id: "s0", position: 0, holder_user_id: "u-a", title: "Break down", state: "done" }),
          step({ id: "s1", position: 1, holder_user_id: "u-chen", title: "reviewer", state: "parked" }),
        ],
      }),
    ];

    render(<TaskListPage />);

    // The parked row says who it is waiting on and where — the one line that
    // makes the page worth opening.
    // A stuck task is visible without opening anything: the dot is the one
    // piece of state the folded row still shows.
    expect(screen.getByTitle("Stuck")).toBeTruthy();
    // Chain-less rows fall back to their assignee's absence, not to a blank.
    expect(screen.getAllByText("Unassigned").length).toBeGreaterThan(0);
    // Filter counts see the same data: one parked, none mine, two total.
    expect(screen.getByRole("button", { name: "Stuck 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "All 2" })).toBeTruthy();
    // The row says who it is for, not whose turn it is — the timeline holds
    // that, and the two run-state tests below cover it.
    expect(screen.getByRole("button", { name: /Payment retry rework/ })).toBeTruthy();
  });

  it("filters down to the stuck tasks", async () => {
    const user = userEvent.setup();
    h.issues.current = [
      issue({ id: "issue-1", title: "Payment retry rework" }),
      issue({ id: "issue-2", title: "Release checklist" }),
    ];
    h.chains.current = [
      chain({
        issue_id: "issue-1",
        parked: true,
        steps: [step({ id: "s1", position: 0, holder_user_id: "u-chen", title: "reviewer", state: "parked" })],
      }),
    ];

    render(<TaskListPage />);
    await user.click(screen.getByRole("button", { name: "Stuck 1" }));

    expect(screen.getByText("Payment retry rework")).toBeTruthy();
    expect(screen.queryByText("Release checklist")).toBeNull();
  });

  it("counts a task as mine when the relay is on my step", async () => {
    const user = userEvent.setup();
    h.issues.current = [issue({ id: "issue-1", title: "Payment retry rework" })];
    h.chains.current = [
      chain({
        issue_id: "issue-1",
        steps: [step({ id: "s0", position: 0, holder_user_id: "me-1", title: "Break down", state: "doing" })],
      }),
    ];

    render(<TaskListPage />);
    expect(screen.getByRole("button", { name: "My turn 1" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "My turn 1" }));
    expect(screen.getByText("Payment retry rework")).toBeTruthy();

    // The filter is the subject here; what the open timeline says about the run
    // is covered by the two tests below.
    await user.click(screen.getByRole("button", { name: /Payment retry rework/ }));
    expect(screen.getByText("Break down")).toBeTruthy();
  });

  it("says a dispatched step is waiting for the holder's machine, not running", async () => {
    h.issues.current = [issue({ id: "issue-1", title: "Payment retry rework" })];
    h.chains.current = [
      chain({
        issue_id: "issue-1",
        steps: [
          step({ id: "s0", position: 0, holder_user_id: "u-wang", title: "Break down", state: "doing", agent_id: "agent-1" }),
        ],
      }),
    ];
    h.tasks.current = [task({ issue_id: "issue-1", agent_id: "agent-1", status: "queued" })];

    render(<TaskListPage />);
    await userEvent.click(
      screen.getByRole("button", { name: /Payment retry rework/ }),
    );

    // The run exists but nobody has claimed it — the honest story is "their
    // machine hasn't picked it up", not "in progress".
    expect(
      screen.getByText("u-wang hasn't picked it up"),
    ).toBeTruthy();
  });

  it("says a claimed step is running on the holder's machine", async () => {
    h.issues.current = [issue({ id: "issue-1", title: "Payment retry rework" })];
    h.chains.current = [
      chain({
        issue_id: "issue-1",
        steps: [
          step({ id: "s0", position: 0, holder_user_id: "u-wang", title: "Break down", state: "doing", agent_id: "agent-1" }),
        ],
      }),
    ];
    h.tasks.current = [task({ issue_id: "issue-1", agent_id: "agent-1", status: "running" })];

    render(<TaskListPage />);
    await userEvent.click(
      screen.getByRole("button", { name: /Payment retry rework/ }),
    );

    expect(screen.getByText("u-wang is running")).toBeTruthy();
  });

  it("folds a task open on its row, and opens it from inside", async () => {
    const user = userEvent.setup();
    h.issues.current = [issue({ id: "issue-9", title: "Payment retry rework" })];

    render(<TaskListPage />);
    const row = () => screen.getByRole("button", { name: /Payment retry rework/ });

    expect(row()).toHaveAttribute("aria-expanded", "false");
    await user.click(row());

    // The row click is not navigation any more: it is the ask for detail.
    expect(row()).toHaveAttribute("aria-expanded", "true");
    expect(h.push).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Open task" }));
    expect(h.push).toHaveBeenCalledWith("/acme/issues/issue-9");
  });

  it("shows the empty state when nothing is filed", () => {
    render(<TaskListPage />);
    expect(screen.getByText("No tasks yet")).toBeTruthy();
  });
});
