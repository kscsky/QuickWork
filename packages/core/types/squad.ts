export type SquadMemberType = "agent" | "member";

export type SquadActivityOutcome = "action" | "no_action" | "failed";

export interface SquadMemberPreview {
  member_type: SquadMemberType;
  member_id: string;
  role: string;
}

export interface Squad {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  instructions: string;
  avatar_url: string | null;
  leader_id: string;
  creator_id: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  archived_by: string | null;
  member_count?: number;
  member_preview?: SquadMemberPreview[];
}

export interface SquadMember {
  id: string;
  squad_id: string;
  member_type: SquadMemberType;
  member_id: string;
  /**
   * What this person decides in the room — leader / executor / reviewer /
   * observer. Free text on the wire; the room's picker is the only writer.
   */
  role: string;
  /**
   * Whether work handed to the room may run on this member's agents. Role says
   * what someone decides; this says whether their machine is available. The two
   * are independent, which is why they are separate fields.
   *
   * Absent on older backends — read it as `!== false`, never as truthy, so a
   * member added by a server that predates the column still counts as available.
   */
  can_receive_work?: boolean;
  /**
   * The one agent this person lends to the room, chosen by them from the agents
   * they own. Absent or empty means they bring none, which is a normal state —
   * a member with no agent is still a member.
   *
   * An agent is equipment here, not a peer: it is not a `squad_member` row.
   */
  agent_id?: string;
  created_at: string;
}

export interface SquadActivityLog {
  id: string;
  squad_id: string;
  issue_id: string;
  trigger_comment_id: string | null;
  leader_id: string;
  outcome: SquadActivityOutcome;
  details: unknown;
  created_at: string;
}

export interface CreateSquadRequest {
  name: string;
  description?: string;
  leader_id: string;
  avatar_url?: string;
}

export interface UpdateSquadRequest {
  name?: string;
  description?: string;
  instructions?: string;
  leader_id?: string;
  avatar_url?: string;
}

export interface AddSquadMemberRequest {
  member_type: SquadMemberType;
  member_id: string;
  role?: string;
  can_receive_work?: boolean;
}

export interface UpdateSquadMemberWorkRequest {
  member_type: SquadMemberType;
  member_id: string;
  can_receive_work: boolean;
}

export interface RemoveSquadMemberRequest {
  member_type: SquadMemberType;
  member_id: string;
}

export interface UpdateSquadMemberRoleRequest {
  member_type: SquadMemberType;
  member_id: string;
  role: string;
}

export interface CreateSquadActivityLogRequest {
  squad_id: string;
  issue_id: string;
  trigger_comment_id?: string;
  outcome: SquadActivityOutcome;
  details?: unknown;
}

// SquadMemberStatus mirrors the five-way bucket the back-end derives in
// handler/squad.go::deriveSquadMemberStatus. Kept as a string union here
// (rather than re-derived from snapshot data) so the squad page can render
// the freshest server-side judgement without re-fetching the agent
// snapshot / runtime list. `archived` wins over every runtime/task signal.
export type SquadMemberStatusValue =
  | "working"
  | "idle"
  | "offline"
  | "unstable"
  | "archived";

export interface SquadActiveIssueBrief {
  issue_id: string;
  identifier: string;
  title: string;
  issue_status: string;
}

export interface SquadMemberStatus {
  member_type: SquadMemberType;
  member_id: string;
  // Human members are returned with status === null so the UI can render
  // them in the same list without showing a status pill (v1 has no
  // presence signal for humans).
  status: SquadMemberStatusValue | null;
  active_issues: SquadActiveIssueBrief[];
  last_active_at: string | null;
}

export interface SquadMemberStatusListResponse {
  members: SquadMemberStatus[];
}

/**
 * One line in a squad room.
 *
 * `author_type` is the reason this is not a chat message: a room has three
 * kinds of speaker — a human account, an agent reporting in, and the room
 * itself narrating membership and handoffs. Only the first two carry an id.
 */
export type SquadMessageAuthorType = "member" | "agent" | "system";

export interface SquadMessage {
  id: string;
  squad_id: string;
  author_type: SquadMessageAuthorType;
  /** Absent for `system` entries. */
  author_id?: string;
  body: string;
  /**
   * Shape hint for entries that are not plain prose (`receipt`, `run`).
   * Deliberately an open string: a reader that does not recognise a kind
   * renders it as text rather than dropping the line.
   */
  kind: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SquadRoom {
  messages: SquadMessage[];
  /** Older rows exist past this page. */
  has_more: boolean;
}

export interface CreateSquadMessageRequest {
  body: string;
  kind?: string;
  metadata?: Record<string, unknown>;
}
