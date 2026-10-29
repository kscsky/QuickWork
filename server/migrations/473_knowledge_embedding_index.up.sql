-- Alone in its own file: CONCURRENTLY is rejected inside a transaction or a
-- multi-command string. Cosine distance matches normalized embedding models.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_knowledge_embedding_hnsw
    ON knowledge_embedding USING hnsw (embedding vector_cosine_ops);
