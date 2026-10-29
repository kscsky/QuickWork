-- Alone in its own file: CONCURRENTLY is rejected inside a transaction or a
-- multi-command string.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_knowledge_entry_trgm
    ON knowledge_entry USING gin ((title || ' ' || body) gin_trgm_ops);
