-- Vector side of the knowledge base. 1024 dims is the canonical width for a
-- multilingual embedding model (bge-m3, multilingual-e5-large, or an OpenAI
-- text-embedding-3 model asked for 1024 dimensions via Matryoshka). The
-- embedding is stored beside the entry, not fused into it, so the model can be
-- re-run without rewriting content.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS knowledge_embedding (
    entry_id UUID PRIMARY KEY,
    model TEXT NOT NULL,
    dims INT NOT NULL,
    embedding vector(1024) NOT NULL,
    content_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
