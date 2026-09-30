-- Cross-workspace hand-off rules (fork). See migration 465 for the model.

-- name: ListHandoffRules :many
SELECT * FROM handoff_rule
WHERE source_workspace_id = $1
ORDER BY created_at DESC;

-- name: ListEnabledHandoffRules :many
-- The relay's hot path: every enabled rule across all workspaces, refreshed
-- when settings change.
SELECT * FROM handoff_rule
WHERE enabled = true;

-- name: CreateHandoffRule :one
INSERT INTO handoff_rule (
    id, source_workspace_id, name, trigger_status,
    target_workspace_id, target_agent_id, task_template, note,
    context_comments, receipt_status, created_by, watched_issue_ids, chat_session_id
) VALUES (
    COALESCE(sqlc.narg('id')::uuid, gen_random_uuid()),
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, sqlc.arg(watched_issue_ids)::uuid[],
    sqlc.narg(chat_session_id)::uuid
) RETURNING *;

-- name: UpdateHandoffRule :one
UPDATE handoff_rule
SET name = $2, trigger_status = $3, target_workspace_id = $4, target_agent_id = $5,
    task_template = $6, note = $7, context_comments = $8, receipt_status = $9,
    enabled = $10, watched_issue_ids = sqlc.arg(watched_issue_ids)::uuid[],
    chat_session_id = sqlc.narg(chat_session_id)::uuid, updated_at = now()
WHERE id = $1 AND source_workspace_id = sqlc.arg(source_workspace_id)::uuid
RETURNING *;

-- name: DeleteHandoffRule :exec
DELETE FROM handoff_rule
WHERE id = sqlc.arg(id)::uuid AND source_workspace_id = sqlc.arg(source_workspace_id)::uuid;

-- name: PruneHandoffRuleWatchedIssue :exec
-- The watch list is a queue of "cards still waiting to be handed off": a
-- successful delivery drops the card from it (no repeat triggers), a failed
-- delivery leaves it in place (retry by re-dropping the card).
UPDATE handoff_rule
SET watched_issue_ids = array_remove(watched_issue_ids, sqlc.arg(issue_id)::uuid),
    updated_at = now()
WHERE id = sqlc.arg(id)::uuid;

-- name: ListChatTranscriptForSession :many
-- Server-side transcript read for the hand-off context pack. The HTTP chat
-- API is deliberately creator-only; the relay is a server component that has
-- already been trusted with the session id BY the human who configured the
-- rule, so it reads the rows directly instead of widening the public API.
SELECT role, content, created_at
FROM chat_message
WHERE chat_session_id = sqlc.arg(session_id)::uuid
ORDER BY created_at DESC
LIMIT sqlc.arg(limit_)::int;
