import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

/** A cross-workspace hand-off rule (fork). See server/internal/handler/handoff.go. */
export interface HandoffRule {
  id: string;
  source_workspace_id: string;
  name: string;
  /** Status key in the SOURCE workspace that fires the hand-off. */
  trigger_status: string;
  target_workspace_id: string;
  target_workspace_slug: string;
  target_agent_id: string;
  target_agent_name: string;
  task_template: string;
  note: string;
  context_comments: number;
  /** Status the target card enters when done; its entry fires the receipt leg. */
  receipt_status: string;
  /** Non-empty = the rule only fires for these cards ("watch these tasks"). */
  watched_issue_ids: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface HandoffRuleInput {
  name: string;
  trigger_status: string;
  target_workspace_id: string;
  target_agent_id: string;
  task_template?: string;
  note?: string;
  context_comments?: number;
  receipt_status?: string;
  /** Omit/empty = watch the whole lane; otherwise only these issue ids. */
  watched_issue_ids?: string[];
}

export const handoffKeys = {
  all: (wsId: string) => ["handoff", wsId] as const,
  rules: (wsId: string) => ["handoff", wsId, "rules"] as const,
};

export function handoffRulesOptions(wsId: string) {
  return queryOptions({
    queryKey: handoffKeys.rules(wsId),
    queryFn: () => api.listHandoffRules(),
    enabled: wsId.length > 0,
  });
}

/** A workspace a rule may target, as seen by the RELAY TOKEN (not the viewer). */
export interface HandoffTarget {
  workspace_id: string;
  workspace_slug: string;
  workspace_name: string;
  agents: { id: string; name: string }[];
}

export const handoffTargetsOptions = (wsId: string) =>
  queryOptions({
    queryKey: ["handoff", wsId, "targets"] as const,
    queryFn: () => api.listHandoffTargets(),
    enabled: wsId.length > 0,
    staleTime: 2 * 60_000,
  });
