import type { ReactNode } from "react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const mockBeginIsolatedDraft = vi.hoisted(() => vi.fn());
const mockEndIsolatedDraft = vi.hoisted(() => vi.fn());
const mockRefetchSourceContext = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: { capture_token: "sha256:preview-token" },
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: mockRefetchSourceContext,
  }),
}));

vi.mock("@quickwork/core/hooks", () => ({
  useWorkspaceId: () => "ws-test",
}));

vi.mock("@quickwork/core/issues/queries", () => ({
  sourceContextPreviewOptions: (wsId: string, anchorCommentId: string) => ({
    queryKey: ["source-context", "preview", wsId, anchorCommentId],
  }),
}));

vi.mock("@quickwork/core/issues/stores/draft-store", () => ({
  useIssueDraftStore: {
    getState: () => ({
      beginIsolatedDraft: mockBeginIsolatedDraft,
      endIsolatedDraft: mockEndIsolatedDraft,
    }),
  },
}));

vi.mock("@quickwork/ui/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({
    className,
    children,
  }: {
    className?: string;
    children: ReactNode;
  }) => (
    <div data-testid="dialog-content" className={className}>
      {children}
    </div>
  ),
}));

vi.mock("./quick-create-issue", () => ({
  AgentCreatePanel: ({
    data,
  }: {
    data?: Record<string, unknown> | null;
  }) => (
    <div>
      agent panel · {String(data?.anchor_comment_id ?? "ordinary")} · {data?.source_context_expanded ? "expanded" : "collapsed"}
      <button
        type="button"
        onClick={() => (data?.source_context_on_expanded_change as ((expanded: boolean) => void) | undefined)?.(!data?.source_context_expanded)}
      >
        toggle source context
      </button>
    </div>
  ),
}));

vi.mock("./create-issue", () => ({
  ManualCreatePanel: ({
    data,
  }: {
    data?: Record<string, unknown> | null;
  }) => (
    <div>
      manual panel · {String(data?.anchor_comment_id ?? "ordinary")} · {data?.source_context_expanded ? "expanded" : "collapsed"}
      <button
        type="button"
        onClick={() => (data?.source_context_on_expanded_change as ((expanded: boolean) => void) | undefined)?.(!data?.source_context_expanded)}
      >
        toggle source context
      </button>
    </div>
  ),
  manualDialogContentClass: () => "manual-dialog-class",
}));

// `cn` is deliberately NOT mocked here: the whole point of these assertions is
// that tailwind-merge keeps the phone cap and the `sm:` width as two separate
// groups instead of collapsing them into one max-width.
import { CreateIssueDialog } from "./create-issue-dialog";

function contentClass() {
  return screen.getByTestId("dialog-content").className;
}

describe("CreateIssueDialog sizing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  // MUL-6236: every width the shell sets is `!important` so it can beat
  // DialogContent's own sizing — which also beat DialogContent's
  // `max-w-[calc(100%-2rem)]` gutter, so the card ran the full width of a
  // phone screen with no margin on either side.
  it("caps the agent dialog inside the viewport on phones", () => {
    render(<CreateIssueDialog onClose={vi.fn()} initialMode="agent" />);

    expect(contentClass()).toContain("!max-w-[calc(100vw-1.5rem)]");
    // Wider since the docket restructure: the seat card + labeled field rows
    // need the room (was max-w-xl).
    expect(contentClass()).toContain("sm:!max-w-2xl");
  });

  it("keeps the ordinary agent dialog content-driven", () => {
    render(<CreateIssueDialog onClose={vi.fn()} initialMode="agent" />);

    expect(contentClass()).toContain("!max-h-[80dvh]");
    expect(contentClass()).not.toContain("!h-96");
  });

  it("hands manual mode its own sizing", () => {
    render(<CreateIssueDialog onClose={vi.fn()} initialMode="manual" />);

    expect(contentClass()).toBe("manual-dialog-class");
  });

  it("leaves ordinary create outside the isolated source-context path", () => {
    render(
      <CreateIssueDialog
        onClose={vi.fn()}
        initialMode="agent"
        data={{ parent_issue_id: "ordinary-parent" }}
      />,
    );

    expect(screen.getByText(/agent panel · ordinary/)).toBeInTheDocument();
    expect(mockBeginIsolatedDraft).not.toHaveBeenCalled();
  });

  it("isolates source-context drafts and expands the agent dialog", () => {
    const view = render(
      <CreateIssueDialog
        onClose={vi.fn()}
        initialMode="agent"
        data={{ anchor_comment_id: "comment-source", parent_issue_id: "parent-source" }}
      />,
    );

    expect(mockBeginIsolatedDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/agent panel · comment-source/)).toBeInTheDocument();
    expect(contentClass()).toContain("!h-96");
    expect(contentClass()).toContain("sm:!max-w-xl");
    fireEvent.click(screen.getByRole("button", { name: "toggle source context" }));
    expect(screen.getByText(/agent panel · comment-source · expanded/)).toBeInTheDocument();
    expect(contentClass()).toContain("!h-5/6");
    expect(contentClass()).toContain("sm:!max-w-2xl");
    expect(contentClass()).not.toContain("!h-96");

    view.unmount();
    expect(mockEndIsolatedDraft).toHaveBeenCalledTimes(1);
  });

  // The manual form can still carry a source-context anchor when a surface
  // opens it directly; the shell must merge the preview data and drive its
  // sizing the same way the agent path does.
  it("hands source-context data to a directly-opened manual dialog", () => {
    render(
      <CreateIssueDialog
        onClose={vi.fn()}
        initialMode="manual"
        data={{ anchor_comment_id: "comment-source" }}
      />,
    );

    expect(screen.getByText(/manual panel · comment-source/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "toggle source context" }));
    expect(screen.getByText(/manual panel · comment-source · expanded/)).toBeInTheDocument();
    expect(contentClass()).toContain("manual-dialog-class");
    expect(contentClass()).toContain("!h-5/6");
  });
});
