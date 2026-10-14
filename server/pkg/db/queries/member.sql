-- name: ListMembers :many
SELECT * FROM member
WHERE workspace_id = $1
ORDER BY created_at ASC;

-- name: GetMember :one
SELECT * FROM member
WHERE id = $1;

-- name: GetMemberByUserAndWorkspace :one
SELECT * FROM member
WHERE user_id = $1 AND workspace_id = $2;

-- name: CreateMember :one
INSERT INTO member (workspace_id, user_id, role)
VALUES ($1, $2, $3)
RETURNING *;

-- name: UpdateMemberRole :one
UPDATE member SET role = $2
WHERE id = $1
RETURNING *;

-- name: DeleteMember :exec
DELETE FROM member WHERE id = $1;

-- name: ListMembersWithUser :many
SELECT m.id, m.workspace_id, m.user_id, m.role, m.created_at,
       u.name as user_name, u.email as user_email, u.avatar_url as user_avatar_url,
       -- The identity this person registered under (onboarding questionnaire).
       -- Coalesced to '' so the column is never NULL: "has not declared one"
       -- and "declared an empty one" render the same way, and a NULL would add
       -- a second empty case for every caller to handle.
       (COALESCE(u.onboarding_questionnaire->>'role', ''))::text AS identity,
       (COALESCE(u.onboarding_questionnaire->>'role_other', ''))::text AS identity_other
FROM member m
JOIN "user" u ON u.id = m.user_id
WHERE m.workspace_id = $1
ORDER BY m.created_at ASC;
