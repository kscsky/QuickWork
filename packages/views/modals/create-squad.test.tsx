// @vitest-environment jsdom

import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "@quickwork/core/i18n/react";
import type { Agent, MemberWithUser, Squad } from "@quickwork/core/types";
import enCommon from "../locales/en/common.json";
import enModals from "../locales/en/modals.json";
import enAgents from "../locales/en/agents.json";
import enIssues from "../locales/en/issues.json";
import enOnboarding from "../locales/en/onboarding.json";
import enSquads from "../locales/en/squads.json";

const TEST_RESOURCES = {
  en: {
    common: enCommon,
    modals: enModals,
    agents: enAgents,
    issues: enIssues,
    onboarding: enOnboarding,
    squads: enSquads,
  },
};

const ME = "user-me";
const OTHER = "user-other";

// Hoisted so each test can override mock return values per case.
const mocks = vi.hoisted(() => ({
  agents: [] as Agent[],
  members: [] as MemberWithUser[],
  createSquad: vi.fn(),
  addSquadMember: vi.fn(),
  updateMe: vi.fn(),
  navigationPush: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey?: unknown[] }) => {
    const key = opts.queryKey ?? [];
    if (Array.isArray(key) && key.includes("agents")) {
      return { data: mocks.agents };
    }
    if (Array.isArray(key) && key.includes("members")) {
      return { data: mocks.members };
    }
    return { data: [] };
  },
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));

vi.mock("@quickwork/core/workspace/queries", () => ({
  agentListOptions: () => ({ queryKey: ["agents"] }),
  memberListOptions: () => ({ queryKey: ["members"] }),
  workspaceKeys: { squads: (id: string) => ["squads", id] },
}));

vi.mock("@quickwork/core/api", () => ({
  api: {
    createSquad: (...args: unknown[]) => mocks.createSquad(...args),
    addSquadMember: (...args: unknown[]) => mocks.addSquadMember(...args),
    updateMe: (...args: unknown[]) => mocks.updateMe(...args),
  },
}));

vi.mock("@quickwork/core/auth", () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: ME } }),
}));

vi.mock("@quickwork/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@quickwork/core/paths", () => ({
  useWorkspacePaths: () => ({
    squadDetail: (id: string) => `/test-ws/squads/${id}`,
  }),
}));

vi.mock("@quickwork/core/utils", () => ({
  isImeComposing: () => false,
}));

vi.mock("../navigation", () => ({
  useNavigation: () => ({ push: mocks.navigationPush }),
}));

vi.mock("../common/actor-avatar", () => ({
  ActorAvatar: ({ actorId }: { actorId: string }) => (
    <span data-testid={`avatar-${actorId}`} />
  ),
}));

vi.mock("../common/avatar-upload-control", () => ({
  AvatarUploadControl: ({
    value,
    onUploaded,
  }: {
    value: string | null;
    onUploaded: (v: string) => void;
  }) => (
    <button
      type="button"
      data-testid="avatar-picker"
      data-value={value ?? ""}
      onClick={() => onUploaded("https://example.com/avatar.png")}
    >
      avatar
    </button>
  ),
}));

vi.mock("../agents/components/char-counter", () => ({
  CharCounter: ({ length, max }: { length: number; max: number }) => (
    <span data-testid="char-counter">
      {length}/{max}
    </span>
  ),
}));

// Render Popover/PopoverContent inline so the picker rows are queryable
// without simulating a Base UI portal — we still drive the open prop via
// PopoverTrigger clicks but the content is always in the DOM.
vi.mock("@quickwork/ui/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({
    children,
    className,
    onClick,
    render,
  }: {
    children?: ReactNode;
    className?: string;
    onClick?: () => void;
    render?: ReactNode;
  }) => {
    // Base UI's `render` prop replaces the trigger with the provided element.
    // The mock just renders it as-is so its children stay queryable in tests.
    if (render !== undefined) return <>{render}</>;
    return (
      <button type="button" className={className} onClick={onClick}>
        {children}
      </button>
    );
  },
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@quickwork/ui/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

vi.mock("@quickwork/ui/components/ui/button", () => ({
  Button: ({
    children,
    disabled,
    onClick,
    type = "button",
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    type?: "button" | "submit" | "reset";
  }) => (
    <button type={type} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@quickwork/ui/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

vi.mock("@quickwork/ui/components/ui/label", () => ({
  Label: ({ children, className }: { children: ReactNode; className?: string }) => (
    <label className={className}>{children}</label>
  ),
}));

vi.mock("../editor/extensions/pinyin-match", () => ({
  matchesPinyin: () => false,
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mocks.toastSuccess(...args),
    error: (...args: unknown[]) => mocks.toastError(...args),
    warning: (...args: unknown[]) => mocks.toastWarning(...args),
  },
}));

import { CreateSquadModal } from "./create-squad";

function makeAgent(overrides: Partial<Agent> & { id: string; name: string; owner_id: string | null }): Agent {
  return {
    workspace_id: "ws-1",
    runtime_id: "rt-1",
    description: "",
    instructions: "",
    avatar_url: null,
    runtime_mode: "local",
    runtime_config: {},
    custom_args: [],
    visibility: "private",
    permission_mode: "private",
    invocation_targets: [],
    status: "idle",
    max_concurrent_tasks: 1,
    model: "",
    skills: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    archived_at: null,
    archived_by: null,
    ...overrides,
  };
}

function makeMember(user_id: string, name: string): MemberWithUser {
  return {
    id: `m-${user_id}`,
    user_id,
    workspace_id: "ws-1",
    role: "member",
    name,
    email: `${user_id}@example.com`,
    avatar_url: null,
    created_at: "2026-01-01T00:00:00Z",
  };
}

function makeSquad(overrides: Partial<Squad> = {}): Squad {
  return {
    id: "sq-new",
    workspace_id: "ws-1",
    name: "New Squad",
    description: "",
    instructions: "",
    avatar_url: null,
    leader_id: "agent-mine-1",
    creator_id: ME,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    archived_at: null,
    archived_by: null,
    ...overrides,
  };
}

// getAllByText is typed to never return undefined slots, but the indexed
// access goes through `noUncheckedIndexedAccess` so we narrow explicitly.
function firstMatch(label: string | RegExp): HTMLElement {
  const matches = screen.getAllByText(label);
  if (matches.length === 0) throw new Error(`no match for "${String(label)}"`);
  return matches[0]!;
}

function renderModal() {
  const onClose = vi.fn();
  render(
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      <CreateSquadModal onClose={onClose} />
    </I18nProvider>,
  );
  return { onClose };
}

const myAgent = makeAgent({ id: "agent-mine-1", name: "MineAgentOne", owner_id: ME });
const myAgent2 = makeAgent({ id: "agent-mine-2", name: "MineAgentTwo", owner_id: ME });
const otherAgent = makeAgent({ id: "agent-other-1", name: "OtherAgentOne", owner_id: OTHER });
const wsMember = makeMember(OTHER, "Workspace Pal");

describe("CreateSquadModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.agents = [otherAgent, myAgent, myAgent2];
    mocks.members = [wsMember];
    mocks.updateMe.mockResolvedValue({ id: ME });
    mocks.createSquad.mockResolvedValue(makeSquad());
    mocks.addSquadMember.mockResolvedValue({});
  });

  // The wizard gates each step on the one before it, so a test that needs a
  // later step has to walk there. Buttons are found by label rather than by
  // index, so reordering the footer cannot silently change what a test presses.
  function clickButton(label: string | RegExp) {
    const btn = screen
      .getAllByRole("button")
      .find((b) =>
        typeof label === "string"
          ? b.textContent?.includes(label)
          : label.test(b.textContent ?? ""),
      );
    if (!btn) throw new Error(`button not found: ${String(label)}`);
    fireEvent.click(btn);
    return btn;
  }

  function nextButton(): HTMLButtonElement {
    const btn = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("Next"));
    if (!btn) throw new Error("Next button not found");
    return btn as HTMLButtonElement;
  }

  function toPeopleStep(identity: RegExp = /Engineer/i) {
    clickButton(identity);
    clickButton("Next");
  }

  function toRolesStep(identity?: RegExp) {
    toPeopleStep(identity);
    clickButton("Next");
  }

  function toRoomStep(identity?: RegExp) {
    toRolesStep(identity);
    // Step 3 is gated on the leader having an agent to route work to. The
    // caller leads by default and owns myAgent, so this passes without a pick.
    clickButton("Next");
  }

  function nameTheRoom(label = "Payments") {
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Frontend Team/i), {
      target: { value: label },
    });
  }

  // ── step 1: identity ──────────────────────────────────────────────────

  it("gates the first step on declaring an identity", () => {
    mocks.members = []; // nobody in this workspace has declared one yet
    renderModal();

    expect(nextButton()).toBeDisabled();

    fireEvent.click(firstMatch(/Engineer/i));
    expect(nextButton()).not.toBeDisabled();
  });

  it("pre-selects the identity the caller already registered", () => {
    mocks.members = [wsMember, { ...makeMember(ME, "Me"), identity: "designer" }];
    renderModal();

    // Already answered, so the step advances without an explicit pick.
    expect(nextButton()).not.toBeDisabled();
    expect(screen.getByText(/Registered as Designer/i)).toBeDefined();
  });

  // ── step 3: roles and the work switch ─────────────────────────────────

  it("carries a role control for every member including the caller", () => {
    renderModal();
    toRolesStep();

    expect(screen.getByLabelText(/Role for You/i)).toBeDefined();
  });

  it("keeps exactly one leader, demoting the previous one", () => {
    renderModal();
    toPeopleStep();
    fireEvent.click(firstMatch("Workspace Pal"));
    clickButton("Next");

    // The caller starts as leader; promoting the pick must hand it over rather
    // than leaving two, because the squad routes its work to the leader.
    fireEvent.change(screen.getByLabelText(/Role for Workspace Pal/i), {
      target: { value: "leader" },
    });

    expect(
      (screen.getByLabelText(/Role for Workspace Pal/i) as HTMLSelectElement).value,
    ).toBe("leader");
    expect(
      (screen.getByLabelText(/Role for You/i) as HTMLSelectElement).value,
    ).toBe("executor");
  });

  it("offers no way to add an agent directly — only people", () => {
    renderModal();
    toPeopleStep();

    // The old picker listed workspace agents beside the people; an agent now
    // reaches a room only through its owner.
    expect(screen.queryByTestId("avatar-agent-other-1")).toBeNull();
    expect(screen.getByText("Workspace Pal")).toBeDefined();
  });

  it("toggles whether a member's agents may take work", () => {
    renderModal();
    toPeopleStep();
    fireEvent.click(firstMatch("Workspace Pal"));
    clickButton("Next");

    const toggle = screen.getByLabelText(/Take work for Workspace Pal/i);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });

  // ── submit ────────────────────────────────────────────────────────────

  it("writes a newly declared identity to the account before creating", async () => {
    renderModal();
    toRoomStep();
    nameTheRoom();
    clickButton("Create Squad");

    await waitFor(() => expect(mocks.createSquad).toHaveBeenCalledTimes(1));
    expect(mocks.updateMe).toHaveBeenCalledWith({ identity: "engineer" });
  });

  it("does not rewrite the identity when it is already the registered one", async () => {
    mocks.members = [wsMember, { ...makeMember(ME, "Me"), identity: "engineer" }];
    renderModal();
    toRoomStep();
    nameTheRoom();
    clickButton("Create Squad");

    await waitFor(() => expect(mocks.createSquad).toHaveBeenCalledTimes(1));
    expect(mocks.updateMe).not.toHaveBeenCalled();
  });

  it("lets the leader name which of their agents routes the squad's work", async () => {
    // The caller owns two agents and leads by default, so both chips are
    // offered — silently taking the first is how a fixture agent ends up
    // leading a room nobody meant to give it to.
    renderModal();
    toRolesStep();

    // The leader's lent agent IS the routing agent, so this one control
    // decides both.
    fireEvent.change(screen.getByLabelText(/Agent You lends to this squad/i), {
      target: { value: "agent-mine-2" },
    });
    clickButton("Next");
    nameTheRoom();
    clickButton("Create Squad");

    await waitFor(() => expect(mocks.createSquad).toHaveBeenCalledTimes(1));
    expect(mocks.createSquad).toHaveBeenCalledWith(
      expect.objectContaining({ leader_id: "agent-mine-2" }),
    );
  });

  it("puts the caller in their own room so they can speak in it", async () => {
    renderModal();
    toRoomStep();
    nameTheRoom();
    clickButton("Create Squad");

    await waitFor(() => expect(mocks.addSquadMember).toHaveBeenCalledTimes(1));
    expect(mocks.addSquadMember).toHaveBeenCalledWith("sq-new", {
      member_type: "member",
      member_id: ME,
      role: "leader",
      can_receive_work: true,
      // Nobody chose an agent, so the leader defaults to their first.
      agent_id: "agent-mine-1",
    });
  });

  it("sends each picked member's role and work switch", async () => {
    renderModal();
    toPeopleStep();
    fireEvent.click(firstMatch("Workspace Pal"));
    clickButton("Next");

    // Demote the pick to an observer who is not available for work.
    fireEvent.change(screen.getByLabelText(/Role for Workspace Pal/i), {
      target: { value: "observer" },
    });
    fireEvent.click(screen.getByLabelText(/Take work for Workspace Pal/i));

    // No agent to pick: the caller leads and owns myAgent, which the squad
    // routes its work through.
    clickButton("Next");
    nameTheRoom();
    clickButton("Create Squad");

    await waitFor(() => expect(mocks.addSquadMember).toHaveBeenCalledTimes(2));
    expect(mocks.addSquadMember).toHaveBeenCalledWith("sq-new", {
      member_type: "member",
      member_id: OTHER,
      role: "observer",
      can_receive_work: false,
      // They own exactly one agent, so adding them lends it without a second
      // decision.
      agent_id: "agent-other-1",
    });
  });

  it("navigates to the new room and closes on success", async () => {
    const { onClose } = renderModal();
    toRoomStep();
    nameTheRoom();
    clickButton("Create Squad");

    await waitFor(() =>
      expect(mocks.navigationPush).toHaveBeenCalledWith("/test-ws/squads/sq-new"),
    );
    expect(onClose).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalled();
  });

  it("reports a partial member failure but still creates the room", async () => {
    mocks.addSquadMember.mockRejectedValueOnce(new Error("nope"));
    renderModal();
    toRoomStep();
    nameTheRoom();
    clickButton("Create Squad");

    await waitFor(() => expect(mocks.toastWarning).toHaveBeenCalled());
    expect(mocks.navigationPush).toHaveBeenCalled();
  });

  it("stays put and re-enables submit when creation fails", async () => {
    mocks.createSquad.mockRejectedValue(new Error("boom"));
    renderModal();
    toRoomStep();
    nameTheRoom();
    clickButton("Create Squad");

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(mocks.navigationPush).not.toHaveBeenCalled();
    expect(
      screen
        .getAllByRole("button")
        .find((b) => b.textContent?.includes("Create Squad")),
    ).not.toBeDisabled();
  });
});
