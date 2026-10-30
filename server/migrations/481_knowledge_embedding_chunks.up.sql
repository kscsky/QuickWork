-- One entry can now own several vectors: a whole-entry index is chunk 0 with
-- strategy='entry', while a summary can be split into section chunks whose
-- entry_id is the parent returned to callers. Existing rows become chunk 0.
ALTER TABLE knowledge_embedding DROP CONSTRAINT IF EXISTS knowledge_embedding_pkey;
ALTER TABLE knowledge_embedding ADD COLUMN IF NOT EXISTS chunk_index INT NOT NULL DEFAULT 0;
ALTER TABLE knowledge_embedding ADD COLUMN IF NOT EXISTS chunk_text TEXT NOT NULL DEFAULT '';
ALTER TABLE knowledge_embedding ADD COLUMN IF NOT EXISTS heading TEXT NOT NULL DEFAULT '';
ALTER TABLE knowledge_embedding ADD COLUMN IF NOT EXISTS strategy TEXT NOT NULL DEFAULT 'entry';

UPDATE knowledge_embedding emb
SET chunk_text = e.body
FROM knowledge_entry e
WHERE e.id = emb.entry_id AND emb.chunk_text = '';
