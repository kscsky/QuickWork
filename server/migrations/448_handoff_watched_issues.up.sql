-- Cross-workspace hand-off: per-issue watch list.
--
-- A rule without watched_issue_ids fires on EVERY card entering the trigger
-- status ("watch the lane"). With it, the rule fires only when one of the
-- named cards makes that move ("watch these cards") — the picker's contract.
-- Stored as a uuid array so membership is one comparison, no join table.
ALTER TABLE handoff_rule
    ADD COLUMN IF NOT EXISTS watched_issue_ids UUID[] NOT NULL DEFAULT '{}';
