-- name: GetWorkspaceSandboxConnection :one
SELECT * FROM workspace_sandbox_connection WHERE workspace_id = $1;

-- name: UpsertWorkspaceSandboxConnection :one
INSERT INTO workspace_sandbox_connection (workspace_id, api_url, api_key_encrypted, verified_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (workspace_id) DO UPDATE
SET api_url = $2, api_key_encrypted = $3, verified_at = now(), updated_at = now()
RETURNING *;

-- name: DeleteWorkspaceSandboxConnection :exec
DELETE FROM workspace_sandbox_connection WHERE workspace_id = $1;
