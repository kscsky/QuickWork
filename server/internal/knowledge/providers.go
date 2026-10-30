package knowledge

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"strings"
)

// EmbeddingModel is one embedding-capable model and the dimensions it can
// produce. Dimensions above the physical column (1536) are intentionally not
// offered: pgvector's HNSW index accepts at most 2000 dimensions and 1536
// covers every supported provider at full quality.
type EmbeddingModel struct {
	Name        string `json:"name"`
	Dims        []int  `json:"dims"`
	Recommended bool   `json:"recommended,omitempty"`
}

type ProviderPreset struct {
	Key     string           `json:"key"`
	Label   string           `json:"label"`
	BaseURL string           `json:"base_url"`
	Models  []EmbeddingModel `json:"models"`
}

var Providers = []ProviderPreset{
	{
		Key:     "bailian",
		Label:   "阿里百炼",
		BaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
		Models: []EmbeddingModel{
			{Name: "text-embedding-v4", Dims: []int{1536, 1024, 768, 512}, Recommended: true},
			{Name: "text-embedding-v3", Dims: []int{1024, 768, 512}},
		},
	},
	{
		Key:     "openai",
		Label:   "OpenAI",
		BaseURL: "https://api.openai.com/v1",
		Models: []EmbeddingModel{
			{Name: "text-embedding-3-small", Dims: []int{1536, 1024, 512}, Recommended: true},
			{Name: "text-embedding-3-large", Dims: []int{1536, 1024, 512}},
		},
	},
}

const ProviderCustom = "custom"

func ProviderByKey(key string) (ProviderPreset, bool) {
	for _, preset := range Providers {
		if preset.Key == key {
			return preset, true
		}
	}
	return ProviderPreset{}, false
}

// ResolveProvider returns the provider's base URL. Presets are fixed; custom
// providers must supply an allowlisted HTTPS endpoint.
func ResolveProvider(provider, customBaseURL string) (string, error) {
	provider = strings.TrimSpace(provider)
	if provider == ProviderCustom {
		base := strings.TrimRight(strings.TrimSpace(customBaseURL), "/")
		if base == "" {
			return "", fmt.Errorf("a custom provider needs a base URL")
		}
		if err := ValidateBaseURL(base); err != nil {
			return "", err
		}
		return base, nil
	}
	preset, ok := ProviderByKey(provider)
	if !ok {
		return "", fmt.Errorf("unknown embedding provider %q", provider)
	}
	return preset.BaseURL, nil
}

func ValidateModelDims(provider, model string, dims int) error {
	if dims <= 0 || dims > MaxDims {
		return fmt.Errorf("dimensions must be between 1 and %d", MaxDims)
	}
	provider = strings.TrimSpace(provider)
	model = strings.TrimSpace(model)
	if model == "" {
		return fmt.Errorf("model is required")
	}
	if provider == ProviderCustom {
		return nil
	}
	preset, ok := ProviderByKey(provider)
	if !ok {
		return fmt.Errorf("unknown embedding provider %q", provider)
	}
	for _, candidate := range preset.Models {
		if candidate.Name != model {
			continue
		}
		for _, allowed := range candidate.Dims {
			if dims == allowed {
				return nil
			}
		}
		return fmt.Errorf("%s does not support %d dimensions", model, dims)
	}
	return fmt.Errorf("model %q is not an embedding model for %s", model, preset.Label)
}

// ValidateBaseURL rejects schemes and literal private hosts that would turn a
// workspace-configured base URL into an SSRF primitive. Hostnames are allowed
// because resolving and pinning DNS is a deployment concern; loopback HTTP is
// allowed so local providers can be tested.
func ValidateBaseURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return fmt.Errorf("invalid base URL")
	}
	switch parsed.Scheme {
	case "https":
	case "http":
		if !isLoopbackHost(parsed.Hostname()) {
			return fmt.Errorf("http is only allowed for localhost; use https")
		}
	default:
		return fmt.Errorf("base URL must use http or https")
	}
	if host := parsed.Hostname(); net.ParseIP(host) != nil {
		ip := net.ParseIP(host)
		if ip.IsLoopback() && parsed.Scheme == "http" {
			return nil
		}
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() {
			return fmt.Errorf("base URL must not target a private address")
		}
	}
	return nil
}

func isLoopbackHost(host string) bool {
	host = strings.ToLower(host)
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// MatchModels verifies the provider key with a cheap probe and returns the
// embedding models the UI can pick from. Custom providers return the single
// model the caller described.
func MatchModels(ctx context.Context, provider, customBaseURL, apiKey, model string, dims int) ([]EmbeddingModel, error) {
	provider = strings.TrimSpace(provider)
	baseURL, err := ResolveProvider(provider, customBaseURL)
	if err != nil {
		return nil, err
	}
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return nil, fmt.Errorf("API key is required")
	}
	if provider == ProviderCustom {
		if err := ValidateModelDims(provider, model, dims); err != nil {
			return nil, err
		}
		if err := ProbeEmbedding(ctx, baseURL, apiKey, model, dims); err != nil {
			return nil, err
		}
		return []EmbeddingModel{{Name: model, Dims: []int{dims}, Recommended: true}}, nil
	}
	preset, _ := ProviderByKey(provider)
	probe := preset.Models[0]
	if err := ProbeEmbedding(ctx, baseURL, apiKey, probe.Name, probe.Dims[0]); err != nil {
		return nil, err
	}
	return preset.Models, nil
}

func ProbeEmbedding(ctx context.Context, baseURL, apiKey, model string, dims int) error {
	if err := ValidateModelDims(ProviderCustom, model, dims); err != nil {
		return err
	}
	embedder := NewOpenAIEmbedder(baseURL, apiKey, model, dims)
	if _, err := embedder.Embed(ctx, []string{"ping"}); err != nil {
		return err
	}
	return nil
}
