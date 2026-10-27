package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/kscsky/quickwork/server/internal/testutil"
)

func TestNormalizeNVIDIAModels(t *testing.T) {
	raw := []byte(`{"object":"list","data":[{"id":"nvidia/nemotron-3-ultra-550b-a55b"},{"id":"z-ai/glm-5.3"},{"id":"  "}]}`)
	models, err := normalizeNVIDIAModels(raw)
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	if len(models) != 2 {
		t.Fatalf("models = %d, want 2", len(models))
	}
	first := models[0]
	if first.ID != "nvidia/nemotron-3-ultra-550b-a55b" || first.Source != "nvidia" || first.Protocol != "openai" || !first.Free {
		t.Fatalf("unexpected first model: %+v", first)
	}
	if first.SupportsTools != nil {
		t.Fatalf("NVIDIA catalog must not claim tool support: %+v", first)
	}
}

func TestNormalizeOpenRouterModelsFiltersPaidAndReadsCapabilities(t *testing.T) {
	raw := []byte(`{"data":[
		{"id":"nvidia/nemotron-3-ultra-550b-a55b:free","name":"NVIDIA: Nemotron 3 Ultra","context_length":1000000,"supported_parameters":["tools","reasoning"],"pricing":{"prompt":"0","completion":"0"}},
		{"id":"paid/model","name":"Paid","context_length":128000,"supported_parameters":["tools"],"pricing":{"prompt":"0.000001","completion":"0"}},
		{"id":"cohere/north-mini-code:free","name":"Cohere: North Mini Code","context_length":256000,"supported_parameters":["tools"],"pricing":{"prompt":"0","completion":"0"}}
	]}`)
	models, err := normalizeOpenRouterModels(raw)
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	if len(models) != 2 {
		t.Fatalf("models = %d, want 2 free models", len(models))
	}
	if models[0].ContextLength != 1000000 || models[0].SupportsTools == nil || !*models[0].SupportsTools || !models[0].Reasoning {
		t.Fatalf("unexpected first model: %+v", models[0])
	}
	if models[1].ID != "cohere/north-mini-code:free" || models[1].Reasoning {
		t.Fatalf("unexpected second model: %+v", models[1])
	}
}

func TestNormalizeModelPoolRejectsMalformedPayloads(t *testing.T) {
	if _, err := normalizeNVIDIAModels([]byte(`{"data":[`)); err == nil {
		t.Fatal("expected nvidia malformed payload to fail")
	}
	if _, err := normalizeOpenRouterModels([]byte(`{"data":[`)); err == nil {
		t.Fatal("expected openrouter malformed payload to fail")
	}
}

func TestModelPoolCatalogIsCached(t *testing.T) {
	resetModelPoolCacheForTest()
	t.Cleanup(resetModelPoolCacheForTest)

	calls := 0
	previous := modelPoolFetch
	modelPoolFetch = func(_ context.Context) *ModelPoolCatalog {
		calls++
		return &ModelPoolCatalog{
			Sources:  []ModelPoolSource{{ID: "nvidia", Name: "NVIDIA NIM", Status: "ok"}},
			Models:   []ModelPoolModel{{ID: "nvidia/model", Name: "nvidia/model", Free: true}},
			SyncedAt: time.Now().UTC(),
		}
	}
	t.Cleanup(func() { modelPoolFetch = previous })

	h := &Handler{}
	for i := 0; i < 3; i++ {
		res := testutil.Call(t, h.GetModelPoolCatalog, httptest.NewRequest(http.MethodGet, "/api/model-pool/catalog", nil))
		res.Want(http.StatusOK)
	}
	if calls != 1 {
		t.Fatalf("fetch calls = %d, want 1 (cache hit)", calls)
	}
}
