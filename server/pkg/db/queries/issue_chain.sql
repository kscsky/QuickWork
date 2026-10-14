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
       started_at = COALESCE(started_at, now())
 WHERE issue_id = $1 AND position = $2
RETURNING *;

-- name: GetIssueChainStepAt :one
SELECT * FROM issue_chain_step WHERE issue_id = $1 AND position = $2;

-- name: SetIssueChainStepState :one
UPDATE issue_chain_step
   SET state = $3,
       started_at = CASE WHEN $3 = 'doing' THEN COALESCE(started_at, now()) ELSE started_at END,
       completed_at = CASE WHEN $3 IN ('done', 'skipped') THEN now() ELSE completed_at END
 WHERE issue_id = $1 AND position = $2
RETURNING *;

-- name: DeleteIssueChain :exec
DELETE FROM issue_chain_step WHERE issue_id = $1;
