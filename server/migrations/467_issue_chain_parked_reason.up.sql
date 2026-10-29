-- A parked leg is a wait, and every wait must say why. Parking used to mean
-- exactly one thing ("the holder has no agent"); a dispatch-time readiness
-- check now also parks a leg whose agent cannot claim: an archived agent, an
-- unbound runtime, a runtime that is private to another member, or a CLI the
-- machine cannot execute. The code is stored with the state so the room can
-- render the fix instead of an indefinite "waiting".
ALTER TABLE issue_chain_step
    ADD COLUMN IF NOT EXISTS parked_reason TEXT NOT NULL DEFAULT '';
