/**
 * A task's chain: the relay a squad task runs.
 *
 * A task handed to a squad is not one run — it is an ordered set of steps, each
 * held by a person who works it with the agent they lend. The state that makes
 * this worth modelling is `parked`: the relay reached someone who has not bound
 * an agent, so nothing runs and the task waits. It is not an error, and it is
 * not a skip.
 */
export type IssueChainStepState =
  | "pending"
  | "doing"
  /** The run is over and waits on its holder's own 通过 (see approve). */
  | "reviewing"
  | "done"
  | "parked"
  | "skipped";

export interface IssueChainStep {
  id: string;
  position: number;
  /** The person whose turn this is. */
  holder_user_id: string;
  /**
   * The agent they lend. Absent when they have none — which is exactly what
   * parks the step, so an absent id is information, not a gap.
   */
  agent_id?: string;
  title: string;
  state: IssueChainStepState | string;
  /**
   * The holder's own brief for this leg. Written by them — nobody authors a
   * brief on another person's behalf, and the next person is handed the
   * previous leg's output instead.
   */
  plan?: string;
  /**
   * The package this leg published on 通过, when it published one. Public:
   * it is what the leg chose to hand over, and the boundary between the
   * leg's private work and the shared context runs exactly here.
   */
  handoff?: IssueChainHandoff;
  /**
   * How many leg-scoped comments this leg carries. Readers who are not the
   * holder render "N 条对话 · 对你们不可见" from this count.
   */
  leg_comment_count?: number;
  started_at?: string;
  completed_at?: string;
}

/** One entry of a leg's handoff package. */
export interface IssueChainHandoffFile {
  name: string;
  size?: number;
  /** Links back to an uploaded attachment when the entry is one. */
  attachment_id?: string;
  /** "attachment" | "branch" | unknown strings from newer servers. */
  kind?: string;
}

export interface IssueChainHandoff {
  summary: string;
  files: IssueChainHandoffFile[];
}

export interface IssueChain {
  steps: IssueChainStep[];
  /**
   * The relay is waiting on someone. Carried by the server rather than derived
   * at each call site, so the list, the detail and the summary bar cannot
   * disagree about what counts as stuck.
   */
  parked: boolean;
  /**
   * Some step's run is done and waits on its holder's own approval. The workbench
   * keys its 审核通过 button off this.
   */
  reviewing: boolean;
}

export const EMPTY_ISSUE_CHAIN: IssueChain = {
  steps: [],
  parked: false,
  reviewing: false,
};

/** A task's chain tagged with the task it belongs to — the list-page shape. */
export interface IssueChainForIssue extends IssueChain {
  issue_id: string;
}

/**
 * The answer to "ask the leg's agent for the leg's output": the run that was
 * queued to write it. The document itself arrives as the run's comment in the
 * leg — this response only says the ask landed.
 */
export interface ChainLegOutputResponse {
  task_id: string;
  status: string;
}

/** One step of a saved chain, before it is resolved to an agent. */
/**
 * One step as arranged for a single dispatch.
 *
 * Deliberately not {@link PlaybookStep}: a saved route names people only, so a
 * binding change next month does not rewrite history. Which of a person's
 * agents runs THIS task is a decision about this task, and it dies with it.
 */
export interface DispatchStep {
  holder_user_id: string;
  title: string;
  /** Empty means the agent they lend the room, resolved at dispatch time. */
  agent_id?: string;
}

export interface PlaybookStep {
  holder_user_id: string;
  title: string;
}

/**
 * A chain a squad has walked before.
 *
 * Steps name PEOPLE, never agents: a person's binding changes, and a playbook
 * that stored the agent would route next month's task to whichever machine
 * they happened to be on today.
 */
export interface SquadPlaybook {
  id: string;
  workspace_id: string;
  squad_id: string;
  name: string;
  description: string;
  steps: PlaybookStep[];
  created_by: string;
  created_at: string;
  updated_at: string;
}
