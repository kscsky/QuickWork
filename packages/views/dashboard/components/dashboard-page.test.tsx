import { useMemo, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithI18n } from "../../test/i18n";
import { NavigationProvider } from "../../navigation";
import type { NavigationAdapter } from "../../navigation";

// The page reads two kinds of data through useQuery: workspace lists
// (projects/agents) and the usage endpoints. Mocking useQuery itself keeps this
// suite on the page's rendering and navigation contract, not on React Query's
// cache machinery, which the core query tests already cover.
const queryKeys = vi.hoisted(() => [] as unknown[][]);
const tzRef = vi.hoisted(() => ({ current: "UTC" as string | null }));
const today = new Date().toISOString().slice(0, 10);

const MODEL_SUMMARY = {
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  call_count: 2,
  input_tokens: 1_000,
  output_tokens: 200,
  cache_read_tokens: 500,
  cache_write_tokens: 0,
  cost_usd_ticks: 0,
  uncosted_input_tokens: 1_000,
  uncosted_output_tokens: 200,
  uncosted_cache_read_tokens: 500,
  uncosted_cache_write_tokens: 0,
  success_calls: 1,
  failed_calls: 1,
  cancelled_calls: 0,
  running_calls: 0,
};

const OVERVIEW = {
  daily: [{ date: today, ...MODEL_SUMMARY }],
  by_model: [MODEL_SUMMARY],
  by_agent: [{ agent_id: "agent-1", ...MODEL_SUMMARY }],
  previous_by_model: [],
};

const LOGS = {
  rows: [
    {
      id: "usage-1",
      task_id: "task-1",
      status: "success",
      db_status: "completed",
      agent_id: "agent-1",
      agent_name: "Agent One",
      agent_restricted: false,
      issue_id: "issue-1",
      issue_identifier: "ACME-1",
      issue_title: "Fix login",
      project_id: "project-1",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      trigger: "comment",
      failure_reason: "",
      started_at: new Date(Date.now() - 60_000).toISOString(),
      completed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      input_tokens: 1_000,
      output_tokens: 200,
      cache_read_tokens: 500,
      cache_write_tokens: 0,
    },
  ],
  total: 1,
  page: 1,
  page_size: 25,
  summary: {
    by_model: [{ ...MODEL_SUMMARY, failed_calls: 0, success_calls: 2 }],
    status_counts: { all: 2, success: 2, failed: 0, cancelled: 0, running: 0 },
  },
};

vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
    useQuery: (options: { queryKey: readonly unknown[] }) => {
      queryKeys.push([...options.queryKey]);
      const key = options.queryKey;
      const base = {
        isLoading: false,
        isFetching: false,
        isError: false,
        refetch: vi.fn(),
        dataUpdatedAt: Date.now(),
      };
      if (key[0] === "projects") {
        return { ...base, data: [{ id: "project-1", title: "Project One" }] };
      }
      if (key[0] === "workspaces" && key[2] === "agents") {
        return { ...base, data: [{ id: "agent-1", name: "Agent One" }] };
      }
      if (key[0] === "dashboard" && key[2] === "usage-overview") {
        return { ...base, data: OVERVIEW };
      }
      if (key[0] === "dashboard" && key[2] === "usage-logs") {
        return { ...base, data: LOGS };
      }
      return { ...base, data: undefined };
    },
  };
});

vi.mock("@quickwork/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@quickwork/core/api", () => ({
  api: {
    getBaseUrl: () => "https://example.test",
    getUsageLogs: vi.fn(),
  },
}));

vi.mock("@quickwork/core/auth", () => {
  type AuthState = { user: { timezone: string | null } | null };
  const state = (): AuthState => ({ user: { timezone: tzRef.current } });
  const useAuthStore = Object.assign(
    (selector?: (value: AuthState) => unknown) => (selector ? selector(state()) : state()),
    { getState: state },
  );
  return { useAuthStore };
});

vi.mock("@quickwork/core/runtimes/custom-pricing-store", () => {
  const state = () => ({ pricings: {} });
  const useCustomPricingStore = Object.assign(
    (selector?: (value: ReturnType<typeof state>) => unknown) =>
      selector ? selector(state()) : state(),
    { getState: state },
  );
  return { useCustomPricingStore };
});

import { DashboardPage } from "./dashboard-page";

const replaceSpy = vi.fn();

function DashboardHarness({ initialSearch = "" }: { initialSearch?: string }) {
  const [search, setSearch] = useState(initialSearch);
  const adapter = useMemo<NavigationAdapter>(
    () => ({
      push: vi.fn(),
      replace: (path: string) => {
        replaceSpy(path);
        setSearch(path.split("?")[1] ?? "");
      },
      back: vi.fn(),
      pathname: "/acme/usage",
      searchParams: new URLSearchParams(search),
      hash: "",
      getShareableUrl: (path: string) => `https://example.test${path}`,
    }),
    [search],
  );
  return (
    <NavigationProvider value={adapter}>
      <DashboardPage />
    </NavigationProvider>
  );
}

function renderDashboard(initialSearch = "") {
  return renderWithI18n(<DashboardHarness initialSearch={initialSearch} />);
}

function latestQueryKey(kind: string): readonly unknown[] | undefined {
  return [...queryKeys].reverse().find((key) => key[0] === "dashboard" && key[2] === kind);
}

afterEach(() => {
  cleanup();
  queryKeys.length = 0;
  replaceSpy.mockClear();
  tzRef.current = "UTC";
});

describe("usage page", () => {
  it("renders the overview totals, model breakdown, and agent spend", () => {
    renderDashboard();
    expect(screen.getByRole("heading", { name: "Usage" })).toBeInTheDocument();
    expect(screen.getByText("Agent spend")).toBeInTheDocument();
    expect(screen.getByText("Agent One")).toBeInTheDocument();
    expect(screen.getAllByText("claude-sonnet-4-6").length).toBeGreaterThan(0);
    expect(screen.getByTitle("View claude-sonnet-4-6 call log")).toBeInTheDocument();
  });

  it("drills from a model row into the call log with that model filtered", async () => {
    const user = userEvent.setup();
    renderDashboard();
    await user.click(screen.getByTitle("View claude-sonnet-4-6 call log"));

    expect(replaceSpy).toHaveBeenCalledWith("/acme/usage?tab=logs");
    expect(await screen.findByText("Model call log")).toBeInTheDocument();
    expect(screen.getByText("Fix login")).toBeInTheDocument();

    await waitFor(() => {
      const logKey = latestQueryKey("usage-logs");
      expect(logKey).toContain("anthropic");
      expect(logKey).toContain("claude-sonnet-4-6");
    });
  });

  it("drills from an agent row into the call log with that agent filtered", async () => {
    const user = userEvent.setup();
    renderDashboard();
    await user.click(screen.getByRole("button", { name: /Agent One/ }));

    expect(replaceSpy).toHaveBeenCalledWith("/acme/usage?tab=logs");
    await waitFor(() => {
      const logKey = latestQueryKey("usage-logs");
      expect(logKey).toContain("agent-1");
    });
  });

  it("switches to the log tab and renders the filtered summary", async () => {
    const user = userEvent.setup();
    renderDashboard("/acme/usage");
    await user.click(screen.getByRole("tab", { name: /Call log/ }));
    expect(await screen.findByText("Model call log")).toBeInTheDocument();
    expect(screen.getByText("Fix login")).toBeInTheDocument();
    expect(screen.getByText("Total cost")).toBeInTheDocument();
  });

  it("puts the viewer's timezone in the overview query key", () => {
    tzRef.current = "Asia/Tokyo";
    renderDashboard();
    const overviewKey = latestQueryKey("usage-overview");
    expect(overviewKey).toContain("Asia/Tokyo");
  });

  it("changes the overview window when a range option is picked", async () => {
    const user = userEvent.setup();
    renderDashboard();
    await user.click(screen.getByRole("button", { name: "7D" }));
    await waitFor(() => {
      const overviewKey = latestQueryKey("usage-overview");
      expect(overviewKey?.[3]).toBe(7);
    });
  });
});
