-- Cross-workspace hand-off: optional chat transcript in the context pack.
--
-- The card's discussion lives in comments; the conversation that PRODUCED the
-- work often lives in a chat session instead. The rule names which session to
-- carry (a rule cannot guess: sessions are not bound to cards), and the relay
-- renders it as its own labelled section so the receiving agent can tell
-- dialogue from review comments.
ALTER TABLE handoff_rule
    ADD COLUMN IF NOT EXISTS chat_session_id UUID;
