/**
 * The parked bar has to name the actual blocker. A holder who HAS an agent but
 * whose machine is someone else's private runtime used to read "he has not
 * bound an agent" and wait forever. Each reason therefore gets its own sentence
 * and its own fix; an unknown reason stays generic rather than inventing one.
 */
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { IssueChainStep } from "@quickwork/core/types";

import { NavigationProvider } from "../../navigation";
import type { NavigationAdapter } from "../../navigation";
import { renderWithI18n } from "../../test/i18n";
import { ChainAdminBar, ChainParkedBar } from "./squad-room";

vi.mock("../../common/actor-avatar", () => ({
  ActorAvatar: () => null,
}));

const adapter: NavigationAdapter = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  pathname: "/acme/tasks/1",
  searchParams: new URLSearchParams(),
  hash: "",
  getShareableUrl: (path: string) => `https://quickwork.test${path}`,
};

const step: IssueChainStep = {
  id: "step-1",
  position: 1,
  holder_user_id: "u-1",
  agent_id: "a-1",
  title: "Deliver",
  state: "parked",
};

function renderBar(parkedReason?: string, machineHref?: string) {
  return renderWithI18n(
    <NavigationProvider value={adapter}>
      <ChainParkedBar
        step={{ ...step, parked_reason: parkedReason }}
        nameOf={() => "Li Tejie"}
        bindHref="/acme/squads/s-1"
        machineHref={machineHref}
        onSkip={() => {}}
        skipPending={false}
      />
    </NavigationProvider>,
  );
}

const people = [
  { userId: "u-1", name: "Li Tejie" },
  { userId: "u-2", name: "Wang Fang" },
];

function renderAdminBar({
  state = "reviewing" as IssueChainStep["state"],
  onSkipReview = vi.fn(),
  onReassign = vi.fn(),
}: {
  state?: IssueChainStep["state"];
  onSkipReview?: () => void;
  onReassign?: (userId: string) => void;
} = {}) {
  return renderWithI18n(
    <NavigationProvider value={adapter}>
      <ChainAdminBar
        step={{ ...step, state }}
        people={people}
        onReassign={onReassign}
        reassignPending={false}
        onSkipReview={state === "reviewing" ? onSkipReview : undefined}
        skipPending={false}
      />
    </NavigationProvider>,
  );
}

describe("ChainParkedBar", () => {
  it("explains a foreign private machine and offers the matching fix", () => {
    renderBar("runtime_private_foreign");

    expect(
      screen.getByText(/runs on someone else's private machine/),
    ).toBeInTheDocument();
    expect(screen.getByText(/switch machines/)).toBeInTheDocument();
  });

  it("keeps the bind-an-agent copy when no agent is the blocker", () => {
    renderBar("no_agent");

    expect(screen.getByText(/has not bound an agent/)).toBeInTheDocument();
    expect(screen.getByText(/Ask Li Tejie to bind one/)).toBeInTheDocument();
  });

  it("stays generic for a reason this client does not know", () => {
    renderBar("some_future_reason");

    expect(screen.getByText(/leg cannot start right now/)).toBeInTheDocument();
    expect(screen.getByText(/Ask Li Tejie to fix it/)).toBeInTheDocument();
  });

  it("offers the machines page for machine-shaped reasons", () => {
    renderBar("runtime_offline", "/acme/runtimes");

    expect(screen.getByRole("link", { name: "View machines" })).toHaveAttribute(
      "href",
      "/acme/runtimes",
    );
  });

  it("does not offer machines when the blocker is a missing agent", () => {
    renderBar("no_agent", "/acme/runtimes");

    expect(
      screen.queryByRole("link", { name: "View machines" }),
    ).not.toBeInTheDocument();
  });
});

describe("ChainAdminBar", () => {
  it("makes skipping a review take two clicks", async () => {
    const user = userEvent.setup();
    const onSkipReview = vi.fn();
    renderAdminBar({ onSkipReview });

    await user.click(screen.getByRole("button", { name: "Skip review" }));
    expect(onSkipReview).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: /Confirm skip/ }),
    );
    expect(onSkipReview).toHaveBeenCalledTimes(1);
  });

  it("will not reassign until a target is chosen", () => {
    renderAdminBar();

    expect(screen.getByRole("button", { name: "Reassign" })).toBeDisabled();
  });

  it("offers reassignment but no review skip on a parked leg", () => {
    renderAdminBar({ state: "parked" });

    expect(screen.getByRole("button", { name: "Reassign" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Skip review" }),
    ).not.toBeInTheDocument();
  });
});
