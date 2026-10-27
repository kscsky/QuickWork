/** One upstream that contributes free models to the pool. */
export interface ModelPoolSource {
  id: string;
  name: string;
  kind: string;
  model_count: number;
  free_count: number;
  status: string;
  error?: string;
  synced_at: string;
}

/** One catalog entry. `protocol` is what a harness must speak to use it. */
export interface ModelPoolModel {
  id: string;
  name: string;
  source: string;
  protocol: string;
  context_length?: number;
  /**
   * null/undefined means the catalog does not publish tool support.
   * NVIDIA's list is id-only; OpenRouter publishes `supported_parameters`.
   */
  supports_tools?: boolean | null;
  reasoning?: boolean;
  free: boolean;
}

export interface ModelPoolCatalog {
  sources: ModelPoolSource[];
  models: ModelPoolModel[];
  synced_at: string;
}
