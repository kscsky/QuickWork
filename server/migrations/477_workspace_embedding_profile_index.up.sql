-- One profile per provider + model + dimension in a workspace.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_workspace_embedding_profile_model
    ON workspace_embedding_profile (workspace_id, provider, model, dims);
