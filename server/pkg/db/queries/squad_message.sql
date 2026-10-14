-- name: CreateSquadMessage :one
INSERT INTO squad_message (squad_id, author_type, author_id, body, kind, metadata)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: ListSquadMessages :many
SELECT * FROM squad_message
WHERE squad_id = $1
ORDER BY created_at DESC, id DESC
LIMIT $2;

-- name: GetSquadMessage :one
SELECT * FROM squad_message WHERE id = $1;
