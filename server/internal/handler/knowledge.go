package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/kscsky/quickwork/server/internal/knowledge"
	"github.com/kscsky/quickwork/server/internal/service"
	"github.com/kscsky/quickwork/server/internal/util"
	db "github.com/kscsky/quickwork/server/pkg/db/generated"
)

// The workspace knowledge base: a finished relay can be distilled into one
// summary document plus FAQ drafts, and published entries become the memory
// later legs can retrieve.

type KnowledgeEntryResponse struct {
	ID                 string          `json:"id"`
	WorkspaceID        string          `json:"workspace_id"`
	SquadID            *string         `json:"squad_id"`
	Kind               string          `json:"kind"`
	Title              string          `json:"title"`
	Body               string          `json:"body"`
	Tags               json.RawMessage `json:"tags"`
	Status             string          `json:"status"`
	SourceIssueID      *string         `json:"source_issue_id"`
	SourceLeg          *int32          `json:"source_leg"`
	SourceKind         string          `json:"source_kind"`
	CreatedBy          string          `json:"created_by"`
	PublishedBy        *string         `json:"published_by"`
	PublishedAt        *string         `json:"published_at"`
	UsageCount         int32           `json:"usage_count"`
	CreatedAt          string          `json:"created_at"`
	UpdatedAt          string          `json:"updated_at"`
	EmbeddingProfileID *string         `json:"embedding_profile_id"`
	EmbeddingModel     string          `json:"embedding_model"`
	EmbeddingDims      *int32          `json:"embedding_dims"`
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

func knowledgeEntryRecordToResponse(record service.KnowledgeEntryRecord) KnowledgeEntryResponse {
	resp := knowledgeEntryToResponse(record.Entry)
	if record.Stamp != nil {
		resp.EmbeddingProfileID = uuidToPtr(record.Stamp.ProfileID)
		resp.EmbeddingModel = record.Stamp.Model
		dims := record.Stamp.Dims
		resp.EmbeddingDims = &dims
	}
	return resp
}

type KnowledgeEmbeddingStatus struct {
	Enabled   bool   `json:"enabled"`
	ProfileID string `json:"profile_id"`
	Provider  string `json:"provider"`
	Model     string `json:"model"`
	Dims      int    `json:"dims"`
}

type EmbeddingProfileResponse struct {
	ID        string `json:"id"`
	Provider  string `json:"provider"`
	BaseURL   string `json:"base_url"`
	Model     string `json:"model"`
	Dims      int32  `json:"dims"`
	KeyHint   string `json:"key_hint"`
	Status    string `json:"status"`
	LastError string `json:"last_error"`
	IsActive  bool   `json:"is_active"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

func embeddingProfileToResponse(row db.WorkspaceEmbeddingProfile) EmbeddingProfileResponse {
	return EmbeddingProfileResponse{
		ID:        uuidToString(row.ID),
		Provider:  row.Provider,
		BaseURL:   row.BaseUrl,
		Model:     row.Model,
		Dims:      row.Dims,
		KeyHint:   row.KeyHint,
		Status:    row.Status,
		LastError: row.LastError,
		IsActive:  row.IsActive,
		CreatedAt: timestampToString(row.CreatedAt),
		UpdatedAt: timestampToString(row.UpdatedAt),
	}
}

type KnowledgeListResponse struct {
	Entries   []KnowledgeEntryResponse   `json:"entries"`
	Stats     map[string]int64           `json:"stats"`
	Embedding KnowledgeEmbeddingStatus   `json:"embedding"`
	Profiles  []EmbeddingProfileResponse `json:"profiles"`
	Corpora   []service.KnowledgeCorpus  `json:"corpora"`
	Unindexed int64                      `json:"unindexed"`
}

func (h *Handler) ListKnowledge(w http.ResponseWriter, r *http.Request) {
	wsID, ok := parseUUIDOrBadRequest(w, ctxWorkspaceID(r.Context()), "workspace id")
	if !ok {
		return
	}
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	kind := strings.TrimSpace(r.URL.Query().Get("kind"))
	dimsFilter := int32(0)
	switch raw := strings.TrimSpace(r.URL.Query().Get("dims")); raw {
	case "":
	case "unindexed":
		dimsFilter = -1
	default:
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			writeError(w, http.StatusBadRequest, "dims must be a positive number or 'unindexed'")
			return
		}
		dimsFilter = int32(parsed)
	}
	var profileID pgtype.UUID
	if raw := strings.TrimSpace(r.URL.Query().Get("profile_id")); raw != "" {
		parsed, err := util.ParseUUID(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid embedding profile id")
			return
		}
		profileID = parsed
	}
	limit := int32(100)
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			if parsed > 200 {
				parsed = 200
			}
			limit = int32(parsed)
		}
	}
	entries, err := h.Knowledge.List(r.Context(), wsID, status, kind, profileID, dimsFilter, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list knowledge")
		return
	}
	stats, err := h.Knowledge.Stats(r.Context(), wsID)
	if err != nil {
		stats = map[string]int64{}
	}
	statusInfo := h.Knowledge.EmbeddingStatus(r.Context(), wsID)
	resp := KnowledgeListResponse{
		Entries: make([]KnowledgeEntryResponse, len(entries)),
		Stats:   stats,
		Embedding: KnowledgeEmbeddingStatus{
			Enabled:   statusInfo.Enabled,
			ProfileID: statusInfo.ProfileID,
			Provider:  statusInfo.Provider,
			Model:     statusInfo.Model,
			Dims:      statusInfo.Dims,
		},
		Profiles: []EmbeddingProfileResponse{},
		Corpora:  []service.KnowledgeCorpus{},
	}
	for i, entry := range entries {
		resp.Entries[i] = knowledgeEntryRecordToResponse(entry)
	}
	if h.Knowledge.Profiles != nil {
		if profiles, err := h.Knowledge.Profiles.List(r.Context(), wsID); err == nil {
			resp.Profiles = make([]EmbeddingProfileResponse, len(profiles))
			for i, profile := range profiles {
				resp.Profiles[i] = embeddingProfileToResponse(profile)
			}
		}
		if corpora, unindexed, err := h.Knowledge.Profiles.Corpora(r.Context(), wsID); err == nil {
			resp.Corpora = corpora
			resp.Unindexed = unindexed
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

type KnowledgeHitResponse struct {
	Entry KnowledgeEntryResponse `json:"entry"`
	Score float64                `json:"score"`
}

type KnowledgeSearchResponse struct {
	Mode    string                       `json:"mode"`
	Profile *service.KnowledgeProfileRef `json:"profile"`
	Hits    []KnowledgeHitResponse       `json:"hits"`
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
	var profileID pgtype.UUID
	if raw := strings.TrimSpace(r.URL.Query().Get("profile_id")); raw != "" {
		parsed, err := util.ParseUUID(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid profile id")
			return
		}
		profileID = parsed
	}
	result, err := h.Knowledge.Search(r.Context(), wsID, query, limit, profileID)
	if err != nil {
		if errors.Is(err, service.ErrEmbeddingProfileNotFound) {
			writeError(w, http.StatusNotFound, "embedding profile not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to search knowledge")
		return
	}
	resp := KnowledgeSearchResponse{
		Mode:    result.Mode,
		Profile: result.Profile,
		Hits:    make([]KnowledgeHitResponse, len(result.Hits)),
	}
	for i, hit := range result.Hits {
		resp.Hits[i] = KnowledgeHitResponse{Entry: knowledgeEntryRecordToResponse(hit.Entry), Score: hit.Score}
	}
	writeJSON(w, http.StatusOK, resp)
}

type IssueKnowledgeStatusResponse struct {
	Deposited bool  `json:"deposited"`
	Entries   int64 `json:"entries"`
}

func (h *Handler) IssueKnowledgeStatus(w http.ResponseWriter, r *http.Request) {
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	count, err := h.Queries.CountKnowledgeEntriesBySourceIssue(r.Context(), db.CountKnowledgeEntriesBySourceIssueParams{
		WorkspaceID:   issue.WorkspaceID,
		SourceIssueID: issue.ID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read knowledge status")
		return
	}
	writeJSON(w, http.StatusOK, IssueKnowledgeStatusResponse{
		Deposited: count > 0,
		Entries:   count,
	})
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
			writeError(w, http.StatusConflict, "finish the task before distilling it")
		default:
			writeError(w, http.StatusInternalServerError, "failed to compose knowledge")
		}
		return
	}
	writeJSON(w, http.StatusOK, preview)
}

type depositKnowledgeRequest struct {
	Keys      []string `json:"keys"`
	Publish   bool     `json:"publish"`
	ProfileID string   `json:"profile_id"`
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
	var profileID pgtype.UUID
	if raw := strings.TrimSpace(req.ProfileID); raw != "" {
		parsed, err := util.ParseUUID(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid embedding profile id")
			return
		}
		profileID = parsed
	}
	entries, err := h.Knowledge.DepositTaskKnowledge(r.Context(), issue, actorID, req.Keys, req.Publish, profileID)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrKnowledgeNoChain):
			writeError(w, http.StatusBadRequest, "this task has no relay to distil")
		case errors.Is(err, service.ErrKnowledgeTaskNotDone):
			writeError(w, http.StatusConflict, "finish the task before distilling it")
		case errors.Is(err, service.ErrKnowledgeEmptySelection):
			writeError(w, http.StatusBadRequest, "select at least one knowledge entry")
		case errors.Is(err, service.ErrEmbeddingProfileNotFound):
			writeError(w, http.StatusNotFound, "embedding profile not found")
		default:
			writeError(w, http.StatusInternalServerError, "failed to store knowledge")
		}
		return
	}
	resp := make([]KnowledgeEntryResponse, len(entries))
	for i, entry := range entries {
		resp[i] = knowledgeEntryRecordToResponse(entry)
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
	var profileID pgtype.UUID
	if raw := strings.TrimSpace(r.URL.Query().Get("profile_id")); raw != "" {
		parsed, err := util.ParseUUID(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid embedding profile id")
			return
		}
		profileID = parsed
	}
	embedded, err := h.Knowledge.ReembedMissing(r.Context(), wsID, profileID, 100)
	if err != nil {
		if errors.Is(err, service.ErrEmbeddingProfileNotFound) {
			writeError(w, http.StatusNotFound, "embedding profile not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to reindex knowledge")
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"embedded": embedded})
}

type embeddingProviderResponse struct {
	Key     string                     `json:"key"`
	Label   string                     `json:"label"`
	BaseURL string                     `json:"base_url"`
	Models  []knowledge.EmbeddingModel `json:"models"`
	Manual  bool                       `json:"manual"`
}

func (h *Handler) ListEmbeddingProviders(w http.ResponseWriter, r *http.Request) {
	resp := make([]embeddingProviderResponse, 0, len(knowledge.Providers)+1)
	for _, preset := range knowledge.Providers {
		resp = append(resp, embeddingProviderResponse{
			Key:     preset.Key,
			Label:   preset.Label,
			BaseURL: preset.BaseURL,
			Models:  preset.Models,
		})
	}
	resp = append(resp, embeddingProviderResponse{
		Key:    knowledge.ProviderCustom,
		Label:  "自定义",
		Models: []knowledge.EmbeddingModel{},
		Manual: true,
	})
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) ListEmbeddingProfiles(w http.ResponseWriter, r *http.Request) {
	wsID, ok := parseUUIDOrBadRequest(w, ctxWorkspaceID(r.Context()), "workspace id")
	if !ok {
		return
	}
	resp := []EmbeddingProfileResponse{}
	if h.Knowledge.Profiles != nil {
		rows, err := h.Knowledge.Profiles.List(r.Context(), wsID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list embedding profiles")
			return
		}
		resp = make([]EmbeddingProfileResponse, len(rows))
		for i, row := range rows {
			resp[i] = embeddingProfileToResponse(row)
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

type embeddingMatchRequest struct {
	Provider string `json:"provider"`
	BaseURL  string `json:"base_url"`
	APIKey   string `json:"api_key"`
	Model    string `json:"model"`
	Dims     int    `json:"dims"`
}

type embeddingMatchResponse struct {
	Provider string                     `json:"provider"`
	BaseURL  string                     `json:"base_url"`
	Models   []knowledge.EmbeddingModel `json:"models"`
	Manual   bool                       `json:"manual"`
}

func (h *Handler) MatchEmbeddingModels(w http.ResponseWriter, r *http.Request) {
	workspaceID := ctxWorkspaceID(r.Context())
	member, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found")
	if !ok {
		return
	}
	if member.Role != "owner" && member.Role != "admin" {
		writeError(w, http.StatusForbidden, "only a workspace owner or admin can configure embeddings")
		return
	}
	var req embeddingMatchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	models, err := knowledge.MatchModels(ctx, req.Provider, req.BaseURL, req.APIKey, req.Model, req.Dims)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	baseURL, _ := knowledge.ResolveProvider(req.Provider, req.BaseURL)
	writeJSON(w, http.StatusOK, embeddingMatchResponse{
		Provider: req.Provider,
		BaseURL:  baseURL,
		Models:   models,
		Manual:   req.Provider == knowledge.ProviderCustom,
	})
}

type createEmbeddingProfileRequest struct {
	Provider string `json:"provider"`
	BaseURL  string `json:"base_url"`
	Model    string `json:"model"`
	Dims     int    `json:"dims"`
	APIKey   string `json:"api_key"`
	Activate bool   `json:"activate"`
}

func (h *Handler) CreateEmbeddingProfile(w http.ResponseWriter, r *http.Request) {
	workspaceID := ctxWorkspaceID(r.Context())
	member, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found")
	if !ok {
		return
	}
	if member.Role != "owner" && member.Role != "admin" {
		writeError(w, http.StatusForbidden, "only a workspace owner or admin can configure embeddings")
		return
	}
	if h.Knowledge.Profiles == nil {
		writeError(w, http.StatusBadRequest, "embedding profiles are not available")
		return
	}
	wsID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
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
	var req createEmbeddingProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	row, err := h.Knowledge.Profiles.Create(r.Context(), wsID, actorID, service.EmbeddingProfileRequest{
		Provider: req.Provider,
		BaseURL:  req.BaseURL,
		Model:    req.Model,
		Dims:     req.Dims,
		APIKey:   req.APIKey,
		Activate: req.Activate,
	})
	if err != nil {
		switch {
		case errors.Is(err, service.ErrEmbeddingKeyUnavailable):
			writeError(w, http.StatusBadRequest, "server has no QUICKWORK_SECRET_KEY configured; refusing to store a plaintext key")
		case errors.Is(err, service.ErrEmbeddingProfileExists):
			writeError(w, http.StatusConflict, err.Error())
		default:
			writeError(w, http.StatusBadRequest, err.Error())
		}
		return
	}
	writeJSON(w, http.StatusCreated, embeddingProfileToResponse(row))
}

func (h *Handler) ActivateEmbeddingProfile(w http.ResponseWriter, r *http.Request) {
	workspaceID := ctxWorkspaceID(r.Context())
	member, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found")
	if !ok {
		return
	}
	if member.Role != "owner" && member.Role != "admin" {
		writeError(w, http.StatusForbidden, "only a workspace owner or admin can configure embeddings")
		return
	}
	if h.Knowledge.Profiles == nil {
		writeError(w, http.StatusBadRequest, "embedding profiles are not available")
		return
	}
	wsID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	profileID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "id")
	if !ok {
		return
	}
	if err := h.Knowledge.Profiles.Activate(r.Context(), wsID, profileID); err != nil {
		if errors.Is(err, service.ErrEmbeddingProfileNotFound) {
			writeError(w, http.StatusNotFound, "embedding profile not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to activate embedding profile")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) DeleteEmbeddingProfile(w http.ResponseWriter, r *http.Request) {
	workspaceID := ctxWorkspaceID(r.Context())
	member, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found")
	if !ok {
		return
	}
	if member.Role != "owner" && member.Role != "admin" {
		writeError(w, http.StatusForbidden, "only a workspace owner or admin can configure embeddings")
		return
	}
	if h.Knowledge.Profiles == nil {
		writeError(w, http.StatusBadRequest, "embedding profiles are not available")
		return
	}
	wsID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	profileID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "id")
	if !ok {
		return
	}
	if err := h.Knowledge.Profiles.Delete(r.Context(), wsID, profileID); err != nil {
		switch {
		case errors.Is(err, service.ErrEmbeddingProfileNotFound):
			writeError(w, http.StatusNotFound, "embedding profile not found")
		case errors.Is(err, service.ErrEmbeddingProfileActive):
			writeError(w, http.StatusConflict, "activate another profile before deleting the active one")
		case errors.Is(err, service.ErrEmbeddingProfileInUse):
			writeError(w, http.StatusConflict, "this profile still has indexed entries")
		default:
			writeError(w, http.StatusInternalServerError, "failed to delete embedding profile")
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
