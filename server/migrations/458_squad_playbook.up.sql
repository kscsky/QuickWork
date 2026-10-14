-- A playbook: a chain a squad has walked before, saved to walk again.
--
-- Steps name PEOPLE, never agents. The agent is resolved when the playbook is
-- used, because a person's binding changes — saving the agent would route
-- tomorrow's task to whichever machine they happened to be on today, and a
-- person with no binding at use time is exactly the park the chain exists for.
--
-- JSONB rather than a child table: a playbook is authored and replaced whole,
-- every read wants all its steps in order, and nothing ever queries a step
-- across playbooks.
--
-- No FKs (repo rule).
CREATE TABLE IF NOT EXISTS squad_playbook (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    squad_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    -- [{"holder_user_id": "<uuid>", "title": "实现退避与队列"}, ...]
    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
