// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { useProjectViewStore } from "./view-store";
import { setCurrentWorkspace } from "../../platform/workspace-storage";

const flush = () => new Promise((resolve) => queueMicrotask(() => resolve(null)));

// Node 25 ships a partial `localStorage` shim under jsdom that's missing
// `clear`/`removeItem`; replace it with a real in-memory Storage so persist
// can round-trip values.
beforeAll(() => {
  if (typeof globalThis.localStorage?.clear !== "function") {
    const values = new Map<string, string>();
    const storage: Storage = {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (k) => values.get(k) ?? null,
      key: (i) => Array.from(values.keys())[i] ?? null,
      removeItem: (k) => { values.delete(k); },
      setItem: (k, v) => { values.set(k, v); },
    };
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  }
});

// The current persist version. Rehydration tests write this so they exercise
// rehydration rather than the one-time migration below.
const CURRENT_VERSION = 1;

beforeEach(() => {
  localStorage.clear();
  useProjectViewStore.setState({ viewMode: "comfortable" });
  setCurrentWorkspace(null, null);
});

afterEach(() => {
  setCurrentWorkspace(null, null);
});

describe("useProjectViewStore", () => {
  it("defaults to 'comfortable' — the card view leads with the directory", () => {
    expect(useProjectViewStore.getState().viewMode).toBe("comfortable");
  });

  it("setViewMode mutates the store", () => {
    useProjectViewStore.getState().setViewMode("compact");
    expect(useProjectViewStore.getState().viewMode).toBe("compact");
  });

  it("partialize persists view prefs (no actions) under the workspace-namespaced key", async () => {
    setCurrentWorkspace("acme", "ws_a");
    await flush();
    useProjectViewStore.getState().setViewMode("compact");

    const raw = localStorage.getItem("quickwork_projects_view:acme");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(Object.keys(parsed.state).sort()).toEqual([
      "filters",
      "hiddenColumns",
      "sortDirection",
      "sortField",
      "viewMode",
    ]);
    expect(parsed.state.viewMode).toBe("compact");
  });

  it("rehydrates a different saved viewMode on workspace switch", async () => {
    localStorage.setItem(
      "quickwork_projects_view:acme",
      JSON.stringify({ state: { viewMode: "compact" }, version: CURRENT_VERSION }),
    );
    localStorage.setItem(
      "quickwork_projects_view:beta",
      JSON.stringify({ state: { viewMode: "comfortable" }, version: CURRENT_VERSION }),
    );

    setCurrentWorkspace("acme", "ws_a");
    await flush();
    await flush();
    expect(useProjectViewStore.getState().viewMode).toBe("compact");

    setCurrentWorkspace("beta", "ws_b");
    await flush();
    await flush();
    expect(useProjectViewStore.getState().viewMode).toBe("comfortable");
  });

  it("falls back to the default when a workspace has no persisted value", async () => {
    localStorage.setItem(
      "quickwork_projects_view:acme",
      JSON.stringify({ state: { viewMode: "compact" }, version: CURRENT_VERSION }),
    );

    setCurrentWorkspace("acme", "ws_a");
    await flush();
    await flush();
    expect(useProjectViewStore.getState().viewMode).toBe("compact");

    setCurrentWorkspace("beta", "ws_b");
    await flush();
    await flush();
    expect(useProjectViewStore.getState().viewMode).toBe("comfortable");
    expect(localStorage.getItem("quickwork_projects_view:acme")).not.toBeNull();
  });

  // Before the card redesign the table was the default, and the store writes
  // its whole state on any sort or filter change — so a user who never opened
  // the view menu still has "compact" on disk. The migration has to move them
  // off it, without discarding settings they did choose.
  it("migrates a pre-redesign payload to the card view but keeps other prefs", async () => {
    localStorage.setItem(
      "quickwork_projects_view:acme",
      JSON.stringify({
        state: { viewMode: "compact", sortField: "priority", sortDirection: "desc" },
        version: 0,
      }),
    );

    setCurrentWorkspace("acme", "ws_a");
    await flush();
    await flush();

    const state = useProjectViewStore.getState();
    expect(state.viewMode).toBe("comfortable");
    expect(state.sortField).toBe("priority");
    expect(state.sortDirection).toBe("desc");
  });
});
