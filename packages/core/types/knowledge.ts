/** One row of the workspace knowledge base. */
export type KnowledgeKind = "summary" | "faq" | (string & {});
export type KnowledgeStatus = "draft" | "published" | "archived" | (string & {});

export interface KnowledgeEntry {
  id: string;
  workspace_id: string;
  squad_id: string | null;
  kind: KnowledgeKind;
  title: string;
  body: string;
  tags: string[];
  status: KnowledgeStatus;
  source_issue_id: string | null;
  source_leg: number | null;
  source_kind: string;
  created_by: string;
  published_by: string | null;
  published_at: string | null;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeEmbeddingStatus {
  enabled: boolean;
  model: string;
  dims: number;
}

export interface KnowledgeListResponse {
  entries: KnowledgeEntry[];
  /** "<kind>:<status>" → count, for the corpus card. */
  stats: Record<string, number>;
  embedding: KnowledgeEmbeddingStatus;
}

export interface KnowledgeHit {
  entry: KnowledgeEntry;
  score: number;
}

export interface KnowledgeSearchResponse {
  /** "vector" when an embedding provider answered, otherwise "keyword". */
  mode: "vector" | "keyword" | (string & {});
  hits: KnowledgeHit[];
}

/** One entry in the deposit preview (the summary document plus FAQ drafts). */
export interface KnowledgePreviewEntry {
  key: string;
  kind: KnowledgeKind;
  title: string;
  body: string;
  tags: string[];
  source_leg: number;
  source_kind: string;
}

export interface KnowledgePreview {
  summary: string;
  entries: KnowledgePreviewEntry[];
  embedding_enabled: boolean;
  embedding_model: string;
  embedding_dims: number;
}
