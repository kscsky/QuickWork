// Package e2b is a minimal REST client for the E2B sandbox API.
//
// Only what the settings-connection probe needs is implemented here. The
// execution path — creating sandboxes, streaming command output, shipping the
// prepared workdir in and the agent's commits back out — is deliberately absent
// until the daemon-side integration lands; this package exists so the
// connection can be configured and verified before any of that is written.
//
// E2B serves plain JSON over HTTPS, so no SDK is required, but two details are
// easy to get wrong and each costs an afternoon:
//
//   - The API host is api.e2b.app, NOT api.e2b.dev. The .dev host answers 401
//     for a perfectly valid key rather than 404, so a wrong host is
//     indistinguishable from a bad key until you diff the resolved URL.
//   - Authentication is the `x-api-key` header. The generated SDK client
//     *declares* Authorization: Bearer (a codegen default) and overrides it at
//     call time; sending Bearer to the real API returns 401.
package e2b

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// DefaultAPIURL is the public E2B cloud endpoint. Self-hosted and BYOC
// deployments point elsewhere, which is why the URL is configurable.
const DefaultAPIURL = "https://api.e2b.app"

// ErrUnauthorized means E2B rejected the API key. Callers translate it to a
// user-facing "check your key" rather than a 502.
var ErrUnauthorized = errors.New("e2b rejected the api key")

// requestTimeout bounds a single probe. The API answers in well under a second
// when reachable; anything slower is a network problem worth reporting.
const requestTimeout = 8 * time.Second

// maxResponseBytes caps how much of a response we will read. Every endpoint in
// use returns a small JSON document.
const maxResponseBytes = 1 << 20

// Client talks to one E2B deployment with one API key.
type Client struct {
	apiURL  string
	apiKey  string
	envdURL string
	http    *http.Client
	stream  *http.Client
}

// streamClient returns a client with no overall timeout, for calls that stay
// open for the length of a run (envd command streams). The per-request
// context is the only bound that should apply there; a client timeout would
// guillotine a long agent run at an arbitrary point.
func (c *Client) streamClient() *http.Client {
	if c.stream != nil {
		return c.stream
	}
	return c.http
}

// NewClient builds a client against apiURL, defaulting to the public cloud when
// apiURL is empty. API keys are not validated here — the first call is what
// decides whether they work.
func NewClient(apiURL, apiKey string) *Client {
	if strings.TrimSpace(apiURL) == "" {
		apiURL = DefaultAPIURL
	}
	return &Client{
		apiURL: strings.TrimRight(apiURL, "/"),
		apiKey: apiKey,
		http:   &http.Client{Timeout: requestTimeout},
		// Long-lived streams get their own client: see streamClient.
		stream: &http.Client{},
	}
}

// NormalizeAPIURL validates a user-supplied API base: absolute http(s) only,
// no trailing slash (we append the path ourselves).
func NormalizeAPIURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return DefaultAPIURL, nil
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", errors.New("api_url is not a valid URL")
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return "", errors.New("api_url must be http(s)")
	}
	if u.Host == "" {
		return "", errors.New("api_url must include a host")
	}
	return strings.TrimRight(raw, "/"), nil
}

// Sandbox is the subset of E2B's listed-sandbox payload this package needs.
// Field names mirror the API (snake_case), which is what the SDK is generated
// from.
type Sandbox struct {
	SandboxID  string `json:"sandbox_id"`
	TemplateID string `json:"template_id"`
	State      string `json:"state"`
	CPUCount   int    `json:"cpu_count"`
	MemoryMB   int    `json:"memory_mb"`
	StartedAt  string `json:"started_at"`
	EndAt      string `json:"end_at"`
}

// SandboxDetail is the single-sandbox payload from GET /sandboxes/{id}. Note
// the camelCase keys — this endpoint does not match the list endpoint's
// snake_case, which is exactly the kind of drift that costs an hour if you
// assume the two share a shape.
//
// Alias is the template the caller asked for ("claude"); TemplateID is what it
// resolved to on E2B's side. Both are reported back by the settings probe so a
// typo'd template name is visible rather than silently ignored.
type SandboxDetail struct {
	SandboxID  string `json:"sandboxID"`
	TemplateID string `json:"templateID"`
	Alias      string `json:"alias"`
	State      string `json:"state"`
	CPUCount   int    `json:"cpuCount"`
	MemoryMB   int    `json:"memoryMB"`
	DiskSizeMB int    `json:"diskSizeMB"`
	StartedAt  string `json:"startedAt"`
	EndAt      string `json:"endAt"`
	// AccessToken is the per-sandbox credential every envd call needs
	// (SandboxConn.AccessToken). Present on both create and get responses; it
	// is not the account API key and expires with the sandbox.
	AccessToken string `json:"envdAccessToken"`
}

// CreateSandbox boots one sandbox from template and returns its resolved
// detail. A blank template asks E2B for the deployment default by omitting the
// field, which is what an agent with no template configured should get.
//
// timeoutSeconds is the sandbox's maximum continuous runtime. Zero omits the
// field so E2B applies its own default rather than us inventing one.
func (c *Client) CreateSandbox(ctx context.Context, template string, timeoutSeconds int) (SandboxDetail, error) {
	body := map[string]any{"metadata": map[string]any{}, "envVars": map[string]any{}}
	if strings.TrimSpace(template) != "" {
		body["templateID"] = strings.TrimSpace(template)
	}
	if timeoutSeconds > 0 {
		body["timeout"] = timeoutSeconds
	}
	raw, err := c.doJSON(ctx, http.MethodPost, "/v2/sandboxes", body)
	if err != nil {
		return SandboxDetail{}, err
	}
	var out SandboxDetail
	if err := json.Unmarshal(raw, &out); err != nil {
		return SandboxDetail{}, errors.New("e2b returned unreadable JSON for the new sandbox")
	}
	if out.SandboxID == "" {
		return SandboxDetail{}, errors.New("e2b created a sandbox without an id")
	}
	return out, nil
}

// GetSandbox reads one sandbox's current detail — the spec it booted with and
// whether it is still running. This is where cpuCount/memoryMB come from; the
// create response does not carry them.
func (c *Client) GetSandbox(ctx context.Context, sandboxID string) (SandboxDetail, error) {
	raw, err := c.doJSON(ctx, http.MethodGet, "/sandboxes/"+url.PathEscape(sandboxID), nil)
	if err != nil {
		return SandboxDetail{}, err
	}
	var out SandboxDetail
	if err := json.Unmarshal(raw, &out); err != nil {
		return SandboxDetail{}, errors.New("e2b returned unreadable JSON for the sandbox")
	}
	return out, nil
}

// ErrNotFound means the sandbox does not exist (or already expired). Callers
// treating teardown as best-effort should ignore it.
var ErrNotFound = errors.New("e2b does not know that sandbox")

// KillSandbox destroys a sandbox. Killing one that is already gone is not an
// error the caller has to care about — see ErrNotFound.
func (c *Client) KillSandbox(ctx context.Context, sandboxID string) error {
	_, err := c.doJSON(ctx, http.MethodDelete, "/sandboxes/"+url.PathEscape(sandboxID), nil)
	return err
}

// doJSON issues one authenticated request and returns the raw response body.
// It centralises the auth header, error classification and body cap so the
// three callers above stay three lines each.
func (c *Client) doJSON(ctx context.Context, method, path string, body any) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()

	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.apiURL+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-api-key", c.apiKey)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("e2b unreachable: %w", err)
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		return nil, ErrUnauthorized
	case resp.StatusCode == http.StatusNotFound:
		return nil, ErrNotFound
	case resp.StatusCode < 200 || resp.StatusCode > 299:
		return nil, fmt.Errorf("e2b returned %s", resp.Status)
	}

	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return nil, err
	}
	return raw, nil
}

// ListSandboxes returns the running sandboxes visible to this key. It doubles
// as the credential probe: a 200 proves the key is live and the deployment is
// reachable, and the count is what the settings page shows back to the user.
func (c *Client) ListSandboxes(ctx context.Context) ([]Sandbox, error) {
	raw, err := c.doJSON(ctx, http.MethodGet, "/v2/sandboxes", nil)
	if err != nil {
		return nil, err
	}
	var out []Sandbox
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, errors.New("e2b returned unreadable JSON")
	}
	return out, nil
}
