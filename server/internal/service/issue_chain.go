package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/kscsky/quickwork/server/internal/dispatch"
	"github.com/kscsky/quickwork/server/internal/events"
	"github.com/kscsky/quickwork/server/internal/util"
	db "github.com/kscsky/quickwork/server/pkg/db/generated"
	"github.com/kscsky/quickwork/server/pkg/dbid"
	"github.com/kscsky/quickwork/server/pkg/protocol"
)

// A task handed to a squad is a relay, not a single run. This is the relay:
// the ordered steps, who holds each one, and what happens when the person
// whose turn it is has no agent to run it.
//
// Three states carry the whole idea:
//
//	doing     — this step's agent is running right now
//	reviewing — the run is over and the step waits on its holder's own 通过.
//	            A run can finish wrong; the person who owns the leg is the one
//	            who says whether it finished right, and only their approval
//	            hands the baton on (owner's model, 2026-10-14).
//	parked    — the relay reached this person and they have not bound an agent,
//	            so nothing runs and the task waits. Not an error, not a skip.
//
// Step 0 is always the squad's leading person, because that is who a squad
// dispatch already goes to. The chain describes the hand-offs AFTER them.

const (
	ChainStatePending   = "pending"
	ChainStateDoing     = "doing"
	ChainStateReviewing = "reviewing"
	ChainStateDone      = "done"
	ChainStateParked    = "parked"
	ChainStateSkipped   = "skipped"
)

// LegOutputInstruction is the opening frame for a leg-output run — the
// handoff_note the daemon renders into the run's prompt. It lives in the
// service because the review gate must recognize these runs: while one is
// active, the leg is still writing its package and must not be approved.
const LegOutputInstruction = "Write THIS relay leg's handoff document — follow the quickwork-relay-leg-output skill. " +
	"Post exactly one comment on this issue: the comment body IS the final markdown document, nothing else. " +
	"Your holder will review it and approve to carry it on."

// ChainStepSpec is one authored step, before it has been resolved to an agent.
type ChainStepSpec struct {
	HolderUserID string `json:"holder_user_id"`
	Title        string `json:"title"`
	// Which of the holder's agents runs this step, for one dispatch only.
	// Empty means the agent they lend the room, resolved at instantiation time
	// from their current binding. A per-dispatch choice rather than a squad
	// default: which agent to use is a decision about THIS task.
	AgentID string `json:"agent_id,omitempty"`
}

// ChainHandoffFile is one entry of a leg's handoff package. Deliberately loose:
// a file the leg produced is named by whatever pointer the holder curates —
// an attachment id when it uploaded one, a branch name when the run delivered
// on one — and unknown kinds from a newer client must render, not reject.
type ChainHandoffFile struct {
	Name string `json:"name"`
	Size int64  `json:"size,omitempty"`
	// AttachmentID links back to an uploaded attachment when the entry is one.
	AttachmentID string `json:"attachment_id,omitempty"`
	// Kind is the entry's flavour ("attachment", "branch", "").
	Kind string `json:"kind,omitempty"`
}

// ChainHandoffAcceptance is one row of the handoff's acceptance ledger: what
// this leg promised, what it actually handed over, and whether that counts as
// met. "warn" is deliberate — a known gap the next holder should see, not a
// failure that blocks the baton.
type ChainHandoffAcceptance struct {
	Label       string `json:"label"`
	Requirement string `json:"requirement"`
	Delivered   string `json:"delivered"`
	State       string `json:"state"`
}

// ChainHandoffReturn records that the holder sent the leg back for revision.
// It survives the rerun so the next review round still sees why.
type ChainHandoffReturn struct {
	Reason string `json:"reason"`
	At     string `json:"at,omitempty"`
}

// ChainHandoffPackage is the structured part of a handoff. Kept separate from
// Summary/Files on the wire only for older clients: this build always reads and
// writes the whole package.
type ChainHandoffPackage struct {
	Acceptance    []ChainHandoffAcceptance `json:"acceptance,omitempty"`
	OpenQuestions []string                 `json:"open_questions,omitempty"`
	NextBrief     []string                 `json:"next_brief,omitempty"`
	Returned      *ChainHandoffReturn      `json:"returned,omitempty"`
}

// ChainHandoff is the package a leg publishes on 通过: the files the holder
// ticked, the summary they wrote, and the acceptance ledger / open questions /
// next-leg brief that make the handoff reviewable. What crosses the leg
// boundary is the holder's call — this is the curated side of the leg, not its
// raw content.
type ChainHandoff struct {
	Summary       string                   `json:"summary"`
	Files         []ChainHandoffFile       `json:"files"`
	Acceptance    []ChainHandoffAcceptance `json:"acceptance,omitempty"`
	OpenQuestions []string                 `json:"open_questions,omitempty"`
	NextBrief     []string                 `json:"next_brief,omitempty"`
	Returned      *ChainHandoffReturn      `json:"returned,omitempty"`
}

// packageFields isolates what lives in handoff_package. Summary and Files keep
// their own columns so a client that predates this structure still reads the
// package it knows.
func (h *ChainHandoff) packageFields() ChainHandoffPackage {
	if h == nil {
		return ChainHandoffPackage{}
	}
	return ChainHandoffPackage{
		Acceptance:    h.Acceptance,
		OpenQuestions: h.OpenQuestions,
		NextBrief:     h.NextBrief,
		Returned:      h.Returned,
	}
}

// InstantiateChain writes a task's chain and starts its first step.
//
// `extra` is the relay after the leader — from a playbook when the caller
// picked one, otherwise the squad's other members in the order they joined.
// Agents are resolved NOW from each person's current binding and stored on the
// step, so the chain is a record of what was agreed rather than a live query
// that changes under it.
func (s *TaskService) InstantiateChain(
	ctx context.Context,
	q *db.Queries,
	issue db.Issue,
	squad db.Squad,
	extra []ChainStepSpec,
) ([]db.IssueChainStep, error) {
	return s.instantiateChain(ctx, q, issue, squad, extra, ChainStateDoing, "", true)
}

// InstantiateChainWithLeaderState writes the relay with an explicit head state.
//
// The head is the one step whose state depends on a dispatch that has not
// necessarily happened yet: a leader whose agent cannot claim must start the
// chain parked, not pretend a run is in flight. Callers decide the state from
// the same readiness predicate dispatch uses.
func (s *TaskService) InstantiateChainWithLeaderState(
	ctx context.Context,
	q *db.Queries,
	issue db.Issue,
	squad db.Squad,
	extra []ChainStepSpec,
	leaderState string,
	leaderReason string,
	syncStatus bool,
) ([]db.IssueChainStep, error) {
	if leaderState == "" {
		leaderState = ChainStateDoing
	}
	return s.instantiateChain(ctx, q, issue, squad, extra, leaderState, leaderReason, syncStatus)
}

func (s *TaskService) instantiateChain(
	ctx context.Context,
	q *db.Queries,
	issue db.Issue,
	squad db.Squad,
	extra []ChainStepSpec,
	leaderState string,
	leaderReason string,
	syncStatus bool,
) ([]db.IssueChainStep, error) {
	steps := make([]db.IssueChainStep, 0, len(extra)+1)

	// Step 0: whoever leads the squad. Their agent is the one the dispatch
	// already went to, so the chain agrees with the run that is starting.
	leaderHolder, leaderAgent := s.leadingMember(ctx, q, squad)
	if leaderHolder.Valid {
		first, err := q.CreateIssueChainStep(ctx, db.CreateIssueChainStepParams{
			IssueID:      issue.ID,
			Position:     0,
			HolderUserID: leaderHolder,
			AgentID:      leaderAgent,
			Title:        "拆解与定方案",
			State:        leaderState,
		})
		if err != nil {
			return nil, fmt.Errorf("create chain step 0: %w", err)
		}
		if leaderState == ChainStateParked && leaderReason != "" {
			first, err = q.SetIssueChainStepParked(ctx, db.SetIssueChainStepParkedParams{
				IssueID:      issue.ID,
				Position:     0,
				ParkedReason: leaderReason,
			})
			if err != nil {
				return nil, fmt.Errorf("park chain step 0: %w", err)
			}
		}
		steps = append(steps, first)
	}

	position := int32(len(steps))
	for _, spec := range extra {
		holder, err := util.ParseUUID(spec.HolderUserID)
		if err != nil {
			// An unparsable holder would silently drop a step from the
			// relay. Fail the whole instantiation instead: a chain that is
			// missing a link is worse than no chain.
			return nil, fmt.Errorf("chain step %d: bad holder id %q", position, spec.HolderUserID)
		}
		// Skipping the leader here keeps the first step and the relay from
		// both naming them.
		if holder == leaderHolder {
			continue
		}
		// The dispatch's own choice wins over the squad binding. The handler
		// has already checked the agent belongs to this holder.
		agent := s.lentAgentOfMember(ctx, q, squad.ID, holder)
		if spec.AgentID != "" {
			if override, err := util.ParseUUID(spec.AgentID); err == nil {
				agent = override
			}
		}
		step, err := q.CreateIssueChainStep(ctx, db.CreateIssueChainStepParams{
			IssueID:      issue.ID,
			Position:     position,
			HolderUserID: holder,
			AgentID:      agent,
			Title:        spec.Title,
			State:        ChainStatePending,
		})
		if err != nil {
			return nil, fmt.Errorf("create chain step %d: %w", position, err)
		}
		steps = append(steps, step)
		position++
	}
	// The relay has started (step 0 is doing): the task is now in progress,
	// wherever it was parked before the squad got it. The create transaction
	// opts out and re-projects after commit: broadcasting a status change from
	// inside an uncommitted transaction would announce a state no reader can
	// see yet.
	if syncStatus {
		s.syncRelayStatus(ctx, q, issue.ID)
	}
	return steps, nil
}

// leadingMember resolves the squad member whose turn step 0 is.
//
// Read from squad_member rather than guessed from squad.leader_id: the leader
// agent records which agent leads, not which PERSON does, and the chain is
// about people.
func (s *TaskService) leadingMember(ctx context.Context, q *db.Queries, squad db.Squad) (pgtype.UUID, pgtype.UUID) {
	members, err := q.ListSquadMembers(ctx, squad.ID)
	if err != nil {
		return pgtype.UUID{}, pgtype.UUID{}
	}
	for _, m := range members {
		if m.MemberType == "member" && m.Role == "leader" {
			return m.MemberID, squad.LeaderID
		}
	}
	// No member row carries the leader role — a squad whose roles predate the
	// room. The first person in is the closest thing to a lead we can name.
	// Returning nothing instead would leave the relay without a step 0 while a
	// run is already on its way to the leader agent.
	for _, m := range members {
		if m.MemberType == "member" {
			return m.MemberID, squad.LeaderID
		}
	}
	return pgtype.UUID{}, squad.LeaderID
}

// lentAgentOfMember is the agent a person brings to this squad.
func (s *TaskService) lentAgentOfMember(ctx context.Context, q *db.Queries, squadID, userID pgtype.UUID) pgtype.UUID {
	members, err := q.ListSquadMembers(ctx, squadID)
	if err != nil {
		return pgtype.UUID{}
	}
	for _, m := range members {
		if m.MemberType == "member" && m.MemberID == userID {
			return m.AgentID
		}
	}
	return pgtype.UUID{}
}

// AdvanceChain moves the relay on after a run finishes.
//
// Called once per completed task, after the completion transaction has
// committed. The `agentID` guard matters: a squad task can also receive runs
// that have nothing to do with the relay (someone @mentions an agent on the
// card), and completing one of those must not push the chain forward.
//
// Returns the step the chain is now waiting on, or nil when it did not move.
func (s *TaskService) AdvanceChain(ctx context.Context, q *db.Queries, issueID pgtype.UUID, agentID pgtype.UUID) (*db.IssueChainStep, error) {
	steps, err := q.ListIssueChainSteps(ctx, issueID)
	if err != nil {
		return nil, err
	}
	if len(steps) == 0 {
		return nil, nil // not a relay task
	}

	current := -1
	for i, step := range steps {
		if step.State == ChainStateDoing {
			current = i
			break
		}
	}
	if current < 0 {
		// Nothing is running. The head may never have been started (a chain
		// written by hand, or one whose first step was skipped), so the first
		// pending step is the one to move.
		for i, step := range steps {
			if step.State == ChainStatePending {
				current = i - 1
				break
			}
		}
		if current < 0 {
			return nil, nil
		}
	}

	// Only the step's own agent finishing advances it.
	if agentID.Valid && steps[current].AgentID != agentID {
		return nil, nil
	}

	if steps[current].State == ChainStateDoing {
		// The run is over, the leg is not: the relay stops on the holder's
		// own review. ApproveChainStep is what carries it on from here.
		reviewing, err := q.SetIssueChainStepState(ctx, db.SetIssueChainStepStateParams{
			IssueID:  issueID,
			Position: steps[current].Position,
			State:    ChainStateReviewing,
		})
		if err != nil {
			return nil, err
		}
		return &reviewing, nil
	}

	next, err := s.startNextStep(ctx, q, issueID, steps, current)
	if err != nil {
		return nil, err
	}
	// `next` is a started step, a freshly parked one, or nil (chain over) —
	// all three are status transitions the projection must follow.
	s.syncRelayStatus(ctx, q, issueID)
	return next, nil
}

// resolveRelayTurn archives the pending "your turn" notification for one leg.
// A turn item is only meaningful while its leg is waiting; once the leg moves,
// leaving it unread keeps the sidebar badge and the activity band lying.
func (s *TaskService) resolveRelayTurn(
	ctx context.Context,
	q *db.Queries,
	issueID pgtype.UUID,
	position int32,
) {
	if _, err := q.ResolveRelayTurnInbox(ctx, db.ResolveRelayTurnInboxParams{
		IssueID: issueID,
		Column2: fmt.Sprintf("%d", position),
	}); err != nil {
		slog.Warn("could not resolve relay turn notification",
			"issue_id", util.UUIDToString(issueID),
			"position", position,
			"error", err)
	}
}

// recordRelayActivity writes the audit row behind 活动日志. Only decisions that
// change the relay are recorded (approve / return / reassign / skip); runs,
// comments, parking and recovery stay on the issue. A logging failure never
// blocks the action itself.
func (s *TaskService) recordRelayActivity(
	ctx context.Context,
	q *db.Queries,
	issue db.Issue,
	actorID pgtype.UUID,
	action string,
	position int32,
	fromID pgtype.UUID,
	toID pgtype.UUID,
	reason string,
	admin bool,
) {
	if !actorID.Valid {
		return
	}
	details := map[string]any{"leg": position + 1}
	if fromID.Valid {
		details["from_user_id"] = util.UUIDToString(fromID)
	}
	if toID.Valid {
		details["to_user_id"] = util.UUIDToString(toID)
	}
	if reason != "" {
		details["reason"] = reason
	}
	if admin {
		details["admin"] = true
	}
	raw, err := json.Marshal(details)
	if err != nil {
		return
	}
	if _, err := q.CreateActivity(ctx, db.CreateActivityParams{
		WorkspaceID: issue.WorkspaceID,
		IssueID:     issue.ID,
		ActorType:   pgtype.Text{String: "member", Valid: true},
		ActorID:     actorID,
		Action:      action,
		Details:     raw,
	}); err != nil {
		slog.Warn("could not record relay activity",
			"issue_id", util.UUIDToString(issue.ID),
			"action", action,
			"error", err)
	}
}

// ApproveChainStep is the holder's own 通过 — the last thing a leg needs before
// the baton moves. The run finishing only parked the step in `reviewing`; this
// is the person saying the output is what they meant to hand over.
//
// Only the step's holder may approve. That single rule is the permission the
// personal-view relay hangs on ("只有这一棒的负责人能点通过"), so it lives here
// rather than in the UI.
func (s *TaskService) ApproveChainStep(ctx context.Context, q *db.Queries, issue db.Issue, holderID pgtype.UUID, handoff *ChainHandoff) (*db.IssueChainStep, error) {
	steps, err := q.ListIssueChainSteps(ctx, issue.ID)
	if err != nil {
		return nil, err
	}
	if len(steps) == 0 {
		return nil, ErrNoChain
	}
	current := -1
	for i, step := range steps {
		if step.State == ChainStateReviewing {
			current = i
			break
		}
	}
	if current < 0 {
		return nil, ErrNoReviewingStep
	}
	if steps[current].HolderUserID != holderID {
		return nil, ErrNotStepHolder
	}
	// The run the holder asked for is still writing this leg's package. The
	// chain must not move underneath it: the summary would land after the leg
	// turned done, outside the leg's comment boundary, and the package would
	// be approved empty. This is server-side on purpose — the review UI's
	// "generating" state is only a hint and is lost on reload.
	if running, err := s.legOutputRunning(ctx, q, issue.ID, steps[current].AgentID); err != nil {
		return nil, err
	} else if running {
		return nil, ErrLegOutputRunning
	}
	// A leg passes WITH its handoff. The summary is what the next holder reads;
	// the acceptance ledger is what they check; the next-leg brief is what the
	// next agent acts on. Approving bare would move the chain on an empty
	// package and make all three decorative.
	if handoff == nil || strings.TrimSpace(handoff.Summary) == "" {
		return nil, ErrHandoffRequired
	}
	if len(handoff.Acceptance) == 0 {
		return nil, ErrHandoffAcceptanceRequired
	}
	if steps[current].Position < int32(len(steps)-1) && len(handoff.NextBrief) == 0 {
		return nil, ErrHandoffNextBriefRequired
	}
	// The handoff package lands before the state moves: the approve response
	// carries the chain as it now stands, and readers of the finished leg must
	// see the package in the same read that shows it done.
	if handoff != nil {
		filesJSON, err := json.Marshal(handoff.Files)
		if err != nil {
			return nil, err
		}
		if handoff.Files == nil {
			filesJSON = []byte("[]")
		}
		pkgJSON, err := json.Marshal(handoff.packageFields())
		if err != nil {
			return nil, err
		}
		if _, err := q.SetIssueChainStepHandoff(ctx, db.SetIssueChainStepHandoffParams{
			IssueID:        issue.ID,
			Position:       steps[current].Position,
			HandoffSummary: handoff.Summary,
			HandoffFiles:   filesJSON,
			HandoffPackage: pkgJSON,
		}); err != nil {
			return nil, err
		}
	}
	if _, err := q.SetIssueChainStepState(ctx, db.SetIssueChainStepStateParams{
		IssueID:  issue.ID,
		Position: steps[current].Position,
		State:    ChainStateDone,
	}); err != nil {
		return nil, err
	}
	steps[current].State = ChainStateDone
	s.resolveRelayTurn(ctx, q, issue.ID, steps[current].Position)
	s.recordRelayActivity(ctx, q, issue, holderID, "relay_approved",
		steps[current].Position, steps[current].HolderUserID, pgtype.UUID{}, "", false)
	next, err := s.startNextStep(ctx, q, issue.ID, steps, current)
	if err != nil {
		return nil, err
	}
	if next != nil {
		s.dispatchChainStep(ctx, issue, *next)
	} else {
		s.postChainCompletedMessage(ctx, issue)
	}
	s.syncRelayStatus(ctx, q, issue.ID)
	slog.Info("chain leg approved",
		"issue_id", util.UUIDToString(issue.ID),
		"position", steps[current].Position,
		"holder_user_id", util.UUIDToString(holderID))
	return next, nil
}

// ReturnChainStep is the holder's "退回修改": the run finished, but not in a
// state they are willing to hand on. It keeps the package they were reviewing,
// records the reason on it, puts the leg back in `doing`, and asks the leg's
// own agent to address the feedback. The baton does not move.
//
// The package is written even though the leg is not approved: the next review
// round must show what was asked for, and the rerun must see the same gap the
// holder saw. The approval path overwrites it with the accepted package.
func (s *TaskService) ReturnChainStep(
	ctx context.Context,
	q *db.Queries,
	issue db.Issue,
	holderID pgtype.UUID,
	handoff *ChainHandoff,
	reason string,
) (*db.IssueChainStep, error) {
	steps, err := q.ListIssueChainSteps(ctx, issue.ID)
	if err != nil {
		return nil, err
	}
	if len(steps) == 0 {
		return nil, ErrNoChain
	}
	current := -1
	for i, step := range steps {
		if step.State == ChainStateReviewing {
			current = i
			break
		}
	}
	if current < 0 {
		return nil, ErrNoReviewingStep
	}
	if steps[current].HolderUserID != holderID {
		return nil, ErrNotStepHolder
	}
	if !steps[current].AgentID.Valid {
		return nil, ErrNoStepAgent
	}
	// A return would enqueue a revision run while the leg's agent is still
	// writing the package. The package is about to be sent back anyway, but
	// the active run must not be left running against a moving leg.
	if running, err := s.legOutputRunning(ctx, q, issue.ID, steps[current].AgentID); err != nil {
		return nil, err
	} else if running {
		return nil, ErrLegOutputRunning
	}
	if handoff == nil {
		handoff = &ChainHandoff{}
	}
	handoff.Returned = &ChainHandoffReturn{
		Reason: reason,
		At:     time.Now().UTC().Format(time.RFC3339),
	}
	filesJSON, err := json.Marshal(handoff.Files)
	if err != nil {
		return nil, err
	}
	if handoff.Files == nil {
		filesJSON = []byte("[]")
	}
	pkgJSON, err := json.Marshal(handoff.packageFields())
	if err != nil {
		return nil, err
	}
	if _, err := q.SetIssueChainStepHandoff(ctx, db.SetIssueChainStepHandoffParams{
		IssueID:        issue.ID,
		Position:       steps[current].Position,
		HandoffSummary: handoff.Summary,
		HandoffFiles:   filesJSON,
		HandoffPackage: pkgJSON,
	}); err != nil {
		return nil, err
	}
	returned, err := q.SetIssueChainStepState(ctx, db.SetIssueChainStepStateParams{
		IssueID:  issue.ID,
		Position: steps[current].Position,
		State:    ChainStateDoing,
	})
	if err != nil {
		return nil, err
	}

	const returnNote = "The relay holder returned this leg for revision. Reason: %s\n\n" +
		"Revise the work to address that reason, then deliver the leg again. " +
		"The holder reviews and passes the baton; do not ask them to approve on your behalf."
	if _, err := s.EnqueueTaskForMentionWithNote(ctx, issue, steps[current].AgentID, pgtype.UUID{}, fmt.Sprintf(returnNote, reason)); err != nil {
		// The leg is still the holder's to retry: put it back in review rather
		// than leave a `doing` step with no run behind it.
		if _, resetErr := q.SetIssueChainStepState(ctx, db.SetIssueChainStepStateParams{
			IssueID:  issue.ID,
			Position: steps[current].Position,
			State:    ChainStateReviewing,
		}); resetErr != nil {
			slog.Warn("returned chain step could not be reset to reviewing",
				"issue_id", util.UUIDToString(issue.ID),
				"position", steps[current].Position,
				"error", resetErr)
		}
		return nil, err
	}
	s.resolveRelayTurn(ctx, q, issue.ID, steps[current].Position)
	s.recordRelayActivity(ctx, q, issue, holderID, "relay_returned",
		steps[current].Position, steps[current].HolderUserID, pgtype.UUID{}, reason, false)
	s.publishChainChanged(issue)
	s.syncRelayStatus(ctx, q, issue.ID)
	return &returned, nil
}

// SetChainStepPlan records the holder's own brief for their leg.
//
// The brief belongs to the person whose turn this is (or is about to be).
// The next person is handed the previous leg's OUTPUT — never a brief written
// on their behalf — which is what makes the view personal. Writing somebody
// else's leg is refused here, not in the UI.
func (s *TaskService) SetChainStepPlan(ctx context.Context, q *db.Queries, issue db.Issue, holderID pgtype.UUID, plan string) (*db.IssueChainStep, error) {
	steps, err := q.ListIssueChainSteps(ctx, issue.ID)
	if err != nil {
		return nil, err
	}
	if len(steps) == 0 {
		return nil, ErrNoChain
	}
	mine := -1
	for i, step := range steps {
		if step.HolderUserID != holderID {
			continue
		}
		if step.State == ChainStateDone || step.State == ChainStateSkipped {
			continue
		}
		mine = i
		break
	}
	if mine < 0 {
		return nil, ErrNotStepHolder
	}
	saved, err := q.SetIssueChainStepPlan(ctx, db.SetIssueChainStepPlanParams{
		IssueID:  issue.ID,
		Position: steps[mine].Position,
		Plan:     plan,
	})
	if err != nil {
		return nil, err
	}
	return &saved, nil
}

// SkipChainStep moves the relay past a waiting leg. allowReviewing is the
// owner/admin fallback for an unreachable holder: without it only a PARKED
// step can be skipped, so nobody can bypass a holder's own review.
func (s *TaskService) SkipChainStep(
	ctx context.Context,
	q *db.Queries,
	issue db.Issue,
	allowReviewing bool,
	actorID pgtype.UUID,
	actorIsAdmin bool,
) (*db.IssueChainStep, error) {
	steps, err := q.ListIssueChainSteps(ctx, issue.ID)
	if err != nil {
		return nil, err
	}
	if len(steps) == 0 {
		return nil, ErrNoChain
	}
	current := -1
	for i, step := range steps {
		if step.State == ChainStateParked {
			current = i
			break
		}
	}
	if current < 0 && allowReviewing {
		for i, step := range steps {
			if step.State == ChainStateReviewing {
				current = i
				break
			}
		}
	}
	if current < 0 {
		return nil, ErrNoParkedStep
	}
	if _, err := q.SetIssueChainStepState(ctx, db.SetIssueChainStepStateParams{
		IssueID:  issue.ID,
		Position: steps[current].Position,
		State:    ChainStateSkipped,
	}); err != nil {
		return nil, err
	}
	steps[current].State = ChainStateSkipped
	s.resolveRelayTurn(ctx, q, issue.ID, steps[current].Position)
	s.recordRelayActivity(ctx, q, issue, actorID, "relay_skipped",
		steps[current].Position, steps[current].HolderUserID, pgtype.UUID{}, steps[current].ParkedReason, actorIsAdmin)

	next, err := s.startNextStep(ctx, q, issue.ID, steps, current)
	if err != nil {
		return nil, err
	}
	if next != nil {
		s.dispatchChainStep(ctx, issue, *next)
	}
	s.syncRelayStatus(ctx, q, issue.ID)
	return next, nil
}

// startNextStep moves the relay to the step after `current` and reports where
// it landed: a started step, a freshly parked one, or nil when the chain is
// over. Shared by the three ways a step ends — a run finishing, a skip, and
// nothing else.
//
// Refuses to move unless the step being left behind is finished. `current`
// arrives as -1 only for a chain whose head was never started, which is the
// one case of "move from nowhere" that means start the head.
func (s *TaskService) startNextStep(
	ctx context.Context,
	q *db.Queries,
	issueID pgtype.UUID,
	steps []db.IssueChainStep,
	current int,
) (*db.IssueChainStep, error) {
	if current >= 0 {
		switch steps[current].State {
		case ChainStateDone, ChainStateSkipped:
		default:
			return nil, nil
		}
	}

	next := current + 1
	if next >= len(steps) {
		slog.Info("issue chain finished",
			"issue_id", util.UUIDToString(issueID))
		return nil, nil
	}

	target := steps[next]
	if !target.AgentID.Valid {
		// The relay reached someone with no agent. Park — do not skip, do not
		// advance past them, do not fail the task.
		parked, err := q.SetIssueChainStepParked(ctx, db.SetIssueChainStepParkedParams{
			IssueID:      issueID,
			Position:     target.Position,
			ParkedReason: string(dispatch.ReasonNoAgent),
		})
		if err != nil {
			return nil, err
		}
		slog.Info("issue chain parked: holder has no agent",
			"issue_id", util.UUIDToString(issueID),
			"position", target.Position,
			"holder_user_id", util.UUIDToString(target.HolderUserID))
		return &parked, nil
	}

	// The agent must be able to CLAIM the work, not merely exist. Claim's
	// authorization fence is stricter than "has an agent" — a private runtime
	// only executes its owner's agents, and an archived agent or unbound
	// runtime never claims at all. Parking here, with the machine's own reason,
	// is what keeps a relay from queueing a task that nothing will ever pick up.
	//
	// A failed lookup is not a blocked verdict: the claim fence still protects
	// the queue, and failing open keeps a transient DB hiccup from freezing
	// every relay.
	if verdict, ok := s.chainStepVerdict(ctx, q, target.AgentID); ok && verdict.Blocked() {
		parked, err := q.SetIssueChainStepParked(ctx, db.SetIssueChainStepParkedParams{
			IssueID:      issueID,
			Position:     target.Position,
			ParkedReason: string(verdict.Reason),
		})
		if err != nil {
			return nil, err
		}
		slog.Info("issue chain parked: agent cannot claim the leg",
			"issue_id", util.UUIDToString(issueID),
			"position", target.Position,
			"agent_id", util.UUIDToString(target.AgentID),
			"reason", verdict.Reason,
			"detail", verdict.Detail)
		return &parked, nil
	}

	started, err := q.SetIssueChainStepState(ctx, db.SetIssueChainStepStateParams{
		IssueID:  issueID,
		Position: target.Position,
		State:    ChainStateDoing,
	})
	if err != nil {
		return nil, err
	}
	return &started, nil
}

// chainStepVerdict asks the one shared readiness predicate whether a leg's
// agent can claim work at all. ok=false means the question could not be
// answered (missing agent row or a read failure); callers then fall back to
// queueing, which the claim fence still guards.
func (s *TaskService) chainStepVerdict(ctx context.Context, q *db.Queries, agentID pgtype.UUID) (AgentVerdict, bool) {
	if !agentID.Valid {
		return AgentVerdict{}, false
	}
	agent, err := q.GetAgent(ctx, agentID)
	if err != nil {
		slog.Warn("chain leg readiness could not load its agent",
			"agent_id", util.UUIDToString(agentID), "error", err)
		return AgentVerdict{}, false
	}
	verdict, err := AgentReadiness(ctx, s.runtimeLookupOn(q), agent)
	if err != nil {
		slog.Warn("chain leg readiness could not load its runtime",
			"agent_id", util.UUIDToString(agentID), "error", err)
		return AgentVerdict{}, false
	}
	return verdict, true
}

// ResumeParkedChain restarts the relays that parked on this person.
//
// Parking happens because the holder had no agent, so binding one is the fix —
// this is where the room message's promise ("绑一个就能接着走") is kept. Without
// it a parked step would sit until someone skipped it by hand, even though the
// obstacle is gone.
//
// Returns how many steps were restarted. Best-effort per step: one failed
// dispatch must not stop the others.
func (s *TaskService) ResumeParkedChain(ctx context.Context, q *db.Queries, squadID, holderID, agentID pgtype.UUID) int {
	if !agentID.Valid {
		return 0
	}
	steps, err := q.ListParkedChainStepsForHolder(ctx, db.ListParkedChainStepsForHolderParams{
		HolderUserID: holderID,
		AssigneeID:   squadID,
	})
	if err != nil {
		slog.Warn("could not look for parked steps to resume",
			"squad_id", util.UUIDToString(squadID), "error", err)
		return 0
	}
	resumed := 0
	for _, step := range steps {
		// Binding an agent is only the fix when that agent can actually claim
		// the leg. The holder may have bound an agent that sits on someone
		// else's private machine, or on a machine whose CLI cannot run; in that
		// case keep the leg parked and move the reason to the real blocker
		// instead of queueing a run nobody will ever claim.
		if verdict, ok := s.chainStepVerdict(ctx, q, agentID); ok && verdict.Blocked() {
			if _, err := q.SetIssueChainStepParked(ctx, db.SetIssueChainStepParkedParams{
				IssueID:      step.IssueID,
				Position:     step.Position,
				ParkedReason: string(verdict.Reason),
			}); err != nil {
				slog.Warn("could not keep a parked chain step parked after its agent rebind",
					"issue_id", util.UUIDToString(step.IssueID), "error", err)
				continue
			}
			slog.Info("resumed chain step stayed parked: its new agent cannot claim the leg",
				"issue_id", util.UUIDToString(step.IssueID),
				"position", step.Position,
				"reason", verdict.Reason,
				"detail", verdict.Detail)
			continue
		}
		if _, err := q.StartIssueChainStep(ctx, db.StartIssueChainStepParams{
			IssueID:  step.IssueID,
			Position: step.Position,
			AgentID:  agentID,
		}); err != nil {
			slog.Warn("could not resume a parked chain step",
				"issue_id", util.UUIDToString(step.IssueID), "error", err)
			continue
		}
		s.resolveRelayTurn(ctx, q, step.IssueID, step.Position)
		issue, err := q.GetIssue(ctx, step.IssueID)
		if err != nil {
			slog.Warn("resumed chain step could not load its issue",
				"issue_id", util.UUIDToString(step.IssueID), "error", err)
			continue
		}
		if _, err := s.EnqueueTaskForMention(ctx, issue, agentID, pgtype.UUID{}); err != nil {
			slog.Warn("resumed chain step could not be dispatched",
				"issue_id", util.UUIDToString(step.IssueID), "error", err)
			continue
		}
		s.publishChainChanged(issue)
		// Parking put this task on `blocked`; the resume is what takes it off.
		s.syncRelayStatus(ctx, q, step.IssueID)
		slog.Info("issue chain resumed after its holder bound an agent",
			"issue_id", util.UUIDToString(step.IssueID),
			"position", step.Position)
		resumed++
	}
	return resumed
}

// RetryChainStep re-runs the leg that is currently doing when its newest run
// ended in failure (watchdog kill, provider stall, user cancel).
//
// Only the step's holder may retry: this restarts their own work on their own
// agent, and the chain stays exactly where it was — no review, no baton move.
// The retry is a manual rerun of the failed task, so it inherits that task's
// trigger provenance, squad role and fresh-session policy. If the agent can no
// longer claim the leg, the step parks with the same reason dispatch would use
// instead of queueing a run nobody will pick up.
func (s *TaskService) RetryChainStep(
	ctx context.Context,
	q *db.Queries,
	issue db.Issue,
	holderID pgtype.UUID,
	canInvoke func(db.Agent) bool,
	override bool,
) (*db.AgentTaskQueue, *db.IssueChainStep, error) {
	steps, err := q.ListIssueChainSteps(ctx, issue.ID)
	if err != nil {
		return nil, nil, err
	}
	if len(steps) == 0 {
		return nil, nil, ErrNoChain
	}
	var active *db.IssueChainStep
	for i := range steps {
		if steps[i].State == ChainStateDoing {
			active = &steps[i]
			break
		}
	}
	if active == nil {
		return nil, nil, ErrNoActiveStep
	}
	if active.HolderUserID != holderID {
		if !override {
			return nil, nil, ErrNotStepHolder
		}
		slog.Warn("relay retry overridden by a workspace admin",
			"issue_id", util.UUIDToString(issue.ID),
			"position", active.Position,
			"holder_user_id", util.UUIDToString(active.HolderUserID),
			"actor_user_id", util.UUIDToString(holderID))
	}
	if !active.AgentID.Valid {
		return nil, nil, ErrNoStepAgent
	}

	tasks, err := q.ListTasksByIssue(ctx, issue.ID)
	if err != nil {
		return nil, nil, err
	}
	// The newest run of THIS agent that is not the leg's handoff-writing turn.
	// The output run has its own lifecycle (gated at approve); retrying it
	// instead of the leg's work would ask the agent to write a summary of a run
	// that never happened.
	var latest *db.AgentTaskQueue
	for i := range tasks {
		task := &tasks[i]
		if task.AgentID != active.AgentID {
			continue
		}
		if task.HandoffNote.Valid && task.HandoffNote.String == LegOutputInstruction {
			continue
		}
		if latest == nil || task.CreatedAt.Time.After(latest.CreatedAt.Time) {
			latest = task
		}
	}
	if latest == nil {
		return nil, nil, ErrLegNoRetryableRun
	}
	if activeAgentTaskStatus(latest.Status) {
		return nil, nil, ErrLegAlreadyRunning
	}
	if latest.Status == "completed" {
		return nil, nil, ErrLegDelivered
	}
	if latest.Status != "failed" && latest.Status != "cancelled" {
		return nil, nil, ErrLegNoRetryableRun
	}

	if verdict, ok := s.chainStepVerdict(ctx, q, active.AgentID); ok && verdict.Blocked() {
		parked, err := q.SetIssueChainStepParked(ctx, db.SetIssueChainStepParkedParams{
			IssueID:      issue.ID,
			Position:     active.Position,
			ParkedReason: string(verdict.Reason),
		})
		if err != nil {
			return nil, nil, err
		}
		// Same surface as a dispatch-time park: publish the chain and tell the
		// room who cannot take the leg and why.
		s.dispatchChainStep(ctx, issue, parked)
		slog.Info("chain retry kept the leg parked: agent cannot claim",
			"issue_id", util.UUIDToString(issue.ID),
			"position", active.Position,
			"reason", verdict.Reason,
			"detail", verdict.Detail)
		return nil, &parked, nil
	}

	task, err := s.RerunIssue(ctx, issue.ID, latest.ID, pgtype.UUID{}, holderID, canInvoke)
	if err != nil {
		return nil, nil, err
	}
	slog.Info("chain leg retried",
		"issue_id", util.UUIDToString(issue.ID),
		"position", active.Position,
		"task_id", util.UUIDToString(task.ID),
		"source_task_id", util.UUIDToString(latest.ID))
	return task, active, nil
}

// ReassignChainStep moves a waiting leg to another squad member. It is the
// owner/admin fallback for a holder who is unreachable: a reviewing leg keeps
// the agent that did the work (the new holder reviews it), while a parked leg
// takes the new holder's lent agent and starts if that agent can claim.
func (s *TaskService) ReassignChainStep(
	ctx context.Context,
	q *db.Queries,
	issue db.Issue,
	actorID pgtype.UUID,
	newHolderID pgtype.UUID,
) (*db.IssueChainStep, error) {
	if !newHolderID.Valid {
		return nil, ErrNewHolderNotInSquad
	}
	if issue.AssigneeType.String != "squad" || !issue.AssigneeID.Valid {
		return nil, ErrNoChain
	}
	squad, err := q.GetSquadInWorkspace(ctx, db.GetSquadInWorkspaceParams{
		ID:          issue.AssigneeID,
		WorkspaceID: issue.WorkspaceID,
	})
	if err != nil {
		return nil, ErrNoChain
	}
	members, err := q.ListSquadMembers(ctx, squad.ID)
	if err != nil {
		return nil, err
	}
	var lentAgent pgtype.UUID
	inSquad := false
	for _, member := range members {
		if member.MemberType == "member" && member.MemberID == newHolderID {
			inSquad = true
			lentAgent = member.AgentID
			break
		}
	}
	if !inSquad {
		return nil, ErrNewHolderNotInSquad
	}

	steps, err := q.ListIssueChainSteps(ctx, issue.ID)
	if err != nil {
		return nil, err
	}
	var target *db.IssueChainStep
	for i := range steps {
		if steps[i].State == ChainStateReviewing {
			target = &steps[i]
			break
		}
	}
	if target == nil {
		for i := range steps {
			if steps[i].State == ChainStateParked {
				target = &steps[i]
				break
			}
		}
	}
	if target == nil {
		return nil, ErrNoReassignableStep
	}

	// Reviewing keeps the agent that produced the leg; the new holder reviews
	// that work. A parked leg takes the new holder's own agent.
	agent := target.AgentID
	if target.State != ChainStateReviewing {
		agent = lentAgent
	}
	updated, err := q.SetIssueChainStepHolder(ctx, db.SetIssueChainStepHolderParams{
		IssueID:      issue.ID,
		Position:     target.Position,
		HolderUserID: newHolderID,
		AgentID:      agent,
	})
	if err != nil {
		return nil, err
	}

	// A parked leg can start immediately when the new holder brings a runnable
	// agent; otherwise it stays parked, now with the honest reason.
	if target.State == ChainStateParked {
		nextState := ChainStateParked
		reason := string(dispatch.ReasonNoAgent)
		if agent.Valid {
			if verdict, ok := s.chainStepVerdict(ctx, q, agent); ok && !verdict.Blocked() {
				started, err := q.SetIssueChainStepState(ctx, db.SetIssueChainStepStateParams{
					IssueID:  issue.ID,
					Position: target.Position,
					State:    ChainStateDoing,
				})
				if err != nil {
					return nil, err
				}
				updated = started
				nextState = ChainStateDoing
				if _, err := s.EnqueueTaskForMention(ctx, issue, agent, pgtype.UUID{}); err != nil {
					slog.Warn("reassigned chain step could not be dispatched",
						"issue_id", util.UUIDToString(issue.ID), "error", err)
				}
			} else if ok {
				reason = string(verdict.Reason)
			}
		}
		if nextState == ChainStateParked {
			parked, err := q.SetIssueChainStepParked(ctx, db.SetIssueChainStepParkedParams{
				IssueID:      issue.ID,
				Position:     target.Position,
				ParkedReason: reason,
			})
			if err != nil {
				return nil, err
			}
			updated = parked
		}
	}

	s.resolveRelayTurn(ctx, q, issue.ID, target.Position)
	s.recordRelayActivity(ctx, q, issue, actorID, "relay_reassigned",
		target.Position, target.HolderUserID, newHolderID, target.ParkedReason, true)
	if issueRow, err := q.GetIssue(ctx, issue.ID); err == nil {
		s.publishChainChanged(issueRow)
	}
	s.syncRelayStatus(ctx, q, issue.ID)
	if updated.State == ChainStateReviewing || updated.State == ChainStateParked {
		s.notifyChainTurn(ctx, issue, updated)
	}
	slog.Info("chain leg reassigned",
		"issue_id", util.UUIDToString(issue.ID),
		"position", updated.Position,
		"holder_user_id", util.UUIDToString(newHolderID),
		"state", updated.State)
	return &updated, nil
}

// CancelChainStep stops the leg's in-flight run(s) at the holder's request.
//
// It is the first half of recovery from a stalled run: cancel, then retry.
// The chain does not move — the step stays doing, and its newest run becomes
// cancelled, which is exactly the state RetryChainStep accepts.
func (s *TaskService) CancelChainStep(
	ctx context.Context,
	q *db.Queries,
	issue db.Issue,
	holderID pgtype.UUID,
	override bool,
) (*db.IssueChainStep, int, error) {
	steps, err := q.ListIssueChainSteps(ctx, issue.ID)
	if err != nil {
		return nil, 0, err
	}
	if len(steps) == 0 {
		return nil, 0, ErrNoChain
	}
	var active *db.IssueChainStep
	for i := range steps {
		if steps[i].State == ChainStateDoing {
			active = &steps[i]
			break
		}
	}
	if active == nil {
		return nil, 0, ErrNoActiveStep
	}
	if active.HolderUserID != holderID {
		if !override {
			return nil, 0, ErrNotStepHolder
		}
		slog.Warn("relay cancel overridden by a workspace admin",
			"issue_id", util.UUIDToString(issue.ID),
			"position", active.Position,
			"holder_user_id", util.UUIDToString(active.HolderUserID),
			"actor_user_id", util.UUIDToString(holderID))
	}
	if !active.AgentID.Valid {
		return nil, 0, ErrNoStepAgent
	}

	tasks, err := q.ListTasksByIssue(ctx, issue.ID)
	if err != nil {
		return nil, 0, err
	}
	cancelled := 0
	var lastErr error
	for i := range tasks {
		task := tasks[i]
		if task.AgentID != active.AgentID || !activeAgentTaskStatus(task.Status) {
			continue
		}
		// The handoff-writing turn belongs to the review gate, not the leg's
		// work; canceling it here would leave a reviewing leg without its
		// package. A doing leg should not have one, but do not guess.
		if task.HandoffNote.Valid && task.HandoffNote.String == LegOutputInstruction {
			continue
		}
		if _, err := s.CancelTaskByUser(ctx, task.ID); err != nil {
			lastErr = err
			continue
		}
		cancelled++
	}
	if cancelled == 0 {
		if lastErr != nil {
			return nil, 0, lastErr
		}
		return nil, 0, ErrLegNoActiveRun
	}
	slog.Info("chain leg cancelled by its holder",
		"issue_id", util.UUIDToString(issue.ID),
		"position", active.Position,
		"cancelled", cancelled)
	return active, cancelled, nil
}

// parseLegHandoffDocument reads the required machine-readable block out of a
// leg-output document. The prose above it stays the human document; the block
// is the actionable part the platform turns into the handoff package.
func parseLegHandoffDocument(content string) (*ChainHandoff, bool) {
	const fence = "```handoff"
	start := strings.LastIndex(content, fence)
	if start < 0 {
		return nil, false
	}
	rest := content[start+len(fence):]
	end := strings.Index(rest, "```")
	if end < 0 {
		return nil, false
	}
	var doc struct {
		Summary    string `json:"summary"`
		Acceptance []struct {
			Label       string `json:"label"`
			Requirement string `json:"requirement"`
			Delivered   string `json:"delivered"`
			State       string `json:"state"`
		} `json:"acceptance"`
		OpenQuestions []string `json:"open_questions"`
		NextBrief     []string `json:"next_brief"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(rest[:end])), &doc); err != nil {
		return nil, false
	}
	summary := strings.TrimSpace(doc.Summary)
	if summary == "" || len(summary) > maxLegHandoffSummary {
		return nil, false
	}
	acceptance := make([]ChainHandoffAcceptance, 0, len(doc.Acceptance))
	for _, row := range doc.Acceptance {
		label := strings.TrimSpace(row.Label)
		requirement := strings.TrimSpace(row.Requirement)
		if label == "" || requirement == "" {
			continue
		}
		state := strings.TrimSpace(row.State)
		if state != "warn" {
			state = "pass"
		}
		acceptance = append(acceptance, ChainHandoffAcceptance{
			Label:       label,
			Requirement: requirement,
			Delivered:   strings.TrimSpace(row.Delivered),
			State:       state,
		})
		if len(acceptance) >= maxLegHandoffAcceptance {
			break
		}
	}
	if len(acceptance) == 0 {
		return nil, false
	}
	return &ChainHandoff{
		Summary:       summary,
		Acceptance:    acceptance,
		OpenQuestions: cleanHandoffList(doc.OpenQuestions, maxLegHandoffList, maxLegHandoffListItem),
		NextBrief:     cleanHandoffList(doc.NextBrief, maxLegHandoffList, maxLegHandoffListItem),
	}, true
}

const (
	maxLegHandoffSummary    = 50000
	maxLegHandoffAcceptance = 20
	maxLegHandoffList       = 20
	maxLegHandoffListItem   = 500
)

func cleanHandoffList(items []string, max, maxLen int) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if len(item) > maxLen {
			item = item[:maxLen]
		}
		out = append(out, item)
		if len(out) >= max {
			break
		}
	}
	return out
}

// extractLegHandoffFromRun reads the comment a specific leg-output run posted
// and writes its handoff block into the reviewing step. force=false is the
// completion hook: it never overwrites a package the holder already curated.
// force=true is the explicit "re-extract" action.
func (s *TaskService) extractLegHandoffFromRun(
	ctx context.Context,
	issueID, agentID, taskID pgtype.UUID,
	force bool,
) (bool, error) {
	comment, err := s.Queries.GetLatestCommentBySourceTask(ctx, taskID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, ErrNoHandoffDocument
		}
		return false, err
	}
	handoff, ok := parseLegHandoffDocument(comment.Content)
	if !ok {
		return false, ErrHandoffBlockMissing
	}
	steps, err := s.Queries.ListIssueChainSteps(ctx, issueID)
	if err != nil {
		return false, err
	}
	var step *db.IssueChainStep
	for i := range steps {
		if steps[i].State == ChainStateReviewing && steps[i].AgentID == agentID {
			step = &steps[i]
			break
		}
	}
	if step == nil {
		return false, nil
	}
	if !force {
		var existing ChainHandoffPackage
		if len(step.HandoffPackage) > 0 {
			_ = json.Unmarshal(step.HandoffPackage, &existing)
		}
		if len(existing.Acceptance) > 0 || len(existing.OpenQuestions) > 0 || len(existing.NextBrief) > 0 {
			return false, nil
		}
	}
	files := step.HandoffFiles
	if len(files) == 0 {
		files = []byte("[]")
	}
	pkgJSON, err := json.Marshal(handoff.packageFields())
	if err != nil {
		return false, err
	}
	if _, err := s.Queries.SetIssueChainStepHandoff(ctx, db.SetIssueChainStepHandoffParams{
		IssueID:        issueID,
		Position:       step.Position,
		HandoffSummary: handoff.Summary,
		HandoffFiles:   files,
		HandoffPackage: pkgJSON,
	}); err != nil {
		return false, err
	}
	if issue, err := s.Queries.GetIssue(ctx, issueID); err == nil {
		s.publishChainChanged(issue)
	}
	slog.Info("leg handoff extracted from its output document",
		"issue_id", util.UUIDToString(issueID),
		"position", step.Position,
		"force", force)
	return true, nil
}

// maybeExtractLegHandoff is the completion hook: a leg-output run that lands
// with a valid handoff block populates the review package automatically.
func (s *TaskService) maybeExtractLegHandoff(ctx context.Context, task db.AgentTaskQueue) {
	if !task.IssueID.Valid || !task.HandoffNote.Valid ||
		task.HandoffNote.String != LegOutputInstruction || task.Status != "completed" {
		return
	}
	if _, err := s.extractLegHandoffFromRun(ctx, task.IssueID, task.AgentID, task.ID, false); err != nil {
		if errors.Is(err, ErrNoHandoffDocument) || errors.Is(err, ErrHandoffBlockMissing) {
			slog.Info("leg output has no extractable handoff block; holder curates the package",
				"issue_id", util.UUIDToString(task.IssueID),
				"task_id", util.UUIDToString(task.ID))
			return
		}
		slog.Warn("leg handoff extraction failed",
			"issue_id", util.UUIDToString(task.IssueID),
			"task_id", util.UUIDToString(task.ID),
			"error", err)
	}
}

// ReextractLegHandoff re-reads the newest completed leg-output document and
// overwrites the package. This is the explicit fallback when the holder edited
// the document, or when the automatic extraction missed.
func (s *TaskService) ReextractLegHandoff(
	ctx context.Context,
	issue db.Issue,
	holderID pgtype.UUID,
	override bool,
) (*db.IssueChainStep, error) {
	steps, err := s.Queries.ListIssueChainSteps(ctx, issue.ID)
	if err != nil {
		return nil, err
	}
	if len(steps) == 0 {
		return nil, ErrNoChain
	}
	var step *db.IssueChainStep
	for i := range steps {
		if steps[i].State == ChainStateReviewing {
			step = &steps[i]
			break
		}
	}
	if step == nil {
		return nil, ErrNoReviewingStep
	}
	if step.HolderUserID != holderID && !override {
		return nil, ErrNotStepHolder
	}
	if !step.AgentID.Valid {
		return nil, ErrNoStepAgent
	}
	if running, err := s.legOutputRunning(ctx, s.Queries, issue.ID, step.AgentID); err != nil {
		return nil, err
	} else if running {
		return nil, ErrLegOutputRunning
	}
	tasks, err := s.Queries.ListLegOutputTasksForIssue(ctx, db.ListLegOutputTasksForIssueParams{
		IssueID:     issue.ID,
		HandoffNote: pgtype.Text{String: LegOutputInstruction, Valid: true},
	})
	if err != nil {
		return nil, err
	}
	var taskID pgtype.UUID
	for _, task := range tasks {
		if task.AgentID == step.AgentID && task.Status == "completed" {
			taskID = task.ID
			break
		}
	}
	if !taskID.Valid {
		return nil, ErrNoHandoffDocument
	}
	if _, err := s.extractLegHandoffFromRun(ctx, issue.ID, step.AgentID, taskID, true); err != nil {
		return nil, err
	}
	fresh, err := s.Queries.ListIssueChainSteps(ctx, issue.ID)
	if err != nil {
		return nil, err
	}
	for i := range fresh {
		if fresh[i].Position == step.Position {
			return &fresh[i], nil
		}
	}
	return step, nil
}

// ChainHolder describes the person a parked step is waiting on, for the room
// message that tells everyone whose turn it is.
type ChainHolder struct {
	UserID pgtype.UUID
	Title  string
}

// ErrNoChain reports that an issue has no relay, which is the normal state for
// a task dispatched straight to one agent.
var ErrNoChain = errors.New("issue has no chain")

// ErrNoReviewingStep reports that no step is waiting for its holder's review.
var ErrNoReviewingStep = errors.New("no step is waiting for review")

// ErrNotStepHolder reports that the caller is not the person whose turn it is.
// The relay's permission boundary: only a leg's holder writes its plan and
// only they approve it.
var ErrNotStepHolder = errors.New("only the step's holder can do that")

// ErrNoStepAgent reports that the reviewing leg has no agent to send the
// revision back to. A reviewing leg was run, so this is a damaged chain, not a
// normal waiting state.
var ErrNoStepAgent = errors.New("the reviewing step has no agent")

// ErrNoParkedStep reports that nothing in the chain is waiting on a person, so
// there is no step to skip.
var ErrNoParkedStep = errors.New("no parked step to skip")

// ErrNoReassignableStep reports that no leg is waiting (reviewing or parked)
// and therefore nothing can be reassigned.
var ErrNoReassignableStep = errors.New("no reviewing or parked step to reassign")

// ErrNewHolderNotInSquad reports that the target is not a member of this
// squad, so the relay has no route through them.
var ErrNewHolderNotInSquad = errors.New("the new holder is not a member of this squad")

// ErrNoActiveStep reports that the relay is not on a leg that can be retried.
var ErrNoActiveStep = errors.New("no leg is currently being worked on")

// ErrLegAlreadyRunning reports that the leg's agent still has a live run; a
// retry now would either duplicate it or queue behind it without the holder
// meaning to.
var ErrLegAlreadyRunning = errors.New("the leg's agent is already running")

// ErrLegDelivered reports that the leg's newest run completed. That leg is
// waiting for the holder's review (or has already advanced), not for a retry;
// re-running it would silently discard the delivered work.
var ErrLegDelivered = errors.New("the leg's run already finished")

// ErrLegNoRetryableRun reports a doing leg with no failed/cancelled run to
// retry. Starting a fresh run for it is dispatch's job, not retry's.
var ErrLegNoRetryableRun = errors.New("this leg has no interrupted run to retry")

// ErrLegNoActiveRun reports a doing leg with nothing in flight to cancel.
var ErrLegNoActiveRun = errors.New("this leg has no active run to cancel")

// ErrLegOutputRunning reports that the leg's agent is still writing the handoff
// package. The review gate stays shut until that run lands: approving now would
// move the chain underneath a live summary, and the package would be empty.
var ErrLegOutputRunning = errors.New("the leg's summary is still being generated")

// The review gate's package requirements. A bare 通过 made the handoff
// package decorative: the next holder received nothing to review and the next
// agent received nothing to act on.
var (
	ErrHandoffRequired           = errors.New("a leg needs a handoff summary to pass")
	ErrHandoffAcceptanceRequired = errors.New("a handoff needs at least one acceptance item")
	ErrHandoffNextBriefRequired  = errors.New("a non-final leg needs a brief for the next leg")
)

// The single-artifact extraction errors. The document is the source; these say
// whether there is a document at all, or a document without the required
// machine-readable block.
var (
	ErrNoHandoffDocument   = errors.New("this leg has no completed output document")
	ErrHandoffBlockMissing = errors.New("the output document has no handoff block")
)

func activeAgentTaskStatus(status string) bool {
	switch status {
	case "queued", "dispatched", "waiting_local_directory", "running", "deferred":
		return true
	default:
		return false
	}
}

// legOutputRunning finds an active run whose handoff note is the leg-output
// instruction. Exact-note match keeps ordinary mentions and revision runs out
// of the gate; those are different turns with different lifecycles.
func (s *TaskService) legOutputRunning(ctx context.Context, q *db.Queries, issueID, agentID pgtype.UUID) (bool, error) {
	if !agentID.Valid {
		return false, nil
	}
	tasks, err := q.ListLegOutputTasksForIssue(ctx, db.ListLegOutputTasksForIssueParams{
		IssueID:     issueID,
		HandoffNote: pgtype.Text{String: LegOutputInstruction, Valid: true},
	})
	if err != nil {
		return false, err
	}
	for _, task := range tasks {
		if task.AgentID == agentID && activeAgentTaskStatus(task.Status) {
			return true, nil
		}
	}
	return false, nil
}

// MarshalChainSteps encodes playbook steps for the JSONB column.
func MarshalChainSteps(specs []ChainStepSpec) ([]byte, error) {
	if specs == nil {
		specs = []ChainStepSpec{}
	}
	return json.Marshal(specs)
}

// UnmarshalChainSteps decodes a playbook's steps.
//
// A malformed blob yields an empty chain rather than an error: the playbook is
// still usable as a name, and refusing to list it because one step is corrupt
// would hide the rest.
func UnmarshalChainSteps(raw []byte) []ChainStepSpec {
	var specs []ChainStepSpec
	if len(raw) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, &specs); err != nil {
		slog.Warn("playbook steps did not parse", "error", err)
		return nil
	}
	return specs
}

// advanceIssueChain carries the relay forward after a run finishes.
//
// Two outcomes worth telling the world about, and one that is silent:
//
//   - the next step has an agent: dispatch to it, so the relay keeps moving
//     without anyone asking;
//   - the next step's holder has no agent: park the step and say so in the
//     squad's room. This is the whole point — the task waits, visibly, instead
//     of sitting there looking idle;
//   - anything else (no chain, a run that was not the relay's) is silent.
func (s *TaskService) advanceIssueChain(ctx context.Context, task db.AgentTaskQueue) {
	// A leg-output run that just landed is the leg's single handoff artifact:
	// extract its structured block before anything else reads the package.
	s.maybeExtractLegHandoff(ctx, task)
	if !task.IssueID.Valid {
		return
	}
	next, err := s.AdvanceChain(ctx, s.Queries, task.IssueID, task.AgentID)
	if err != nil {
		slog.Warn("advancing the issue chain failed",
			"issue_id", util.UUIDToString(task.IssueID), "error", err)
		return
	}
	if next == nil {
		return
	}

	issue, err := s.Queries.GetIssue(ctx, task.IssueID)
	if err != nil {
		slog.Warn("chain hand-off could not load its issue",
			"issue_id", util.UUIDToString(task.IssueID), "error", err)
		return
	}
	s.dispatchChainStep(ctx, issue, *next)
}

// dispatchChainStep carries out where the relay just landed: start the next
// step's agent so the chain keeps moving without anyone asking, or park and
// say so in the squad's room. Shared by every path that moves a chain.
func (s *TaskService) dispatchChainStep(ctx context.Context, issue db.Issue, next db.IssueChainStep) {
	s.publishChainChanged(issue)

	if next.State == ChainStateDoing {
		if _, err := s.EnqueueTaskForMention(ctx, issue, next.AgentID, pgtype.UUID{}); err != nil {
			// The chain has already moved; a dispatch that failed leaves the
			// step marked doing with nothing running, which the room shows.
			slog.Warn("chain hand-off could not be dispatched",
				"issue_id", util.UUIDToString(issue.ID), "error", err)
		}
		return
	}

	if next.State != ChainStateParked && next.State != ChainStateReviewing {
		return
	}
	if next.State == ChainStateParked {
		// Tell the squad's room whose turn it is. Best effort: the parked step
		// is already recorded, and a message that failed to write must not undo
		// it.
		if err := s.postChainParkedMessage(ctx, issue, next); err != nil {
			slog.Warn("chain parked but the room message failed",
				"issue_id", util.UUIDToString(issue.ID), "error", err)
		}
	}
	// A person's turn is exactly where an inbox notification belongs: reviewing
	// and parked both need the holder to act before the relay can move.
	s.notifyChainTurn(ctx, issue, next)
}

// notifyChainTurn drops an inbox item for the holder whose turn it is. Best
// effort: the chain transition is already committed, and a failed notification
// must not undo it.
// NotifyParkedChainSteps notifies the holder of the first step that parked
// while a relay was being written. The dispatch paths notify themselves; this
// is for the create paths, where the chain can be born parked.
func (s *TaskService) NotifyParkedChainSteps(ctx context.Context, issue db.Issue, steps []db.IssueChainStep) {
	for _, step := range steps {
		if step.State == ChainStateParked {
			s.notifyChainTurn(ctx, issue, step)
			return
		}
	}
}

func (s *TaskService) notifyChainTurn(ctx context.Context, issue db.Issue, step db.IssueChainStep) {
	if !step.HolderUserID.Valid {
		return
	}
	steps, err := s.Queries.ListIssueChainSteps(ctx, issue.ID)
	if err != nil || len(steps) == 0 {
		return
	}
	total := len(steps)
	title := fmt.Sprintf("轮到你审核：%s", issue.Title)
	body := fmt.Sprintf("第 %d/%d 棒已交付，审核并填写交接单后就能交棒。", step.Position+1, total)
	if step.State == ChainStateParked {
		title = fmt.Sprintf("接力停在你这一棒：%s", issue.Title)
		body = fmt.Sprintf("第 %d/%d 棒需要你的智能体接手（%s）。", step.Position+1, total, chainParkedReasonHint(step.ParkedReason))
	}
	details, err := json.Marshal(map[string]any{
		"issue_id":      util.UUIDToString(issue.ID),
		"position":      step.Position,
		"state":         step.State,
		"parked_reason": step.ParkedReason,
	})
	if err != nil {
		details = []byte("{}")
	}
	item, err := s.Queries.CreateInboxItem(ctx, db.CreateInboxItemParams{
		ID:            dbid.NewV7(),
		WorkspaceID:   issue.WorkspaceID,
		RecipientType: "member",
		RecipientID:   step.HolderUserID,
		Type:          "relay_turn",
		Severity:      "action_required",
		IssueID:       issue.ID,
		Title:         title,
		Body:          pgtype.Text{String: body, Valid: true},
		ActorType:     pgtype.Text{String: "system", Valid: true},
		Details:       details,
	})
	if err != nil {
		slog.Warn("chain turn notification failed",
			"issue_id", util.UUIDToString(issue.ID),
			"position", step.Position,
			"holder_user_id", util.UUIDToString(step.HolderUserID),
			"error", err)
		return
	}
	s.publishRelayInbox(item, issue.Status)
}

func (s *TaskService) publishRelayInbox(item db.InboxItem, issueStatus string) {
	if s.Bus == nil {
		return
	}
	resp := map[string]any{
		"id":             util.UUIDToString(item.ID),
		"workspace_id":   util.UUIDToString(item.WorkspaceID),
		"recipient_type": item.RecipientType,
		"recipient_id":   util.UUIDToString(item.RecipientID),
		"type":           item.Type,
		"severity":       item.Severity,
		"issue_id":       util.UUIDToPtr(item.IssueID),
		"title":          item.Title,
		"body":           util.TextToPtr(item.Body),
		"read":           item.Read,
		"archived":       item.Archived,
		"created_at":     util.TimestampToString(item.CreatedAt),
		"actor_type":     util.TextToPtr(item.ActorType),
		"actor_id":       util.UUIDToPtr(item.ActorID),
		"details":        json.RawMessage(item.Details),
		"issue_status":   issueStatus,
	}
	s.Bus.Publish(events.Event{
		Type:        protocol.EventInboxNew,
		WorkspaceID: util.UUIDToString(item.WorkspaceID),
		ActorType:   "system",
		Payload:     map[string]any{"item": resp},
	})
}

func chainParkedReasonHint(reason string) string {
	switch dispatch.ReasonCode(reason) {
	case dispatch.ReasonRuntimePrivateForeign:
		return "智能体的机器是他人私有的"
	case dispatch.ReasonRuntimeUnusable:
		return "机器上的 CLI 无法执行"
	case dispatch.ReasonAgentRuntimeRequired:
		return "智能体还没有绑定机器"
	case dispatch.ReasonTargetUnavailable:
		return "智能体已不可用"
	case dispatch.ReasonRuntimeOffline:
		return "机器离线"
	case dispatch.ReasonNoAgent, "":
		return "还没绑定智能体"
	default:
		return "暂时无法接手"
	}
}

// postChainCompletedMessage leaves a durable completion record in the squad's
// room: who finished, how many legs, what was skipped, and how long it took.
// The final package lives on the last step; this is the ledger entry around it.
func (s *TaskService) postChainCompletedMessage(ctx context.Context, issue db.Issue) {
	if issue.AssigneeType.String != "squad" || !issue.AssigneeID.Valid {
		return
	}
	steps, err := s.Queries.ListIssueChainSteps(ctx, issue.ID)
	if err != nil || len(steps) == 0 {
		slog.Warn("chain completion record could not read its steps",
			"issue_id", util.UUIDToString(issue.ID), "error", err)
		return
	}
	skipped := 0
	var first, last time.Time
	for _, step := range steps {
		if step.State == ChainStateSkipped {
			skipped++
		}
		if step.StartedAt.Valid && (first.IsZero() || step.StartedAt.Time.Before(first)) {
			first = step.StartedAt.Time
		}
		if step.CompletedAt.Valid && step.CompletedAt.Time.After(last) {
			last = step.CompletedAt.Time
		}
	}
	duration := ""
	if !first.IsZero() && !last.IsZero() && last.After(first) {
		duration = last.Sub(first).Round(time.Minute).String()
	}
	body := fmt.Sprintf("接力完成 — 共 %d 棒，跳过 %d 棒", len(steps), skipped)
	if duration != "" {
		body += "，用时 " + duration
	}
	body += "。"
	metadata, err := json.Marshal(map[string]any{
		"issue_id": util.UUIDToString(issue.ID),
		"total":    len(steps),
		"skipped":  skipped,
		"duration": duration,
	})
	if err != nil {
		metadata = []byte("{}")
	}
	if _, err := s.Queries.CreateSquadMessage(ctx, db.CreateSquadMessageParams{
		SquadID:    issue.AssigneeID,
		AuthorType: "system",
		Body:       body,
		Kind:       "chain_completed",
		Metadata:   metadata,
	}); err != nil {
		slog.Warn("chain completion record failed",
			"issue_id", util.UUIDToString(issue.ID), "error", err)
		return
	}
	slog.Info("chain completed",
		"issue_id", util.UUIDToString(issue.ID),
		"steps", len(steps),
		"skipped", skipped,
		"duration", duration)
}

// publishChainChanged tells the workspace a relay moved. A pointer, not a
// copy: a chain strip on anyone's screen refetches the server's own answer
// instead of being patched with one client's guess.
// syncRelayStatus derives the issue's status from the chain and writes it.
//
// A squad task does not get a hand-set status: the relay IS the status
// machine. Every transition — first leg starts, a leg parks the relay, the
// last leg passes — lands here, so `issue.status` stays a faithful projection
// of the chain for the surfaces that still speak status (list filters, inbox,
// the stuck-issue sweeper) without anyone setting it by hand. The page itself
// speaks in relay terms; this column is the translation layer.
//
// Two writes are refused on purpose: a cancelled task is never resurrected by
// a late chain event, and a task a human marked done is not dragged back to
// in_progress — the relay may still be mid-flight in both cases, and the
// person's word outranks the projection.
func (s *TaskService) syncRelayStatus(ctx context.Context, q *db.Queries, issueID pgtype.UUID) {
	steps, err := q.ListIssueChainSteps(ctx, issueID)
	if err != nil || len(steps) == 0 {
		return
	}
	issue, err := q.GetIssue(ctx, issueID)
	if err != nil {
		slog.Warn("relay status sync could not load its issue",
			"issue_id", util.UUIDToString(issueID), "error", err)
		return
	}
	if issue.Status == "cancelled" || issue.Status == "done" {
		return
	}

	parked := false
	allDelivered := true
	for _, step := range steps {
		switch step.State {
		case ChainStateParked:
			parked = true
			allDelivered = false
		case ChainStateDone, ChainStateSkipped:
			// delivered
		default:
			allDelivered = false
		}
	}
	target := "in_progress"
	if parked {
		// A parked step is the relay's honest "stuck on someone" — the same
		// meaning `blocked` carries for every other surface (the sweeper will
		// not reset it, the board paints it red).
		target = "blocked"
	} else if allDelivered {
		target = "done"
	}
	if issue.Status == target {
		return
	}

	updated, err := q.UpdateIssueStatus(ctx, db.UpdateIssueStatusParams{
		ID:          issueID,
		Status:      target,
		WorkspaceID: issue.WorkspaceID,
	})
	if err != nil {
		slog.Warn("relay status sync failed",
			"issue_id", util.UUIDToString(issueID),
			"from", issue.Status, "to", target, "error", err)
		return
	}
	// Mirrors the stuck-issue sweeper's direct write: the HTTP handler that
	// normally emits issue:updated is bypassed, so emit it here or boards and
	// status-filtered lists keep the old value until some unrelated write.
	s.broadcastIssueUpdated(ctx, updated, issue.Status)
}

func (s *TaskService) publishChainChanged(issue db.Issue) {
	workspaceID := util.UUIDToString(issue.WorkspaceID)
	if workspaceID == "" {
		return
	}
	s.Bus.Publish(events.Event{
		Type:        protocol.EventIssueChainChanged,
		WorkspaceID: workspaceID,
		Payload:     map[string]any{"issue_id": util.UUIDToString(issue.ID)},
	})
}

// postChainParkedMessage says, in the squad's own room, that the relay reached
// someone who cannot run it yet.
func (s *TaskService) postChainParkedMessage(ctx context.Context, issue db.Issue, step db.IssueChainStep) error {
	if issue.AssigneeType.String != "squad" || !issue.AssigneeID.Valid {
		return nil
	}
	holder, err := s.Queries.GetUser(ctx, step.HolderUserID)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(map[string]any{
		"issue_id":  util.UUIDToString(issue.ID),
		"position":  step.Position,
		"holder_id": util.UUIDToString(step.HolderUserID),
		"reason":    step.ParkedReason,
	})
	if err != nil {
		raw = []byte("{}")
	}
	_, err = s.Queries.CreateSquadMessage(ctx, db.CreateSquadMessageParams{
		SquadID:    issue.AssigneeID,
		AuthorType: "system",
		Body:       chainParkedBody(holder.Name, step.Title, step.ParkedReason),
		Kind:       "chain_parked",
		Metadata:   raw,
	})
	return err
}

// chainParkedBody is the room's one-line explanation. The reason code picks
// the sentence because the fixes differ: binding an agent, sharing a machine,
// reinstalling a CLI, or picking a different agent are not interchangeable
// instructions, and "等他绑一个智能体" sent to a holder who already has one is
// actively misleading.
func chainParkedBody(holderName, title, reason string) string {
	switch dispatch.ReasonCode(reason) {
	case dispatch.ReasonRuntimePrivateForeign:
		return fmt.Sprintf("轮到 %s 了 — %s：他的智能体绑在别人的私有机器上，那台机器不会接手；换一台自己的机器或绑定可用的智能体后继续。",
			holderName, title)
	case dispatch.ReasonRuntimeUnusable:
		return fmt.Sprintf("轮到 %s 了 — %s：他的智能体所在机器无法执行 CLI，修好后继续。",
			holderName, title)
	case dispatch.ReasonAgentRuntimeRequired:
		return fmt.Sprintf("轮到 %s 了 — %s：他的智能体还没有绑定机器，绑定后继续。",
			holderName, title)
	case dispatch.ReasonTargetUnavailable:
		return fmt.Sprintf("轮到 %s 了 — %s：他的智能体已不可用，换一个智能体后继续。",
			holderName, title)
	case dispatch.ReasonNoAgent, "":
		return fmt.Sprintf("轮到 %s 了 — %s，任务停在这一步，等他绑一个智能体就能接着走。",
			holderName, title)
	default:
		return fmt.Sprintf("轮到 %s 了 — %s，这一棒暂时无法开始。", holderName, title)
	}
}
