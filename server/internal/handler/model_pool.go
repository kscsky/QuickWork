package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Free-model catalog for the model pool settings surface.
//
// The catalog endpoints are public: neither NVIDIA's API catalog nor
// OpenRouter's model list requires a key, so the server can show what is
// available before the user configures provider credentials. Execution is a
// separate concern — running a model still needs a key and a protocol the
// target harness accepts (Claude Code speaks Anthropic Messages, so OpenAI
// compatible providers need a local gateway).
const (
	modelPoolCatalogTTL  = 10 * time.Minute
	modelPoolFetchBudget = 12 * time.Second
	nvidiaModelsURL      = "https://integrate.api.nvidia.com/v1/models"
	openRouterModelsURL  = "https://openrouter.ai/api/v1/models"
)

type ModelPoolSource struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Kind       string    `json:"kind"`
	ModelCount int       `json:"model_count"`
	FreeCount  int       `json:"free_count"`
	Status     string    `json:"status"`
	Error      string    `json:"error,omitempty"`
	SyncedAt   time.Time `json:"synced_at"`
}

type ModelPoolModel struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Source        string `json:"source"`
	Protocol      string `json:"protocol"`
	ContextLength int    `json:"context_length,omitempty"`
	SupportsTools *bool  `json:"supports_tools,omitempty"`
	Reasoning     bool   `json:"reasoning,omitempty"`
	Free          bool   `json:"free"`
}

type ModelPoolCatalog struct {
	Sources  []ModelPoolSource `json:"sources"`
	Models   []ModelPoolModel  `json:"models"`
	SyncedAt time.Time         `json:"synced_at"`
}

type modelPoolResponse struct {
	mu        sync.Mutex
	catalog   *ModelPoolCatalog
	fetchedAt time.Time
}

var defaultModelPoolCache modelPoolResponse

var modelPoolHTTPClient = &http.Client{Timeout: modelPoolFetchBudget}

// Indirections for tests. Production always uses the defaults.
var modelPoolFetch = fetchModelPoolCatalog

func resetModelPoolCacheForTest() {
	defaultModelPoolCache.mu.Lock()
	defer defaultModelPoolCache.mu.Unlock()
	defaultModelPoolCache.catalog = nil
	defaultModelPoolCache.fetchedAt = time.Time{}
}

func (h *Handler) GetModelPoolCatalog(w http.ResponseWriter, r *http.Request) {
	catalog, err := loadModelPoolCatalog(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, "model pool catalog unavailable")
		return
	}
	writeJSON(w, http.StatusOK, catalog)
}

func loadModelPoolCatalog(ctx context.Context) (*ModelPoolCatalog, error) {
	cache := &defaultModelPoolCache
	cache.mu.Lock()
	defer cache.mu.Unlock()

	if cache.catalog != nil && time.Since(cache.fetchedAt) < modelPoolCatalogTTL {
		return cache.catalog, nil
	}

	catalog := modelPoolFetch(ctx)
	if catalog == nil {
		if cache.catalog != nil {
			return cache.catalog, nil
		}
		return nil, fmt.Errorf("model pool catalog fetch failed")
	}
	cache.catalog = catalog
	cache.fetchedAt = time.Now()
	return catalog, nil
}

func fetchModelPoolCatalog(ctx context.Context) *ModelPoolCatalog {
	ctx, cancel := context.WithTimeout(ctx, modelPoolFetchBudget)
	defer cancel()

	now := time.Now().UTC()
	sources := make([]ModelPoolSource, 0, 2)
	models := make([]ModelPoolModel, 0, 128)

	nvidiaModels, nvidiaErr := fetchModelPoolSource(ctx, nvidiaModelsURL, normalizeNVIDIAModels)
	nvidiaSource := ModelPoolSource{
		ID:       "nvidia",
		Name:     "NVIDIA NIM",
		Kind:     "openai",
		Status:   "ok",
		SyncedAt: now,
	}
	if nvidiaErr != nil {
		nvidiaSource.Status = "error"
		nvidiaSource.Error = nvidiaErr.Error()
	} else {
		nvidiaSource.ModelCount = len(nvidiaModels)
		nvidiaSource.FreeCount = len(nvidiaModels)
		models = append(models, nvidiaModels...)
	}
	sources = append(sources, nvidiaSource)

	openRouterModels, openRouterErr := fetchModelPoolSource(ctx, openRouterModelsURL, normalizeOpenRouterModels)
	openRouterSource := ModelPoolSource{
		ID:       "openrouter",
		Name:     "OpenRouter Free",
		Kind:     "openai",
		Status:   "ok",
		SyncedAt: now,
	}
	if openRouterErr != nil {
		openRouterSource.Status = "error"
		openRouterSource.Error = openRouterErr.Error()
	} else {
		openRouterSource.ModelCount = len(openRouterModels)
		openRouterSource.FreeCount = len(openRouterModels)
		models = append(models, openRouterModels...)
	}
	sources = append(sources, openRouterSource)

	return &ModelPoolCatalog{Sources: sources, Models: models, SyncedAt: now}
}

func fetchModelPoolSource(
	ctx context.Context,
	url string,
	normalize func([]byte) ([]ModelPoolModel, error),
) ([]ModelPoolModel, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := modelPoolHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s returned %s", url, resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	return normalize(body)
}

type nvidiaModelsResponse struct {
	Data []struct {
		ID string `json:"id"`
	} `json:"data"`
}

func normalizeNVIDIAModels(raw []byte) ([]ModelPoolModel, error) {
	var payload nvidiaModelsResponse
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	models := make([]ModelPoolModel, 0, len(payload.Data))
	for _, entry := range payload.Data {
		id := strings.TrimSpace(entry.ID)
		if id == "" {
			continue
		}
		models = append(models, ModelPoolModel{
			ID:       id,
			Name:     id,
			Source:   "nvidia",
			Protocol: "openai",
			Free:     true,
		})
	}
	return models, nil
}

type openRouterModelsResponse struct {
	Data []struct {
		ID                  string   `json:"id"`
		Name                string   `json:"name"`
		ContextLength       int      `json:"context_length"`
		SupportedParameters []string `json:"supported_parameters"`
		Pricing             struct {
			Prompt     string `json:"prompt"`
			Completion string `json:"completion"`
		} `json:"pricing"`
	} `json:"data"`
}

func normalizeOpenRouterModels(raw []byte) ([]ModelPoolModel, error) {
	var payload openRouterModelsResponse
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	models := make([]ModelPoolModel, 0, len(payload.Data))
	for _, entry := range payload.Data {
		id := strings.TrimSpace(entry.ID)
		if id == "" {
			continue
		}
		if !isZeroPrice(entry.Pricing.Prompt) || !isZeroPrice(entry.Pricing.Completion) {
			continue
		}
		tools := modelPoolContains(entry.SupportedParameters, "tools")
		name := strings.TrimSpace(entry.Name)
		if name == "" {
			name = id
		}
		models = append(models, ModelPoolModel{
			ID:            id,
			Name:          name,
			Source:        "openrouter",
			Protocol:      "openai",
			ContextLength: entry.ContextLength,
			SupportsTools: &tools,
			Reasoning:     modelPoolContains(entry.SupportedParameters, "reasoning"),
			Free:          true,
		})
	}
	return models, nil
}

func isZeroPrice(raw string) bool {
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	return err == nil && value == 0
}

func modelPoolContains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
