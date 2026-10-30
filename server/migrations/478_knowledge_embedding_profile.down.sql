DROP TABLE IF EXISTS knowledge_embedding;

CREATE TABLE knowledge_embedding (
    entry_id UUID PRIMARY KEY,
    model TEXT NOT NULL,
    dims INT NOT NULL,
    embedding vector(1024) NOT NULL,
    content_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
