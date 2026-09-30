-- Restores the columns only. The captured values are not recoverable — the
-- feature that wrote them is deleted, so a down-migration cannot repopulate it.
ALTER TABLE "user"
    ADD COLUMN IF NOT EXISTS cloud_waitlist_email VARCHAR(254),
    ADD COLUMN IF NOT EXISTS cloud_waitlist_reason TEXT;
