-- name: CreateSquadPlaybook :one
INSERT INTO squad_playbook (workspace_id, squad_id, name, description, steps, created_by)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetSquadPlaybookInWorkspace :one
SELECT * FROM squad_playbook WHERE id = $1 AND workspace_id = $2;

-- name: ListSquadPlaybooks :many
SELECT * FROM squad_playbook WHERE squad_id = $1 ORDER BY updated_at DESC;

-- name: UpdateSquadPlaybook :one
UPDATE squad_playbook
   SET name = $3, description = $4, steps = $5, updated_at = now()
 WHERE id = $1 AND workspace_id = $2
RETURNING *;

-- name: DeleteSquadPlaybook :execrows
DELETE FROM squad_playbook WHERE id = $1 AND workspace_id = $2;
