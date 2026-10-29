import type { CommentAuthorType, Reaction } from "./comment";
import type { Attachment } from "./attachment";

export interface AssigneeFrequencyEntry {
  assignee_type: string;
  assignee_id: string;
  frequency: number;
}

export interface TimelineEntry {
  type: "activity" | "comment";
  id: string;
  actor_type: string;
  actor_id: string;
  created_at: string;
  // Activity fields
  action?: string;
  details?: Record<string, unknown>;
  // Comment fields
  content?: string;
  parent_id?: string | null;
  updated_at?: string;
  revision?: number;
  comment_type?: string;
  /** Set only on comments a quick action produced (MUL-5465). Unforgeable. */
  quick_action_id?: string | null;
  reactions?: Reaction[];
  attachments?: Attachment[];
  resolved_at?: string | null;
  resolved_by_type?: CommentAuthorType | null;
  resolved_by_id?: string | null;
  source_task_id?: string | null;
  /**
   * Set when this comment belongs to a chain step's leg instead of the room
   * (单流分界). Only the leg's holder ever receives such an entry.
   */
  chain_step_id?: string | null;
  /** Set by frontend coalescing when consecutive identical activities are merged. */
  coalesced_count?: number;
}

/**
 * One key relay decision on the workspace activity page.
 *
 * Only the four moves that change where the baton goes or whether a leg
 * counts are recorded: approve, return, reassign, skip. Runs, comments,
 * parking and recovery stay on the issue.
 */
export type RelayActivityAction =
  | "relay_approved"
  | "relay_returned"
  | "relay_reassigned"
  | "relay_skipped";

export interface RelayActivityEvent {
  id: string;
  issue_id: string;
  /** Workspace-prefixed issue identifier, e.g. KSCS-36. */
  identifier: string;
  issue_title: string;
  actor_id: string;
  /** A known action, or a newer one this client does not render yet. */
  action: RelayActivityAction | (string & {});
  /** 1-based leg position the decision touched. */
  leg: number;
  from_user_id: string | null;
  to_user_id: string | null;
  reason: string;
  /** True when the actor used owner/admin reach (reassign, skip). */
  admin: boolean;
  created_at: string;
}
