-- Workspace-level E2B sandbox connection.
--
-- One row per workspace: which E2B deployment to reach and the API key that
-- authorises it, sealed with QUICKWORK_SANDBOX_SECRET_KEY (secretbox AES-256-GCM,
-- same envelope as vcs_connection / user_jira_connection). The key is
-- write-only by construction: every read path returns a projection without it.
--
-- verified_at records when the key last proved good — the write path probes
-- GET /v2/sandboxes before storing, so a saved connection is always a working
-- one, and the settings page can show that without re-reading the secret. It is
-- a timestamp rather than a rendered label on purpose: this table stores facts,
-- not copy, so the UI stays localisable.
--
-- No foreign key to workspace by repo rule; DeleteWorkspaceConnections sweeps
-- this table explicitly during teardown, and workspaceDeletionManifest records
-- that ownership decision.
CREATE TABLE workspace_sandbox_connection (
    workspace_id UUID PRIMARY KEY,
    api_url TEXT NOT NULL,
    api_key_encrypted TEXT NOT NULL,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
