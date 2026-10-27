// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseWithFallback } from "./schema";
import { EMPTY_MODEL_POOL_CATALOG, ModelPoolCatalogSchema } from "./schemas";

const opts = { endpoint: "GET /api/model-pool/catalog" };

describe("ModelPoolCatalogSchema", () => {
  it("keeps catalog entries and defaults missing capability fields", () => {
    const out = parseWithFallback(
      {
        sources: [{ id: "nvidia", name: "NVIDIA NIM", status: "ok" }],
        models: [
          { id: "nvidia/model", name: "nvidia/model", source: "nvidia", free: true },
        ],
      },
      ModelPoolCatalogSchema,
      EMPTY_MODEL_POOL_CATALOG,
      opts,
    );
    expect(out.models).toHaveLength(1);
    expect(out.models[0]?.supports_tools).toBeUndefined();
    expect(out.sources[0]?.model_count).toBe(0);
    expect(out.synced_at).toBe("");
  });

  it("falls back to an empty catalog when the payload shape drifts", () => {
    const out = parseWithFallback(
      { sources: "nope", models: 42 },
      ModelPoolCatalogSchema,
      EMPTY_MODEL_POOL_CATALOG,
      opts,
    );
    expect(out).toEqual(EMPTY_MODEL_POOL_CATALOG);
  });

  it("accepts an unknown source status so newer servers do not blank the page", () => {
    const out = parseWithFallback(
      { sources: [{ id: "nvidia", status: "rate_limited" }], models: [] },
      ModelPoolCatalogSchema,
      EMPTY_MODEL_POOL_CATALOG,
      opts,
    );
    expect(out.sources[0]?.status).toBe("rate_limited");
  });
});
