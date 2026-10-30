-- name: CreateKnowledgeEntry :one
INSERT INTO knowledge_entry (
    workspace_id,
    squad_id,
    kind,
    title,
    body,
    tags,
    status,
    source_issue_id,
    source_leg,
    source_kind,
    created_by
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING *;

-- name: GetKnowledgeEntry :one
SELECT * FROM knowledge_entry
WHERE id = $1 AND workspace_id = $2;

-- name: ListKnowledgeEntries :many
-- One workspace, newest first. Empty status/kind filters mean "all". The
-- dims filter is the corpus selector: 0 = every entry, -1 = unindexed entries
-- only, a positive number = entries whose vector was produced at that width.
SELECT e.*,
       emb.profile_id AS embedding_profile_id,
       emb.model AS embedding_model,
       emb.dims AS embedding_dims
FROM knowledge_entry e
LEFT JOIN knowledge_embedding emb ON emb.entry_id = e.id
WHERE e.workspace_id = sqlc.arg(workspace_id)
  AND (sqlc.arg(status)::text = '' OR e.status = sqlc.arg(status)::text)
  AND (sqlc.arg(kind)::text = '' OR e.kind = sqlc.arg(kind)::text)
  AND (sqlc.narg(profile_id)::uuid IS NULL OR emb.profile_id = sqlc.narg(profile_id)::uuid)
  AND (
      sqlc.arg(dims_filter)::int = 0
      OR (sqlc.arg(dims_filter)::int = -1 AND emb.entry_id IS NULL)
      OR (sqlc.arg(dims_filter)::int > 0 AND emb.dims = sqlc.arg(dims_filter)::int)
  )
ORDER BY e.updated_at DESC
LIMIT sqlc.arg(row_limit);

-- name: SetKnowledgeEntryStatus :one
UPDATE knowledge_entry
SET status = sqlc.arg(status),
    published_by = CASE WHEN sqlc.arg(status)::text = 'published' THEN sqlc.arg(actor_id)::uuid ELSE published_by END,
    published_at = CASE WHEN sqlc.arg(status)::text = 'published' THEN now() ELSE published_at END,
    updated_at = now()
WHERE id = sqlc.arg(id) AND workspace_id = sqlc.arg(workspace_id)
RETURNING *;

-- name: CountKnowledgeEntries :many
SELECT kind, status, count(*)::bigint AS count
FROM knowledge_entry
WHERE workspace_id = $1
GROUP BY kind, status;

-- name: CountKnowledgeEmbeddingsByProfile :many
-- Corpus inventory for the model card. Counts only entries in this workspace,
-- so an orphaned vector could never inflate another workspace's corpus.
SELECT p.id AS profile_id,
       p.provider,
       p.model,
       p.dims,
       p.is_active,
       count(e.id)::bigint AS entries
FROM workspace_embedding_profile p
LEFT JOIN knowledge_embedding emb ON emb.profile_id = p.id
LEFT JOIN knowledge_entry e ON e.id = emb.entry_id AND e.workspace_id = p.workspace_id
WHERE p.workspace_id = $1
GROUP BY p.id, p.provider, p.model, p.dims, p.is_active
ORDER BY p.is_active DESC, p.created_at;

-- name: CountUnindexedKnowledgeEntries :one
SELECT count(*)::bigint AS count
FROM knowledge_entry e
LEFT JOIN knowledge_embedding emb ON emb.entry_id = e.id
WHERE e.workspace_id = $1
  AND e.status = 'published'
  AND emb.entry_id IS NULL;

-- name: SearchKnowledgeByKeyword :many
-- Trigram fallback that also works for Chinese. The query arrives split into
-- terms: an entry matches when ANY term is a substring or has trigram
-- similarity, and more matched terms rank higher. Only published entries are
-- retrievable; a selected corpus narrows the search to that profile.
SELECT e.*,
       emb.profile_id AS embedding_profile_id,
       emb.model AS embedding_model,
       emb.dims AS embedding_dims,
       COALESCE((
           SELECT MAX(GREATEST(similarity(e.title, term), similarity(e.body, term)))
           FROM unnest(sqlc.arg(terms)::text[]) AS term
       ), 0)::float8 AS score,
       (
           SELECT count(*) FROM unnest(sqlc.arg(terms)::text[]) AS term
           WHERE e.title ILIKE '%' || term || '%' OR e.body ILIKE '%' || term || '%'
       )::bigint AS match_count
FROM knowledge_entry e
LEFT JOIN knowledge_embedding emb ON emb.entry_id = e.id
WHERE e.workspace_id = sqlc.arg(workspace_id)
  AND e.status = 'published'
  AND (sqlc.narg(profile_id)::uuid IS NULL OR emb.profile_id = sqlc.narg(profile_id)::uuid)
  AND EXISTS (
      SELECT 1 FROM unnest(sqlc.arg(terms)::text[]) AS term
      WHERE e.title ILIKE '%' || term || '%'
         OR e.body ILIKE '%' || term || '%'
         OR similarity(e.title, term) > 0.08
         OR similarity(e.body, term) > 0.08
  )
ORDER BY match_count DESC, score DESC, e.updated_at DESC
LIMIT sqlc.arg(row_limit);

-- name: SearchKnowledgeByVector :many
-- One corpus only: the query embedding and every candidate vector were
-- produced by the same profile (or both by the legacy env embedder, which has
-- a NULL profile_id). dims is a second guard so vectors from two models with
-- the same profile cannot be compared by accident.
SELECT e.*,
       emb.profile_id AS embedding_profile_id,
       emb.model AS embedding_model,
       emb.dims AS embedding_dims,
       (1 - (emb.embedding <=> sqlc.arg(query_embedding)::text::vector))::float8 AS score
FROM knowledge_entry e
JOIN knowledge_embedding emb ON emb.entry_id = e.id
WHERE e.workspace_id = sqlc.arg(workspace_id)
  AND e.status = 'published'
  AND emb.dims = sqlc.arg(dims)::int
  AND (
      (sqlc.narg(profile_id)::uuid IS NOT NULL AND emb.profile_id = sqlc.narg(profile_id)::uuid)
      OR (sqlc.narg(profile_id)::uuid IS NULL AND emb.profile_id IS NULL)
  )
ORDER BY emb.embedding <=> sqlc.arg(query_embedding)::text::vector
LIMIT sqlc.arg(row_limit);

-- name: UpsertKnowledgeEmbedding :exec
INSERT INTO knowledge_embedding (entry_id, profile_id, model, dims, embedding, content_hash)
VALUES (
    sqlc.arg(entry_id),
    sqlc.narg(profile_id),
    sqlc.arg(model),
    sqlc.arg(dims),
    sqlc.arg(embedding)::text::vector,
    sqlc.arg(content_hash)
)
ON CONFLICT (entry_id) DO UPDATE
SET profile_id = EXCLUDED.profile_id,
    model = EXCLUDED.model,
    dims = EXCLUDED.dims,
    embedding = EXCLUDED.embedding,
    content_hash = EXCLUDED.content_hash,
    updated_at = now();

-- name: ListKnowledgeEntriesMissingEmbedding :many
SELECT e.* FROM knowledge_entry e
LEFT JOIN knowledge_embedding emb ON emb.entry_id = e.id
WHERE e.workspace_id = $1
  AND e.status = 'published'
  AND emb.entry_id IS NULL
ORDER BY e.updated_at DESC
LIMIT $2;

-- name: CreateWorkspaceEmbeddingProfile :one
INSERT INTO workspace_embedding_profile (
    workspace_id,
    provider,
    base_url,
    model,
    dims,
    api_key_cipher,
    key_hint,
    status,
    is_active,
    created_by,
    last_checked_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, 'verified', $8, $9, now())
RETURNING *;

-- name: GetWorkspaceEmbeddingProfile :one
SELECT * FROM workspace_embedding_profile
WHERE id = $1 AND workspace_id = $2;

-- name: GetActiveWorkspaceEmbeddingProfile :one
SELECT * FROM workspace_embedding_profile
WHERE workspace_id = $1 AND is_active = true
ORDER BY updated_at DESC
LIMIT 1;

-- name: ListWorkspaceEmbeddingProfiles :many
SELECT * FROM workspace_embedding_profile
WHERE workspace_id = $1
ORDER BY is_active DESC, created_at ASC;

-- name: ActivateWorkspaceEmbeddingProfile :exec
UPDATE workspace_embedding_profile
SET is_active = (id = sqlc.arg(id)::uuid),
    updated_at = now()
WHERE workspace_id = sqlc.arg(workspace_id)::uuid;

-- name: CountWorkspaceEmbeddingProfiles :one
SELECT count(*)::bigint AS count
FROM workspace_embedding_profile
WHERE workspace_id = $1;

-- name: CountEmbeddingsForProfile :one
SELECT count(*)::bigint AS count
FROM knowledge_embedding
WHERE profile_id = $1;

-- name: DeleteWorkspaceEmbeddingProfile :execrows
DELETE FROM workspace_embedding_profile
WHERE id = $1 AND workspace_id = $2 AND is_active = false;
