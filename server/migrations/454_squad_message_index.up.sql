-- Alone in its own file on purpose: PostgreSQL refuses CREATE INDEX
-- CONCURRENTLY inside a transaction or a multi-command string, and the
-- migration runner executes each file as a single statement. The room reads
-- newest-first, so the index is ordered the way the query walks it.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_squad_message_squad
    ON squad_message (squad_id, created_at DESC, id DESC);
