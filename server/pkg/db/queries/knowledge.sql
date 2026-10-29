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
-- One workspace, newest first. Empty status/kind filters mean "all"; the page
-- and the console both use this single list.
SELECT * FROM knowledge_entry
WHERE workspace_id = sqlc.arg(workspace_id)
  AND (sqlc.arg(status)::text = '' OR status = sqlc.arg(status)::text)
  AND (sqlc.arg(kind)::text = '' OR kind = sqlc.arg(kind)::text)
ORDER BY updated_at DESC
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

-- name: SearchKnowledgeByKeyword :many
-- Trigram fallback that also works for Chinese. The query arrives split into
-- terms: an entry matches when ANY term is a substring or has trigram
-- similarity, and more matched terms rank higher. Only published entries are
-- retrievable; drafts stay in the squad's list, never here.
SELECT e.*,
       COALESCE((
           SELECT MAX(GREATEST(similarity(e.title, term), similarity(e.body, term)))
           FROM unnest(sqlc.arg(terms)::text[]) AS term
       ), 0)::float8 AS score,
       (
           SELECT count(*) FROM unnest(sqlc.arg(terms)::text[]) AS term
           WHERE e.title ILIKE '%' || term || '%' OR e.body ILIKE '%' || term || '%'
       )::bigint AS match_count
FROM knowledge_entry e
WHERE e.workspace_id = sqlc.arg(workspace_id)
  AND e.status = 'published'
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
SELECT e.*,
       (1 - (emb.embedding <=> sqlc.arg(query_embedding)::text::vector))::float8 AS score
FROM knowledge_entry e
JOIN knowledge_embedding emb ON emb.entry_id = e.id
WHERE e.workspace_id = sqlc.arg(workspace_id)
  AND e.status = 'published'
ORDER BY emb.embedding <=> sqlc.arg(query_embedding)::text::vector
LIMIT sqlc.arg(row_limit);

-- name: UpsertKnowledgeEmbedding :exec
INSERT INTO knowledge_embedding (entry_id, model, dims, embedding, content_hash)
VALUES (
    sqlc.arg(entry_id),
    sqlc.arg(model),
    sqlc.arg(dims),
    sqlc.arg(embedding)::text::vector,
    sqlc.arg(content_hash)
)
ON CONFLICT (entry_id) DO UPDATE
SET model = EXCLUDED.model,
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
