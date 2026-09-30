/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { setApiInstance } from "@quickwork/core/api";
import type { ApiClient } from "@quickwork/core/api/client";
import {
  getIssueSurfaceViewStore,
  pruneIssueSurfaceViewStates,
} from "@quickwork/core/issues/stores/surface-view-store";
import { ViewStoreProvider } from "@quickwork/core/issues/stores/view-store-context";
import type { IssueStatusEntry, IssueTableGroupsRequest, IssueTableRowsRequest } from "@quickwork/core/types";
import { useIssueSurfaceController } from "./use-issue-surface-controller";

/**
 * The catalog is server state, so it can be late or absent. Two behaviours
 * depend on that and neither is expressible with a boolean "loaded" flag:
 *
 * - A CUSTOM status filter cannot be routed to a column until the catalog
 *   answers. Fetching zero branches meanwhile renders an empty board with no
 *   spinner; failing renders one permanently, with no way to retry.
 */

vi.mock("@quickwork/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));

const QA_ENTRY: IssueStatusEntry = {
  id: "s-qa",
  workspace_id: "ws-1",
  key: "qa",
  name: "QA",
  description: "",
  category: "in_review",
  color: "#ff0000",
  is_system: false,
  position: 1,
  archived_at: null,
  created_at: "",
  updated_at: "",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let groupRequests: IssueTableGroupsRequest[] = [];
let rowRequests: IssueTableRowsRequest[] = [];

function installApi(listIssueStatuses: () => Promise<unknown>) {
  groupRequests = [];
  rowRequests = [];
  setApiInstance({
    listIssueStatuses,
    listIssueTableGroups: async (request: IssueTableGroupsRequest) => {
      groupRequests.push(request);
      return { query_fingerprint: "test", total: 0, groups: [], next_cursor: null };
    },
    listIssueTableRows: async (request: IssueTableRowsRequest) => {
      rowRequests.push(request);
      return {
        query_fingerprint: "test",
        group_key: request.group_key ?? null,
        parent_id: null,
        total: 0,
        rows: [],
        branch_total: 0,
        next_cursor: null,
      };
    },
    listIssueTableFacets: async () => ({ query_fingerprint: "test", total: 0, facets: [] }),
    listIssues: async () => ({ issues: [], total: 0 }),
    listProjects: async () => ({ projects: [], total: 0 }),
    getWorkspaceWorkingAgents: async () => [],
    getChildIssueProgress: async () => ({ progress: [] }),
    getAgentTaskSnapshot: async () => ({ tasks: [] }),
  } as unknown as ApiClient);
}

function makeWrapper(qc: QueryClient, surfaceKey: string) {
  const store = getIssueSurfaceViewStore(surfaceKey);
  return {
    store,
    Wrapper: function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={qc}>
          <ViewStoreProvider store={store}>{children}</ViewStoreProvider>
        </QueryClientProvider>
      );
    },
  };
}

let qc: QueryClient;
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  pruneIssueSurfaceViewStates([]);
});
afterEach(() => {
  cleanup();
  qc.clear();
  vi.restoreAllMocks();
});

describe("useIssueSurfaceController — custom status filter vs a late catalog", () => {
  it("stays loading while the catalog a custom filter depends on is in flight", async () => {
    const catalog = deferred<{ statuses: IssueStatusEntry[]; categories: never[]; total: number }>();
    installApi(() => catalog.promise);
    const { store, Wrapper } = makeWrapper(qc, "workspace:catalog-pending");
    act(() => store.getState().toggleStatusFilter("qa"));

    const { result } = renderHook(
      () =>
        useIssueSurfaceController({
          scope: { type: "workspace", actorKind: "all" },
          modes: ["list"],
        }),
      { wrapper: Wrapper },
    );

    // The regression: the surface reported "loaded, zero results" and rendered
    // an empty board for the whole cold-load window.
    await waitFor(() => expect(result.current.isLoading).toBe(true));
    expect(result.current.isEmpty).toBe(false);
    // And nothing is fetched: with the filter unresolved the visible column set
    // falls back to ALL categories, so fetching would briefly show the
    // UNFILTERED board to someone who opened a saved `qa` view.
    expect(rowRequests).toEqual([]);

    await act(async () => {
      catalog.resolve({ statuses: [QA_ENTRY], categories: [], total: 1 });
      await catalog.promise;
    });

    // Once the catalog answers, the filter routes to the column `qa` behaves as.
    await waitFor(() => expect(result.current.visibleStatuses).toEqual(["in_review"]));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("surfaces a retryable error instead of a silent empty board when the catalog fails", async () => {
    const catalog = deferred<never>();
    installApi(() => catalog.promise);
    const { store, Wrapper } = makeWrapper(qc, "workspace:catalog-failed");
    act(() => store.getState().toggleStatusFilter("qa"));

    const { result } = renderHook(
      () =>
        useIssueSurfaceController({
          scope: { type: "workspace", actorKind: "all" },
          modes: ["list"],
        }),
      { wrapper: Wrapper },
    );

    await act(async () => {
      catalog.reject(new Error("catalog unavailable"));
      await catalog.promise.catch(() => {});
    });

    await waitFor(() => expect(result.current.isStatusCatalogError).toBe(true));
    // Not "no issues" — the surface cannot answer the question that was asked.
    expect(result.current.isEmpty).toBe(false);
  });
});

