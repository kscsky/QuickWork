-- A squad is a room of ACCOUNTS (fork). Two things the existing rows could not
-- express, both added here rather than bolted onto a neighbouring table:
--
--   * `squad_member.can_receive_work` — whether work handed to the room may run
--     on this member's agents. A member with it off is a participant, not a
--     resource: they read the room and talk, nothing is dispatched to them.
--     The column exists because role (leader/executor/reviewer/observer) says
--     what someone decides, and this says whether their machine is available;
--     the two are independent (an observer may lend an agent, an executor may
--     switch theirs off while away).
--
--   * `squad_message` — the room's own stream. The chat tables are 1:1
--     human↔agent and creator-only, so a room with many authors — some human,
--     some agent, some the room narrating itself — needs its own store rather
--     than a widened `chat_message.role`.
--
-- Idempotent: a database that skipped an earlier attempt is still recorded in
-- schema_migrations, and the ledger proves ordering, not execution.
--
-- No FKs (repo rule): every id here is validated in the service layer.
ALTER TABLE squad_member
    ADD COLUMN IF NOT EXISTS can_receive_work BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS squad_message (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    squad_id UUID NOT NULL,
    -- Who is speaking. 'system' entries carry a NULL author_id: they are the
    -- room narrating membership and handoffs, not anybody's words.
    author_type TEXT NOT NULL CHECK (author_type IN ('member', 'agent', 'system')),
    author_id UUID,
    body TEXT NOT NULL,
    -- Room-local shape hint for entries that are not plain prose: a cross-zone
    -- receipt, an agent run in flight, a membership change. Unknown kinds are
    -- the reason this is a hint and not a discriminator — a reader that does
    -- not recognise one renders it as plain text rather than dropping it, so a
    -- newer writer can never blank an older client's stream.
    kind TEXT NOT NULL DEFAULT 'text',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
