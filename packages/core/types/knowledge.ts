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
  /** The corpus this entry was stamped into. Null means unindexed. */
  embedding_profile_id?: string | null;
  embedding_model?: string;
  embedding_dims?: number | null;
}

export interface KnowledgeEmbeddingStatus {
  enabled: boolean;
  profile_id?: string;
  provider?: string;
  model: string;
  dims: number;
}

/** A workspace embedding profile. The API key never appears here. */
export interface EmbeddingProfile {
  id: string;
  provider: string;
  base_url: string;
  model: string;
  dims: number;
  key_hint: string;
  status: string;
  last_error: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** One dimension partition, as shown on the model card. */
export interface KnowledgeCorpus {
  profile_id: string;
  provider: string;
  model: string;
  dims: number;
  entries: number;
  active: boolean;
}

export interface KnowledgeListResponse {
  entries: KnowledgeEntry[];
  /** "<kind>:<status>" → count, for the corpus card. */
  stats: Record<string, number>;
  embedding: KnowledgeEmbeddingStatus;
  profiles: EmbeddingProfile[];
  corpora: KnowledgeCorpus[];
  unindexed: number;
}

export interface KnowledgeHit {
  entry: KnowledgeEntry;
  score: number;
}

export interface KnowledgeProfileRef {
  id: string;
  provider: string;
  model: string;
  dims: number;
}

export interface KnowledgeSearchResponse {
  /** "vector" when an embedding provider answered, otherwise "keyword". */
  mode: "vector" | "keyword" | (string & {});
  /** The corpus the query ran against, when one was selected. */
  profile?: KnowledgeProfileRef | null;
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
  embedding_profile_id?: string;
  embedding_provider?: string;
  embedding_model: string;
  embedding_dims: number;
}

export interface EmbeddingModel {
  name: string;
  dims: number[];
  recommended?: boolean;
}

export interface EmbeddingProvider {
  key: string;
  label: string;
  base_url: string;
  models: EmbeddingModel[];
  manual: boolean;
}

export interface EmbeddingMatchResult {
  provider: string;
  base_url: string;
  models: EmbeddingModel[];
  manual: boolean;
}

export interface EmbeddingProfileInput {
  provider: string;
  base_url?: string;
  model: string;
  dims: number;
  api_key: string;
  activate?: boolean;
}
