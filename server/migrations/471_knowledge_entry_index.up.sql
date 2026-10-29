-- Alone in its own file: CONCURRENTLY is rejected inside a transaction or a
-- multi-command string. The knowledge page reads one workspace, newest first,
-- and filters by status.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_knowledge_entry_workspace_status
    ON knowledge_entry (workspace_id, status, updated_at DESC);
