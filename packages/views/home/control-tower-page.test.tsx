import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithI18n } from "../test/i18n";
import { ControlTowerPage } from "./control-tower-page";

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

vi.mock("../common/actor-avatar", () => ({
  ActorAvatar: () => null,
}));

vi.mock("./use-orchestrate", () => ({
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

beforeEach(() => {
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
  await user.type(screen.getByPlaceholderText(/What should this squad/), text);
}

async function start() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Start" }));
}

describe("ControlTowerPage compose canvas", () => {
  // The route line is the whole picture of what will happen, and it opens
  // read-only: the leader is step one and the saved route follows.
  it("opens on the question with the route already answered", () => {
    renderWithI18n(<ControlTowerPage />);

    expect(
      screen.getByRole("heading", { name: /What should this squad work on/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("It will go")).toBeInTheDocument();
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
    renderWithI18n(<ControlTowerPage />);

    // The route seeds from the first render, so the line is already complete.
    expect(screen.getByText("Li Tejie")).toBeInTheDocument();
    expect(screen.getByText("Chen Chen")).toBeInTheDocument();

    // The consequence is stated in words rather than left for the reader to
    // infer from a colour: this is the fact the whole page exists to surface.
    expect(
      screen.getByText(/Li Tejie has no agent bound/),
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
    renderWithI18n(<ControlTowerPage />);
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

  it("names the playbook while the canvas still agrees with it", async () => {
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
    renderWithI18n(<ControlTowerPage />);
    await typePrompt();
    await start();

    expect(mocks.orchestrate).toHaveBeenCalledWith(
      "s-1",
      "Rework the payment retry path",
      { playbookId: "pb-1" },
    );
  });

  // "Blank" is the squad's own order, not an empty relay — the line shows it,
  // so the wire carries it. Sending [] would ask the server to re-derive the
  // same thing and would make the dispatch disagree with the screen.
  it("sends the squad's own order when no playbook was chosen", async () => {
    renderWithI18n(<ControlTowerPage />);
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

  // The per-dispatch choice: a person can own several agents, and which one
  // runs a step is a decision about THIS task. It travels with the dispatch
  // rather than being written into the squad binding or a saved route.
  it("carries a per-step agent choice into the dispatch", async () => {
    mocks.agents = [
      { id: "a-arch", name: "Architect Agent", owner_id: "u-lead" },
      { id: "a-second", name: "Second Agent", owner_id: "u-park" },
      { id: "a-fe", name: "Frontend Agent", owner_id: "u-free" },
    ];
    renderWithI18n(<ControlTowerPage />);
    await typePrompt();

    const user = userEvent.setup();
    // The parked holder's row opens on "no agent"; pick the one they own.
    await user.click(screen.getByRole("button", { name: /No agent yet/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Second Agent" }));

    await start();

    expect(mocks.orchestrate).toHaveBeenCalledWith(
      "s-1",
      "Rework the payment retry path",
      {
        steps: [
          { holder_user_id: "u-park", title: "", agent_id: "a-second" },
          { holder_user_id: "u-free", title: "" },
        ],
      },
    );
  });

  it("will not dispatch without a prompt", () => {
    renderWithI18n(<ControlTowerPage />);

    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  });

  it("falls back to the create-squad state when the workspace has none", () => {
    mocks.squads = [];
    renderWithI18n(<ControlTowerPage />);

    expect(
      screen.queryByPlaceholderText(/What should this squad/),
    ).not.toBeInTheDocument();
  });
});
