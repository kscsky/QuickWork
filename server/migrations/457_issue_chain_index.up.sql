-- Alone in its own file: CONCURRENTLY is rejected inside a transaction or a
-- multi-command string, and the runner executes each file as one statement.
-- The chain is always read whole, ordered by position.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_issue_chain_step_issue
    ON issue_chain_step (issue_id, position);
