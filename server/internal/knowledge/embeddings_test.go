package knowledge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEmbedderFromEnvIsNilWithoutConfig(t *testing.T) {
	t.Setenv("QUICKWORK_EMBEDDING_BASE_URL", "")
	t.Setenv("QUICKWORK_EMBEDDING_MODEL", "")
	if embedder := EmbedderFromEnv(); embedder != nil {
		t.Fatalf("embedder = %v, want nil without configuration", embedder)
	}
}

func TestOpenAIEmbedderSendsDimensionsForMatryoshkaModels(t *testing.T) {
	var got embeddingRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/embeddings" {
			t.Errorf("path = %q, want /embeddings", r.URL.Path)
		}
		if auth := r.Header.Get("Authorization"); auth != "Bearer test-key" {
			t.Errorf("Authorization = %q", auth)
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Errorf("decode: %v", err)
		}
		vectors := make([][]float32, len(got.Input))
		for i := range got.Input {
			vectors[i] = make([]float32, 1024)
			vectors[i][0] = 1
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{{"embedding": vectors[0], "index": 0}},
		})
	}))
	defer server.Close()

	embedder := &openAIEmbedder{
		baseURL: server.URL,
		apiKey:  "test-key",
		model:   "text-embedding-3-small",
		dims:    1024,
		client:  server.Client(),
	}
	vectors, err := embedder.Embed(context.Background(), []string{"标题怎么写？"})
	if err != nil {
		t.Fatalf("embed: %v", err)
	}
	if len(vectors) != 1 || len(vectors[0]) != 1024 {
		t.Fatalf("vectors = %d × %d, want 1 × 1024", len(vectors), len(vectors[0]))
	}
	if got.Model != "text-embedding-3-small" || got.Dimensions != 1024 {
		t.Fatalf("request = %+v, want model + dimensions 1024", got)
	}
}

func TestOpenAIEmbedderRejectsDimensionMismatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{{"embedding": make([]float32, 384), "index": 0}},
		})
	}))
	defer server.Close()

	embedder := &openAIEmbedder{
		baseURL: server.URL,
		model:   "bge-small",
		dims:    1024,
		client:  server.Client(),
	}
	if _, err := embedder.Embed(context.Background(), []string{"测试"}); err == nil {
		t.Fatal("a 384-dim model was accepted into a 1024-dim column")
	}
}
