-- Rebuild the vector table for dimension-stamped, profile-scoped embeddings.
-- Vectors are derived data: they are rebuilt from knowledge entries, and the
-- old fixed 1024 column cannot be widened in place. The new column is 1536
-- wide (the HNSW index limit is 2000); models with fewer dimensions are
-- zero-padded, which preserves cosine similarity exactly. profile_id is NULL
-- only for vectors from the legacy environment-level embedder.
DROP TABLE IF EXISTS knowledge_embedding;

CREATE TABLE knowledge_embedding (
    entry_id UUID PRIMARY KEY,
    profile_id UUID,
    model TEXT NOT NULL,
    dims INT NOT NULL,
    embedding vector(1536) NOT NULL,
    content_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
