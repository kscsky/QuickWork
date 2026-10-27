import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTask, Issue, IssueChainForIssue } from "@quickwork/core/types";

// Fixtures are mutable holders read by the mocked query layer, so a test can
// set up "a parked relay" or "nothing filed yet" without rebuilding mocks.
const h = vi.hoisted(() => ({
  issues: { current: [] as unknown[] },
  chains: { current: [] as unknown[] },
  tasks: { current: [] as unknown[] },
  push: vi.fn(),
  openModal: vi.fn(),
  batchDelete: vi.fn(async () => {}),
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
  useModalStore: { getState: () => ({ open: h.openModal }) },
}));

vi.mock("@quickwork/core/issues/mutations", () => ({
  useBatchDeleteIssues: () => ({ mutateAsync: h.batchDelete, isPending: false }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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

// The status label comes from the issue-status catalog in the app; here a
// tiny map keeps the row assertions about the ROW, not the catalog.
vi.mock("../issues/utils/status-label", () => ({
  useStatusLabel: () => (key: string) =>
    ({ todo: "Todo", in_progress: "In Progress", done: "Done" })[key] ?? key,
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
          return { data: h.chains.current };
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
  return { steps: [], parked: false, reviewing: false, ...over };
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
  h.tasks.current = [];
  h.push.mockClear();
  h.openModal.mockClear();
  h.batchDelete.mockClear();
});

describe("TaskListPage", () => {
  // The mix is the page: a squad task draws its relay legs inline, a solo
  // task draws who has it and where it stands.
  it("draws relay legs for squad rows and assignee + status for solo rows", () => {
    h.issues.current = [
      issue({ id: "issue-1", title: "Payment retry rework", assignee_type: "squad", assignee_id: "sq-1" }),
      issue({ id: "issue-2", title: "Copy pass", assignee_type: "agent", assignee_id: "ag-1", status: "in_progress" }),
    ];
    h.chains.current = [
      chain({
        issue_id: "issue-1",
        steps: [
          step({ id: "s0", position: 0, holder_user_id: "u-a", title: "Break down", state: "done" }),
          step({ id: "s1", position: 1, holder_user_id: "u-b", title: "Build", state: "doing", agent_id: "ag-1" }),
        ],
      }),
    ];

    render(<TaskListPage />);

    // The squad row's legs, with the holder's names in the strip.
    expect(screen.getByText("u-a")).toBeTruthy();
    expect(screen.getByText("u-b")).toBeTruthy();
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(screen.getAllByText("Squad").length).toBeGreaterThan(0);
    // The solo row: who has it, and its status.
    expect(screen.getByText("agent:ag-1")).toBeTruthy();
    expect(screen.getByText("In Progress")).toBeTruthy();
    expect(screen.getAllByText("Solo").length).toBeGreaterThan(0);
  });

  // A doing step nobody has claimed is waiting on the holder, not running —
  // the same distinction the room makes, kept here so the two cannot disagree.
  it("says an unclaimed step is awaiting pickup, a claimed one in progress", () => {
    h.issues.current = [
      issue({ id: "issue-1", title: "Payment retry rework", assignee_type: "squad", assignee_id: "sq-1" }),
    ];
    h.chains.current = [
      chain({
        issue_id: "issue-1",
        steps: [
          step({ id: "s0", position: 0, holder_user_id: "u-wang", title: "Break down", state: "doing", agent_id: "agent-1" }),
        ],
      }),
    ];
    h.tasks.current = [task({ issue_id: "issue-1", agent_id: "agent-1", status: "queued" })];
    const { unmount } = render(<TaskListPage />);
    expect(screen.getByText("Awaiting pickup")).toBeTruthy();
    unmount();

    h.tasks.current = [task({ issue_id: "issue-1", agent_id: "agent-1", status: "running" })];
    render(<TaskListPage />);
    expect(screen.getByText("In progress")).toBeTruthy();
  });

  // A relay's active leg can be assigned to the person holding it while the
  // issue itself still carries a chain. The chain is the stronger signal.
  it("reads a chain as a squad task even when the active assignee is a member", () => {
    h.issues.current = [
      issue({ id: "issue-1", title: "Payment retry rework", assignee_type: "member", assignee_id: "me-1" }),
    ];
    h.chains.current = [
      chain({
        issue_id: "issue-1",
        steps: [step({ id: "s1", position: 0, holder_user_id: "me-1", title: "Build", state: "doing", agent_id: "agent-1" })],
      }),
    ];
    h.tasks.current = [task({ issue_id: "issue-1", agent_id: "agent-1", status: "running" })];

    render(<TaskListPage />);

    expect(screen.getAllByText("Squad").length).toBeGreaterThan(0);
    expect(screen.getByText("In progress")).toBeTruthy();
  });

  it("counts the filters by kind, by turn and by stuck", () => {
    h.issues.current = [
      issue({ id: "issue-1", title: "Payment retry rework", assignee_type: "squad", assignee_id: "sq-1" }),
      issue({ id: "issue-2", title: "Copy pass", assignee_type: "member", assignee_id: "me-1" }),
    ];
    h.chains.current = [
      chain({
        issue_id: "issue-1",
        parked: true,
        steps: [step({ id: "s1", position: 0, holder_user_id: "u-chen", title: "reviewer", state: "parked" })],
      }),
    ];

    render(<TaskListPage />);

    expect(screen.getByRole("button", { name: "All 2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Solo 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Squad 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mine 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stuck 1" })).toBeTruthy();
    // Stuck is the one state that has to be visible without opening anything.
    expect(screen.getByTitle("Stuck")).toBeTruthy();
  });

  it("filters by kind and by stuck", async () => {
    const user = userEvent.setup();
    h.issues.current = [
      issue({ id: "issue-1", title: "Payment retry rework", assignee_type: "squad", assignee_id: "sq-1" }),
      issue({ id: "issue-2", title: "Copy pass", assignee_type: "member", assignee_id: "me-1" }),
    ];
    h.chains.current = [
      chain({
        issue_id: "issue-1",
        parked: true,
        steps: [step({ id: "s1", position: 0, holder_user_id: "u-chen", title: "reviewer", state: "parked" })],
      }),
    ];

    render(<TaskListPage />);

    await user.click(screen.getByRole("button", { name: "Solo 1" }));
    expect(screen.getByText("Copy pass")).toBeTruthy();
    expect(screen.queryByText("Payment retry rework")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Stuck 1" }));
    expect(screen.getByText("Payment retry rework")).toBeTruthy();
    expect(screen.queryByText("Copy pass")).toBeNull();
  });

  // The row is a doorway now: one click opens the task, where the full
  // timeline lives.
  it("opens the task when its row is clicked", async () => {
    const user = userEvent.setup();
    h.issues.current = [issue({ id: "issue-9", title: "Payment retry rework" })];

    render(<TaskListPage />);
    await user.click(screen.getByRole("button", { name: /Payment retry rework/ }));

    expect(h.push).toHaveBeenCalledWith("/acme/issues/issue-9");
  });

  // The create entry sits next to the title (where reading starts), and it
  // opens the merged dialog — the type is picked inside, not by entry point.
  it("opens the merged create dialog from the header", async () => {
    const user = userEvent.setup();
    h.issues.current = [issue({ id: "issue-1", title: "Copy pass" })];

    render(<TaskListPage />);
    await user.click(screen.getByRole("button", { name: "New task" }));

    expect(h.openModal).toHaveBeenCalledWith("quick-create-issue");
  });

  it("shows the empty state when nothing is filed", () => {
    render(<TaskListPage />);
    expect(screen.getByText("No tasks yet")).toBeTruthy();
  });

  // A squad task the viewer holds a leg in speaks as THEIR subtask: the row
  // is the work actually on them (编号 -N + 这一棒的名字), the parent is context.
  it("speaks as the viewer's own subtask when they hold a leg", () => {
    h.issues.current = [
      issue({ id: "issue-1", title: "Payment retry rework", assignee_type: "squad", assignee_id: "sq-1" }),
    ];
    h.chains.current = [
      chain({
        issue_id: "issue-1",
        steps: [
          step({ id: "s0", position: 0, holder_user_id: "u-a", title: "Break down", state: "done" }),
          step({ id: "s1", position: 1, holder_user_id: "me-1", title: "对账口径与自测", state: "doing", agent_id: "agent-1" }),
          step({ id: "s2", position: 2, holder_user_id: "u-chen", title: "Verify", state: "pending" }),
        ],
      }),
    ];
    h.tasks.current = [task({ issue_id: "issue-1", agent_id: "agent-1", status: "running" })];

    render(<TaskListPage />);

    // The row is the leg: identifier -seq, the leg's own title, the parent as
    // context, and the leg's state.
    expect(screen.getByText("KSCS-1-2")).toBeTruthy();
    expect(screen.getByText("对账口径与自测")).toBeTruthy();
    expect(screen.getByText("Payment retry rework")).toBeTruthy(); // parent context
    expect(screen.getByText("Leg 2/3")).toBeTruthy();
    expect(screen.getByText("In progress")).toBeTruthy();
    // The others' legs are not surfaced as their own rows.
    expect(screen.queryByText("Break down")).toBeNull();
    expect(screen.queryByText("Verify")).toBeNull();
  });

  // Ten at a time, with the count line always telling you where you are. The
  // pager lives outside the scroll area, so it reads the same on every page.
  it("pages the feed ten at a time and says where you are", async () => {
    const user = userEvent.setup();
    // Descending activity so the page split is deterministic.
    h.issues.current = Array.from({ length: 12 }, (_, i) =>
      issue({
        id: `issue-${i + 1}`,
        title: `Task ${i + 1}`,
        updated_at: `2026-10-08T${String(12 - i).padStart(2, "0")}:00:00Z`,
      }),
    );

    render(<TaskListPage />);

    expect(screen.getByText(/12 total · 10 per page · page 1 \/ 2/)).toBeTruthy();
    expect(screen.getByText("Task 1")).toBeTruthy();
    expect(screen.getByText("Task 10")).toBeTruthy();
    expect(screen.queryByText("Task 11")).toBeNull();

    await user.click(screen.getByRole("button", { name: "2" }));

    expect(screen.getByText(/page 2 \/ 2/)).toBeTruthy();
    expect(screen.getByText("Task 11")).toBeTruthy();
    expect(screen.getByText("Task 12")).toBeTruthy();
    expect(screen.queryByText("Task 1")).toBeNull();
  });

  it("returns to the first page when the filter changes", async () => {
    const user = userEvent.setup();
    h.issues.current = Array.from({ length: 12 }, (_, i) =>
      issue({
        id: `issue-${i + 1}`,
        title: `Task ${i + 1}`,
        assignee_type: "member",
        assignee_id: "me-1",
        updated_at: `2026-10-08T${String(12 - i).padStart(2, "0")}:00:00Z`,
      }),
    );

    render(<TaskListPage />);
    await user.click(screen.getByRole("button", { name: "2" }));
    expect(screen.queryByText("Task 1")).toBeNull();

    // A narrower question starts from its own first page, not the old offset.
    await user.click(screen.getByRole("button", { name: "Mine 12" }));
    expect(screen.getByText("Task 1")).toBeTruthy();
    expect(screen.getByText(/page 1 \/ 2/)).toBeTruthy();
  });

  // Deleting one task lives on the row itself — no detour through the detail
  // page, no multi-select.
  it("opens the delete confirmation from the row", async () => {
    const user = userEvent.setup();
    h.issues.current = [
      issue({ id: "issue-9", identifier: "KSCS-9", title: "Payment retry rework" }),
    ];

    render(<TaskListPage />);
    await user.click(screen.getByRole("button", { name: "Delete task KSCS-9" }));

    expect(h.openModal).toHaveBeenCalledWith("issue-delete-confirm", {
      issueId: "issue-9",
      identifier: "KSCS-9",
    });
  });

  it("selects rows and deletes them in bulk", async () => {
    const user = userEvent.setup();
    h.issues.current = [
      issue({ id: "issue-1", identifier: "KSCS-1", title: "Payment retry rework" }),
      issue({ id: "issue-2", identifier: "KSCS-2", title: "Copy pass" }),
    ];

    render(<TaskListPage />);
    await user.click(screen.getByRole("checkbox", { name: "Select KSCS-1" }));
    await user.click(screen.getByRole("checkbox", { name: "Select KSCS-2" }));

    expect(screen.getByText("2 selected")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Delete 2 tasks?")).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(h.batchDelete).toHaveBeenCalledWith(["issue-1", "issue-2"]);
  });

  it("selects the whole page from the batch bar", async () => {
    const user = userEvent.setup();
    h.issues.current = Array.from({ length: 12 }, (_, i) =>
      issue({
        id: `issue-${i + 1}`,
        identifier: `KSCS-${i + 1}`,
        title: `Task ${i + 1}`,
        updated_at: `2026-10-08T${String(12 - i).padStart(2, "0")}:00:00Z`,
      }),
    );

    render(<TaskListPage />);
    await user.click(screen.getByRole("checkbox", { name: "Select KSCS-1" }));
    await user.click(screen.getByRole("button", { name: "Select page" }));

    expect(screen.getByText("10 selected")).toBeTruthy();
  });
});
