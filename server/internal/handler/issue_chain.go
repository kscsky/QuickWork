package handler

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	obsmetrics "github.com/kscsky/quickwork/server/internal/metrics"
	"github.com/kscsky/quickwork/server/internal/service"
	"github.com/kscsky/quickwork/server/internal/util"
	db "github.com/kscsky/quickwork/server/pkg/db/generated"
	"github.com/kscsky/quickwork/server/pkg/protocol"
)

// Caps on what a handoff package may carry. This payload is the one thing that
// crosses the leg boundary, and it is stored on the step row — the caps keep a
// curated package curated rather than a second copy of the working directory.
const (
	maxHandoffFiles = 50
	// A leg-output document is a full markdown handoff, not a one-line note:
	// the agent's summary routinely runs to several KB. The cap still keeps the
	// package curated, but must not reject the document the product itself
	// generated. The same document is also carried as an editable .md file.
	maxHandoffSummary        = 50000
	maxHandoffFileName       = 300
	maxHandoffAcceptance     = 20
	maxHandoffAcceptanceText = 500
	maxHandoffOpenQuestions  = 20
	maxHandoffOpenQuestion   = 1000
	maxHandoffNextBrief      = 20
	maxHandoffNextBriefItem  = 500
	maxHandoffReturnReason   = 2000
)

// handoffPayload is the JSON body shared by approve and return. Summary is a
// pointer so "omitted" (an older client) and "explicitly empty" stay distinct.
type handoffPayload struct {
	Summary       *string                          `json:"summary"`
	Files         []service.ChainHandoffFile       `json:"files"`
	Acceptance    []service.ChainHandoffAcceptance `json:"acceptance"`
	OpenQuestions []string                         `json:"open_questions"`
	NextBrief     []string                         `json:"next_brief"`
}

// buildHandoff normalizes and validates one package. It returns nil when the
// payload carries no package at all; an empty error message means valid.
func buildHandoff(body *handoffPayload) (*service.ChainHandoff, string) {
	if body.Summary == nil && len(body.Files) == 0 && len(body.Acceptance) == 0 &&
		len(body.OpenQuestions) == 0 && len(body.NextBrief) == 0 {
		return nil, ""
	}
	if len(body.Files) > maxHandoffFiles {
		return nil, "at most " + strconv.Itoa(maxHandoffFiles) + " files can travel in a handoff package"
	}
	summary := ""
	if body.Summary != nil {
		summary = strings.TrimSpace(*body.Summary)
		if len(summary) > maxHandoffSummary {
			return nil, "the handoff summary is too long"
		}
	}
	for i := range body.Files {
		body.Files[i].Name = strings.TrimSpace(body.Files[i].Name)
		if body.Files[i].Name == "" || len(body.Files[i].Name) > maxHandoffFileName {
			return nil, "each handoff file needs a name"
		}
	}
	if len(body.Acceptance) > maxHandoffAcceptance {
		return nil, "at most " + strconv.Itoa(maxHandoffAcceptance) + " acceptance rows can travel in a handoff package"
	}
	acceptance := make([]service.ChainHandoffAcceptance, 0, len(body.Acceptance))
	for _, row := range body.Acceptance {
		row.Label = strings.TrimSpace(row.Label)
		row.Requirement = strings.TrimSpace(row.Requirement)
		row.Delivered = strings.TrimSpace(row.Delivered)
		row.State = strings.TrimSpace(row.State)
		if row.Label == "" && row.Requirement == "" && row.Delivered == "" {
			continue
		}
		if row.Label == "" || row.Requirement == "" {
			return nil, "each acceptance row needs a label and a requirement"
		}
		if len(row.Label) > 80 || len(row.Requirement) > maxHandoffAcceptanceText ||
			len(row.Delivered) > maxHandoffAcceptanceText {
			return nil, "an acceptance row is too long"
		}
		if row.State != "pass" && row.State != "warn" {
			row.State = "pass"
		}
		acceptance = append(acceptance, row)
	}
	if len(body.OpenQuestions) > maxHandoffOpenQuestions {
		return nil, "at most " + strconv.Itoa(maxHandoffOpenQuestions) + " open questions can travel in a handoff package"
	}
	openQuestions := make([]string, 0, len(body.OpenQuestions))
	for _, question := range body.OpenQuestions {
		question = strings.TrimSpace(question)
		if question == "" {
			continue
		}
		if len(question) > maxHandoffOpenQuestion {
			return nil, "an open question is too long"
		}
		openQuestions = append(openQuestions, question)
	}
	if len(body.NextBrief) > maxHandoffNextBrief {
		return nil, "at most " + strconv.Itoa(maxHandoffNextBrief) + " next-leg items can travel in a handoff package"
	}
	nextBrief := make([]string, 0, len(body.NextBrief))
	for _, item := range body.NextBrief {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if len(item) > maxHandoffNextBriefItem {
			return nil, "a next-leg item is too long"
		}
		nextBrief = append(nextBrief, item)
	}
	return &service.ChainHandoff{
		Summary:       summary,
		Files:         body.Files,
		Acceptance:    acceptance,
		OpenQuestions: openQuestions,
		NextBrief:     nextBrief,
	}, ""
}

// A task's chain, and the playbooks a squad walks again.
//
// The chain is the relay a squad task runs: ordered steps, each naming the
// person whose turn it is and the agent they lend. The interesting state is
// `parked` — the relay reached someone who has not bound an agent, so nothing
// runs and the task waits. That is not an error and not a skip.

type IssueChainStepResponse struct {
	ID       string `json:"id"`
	Position int32  `json:"position"`
	// The person whose turn this is.
	HolderUserID string `json:"holder_user_id"`
	// Empty when they lend no agent, which is what parks the step.
	AgentID string `json:"agent_id,omitempty"`
	Title   string `json:"title"`
	State   string `json:"state"`
	// "pending" | "doing" | "reviewing" | "done" | "parked" | "skipped"
	//
	// The machine's reason code for a parked step (no_agent,
	// runtime_private_foreign, runtime_offline, runtime_unusable,
	// agent_runtime_required, target_unavailable). Empty for non-parked steps
	// and for backends that predate the reason. Clients localize it and offer
	// the matching fix instead of an indefinite "waiting".
	ParkedReason string `json:"parked_reason,omitempty"`
	// LegStatus is the single derived status of this leg: pending, queued,
	// preparing, running, reviewing, parked, done, or skipped. The chain state
	// and the run state are two layers; this is the one every surface should
	// render. Absent on backends that predate it.
	LegStatus string `json:"leg_status,omitempty"`
	//
	// The holder's own brief for this leg, written by them (or empty while
	// they have not written it yet). Only the holder can set it.
	Plan string `json:"plan,omitempty"`
	// The package this leg published on 通过, when it has one. Public: it is
	// what the leg chose to hand over.
	Handoff *service.ChainHandoff `json:"handoff,omitempty"`
	// How many leg-scoped comments this leg carries. Readers who are not the
	// holder render "N 条对话 · 对你们不可见" from this count instead of the
	// content itself.
	LegCommentCount int    `json:"leg_comment_count,omitempty"`
	StartedAt       string `json:"started_at,omitempty"`
	CompletedAt     string `json:"completed_at,omitempty"`
	// The active leg-output run, when the holder has asked their leg's agent
	// to write the handoff summary. The review gate reads this so a page
	// reload does not lose "still generating" and approve a live leg.
	OutputTaskID string `json:"output_task_id,omitempty"`
	// When the newest leg-output run was created, active or finished. This is
	// the baseline for lifting a summary that landed while the page was
	// closed; it survives the task's completion so the lift still works.
	OutputTaskAt string `json:"output_task_at,omitempty"`
}

// IssueChainRetryResponse is the chain after a leg retry, plus the run that
// was queued. TaskID is empty when the retry parked instead (the agent can no
// longer claim this leg); the steps then carry the parked_reason.
type IssueChainRetryResponse struct {
	IssueChainResponse
	TaskID string `json:"task_id,omitempty"`
}

// IssueChainCancelResponse is the chain after the holder stopped the leg's
// in-flight run(s). The step stays doing; the cancelled run is what makes the
// retry action available.
type IssueChainCancelResponse struct {
	IssueChainResponse
	Cancelled int `json:"cancelled"`
}

type IssueChainResponse struct {
	Steps []IssueChainStepResponse `json:"steps"`
	// True when the relay is waiting on someone. The list and detail pages
	// both key their warning treatment off this rather than scanning states.
	Parked bool `json:"parked"`
	// True when a step's run is done and waits on its holder's own approval.
	// The workbench keys its 审核通过 button off this.
	Reviewing bool `json:"reviewing"`
}

func chainStepToResponse(s db.IssueChainStep) IssueChainStepResponse {
	out := IssueChainStepResponse{
		ID:           uuidToString(s.ID),
		Position:     s.Position,
		HolderUserID: uuidToString(s.HolderUserID),
		Title:        s.Title,
		State:        s.State,
		ParkedReason: s.ParkedReason,
		Plan:         s.Plan,
	}
	if s.AgentID.Valid {
		out.AgentID = uuidToString(s.AgentID)
	}
	// An empty package means the leg published nothing (an older client
	// approved bare, or the holder ticked nothing and wrote nothing); leaving
	// it absent keeps the wire honest about "no handoff" vs "empty handoff".
	// The column defaults to '[]', so the raw bytes are never a good emptiness
	// signal — parse first, decide after.
	var files []service.ChainHandoffFile
	if len(s.HandoffFiles) > 0 {
		if err := json.Unmarshal(s.HandoffFiles, &files); err != nil {
			// A malformed column must not blank the whole chain; the summary
			// (if any) still carries the leg's handover.
			files = nil
		}
	}
	var pkg service.ChainHandoffPackage
	if len(s.HandoffPackage) > 0 {
		if err := json.Unmarshal(s.HandoffPackage, &pkg); err != nil {
			// Same rule as files: a bad structured blob degrades to "no
			// structured package", never to a chain that fails to read.
			pkg = service.ChainHandoffPackage{}
		}
	}
	if s.HandoffSummary != "" || len(files) > 0 ||
		len(pkg.Acceptance) > 0 || len(pkg.OpenQuestions) > 0 ||
		len(pkg.NextBrief) > 0 || pkg.Returned != nil {
		out.Handoff = &service.ChainHandoff{
			Summary:       s.HandoffSummary,
			Files:         files,
			Acceptance:    pkg.Acceptance,
			OpenQuestions: pkg.OpenQuestions,
			NextBrief:     pkg.NextBrief,
			Returned:      pkg.Returned,
		}
	}
	if s.StartedAt.Valid {
		out.StartedAt = timestampToString(s.StartedAt)
	}
	if s.CompletedAt.Valid {
		out.CompletedAt = timestampToString(s.CompletedAt)
	}
	return out
}

func chainToResponse(steps []db.IssueChainStep, legCommentCounts map[string]int) IssueChainResponse {
	resp := IssueChainResponse{Steps: make([]IssueChainStepResponse, 0, len(steps))}
	for _, s := range steps {
		step := chainStepToResponse(s)
		step.LegCommentCount = legCommentCounts[uuidToString(s.ID)]
		resp.Steps = append(resp.Steps, step)
		if s.State == service.ChainStateParked {
			resp.Parked = true
		}
		if s.State == service.ChainStateReviewing {
			resp.Reviewing = true
		}
	}
	return resp
}

// chainResponse reads a task's relay plus its per-leg comment counts — one
// place so every endpoint that returns a chain returns the same picture.
func (h *Handler) chainResponse(ctx context.Context, issueID pgtype.UUID) (IssueChainResponse, error) {
	steps, err := h.Queries.ListIssueChainSteps(ctx, issueID)
	if err != nil {
		return IssueChainResponse{}, err
	}
	counts := map[string]int{}
	if rows, err := h.Queries.CountIssueChainStepComments(ctx, issueID); err == nil {
		for _, row := range rows {
			counts[uuidToString(row.ChainStepID)] = int(row.CommentCount)
		}
	}
	outputTasks, err := h.Queries.ListLegOutputTasksForIssue(ctx, db.ListLegOutputTasksForIssueParams{
		IssueID:     issueID,
		HandoffNote: pgtype.Text{String: service.LegOutputInstruction, Valid: true},
	})
	if err != nil {
		// The gate is a protection, not the chain itself: a failed read must
		// not blank the relay. The UI falls back to its local generating flag.
		slog.Warn("leg output tasks could not be read for the chain",
			"issue_id", uuidToString(issueID), "error", err)
		outputTasks = nil
	}
	latestOutput := map[string]db.ListLegOutputTasksForIssueRow{}
	activeOutput := map[string]string{}
	for _, task := range outputTasks {
		agentID := uuidToString(task.AgentID)
		if _, seen := latestOutput[agentID]; !seen {
			latestOutput[agentID] = task
		}
		if isActiveAgentTaskStatus(task.Status) {
			if _, seen := activeOutput[agentID]; !seen {
				activeOutput[agentID] = uuidToString(task.ID)
			}
		}
	}
	resp := chainToResponse(steps, counts)
	for i := range resp.Steps {
		agentID := resp.Steps[i].AgentID
		if agentID == "" {
			continue
		}
		if taskID, ok := activeOutput[agentID]; ok {
			resp.Steps[i].OutputTaskID = taskID
		}
		if task, ok := latestOutput[agentID]; ok {
			resp.Steps[i].OutputTaskAt = timestampToString(task.CreatedAt)
		}
	}

	// One derived status per leg, so the list/inbox/detail do not each
	// recombine the chain state with the run state. The handoff-writing run is
	// not the leg's work and is excluded.
	legTasks, taskErr := h.Queries.ListTasksByIssue(ctx, issueID)
	if taskErr != nil {
		slog.Warn("chain leg tasks could not be read for leg_status",
			"issue_id", uuidToString(issueID), "error", taskErr)
		legTasks = nil
	}
	latestLeg := map[string]db.AgentTaskQueue{}
	for _, task := range legTasks {
		if task.HandoffNote.Valid && task.HandoffNote.String == service.LegOutputInstruction {
			continue
		}
		agentID := uuidToString(task.AgentID)
		if _, seen := latestLeg[agentID]; !seen {
			latestLeg[agentID] = task
		}
	}
	for i := range resp.Steps {
		step := &resp.Steps[i]
		if step.State != service.ChainStateDoing {
			step.LegStatus = step.State
			continue
		}
		latest, ok := latestLeg[step.AgentID]
		if !ok {
			step.LegStatus = "queued"
			continue
		}
		switch latest.Status {
		case "queued", "deferred":
			step.LegStatus = "queued"
		case "dispatched", "waiting_local_directory":
			step.LegStatus = "preparing"
		case "running":
			step.LegStatus = "running"
		default:
			step.LegStatus = "queued"
		}
	}
	return resp, nil
}

func isActiveAgentTaskStatus(status string) bool {
	switch status {
	case "queued", "dispatched", "waiting_local_directory", "running", "deferred":
		return true
	default:
		return false
	}
}

// ListIssueChain returns a task's relay, oldest step first.
//
// Read by any workspace member: the chain is how the squad's work is visible
// to the squad, and hiding it would make a parked task look simply idle.
func (h *Handler) ListIssueChain(w http.ResponseWriter, r *http.Request) {
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	resp, err := h.chainResponse(r.Context(), issue.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load the task's chain")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// SkipIssueChainStep moves the relay past the step it is parked on.
//
// The parked bar's second button: the squad goes around someone who has no
// agent instead of waiting for them to bind one. Only a parked step can be
// skipped — a running step is advanced by its own agent finishing, and
// jumping it would race that run.
func (h *Handler) SkipIssueChainStep(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	member, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found")
	if !ok {
		return
	}
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
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
	// Skipping a parked step is the room's own way around an absent holder.
	// Skipping a REVIEWING step bypasses that holder's judgment, so it is an
	// owner/admin fallback only.
	allowReviewing := member.Role == "owner" || member.Role == "admin"
	if _, err := h.TaskService.SkipChainStep(r.Context(), h.Queries, issue, allowReviewing, actorID, allowReviewing); err != nil {
		switch {
		case errors.Is(err, service.ErrNoChain):
			writeError(w, http.StatusBadRequest, "this task has no chain")
		case errors.Is(err, service.ErrNoParkedStep):
			writeError(w, http.StatusConflict, "nothing is parked on this task")
		default:
			writeError(w, http.StatusInternalServerError, "failed to skip the step")
		}
		return
	}
	resp, err := h.chainResponse(r.Context(), issue.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "the step was skipped but the chain could not be read back")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// ApproveIssueChainStep is the holder's own 通过: the run is done and they say
// it is what they meant, which is what hands the baton to the next person.
//
// The body is the handoff package — the summary the holder wrote and the files
// they ticked. It is optional (an older client approves bare), but when present
// it is validated here: this is the one payload that crosses the leg boundary,
// so the caps below are the boundary's, not the UI's.
//
// Only the step's holder can call this — the server is the boundary, and a
// 403 here is the relay's real permission rule rather than a hidden button.
func (h *Handler) ApproveIssueChainStep(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	if _, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found"); !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	holder, err := util.ParseUUID(userID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "user not authenticated")
		return
	}
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	var body handoffPayload
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	handoff, handoffErr := buildHandoff(&body)
	if handoffErr != "" {
		writeError(w, http.StatusBadRequest, handoffErr)
		return
	}
	if _, err := h.TaskService.ApproveChainStep(r.Context(), h.Queries, issue, holder, handoff); err != nil {
		switch {
		case errors.Is(err, service.ErrNoChain):
			writeError(w, http.StatusBadRequest, "this task has no chain")
		case errors.Is(err, service.ErrNoReviewingStep):
			writeError(w, http.StatusConflict, "nothing is waiting for review on this task")
		case errors.Is(err, service.ErrNotStepHolder):
			writeError(w, http.StatusForbidden, "only the step's holder can approve it")
		case errors.Is(err, service.ErrLegOutputRunning):
			writeError(w, http.StatusConflict, "the leg's summary is still being generated")
		case errors.Is(err, service.ErrHandoffRequired):
			writeError(w, http.StatusConflict, "write a handoff summary before passing the leg")
		case errors.Is(err, service.ErrHandoffAcceptanceRequired):
			writeError(w, http.StatusConflict, "add at least one acceptance item before passing the leg")
		case errors.Is(err, service.ErrHandoffNextBriefRequired):
			writeError(w, http.StatusConflict, "write a brief for the next leg before passing this one")
		default:
			writeError(w, http.StatusInternalServerError, "failed to approve the step")
		}
		return
	}
	resp, err := h.chainResponse(r.Context(), issue.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "the step was approved but the chain could not be read back")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// ReturnIssueChainStep is the holder's 退回修改: the run is done, but they are
// not willing to hand it on. The package they were reviewing is preserved with
// the reason on it, the leg goes back to doing, and the leg's own agent gets a
// revision run. Only the holder can do this — the same boundary as approve.
func (h *Handler) ReturnIssueChainStep(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	if _, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found"); !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	holder, err := util.ParseUUID(userID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "user not authenticated")
		return
	}
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	var body struct {
		Summary       *string                          `json:"summary"`
		Files         []service.ChainHandoffFile       `json:"files"`
		Acceptance    []service.ChainHandoffAcceptance `json:"acceptance"`
		OpenQuestions []string                         `json:"open_questions"`
		NextBrief     []string                         `json:"next_brief"`
		Reason        string                           `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	reason := strings.TrimSpace(body.Reason)
	if reason == "" {
		writeError(w, http.StatusBadRequest, "a return needs a reason")
		return
	}
	if len(reason) > maxHandoffReturnReason {
		writeError(w, http.StatusBadRequest, "the return reason is too long")
		return
	}
	handoff, handoffErr := buildHandoff(&handoffPayload{
		Summary:       body.Summary,
		Files:         body.Files,
		Acceptance:    body.Acceptance,
		OpenQuestions: body.OpenQuestions,
		NextBrief:     body.NextBrief,
	})
	if handoffErr != "" {
		writeError(w, http.StatusBadRequest, handoffErr)
		return
	}
	if _, err := h.TaskService.ReturnChainStep(r.Context(), h.Queries, issue, holder, handoff, reason); err != nil {
		switch {
		case errors.Is(err, service.ErrNoChain):
			writeError(w, http.StatusBadRequest, "this task has no chain")
		case errors.Is(err, service.ErrNoReviewingStep):
			writeError(w, http.StatusConflict, "nothing is waiting for review on this task")
		case errors.Is(err, service.ErrNotStepHolder):
			writeError(w, http.StatusForbidden, "only the step's holder can return it")
		case errors.Is(err, service.ErrNoStepAgent):
			writeError(w, http.StatusConflict, "this leg has no agent to revise the work")
		case errors.Is(err, service.ErrLegOutputRunning):
			writeError(w, http.StatusConflict, "the leg's summary is still being generated")
		case errors.Is(err, service.ErrDuplicatePendingTask):
			writeError(w, http.StatusConflict, "this leg's agent is already running")
		default:
			writeError(w, http.StatusInternalServerError, "failed to return the step")
		}
		return
	}
	resp, err := h.chainResponse(r.Context(), issue.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "the step was returned but the chain could not be read back")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// SetIssueChainStepPlan stores the holder's own brief for their leg.
func (h *Handler) SetIssueChainStepPlan(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	if _, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found"); !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	holder, err := util.ParseUUID(userID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "user not authenticated")
		return
	}
	var body struct {
		Plan string `json:"plan"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	if _, err := h.TaskService.SetChainStepPlan(r.Context(), h.Queries, issue, holder, body.Plan); err != nil {
		switch {
		case errors.Is(err, service.ErrNoChain):
			writeError(w, http.StatusBadRequest, "this task has no chain")
		case errors.Is(err, service.ErrNotStepHolder):
			writeError(w, http.StatusForbidden, "only the step's holder can write its plan")
		default:
			writeError(w, http.StatusInternalServerError, "failed to save the plan")
		}
		return
	}
	resp, err := h.chainResponse(r.Context(), issue.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "the plan was saved but the chain could not be read back")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// GenerateIssueChainLegOutput — POST /api/issues/{id}/chain/output
//
// The holder asks their leg's own agent for the leg's output: one run that
// turns this leg's conversation and results into the handoff document. The
// output belongs to the finished leg, so this is the completion act — not one
// document per question. Only the baton's holder may ask (the same boundary as
// approving it), and the run is the leg agent's own worker turn: no leader
// framing, no squad context.
func (h *Handler) GenerateIssueChainLegOutput(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	if _, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found"); !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	holder, err := util.ParseUUID(userID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "user not authenticated")
		return
	}
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	steps, err := h.Queries.ListIssueChainSteps(r.Context(), issue.ID)
	if err != nil || len(steps) == 0 {
		writeError(w, http.StatusBadRequest, "this task has no chain")
		return
	}
	var target *db.IssueChainStep
	for i := range steps {
		step := &steps[i]
		if step.State != service.ChainStateDoing && step.State != service.ChainStateReviewing {
			continue
		}
		if step.HolderUserID != holder {
			writeError(w, http.StatusForbidden, "only the step's holder can ask for its output")
			return
		}
		target = step
		break
	}
	if target == nil || !target.AgentID.Valid {
		writeError(w, http.StatusConflict, "the relay is not on a leg with an agent")
		return
	}
	task, err := h.TaskService.EnqueueTaskForMentionWithNote(r.Context(), issue, target.AgentID, pgtype.UUID{}, service.LegOutputInstruction)
	if err != nil {
		if errors.Is(err, service.ErrDuplicatePendingTask) {
			// A run for this leg's agent is already queued or running — it
			// already holds the turn, so the produce request cannot land as its
			// own run. The holder retries once that run finishes.
			writeError(w, http.StatusConflict, "this leg's agent is already running")
			return
		}
		slog.Warn("leg output run could not be enqueued",
			"issue_id", uuidToString(issue.ID),
			"agent_id", uuidToString(target.AgentID),
			"error", err)
		writeError(w, http.StatusInternalServerError, "failed to start the output run")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"task_id": uuidToString(task.ID),
		"status":  "queued",
	})
}

// ReassignIssueChainStep moves a waiting leg (reviewing or parked) to another
// squad member. Owner/admin only: it is the fallback for a holder who is
// unreachable, and it changes whose judgment the relay waits on.
func (h *Handler) ReassignIssueChainStep(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	member, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found")
	if !ok {
		return
	}
	if member.Role != "owner" && member.Role != "admin" {
		writeError(w, http.StatusForbidden, "only a workspace owner or admin can reassign a leg")
		return
	}
	var req struct {
		HolderUserID string `json:"holder_user_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	newHolder, ok := parseUUIDOrBadRequest(w, req.HolderUserID, "holder_user_id")
	if !ok {
		return
	}
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
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
	if _, err := h.TaskService.ReassignChainStep(r.Context(), h.Queries, issue, actorID, newHolder); err != nil {
		switch {
		case errors.Is(err, service.ErrNoChain):
			writeError(w, http.StatusBadRequest, "this task has no chain")
		case errors.Is(err, service.ErrNewHolderNotInSquad):
			writeError(w, http.StatusBadRequest, "the new holder is not a member of this squad")
		case errors.Is(err, service.ErrNoReassignableStep):
			writeError(w, http.StatusConflict, "no reviewing or parked leg to reassign")
		default:
			writeError(w, http.StatusInternalServerError, "failed to reassign the leg")
		}
		return
	}
	chain, err := h.chainResponse(r.Context(), issue.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "the leg was reassigned but the chain could not be read back")
		return
	}
	writeJSON(w, http.StatusOK, chain)
}

// ExtractIssueChainHandoff re-reads the newest leg-output document and rewrites
// the structured handoff package from its machine-readable block. The holder
// uses it when the automatic extraction missed or the document was edited.
func (h *Handler) ExtractIssueChainHandoff(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	member, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found")
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	holder, err := util.ParseUUID(userID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "user not authenticated")
		return
	}
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	override := member.Role == "owner" || member.Role == "admin"
	if _, err := h.TaskService.ReextractLegHandoff(r.Context(), issue, holder, override); err != nil {
		switch {
		case errors.Is(err, service.ErrNoChain):
			writeError(w, http.StatusBadRequest, "this task has no chain")
		case errors.Is(err, service.ErrNoReviewingStep):
			writeError(w, http.StatusConflict, "nothing is waiting for review on this task")
		case errors.Is(err, service.ErrNotStepHolder):
			writeError(w, http.StatusForbidden, "only the step's holder can extract its handoff")
		case errors.Is(err, service.ErrNoStepAgent):
			writeError(w, http.StatusConflict, "this leg has no agent document")
		case errors.Is(err, service.ErrLegOutputRunning):
			writeError(w, http.StatusConflict, "the leg's summary is still being generated")
		case errors.Is(err, service.ErrNoHandoffDocument):
			writeError(w, http.StatusConflict, "this leg has no completed output document to extract")
		case errors.Is(err, service.ErrHandoffBlockMissing):
			writeError(w, http.StatusConflict, "the output document has no handoff block")
		default:
			writeError(w, http.StatusInternalServerError, "failed to extract the handoff")
		}
		return
	}
	chain, err := h.chainResponse(r.Context(), issue.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "the handoff was extracted but the chain could not be read back")
		return
	}
	writeJSON(w, http.StatusOK, chain)
}

// CancelIssueChainStep stops the running leg at its holder's request. It is
// the first half of recovery from a stalled run; the holder cancels, then the
// leg's cancelled run makes RetryIssueChainStep available.
func (h *Handler) CancelIssueChainStep(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	member, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found")
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	holder, err := util.ParseUUID(userID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "user not authenticated")
		return
	}
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	// The holder owns the turn; a workspace owner/admin is the fallback when
	// the holder is unreachable. The service logs every override.
	override := member.Role == "owner" || member.Role == "admin"
	_, cancelled, err := h.TaskService.CancelChainStep(r.Context(), h.Queries, issue, holder, override)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrNoChain):
			writeError(w, http.StatusBadRequest, "this task has no chain")
		case errors.Is(err, service.ErrNoActiveStep):
			writeError(w, http.StatusConflict, "no leg is being worked on right now")
		case errors.Is(err, service.ErrNotStepHolder):
			writeError(w, http.StatusForbidden, "only the step's holder can cancel it")
		case errors.Is(err, service.ErrNoStepAgent):
			writeError(w, http.StatusConflict, "this leg has no agent")
		case errors.Is(err, service.ErrLegNoActiveRun):
			writeError(w, http.StatusConflict, "this leg has no active run to cancel")
		default:
			writeError(w, http.StatusInternalServerError, "failed to cancel the leg")
		}
		return
	}
	chain, err := h.chainResponse(r.Context(), issue.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "the leg was cancelled but the chain could not be read back")
		return
	}
	writeJSON(w, http.StatusOK, IssueChainCancelResponse{
		IssueChainResponse: chain,
		Cancelled:          cancelled,
	})
}

// RetryIssueChainStep re-runs the leg that is doing after its run was
// interrupted (watchdog, stalled stream, or an explicit cancel). It is the
// holder's operational recovery, not a review action: the step and the baton
// stay where they are.
func (h *Handler) RetryIssueChainStep(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	member, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found")
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	holder, err := util.ParseUUID(userID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "user not authenticated")
		return
	}
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	override := member.Role == "owner" || member.Role == "admin"

	// The retry reruns the leg's own agent, so it passes the same invoke gate
	// a manual rerun does. The holder check inside the service is the relay's
	// personal-view boundary; this stops a holder from re-firing an agent that
	// was never theirs to invoke.
	actorType, actorID := h.resolveActor(r, userID, workspaceID)
	originatorUserID := h.invokeOriginatorFromRequest(r, actorType, actorID)
	canInvoke := func(agent db.Agent) bool {
		return h.canInvokeAgent(r.Context(), agent, actorType, actorID, originatorUserID, workspaceID)
	}

	task, _, err := h.TaskService.RetryChainStep(r.Context(), h.Queries, issue, holder, canInvoke, override)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrNoChain):
			writeError(w, http.StatusBadRequest, "this task has no chain")
		case errors.Is(err, service.ErrNoActiveStep):
			writeError(w, http.StatusConflict, "no leg is being worked on right now")
		case errors.Is(err, service.ErrNotStepHolder):
			writeError(w, http.StatusForbidden, "only the step's holder can retry it")
		case errors.Is(err, service.ErrNoStepAgent):
			writeError(w, http.StatusConflict, "this leg has no agent to retry")
		case errors.Is(err, service.ErrLegAlreadyRunning):
			writeError(w, http.StatusConflict, "this leg's agent is still running")
		case errors.Is(err, service.ErrLegDelivered):
			writeError(w, http.StatusConflict, "this leg's run already finished; review it")
		case errors.Is(err, service.ErrLegNoRetryableRun):
			writeError(w, http.StatusConflict, "this leg has no interrupted run to retry")
		case errors.Is(err, service.ErrRerunInvokeNotAllowed):
			h.writeDispatchBlocked(w, http.StatusForbidden, ReasonInvocationNotAllowed)
		default:
			writeError(w, http.StatusInternalServerError, "failed to retry the leg")
		}
		return
	}

	chain, err := h.chainResponse(r.Context(), issue.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "the leg was retried but the chain could not be read back")
		return
	}
	resp := IssueChainRetryResponse{IssueChainResponse: chain}
	if task != nil {
		resp.TaskID = uuidToString(task.ID)
	}
	writeJSON(w, http.StatusOK, resp)
}

type ListIssueChainsRequest struct {
	IssueIDs []string `json:"issue_ids"`
}

// ListIssueChains returns relays for a whole page of tasks at once.
//
// The task list draws a chain strip per row; asking per issue would turn one
// list view into N requests. Only issues that actually have a chain appear in
// the response — absence is the answer for a plain task.
func (h *Handler) ListIssueChains(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	if _, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found"); !ok {
		return
	}
	var req ListIssueChainsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace_id")
	if !ok {
		return
	}
	if len(req.IssueIDs) == 0 {
		// "Exists but empty" is an empty answer, matching the by-ids issue
		// list: the caller asked about no tasks, so none exist to describe.
		writeJSON(w, http.StatusOK, map[string]any{"chains": []any{}})
		return
	}
	ids, ok := parseUUIDSliceOrBadRequest(w, req.IssueIDs, "issue_ids")
	if !ok {
		return
	}
	steps, err := h.Queries.ListIssueChainStepsByIssues(r.Context(), db.ListIssueChainStepsByIssuesParams{
		WorkspaceID: wsUUID,
		IssueIds:    ids,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load the tasks' chains")
		return
	}
	chains := groupChainSteps(steps)
	writeJSON(w, http.StatusOK, map[string]any{"chains": chains})
}

// groupChainSteps folds the flat joined rows back into one chain per issue,
// preserving the position order the query already sorts by.
func groupChainSteps(steps []db.IssueChainStep) []IssueChainForIssueResponse {
	byIssue := make(map[string]*IssueChainForIssueResponse)
	order := make([]string, 0)
	for _, s := range steps {
		issueID := uuidToString(s.IssueID)
		chain, seen := byIssue[issueID]
		if !seen {
			chain = &IssueChainForIssueResponse{IssueID: issueID}
			byIssue[issueID] = chain
			order = append(order, issueID)
		}
		chain.Steps = append(chain.Steps, chainStepToResponse(s))
		if s.State == service.ChainStateParked {
			chain.Parked = true
		}
	}
	out := make([]IssueChainForIssueResponse, 0, len(order))
	for _, issueID := range order {
		out = append(out, *byIssue[issueID])
	}
	return out
}

type IssueChainForIssueResponse struct {
	IssueID string                   `json:"issue_id"`
	Steps   []IssueChainStepResponse `json:"steps"`
	Parked  bool                     `json:"parked"`
}

type CreateIssueChainRequest struct {
	// Start from a saved playbook.
	PlaybookID string `json:"playbook_id"`
	// The relay as arranged on the compose canvas, for a route that was edited
	// there and never saved as a playbook. Ignored when PlaybookID is set: a
	// named playbook is the record of what was agreed.
	//
	// When both are absent the squad's own order is used — its members in the
	// order they joined, which is the arrangement the squad already has.
	Steps []service.ChainStepSpec `json:"steps"`
}

// CreateIssueChain writes a relay onto an existing task and starts its head.
//
// Separate from creating the task because the two are genuinely separate
// decisions: a task can exist for a while before anyone decides to run it as a
// relay. Idempotent in the sense that matters — a task that already has a
// chain is rejected rather than given a second one, since two relays on one
// task would leave the advance logic guessing which it is driving.
func (h *Handler) CreateIssueChain(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	if _, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found"); !ok {
		return
	}
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	if issue.AssigneeType.String != "squad" || !issue.AssigneeID.Valid {
		writeError(w, http.StatusBadRequest, "only a task assigned to a squad can run as a chain")
		return
	}

	existing, err := h.Queries.ListIssueChainSteps(r.Context(), issue.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read the task's chain")
		return
	}
	if len(existing) > 0 {
		writeError(w, http.StatusConflict, "this task already has a chain")
		return
	}

	var req CreateIssueChainRequest
	// A body is optional: the bare POST means "the squad's own order".
	_ = json.NewDecoder(r.Body).Decode(&req)

	squad, err := h.Queries.GetSquadInWorkspace(r.Context(), db.GetSquadInWorkspaceParams{
		ID:          issue.AssigneeID,
		WorkspaceID: issue.WorkspaceID,
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, "the squad this task is assigned to no longer exists")
		return
	}

	extra, ok := h.chainSpecsFrom(w, r, workspaceID, squad, req.PlaybookID, req.Steps)
	if !ok {
		return
	}

	// One transaction for the whole relay. InstantiateChain writes the leader's
	// step before it reaches the rest, so a route rejected part-way (a bad
	// holder id) would otherwise leave a leader-only chain behind — and the
	// 409 above would then refuse every retry, stranding the task on a relay
	// that can never advance.
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to write the chain")
		return
	}
	defer tx.Rollback(r.Context())

	// The head's state must agree with whether a leader run can claim. This
	// handler is the two-request path (create, then attach the relay); the
	// one-request create decides the same way inside its transaction. Without
	// this, a blocked leader left a doing step with nothing behind it.
	leaderState, leaderReason := service.ChainStateDoing, ""
	if leader, aerr := h.Queries.GetAgent(r.Context(), squad.LeaderID); aerr == nil {
		if verdict, verr := service.AgentReadiness(r.Context(), h.runtimeLookup(obsmetrics.RuntimeLookupSourceIssue), leader); verr == nil && verdict.Blocked() {
			leaderState = service.ChainStateParked
			leaderReason = string(verdict.Reason)
		}
	}
	steps, err := h.TaskService.InstantiateChainWithLeaderState(
		r.Context(), h.Queries.WithTx(tx), issue, squad, extra, leaderState, leaderReason, true,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to write the chain")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to write the chain")
		return
	}

	h.publish(protocol.EventIssueChainChanged, workspaceID, "member", requestUserID(r), map[string]any{
		"issue_id": uuidToString(issue.ID),
	})
	h.TaskService.NotifyParkedChainSteps(r.Context(), issue, steps)
	writeJSON(w, http.StatusCreated, chainToResponse(steps, nil))
}

// chainSpecsFrom resolves the relay after the leader.
//
// Three sources, in precedence order: a named playbook (the record of what was
// agreed), the route handed in with the request (edited on the compose canvas,
// never saved), and last the squad's own order — whoever joined first is next
// in line, which is the arrangement a squad already has rather than a second
// one the user has to maintain.
func (h *Handler) chainSpecsFrom(
	w http.ResponseWriter,
	r *http.Request,
	workspaceID string,
	squad db.Squad,
	playbookID string,
	inline []service.ChainStepSpec,
) ([]service.ChainStepSpec, bool) {
	if playbookID != "" {
		pbUUID, ok := parseUUIDOrBadRequest(w, playbookID, "playbook_id")
		if !ok {
			return nil, false
		}
		wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace_id")
		if !ok {
			return nil, false
		}
		pb, err := h.Queries.GetSquadPlaybookInWorkspace(r.Context(), db.GetSquadPlaybookInWorkspaceParams{
			ID:          pbUUID,
			WorkspaceID: wsUUID,
		})
		if err != nil {
			writeError(w, http.StatusBadRequest, "playbook not found")
			return nil, false
		}
		return service.UnmarshalChainSteps(pb.Steps), true
	}

	if len(inline) > 0 {
		for i := range inline {
			if inline[i].AgentID == "" {
				continue
			}
			holder, err := util.ParseUUID(inline[i].HolderUserID)
			if err != nil {
				writeError(w, http.StatusBadRequest, "chain step has an unreadable holder")
				return nil, false
			}
			// Same rule as binding: a member lends an agent they own. Without
			// this a dispatcher could route work onto someone else's machine.
			if _, ok := h.resolveLentAgent(w, r, "member", holder, inline[i].AgentID); !ok {
				return nil, false
			}
		}
		return inline, true
	}

	members, err := h.Queries.ListSquadMembers(r.Context(), squad.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read the squad's members")
		return nil, false
	}
	specs := make([]service.ChainStepSpec, 0, len(members))
	for _, m := range members {
		if m.MemberType != "member" {
			continue
		}
		specs = append(specs, service.ChainStepSpec{
			HolderUserID: uuidToString(m.MemberID),
			Title:        m.Role,
		})
	}
	return specs, true
}

// ── Playbooks ───────────────────────────────────────────────────────────────

type PlaybookStepResponse struct {
	HolderUserID string `json:"holder_user_id"`
	Title        string `json:"title"`
}

type SquadPlaybookResponse struct {
	ID          string                 `json:"id"`
	WorkspaceID string                 `json:"workspace_id"`
	SquadID     string                 `json:"squad_id"`
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Steps       []PlaybookStepResponse `json:"steps"`
	CreatedBy   string                 `json:"created_by"`
	CreatedAt   string                 `json:"created_at"`
	UpdatedAt   string                 `json:"updated_at"`
}

func playbookToResponse(p db.SquadPlaybook) SquadPlaybookResponse {
	specs := service.UnmarshalChainSteps(p.Steps)
	steps := make([]PlaybookStepResponse, 0, len(specs))
	for _, s := range specs {
		steps = append(steps, PlaybookStepResponse{HolderUserID: s.HolderUserID, Title: s.Title})
	}
	return SquadPlaybookResponse{
		ID:          uuidToString(p.ID),
		WorkspaceID: uuidToString(p.WorkspaceID),
		SquadID:     uuidToString(p.SquadID),
		Name:        p.Name,
		Description: p.Description,
		Steps:       steps,
		CreatedBy:   uuidToString(p.CreatedBy),
		CreatedAt:   timestampToString(p.CreatedAt),
		UpdatedAt:   timestampToString(p.UpdatedAt),
	}
}

// ListSquadPlaybooks returns the chains a squad has saved.
func (h *Handler) ListSquadPlaybooks(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	if _, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found"); !ok {
		return
	}
	squad, _, ok := h.loadSquadInWorkspace(w, r)
	if !ok {
		return
	}
	rows, err := h.Queries.ListSquadPlaybooks(r.Context(), squad.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list playbooks")
		return
	}
	resp := make([]SquadPlaybookResponse, 0, len(rows))
	for _, p := range rows {
		resp = append(resp, playbookToResponse(p))
	}
	writeJSON(w, http.StatusOK, resp)
}

type SaveSquadPlaybookRequest struct {
	Name        string                  `json:"name"`
	Description string                  `json:"description"`
	Steps       []service.ChainStepSpec `json:"steps"`
	ID          string                  `json:"id"`
}

// SaveSquadPlaybook creates a playbook, or replaces one when an id is given.
//
// Steps name people, never agents: a person's binding changes, and a playbook
// that stored the agent would route next month's task to whichever machine
// they happened to be on today.
func (h *Handler) SaveSquadPlaybook(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	member, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found")
	if !ok {
		return
	}
	squad, _, ok := h.loadSquadInWorkspace(w, r)
	if !ok {
		return
	}

	var req SaveSquadPlaybookRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	raw, err := service.MarshalChainSteps(req.Steps)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid steps")
		return
	}

	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace_id")
	if !ok {
		return
	}

	if req.ID != "" {
		pbUUID, ok := parseUUIDOrBadRequest(w, req.ID, "id")
		if !ok {
			return
		}
		pb, err := h.Queries.UpdateSquadPlaybook(r.Context(), db.UpdateSquadPlaybookParams{
			ID:          pbUUID,
			WorkspaceID: wsUUID,
			Name:        req.Name,
			Description: req.Description,
			Steps:       raw,
		})
		if err != nil {
			writeError(w, http.StatusNotFound, "playbook not found")
			return
		}
		writeJSON(w, http.StatusOK, playbookToResponse(pb))
		return
	}

	pb, err := h.Queries.CreateSquadPlaybook(r.Context(), db.CreateSquadPlaybookParams{
		WorkspaceID: wsUUID,
		SquadID:     squad.ID,
		Name:        req.Name,
		Description: req.Description,
		Steps:       raw,
		CreatedBy:   member.UserID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save the playbook")
		return
	}
	writeJSON(w, http.StatusCreated, playbookToResponse(pb))
}

// DeleteSquadPlaybook removes a saved chain. Tasks already running on it keep
// their steps — the chain was copied onto the task when it started.
func (h *Handler) DeleteSquadPlaybook(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	if _, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found"); !ok {
		return
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace_id")
	if !ok {
		return
	}
	id := chi.URLParam(r, "playbookId")
	pbUUID, ok := parseUUIDOrBadRequest(w, id, "playbook_id")
	if !ok {
		return
	}
	affected, err := h.Queries.DeleteSquadPlaybook(r.Context(), db.DeleteSquadPlaybookParams{
		ID:          pbUUID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete the playbook")
		return
	}
	if affected == 0 {
		writeError(w, http.StatusNotFound, "playbook not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
