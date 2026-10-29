-- name: CreateIssueChainStep :one
INSERT INTO issue_chain_step (issue_id, position, holder_user_id, agent_id, title, state)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: ListIssueChainSteps :many
SELECT * FROM issue_chain_step WHERE issue_id = $1 ORDER BY position ASC;

-- name: ListIssueChainStepsByIssues :many
-- The list page reads chains for a whole page of tasks at once. Scoped by
-- workspace through the join: a caller-supplied id from another workspace
-- must yield nothing, not another tenant's relay.
SELECT s.* FROM issue_chain_step s
JOIN issue i ON i.id = s.issue_id
WHERE i.workspace_id = sqlc.arg(workspace_id)
  AND s.issue_id = ANY(sqlc.arg(issue_ids)::uuid[])
ORDER BY s.issue_id, s.position ASC;

-- name: ListParkedChainStepsForHolder :many
-- Relays waiting on this person in this squad. Read when they bind an agent:
-- parking was caused by the missing binding, so the binding is what unparkes.
SELECT s.* FROM issue_chain_step s
JOIN issue i ON i.id = s.issue_id
WHERE s.holder_user_id = $1
  AND s.state = 'parked'
  AND i.assignee_type = 'squad'
  AND i.assignee_id = $2;

-- name: StartIssueChainStep :one
-- Starts a step with the agent its holder has just bound. Separate from
-- SetIssueChainStepState because that one only moves state, and a resumed
-- step has an agent to record that it did not have when it parked.
UPDATE issue_chain_step
   SET agent_id = $3,
       state = 'doing',
       parked_reason = '',
       started_at = COALESCE(started_at, now())
 WHERE issue_id = $1 AND position = $2
RETURNING *;

-- name: GetIssueChainStepAt :one
SELECT * FROM issue_chain_step WHERE issue_id = $1 AND position = $2;

-- name: SetIssueChainStepPlan :one
-- The holder writes their own leg's brief. Nothing else changes: the plan is
-- narrative for the room, not an instruction row the relay reads.
UPDATE issue_chain_step SET plan = $3 WHERE issue_id = $1 AND position = $2 RETURNING *;

-- name: SetIssueChainStepState :one
-- Any transition away from parked clears the reason. Leaving it on a done or
-- reviewing leg would make the card explain a wait that is already over.
UPDATE issue_chain_step
   SET state = $3,
       parked_reason = CASE WHEN $3 <> 'parked' THEN '' ELSE parked_reason END,
       started_at = CASE WHEN $3 = 'doing' THEN COALESCE(started_at, now()) ELSE started_at END,
       completed_at = CASE WHEN $3 IN ('done', 'skipped') THEN now() ELSE completed_at END
 WHERE issue_id = $1 AND position = $2
RETURNING *;

-- name: SetIssueChainStepParked :one
-- Parks a leg with the dispatch reason that caused it. The reason is the
-- machine's own word (no_agent / runtime_private_foreign / ...), not prose:
-- the room localizes it and offers the matching fix.
UPDATE issue_chain_step
   SET state = 'parked',
       parked_reason = $3
 WHERE issue_id = $1 AND position = $2
RETURNING *;

-- name: SetIssueChainStepHandoff :one
-- The package the holder publishes with their 通过, or the package preserved
-- when they return the leg. Written before the state moves so the response
-- already carries it.
UPDATE issue_chain_step
   SET handoff_summary = $3,
       handoff_files = $4,
       handoff_package = $5
 WHERE issue_id = $1 AND position = $2
RETURNING *;

-- name: ListLegOutputTasksForIssue :many
-- The leg-output runs on this task. The chain read uses the active ones to
-- lock the review gate across reloads, and the newest one as the baseline for
-- lifting a summary that landed while the page was closed. Exact handoff_note
-- match: these are the runs the holder explicitly asked their leg's agent to
-- write, not ordinary mentions.
SELECT id, agent_id, status, created_at
FROM agent_task_queue
WHERE issue_id = $1
  AND handoff_note = $2
ORDER BY created_at DESC;

-- name: CountIssueChainStepComments :many
-- How many leg-scoped comments each step carries. Readers who are not the
-- holder render "3 条对话 · 对你们不可见" from this count instead of content.
SELECT chain_step_id, COUNT(*)::int AS comment_count
FROM comment
WHERE issue_id = $1 AND chain_step_id IS NOT NULL
GROUP BY chain_step_id;

-- name: DeleteIssueChain :exec
DELETE FROM issue_chain_step WHERE issue_id = $1;

-- name: SetIssueChainStepHolder :one
-- Reassigns a leg to another squad member. The agent is passed explicitly:
-- a reviewing leg keeps the agent that did the work (the new holder reviews
-- it), while a parked leg takes the new holder's lent agent.
UPDATE issue_chain_step
   SET holder_user_id = $3,
       agent_id = $4
 WHERE issue_id = $1 AND position = $2
RETURNING *;
