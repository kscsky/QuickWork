-- A task's chain: who does what, in order.
--
-- A task dispatched to a squad is not one run — it is a relay. The chain is
-- the relay written down: one row per step, in order, naming the PERSON who
-- holds it and the agent they lend. It is authored at creation time (from a
-- playbook, or the squad's member order) and then advanced as each run
-- finishes.
--
-- The agent is a snapshot, not a reference to the person's binding: someone
-- may rebind between now and their turn, and the chain has to record what was
-- agreed when the task started. A step with NO agent is the state this whole
-- mechanism exists for — the relay reaches a person who has not bound one, and
-- parks there instead of skipping or failing.
--
-- No FKs (repo rule): ids are validated in the service layer.
CREATE TABLE IF NOT EXISTS issue_chain_step (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id UUID NOT NULL,
    position INT NOT NULL,
    -- The person whose turn this is.
    holder_user_id UUID NOT NULL,
    -- The agent they lend. NULL is meaningful: nobody can work this step yet.
    agent_id UUID,
    -- What this step is for, as authored ("实现退避与队列"). Shown in the
    -- chain strip and the task room; not an instruction the agent receives.
    title TEXT NOT NULL DEFAULT '',
    -- pending | doing | done | parked | skipped
    --
    -- A CHECK rather than a type: adding a state is a one-line migration, and
    -- an unknown value from a newer writer would otherwise fail the insert
    -- rather than land and render as "unknown".
    state TEXT NOT NULL DEFAULT 'pending',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
