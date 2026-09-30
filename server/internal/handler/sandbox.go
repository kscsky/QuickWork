package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/kscsky/quickwork/server/internal/middleware"
	db "github.com/kscsky/quickwork/server/pkg/db/generated"
	"github.com/kscsky/quickwork/server/pkg/e2b"
)

// Workspace-level E2B sandbox connection.
//
// This is the configuration half of "run this agent's tasks in a sandbox": it
// stores which E2B deployment a workspace can reach and proves the key works,
// so the execution half (daemon-side) has something trustworthy to read. The
// key is sealed at rest with the dedicated QUICKWORK_SANDBOX_SECRET_KEY box, and
// the response type structurally has no field for it — the two write-only
// precedents are workspace_mcp_api.go (no token field) and agent_env.go (the
// `****` sentinel that lets the settings form round-trip a masked value without
// clobbering the stored secret).

// sandboxAPIKeySentinel in a PUT/Test body means "keep/use the stored key".
// It can never be a real E2B key (those are `e2b_`-prefixed), so there is no
// ambiguity with a genuine value.
const sandboxAPIKeySentinel = "****"

type sandboxConnectionResponse struct {
	Configured bool   `json:"configured"`
	APIURL     string `json:"api_url,omitempty"`
	VerifiedAt string `json:"verified_at,omitempty"`
	UpdatedAt  string `json:"updated_at,omitempty"`
	// Available reports whether this deployment has QUICKWORK_SANDBOX_SECRET_KEY
	// configured. False hides the whole section rather than offering a form
	// that can only answer 503.
	Available bool `json:"available"`
	// CanManage reports whether the caller may write. Non-admins get a
	// read-only view.
	CanManage bool `json:"can_manage"`
}

type sandboxConnectionBody struct {
	APIURL string `json:"api_url"`
	APIKey string `json:"api_key"`
}

// probeSandboxAPI lists the deployment's running sandboxes. It doubles as the
// credential check: E2B answers 200 for a live key and 401 for a dead one, so
// a successful list is the proof this package needs. The count is returned for
// the test endpoint's response, not stored — it is stale the moment it is
// written and the UI can re-probe on demand.
func probeSandboxAPI(ctx context.Context, apiURL, apiKey string) (int, error) {
	boxes, err := e2b.NewClient(apiURL, apiKey).ListSandboxes(ctx)
	if err != nil {
		return 0, err
	}
	return len(boxes), nil
}

// resolveStoredSandboxKey returns the workspace's plaintext key by opening the
// stored envelope. A rotated QUICKWORK_SANDBOX_SECRET_KEY surfaces as an error
// the callers translate to "no usable key" — the recovery is re-saving the
// key, not a 500 loop.
func (h *Handler) resolveStoredSandboxKey(ctx context.Context, wsID string) (string, db.WorkspaceSandboxConnection, error) {
	if h.SandboxSecretBox == nil {
		return "", db.WorkspaceSandboxConnection{}, errors.New("sandbox integration disabled")
	}
	row, err := h.Queries.GetWorkspaceSandboxConnection(ctx, parseUUID(wsID))
	if err != nil {
		return "", db.WorkspaceSandboxConnection{}, err
	}
	sealed, err := base64.StdEncoding.DecodeString(row.ApiKeyEncrypted)
	if err != nil {
		return "", row, fmt.Errorf("stored sandbox key is not valid base64: %w", err)
	}
	key, err := h.SandboxSecretBox.Open(sealed)
	if err != nil {
		return "", row, fmt.Errorf("stored sandbox key unreadable (secret key rotated?): re-save the key")
	}
	return string(key), row, nil
}

func sandboxConnectionRespFrom(row db.WorkspaceSandboxConnection) sandboxConnectionResponse {
	out := sandboxConnectionResponse{
		Configured: true,
		APIURL:     row.ApiUrl,
	}
	if row.VerifiedAt.Valid {
		out.VerifiedAt = row.VerifiedAt.Time.UTC().Format(time.RFC3339)
	}
	if row.UpdatedAt.Valid {
		out.UpdatedAt = row.UpdatedAt.Time.UTC().Format(time.RFC3339)
	}
	return out
}

// GetSandboxConnection returns the workspace's connection WITHOUT the key.
// Member-visible so the settings tab renders its saved state for everyone;
// writing is admin-gated at the router.
func (h *Handler) GetSandboxConnection(w http.ResponseWriter, r *http.Request) {
	wsStr := h.resolveWorkspaceID(r)
	ws, ok := parseUUIDOrBadRequest(w, wsStr, "workspace_id")
	if !ok {
		return
	}
	member, _ := middleware.MemberFromContext(r.Context())
	available := h.SandboxSecretBox != nil
	canManage := roleAllowed(member.Role, "owner", "admin")

	// Deployments without the deployment key report an empty, unwritable
	// connection and nothing else, so the UI hides the section instead of
	// showing a form whose save can only fail.
	if !available {
		writeJSON(w, http.StatusOK, sandboxConnectionResponse{
			Configured: false,
			Available:  false,
			CanManage:  false,
		})
		return
	}

	row, err := h.Queries.GetWorkspaceSandboxConnection(r.Context(), ws)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusOK, sandboxConnectionResponse{
				Configured: false,
				Available:  true,
				CanManage:  canManage,
			})
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load sandbox connection")
		return
	}
	out := sandboxConnectionRespFrom(row)
	out.Available = true
	out.CanManage = canManage
	writeJSON(w, http.StatusOK, out)
}

// PutSandboxConnection saves (or replaces) the workspace's E2B deployment and
// key. The key is probed against the deployment before anything is written, so
// a saved connection is always a working one — except when the body carries the
// `****` sentinel, which keeps the stored secret untouched (re-validating it
// would spend a network round trip to re-learn what save time already proved).
func (h *Handler) PutSandboxConnection(w http.ResponseWriter, r *http.Request) {
	wsStr := h.resolveWorkspaceID(r)
	ws, ok := parseUUIDOrBadRequest(w, wsStr, "workspace_id")
	if !ok {
		return
	}
	if h.SandboxSecretBox == nil {
		writeError(w, http.StatusServiceUnavailable, "sandbox integration not configured on this server (QUICKWORK_SANDBOX_SECRET_KEY)")
		return
	}
	var body sandboxConnectionBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	apiURL, err := e2b.NormalizeAPIURL(body.APIURL)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	var sealedStr string
	if strings.TrimSpace(body.APIKey) == sandboxAPIKeySentinel {
		existing, err := h.Queries.GetWorkspaceSandboxConnection(r.Context(), ws)
		if err != nil {
			writeError(w, http.StatusBadRequest, "no stored sandbox key to keep — submit the real key")
			return
		}
		sealedStr = existing.ApiKeyEncrypted
	} else {
		apiKey := strings.TrimSpace(body.APIKey)
		if apiKey == "" {
			writeError(w, http.StatusBadRequest, "api_key is required")
			return
		}
		if _, probeErr := probeSandboxAPI(r.Context(), apiURL, apiKey); probeErr != nil {
			if errors.Is(probeErr, e2b.ErrUnauthorized) {
				writeError(w, http.StatusBadRequest, "e2b rejected this API key (check it is active and belongs to this deployment)")
				return
			}
			writeError(w, http.StatusBadGateway, probeErr.Error())
			return
		}
		sealed, err := h.SandboxSecretBox.Seal([]byte(apiKey))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to encrypt api key")
			return
		}
		sealedStr = base64.StdEncoding.EncodeToString(sealed)
	}

	row, err := h.Queries.UpsertWorkspaceSandboxConnection(r.Context(), db.UpsertWorkspaceSandboxConnectionParams{
		WorkspaceID:     ws,
		ApiUrl:          apiURL,
		ApiKeyEncrypted: sealedStr,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save sandbox connection")
		return
	}
	out := sandboxConnectionRespFrom(row)
	// Reaching this point proves the deployment key exists (the nil box
	// answered 503 above) and the caller is an admin (router-gated).
	out.Available = true
	out.CanManage = true
	writeJSON(w, http.StatusOK, out)
}

// TestSandboxConnection probes credentials without writing anything. A body
// with the sentinel (or no key at all) tests the STORED key — that is the
// settings form's "test" button after a save.
func (h *Handler) TestSandboxConnection(w http.ResponseWriter, r *http.Request) {
	wsStr := h.resolveWorkspaceID(r)
	if _, ok := parseUUIDOrBadRequest(w, wsStr, "workspace_id"); !ok {
		return
	}
	if h.SandboxSecretBox == nil {
		writeError(w, http.StatusServiceUnavailable, "sandbox integration not configured on this server (QUICKWORK_SANDBOX_SECRET_KEY)")
		return
	}
	var body sandboxConnectionBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	apiURL, apiKey := strings.TrimSpace(body.APIURL), strings.TrimSpace(body.APIKey)
	if apiKey == sandboxAPIKeySentinel || apiKey == "" {
		stored, row, err := h.resolveStoredSandboxKey(r.Context(), wsStr)
		if err != nil {
			writeError(w, http.StatusBadRequest, "no usable stored sandbox key to test")
			return
		}
		apiURL, apiKey = row.ApiUrl, stored
	}
	normURL, err := e2b.NormalizeAPIURL(apiURL)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	count, probeErr := probeSandboxAPI(r.Context(), normURL, apiKey)
	if probeErr != nil {
		if errors.Is(probeErr, e2b.ErrUnauthorized) {
			writeErrorCode(w, http.StatusBadRequest, "sandbox_unauthorized", "e2b rejected this API key")
			return
		}
		writeError(w, http.StatusBadGateway, probeErr.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "sandbox_count": count})
}

// DeleteSandboxConnection drops the workspace's stored connection. Tasks
// already running are unaffected: nothing in the execution path reads this row
// yet.
func (h *Handler) DeleteSandboxConnection(w http.ResponseWriter, r *http.Request) {
	wsStr := h.resolveWorkspaceID(r)
	ws, ok := parseUUIDOrBadRequest(w, wsStr, "workspace_id")
	if !ok {
		return
	}
	if err := h.Queries.DeleteWorkspaceSandboxConnection(r.Context(), ws); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete sandbox connection")
		return
	}
	writeJSON(w, http.StatusOK, sandboxConnectionResponse{
		Configured: false,
		Available:  h.SandboxSecretBox != nil,
		CanManage:  true,
	})
}

// agentSandboxConfig mirrors the object the sandbox settings tab writes into
// agent.sandbox_config. Kept in lockstep with
// packages/core/agents/sandbox-config.ts.
type agentSandboxConfig struct {
	Enabled        bool   `json:"enabled"`
	Template       string `json:"template"`
	TimeoutSeconds int    `json:"timeout_seconds"`
}

type sandboxProbeResponse struct {
	SandboxID          string `json:"sandbox_id"`
	Template           string `json:"template"`
	ResolvedTemplateID string `json:"resolved_template_id"`
	State              string `json:"state"`
	CPUCount           int    `json:"cpu_count"`
	MemoryMB           int    `json:"memory_mb"`
	DiskSizeMB         int    `json:"disk_size_mb"`
	CreateMS           int64  `json:"create_ms"`
	TotalMS            int64  `json:"total_ms"`
}

// TestAgentSandbox boots one sandbox with this agent's configured template and
// timeout, reads its spec, and destroys it — the smallest experiment that
// answers "would this configuration actually work?" without implementing any
// of the execution routing.
//
// It is deliberately NOT a dry run: it spends real sandbox-seconds, because a
// simulator would not catch the failures that matter (a template name that
// does not exist, a key without create rights, a timeout the plan rejects).
// The sandbox is always torn down, including on the error paths, so a probe
// never leaves a billing meter running.
func (h *Handler) TestAgentSandbox(w http.ResponseWriter, r *http.Request) {
	agent, ok := h.loadAgentForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	if !h.canManageAgent(w, r, agent) {
		return
	}
	if h.SandboxSecretBox == nil {
		writeError(w, http.StatusServiceUnavailable, "sandbox integration not configured on this server (QUICKWORK_SANDBOX_SECRET_KEY)")
		return
	}

	// Fail-soft on a malformed config: zero values mean "no template, no
	// timeout", which is exactly what an unconfigured agent means. The tab's
	// parser does the same, so the probe tests what the UI would save.
	var cfg agentSandboxConfig
	if len(agent.SandboxConfig) > 0 {
		_ = json.Unmarshal(agent.SandboxConfig, &cfg)
	}

	apiKey, conn, err := h.resolveStoredSandboxKey(r.Context(), uuidToString(agent.WorkspaceID))
	if err != nil {
		writeError(w, http.StatusBadRequest, "this workspace has no usable E2B account connected — add one in Settings, Integrations, Sandbox")
		return
	}

	client := e2b.NewClient(conn.ApiUrl, apiKey)
	started := time.Now()
	created, err := client.CreateSandbox(r.Context(), cfg.Template, cfg.TimeoutSeconds)
	if err != nil {
		switch {
		case errors.Is(err, e2b.ErrUnauthorized):
			writeErrorCode(w, http.StatusBadRequest, "sandbox_unauthorized", "e2b rejected the stored API key")
		case errors.Is(err, e2b.ErrNotFound):
			writeError(w, http.StatusBadRequest, "e2b does not recognise that template — check the spelling in the agent's sandbox settings")
		default:
			writeError(w, http.StatusBadGateway, err.Error())
		}
		return
	}
	createMS := time.Since(started).Milliseconds()

	// Teardown runs on a fresh context: the request context may already be
	// cancelled by the time a client disconnects, and a sandbox left running
	// bills by the second until its own timeout fires.
	defer func() {
		killCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if killErr := client.KillSandbox(killCtx, created.SandboxID); killErr != nil {
			slog.Warn("sandbox probe: kill failed; the sandbox will expire on its own timeout",
				"error", killErr, "sandbox_id", created.SandboxID)
		}
	}()

	detail, err := client.GetSandbox(r.Context(), created.SandboxID)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, sandboxProbeResponse{
		SandboxID:          detail.SandboxID,
		Template:           detail.Alias,
		ResolvedTemplateID: detail.TemplateID,
		State:              detail.State,
		CPUCount:           detail.CPUCount,
		MemoryMB:           detail.MemoryMB,
		DiskSizeMB:         detail.DiskSizeMB,
		CreateMS:           createMS,
		TotalMS:            time.Since(started).Milliseconds(),
	})
}

// taskSandboxFor returns the sandbox payload for one task, or nil when it
// should run on the daemon.
//
// Every failure here degrades rather than errors: a workspace without a usable
// connection, a rotated deployment key, a malformed config. Failing the claim
// would take a working agent offline over a misconfigured sandbox, and the
// settings UI already tells the user that "enabled" without a connection means
// the daemon. The warning is what makes the degradation visible in the log.
func (h *Handler) taskSandboxFor(ctx context.Context, agent db.Agent) *TaskSandboxData {
	if h.SandboxSecretBox == nil {
		return nil
	}
	var cfg agentSandboxConfig
	if len(agent.SandboxConfig) > 0 {
		if err := json.Unmarshal(agent.SandboxConfig, &cfg); err != nil {
			slog.Warn("sandbox: agent sandbox_config is unreadable; running on the daemon",
				"agent_id", uuidToString(agent.ID), "error", err)
			return nil
		}
	}
	if !cfg.Enabled {
		return nil
	}
	apiKey, conn, err := h.resolveStoredSandboxKey(ctx, uuidToString(agent.WorkspaceID))
	if err != nil {
		slog.Warn("sandbox: enabled but the workspace has no usable E2B connection; running on the daemon",
			"agent_id", uuidToString(agent.ID), "workspace_id", uuidToString(agent.WorkspaceID), "error", err)
		return nil
	}
	return &TaskSandboxData{
		APIURL:         conn.ApiUrl,
		APIKey:         apiKey,
		Template:       cfg.Template,
		TimeoutSeconds: cfg.TimeoutSeconds,
	}
}
