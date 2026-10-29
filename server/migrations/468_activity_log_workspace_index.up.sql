-- Alone in its own file: CONCURRENTLY is rejected inside a transaction or a
-- multi-command string. The activity page reads one workspace's relay
-- decisions, newest first; the existing index is issue-scoped only.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_log_workspace_created
    ON activity_log (workspace_id, created_at DESC);
