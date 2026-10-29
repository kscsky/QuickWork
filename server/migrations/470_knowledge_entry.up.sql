-- The squad's memory: one row per distilled piece of knowledge. A completed
-- relay can deposit a summary document plus FAQ drafts; only published rows
-- are retrieved into later legs. No foreign keys by policy; application code
-- validates the source issue and workspace in the same request.
CREATE TABLE IF NOT EXISTS knowledge_entry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    squad_id UUID,
    kind TEXT NOT NULL CHECK (kind IN ('summary', 'faq')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    source_issue_id UUID,
    source_leg INT,
    source_kind TEXT NOT NULL DEFAULT 'manual',
    created_by UUID NOT NULL,
    published_by UUID,
    published_at TIMESTAMPTZ,
    usage_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
