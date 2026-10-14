import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Agent, Squad, SquadMessage, SquadRoom, Workspace } from "../types";

export const workspaceKeys = {
  all: (wsId: string) => ["workspaces", wsId] as const,
  list: () => ["workspaces", "list"] as const,
  members: (wsId: string) => ["workspaces", wsId, "members"] as const,
  invitations: (wsId: string) => ["workspaces", wsId, "invitations"] as const,
  shareLinks: (wsId: string) => ["workspaces", wsId, "share-links"] as const,
  myInvitations: () => ["invitations", "mine"] as const,
  agents: (wsId: string) => ["workspaces", wsId, "agents"] as const,
  agent: (wsId: string, agentId: string) =>
    ["workspaces", wsId, "agents", "detail", agentId] as const,
  squads: (wsId: string) => ["workspaces", wsId, "squads"] as const,
  // Per-squad member status. Lives under the workspace key tree so
  // workspace switches naturally drop the cache, and so a broad
  // `["workspaces", wsId, "squads"]` invalidation covers it.
  squadMemberStatus: (wsId: string, squadId: string) =>
    ["workspaces", wsId, "squads", squadId, "members-status"] as const,
  // The roster with each person's current belongings — role and the agent they
  // lend. Distinct from `squadMemberStatus`, which is a presence snapshot and
  // carries no binding: the compose canvas needs to know who brings an agent,
  // because that is exactly what decides whether a step can run.
  squadMembers: (wsId: string, squadId: string) =>
    ["workspaces", wsId, "squads", squadId, "members"] as const,
  // A squad room's message stream. Under the squad subtree so a workspace
  // switch, or a broad `["workspaces", wsId, "squads"]` invalidation, drops it
  // with everything else the squad owns.
  squadMessages: (wsId: string, squadId: string) =>
    ["workspaces", wsId, "squads", squadId, "messages"] as const,
  // The relays a squad has saved. Same subtree rule as the room: saved
  // playbooks belong to the squad, not to the workspace at large.
  squadPlaybooks: (wsId: string, squadId: string) =>
    ["workspaces", wsId, "squads", squadId, "playbooks"] as const,
  taskIssue: (wsId: string, taskId: string) =>
    ["workspaces", wsId, "tasks", taskId, "issue"] as const,
  skills: (wsId: string) => ["workspaces", wsId, "skills"] as const,
  assigneeFrequency: (wsId: string) => ["workspaces", wsId, "assignee-frequency"] as const,
  mcpServers: (wsId: string) => ["workspaces", wsId, "mcp-servers"] as const,
};

export function workspaceListOptions() {
  return queryOptions({
    queryKey: workspaceKeys.list(),
    queryFn: () => api.listWorkspaces(),
  });
}

/** Resolves the workspace whose slug matches, from the cached workspace list. */
export function workspaceBySlugOptions(slug: string) {
  return queryOptions({
    ...workspaceListOptions(),
    select: (list: Workspace[]) => list.find((w) => w.slug === slug) ?? null,
  });
}

export function memberListOptions(wsId: string) {
  return queryOptions({
    queryKey: workspaceKeys.members(wsId),
    queryFn: () => api.listMembers(wsId),
  });
}

export function agentListOptions(wsId: string) {
  return queryOptions({
    queryKey: workspaceKeys.agents(wsId),
    queryFn: () =>
      api.listAgents({ workspace_id: wsId, include_archived: true }),
  });
}

export function agentDetailOptions(wsId: string, agentId: string) {
  return queryOptions({
    queryKey: workspaceKeys.agent(wsId, agentId),
    queryFn: () => api.getAgent(agentId),
    enabled: !!wsId && !!agentId,
    retry: false,
  });
}

/**
 * Makes an authoritative agent response immediately visible to both agent
 * detail and list consumers. A cold list stays cold so one agent is never
 * mistaken for the complete workspace list.
 */
export function cacheAgentResponse(
  queryClient: QueryClient,
  wsId: string,
  agent: Agent,
  options: { insertIntoList?: boolean } = {},
) {
  queryClient.setQueryData(workspaceKeys.agent(wsId, agent.id), agent);
  queryClient.setQueryData<Agent[]>(workspaceKeys.agents(wsId), (current) => {
    if (!current) return current;
    const existingIndex = current.findIndex((item) => item.id === agent.id);
    if (existingIndex === -1) {
      return options.insertIntoList === false ? current : [...current, agent];
    }
    return current.map((item, index) =>
      index === existingIndex ? agent : item,
    );
  });
}

export function squadListOptions(wsId: string) {
  return queryOptions<Squad[]>({
    queryKey: workspaceKeys.squads(wsId),
    queryFn: () => api.listSquads(),
    enabled: !!wsId,
  });
}

// Per-squad members status snapshot. The freshness signal is the WS task /
// agent / runtime invalidation wired in use-realtime-sync (which broadly
// invalidates `["workspaces", wsId, "squads"]`); the staleTime is a
// tab-focus safety net.
/** How many room lines one page loads. The room shows the newest page; older
 *  rows are reachable by asking again with a larger limit, not by paging. */
export const SQUAD_ROOM_PAGE_SIZE = 80;

/**
 * A squad room's newest page, oldest-first.
 *
 * `staleTime: 0` on purpose: a room is a conversation, and a cached page that
 * looks current but is missing the last two replies is worse than a refetch.
 * The WS `squad_message:created` event patches the cache in place, so this
 * mostly fires on mount and on reconnect.
 */
export function squadMessagesOptions(wsId: string, squadId: string) {
  return queryOptions({
    queryKey: workspaceKeys.squadMessages(wsId, squadId),
    queryFn: () => api.listSquadMessages(squadId, SQUAD_ROOM_PAGE_SIZE),
    enabled: !!wsId && !!squadId,
    staleTime: 0,
  });
}

/**
 * Append one line to a cached room page.
 *
 * Exported because both the sender's own mutation and the WebSocket echo need
 * it: the poster sees their line the moment the server confirms it, and every
 * other open room appends the same row when the event arrives. Deduped by id,
 * because for the poster BOTH paths fire and the line must appear once.
 */
export function appendSquadMessage(
  qc: QueryClient,
  wsId: string,
  squadId: string,
  message: SquadMessage,
): void {
  qc.setQueryData<SquadRoom>(
    workspaceKeys.squadMessages(wsId, squadId),
    (old) => {
      if (!old) return old;
      if (old.messages.some((m) => m.id === message.id)) return old;
      return { ...old, messages: [...old.messages, message] };
    },
  );
}

/**
 * The relays a squad has saved. Steps name people, never agents — the agent
 * is resolved at dispatch time from whoever holds the step, because a
 * binding changes and a saved route must not.
 */
export function squadPlaybooksOptions(wsId: string, squadId: string) {
  return queryOptions({
    queryKey: workspaceKeys.squadPlaybooks(wsId, squadId),
    queryFn: () => api.listSquadPlaybooks(squadId),
    enabled: !!wsId && !!squadId,
  });
}

/**
 * A squad's roster, with each person's role and the agent they lend.
 *
 * The compose canvas reads this rather than {@link squadMemberStatusOptions}:
 * arranging a relay needs to know who brings an agent, since a holder with
 * none is precisely what parks a step.
 */
export function squadMemberListOptions(wsId: string, squadId: string) {
  return queryOptions({
    queryKey: workspaceKeys.squadMembers(wsId, squadId),
    queryFn: () => api.listSquadMembers(squadId),
    enabled: !!wsId && !!squadId,
  });
}

export function squadMemberStatusOptions(wsId: string, squadId: string) {
  return queryOptions({
    queryKey: workspaceKeys.squadMemberStatus(wsId, squadId),
    queryFn: () => api.getSquadMemberStatus(squadId),
    enabled: !!wsId && !!squadId,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });
}

const TASK_ISSUE_POLL_MS = 2_000;

/**
 * How long a caller waits for a quick-create run to produce its issue before
 * giving up. A run that fails never links one, so without a bound the poll
 * would never end. Callers own the timer and stop passing a `taskId` once it
 * fires — the query has no clock of its own and simply stops being asked.
 */
export const TASK_ISSUE_WINDOW_MS = 90_000;

/**
 * Resolves the issue a quick-create task produced.
 *
 * Quick-create answers with a task id and nothing else — creating the issue IS
 * the run's job — so anything that wants to land the user on the new issue has
 * to keep asking until the server links it back (LinkTaskToIssue). An empty
 * `issue_id` is a "not yet" rather than a settled answer, which is why this
 * polls instead of settling on the first response.
 */
export function taskIssueOptions(wsId: string, taskId: string | null) {
  return queryOptions({
    queryKey: workspaceKeys.taskIssue(wsId, taskId ?? ""),
    queryFn: () => api.getTaskIssue(taskId!),
    enabled: !!wsId && !!taskId,
    retry: false,
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data?.issue_id ? false : TASK_ISSUE_POLL_MS,
  });
}

export function skillListOptions(wsId: string) {
  return queryOptions({
    queryKey: workspaceKeys.skills(wsId),
    queryFn: () => api.listSkills(),
  });
}

export function skillDetailOptions(wsId: string, skillId: string) {
  return queryOptions({
    queryKey: [...workspaceKeys.skills(wsId), skillId] as const,
    queryFn: () => api.getSkill(skillId),
    enabled: !!skillId,
  });
}

/**
 * Builds a `Map<skillId, Agent[]>` from the cached agent list. The server
 * already returns each agent with its full skill list inline, so no extra
 * request is needed — "which agents use skill X" is pure client-side fold.
 *
 * Exposed as a plain helper rather than a `queryOptions` with `select` so
 * the Map's identity is stable across unrelated agent-cache rerenders —
 * callers wrap this in `useMemo(..., [agents])` and only re-fold when the
 * agent array identity actually changes. Previously this was `{ select }`,
 * which returned a new Map every subscription tick and triggered cascading
 * re-renders on every `agent:updated` WS event.
 */
export function selectSkillAssignments(
  agents: Agent[] | undefined,
): Map<string, Agent[]> {
  const map = new Map<string, Agent[]>();
  if (!agents) return map;
  for (const a of agents) {
    if (a.archived_at) continue;
    for (const s of a.skills ?? []) {
      const existing = map.get(s.id);
      if (existing) existing.push(a);
      else map.set(s.id, [a]);
    }
  }
  return map;
}

export function invitationListOptions(wsId: string) {
  return queryOptions({
    queryKey: workspaceKeys.invitations(wsId),
    queryFn: () => api.listWorkspaceInvitations(wsId),
  });
}

export function shareLinkListOptions(wsId: string, enabled = true) {
  return queryOptions({
    queryKey: workspaceKeys.shareLinks(wsId),
    queryFn: () => api.listShareLinks(wsId),
    enabled: enabled && !!wsId,
  });
}

export function myInvitationListOptions() {
  return queryOptions({
    queryKey: workspaceKeys.myInvitations(),
    queryFn: () => api.listMyInvitations(),
  });
}

export function assigneeFrequencyOptions(wsId: string) {
  return queryOptions({
    queryKey: workspaceKeys.assigneeFrequency(wsId),
    queryFn: () => api.getAssigneeFrequency(),
  });
}

/**
 * The workspace's MCP server library. Fetched for plain members too — the
 * payload is names and transports only, and an agent owner needs to see what
 * is available to assign.
 */
export function workspaceMcpServersOptions(wsId: string) {
  return queryOptions({
    queryKey: workspaceKeys.mcpServers(wsId),
    queryFn: () => api.listWorkspaceMcpServers(wsId),
    enabled: wsId !== "",
  });
}

/** The workspace MCP servers assigned to one agent, with their toggles. */
export function agentMcpServersOptions(agentId: string) {
  return queryOptions({
    queryKey: ["agents", agentId, "mcp-servers"] as const,
    queryFn: () => api.listAgentMcpServers(agentId),
    enabled: agentId !== "",
  });
}
