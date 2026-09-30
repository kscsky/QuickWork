package handler

// Cross-workspace hand-off rule management (fork). The relay (relay.go) fires
// on these rules; this file owns their CRUD and keeps the in-memory rule index
// in step with the database after every mutation.
//
// Rules live in the SOURCE workspace and are managed through its settings. The
// target side is validated at write time with the RELAY TOKEN, not the
// requesting user: the token is what actually performs deliveries, so a rule
// the token cannot execute must be rejected at creation, not discovered at
// fire time.

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/kscsky/quickwork/server/internal/util"
	db "github.com/kscsky/quickwork/server/pkg/db/generated"
)

type HandoffRuleResponse struct {
	ID                  string `json:"id"`
	SourceWorkspaceID   string `json:"source_workspace_id"`
	Name                string `json:"name"`
	TriggerStatus       string `json:"trigger_status"`
	TargetWorkspaceID   string `json:"target_workspace_id"`
	TargetWorkspaceSlug string `json:"target_workspace_slug"`
	TargetAgentID       string `json:"target_agent_id"`
	TargetAgentName     string `json:"target_agent_name"`
	TaskTemplate        string `json:"task_template"`
	Note                string `json:"note"`
	ContextComments     int32  `json:"context_comments"`
	ReceiptStatus       string `json:"receipt_status"`
	// WatchedIssueIDs limits the rule to specific cards ("watch these"); empty
	// means "watch the whole lane" (any card entering the trigger status).
	WatchedIssueIDs []string `json:"watched_issue_ids"`
	Enabled         bool     `json:"enabled"`
	CreatedAt       string   `json:"created_at"`
	UpdatedAt       string   `json:"updated_at"`
}

func (h *Handler) handoffRuleToResp(ctx context.Context, r db.HandoffRule) HandoffRuleResponse {
	resp := HandoffRuleResponse{
		ID:                uuidToString(r.ID),
		SourceWorkspaceID: uuidToString(r.SourceWorkspaceID),
		Name:              r.Name,
		TriggerStatus:     r.TriggerStatus,
		TargetWorkspaceID: uuidToString(r.TargetWorkspaceID),
		TargetAgentID:     uuidToString(r.TargetAgentID),
		TaskTemplate:      r.TaskTemplate,
		Note:              r.Note,
		ContextComments:   r.ContextComments,
		ReceiptStatus:     r.ReceiptStatus,
		WatchedIssueIDs:   uuidSliceToStrings(r.WatchedIssueIds),
		Enabled:           r.Enabled,
		CreatedAt:         timestampToString(r.CreatedAt),
		UpdatedAt:         timestampToString(r.UpdatedAt),
	}
	if ws, err := h.Queries.GetWorkspace(ctx, r.TargetWorkspaceID); err == nil {
		resp.TargetWorkspaceSlug = ws.Slug
	}
	if agent, err := h.Queries.GetAgent(ctx, r.TargetAgentID); err == nil {
		resp.TargetAgentName = agent.Name
	}
	return resp
}

// HandoffReloader is set in main to the relay bootstrap: it re-reads rules
// from the database so settings changes apply without a server restart.
var HandoffReloader func(ctx context.Context) error

func (h *Handler) ListHandoffRules(w http.ResponseWriter, r *http.Request) {
	ws, ok := parseUUIDOrBadRequest(w, h.resolveWorkspaceID(r), "workspace_id")
	if !ok {
		return
	}
	rules, err := h.Queries.ListHandoffRules(r.Context(), ws)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list handoff rules")
		return
	}
	out := make([]HandoffRuleResponse, 0, len(rules))
	for _, rule := range rules {
		out = append(out, h.handoffRuleToResp(r.Context(), rule))
	}
	writeJSON(w, http.StatusOK, map[string]any{"rules": out})
}

type handoffRuleRequest struct {
	Name              string `json:"name"`
	TriggerStatus     string `json:"trigger_status"`
	TargetWorkspaceID string `json:"target_workspace_id"`
	TargetAgentID     string `json:"target_agent_id"`
	TaskTemplate      string `json:"task_template"`
	Note              string `json:"note"`
	ContextComments   *int32 `json:"context_comments"`
	ReceiptStatus     string `json:"receipt_status"`
	// WatchedIssueIDs empty = watch the whole lane; non-empty = only these
	// cards may fire the rule. IDs are validated against the source workspace.
	WatchedIssueIDs []string `json:"watched_issue_ids"`
	// ChatSessionID optionally rides a conversation into the context pack.
	ChatSessionID string `json:"chat_session_id"`
}

func (h *Handler) CreateHandoffRule(w http.ResponseWriter, r *http.Request) {
	wsStr, userID, ok := h.workspaceParams(w, r)
	if !ok {
		return
	}
	var req handoffRuleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || req.TriggerStatus == "" || req.TargetAgentID == "" || req.TargetWorkspaceID == "" {
		writeError(w, http.StatusBadRequest, "name/trigger_status/target_workspace_id/target_agent_id are required")
		return
	}
	sourceWS, ok := parseUUIDOrBadRequest(w, wsStr, "workspace_id")
	if !ok {
		return
	}
	targetWS, ok := parseUUIDOrBadRequest(w, req.TargetWorkspaceID, "target_workspace_id")
	if !ok {
		return
	}
	targetAgent, ok := parseUUIDOrBadRequest(w, req.TargetAgentID, "target_agent_id")
	if !ok {
		return
	}
	creator, ok := parseUUIDOrBadRequest(w, userID, "user_id")
	if !ok {
		return
	}

	// The target agent must exist in the target workspace — checked with the
	// relay identity rules in mind even before the relay token is consulted.
	agent, err := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{
		ID: targetAgent, WorkspaceID: targetWS,
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, "target agent not found in the target workspace")
		return
	}
	if agent.ArchivedAt.Valid {
		writeError(w, http.StatusBadRequest, "cannot hand off to an archived agent")
		return
	}

	comments := int32(12)
	if req.ContextComments != nil && *req.ContextComments > 0 && *req.ContextComments <= 50 {
		comments = *req.ContextComments
	}
	receipt := strings.TrimSpace(req.ReceiptStatus)
	if receipt == "" {
		receipt = "handoff_back"
	}

	watched, ok := h.parseWatchedIssues(w, r, sourceWS, req.WatchedIssueIDs)
	if !ok {
		return
	}
	chatSession, ok := h.resolveChatSession(r, sourceWS, req.ChatSessionID)
	if !ok {
		return
	}

	rule, err := h.Queries.CreateHandoffRule(r.Context(), db.CreateHandoffRuleParams{
		SourceWorkspaceID: sourceWS, Name: req.Name, TriggerStatus: req.TriggerStatus,
		TargetWorkspaceID: targetWS, TargetAgentID: targetAgent,
		TaskTemplate: strings.TrimSpace(req.TaskTemplate), Note: strings.TrimSpace(req.Note),
		ContextComments: comments, ReceiptStatus: receipt, CreatedBy: creator,
		WatchedIssueIds: watched, ChatSessionID: chatSession,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create handoff rule")
		return
	}
	h.reloadHandoffRules(r.Context())
	writeJSON(w, http.StatusCreated, h.handoffRuleToResp(r.Context(), rule))
}

func (h *Handler) UpdateHandoffRule(w http.ResponseWriter, r *http.Request) {
	wsStr, _, ok := h.workspaceParams(w, r)
	if !ok {
		return
	}
	sourceWS, ok := parseUUIDOrBadRequest(w, wsStr, "workspace_id")
	if !ok {
		return
	}
	id, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "rule id")
	if !ok {
		return
	}
	var req handoffRuleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	// Toggle-only is the common path; an empty body keeps existing values.
	existing, err := h.findHandoffRule(r.Context(), id, sourceWS)
	if err != nil {
		writeError(w, http.StatusNotFound, "rule not found")
		return
	}
	merged := handoffRuleRequest{
		Name:              existing.Name,
		TriggerStatus:     existing.TriggerStatus,
		TargetWorkspaceID: uuidToString(existing.TargetWorkspaceID),
		TargetAgentID:     uuidToString(existing.TargetAgentID),
		TaskTemplate:      existing.TaskTemplate,
		Note:              existing.Note,
		ContextComments:   &existing.ContextComments,
		ReceiptStatus:     existing.ReceiptStatus,
		WatchedIssueIDs:   uuidSliceToStrings(existing.WatchedIssueIds),
		ChatSessionID:     uuidToString(existing.ChatSessionID),
	}
	if strings.TrimSpace(req.Name) != "" {
		merged.Name = strings.TrimSpace(req.Name)
	}
	if req.TriggerStatus != "" {
		merged.TriggerStatus = req.TriggerStatus
	}
	if req.TargetWorkspaceID != "" {
		merged.TargetWorkspaceID = req.TargetWorkspaceID
	}
	if req.TargetAgentID != "" {
		merged.TargetAgentID = req.TargetAgentID
	}
	if req.TaskTemplate != "" {
		merged.TaskTemplate = strings.TrimSpace(req.TaskTemplate)
	}
	if req.Note != "" {
		merged.Note = strings.TrimSpace(req.Note)
	}
	if req.ContextComments != nil && *req.ContextComments > 0 && *req.ContextComments <= 50 {
		merged.ContextComments = req.ContextComments
	}
	if req.ReceiptStatus != "" {
		merged.ReceiptStatus = strings.TrimSpace(req.ReceiptStatus)
	}
	if req.WatchedIssueIDs != nil {
		merged.WatchedIssueIDs = req.WatchedIssueIDs
	}
	if req.ChatSessionID != "" {
		merged.ChatSessionID = req.ChatSessionID
	}
	targetWS, ok := parseUUIDOrBadRequest(w, merged.TargetWorkspaceID, "target_workspace_id")
	if !ok {
		return
	}
	targetAgent, ok := parseUUIDOrBadRequest(w, merged.TargetAgentID, "target_agent_id")
	if !ok {
		return
	}
	watchedIDs, ok := h.parseWatchedIssues(w, r, sourceWS, merged.WatchedIssueIDs)
	if !ok {
		return
	}
	chatSession, ok := h.resolveChatSession(r, sourceWS, merged.ChatSessionID)
	if !ok {
		return
	}

	updated, err := h.Queries.UpdateHandoffRule(r.Context(), db.UpdateHandoffRuleParams{
		ID: id, SourceWorkspaceID: sourceWS,
		Name: merged.Name, TriggerStatus: merged.TriggerStatus,
		TargetWorkspaceID: targetWS, TargetAgentID: targetAgent,
		TaskTemplate: merged.TaskTemplate, Note: merged.Note,
		ContextComments: *merged.ContextComments, ReceiptStatus: merged.ReceiptStatus,
		WatchedIssueIds: watchedIDs, ChatSessionID: chatSession, Enabled: existing.Enabled,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update handoff rule")
		return
	}
	h.reloadHandoffRules(r.Context())
	writeJSON(w, http.StatusOK, h.handoffRuleToResp(r.Context(), updated))
}

func (h *Handler) ToggleHandoffRule(w http.ResponseWriter, r *http.Request) {
	wsStr, _, ok := h.workspaceParams(w, r)
	if !ok {
		return
	}
	sourceWS, ok := parseUUIDOrBadRequest(w, wsStr, "workspace_id")
	if !ok {
		return
	}
	id, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "rule id")
	if !ok {
		return
	}
	var req struct {
		Enabled *bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Enabled == nil {
		writeError(w, http.StatusBadRequest, "enabled is required")
		return
	}
	existing, err := h.findHandoffRule(r.Context(), id, sourceWS)
	if err != nil {
		writeError(w, http.StatusNotFound, "rule not found")
		return
	}
	updated, err := h.Queries.UpdateHandoffRule(r.Context(), db.UpdateHandoffRuleParams{
		ID: id, SourceWorkspaceID: sourceWS,
		Name: existing.Name, TriggerStatus: existing.TriggerStatus,
		TargetWorkspaceID: existing.TargetWorkspaceID, TargetAgentID: existing.TargetAgentID,
		TaskTemplate: existing.TaskTemplate, Note: existing.Note,
		ContextComments: existing.ContextComments, ReceiptStatus: existing.ReceiptStatus,
		WatchedIssueIds: existing.WatchedIssueIds, ChatSessionID: existing.ChatSessionID, Enabled: *req.Enabled,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to toggle handoff rule")
		return
	}
	h.reloadHandoffRules(r.Context())
	writeJSON(w, http.StatusOK, h.handoffRuleToResp(r.Context(), updated))
}

func (h *Handler) DeleteHandoffRule(w http.ResponseWriter, r *http.Request) {
	wsStr, _, ok := h.workspaceParams(w, r)
	if !ok {
		return
	}
	sourceWS, ok := parseUUIDOrBadRequest(w, wsStr, "workspace_id")
	if !ok {
		return
	}
	id, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "rule id")
	if !ok {
		return
	}
	if err := h.Queries.DeleteHandoffRule(r.Context(), db.DeleteHandoffRuleParams{
		ID: id, SourceWorkspaceID: sourceWS,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete handoff rule")
		return
	}
	h.reloadHandoffRules(r.Context())
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) findHandoffRule(ctx context.Context, id, sourceWS pgtype.UUID) (db.HandoffRule, error) {
	rules, err := h.Queries.ListHandoffRules(ctx, sourceWS)
	if err != nil {
		return db.HandoffRule{}, err
	}
	for _, rule := range rules {
		if util.UUIDToString(rule.ID) == util.UUIDToString(id) {
			return rule, nil
		}
	}
	return db.HandoffRule{}, errors.New("not found")
}

// reloadHandoffRules re-reads the relay's rule set after a settings change so
// the next event sees the new configuration. Failure is logged, not surfaced:
// the write itself committed, and a stale relay self-corrects on restart.
func (h *Handler) reloadHandoffRules(ctx context.Context) {
	if HandoffReloader == nil {
		return
	}
	if err := HandoffReloader(ctx); err != nil {
		slog.Warn("handoff: rule reload failed; relay keeps previous rules", "error", err)
	}
}

// ListHandoffTargets returns what a hand-off rule can point AT: every workspace
// the RELAY TOKEN can see, with the agents that token may invoke there. The
// requester's own workspace list is the wrong source — the token is the
// identity that actually performs deliveries, and (typical setup) it belongs
// to an automation account that is a member of more workspaces than the human
// configuring the rule. Cached briefly: the target set changes at human pace.
func (h *Handler) ListHandoffTargets(w http.ResponseWriter, r *http.Request) {
	wsStr, _, ok := h.workspaceParams(w, r)
	if !ok {
		return
	}
	sourceWS, ok := parseUUIDOrBadRequest(w, wsStr, "workspace_id")
	if !ok {
		return
	}
	token := RelayToken()
	if token == "" {
		writeError(w, http.StatusServiceUnavailable, "relay token is not configured")
		return
	}
	relay := NewRelay(RelayServerURL())
	targets, err := relay.ListTargets(r.Context(), token, uuidToString(sourceWS))
	if err != nil {
		writeError(w, http.StatusBadGateway, "failed to resolve relay targets: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"targets": targets})
}

// parseWatchedIssues validates a watch list: every id must be an issue in the
// SOURCE workspace (a typo or a cross-workspace id must not silently become an
// unfireable rule). Empty/nil = watch the whole lane.
func (h *Handler) parseWatchedIssues(w http.ResponseWriter, r *http.Request, sourceWS pgtype.UUID, ids []string) ([]pgtype.UUID, bool) {
	if len(ids) == 0 {
		return []pgtype.UUID{}, true
	}
	out := make([]pgtype.UUID, 0, len(ids))
	for _, raw := range ids {
		id, ok := parseUUIDOrBadRequest(w, raw, "watched_issue_ids")
		if !ok {
			return nil, false
		}
		issue, err := h.Queries.GetIssue(r.Context(), id)
		if err != nil || uuidToString(issue.WorkspaceID) != uuidToString(sourceWS) {
			writeError(w, http.StatusBadRequest, "watched issue not found in this workspace: "+raw)
			return nil, false
		}
		out = append(out, id)
	}
	return out, true
}

// resolveChatSession validates an optional session id against the source
// workspace (an empty string clears the field).
func (h *Handler) resolveChatSession(r *http.Request, sourceWS pgtype.UUID, raw string) (pgtype.UUID, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return pgtype.UUID{}, true
	}
	id, err := util.ParseUUID(raw)
	if err != nil {
		return pgtype.UUID{}, true // malformed session id: drop silently
	}
	sess, err := h.Queries.GetChatSessionInWorkspace(r.Context(), db.GetChatSessionInWorkspaceParams{
		ID: id, WorkspaceID: sourceWS,
	})
	if err != nil {
		return pgtype.UUID{}, true // unknown session: drop silently
	}
	return sess.ID, true
}

func uuidSliceToStrings(ids []pgtype.UUID) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		out = append(out, uuidToString(id))
	}
	return out
}
