-- Per-turn token usage on streamed task messages.
--
-- The daemon already parses each assistant turn's usage (and reports the
-- run total to task_usage at completion); this carries the per-turn slice on
-- the message it belongs to, so the run log can say what each step cost.
-- All-zero means "not reported" (older daemons, providers without per-turn
-- metering) — the UI renders no badge rather than a fake zero.
ALTER TABLE task_message
  ADD COLUMN input_tokens bigint NOT NULL DEFAULT 0,
  ADD COLUMN output_tokens bigint NOT NULL DEFAULT 0,
  ADD COLUMN cache_read_tokens bigint NOT NULL DEFAULT 0,
  ADD COLUMN cache_write_tokens bigint NOT NULL DEFAULT 0;
