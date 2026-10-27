package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/kscsky/quickwork/server/internal/events"
	"github.com/kscsky/quickwork/server/internal/util"
	db "github.com/kscsky/quickwork/server/pkg/db/generated"
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

// ChainHandoff is the package a leg publishes on 通过: the files the holder
// ticked plus the summary they wrote. What crosses the leg boundary is the
// holder's call — this is the curated side of the leg, not its raw content.
type ChainHandoff struct {
	Summary string             `json:"summary"`
	Files   []ChainHandoffFile `json:"files"`
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
			State:        ChainStateDoing,
		})
		if err != nil {
			return nil, fmt.Errorf("create chain step 0: %w", err)
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
	// wherever it was parked before the squad got it.
	s.syncRelayStatus(ctx, q, issue.ID)
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
		if _, err := q.SetIssueChainStepHandoff(ctx, db.SetIssueChainStepHandoffParams{
			IssueID:        issue.ID,
			Position:       steps[current].Position,
			HandoffSummary: handoff.Summary,
			HandoffFiles:   filesJSON,
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

// SkipParkedStep moves the relay past a parked step and carries it on.
//
// The other way out of parked: rather than wait for the holder to bind an
// agent, the squad goes around them. Only a parked step can be skipped —
// skipping a step whose agent is running would race that run's own advance.
func (s *TaskService) SkipParkedStep(ctx context.Context, q *db.Queries, issue db.Issue) (*db.IssueChainStep, error) {
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
		parked, err := q.SetIssueChainStepState(ctx, db.SetIssueChainStepStateParams{
			IssueID:  issueID,
			Position: target.Position,
			State:    ChainStateParked,
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
		if _, err := q.StartIssueChainStep(ctx, db.StartIssueChainStepParams{
			IssueID:  step.IssueID,
			Position: step.Position,
			AgentID:  agentID,
		}); err != nil {
			slog.Warn("could not resume a parked chain step",
				"issue_id", util.UUIDToString(step.IssueID), "error", err)
			continue
		}
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

// ErrNoParkedStep reports that nothing in the chain is waiting on a person, so
// there is no step to skip.
var ErrNoParkedStep = errors.New("no parked step to skip")

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

	if next.State != ChainStateParked {
		return
	}
	// Tell the squad's room whose turn it is. Best effort: the parked step is
	// already recorded, and a message that failed to write must not undo it.
	if err := s.postChainParkedMessage(ctx, issue, next); err != nil {
		slog.Warn("chain parked but the room message failed",
			"issue_id", util.UUIDToString(issue.ID), "error", err)
	}
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
	})
	if err != nil {
		raw = []byte("{}")
	}
	_, err = s.Queries.CreateSquadMessage(ctx, db.CreateSquadMessageParams{
		SquadID:    issue.AssigneeID,
		AuthorType: "system",
		Body: fmt.Sprintf("轮到 %s 了 — %s，任务停在这一步，等他绑一个智能体就能接着走。",
			holder.Name, step.Title),
		Kind:     "chain_parked",
		Metadata: raw,
	})
	return err
}
