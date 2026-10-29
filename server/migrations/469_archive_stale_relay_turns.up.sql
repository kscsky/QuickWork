-- relay_turn inbox items are now resolved when their leg leaves
-- reviewing/parked. Rows created before that wiring can still point at legs
-- that have already moved on; archive them once so the activity page's
-- "needs you" band and the sidebar badge start from the truth.
UPDATE inbox_item i
SET read = true, archived = true
WHERE i.type = 'relay_turn'
  AND i.archived = false
  AND NOT EXISTS (
      SELECT 1
      FROM issue_chain_step s
      WHERE s.issue_id = i.issue_id
        AND s.position = (i.details->>'position')::int
        AND s.state IN ('reviewing', 'parked')
  );
