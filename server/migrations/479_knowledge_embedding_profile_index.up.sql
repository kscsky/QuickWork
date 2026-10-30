-- Corpus filter: every search narrows to one embedding profile.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_knowledge_embedding_profile
    ON knowledge_embedding (profile_id);
