-- Workspace usage dashboard + model call log.
--
-- Every query here reads raw task_usage rather than the hourly rollup. The
-- call log needs the individual (task, provider, model) rows, and the
-- overview has to agree with the log to the cent — mixing raw rows for the
-- log with a 5-minute-late rollup for the headline would make the two tabs
-- disagree during the tail of the window. Both endpoints therefore share the
-- same source and the same cutoff.
--
-- Scope mirrors task_usage_hourly: only runs executed by a daemon runtime
-- (runtime_id IS NOT NULL). Local CLI usage is intentionally not part of the
-- workspace dashboard.
--
-- Cost stays client-side: provider-reported ticks and the tokens that still
-- need the rate table both ride on the wire, so custom pricing keeps working.

-- name: ListUsageOverviewDaily :many
SELECT
    DATE(tu.created_at AT TIME ZONE @tz::text) AS date,
    LOWER(tu.provider) AS provider,
    tu.model,
    COUNT(*)::bigint AS call_count,
    SUM(tu.input_tokens)::bigint        AS input_tokens,
    SUM(tu.output_tokens)::bigint       AS output_tokens,
    SUM(tu.cache_read_tokens)::bigint   AS cache_read_tokens,
    SUM(tu.cache_write_tokens)::bigint  AS cache_write_tokens,
    COALESCE(SUM(tu.cost_usd_ticks), 0)::bigint AS cost_usd_ticks,
    COALESCE(SUM(tu.input_tokens)       FILTER (WHERE tu.cost_usd_ticks IS NULL), 0)::bigint AS uncosted_input_tokens,
    COALESCE(SUM(tu.output_tokens)      FILTER (WHERE tu.cost_usd_ticks IS NULL), 0)::bigint AS uncosted_output_tokens,
    COALESCE(SUM(tu.cache_read_tokens)  FILTER (WHERE tu.cost_usd_ticks IS NULL), 0)::bigint AS uncosted_cache_read_tokens,
    COALESCE(SUM(tu.cache_write_tokens) FILTER (WHERE tu.cost_usd_ticks IS NULL), 0)::bigint AS uncosted_cache_write_tokens,
    COUNT(*) FILTER (WHERE atq.status = 'completed')::bigint AS success_calls,
    COUNT(*) FILTER (WHERE atq.status = 'failed')::bigint    AS failed_calls,
    COUNT(*) FILTER (WHERE atq.status = 'cancelled')::bigint AS cancelled_calls,
    COUNT(*) FILTER (WHERE atq.status NOT IN ('completed', 'failed', 'cancelled'))::bigint AS running_calls
FROM task_usage tu
JOIN agent_task_queue atq ON atq.id = tu.task_id
JOIN agent a ON a.id = atq.agent_id
LEFT JOIN issue i ON i.id = atq.issue_id
WHERE a.workspace_id = @workspace_id::uuid
  AND atq.runtime_id IS NOT NULL
  AND tu.created_at >= @since::timestamptz
  AND (sqlc.narg('project_id')::uuid IS NULL OR i.project_id = sqlc.narg('project_id'))
GROUP BY 1, 2, 3
ORDER BY 1 DESC, 2, 3;

-- name: ListUsageModelSummary :many
-- Per-(provider, model) totals under the log filters. Used by the overview
-- (no filters) and by the log's summary strip (all filters). The status
-- filter is applied when present; callers that need per-status counts pass
-- no status so the same query returns the full distribution.
SELECT
    LOWER(tu.provider) AS provider,
    tu.model,
    COUNT(*)::bigint AS call_count,
    SUM(tu.input_tokens)::bigint        AS input_tokens,
    SUM(tu.output_tokens)::bigint       AS output_tokens,
    SUM(tu.cache_read_tokens)::bigint   AS cache_read_tokens,
    SUM(tu.cache_write_tokens)::bigint  AS cache_write_tokens,
    COALESCE(SUM(tu.cost_usd_ticks), 0)::bigint AS cost_usd_ticks,
    COALESCE(SUM(tu.input_tokens)       FILTER (WHERE tu.cost_usd_ticks IS NULL), 0)::bigint AS uncosted_input_tokens,
    COALESCE(SUM(tu.output_tokens)      FILTER (WHERE tu.cost_usd_ticks IS NULL), 0)::bigint AS uncosted_output_tokens,
    COALESCE(SUM(tu.cache_read_tokens)  FILTER (WHERE tu.cost_usd_ticks IS NULL), 0)::bigint AS uncosted_cache_read_tokens,
    COALESCE(SUM(tu.cache_write_tokens) FILTER (WHERE tu.cost_usd_ticks IS NULL), 0)::bigint AS uncosted_cache_write_tokens,
    COUNT(*) FILTER (WHERE atq.status = 'completed')::bigint AS success_calls,
    COUNT(*) FILTER (WHERE atq.status = 'failed')::bigint    AS failed_calls,
    COUNT(*) FILTER (WHERE atq.status = 'cancelled')::bigint AS cancelled_calls,
    COUNT(*) FILTER (WHERE atq.status NOT IN ('completed', 'failed', 'cancelled'))::bigint AS running_calls
FROM task_usage tu
JOIN agent_task_queue atq ON atq.id = tu.task_id
JOIN agent a ON a.id = atq.agent_id
JOIN workspace w ON w.id = a.workspace_id
LEFT JOIN issue i ON i.id = atq.issue_id
WHERE a.workspace_id = @workspace_id::uuid
  AND atq.runtime_id IS NOT NULL
  AND tu.created_at >= @since::timestamptz
  AND (sqlc.narg('until')::timestamptz IS NULL OR tu.created_at < sqlc.narg('until'))
  AND (sqlc.narg('project_id')::uuid IS NULL OR i.project_id = sqlc.narg('project_id'))
  AND (sqlc.narg('provider')::text IS NULL OR LOWER(tu.provider) = LOWER(sqlc.narg('provider')))
  AND (sqlc.narg('model')::text IS NULL OR tu.model = sqlc.narg('model'))
  AND (sqlc.narg('agent_id')::uuid IS NULL OR atq.agent_id = sqlc.narg('agent_id'))
  AND (
    sqlc.narg('status')::text IS NULL
    OR CASE
         WHEN atq.status = 'completed' THEN 'success'
         WHEN atq.status = 'failed' THEN 'failed'
         WHEN atq.status = 'cancelled' THEN 'cancelled'
         ELSE 'running'
       END = sqlc.narg('status')
  )
  AND (
    sqlc.narg('q')::text IS NULL
    OR tu.model ILIKE '%' || sqlc.narg('q') || '%'
    OR LOWER(tu.provider) ILIKE '%' || LOWER(sqlc.narg('q')) || '%'
    OR COALESCE(i.title, '') ILIKE '%' || sqlc.narg('q') || '%'
    OR COALESCE(w.issue_prefix || '-' || i.number::text, '') ILIKE '%' || sqlc.narg('q') || '%'
    OR tu.task_id::text ILIKE '%' || sqlc.narg('q') || '%'
  )
GROUP BY 1, 2
ORDER BY 1, 2;

-- name: ListUsageOverviewByAgent :many
-- Per-(agent, provider, model) totals for the overview leaderboard. Private
-- and system agents are folded onto one sentinel id so the workspace-level
-- sums stay intact without naming them; the client renders that bucket as
-- "restricted". Model stays in the group so each agent's cost is still
-- priced per model.
SELECT
    CASE
      WHEN atq.agent_id = ANY(@restricted_agent_ids::uuid[]) THEN '__restricted_agents__'
      ELSE atq.agent_id::text
    END AS agent_id,
    LOWER(tu.provider) AS provider,
    tu.model,
    COUNT(*)::bigint AS call_count,
    SUM(tu.input_tokens)::bigint        AS input_tokens,
    SUM(tu.output_tokens)::bigint       AS output_tokens,
    SUM(tu.cache_read_tokens)::bigint   AS cache_read_tokens,
    SUM(tu.cache_write_tokens)::bigint  AS cache_write_tokens,
    COALESCE(SUM(tu.cost_usd_ticks), 0)::bigint AS cost_usd_ticks,
    COALESCE(SUM(tu.input_tokens)       FILTER (WHERE tu.cost_usd_ticks IS NULL), 0)::bigint AS uncosted_input_tokens,
    COALESCE(SUM(tu.output_tokens)      FILTER (WHERE tu.cost_usd_ticks IS NULL), 0)::bigint AS uncosted_output_tokens,
    COALESCE(SUM(tu.cache_read_tokens)  FILTER (WHERE tu.cost_usd_ticks IS NULL), 0)::bigint AS uncosted_cache_read_tokens,
    COALESCE(SUM(tu.cache_write_tokens) FILTER (WHERE tu.cost_usd_ticks IS NULL), 0)::bigint AS uncosted_cache_write_tokens,
    COUNT(*) FILTER (WHERE atq.status = 'completed')::bigint AS success_calls,
    COUNT(*) FILTER (WHERE atq.status = 'failed')::bigint    AS failed_calls,
    COUNT(*) FILTER (WHERE atq.status = 'cancelled')::bigint AS cancelled_calls,
    COUNT(*) FILTER (WHERE atq.status NOT IN ('completed', 'failed', 'cancelled'))::bigint AS running_calls
FROM task_usage tu
JOIN agent_task_queue atq ON atq.id = tu.task_id
JOIN agent a ON a.id = atq.agent_id
LEFT JOIN issue i ON i.id = atq.issue_id
WHERE a.workspace_id = @workspace_id::uuid
  AND atq.runtime_id IS NOT NULL
  AND tu.created_at >= @since::timestamptz
  AND (sqlc.narg('project_id')::uuid IS NULL OR i.project_id = sqlc.narg('project_id'))
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

-- name: ListUsageLogs :many
-- One row per task_usage record (task × provider × model). The identifier,
-- title and trigger are resolved here so the client never has to assemble
-- them; provider/model stay separate for client-side pricing.
--
-- Sorting is server-side because pagination is server-side. Only metrics
-- the database knows are offered: cost is deliberately absent — most
-- providers report no cost, so ordering by cost_usd_ticks would rank nearly
-- every estimated row as zero. The client can still sort the current page
-- for display, but the global order stays honest.
SELECT
    tu.id,
    tu.task_id,
    CASE
      WHEN atq.status = 'completed' THEN 'success'
      WHEN atq.status = 'failed' THEN 'failed'
      WHEN atq.status = 'cancelled' THEN 'cancelled'
      ELSE 'running'
    END AS status,
    atq.status AS db_status,
    atq.agent_id,
    a.name AS agent_name,
    atq.issue_id,
    CASE
      WHEN i.number IS NULL THEN ''::text
      ELSE (w.issue_prefix || '-' || i.number::text)::text
    END AS issue_identifier,
    COALESCE(i.title, '')::text AS issue_title,
    i.project_id,
    LOWER(tu.provider) AS provider,
    tu.model,
    CASE
      WHEN atq.parent_task_id IS NOT NULL THEN 'retry'
      WHEN atq.rerun_of_task_id IS NOT NULL THEN 'rerun'
      WHEN atq.chat_session_id IS NOT NULL THEN 'chat'
      WHEN atq.autopilot_run_id IS NOT NULL THEN 'autopilot'
      WHEN atq.issue_id IS NULL THEN 'quick_create'
      WHEN atq.trigger_comment_id IS NOT NULL THEN 'comment'
      ELSE 'direct'
    END AS trigger,
    COALESCE(atq.failure_reason, '') AS failure_reason,
    atq.started_at,
    atq.completed_at,
    tu.created_at,
    tu.input_tokens,
    tu.output_tokens,
    tu.cache_read_tokens,
    tu.cache_write_tokens,
    tu.cost_usd_ticks
FROM task_usage tu
JOIN agent_task_queue atq ON atq.id = tu.task_id
JOIN agent a ON a.id = atq.agent_id
JOIN workspace w ON w.id = a.workspace_id
LEFT JOIN issue i ON i.id = atq.issue_id
WHERE a.workspace_id = @workspace_id::uuid
  AND atq.runtime_id IS NOT NULL
  AND tu.created_at >= @since::timestamptz
  AND (sqlc.narg('project_id')::uuid IS NULL OR i.project_id = sqlc.narg('project_id'))
  AND (sqlc.narg('provider')::text IS NULL OR LOWER(tu.provider) = LOWER(sqlc.narg('provider')))
  AND (sqlc.narg('model')::text IS NULL OR tu.model = sqlc.narg('model'))
  AND (sqlc.narg('agent_id')::uuid IS NULL OR atq.agent_id = sqlc.narg('agent_id'))
  AND (
    sqlc.narg('status')::text IS NULL
    OR CASE
         WHEN atq.status = 'completed' THEN 'success'
         WHEN atq.status = 'failed' THEN 'failed'
         WHEN atq.status = 'cancelled' THEN 'cancelled'
         ELSE 'running'
       END = sqlc.narg('status')
  )
  AND (
    sqlc.narg('q')::text IS NULL
    OR tu.model ILIKE '%' || sqlc.narg('q') || '%'
    OR LOWER(tu.provider) ILIKE '%' || LOWER(sqlc.narg('q')) || '%'
    OR COALESCE(i.title, '') ILIKE '%' || sqlc.narg('q') || '%'
    OR COALESCE(w.issue_prefix || '-' || i.number::text, '') ILIKE '%' || sqlc.narg('q') || '%'
    OR tu.task_id::text ILIKE '%' || sqlc.narg('q') || '%'
  )
ORDER BY
    (
      CASE
        WHEN sqlc.narg('sort')::text = 'duration'
          THEN COALESCE(EXTRACT(EPOCH FROM (atq.completed_at - atq.started_at)), 0)
        WHEN sqlc.narg('sort')::text = 'input' THEN tu.input_tokens::numeric
        WHEN sqlc.narg('sort')::text = 'output' THEN tu.output_tokens::numeric
        WHEN sqlc.narg('sort')::text = 'cache'
          THEN (tu.cache_read_tokens + tu.cache_write_tokens)::numeric
        ELSE EXTRACT(EPOCH FROM tu.created_at)
      END
    ) * (CASE WHEN sqlc.narg('dir')::text = 'asc' THEN 1 ELSE -1 END) ASC,
    tu.created_at DESC,
    tu.id DESC
LIMIT @limit_count::int OFFSET @offset_count::int;
