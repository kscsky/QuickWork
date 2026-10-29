-- Keyword fallback for deployments without an embedding provider, and for
-- exact-term hits that a vector can miss. Trigrams work for Chinese substrings
-- where Postgres' built-in text search has no tokenizer.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
