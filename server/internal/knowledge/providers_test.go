package knowledge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestValidateModelDims(t *testing.T) {
	cases := []struct {
		provider string
		model    string
		dims     int
		ok       bool
	}{
		{"bailian", "text-embedding-v4", 1024, true},
		{"bailian", "text-embedding-v4", 1536, true},
		{"bailian", "text-embedding-v4", 2048, false},
		{"bailian", "text-embedding-v3", 1024, true},
		{"bailian", "text-embedding-v3", 1536, false},
		{"openai", "text-embedding-3-small", 512, true},
		{"openai", "text-embedding-3-large", 1024, true},
		{"openai", "text-embedding-3-large", 3072, false},
		{"custom", "anything", 768, true},
		{"custom", "anything", ColumnDims + 1, false},
		{"unknown", "anything", 1024, false},
	}
	for _, tc := range cases {
		err := ValidateModelDims(tc.provider, tc.model, tc.dims)
		if tc.ok && err != nil {
			t.Errorf("%s/%s/%d rejected: %v", tc.provider, tc.model, tc.dims, err)
		}
		if !tc.ok && err == nil {
			t.Errorf("%s/%s/%d accepted", tc.provider, tc.model, tc.dims)
		}
	}
}

func TestValidateBaseURLBlocksPrivateHosts(t *testing.T) {
	cases := []struct {
		url string
		ok  bool
	}{
		{"https://api.example.com/v1", true},
		{"http://localhost:8081/v1", true},
		{"http://127.0.0.1:8081/v1", true},
		{"http://api.example.com/v1", false},
		{"http://192.168.1.10/v1", false},
		{"http://10.0.0.8/v1", false},
		{"file:///etc/passwd", false},
		{"not a url", false},
	}
	for _, tc := range cases {
		err := ValidateBaseURL(tc.url)
		if tc.ok && err != nil {
			t.Errorf("%q rejected: %v", tc.url, err)
		}
		if !tc.ok && err == nil {
			t.Errorf("%q accepted", tc.url)
		}
	}
}

type fakeProviderServer struct {
	t     *testing.T
	dims  int
	calls int
}

func (f *fakeProviderServer) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/embeddings" {
			http.NotFound(w, r)
			return
		}
		var req embeddingRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			f.t.Errorf("decode: %v", err)
		}
		f.calls++
		data := make([]map[string]any, len(req.Input))
		for i := range req.Input {
			vector := make([]float32, f.dims)
			vector[0] = 1
			data[i] = map[string]any{"embedding": vector, "index": i}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": data})
	})
}

func TestMatchModelsProbesCustomProvider(t *testing.T) {
	fake := &fakeProviderServer{t: t, dims: 512}
	server := httptest.NewServer(fake.handler())
	defer server.Close()

	models, err := MatchModels(context.Background(), ProviderCustom, server.URL, "sk-test", "fake-embed", 512)
	if err != nil {
		t.Fatalf("match: %v", err)
	}
	if len(models) != 1 || models[0].Name != "fake-embed" || models[0].Dims[0] != 512 {
		t.Fatalf("models = %+v", models)
	}
	if fake.calls != 1 {
		t.Fatalf("probe calls = %d, want 1", fake.calls)
	}
}

func TestProbeEmbeddingRejectsDimensionMismatch(t *testing.T) {
	fake := &fakeProviderServer{t: t, dims: 384}
	server := httptest.NewServer(fake.handler())
	defer server.Close()

	err := ProbeEmbedding(context.Background(), server.URL, "sk-test", "fake-embed", 512)
	if err == nil || !strings.Contains(err.Error(), "dimensions") {
		t.Fatalf("error = %v, want a dimension mismatch", err)
	}
}
