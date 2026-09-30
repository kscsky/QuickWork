package agent

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

// discoveryTestCommand returns a Command whose path is unique per test so
// cachedDiscovery memo entries never bleed between tests (the bogus binary
// only degrades the thinking annotation to its static fallback).
func discoveryTestCommand(t *testing.T) Command {
	return Command{Path: filepath.Join("nonexistent-"+t.Name(), "claude")}
}

// isolateClaudeConfigEnv hides the developer's real ~/.claude/settings.json
// and gateway env vars from a test that expects "no gateway configured".
func isolateClaudeConfigEnv(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("USERPROFILE", dir)
	t.Setenv("ANTHROPIC_BASE_URL", "")
	t.Setenv("ANTHROPIC_AUTH_TOKEN", "")
	t.Setenv("ANTHROPIC_API_KEY", "")
	t.Setenv("ANTHROPIC_MODEL", "")
	t.Setenv(claudeModelDiscoveryOffEnv, "")
}

func modelIDsOf(models []Model) map[string]int {
	counts := map[string]int{}
	for _, m := range models {
		counts[m.ID]++
	}
	return counts
}

func gatewayModelServer(t *testing.T, wantAuth string, body string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Errorf("discovery hit %s, want /v1/models", r.URL.Path)
		}
		if wantAuth != "" {
			if got := r.Header.Get(wantAuth); got == "" {
				t.Errorf("request missing auth header %q", wantAuth)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestDiscoverClaudeCatalogMergesGatewayModels(t *testing.T) {
	srv := gatewayModelServer(t, "Authorization", `{"data":[
		{"id":"deepseek-v4-pro"},
		{"id":"claude-opus-5","display_name":"Duplicate First-Party"},
		{"id":"kimi-k3"}
	]}`)
	t.Setenv("ANTHROPIC_BASE_URL", srv.URL)
	t.Setenv("ANTHROPIC_AUTH_TOKEN", "test-token")
	// CC's current dial: bracket hint stripped → deepseek-v4-pro → badge.
	t.Setenv("ANTHROPIC_MODEL", "deepseek-v4-pro[1M]")

	catalog := discoverClaudeCatalog(context.Background(), discoveryTestCommand(t))
	if catalog.Fallback {
		t.Fatal("successful discovery must not be marked fallback")
	}
	ids := modelIDsOf(catalog.Models)
	if ids["deepseek-v4-pro"] != 1 || ids["kimi-k3"] != 1 {
		t.Fatalf("gateway models missing from merged catalog: %+v", ids)
	}
	// First-party entry served by the gateway too: it must appear exactly
	// once and keep the static entry (provider + thinking annotation
	// survived the merge, the display_name copy did not).
	if ids["claude-opus-5"] != 1 {
		t.Fatalf("claude-opus-5 duplicated across static+gateway: %+v", ids)
	}
	for _, m := range catalog.Models {
		if m.ID == "claude-opus-5" {
			if m.Provider != "anthropic" {
				t.Errorf("static entry overwritten in merge: %+v", m)
			}
			if m.Thinking == nil || len(m.Thinking.SupportedLevels) == 0 {
				t.Errorf("static entry lost its thinking annotation in merge: %+v", m)
			}
		}
	}
	// Every static alias must survive the merge.
	for _, s := range claudeStaticModels() {
		if ids[s.ID] == 0 {
			t.Errorf("static model %s dropped by merge", s.ID)
		}
	}
	// The Default badge must move off the static flagship onto the model
	// CC currently resolves to (with the [1M] hint stripped).
	defaults := 0
	for _, m := range catalog.Models {
		if m.Default {
			defaults++
			if m.ID != "deepseek-v4-pro" {
				t.Errorf("Default badge landed on %s, want deepseek-v4-pro", m.ID)
			}
		}
	}
	if defaults != 1 {
		t.Errorf("want exactly one Default entry, got %d", defaults)
	}
}

func TestBadgeClaudeDefaultAppendsUnmatchedModel(t *testing.T) {
	// ANTHROPIC_MODEL names something /v1/models did not list (a hint-suffixed
	// pin, a renamed upstream): append it with the badge instead of losing the
	// "what is in effect" answer. CC accepts the raw string as --model, so the
	// appended entry is also pickable → pinning reproduces current behavior.
	models := []Model{{ID: "claude-sonnet-4-6", Label: "Claude Sonnet 4.6", Default: true}}
	t.Setenv("ANTHROPIC_MODEL", "mystery-model[1M]")
	badged := badgeClaudeDefault(models)
	if len(badged) != 2 {
		t.Fatalf("want appended entry, got %+v", badged)
	}
	if badged[0].Default || badged[1].ID != "mystery-model[1M]" || !badged[1].Default {
		t.Fatalf("badge placement wrong: %+v", badged)
	}
}

func TestBadgeClaudeDefaultNoConfiguredModel(t *testing.T) {
	// No ANTHROPIC_MODEL anywhere (fake HOME hides settings.json): leave the
	// static Default marker untouched.
	isolateClaudeConfigEnv(t)
	models := []Model{{ID: "claude-sonnet-4-6", Label: "Claude Sonnet 4.6", Default: true}}
	badged := badgeClaudeDefault(models)
	if len(badged) != 1 || !badged[0].Default {
		t.Fatalf("unset ANTHROPIC_MODEL must not alter catalog: %+v", badged)
	}
}

func TestDiscoverClaudeCatalogUsesAPIKeyHeader(t *testing.T) {
	var gotAPIKey string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAPIKey = r.Header.Get("x-api-key")
		fmt.Fprint(w, `{"data":[{"id":"glm-5.2"}]}`)
	}))
	t.Cleanup(srv.Close)
	// Fake HOME first: a real ~/.claude/settings.json on the dev machine
	// carries ANTHROPIC_AUTH_TOKEN, and empty process env falls through to
	// it — which would hijack this precedence check.
	isolateClaudeConfigEnv(t)
	t.Setenv("ANTHROPIC_BASE_URL", srv.URL)
	t.Setenv("ANTHROPIC_API_KEY", "sk-test")

	catalog := discoverClaudeCatalog(context.Background(), discoveryTestCommand(t))
	if gotAPIKey != "sk-test" {
		t.Fatalf("x-api-key header = %q, want sk-test", gotAPIKey)
	}
	if catalog.Fallback {
		t.Fatal("discovery unexpectedly fell back")
	}
}

func TestDiscoverClaudeCatalogNormalizesBackslashBase(t *testing.T) {
	// Real-world settings.json value on a Windows shell:
	// "https://gw.example.cn\\base" — WHATWG normalization in CC turns the
	// backslash into "/", discovery must do the same or the probe 404s.
	srv := gatewayModelServer(t, "", `{"data":[{"id":"qwen3.8-max"}]}`)
	t.Setenv("ANTHROPIC_BASE_URL", srv.URL+`\`)
	t.Setenv("ANTHROPIC_AUTH_TOKEN", "tok")

	catalog := discoverClaudeCatalog(context.Background(), discoveryTestCommand(t))
	if catalog.Fallback {
		t.Fatal("backslash base URL must normalize, not fall back")
	}
}

func TestDiscoverClaudeCatalogGatewayFailureFallsBackToStatic(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "upstream exploded", http.StatusBadGateway)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("ANTHROPIC_BASE_URL", srv.URL)
	t.Setenv("ANTHROPIC_AUTH_TOKEN", "tok")

	catalog := discoverClaudeCatalog(context.Background(), discoveryTestCommand(t))
	if !catalog.Fallback {
		t.Fatal("failed gateway probe must report the static stand-in as fallback")
	}
	ids := modelIDsOf(catalog.Models)
	if len(ids) != len(claudeStaticModels()) {
		t.Fatalf("fallback catalog must be exactly the static list, got %+v", ids)
	}
}

func TestDiscoverClaudeCatalogWithoutGatewayIsAuthoritativeStatic(t *testing.T) {
	cases := map[string]string{
		"unset":              "",
		"official host":      "https://api.anthropic.com",
		"official with path": "https://api.anthropic.com/v1",
	}
	for name, base := range cases {
		t.Run(name, func(t *testing.T) {
			isolateClaudeConfigEnv(t)
			if base != "" {
				t.Setenv("ANTHROPIC_BASE_URL", base)
			}
			catalog := discoverClaudeCatalog(context.Background(), discoveryTestCommand(t))
			if catalog.Fallback {
				t.Fatal("no gateway configured: static catalog is authoritative, not fallback")
			}
			if len(catalog.Models) != len(claudeStaticModels()) {
				t.Fatalf("want static list only, got %d models", len(catalog.Models))
			}
		})
	}
}

func TestDiscoverClaudeCatalogKillSwitch(t *testing.T) {
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		fmt.Fprint(w, `{"data":[{"id":"anything"}]}`)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("ANTHROPIC_BASE_URL", srv.URL)
	t.Setenv("ANTHROPIC_AUTH_TOKEN", "tok")
	t.Setenv(claudeModelDiscoveryOffEnv, "off")

	catalog := discoverClaudeCatalog(context.Background(), discoveryTestCommand(t))
	if hits != 0 {
		t.Fatalf("kill switch set to off but discovery hit the gateway %d times", hits)
	}
	if catalog.Fallback || len(catalog.Models) != len(claudeStaticModels()) {
		t.Fatal("kill switch must restore the plain authoritative static catalog")
	}
}

func TestParseClaudeGatewayModels(t *testing.T) {
	// Anthropic wire shape: display_name present.
	anthropic := []byte(`{"data":[{"type":"model","id":"claude-sonnet-4-6","display_name":"Claude Sonnet 4.6"}]}`)
	models := parseClaudeGatewayModels(anthropic)
	if len(models) != 1 || models[0].Label != "Claude Sonnet 4.6" {
		t.Fatalf("anthropic shape parse = %+v", models)
	}
	// OpenAI-compat shape from LiteLLM gateways: bare ids, duplicates, blanks.
	openai := []byte(`{"object":"list","data":[{"id":"deepseek-v4-pro"},{"id":"deepseek-v4-pro"},{"id":"  "},{"id":"kimi-k3"}]}`)
	models = parseClaudeGatewayModels(openai)
	if len(models) != 2 || models[0].ID != "deepseek-v4-pro" || models[0].Label != "deepseek-v4-pro" {
		t.Fatalf("openai shape parse = %+v", models)
	}
	if models[1].ID != "kimi-k3" {
		t.Fatalf("dedupe/blank filtering broke: %+v", models)
	}
	if got := parseClaudeGatewayModels([]byte("<html>login required</html>")); got != nil {
		t.Fatalf("malformed body must parse to nil, got %+v", got)
	}
}

func TestListModelsClaudeUsesDiscovery(t *testing.T) {
	srv := gatewayModelServer(t, "", `{"object":"list","data":[{"id":"deepseek-v4-pro"}]}`)
	t.Setenv("ANTHROPIC_BASE_URL", srv.URL)
	t.Setenv("ANTHROPIC_AUTH_TOKEN", "tok")
	t.Setenv("ANTHROPIC_MODEL", "deepseek-v4-pro")

	catalog, err := ListModels(context.Background(), "claude", discoveryTestCommand(t))
	if err != nil {
		t.Fatalf("ListModels(claude): %v", err)
	}
	ids := modelIDsOf(catalog.Models)
	if ids["deepseek-v4-pro"] != 1 {
		t.Fatalf("gateway model missing from ListModels output: %+v", ids)
	}
	if ids["claude-sonnet-4-6"] != 1 {
		t.Fatal("static default entry must remain in ListModels output")
	}
}
