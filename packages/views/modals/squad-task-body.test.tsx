import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithI18n } from "../test/i18n";
import { useIssueDraftStore } from "@quickwork/core/issues/stores/draft-store";
import { SquadTaskBody } from "./squad-task-body";

const mocks = vi.hoisted(() => ({
  squads: [] as Array<{ id: string; name: string }>,
  agents: [] as Array<{
    id: string;
    name: string;
    owner_id?: string;
    runnability?: { ready: boolean; reason?: string };
  }>,
  members: [] as Array<{
    member_type: string;
    member_id: string;
    role: string;
    agent_id?: string;
  }>,
  playbooks: [] as Array<{
    id: string;
    name: string;
    steps: Array<{ holder_user_id: string; title: string }>;
  }>,
  createIssue: vi.fn(),
  createIssueChain: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  queryOptions: (options: unknown) => options,
  useQuery: (options: { queryKey?: readonly unknown[] }) => {
    const key = options.queryKey?.[0];
    if (key === "squads") return { data: mocks.squads, isPending: false };
    if (key === "agents") return { data: mocks.agents };
    if (key === "members") return { data: mocks.members };
    if (key === "playbooks") return { data: mocks.playbooks };
    return { data: [] };
  },
  useMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
  }),
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
  }),
}));

vi.mock("@quickwork/core/workspace/queries", () => ({
  squadListOptions: () => ({ queryKey: ["squads"] }),
  agentListOptions: () => ({ queryKey: ["agents"] }),
  squadMemberListOptions: () => ({ queryKey: ["members"] }),
  squadPlaybooksOptions: () => ({ queryKey: ["playbooks"] }),
  workspaceKeys: { squadPlaybooks: () => ["playbooks"] },
}));

vi.mock("@quickwork/core/agents/queries", () => ({
  agentTaskSnapshotOptions: () => ({ queryKey: ["tasks"] }),
}));

vi.mock("@quickwork/core/issues/queries", () => ({
  issuesByIdsOptions: () => ({ queryKey: ["issues"] }),
  issueKeys: {
    chain: (issueId: string) => ["issues", "chain", issueId],
  },
}));

vi.mock("@quickwork/core/api", () => ({
  api: {
    saveSquadPlaybook: vi.fn(),
    createIssueChain: mocks.createIssueChain,
  },
  ApiError: class ApiError extends Error {
    status: number;
    body?: unknown;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("@quickwork/core/issues/mutations", () => ({
  useCreateIssue: () => ({
    mutateAsync: mocks.createIssue,
    isPending: false,
  }),
}));

vi.mock("../navigation", () => ({
  useNavigation: () => ({ push: mocks.navigate }),
}));

vi.mock("@quickwork/core/hooks", () => ({
  useWorkspaceId: () => "workspace-1",
}));

vi.mock("@quickwork/core/paths", () => ({
  useCurrentWorkspace: () => ({ name: "Acme" }),
  useWorkspacePaths: () => ({
    issueDetail: (id: string) => `/acme/issues/${id}`,
  }),
}));

vi.mock("@quickwork/core/modals", () => ({
  useModalStore: { getState: () => ({ open: vi.fn() }) },
}));

vi.mock("@quickwork/core/workspace/hooks", () => ({
  useActorName: () => ({
    getActorName: (_type: string, id: string) =>
      ({
        "u-lead": "Zhang Wei",
        "u-park": "Li Tejie",
        "u-free": "Chen Chen",
      })[id] ?? id,
    getActorInitials: () => "ZW",
    getActorAvatarUrl: () => null,
  }),
}));

vi.mock("@quickwork/core/shortcuts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@quickwork/core/shortcuts")>();
  return {
    ...actual,
    useShortcut: () => ({
      key: "Enter",
      modifiers: { primary: true, control: false, meta: false, alt: false, shift: false },
    }),
  };
});

vi.mock("@quickwork/ui/components/ui/dialog", () => ({
  DialogTitle: ({ children, className }: { children: ReactNode; className?: string }) => (
    <h2 className={className}>{children}</h2>
  ),
}));

vi.mock("../common/actor-avatar", () => ({
  ActorAvatar: () => null,
}));

const LEADER = {
  member_type: "member",
  member_id: "u-lead",
  role: "leader",
  agent_id: "a-arch",
};
// The step that parks: a holder who lends the room no agent.
const PARKED = { member_type: "member", member_id: "u-park", role: "executor" };
const FREE = {
  member_type: "member",
  member_id: "u-free",
  role: "executor",
  agent_id: "a-fe",
};

const renderBody = () =>
  renderWithI18n(<SquadTaskBody onClose={() => {}} />);

beforeEach(() => {
  useIssueDraftStore.getState().clearDraft();
  mocks.squads = [{ id: "s-1", name: "Delivery squad" }];
  mocks.agents = [
    { id: "a-arch", name: "Architect Agent", owner_id: "u-lead" },
    { id: "a-fe", name: "Frontend Agent", owner_id: "u-free" },
  ];
  mocks.members = [LEADER, PARKED, FREE];
  mocks.playbooks = [];
  mocks.createIssue.mockReset().mockResolvedValue({ id: "issue-1" });
  mocks.createIssueChain.mockReset().mockResolvedValue({ steps: [] });
  mocks.navigate.mockReset();
});

async function typePrompt(text = "Rework the payment retry path") {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText(/Write what this relay/), text);
}

async function start() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Start relay/ }));
}

describe("SquadTaskBody (the squad half of the merged create dialog)", () => {
  // The body opens on the route the dispatch will actually run: the leader is
  // step one and the saved route follows, in the refresh relay-order frame.
  it("opens on the deliverable with the route already answered", () => {
    renderBody();

    expect(
      screen.getByPlaceholderText(/Write what this relay/),
    ).toBeInTheDocument();
    expect(screen.getByText("Route / RELAY")).toBeInTheDocument();
    expect(screen.getByText("Zhang Wei")).toBeInTheDocument();
    expect(screen.getByText(/Leader · always first/)).toBeInTheDocument();
  });

  // The parked step is the whole point of arranging the route here: you see
  // where the relay will stop before anything is dispatched.
  it("marks a step whose holder brings no agent as parked", () => {
    mocks.playbooks = [
      {
        id: "pb-1",
        name: "Payment route",
        steps: [
          { holder_user_id: "u-park", title: "Implement" },
          { holder_user_id: "u-free", title: "Verify" },
        ],
      },
    ];
    renderBody();

    // The route seeds from the first render, so the line is already complete.
    expect(screen.getByText("Li Tejie")).toBeInTheDocument();
    expect(screen.getByText("Chen Chen")).toBeInTheDocument();

    // The consequence is stated in words rather than left for the reader to
    // infer from a colour: this is the fact the whole body exists to surface.
    expect(
      screen.getByText(/Li Tejie has no agent/),
    ).toBeInTheDocument();
  });

  // The route is the decision; naming only the playbook would make the server
  // resolve the saved version and quietly discard the edit.
  it("sends an edited route inline rather than the playbook id", async () => {
    mocks.playbooks = [
      {
        id: "pb-1",
        name: "Payment route",
        steps: [
          { holder_user_id: "u-park", title: "Implement" },
          { holder_user_id: "u-free", title: "Verify" },
        ],
      },
    ];
    renderBody();
    await typePrompt();

    const user = userEvent.setup();
    // Both steps carry the control; the first one is the parked holder.
    await user.click(screen.getAllByTitle("Remove this step")[0]!);

    await start();

    await waitFor(() => expect(mocks.createIssue).toHaveBeenCalled());
    expect(mocks.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Rework the payment retry path",
        assignee_type: "squad",
        assignee_id: "s-1",
        chain_steps: [{ holder_user_id: "u-free", title: "Verify" }],
      }),
    );
    expect(mocks.createIssueChain).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith("/acme/issues/issue-1");
  });

  // The route is planned before anything is dispatched. A holder whose agent
  // cannot claim (here: the machine is another member's private runtime) must
  // be told now, not discover it as a leg that silently parks.
  it("warns when a holder's agent cannot claim on its machine", () => {
    mocks.agents = [
      { id: "a-arch", name: "Architect Agent", owner_id: "u-lead" },
      {
        id: "a-fe",
        name: "Frontend Agent",
        owner_id: "u-free",
        runnability: { ready: false, reason: "runtime_private_foreign" },
      },
    ];
    mocks.playbooks = [
      {
        id: "pb-1",
        name: "Payment route",
        steps: [
          { holder_user_id: "u-park", title: "Implement" },
          { holder_user_id: "u-free", title: "Verify" },
        ],
      },
    ];
    renderBody();

    expect(
      screen.getByText(
        /Chen Chen's agent cannot take this leg: the machine is private to someone else/,
      ),
    ).toBeInTheDocument();
  });

  it("shows each squad member by name without an agent picker", () => {
    mocks.playbooks = [
      {
        id: "pb-1",
        name: "Payment route",
        steps: [
          { holder_user_id: "u-park", title: "Implement" },
          { holder_user_id: "u-free", title: "Verify" },
        ],
      },
    ];
    renderBody();

    expect(screen.getByText("Li Tejie")).toBeInTheDocument();
    expect(screen.getByText("Chen Chen")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /No agent yet/ })).toBeNull();
    expect(screen.queryByLabelText("Step title for Li Tejie")).toBeNull();
  });

  it("sends the chosen route with the create", async () => {
    mocks.playbooks = [
      {
        id: "pb-1",
        name: "Payment route",
        steps: [
          { holder_user_id: "u-park", title: "Implement" },
          { holder_user_id: "u-free", title: "Verify" },
        ],
      },
    ];
    renderBody();
    await typePrompt();
    await start();

    await waitFor(() => expect(mocks.createIssue).toHaveBeenCalled());
    expect(mocks.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        chain_steps: [
          { holder_user_id: "u-park", title: "Implement" },
          { holder_user_id: "u-free", title: "Verify" },
        ],
      }),
    );
    expect(mocks.createIssueChain).not.toHaveBeenCalled();
    expect(document.querySelector(".qk-create-paper")).toHaveClass("is-stamping");
  });

  // "Blank" is the squad's own order, not an empty relay — the line shows it,
  // so the wire carries it. Sending [] would ask the server to re-derive the
  // same thing and would make the dispatch disagree with the screen.
  it("sends the squad's own order when no playbook was chosen", async () => {
    renderBody();
    await typePrompt();
    await start();

    await waitFor(() => expect(mocks.createIssue).toHaveBeenCalled());
    expect(mocks.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        chain_steps: [
          { holder_user_id: "u-park", title: "" },
          { holder_user_id: "u-free", title: "" },
        ],
      }),
    );
    expect(mocks.createIssueChain).not.toHaveBeenCalled();
  });

  it("will not dispatch without a deliverable", () => {
    renderBody();

    expect(screen.getByRole("button", { name: /Start relay/ })).toBeDisabled();
  });

  it("falls back to the create-squad state when the workspace has none", () => {
    mocks.squads = [];
    renderBody();

    expect(screen.getByText("No squads yet")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Squad" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start relay/ })).toBeDisabled();
  });
});
