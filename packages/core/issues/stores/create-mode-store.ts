import { useModalStore } from "../../modals";

/**
 * Mode of the create-issue flow. `quick-create-issue` (agent) is what the
 * generic entries open — a solo task always executes on an agent, so the
 * manual form is no longer offered from them; surfaces that need a plain
 * issue with seeded fields (status, parent_issue_id) open "create-issue"
 * directly because agent mode can't honour those seeds.
 */
export type CreateMode = "agent" | "manual";

/**
 * Open the create-issue flow in agent mode. Called by the sidebar button,
 * the command palette and the `c` shortcut.
 */
export function openCreateIssue(data?: Record<string, unknown> | null) {
  useModalStore.getState().open("quick-create-issue", data ?? null);
}
