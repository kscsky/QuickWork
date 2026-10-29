package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/kscsky/quickwork/server/internal/service"
	"github.com/kscsky/quickwork/server/internal/util"
	db "github.com/kscsky/quickwork/server/pkg/db/generated"
)

// The workspace knowledge base: a finished relay can be distilled into one
// summary document plus FAQ drafts, and published entries become the memory
// later legs can retrieve.

type KnowledgeEntryResponse struct {
	ID            string          `json:"id"`
	WorkspaceID   string          `json:"workspace_id"`
	SquadID       *string         `json:"squad_id"`
	Kind          string          `json:"kind"`
	Title         string          `json:"title"`
	Body          string          `json:"body"`
	Tags          json.RawMessage `json:"tags"`
	Status        string          `json:"status"`
	SourceIssueID *string         `json:"source_issue_id"`
	SourceLeg     *int32          `json:"source_leg"`
	SourceKind    string          `json:"source_kind"`
	CreatedBy     string          `json:"created_by"`
	PublishedBy   *string         `json:"published_by"`
	PublishedAt   *string         `json:"published_at"`
	UsageCount    int32           `json:"usage_count"`
	CreatedAt     string          `json:"created_at"`
	UpdatedAt     string          `json:"updated_at"`
}

func knowledgeEntryToResponse(row db.KnowledgeEntry) KnowledgeEntryResponse {
	tags := json.RawMessage(row.Tags)
	if len(tags) == 0 {
		tags = json.RawMessage("[]")
	}
	return KnowledgeEntryResponse{
		ID:            uuidToString(row.ID),
		WorkspaceID:   uuidToString(row.WorkspaceID),
		SquadID:       uuidToPtr(row.SquadID),
		Kind:          row.Kind,
		Title:         row.Title,
		Body:          row.Body,
		Tags:          tags,
		Status:        row.Status,
		SourceIssueID: uuidToPtr(row.SourceIssueID),
		SourceLeg:     int4ToPtr(row.SourceLeg),
		SourceKind:    row.SourceKind,
		CreatedBy:     uuidToString(row.CreatedBy),
		PublishedBy:   uuidToPtr(row.PublishedBy),
		PublishedAt:   timestampToPtr(row.PublishedAt),
		UsageCount:    row.UsageCount,
		CreatedAt:     timestampToString(row.CreatedAt),
		UpdatedAt:     timestampToString(row.UpdatedAt),
	}
}

type KnowledgeEmbeddingStatus struct {
	Enabled bool   `json:"enabled"`
	Model   string `json:"model"`
	Dims    int    `json:"dims"`
}

type KnowledgeListResponse struct {
	Entries   []KnowledgeEntryResponse `json:"entries"`
	Stats     map[string]int64         `json:"stats"`
	Embedding KnowledgeEmbeddingStatus `json:"embedding"`
}

func (h *Handler) ListKnowledge(w http.ResponseWriter, r *http.Request) {
	wsID, ok := parseUUIDOrBadRequest(w, ctxWorkspaceID(r.Context()), "workspace id")
	if !ok {
		return
	}
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	kind := strings.TrimSpace(r.URL.Query().Get("kind"))
	limit := int32(100)
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			if parsed > 200 {
				parsed = 200
			}
			limit = int32(parsed)
		}
	}
	entries, err := h.Knowledge.List(r.Context(), wsID, status, kind, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list knowledge")
		return
	}
	stats, err := h.Knowledge.Stats(r.Context(), wsID)
	if err != nil {
		stats = map[string]int64{}
	}
	enabled, model, dims := h.Knowledge.EmbeddingStatus()
	resp := KnowledgeListResponse{
		Entries: make([]KnowledgeEntryResponse, len(entries)),
		Stats:   stats,
		Embedding: KnowledgeEmbeddingStatus{
			Enabled: enabled,
			Model:   model,
			Dims:    dims,
		},
	}
	for i, entry := range entries {
		resp.Entries[i] = knowledgeEntryToResponse(entry)
	}
	writeJSON(w, http.StatusOK, resp)
}

type KnowledgeHitResponse struct {
	Entry KnowledgeEntryResponse `json:"entry"`
	Score float64                `json:"score"`
}

type KnowledgeSearchResponse struct {
	Mode string                 `json:"mode"`
	Hits []KnowledgeHitResponse `json:"hits"`
}

func (h *Handler) SearchKnowledge(w http.ResponseWriter, r *http.Request) {
	wsID, ok := parseUUIDOrBadRequest(w, ctxWorkspaceID(r.Context()), "workspace id")
	if !ok {
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if query == "" {
		writeError(w, http.StatusBadRequest, "q is required")
		return
	}
	limit := int32(5)
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			if parsed > 20 {
				parsed = 20
			}
			limit = int32(parsed)
		}
	}
	result, err := h.Knowledge.Search(r.Context(), wsID, query, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to search knowledge")
		return
	}
	resp := KnowledgeSearchResponse{Mode: result.Mode, Hits: make([]KnowledgeHitResponse, len(result.Hits))}
	for i, hit := range result.Hits {
		resp.Hits[i] = KnowledgeHitResponse{Entry: knowledgeEntryToResponse(hit.Entry), Score: hit.Score}
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) PreviewIssueKnowledge(w http.ResponseWriter, r *http.Request) {
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	preview, err := h.Knowledge.ComposeTaskKnowledge(r.Context(), issue)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrKnowledgeNoChain):
			writeError(w, http.StatusBadRequest, "this task has no relay to distil")
		case errors.Is(err, service.ErrKnowledgeTaskNotDone):
			writeError(w, http.StatusConflict, "finish the relay before distilling it")
		default:
			writeError(w, http.StatusInternalServerError, "failed to compose knowledge")
		}
		return
	}
	writeJSON(w, http.StatusOK, preview)
}

type depositKnowledgeRequest struct {
	Keys    []string `json:"keys"`
	Publish bool     `json:"publish"`
}

func (h *Handler) DepositIssueKnowledge(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	member, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found")
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	actorID, err := util.ParseUUID(userID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "user not authenticated")
		return
	}
	var req depositKnowledgeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Publish && member.Role != "owner" && member.Role != "admin" {
		writeError(w, http.StatusForbidden, "only a workspace owner or admin can publish knowledge directly")
		return
	}
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	entries, err := h.Knowledge.DepositTaskKnowledge(r.Context(), issue, actorID, req.Keys, req.Publish)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrKnowledgeNoChain):
			writeError(w, http.StatusBadRequest, "this task has no relay to distil")
		case errors.Is(err, service.ErrKnowledgeTaskNotDone):
			writeError(w, http.StatusConflict, "finish the relay before distilling it")
		case errors.Is(err, service.ErrKnowledgeEmptySelection):
			writeError(w, http.StatusBadRequest, "select at least one knowledge entry")
		default:
			writeError(w, http.StatusInternalServerError, "failed to store knowledge")
		}
		return
	}
	resp := make([]KnowledgeEntryResponse, len(entries))
	for i, entry := range entries {
		resp[i] = knowledgeEntryToResponse(entry)
	}
	writeJSON(w, http.StatusCreated, resp)
}

func (h *Handler) PublishKnowledgeEntry(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	member, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found")
	if !ok {
		return
	}
	if member.Role != "owner" && member.Role != "admin" {
		writeError(w, http.StatusForbidden, "only a workspace owner or admin can publish knowledge")
		return
	}
	wsID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	entryID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "id")
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	actorID, err := util.ParseUUID(userID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "user not authenticated")
		return
	}
	entry, err := h.Knowledge.Publish(r.Context(), wsID, entryID, actorID)
	if err != nil {
		if errors.Is(err, service.ErrKnowledgeEntryNotFound) {
			writeError(w, http.StatusNotFound, "knowledge entry not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to publish knowledge")
		return
	}
	writeJSON(w, http.StatusOK, knowledgeEntryToResponse(entry))
}

func (h *Handler) ArchiveKnowledgeEntry(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	member, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found")
	if !ok {
		return
	}
	if member.Role != "owner" && member.Role != "admin" {
		writeError(w, http.StatusForbidden, "only a workspace owner or admin can archive knowledge")
		return
	}
	wsID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	entryID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "id")
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	actorID, err := util.ParseUUID(userID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "user not authenticated")
		return
	}
	entry, err := h.Knowledge.Archive(r.Context(), wsID, entryID, actorID)
	if err != nil {
		if errors.Is(err, service.ErrKnowledgeEntryNotFound) {
			writeError(w, http.StatusNotFound, "knowledge entry not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to archive knowledge")
		return
	}
	writeJSON(w, http.StatusOK, knowledgeEntryToResponse(entry))
}

// ReindexKnowledge embeds published entries that have no vector yet. It is the
// recovery path after an embedding provider is configured on an existing
// workspace; without a provider it is a no-op with count 0.
func (h *Handler) ReindexKnowledge(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	member, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found")
	if !ok {
		return
	}
	if member.Role != "owner" && member.Role != "admin" {
		writeError(w, http.StatusForbidden, "only a workspace owner or admin can reindex knowledge")
		return
	}
	wsID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	embedded, err := h.Knowledge.ReembedMissing(r.Context(), wsID, 100)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to reindex knowledge")
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"embedded": embedded})
}
