-- A workspace-level embedding model profile. Entries are stamped with the
-- profile (and therefore model + dims) they were embedded under; a workspace
-- can keep several profiles but exactly one is active for new deposits.
-- The API key is stored encrypted (AES-GCM) and only its last four characters
-- are exposed to clients.
CREATE TABLE IF NOT EXISTS workspace_embedding_profile (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    provider TEXT NOT NULL,
    base_url TEXT NOT NULL,
    model TEXT NOT NULL,
    dims INT NOT NULL,
    api_key_cipher TEXT NOT NULL,
    key_hint TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'verified',
    last_error TEXT NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT false,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_checked_at TIMESTAMPTZ
);
