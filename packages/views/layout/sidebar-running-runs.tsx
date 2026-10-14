"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentListOptions } from "@quickwork/core/workspace/queries";
import { agentTaskSnapshotOptions } from "@quickwork/core/agents/queries";
import { issuesByIdsOptions } from "@quickwork/core/issues/queries";
import {
  isActiveTask,
  deriveRunningRuns,
  type RunningRun,
} from "../home/derive";

export interface RunningWork {
  runs: RunningRun[];
  /** Agents with at least one run assigned — held or queued. */
  busyAgents: number;
  /** Agents with nothing assigned. */
  idleAgents: number;
  isPending: boolean;
}

/**
 * The live half of the sidebar: what every agent is holding right now.
 *
 * One hook, shared by the running-runs block, the per-nav counts, and the
 * footer, so the three can never disagree about how many agents are busy — they
 * are three renderings of one derivation, not three subscriptions that happen
 * to be adjacent.
 *
 * The data is the same agent-task snapshot the rest of the app reads; `task:*`
 * WebSocket events already invalidate it, so a run appearing or finishing shows
 * up here without a poll.
 */
export function useRunningWork(wsId: string): RunningWork {
  const { data: tasks = [], isPending } = useQuery({
    ...agentTaskSnapshotOptions(wsId),
    enabled: !!wsId,
  });
  const { data: agents = [] } = useQuery({
    ...agentListOptions(wsId),
    enabled: !!wsId,
  });

  const agentsById = useMemo(
    () => new Map(agents.map((a) => [a.id, a])),
    [agents],
  );

  // Titles for the issues behind the runs, batched. The ids are stable unless
  // the task set actually changes, so the key is too.
  const issueIds = useMemo(() => {
    const ids = new Set<string>();
    for (const task of tasks) {
      if (isActiveTask(task) && task.issue_id) ids.add(task.issue_id);
    }
    return [...ids].sort();
  }, [tasks]);
  const { data: issues = [] } = useQuery(issuesByIdsOptions(wsId, issueIds));
  const issuesById = useMemo(
    () => new Map(issues.map((i) => [i.id, i])),
    [issues],
  );

  const runs = useMemo(
    () => deriveRunningRuns(tasks, issuesById, agentsById),
    [tasks, issuesById, agentsById],
  );

  // Busy is the union of holders and queuers. A queued run has already been
  // handed to that agent, so counting only the holders would report an agent
  // with a backlog as free — and because idle is derived by subtraction, it
  // would then be counted as idle as well.
  const busyAgents = useMemo(() => {
    const busy = new Set<string>();
    for (const task of tasks) {
      if (isActiveTask(task)) busy.add(task.agent_id);
    }
    return busy.size;
  }, [tasks]);

  return {
    runs,
    busyAgents,
    idleAgents: Math.max(0, agents.length - busyAgents),
    isPending,
  };
}
