package handler

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/kscsky/quickwork/server/internal/util"
	db "github.com/kscsky/quickwork/server/pkg/db/generated"
)

// ---------------------------------------------------------------------------
// Workspace usage overview + model call log
//
// The overview and the log deliberately share one source (raw task_usage,
// restricted to daemon-run tasks) and one cutoff (parseExactSinceParamInTZ).
// The previous dashboard read the hourly rollup, which lags writes by up to
// five minutes; a call log built on raw rows next to a rollup headline would
// disagree during that tail, and the two tabs are meant to be reconciled by
// eye. Cost is still priced client-side from the rate table, so both
// endpoints carry the provider ticks and the uncosted token split.
//
// Access control:
//   - workspace membership gates the whole page;
//   - agent identity is folded onto restrictedAgentsRowID for agents the
//     caller may not name (private user agents, hidden system carriers), the
//     same rule the existing per-agent dashboard endpoints use. The overview
//     folds inside SQL so sums stay whole; the log folds per row after the
//     page is read, because a call log shows one row per run and has nothing
//     to merge.
// ---------------------------------------------------------------------------

const (
	usageDefaultDays     = 30
	usageDefaultPageSize = 25
	usageMaxPageSize     = 500
	usageMaxPage         = 1_000_000
	usageMaxOffset       = 1<<31 - 1
)

type usageStatusCounts struct {
	All       int64 `json:"all"`
	Success   int64 `json:"success"`
	Failed    int64 `json:"failed"`
	Cancelled int64 `json:"cancelled"`
	Running   int64 `json:"running"`
}

type usageModelSummary struct {
	Provider                 string `json:"provider"`
	Model                    string `json:"model"`
	CallCount                int64  `json:"call_count"`
	InputTokens              int64  `json:"input_tokens"`
	OutputTokens             int64  `json:"output_tokens"`
	CacheReadTokens          int64  `json:"cache_read_tokens"`
	CacheWriteTokens         int64  `json:"cache_write_tokens"`
	CostUSDTicks             int64  `json:"cost_usd_ticks"`
	UncostedInputTokens      int64  `json:"uncosted_input_tokens"`
	UncostedOutputTokens     int64  `json:"uncosted_output_tokens"`
	UncostedCacheReadTokens  int64  `json:"uncosted_cache_read_tokens"`
	UncostedCacheWriteTokens int64  `json:"uncosted_cache_write_tokens"`
	SuccessCalls             int64  `json:"success_calls"`
	FailedCalls              int64  `json:"failed_calls"`
	CancelledCalls           int64  `json:"cancelled_calls"`
	RunningCalls             int64  `json:"running_calls"`
}

type usageOverviewDaily struct {
	Date string `json:"date"`
	usageModelSummary
}

type usageOverviewByAgent struct {
	AgentID string `json:"agent_id"`
	usageModelSummary
}

type usageOverviewResponse struct {
	Daily   []usageOverviewDaily   `json:"daily"`
	ByModel []usageModelSummary    `json:"by_model"`
	ByAgent []usageOverviewByAgent `json:"by_agent"`
	// Same per-model shape for the immediately preceding window, so the
	// headline can show a like-for-like delta without a second endpoint.
	PreviousByModel []usageModelSummary `json:"previous_by_model"`
}

type usageLogRow struct {
	ID               string  `json:"id"`
	TaskID           string  `json:"task_id"`
	Status           string  `json:"status"`
	DBStatus         string  `json:"db_status"`
	AgentID          string  `json:"agent_id"`
	AgentName        string  `json:"agent_name"`
	AgentRestricted  bool    `json:"agent_restricted"`
	IssueID          string  `json:"issue_id"`
	IssueIdentifier  string  `json:"issue_identifier"`
	IssueTitle       string  `json:"issue_title"`
	ProjectID        string  `json:"project_id"`
	Provider         string  `json:"provider"`
	Model            string  `json:"model"`
	Trigger          string  `json:"trigger"`
	FailureReason    string  `json:"failure_reason"`
	StartedAt        *string `json:"started_at,omitempty"`
	CompletedAt      *string `json:"completed_at,omitempty"`
	CreatedAt        *string `json:"created_at"`
	InputTokens      int64   `json:"input_tokens"`
	OutputTokens     int64   `json:"output_tokens"`
	CacheReadTokens  int64   `json:"cache_read_tokens"`
	CacheWriteTokens int64   `json:"cache_write_tokens"`
	CostUSDTicks     *int64  `json:"cost_usd_ticks,omitempty"`
}

type usageLogSummary struct {
	ByModel      []usageModelSummary `json:"by_model"`
	StatusCounts usageStatusCounts   `json:"status_counts"`
}

type usageLogResponse struct {
	Rows     []usageLogRow   `json:"rows"`
	Total    int64           `json:"total"`
	Page     int             `json:"page"`
	PageSize int             `json:"page_size"`
	Summary  usageLogSummary `json:"summary"`
}

func usageModelSummaryFromRow(row db.ListUsageModelSummaryRow) usageModelSummary {
	return usageModelSummary{
		Provider:                 row.Provider,
		Model:                    row.Model,
		CallCount:                row.CallCount,
		InputTokens:              row.InputTokens,
		OutputTokens:             row.OutputTokens,
		CacheReadTokens:          row.CacheReadTokens,
		CacheWriteTokens:         row.CacheWriteTokens,
		CostUSDTicks:             row.CostUsdTicks,
		UncostedInputTokens:      row.UncostedInputTokens,
		UncostedOutputTokens:     row.UncostedOutputTokens,
		UncostedCacheReadTokens:  row.UncostedCacheReadTokens,
		UncostedCacheWriteTokens: row.UncostedCacheWriteTokens,
		SuccessCalls:             row.SuccessCalls,
		FailedCalls:              row.FailedCalls,
		CancelledCalls:           row.CancelledCalls,
		RunningCalls:             row.RunningCalls,
	}
}

func usageModelSummaries(rows []db.ListUsageModelSummaryRow) []usageModelSummary {
	out := make([]usageModelSummary, len(rows))
	for i, row := range rows {
		out[i] = usageModelSummaryFromRow(row)
	}
	return out
}

func usageStatusCountsOf(rows []db.ListUsageModelSummaryRow) usageStatusCounts {
	var c usageStatusCounts
	for _, row := range rows {
		c.All += row.CallCount
		c.Success += row.SuccessCalls
		c.Failed += row.FailedCalls
		c.Cancelled += row.CancelledCalls
		c.Running += row.RunningCalls
	}
	return c
}

func restrictedUUIDSlice(restricted map[string]struct{}) []pgtype.UUID {
	out := make([]pgtype.UUID, 0, len(restricted))
	for id := range restricted {
		u, err := util.ParseUUID(id)
		if err != nil {
			continue
		}
		out = append(out, u)
	}
	return out
}

func optionalText(value string) pgtype.Text {
	value = strings.TrimSpace(value)
	if value == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: value, Valid: true}
}

func optionalInt64Ptr(v pgtype.Int8) *int64 {
	if !v.Valid {
		return nil
	}
	n := v.Int64
	return &n
}

// GetUsageOverview returns the three rollups the redesigned usage page needs:
// per-day per-model trend rows, the per-model totals, and the per-agent
// totals. All three are sliced with the same project/window filters, so the
// cards on the page reconcile without any client-side joining of endpoints.
func (h *Handler) GetUsageOverview(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	member, ok := h.workspaceMember(w, r, workspaceID)
	if !ok {
		return
	}
	projectID, ok := parseProjectIDParam(w, r)
	if !ok {
		return
	}
	tz := h.resolveViewingTZ(r)
	since := parseExactSinceParamInTZ(r, usageDefaultDays, tz)
	days := parseDaysParam(r, usageDefaultDays)
	loc, err := time.LoadLocation(tz)
	if err != nil || loc == nil {
		loc = time.UTC
	}
	// The previous window is the N calendar days immediately before this one:
	// start-of-day (2N-1) days back through start-of-day (N-1) days back.
	// Anchoring both ends on the same viewer-local boundary keeps a 30D delta
	// comparable at DST transitions, where N*24h is not N days.
	prevSince := pgtype.Timestamptz{
		Time:  sinceFromDays(dayWindowNow(), days*2-1, loc),
		Valid: true,
	}

	dailyRows, err := h.Queries.ListUsageOverviewDaily(r.Context(), db.ListUsageOverviewDailyParams{
		Tz:          tz,
		WorkspaceID: parseUUID(workspaceID),
		Since:       since,
		ProjectID:   projectID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list usage overview")
		return
	}

	modelRows, err := h.Queries.ListUsageModelSummary(r.Context(), db.ListUsageModelSummaryParams{
		WorkspaceID: parseUUID(workspaceID),
		Since:       since,
		Until:       pgtype.Timestamptz{},
		ProjectID:   projectID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list usage by model")
		return
	}

	previousRows, err := h.Queries.ListUsageModelSummary(r.Context(), db.ListUsageModelSummaryParams{
		WorkspaceID: parseUUID(workspaceID),
		Since:       prevSince,
		Until:       since,
		ProjectID:   projectID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list previous usage")
		return
	}

	actorType, actorID := h.resolveActor(r, requestUserID(r), workspaceID)
	restricted, ok := h.restrictedAgentIDs(r.Context(), workspaceID, actorType, actorID, member.Role)
	if !ok {
		writeError(w, http.StatusInternalServerError, "failed to resolve agent access")
		return
	}
	agentRows, err := h.Queries.ListUsageOverviewByAgent(r.Context(), db.ListUsageOverviewByAgentParams{
		RestrictedAgentIds: restrictedUUIDSlice(restricted),
		WorkspaceID:        parseUUID(workspaceID),
		Since:              since,
		ProjectID:          projectID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list usage by agent")
		return
	}

	daily := make([]usageOverviewDaily, len(dailyRows))
	for i, row := range dailyRows {
		daily[i] = usageOverviewDaily{
			Date: row.Date.Time.Format("2006-01-02"),
			usageModelSummary: usageModelSummary{
				Provider:                 row.Provider,
				Model:                    row.Model,
				CallCount:                row.CallCount,
				InputTokens:              row.InputTokens,
				OutputTokens:             row.OutputTokens,
				CacheReadTokens:          row.CacheReadTokens,
				CacheWriteTokens:         row.CacheWriteTokens,
				CostUSDTicks:             row.CostUsdTicks,
				UncostedInputTokens:      row.UncostedInputTokens,
				UncostedOutputTokens:     row.UncostedOutputTokens,
				UncostedCacheReadTokens:  row.UncostedCacheReadTokens,
				UncostedCacheWriteTokens: row.UncostedCacheWriteTokens,
				SuccessCalls:             row.SuccessCalls,
				FailedCalls:              row.FailedCalls,
				CancelledCalls:           row.CancelledCalls,
				RunningCalls:             row.RunningCalls,
			},
		}
	}

	byAgent := make([]usageOverviewByAgent, len(agentRows))
	for i, row := range agentRows {
		byAgent[i] = usageOverviewByAgent{
			AgentID: row.AgentID,
			usageModelSummary: usageModelSummary{
				Provider:                 row.Provider,
				Model:                    row.Model,
				CallCount:                row.CallCount,
				InputTokens:              row.InputTokens,
				OutputTokens:             row.OutputTokens,
				CacheReadTokens:          row.CacheReadTokens,
				CacheWriteTokens:         row.CacheWriteTokens,
				CostUSDTicks:             row.CostUsdTicks,
				UncostedInputTokens:      row.UncostedInputTokens,
				UncostedOutputTokens:     row.UncostedOutputTokens,
				UncostedCacheReadTokens:  row.UncostedCacheReadTokens,
				UncostedCacheWriteTokens: row.UncostedCacheWriteTokens,
				SuccessCalls:             row.SuccessCalls,
				FailedCalls:              row.FailedCalls,
				CancelledCalls:           row.CancelledCalls,
				RunningCalls:             row.RunningCalls,
			},
		}
	}

	writeJSON(w, http.StatusOK, usageOverviewResponse{
		Daily:           daily,
		ByModel:         usageModelSummaries(modelRows),
		ByAgent:         byAgent,
		PreviousByModel: usageModelSummaries(previousRows),
	})
}

// GetUsageLogs returns one page of the model call log plus the filtered
// summary and the per-status counts that drive the filter chips.
//
// Summary and rows are two queries over the same filter set. The summary is
// grouped by provider+model because cost is priced client-side: a single
// total with no model dimension could not be priced at all.
func (h *Handler) GetUsageLogs(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	member, ok := h.workspaceMember(w, r, workspaceID)
	if !ok {
		return
	}
	projectID, ok := parseProjectIDParam(w, r)
	if !ok {
		return
	}

	agentID := pgtype.UUID{}
	if raw := strings.TrimSpace(r.URL.Query().Get("agent_id")); raw != "" {
		parsed, ok := parseUUIDOrBadRequest(w, raw, "agent_id")
		if !ok {
			return
		}
		agentID = parsed
	}

	page, pageSize := parseUsageLogPage(r)
	provider := optionalText(r.URL.Query().Get("provider"))
	model := optionalText(r.URL.Query().Get("model"))
	query := optionalText(r.URL.Query().Get("q"))
	status := parseUsageLogStatus(r.URL.Query().Get("status"))
	sortKey, sortDir := parseUsageLogSort(r)

	tz := h.resolveViewingTZ(r)
	since := parseExactSinceParamInTZ(r, usageDefaultDays, tz)

	filters := db.ListUsageModelSummaryParams{
		WorkspaceID: parseUUID(workspaceID),
		Since:       since,
		Until:       pgtype.Timestamptz{},
		ProjectID:   projectID,
		Provider:    provider,
		Model:       model,
		AgentID:     agentID,
		Q:           query,
	}

	filteredFilters := filters
	filteredFilters.Status = status
	summaryRows, err := h.Queries.ListUsageModelSummary(r.Context(), filteredFilters)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to summarize usage logs")
		return
	}
	countRows, err := h.Queries.ListUsageModelSummary(r.Context(), filters)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to count usage logs")
		return
	}

	offset := int64(page-1) * int64(pageSize)
	if offset > usageMaxOffset {
		offset = usageMaxOffset
	}
	rows, err := h.Queries.ListUsageLogs(r.Context(), db.ListUsageLogsParams{
		WorkspaceID: parseUUID(workspaceID),
		Since:       since,
		ProjectID:   projectID,
		Provider:    provider,
		Model:       model,
		AgentID:     agentID,
		Status:      status,
		Q:           query,
		Sort:        sortKey,
		Dir:         sortDir,
		OffsetCount: int32(offset),
		LimitCount:  int32(pageSize),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list usage logs")
		return
	}

	actorType, actorID := h.resolveActor(r, requestUserID(r), workspaceID)
	restricted, ok := h.restrictedAgentIDs(r.Context(), workspaceID, actorType, actorID, member.Role)
	if !ok {
		writeError(w, http.StatusInternalServerError, "failed to resolve agent access")
		return
	}

	outRows := make([]usageLogRow, len(rows))
	for i, row := range rows {
		agentID := uuidToString(row.AgentID)
		agentName := row.AgentName
		agentRestricted := false
		if _, hidden := restricted[agentID]; hidden {
			agentID = restrictedAgentsRowID
			agentName = ""
			agentRestricted = true
		}
		outRows[i] = usageLogRow{
			ID:               uuidToString(row.ID),
			TaskID:           uuidToString(row.TaskID),
			Status:           row.Status,
			DBStatus:         row.DbStatus,
			AgentID:          agentID,
			AgentName:        agentName,
			AgentRestricted:  agentRestricted,
			IssueID:          uuidToString(row.IssueID),
			IssueIdentifier:  row.IssueIdentifier,
			IssueTitle:       row.IssueTitle,
			ProjectID:        uuidToString(row.ProjectID),
			Provider:         row.Provider,
			Model:            row.Model,
			Trigger:          row.Trigger,
			FailureReason:    row.FailureReason,
			StartedAt:        timestampToPtr(row.StartedAt),
			CompletedAt:      timestampToPtr(row.CompletedAt),
			CreatedAt:        timestampToPtr(row.CreatedAt),
			InputTokens:      row.InputTokens,
			OutputTokens:     row.OutputTokens,
			CacheReadTokens:  row.CacheReadTokens,
			CacheWriteTokens: row.CacheWriteTokens,
			CostUSDTicks:     optionalInt64Ptr(row.CostUsdTicks),
		}
	}

	var total int64
	for _, row := range summaryRows {
		total += row.CallCount
	}

	writeJSON(w, http.StatusOK, usageLogResponse{
		Rows:     outRows,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
		Summary: usageLogSummary{
			ByModel:      usageModelSummaries(summaryRows),
			StatusCounts: usageStatusCountsOf(countRows),
		},
	})
}

func parseUsageLogPage(r *http.Request) (int, int) {
	page := 1
	if raw := r.URL.Query().Get("page"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			page = min(parsed, usageMaxPage)
		}
	}
	pageSize := usageDefaultPageSize
	if raw := r.URL.Query().Get("page_size"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			pageSize = min(parsed, usageMaxPageSize)
		}
	}
	return page, pageSize
}

// parseUsageLogStatus keeps the wire value open: an unknown status from a
// newer client is treated as "no status filter" rather than a 400, so an
// installed desktop build does not break the page.
func parseUsageLogStatus(raw string) pgtype.Text {
	status := strings.TrimSpace(raw)
	switch status {
	case "success", "failed", "cancelled", "running":
		return pgtype.Text{String: status, Valid: true}
	default:
		return pgtype.Text{}
	}
}

func parseUsageLogSort(r *http.Request) (pgtype.Text, pgtype.Text) {
	rawSort := strings.TrimSpace(r.URL.Query().Get("sort"))
	switch rawSort {
	case "duration", "input", "output", "cache":
		// Recognised non-default orders.
	case "time":
		// The SQL's ELSE branch is time. Leaving Sort NULL avoids a second
		// expression branch that would only repeat the default.
		rawSort = ""
	default:
		rawSort = ""
	}
	dir := "desc"
	if strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("dir")), "asc") {
		dir = "asc"
	}
	sortText := pgtype.Text{}
	if rawSort != "" {
		sortText = pgtype.Text{String: rawSort, Valid: true}
	}
	return sortText, pgtype.Text{String: dir, Valid: true}
}
