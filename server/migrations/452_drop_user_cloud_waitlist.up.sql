-- The cloud-waitlist lead capture is gone with the rest of the managed-cloud
-- integration: self-hosted QuickWork has no cloud tier to wait for, so the
-- Step 3 form that wrote these columns no longer exists. IF EXISTS because a
-- database that skipped the original column migration would still be recorded
-- in schema_migrations (repo rule: the ledger proves ordering, not execution).
ALTER TABLE "user"
    DROP COLUMN IF EXISTS cloud_waitlist_email,
    DROP COLUMN IF EXISTS cloud_waitlist_reason;
