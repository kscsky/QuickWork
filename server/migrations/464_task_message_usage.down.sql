ALTER TABLE task_message
  DROP COLUMN IF EXISTS input_tokens,
  DROP COLUMN IF EXISTS output_tokens,
  DROP COLUMN IF EXISTS cache_read_tokens,
  DROP COLUMN IF EXISTS cache_write_tokens;
