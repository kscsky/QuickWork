-- The structured part of a leg's handoff package: acceptance rows, open
-- questions, the next leg's brief, and the last return.
--
-- handoff_summary / handoff_files stay where they are: they are the package
-- older clients already read. This column carries the parts those clients
-- simply ignore, so the wire stays additive.
ALTER TABLE issue_chain_step
    ADD COLUMN IF NOT EXISTS handoff_package JSONB NOT NULL DEFAULT '{}'::jsonb;
