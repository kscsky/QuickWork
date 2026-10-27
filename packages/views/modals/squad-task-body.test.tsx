import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithI18n } from "../test/i18n";
import { useIssueDraftStore } from "@quickwork/core/issues/stores/draft-store";
import { SquadTaskBody } from "./squad-task-body";

const mocks = vi.hoisted(() => ({
  squads: [] as Array<{ id: string; name: string }>,
  agents: [] as Array<{ id: string; name: string; owner_id?: string }>,
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
  orchestrate: vi.fn(),
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
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
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
}));

vi.mock("@quickwork/core/api", () => ({
  api: {
    saveSquadPlaybook: vi.fn(),
    quickCreateIssue: vi.fn(),
    createIssueChain: vi.fn(),
  },
}));

vi.mock("@quickwork/core/hooks", () => ({
  useWorkspaceId: () => "workspace-1",
}));

vi.mock("@quickwork/core/paths", () => ({
  useCurrentWorkspace: () => ({ name: "Acme" }),
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

vi.mock("../home/use-orchestrate", () => ({
  useOrchestrate: () => ({
    orchestrate: mocks.orchestrate,
    isBusy: false,
    isSubmitting: false,
    isWaitingOnIssue: false,
  }),
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
  mocks.orchestrate.mockClear();
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

    expect(mocks.orchestrate).toHaveBeenCalledWith(
      "s-1",
      "Rework the payment retry path",
      { steps: [{ holder_user_id: "u-free", title: "Verify" }] },
    );
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

  it("names the playbook while the body still agrees with it", async () => {
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

    expect(mocks.orchestrate).toHaveBeenCalledWith(
      "s-1",
      "Rework the payment retry path",
      { playbookId: "pb-1" },
    );
    expect(document.querySelector(".qk-create-paper")).toHaveClass("is-stamping");
  });

  // "Blank" is the squad's own order, not an empty relay — the line shows it,
  // so the wire carries it. Sending [] would ask the server to re-derive the
  // same thing and would make the dispatch disagree with the screen.
  it("sends the squad's own order when no playbook was chosen", async () => {
    renderBody();
    await typePrompt();
    await start();

    expect(mocks.orchestrate).toHaveBeenCalledWith(
      "s-1",
      "Rework the payment retry path",
      {
        steps: [
          { holder_user_id: "u-park", title: "" },
          { holder_user_id: "u-free", title: "" },
        ],
      },
    );
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
