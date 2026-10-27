-- Trim the catalog to what this product actually offers: 待办 / 进行中 / 已完成 /
-- 已取消. The three Multica-era statuses stay valid built-ins in code (agents
-- can still write them, the relay parks on `blocked`), but a workspace that
-- never used one should not have it sitting in every status picker.
--
-- Two guards keep the delete honest: a status some issue still carries must
-- stay resolvable in that workspace's catalog, and a category a custom status
-- has adopted must keep its built-in row for the settings grouping.
DELETE FROM issue_status s
WHERE s.is_system
  AND s.key IN ('backlog', 'in_review', 'blocked')
  AND NOT EXISTS (
    SELECT 1 FROM issue i
    WHERE i.workspace_id = s.workspace_id AND i.status = s.key
  )
  AND NOT EXISTS (
    SELECT 1 FROM issue_status c
    WHERE c.workspace_id = s.workspace_id
      AND c.category = s.key
      AND NOT c.is_system
  );

-- Retro-fit the projection onto history: every squad task whose relay is
-- already underway gets the status its chain implies, so the list/inbox agree
-- with the detail page from the first read instead of waiting for the next
-- relay event. Terminal human decisions are left alone.
UPDATE issue i
SET status = CASE
  WHEN EXISTS (
    SELECT 1 FROM issue_chain_step s
    WHERE s.issue_id = i.id AND s.state = 'parked'
  ) THEN 'blocked'
  WHEN NOT EXISTS (
    SELECT 1 FROM issue_chain_step s
    WHERE s.issue_id = i.id AND s.state NOT IN ('done', 'skipped')
  ) THEN 'done'
  ELSE 'in_progress'
END
-- A chain IS the relay's definition — not the assignee field. (A task can
-- carry a chain while the assignee column still names a member.)
WHERE i.status NOT IN ('cancelled', 'done')
  AND EXISTS (SELECT 1 FROM issue_chain_step s WHERE s.issue_id = i.id);
