CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_handoff_rule_source
    ON handoff_rule (source_workspace_id, trigger_status) WHERE enabled;
