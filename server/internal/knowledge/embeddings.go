// Package knowledge holds the vector half of the squad knowledge base: the
// embedding-provider contract and one OpenAI-compatible implementation.
//
// The knowledge base is deliberately provider-agnostic. A self-hosted
// deployment can point QUICKWORK_EMBEDDING_BASE_URL at a local server running
// a multilingual model (bge-m3 and multilingual-e5 are the recommended ones
// for Chinese content), while a cloud deployment can use an OpenAI-compatible
// gateway. When nothing is configured the embedder is nil and the product
// falls back to trigram keyword search; knowledge still works, it just does not
// get semantic recall.
package knowledge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// ColumnDims is the physical width of the vector column (migration 478).
// Embeddings shorter than this are zero-padded, which leaves cosine
// similarity unchanged; 1536 stays below the HNSW index limit of 2000.
const (
	ColumnDims = 1536
	MaxDims    = ColumnDims
	// EmbeddingDims is the default width of the legacy environment-level
	// embedder. Workspace profiles choose their own dims.
	EmbeddingDims = 1024
)

// Embedder turns text into normalized vectors. Implementations must return one
// vector per input, in order.
type Embedder interface {
	Model() string
	Dims() int
	Embed(ctx context.Context, texts []string) ([][]float32, error)
}

// EmbeddingConfig is the deployment's embedding settings.
type EmbeddingConfig struct {
	BaseURL string
	APIKey  string
	Model   string
	Dims    int
	Timeout time.Duration
}

// EmbedderFromEnv builds an embedder from QUICKWORK_EMBEDDING_*; it returns
// nil when no base URL or model is configured, which is the "keyword only"
// product state rather than an error.
func EmbedderFromEnv() Embedder {
	baseURL := strings.TrimSpace(os.Getenv("QUICKWORK_EMBEDDING_BASE_URL"))
	model := strings.TrimSpace(os.Getenv("QUICKWORK_EMBEDDING_MODEL"))
	if baseURL == "" || model == "" {
		return nil
	}
	dims := EmbeddingDims
	if raw := strings.TrimSpace(os.Getenv("QUICKWORK_EMBEDDING_DIMS")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 2000 {
			dims = parsed
		}
	}
	timeout := 20 * time.Second
	if raw := strings.TrimSpace(os.Getenv("QUICKWORK_EMBEDDING_TIMEOUT")); raw != "" {
		if parsed, err := time.ParseDuration(raw); err == nil && parsed > 0 {
			timeout = parsed
		}
	}
	return &openAIEmbedder{
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  strings.TrimSpace(os.Getenv("QUICKWORK_EMBEDDING_API_KEY")),
		model:   model,
		dims:    dims,
		client:  &http.Client{Timeout: timeout},
	}
}

type openAIEmbedder struct {
	baseURL string
	apiKey  string
	model   string
	dims    int
	client  *http.Client
}

// NewOpenAIEmbedder builds an embedder from a workspace embedding profile.
func NewOpenAIEmbedder(baseURL, apiKey, model string, dims int) Embedder {
	return &openAIEmbedder{
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  apiKey,
		model:   model,
		dims:    dims,
		client:  &http.Client{Timeout: 20 * time.Second},
	}
}

func (e *openAIEmbedder) Model() string { return e.model }
func (e *openAIEmbedder) Dims() int     { return e.dims }

type embeddingRequest struct {
	Model      string   `json:"model"`
	Input      []string `json:"input"`
	Dimensions int      `json:"dimensions,omitempty"`
}

type embeddingResponse struct {
	Data []struct {
		Embedding []float32 `json:"embedding"`
		Index     int       `json:"index"`
	} `json:"data"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// Embed calls POST {base}/embeddings. The base URL is expected to include the
// API version segment (for example https://api.openai.com/v1), matching the
// convention the LLM layer uses.
func (e *openAIEmbedder) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	if len(texts) == 0 {
		return nil, nil
	}
	withDimensions := supportsDimensions(e.model)
	vectors, err := e.embedOnce(ctx, texts, withDimensions)
	if err != nil && withDimensions && isDimensionsUnsupported(err) {
		// Some OpenAI-compatible gateways (notably LiteLLM's embedding
		// handler) reject `dimensions` even when the target model supports it.
		// Retry once with the model's native width; the length check below
		// still rejects a width that does not match the selected profile.
		retried, retryErr := e.embedOnce(ctx, texts, false)
		if retryErr == nil {
			return retried, nil
		}
		return nil, fmt.Errorf("%v; retrying without the dimensions parameter also failed: %v", err, retryErr)
	}
	return vectors, err
}

func (e *openAIEmbedder) embedOnce(ctx context.Context, texts []string, withDimensions bool) ([][]float32, error) {
	reqBody := embeddingRequest{Model: e.model, Input: texts}
	// Matryoshka models accept an explicit width. Other models are expected to
	// return `dims` natively; a mismatch is rejected below with an actionable
	// error instead of writing a vector the column cannot hold.
	if withDimensions {
		reqBody.Dimensions = e.dims
	}
	payload, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.baseURL+"/embeddings", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if e.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+e.apiKey)
	}
	resp, err := e.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var parsed embeddingResponse
		_ = json.Unmarshal(body, &parsed)
		if parsed.Error != nil && parsed.Error.Message != "" {
			return nil, fmt.Errorf("embedding provider: %s", parsed.Error.Message)
		}
		return nil, fmt.Errorf("embedding provider returned %d", resp.StatusCode)
	}
	var parsed embeddingResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, err
	}
	if len(parsed.Data) != len(texts) {
		return nil, fmt.Errorf("embedding provider returned %d vectors for %d inputs", len(parsed.Data), len(texts))
	}
	vectors := make([][]float32, len(texts))
	for i, item := range parsed.Data {
		index := item.Index
		if index < 0 || index >= len(vectors) {
			index = i
		}
		if len(item.Embedding) != e.dims {
			return nil, fmt.Errorf(
				"embedding model %q returned %d dimensions, but the profile expects %d; pick a dimension the model supports",
				e.model, len(item.Embedding), e.dims,
			)
		}
		vectors[index] = item.Embedding
	}
	return vectors, nil
}

func isDimensionsUnsupported(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "dimensions is not supported") ||
		strings.Contains(message, "unsupportedparams") ||
		strings.Contains(message, "setting dimensions")
}

func supportsDimensions(model string) bool {
	switch {
	case strings.HasPrefix(model, "text-embedding-3"):
		return true
	case strings.HasPrefix(model, "text-embedding-v3"),
		strings.HasPrefix(model, "text-embedding-v4"):
		return true
	case strings.HasPrefix(model, "qwen3-embedding"):
		return true
	default:
		return false
	}
}
