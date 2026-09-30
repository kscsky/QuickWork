-- Cross-workspace hand-off rules (fork): the DB-backed replacement for the
-- relay's JSON file. One row = one standing rule "when a card in MY workspace
-- enters <trigger_status>, hand it to <target agent in another workspace>",
-- optionally with a receipt leg derived at fire time.
--
-- Rules are stored once, in the SOURCE workspace; the relay matches an event
-- by source_workspace_id + trigger_status. The target workspace and agent are
-- resolved at fire time through the relay token, so a rule whose target
-- becomes unreachable fails loudly in the delivery log instead of silently
-- disappearing from the list.
--
-- No FKs (repo rule): target/source ids are validated in the service layer.
CREATE TABLE handoff_rule (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_workspace_id UUID NOT NULL,
    name TEXT NOT NULL,
    -- The status key in the SOURCE workspace that fires the hand-off.
    trigger_status TEXT NOT NULL,
    target_workspace_id UUID NOT NULL,
    target_agent_id UUID NOT NULL,
    -- Title template for the created card; {{identifier}}/{{title}} expand.
    task_template TEXT NOT NULL DEFAULT '',
    -- Instruction appended to the context pack handed to the target agent.
    note TEXT NOT NULL DEFAULT '',
    -- Context budget and receipt behaviour.
    context_comments INT NOT NULL DEFAULT 12,
    -- Status the TARGET workspace card enters when its run is done; its entry
    -- fires the receipt leg back to the source card. Empty = no receipt.
    receipt_status TEXT NOT NULL DEFAULT 'handoff_back',
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
