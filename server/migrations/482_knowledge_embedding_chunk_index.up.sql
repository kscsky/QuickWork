-- ON CONFLICT (entry_id, chunk_index) needs this uniqueness; a concurrent
-- unique index keeps the migration from locking the embedding table.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_knowledge_embedding_entry_chunk
    ON knowledge_embedding (entry_id, chunk_index);
