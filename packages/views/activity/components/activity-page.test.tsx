/**
 * The activity page exists to make privileged moves traceable: only the four
 * decisions that change the relay show up, admin actions are marked, and a
 * pending turn appears in the top band instead of a separate notification
 * inbox. The row copy and the filters are the product's audit surface, so
 * they are asserted here rather than re-derived through helper matrices.
 */
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { NavigationProvider, type NavigationAdapter } from "../../navigation";
import { renderWithI18n } from "../../test/i18n";
import { ActivityPage } from "./activity-page";

const { EVENTS, INBOX } = vi.hoisted(() => {
  const now = new Date().toISOString();
  return {
    EVENTS: [
      {
        id: "e1",
        issue_id: "i1",
        identifier: "KSCS-1",
        issue_title: "One",
        actor_id: "u-1",
        action: "relay_approved",
        leg: 1,
        from_user_id: "u-1",
        to_user_id: null,
        reason: "",
        admin: false,
        created_at: now,
      },
      {
        id: "e2",
        issue_id: "i2",
        identifier: "KSCS-2",
        issue_title: "Two",
        actor_id: "u-1",
        action: "relay_reassigned",
        leg: 2,
        from_user_id: "u-1",
        to_user_id: "u-2",
        reason: "machine is someone else's private runtime",
        admin: true,
        created_at: now,
      },
      {
        id: "e3",
        issue_id: "i3",
        identifier: "KSCS-3",
        issue_title: "Three",
        actor_id: "u-2",
        action: "relay_returned",
        leg: 1,
        from_user_id: "u-2",
        to_user_id: null,
        reason: "missing source",
        admin: false,
        created_at: now,
      },
      {
        id: "e4",
        issue_id: "i4",
        identifier: "KSCS-4",
        issue_title: "Four",
        actor_id: "u-1",
        action: "relay_skipped",
        leg: 3,
        from_user_id: "u-3",
        to_user_id: null,
        reason: "",
        admin: true,
        created_at: now,
      },
    ],
    INBOX: [
      {
        id: "n1",
        workspace_id: "ws-1",
        recipient_type: "member",
        recipient_id: "u-1",
        type: "relay_turn",
        severity: "action_required",
        issue_id: "i1",
        title: "Review needed: One",
        body: null,
        issue_status: null,
        issue_priority: null,
        read: false,
        archived: false,
        created_at: now,
        details: { state: "reviewing", position: 0 },
      },
      {
        id: "n2",
        workspace_id: "ws-1",
        recipient_type: "member",
        recipient_id: "u-1",
        type: "relay_turn",
        severity: "action_required",
        issue_id: "i2",
        title: "Relay stopped: Two",
        body: null,
        issue_status: null,
        issue_priority: null,
        read: false,
        archived: false,
        created_at: now,
        details: { state: "parked", position: 1 },
      },
      {
        id: "n3",
        workspace_id: "ws-1",
        recipient_type: "member",
        recipient_id: "u-1",
        type: "mentioned",
        severity: "attention",
        issue_id: "i3",
        title: "Bob mentioned you",
        body: null,
        issue_status: null,
        issue_priority: null,
        read: false,
        archived: false,
        created_at: now,
        details: null,
      },
    ],
  };
});

vi.mock("@quickwork/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@quickwork/core/paths", () => ({
  useWorkspacePaths: () => ({
    issueDetail: (id: string) => `/acme/issues/${id}`,
    tasks: () => "/acme/tasks",
    inbox: () => "/acme/inbox",
  }),
}));
vi.mock("@quickwork/core/workspace/hooks", () => ({
  useActorName: () => ({
    getMemberName: (id: string) =>
      ({ "u-1": "Alice", "u-2": "Bob", "u-3": "Carol" })[id] ?? id,
  }),
}));
vi.mock("@quickwork/core/activity/queries", () => ({
  activityListOptions: () => ({
    queryKey: ["activity", "ws-1"],
    queryFn: () => Promise.resolve(EVENTS),
  }),
}));
vi.mock("@quickwork/core/inbox/queries", () => ({
  inboxListOptions: () => ({
    queryKey: ["inbox", "ws-1"],
    queryFn: () => Promise.resolve(INBOX),
  }),
  deduplicateInboxItems: (items: unknown[]) => items,
}));

const adapter: NavigationAdapter = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  pathname: "/acme/activity",
  searchParams: new URLSearchParams(),
  hash: "",
  getShareableUrl: (path: string) => `https://quickwork.test${path}`,
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return renderWithI18n(
    <QueryClientProvider client={queryClient}>
      <NavigationProvider value={adapter}>
        <ActivityPage />
      </NavigationProvider>
    </QueryClientProvider>,
  );
}

describe("ActivityPage", () => {
  it("shows the pending turns and the four decisions", async () => {
    renderPage();

    expect(await screen.findByText(/Needs you · 2/)).toBeInTheDocument();
    expect(screen.getByText("Review needed: One · Leg 1 delivered")).toBeInTheDocument();
    expect(screen.getByText("Relay stopped: Two · Leg 2 is blocked")).toBeInTheDocument();
    expect(
      screen.getByText("Also 1 mentions & comments · View all notifications →"),
    ).toBeInTheDocument();

    expect(await screen.findByText(/approved leg 1/)).toBeInTheDocument();
    expect(screen.getByText(/reassigned leg 2 to Bob/)).toBeInTheDocument();
    expect(screen.getByText(/returned leg 1 for changes/)).toBeInTheDocument();
    expect(screen.getByText(/skipped leg 3/)).toBeInTheDocument();
    // Privileged moves carry the traceability marker.
    expect(screen.getAllByText("ADMIN")).toHaveLength(2);
    // The newest row is marked as live; the relay is not a static archive.
    expect(screen.getByText("just now")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "KSCS-2" })).toHaveAttribute(
      "href",
      "/acme/issues/i2",
    );
  });

  it("filters down to reassign and skip", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/approved leg 1/);

    await user.click(screen.getByRole("button", { name: /Reassign & skip/ }));

    expect(screen.getByText(/reassigned leg 2 to Bob/)).toBeInTheDocument();
    expect(screen.getByText(/skipped leg 3/)).toBeInTheDocument();
    expect(screen.queryByText(/approved leg 1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/returned leg 1 for changes/)).not.toBeInTheDocument();
  });
});
