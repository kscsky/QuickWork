package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kscsky/quickwork/server/internal/util"
	db "github.com/kscsky/quickwork/server/pkg/db/generated"
)

// Relay (小队接力) trigger routing: on an issue with a chain the baton — not
// the squad leader — decides who a comment reaches. A leg-scoped comment wakes
// that leg's own agent; a room comment wakes the leg holding the baton; and
// nothing on a relay wakes the squad leader (the chain coordinates; the baton
// moves on the holder's 通过). These tests pin that routing against the
// Multica-era leader fallbacks it replaced.

type relayTriggerFixture struct {
	Issue    db.Issue
	SquadID  string
	LeaderID string // squad leader agent; runs leg 0
	OtherID  string // second agent; runs leg 1
	Step0ID  string
	Step1ID  string
}

func newRelayTriggerFixture(t *testing.T) relayTriggerFixture {
	t.Helper()
	ctx := context.Background()

	var leaderID string
	if err := testPool.QueryRow(ctx, `
		SELECT id FROM agent WHERE workspace_id = $1 ORDER BY created_at ASC LIMIT 1
	`, testWorkspaceID).Scan(&leaderID); err != nil {
		t.Fatalf("load leader agent: %v", err)
	}
	otherID := createHandlerTestAgent(t, "Relay Leg Other", nil)

	var squadID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO squad (workspace_id, name, description, leader_id, creator_id)
		VALUES ($1, $2, '', $3, $4)
		RETURNING id
	`, testWorkspaceID, "Relay Trigger Squad", leaderID, testUserID).Scan(&squadID); err != nil {
		t.Fatalf("create squad: %v", err)
	}
	t.Cleanup(func() { testPool.Exec(context.Background(), `DELETE FROM squad WHERE id = $1`, squadID) })

	var issueID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO issue (workspace_id, creator_type, creator_id, title, assignee_type, assignee_id)
		VALUES ($1, 'member', $2, $3, 'squad', $4)
		RETURNING id
	`, testWorkspaceID, testUserID, "relay trigger", squadID).Scan(&issueID); err != nil {
		t.Fatalf("create issue: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM agent_task_queue WHERE issue_id = $1`, issueID)
		testPool.Exec(context.Background(), `DELETE FROM comment WHERE issue_id = $1`, issueID)
		testPool.Exec(context.Background(), `DELETE FROM issue_chain_step WHERE issue_id = $1`, issueID)
		testPool.Exec(context.Background(), `DELETE FROM issue WHERE id = $1`, issueID)
	})

	// Leg 0 runs on the LEADER agent — the owner's own reproduction: the
	// squad's leader happens to be the agent a leg lends, and the routing must
	// still treat the leg's comment as leg work, not as leader coordination.
	step0 := insertRelayStep(t, issueID, 0, leaderID, "拆解与定方案", "doing", "先查口径")
	step1 := insertRelayStep(t, issueID, 1, otherID, "执行", "pending", "")

	issue, err := testHandler.Queries.GetIssue(ctx, util.MustParseUUID(issueID))
	if err != nil {
		t.Fatalf("load issue: %v", err)
	}
	return relayTriggerFixture{
		Issue: issue, SquadID: squadID, LeaderID: leaderID, OtherID: otherID,
		Step0ID: step0, Step1ID: step1,
	}
}

func insertRelayStep(t *testing.T, issueID string, position int, agentID, title, state, plan string) string {
	t.Helper()
	var id string
	if err := testPool.QueryRow(context.Background(), `
		INSERT INTO issue_chain_step (issue_id, position, holder_user_id, agent_id, title, state, plan)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id
	`, issueID, position, testUserID, agentID, title, state, plan).Scan(&id); err != nil {
		t.Fatalf("insert chain step: %v", err)
	}
	return id
}

func TestRelayComment_ImplicitRouting(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	fx := newRelayTriggerFixture(t)
	ctx := context.Background()

	compute := func(content, actorType, actorID, stepID string) []commentAgentTrigger {
		opts := commentTriggerComputeOptions{}
		if stepID != "" {
			opts.ChainStepID = util.MustParseUUID(stepID)
		}
		triggers, _ := testHandler.computeCommentAgentTriggers(ctx, fx.Issue, content, nil, actorType, actorID, opts)
		return triggers
	}
	noSquadLeader := func(t *testing.T, triggers []commentAgentTrigger) {
		t.Helper()
		for _, tr := range triggers {
			if tr.Source == commentTriggerSourceIssueAssignee {
				t.Fatalf("relay comment produced a squad-leader fallback trigger %q — the baton is the router", tr.Agent.Name)
			}
		}
	}

	t.Run("leg comment wakes that leg's own agent", func(t *testing.T) {
		triggers := compute("你调查一下市场情况", "member", testUserID, fx.Step0ID)
		if len(triggers) != 1 {
			t.Fatalf("leg comment: got %d triggers, want 1", len(triggers))
		}
		tr := triggers[0]
		if uuidToString(tr.Agent.ID) != fx.LeaderID || tr.Source != commentTriggerSourceChainStep || tr.Squad != nil {
			t.Fatalf("leg comment routed to %q source=%q squad=%v, want leg agent %q as chain_step worker",
				tr.Agent.Name, tr.Source, tr.Squad, fx.LeaderID)
		}
		noSquadLeader(t, triggers)
	})

	t.Run("room comment wakes the leg holding the baton", func(t *testing.T) {
		triggers := compute("大家看下进度", "member", testUserID, "")
		if len(triggers) != 1 {
			t.Fatalf("room comment: got %d triggers, want 1", len(triggers))
		}
		if uuidToString(triggers[0].Agent.ID) != fx.LeaderID || triggers[0].Source != commentTriggerSourceChainStep {
			t.Fatalf("room comment routed to %q source=%q, want baton leg agent %q",
				triggers[0].Agent.Name, triggers[0].Source, fx.LeaderID)
		}
		noSquadLeader(t, triggers)
	})

	t.Run("comment in another leg wakes that leg's agent, not the baton", func(t *testing.T) {
		triggers := compute("第二棒的材料", "member", testUserID, fx.Step1ID)
		if len(triggers) != 1 {
			t.Fatalf("other-leg comment: got %d triggers, want 1", len(triggers))
		}
		if uuidToString(triggers[0].Agent.ID) != fx.OtherID || triggers[0].Source != commentTriggerSourceChainStep {
			t.Fatalf("other-leg comment routed to %q source=%q, want leg-1 agent %q",
				triggers[0].Agent.Name, triggers[0].Source, fx.OtherID)
		}
	})

	t.Run("agent-authored comment on a relay wakes nobody", func(t *testing.T) {
		triggers := compute("done — pushed the change", "agent", fx.OtherID, "")
		if len(triggers) != 0 {
			t.Fatalf("agent comment on relay: got %d triggers, want 0 (no worker→leader loop)", len(triggers))
		}
	})

	t.Run("parked relay wakes nobody", func(t *testing.T) {
		if _, err := testPool.Exec(ctx, `
			UPDATE issue_chain_step SET state = 'parked' WHERE issue_id = $1 AND position = 0
		`, uuidToString(fx.Issue.ID)); err != nil {
			t.Fatalf("park leg 0: %v", err)
		}
		t.Cleanup(func() {
			testPool.Exec(context.Background(), `
				UPDATE issue_chain_step SET state = 'doing' WHERE issue_id = $1 AND position = 0
			`, uuidToString(fx.Issue.ID))
		})
		triggers := compute("还在吗", "member", testUserID, "")
		if len(triggers) != 0 {
			t.Fatalf("parked relay: got %d triggers, want 0 (waiting on a person)", len(triggers))
		}
	})
}

// TestCreateComment_RelayLegComment_DispatchesWorkerNotLeader drives the full
// CreateComment handler: a comment on a relay must enqueue the leg agent as a
// WORKER (no leader flag, no squad context). The owner-visible bug this pins:
// the old cascade routed the comment to the squad leader fallback, whose claim
// injected the coordinator protocol and dead-ended in a cross-member mention.
func TestCreateComment_RelayLegComment_DispatchesWorkerNotLeader(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	fx := newRelayTriggerFixture(t)
	issueID := uuidToString(fx.Issue.ID)

	postComment := func(body map[string]any) {
		t.Helper()
		w := httptest.NewRecorder()
		r := newRequest("POST", "/api/issues/"+issueID+"/comments", body)
		r = withURLParam(r, "id", issueID)
		testHandler.CreateComment(w, r)
		if w.Code != http.StatusCreated {
			t.Fatalf("CreateComment: expected 201, got %d: %s", w.Code, w.Body.String())
		}
	}
	countQueued := func(agentID string, isLeader bool) int {
		t.Helper()
		var n int
		if err := testPool.QueryRow(ctx, `
			SELECT count(*) FROM agent_task_queue
			WHERE issue_id = $1 AND agent_id = $2 AND status = 'queued' AND is_leader_task = $3
		`, issueID, agentID, isLeader).Scan(&n); err != nil {
			t.Fatalf("count tasks: %v", err)
		}
		return n
	}

	// 1. Leg-scoped comment → the leg's own agent, as a worker.
	postComment(map[string]any{
		"content":       "你调查一下中国市场婚恋情况",
		"chain_step_id": fx.Step0ID,
	})
	var legRows int
	if err := testPool.QueryRow(ctx, `
		SELECT count(*) FROM comment WHERE issue_id = $1 AND chain_step_id = $2
	`, issueID, fx.Step0ID).Scan(&legRows); err != nil {
		t.Fatalf("count leg comments: %v", err)
	}
	if legRows != 1 {
		t.Fatalf("leg comment not attributed to step0 (step0=%q step1=%q rows=%d)", fx.Step0ID, fx.Step1ID, legRows)
	}
	if got := countQueued(fx.LeaderID, false); got != 1 {
		t.Fatalf("leg comment: expected 1 queued worker task for the leg agent, got %d", got)
	}
	if got := countQueued(fx.LeaderID, true); got != 0 {
		t.Fatalf("leg comment: expected 0 leader tasks, got %d", got)
	}

	// 2. Room comment → the baton leg's agent; the pending worker task absorbs it.
	postComment(map[string]any{"content": "进度同步一下"})
	if got := countQueued(fx.LeaderID, false); got != 1 {
		t.Fatalf("room comment: expected the pending worker task to absorb it (1 queued), got %d", got)
	}
	if got := countQueued(fx.LeaderID, true); got != 0 {
		t.Fatalf("room comment: expected 0 leader tasks, got %d", got)
	}

	// 3. Comment in the other (pending) leg → that leg's agent, still a worker.
	postComment(map[string]any{
		"content":       "材料补充",
		"chain_step_id": fx.Step1ID,
	})
	if got := countQueued(fx.OtherID, false); got != 1 {
		t.Fatalf("other-leg comment: expected 1 queued worker task for leg-1 agent, got %d", got)
	}
}

// TestClaim_RelayLegTask_InjectsRelayBriefing pins the claim-time split: on a
// relay, a leg agent gets the relay leg briefing (its leg, its holder's plan,
// the handoff) and never the squad coordinator protocol — and the wire leader
// flag degrades without it.
func TestClaim_RelayLegTask_InjectsRelayBriefing(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	fx := newSquadBriefingClaimFixture(t, ctx, "Relay leg briefing")

	insertRelayStep(t, fx.IssueID, 0, fx.AgentID, "拆解与定方案", "doing", "先查口碑与竞争数据")
	want := enqueueClaimTask(t, ctx, fx, true /*isLeader*/, true /*withSquadID*/)

	got, instr, isLeader, raw := claimAgentInstructionsForTest(t, fx.RuntimeID)
	if got != want {
		t.Fatalf("claimed task id = %q, want %q: %s", got, want, raw)
	}
	if !strings.Contains(instr, "## Relay Leg Briefing") {
		t.Fatalf("expected relay leg briefing in agent instructions, got:\n%s", instr)
	}
	if !strings.Contains(instr, "拆解与定方案") || !strings.Contains(instr, "先查口碑与竞争数据") {
		t.Fatalf("relay briefing must carry the leg title and the holder's own plan, got:\n%s", instr)
	}
	if strings.Contains(instr, "## Squad Operating Protocol") || strings.Contains(instr, "## Squad Roster") {
		t.Fatalf("relay leg run must NOT get the squad coordinator protocol, got:\n%s", instr)
	}
	if isLeader {
		t.Fatalf("relay leg run must arrive as a worker turn (is_leader_task=false): %s", raw)
	}
}

// TestClaim_RelayIssue_NonLegAgent_NoLeaderBriefing: on a relay, even a
// leader-flagged run by an agent that is NOT on the chain gets no coordinator
// protocol — the chain coordinates. It degrades to a plain agent turn.
func TestClaim_RelayIssue_NonLegAgent_NoLeaderBriefing(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	fx := newSquadBriefingClaimFixture(t, ctx, "Relay nonleg briefing")

	otherID := createHandlerTestAgent(t, "Relay Nonleg Other", nil)
	insertRelayStep(t, fx.IssueID, 0, otherID, "执行", "doing", "")
	enqueueClaimTask(t, ctx, fx, true /*isLeader*/, true /*withSquadID*/)

	_, instr, isLeader, raw := claimAgentInstructionsForTest(t, fx.RuntimeID)
	if strings.Contains(instr, "## Squad Operating Protocol") || strings.Contains(instr, "## Squad Roster") {
		t.Fatalf("relay issue must not inject the squad coordinator protocol, got:\n%s", instr)
	}
	if strings.Contains(instr, "## Relay Leg Briefing") {
		t.Fatalf("an agent that is not on the chain must not be told it is a leg, got:\n%s", instr)
	}
	if isLeader {
		t.Fatalf("relay issue: leader flag must degrade to a plain turn: %s", raw)
	}
}
