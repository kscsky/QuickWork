-- The holder's own brief for their leg ("按上一棒清单实现 1/2/4 退避"). Written
-- by the person whose turn it is — nobody else fills this in, and the next
-- person is handed the previous leg's OUTPUT, never a brief authored for them.
-- That is the personal-view relay in one column.
--
-- Plain ADD COLUMN: no index, so no CONCURRENTLY requirement; IF NOT EXISTS
-- keeps a re-run harmless.
ALTER TABLE issue_chain_step ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT '';
