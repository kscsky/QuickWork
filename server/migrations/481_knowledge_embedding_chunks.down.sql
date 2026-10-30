ALTER TABLE knowledge_embedding DROP CONSTRAINT IF EXISTS knowledge_embedding_pkey;
DELETE FROM knowledge_embedding emb
WHERE emb.chunk_index > 0
  AND NOT EXISTS (
    SELECT 1 FROM knowledge_embedding keep
    WHERE keep.entry_id = emb.entry_id AND keep.chunk_index = 0
  );
ALTER TABLE knowledge_embedding DROP COLUMN IF EXISTS chunk_index;
ALTER TABLE knowledge_embedding DROP COLUMN IF EXISTS chunk_text;
ALTER TABLE knowledge_embedding DROP COLUMN IF EXISTS heading;
ALTER TABLE knowledge_embedding DROP COLUMN IF EXISTS strategy;
ALTER TABLE knowledge_embedding ADD CONSTRAINT knowledge_embedding_pkey PRIMARY KEY (entry_id);
