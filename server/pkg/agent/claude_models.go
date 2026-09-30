package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Gateway model discovery for the claude runtime.
//
// The claude catalog was static by design: there is no `claude models` CLI
// command to shell out to. But the Claude Code client itself can enumerate
// what its endpoint serves — the bundled Anthropic SDK exposes
// GET {base_url}/v1/models, and gateways/proxies (LiteLLM & co) answer it.
// When the local CLI is pointed at a custom ANTHROPIC_BASE_URL, do that same
// request here so the picker shows the models the CLI can actually run
// instead of a baked-in list that goes stale with the gateway config.

const (
	// claudeModelDiscoveryOffEnv set to "off" restores the pure-static
	// behavior for the whole daemon process.
	claudeModelDiscoveryOffEnv = "QUICKWORK_CLAUDE_MODEL_DISCOVERY"
	claudeOfficialAPIHost      = "api.anthropic.com"
	claudeGatewayProbeTimeout  = 5 * time.Second
	// Cap the response so a misconfigured endpoint pointing at something
	// non-JSON (login HTML, etc.) cannot balloon memory before the parse fails.
	claudeGatewayModelsMaxBody = 4 << 20
)

// discoverClaudeCatalog resolves the model catalog for the claude runtime:
// the first-party static list (with thinking annotations), merged with the
// gateway catalog when the local Claude Code config points at a custom
// ANTHROPIC_BASE_URL.
//
// Never returns an error: when a *custom* gateway is unreachable the static
// list is reported with Fallback=true (the picker stays populated but the
// server must not persist it as authoritative — MUL-5549 contract). When
// there is no custom gateway at all, the static list is the authoritative
// answer, exactly as before this discovery existed.
func discoverClaudeCatalog(ctx context.Context, cmd Command) Catalog {
	static := claudeStaticModels()
	annotateClaudeThinking(ctx, static, cmd)

	if strings.EqualFold(strings.TrimSpace(os.Getenv(claudeModelDiscoveryOffEnv)), "off") {
		return Catalog{Models: static}
	}
	base, token, bearer, ok := claudeGatewayEndpoint()
	if !ok {
		return Catalog{Models: static}
	}
	gateway, err := fetchClaudeGatewayModels(ctx, base, token, bearer)
	if err != nil || len(gateway) == 0 {
		return Catalog{Models: static, Fallback: true}
	}
	return Catalog{Models: badgeClaudeDefault(mergeClaudeModelCatalogs(static, gateway))}
}

// badgeClaudeDefault moves the catalog's display-only Default badge onto the
// model the local Claude Code will actually launch with when an agent leaves
// its model unset — `env.ANTHROPIC_MODEL` from the same settings.json CC
// reads. The badge rides the existing `default` wire field, so the desktop
// can render "what is in effect right now" without any server or schema
// change. Clients switch models via /model, which rewrites that exact env
// key, so the badge tracks CC's switch within one catalog revalidation.
//
// The bracket suffix (`kimi-k2.7-code[1M]`) is a client-side context-window
// hint stripped before matching against gateway IDs. When the configured
// model is not in the fetched catalog at all (a model the gateway lists
// under another name, or a hint-suffixed pin missing from /v1/models), the
// raw value is appended as a badge-carrying entry — it remains launchable
// because CC accepts the string verbatim as --model.
//
// Only the successful gateway-discovery path calls this: on the official
// API or a failed probe the pre-existing static Default marker stays, since
// there the CLI's own resolution is not a user-managed dial.
func badgeClaudeDefault(models []Model) []Model {
	raw, bare, ok := claudeResolvedDefaultModel()
	if !ok {
		return models
	}
	for i := range models {
		models[i].Default = false
		if models[i].ID == bare {
			models[i].Default = true
			return models
		}
	}
	return append(models, Model{ID: raw, Label: raw, Default: true})
}

// claudeResolvedDefaultModel returns the model the local Claude Code
// resolves for unset-model launches: ANTHROPIC_MODEL from process env,
// falling back to the settings.json env block (same source order as the
// gateway endpoint lookup). bare is raw with a trailing "[hint]" suffix
// removed — the identifier a proxy/gateway actually sees.
func claudeResolvedDefaultModel() (raw, bare string, ok bool) {
	v := strings.TrimSpace(os.Getenv("ANTHROPIC_MODEL"))
	if v == "" {
		v = strings.TrimSpace(claudeSettingsEnv()["ANTHROPIC_MODEL"])
	}
	if v == "" {
		return "", "", false
	}
	bare = v
	if i := strings.LastIndex(v, "["); i > 0 && strings.HasSuffix(v, "]") {
		bare = strings.TrimSpace(v[:i])
	}
	return v, bare, bare != ""
}

// claudeGatewayEndpoint resolves the gateway the local CLI talks to,
// mirroring Claude Code's own config precedence: process env first, then
// the `env` block of ~/.claude/settings.json (how users wire CC to a
// proxy). ok=false means "no custom gateway": base unset or the official
// API — /v1/models there either needs an API token the subscription user
// does not have, or duplicates the static catalog.
//
// bearer reports which auth header the token is for: ANTHROPIC_AUTH_TOKEN
// is sent as `Authorization: Bearer`, ANTHROPIC_API_KEY as `x-api-key`
// (same split the Anthropic SDK makes).
func claudeGatewayEndpoint() (base, token string, bearer, ok bool) {
	var settingsEnv map[string]string
	readEnv := func(key string) string {
		if v := strings.TrimSpace(os.Getenv(key)); v != "" {
			return v
		}
		if settingsEnv == nil {
			settingsEnv = claudeSettingsEnv()
		}
		return strings.TrimSpace(settingsEnv[key])
	}

	rawBase := strings.TrimSpace(readEnv("ANTHROPIC_BASE_URL"))
	if rawBase == "" {
		return "", "", false, false
	}
	// settings.json under a Windows shell commonly carries the base with a
	// backslash path separator ("https://gw.example.cn\base"); the WHATWG
	// URL spec Claude Code itself follows normalizes that to "/", so mirror
	// it rather than failing the probe on a typo-shaped-but-intended URL.
	rawBase = strings.ReplaceAll(rawBase, `\`, "/")
	u, err := url.Parse(rawBase)
	if err != nil || u.Host == "" {
		return "", "", false, false
	}
	if strings.EqualFold(u.Hostname(), claudeOfficialAPIHost) {
		return "", "", false, false
	}

	if t := readEnv("ANTHROPIC_AUTH_TOKEN"); t != "" {
		return rawBase, t, true, true
	}
	if t := readEnv("ANTHROPIC_API_KEY"); t != "" {
		return rawBase, t, false, true
	}
	// Custom base with no resolvable token: probe unauthenticated anyway.
	// Many self-hosted proxies serve /v1/models without creds; a 401 just
	// takes the fallback path.
	return rawBase, "", false, true
}

// claudeSettingsEnv returns the `env` block of ~/.claude/settings.json.
// Missing or malformed config is "no extra env", never an error — the
// daemon must not fail model listing over an unrelated config problem.
func claudeSettingsEnv() map[string]string {
	home, err := os.UserHomeDir()
	if err != nil {
		return map[string]string{}
	}
	raw, err := os.ReadFile(filepath.Join(home, ".claude", "settings.json"))
	if err != nil {
		return map[string]string{}
	}
	var settings struct {
		Env map[string]string `json:"env"`
	}
	if json.Unmarshal(raw, &settings) != nil || settings.Env == nil {
		return map[string]string{}
	}
	return settings.Env
}

// fetchClaudeGatewayModels performs the GET {base}/v1/models request the
// Anthropic SDK's models.list() makes against the configured endpoint.
func fetchClaudeGatewayModels(ctx context.Context, base, token string, bearer bool) ([]Model, error) {
	ctx, cancel := context.WithTimeout(ctx, claudeGatewayProbeTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		strings.TrimRight(base, "/")+"/v1/models", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("anthropic-version", "2023-06-01")
	if token != "" {
		if bearer {
			req.Header.Set("Authorization", "Bearer "+token)
		} else {
			req.Header.Set("x-api-key", token)
		}
	}

	client := &http.Client{Timeout: claudeGatewayProbeTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		// Body is diagnostic copy only; the token is never echoed into it.
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		return nil, fmt.Errorf("gateway /v1/models returned %s: %s",
			resp.Status, strings.TrimSpace(string(snippet)))
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, claudeGatewayModelsMaxBody))
	if err != nil {
		return nil, err
	}
	return parseClaudeGatewayModels(body), nil
}

// parseClaudeGatewayModels accepts both wire shapes found in the wild on
// this path: the Anthropic Models API ({data:[{type:"model", id,
// display_name}]}) and the OpenAI-compatible list LiteLLM-style proxies
// return ({data:[{id, owned_by}]}).
func parseClaudeGatewayModels(raw []byte) []Model {
	var payload struct {
		Data []struct {
			ID          string `json:"id"`
			Name        string `json:"name"`
			DisplayName string `json:"display_name"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &payload) != nil {
		return nil
	}
	seen := make(map[string]bool, len(payload.Data))
	models := make([]Model, 0, len(payload.Data))
	for _, entry := range payload.Data {
		id := strings.TrimSpace(entry.ID)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		label := strings.TrimSpace(entry.DisplayName)
		if label == "" {
			label = strings.TrimSpace(entry.Name)
		}
		if label == "" {
			label = id
		}
		models = append(models, Model{ID: id, Label: label})
	}
	return models
}

// mergeClaudeModelCatalogs keeps the first-party static entries in front —
// they carry the thinking annotations and the Default badge — then appends
// gateway models the static list does not already name. Deduping on the
// static side first means a gateway re-serving "claude-opus-5" cannot drop
// its effort catalog.
func mergeClaudeModelCatalogs(static, gateway []Model) []Model {
	merged := append([]Model(nil), static...)
	seen := make(map[string]bool, len(static))
	for _, m := range static {
		seen[m.ID] = true
	}
	for _, m := range gateway {
		if seen[m.ID] {
			continue
		}
		seen[m.ID] = true
		merged = append(merged, m)
	}
	return merged
}
