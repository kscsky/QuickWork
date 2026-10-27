-- The handoff package a leg publishes on 审核通过.
--
-- Collection is automatic — at review time the holder's candidates (their
-- leg's attachments, branch rows) are gathered into the workbench — but what
-- CROSSES the leg boundary is the holder's call: the files they tick and the
-- summary they write. Storing the package on the step (rather than as a
-- comment) keeps the boundary honest: the room's leg content stays private,
-- and the package is one structured fact every reader renders the same way.
--
-- handoff_files is a JSON array of {name, size?, attachment_id?, kind?}.
-- Plain ADD COLUMN: no index, so no CONCURRENTLY requirement; IF NOT EXISTS
-- keeps a re-run harmless.
ALTER TABLE issue_chain_step ADD COLUMN IF NOT EXISTS handoff_summary TEXT NOT NULL DEFAULT '';
ALTER TABLE issue_chain_step ADD COLUMN IF NOT EXISTS handoff_files JSONB NOT NULL DEFAULT '[]'::jsonb;
