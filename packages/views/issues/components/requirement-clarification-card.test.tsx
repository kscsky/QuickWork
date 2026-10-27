// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@quickwork/core/i18n/react";
import type { Issue } from "@quickwork/core/types";
import enCommon from "../../locales/en/common.json";
import enIssues from "../../locales/en/issues.json";

const saveMetadata = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@quickwork/core/api", () => ({
  api: { setIssueMetadata: saveMetadata },
}));
vi.mock("@quickwork/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { RequirementClarificationCard } from "./requirement-clarification-card";

const TEST_RESOURCES = { en: { common: enCommon, issues: enIssues } };

function issue(metadata: Record<string, unknown> = {}): Issue {
  return {
    id: "issue-1",
    workspace_id: "ws-1",
    number: 1,
    identifier: "KS-1",
    title: "Test task",
    description: null,
    status: "todo",
    priority: "none",
    assignee_type: null,
    assignee_id: null,
    creator_type: "member",
    creator_id: "user-1",
    parent_issue_id: null,
    project_id: null,
    metadata,
    created_at: "2026-10-19T00:00:00Z",
    updated_at: "2026-10-19T00:00:00Z",
  } as unknown as Issue;
}

function renderCard(value: Issue = issue()) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      <QueryClientProvider client={qc}>
        <RequirementClarificationCard issue={value} />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RequirementClarificationCard", () => {
  it("saves the clarification to issue metadata", async () => {
    renderCard();

    expect(screen.getByText("Requirement clarification")).toBeTruthy();
    fireEvent.click(
      screen.getByText(
        "Write down how you understand the requirement, its boundaries, and acceptance criteria.",
      ),
    );

    const textarea = screen.getByPlaceholderText(
      "Scope / boundaries / acceptance criteria…",
    );
    fireEvent.change(textarea, {
      target: { value: "  Clarify the scope.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(saveMetadata).toHaveBeenCalledWith(
        "issue-1",
        "requirement_clarification",
        "Clarify the scope.",
      );
    });
  });

  it("shows a saved clarification", () => {
    renderCard(issue({ requirement_clarification: "Existing plan" }));
    expect(screen.getByText("Existing plan")).toBeTruthy();
  });
});
