package knowledge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestOpenAIEmbedderRetriesWithoutDimensionsForProxy(t *testing.T) {
	var requests []embeddingRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req embeddingRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Errorf("decode: %v", err)
		}
		requests = append(requests, req)
		if req.Dimensions != 0 {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error": map[string]string{
					"message": "litellm.UnsupportedParamsError: Setting dimensions is not supported for OpenAI `text-embedding-3` and later models. To drop it from the call, set `litellm.drop_params = True`.",
				},
			})
			return
		}
		vector := make([]float32, 1024)
		vector[0] = 1
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{{"embedding": vector, "index": 0}},
		})
	}))
	defer server.Close()

	embedder := &openAIEmbedder{
		baseURL: server.URL,
		model:   "text-embedding-v4",
		dims:    1024,
		client:  server.Client(),
	}
	vectors, err := embedder.Embed(context.Background(), []string{"测试"})
	if err != nil {
		t.Fatalf("embed: %v", err)
	}
	if len(vectors) != 1 || len(vectors[0]) != 1024 {
		t.Fatalf("vectors = %d × %d", len(vectors), len(vectors[0]))
	}
	if len(requests) != 2 {
		t.Fatalf("requests = %d, want a dimensions request and a retry", len(requests))
	}
	if requests[0].Dimensions != 1024 || requests[1].Dimensions != 0 {
		t.Fatalf("dimensions sequence = %d, %d", requests[0].Dimensions, requests[1].Dimensions)
	}
}

func TestOpenAIEmbedderReportsNativeWidthWhenProxyRejectsDimensions(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req embeddingRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req.Dimensions != 0 {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error": map[string]string{"message": "Setting dimensions is not supported"},
			})
			return
		}
		vector := make([]float32, 1536)
		vector[0] = 1
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{{"embedding": vector, "index": 0}},
		})
	}))
	defer server.Close()

	embedder := &openAIEmbedder{
		baseURL: server.URL,
		model:   "text-embedding-v4",
		dims:    1024,
		client:  server.Client(),
	}
	_, err := embedder.Embed(context.Background(), []string{"测试"})
	if err == nil {
		t.Fatal("a native 1536-dimensional vector was accepted for a 1024-dimensional profile")
	}
	if !strings.Contains(err.Error(), "returned 1536 dimensions") {
		t.Fatalf("error = %v, want the native width mismatch", err)
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
