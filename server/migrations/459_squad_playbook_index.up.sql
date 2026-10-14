CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_squad_playbook_squad
    ON squad_playbook (squad_id, updated_at DESC);
