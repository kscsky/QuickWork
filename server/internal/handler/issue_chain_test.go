package handler

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/kscsky/quickwork/server/internal/service"
	"github.com/kscsky/quickwork/server/internal/testutil"
	db "github.com/kscsky/quickwork/server/pkg/db/generated"
)

// The relay's two ways out of parked, plus the list-page read that draws the
// strips: binding a missing agent restarts the step on its own, skipping moves
// the relay past it, and the bulk read answers a whole page in one request.

// relayFixture is one squad-assigned issue with an authored relay.
type relayFixture struct {
	issueID string
	squadID string
	// agentBound: steps 0 and 2 run on these; step 1 is the parked holder.
	leaderAgent string
	nextAgent   string
	parkedUser  string
}

// newRelayFixture builds the shape the whole feature turns on: a squad task
// whose relay reached a person with no agent.
func newRelayFixture(t *testing.T) relayFixture {
	t.Helper()

	leaderAgent := createHandlerTestAgent(t, "relay-leader", nil)
	nextAgent := createHandlerTestAgent(t, "relay-next", nil)
	squadID := dbfx.Squad(t, "Relay squad", leaderAgent)

	holder := dbfx.User(t, "Relay holder", "relay-holder@example.test")
	dbfx.Member(t, testWorkspaceID, holder, "member")
	dbfx.SquadMember(t, squadID, "member", holder, testutil.Cols{"role": "reviewer"})

	issueID := dbfx.Issue(t, "Relay task", testutil.Cols{
		"assignee_type": "squad",
		"assignee_id":   squadID,
	})

	// 0 done → 1 parked (holder, no agent) → 2 pending (has an agent, so a
	// skip has somewhere to move to).
	dbfx.Insert(t, "issue_chain_step", testutil.Cols{
		"issue_id": issueID, "position": 0, "holder_user_id": testUserID,
		"agent_id": leaderAgent, "title": "break down", "state": service.ChainStateDone,
	})
	dbfx.Insert(t, "issue_chain_step", testutil.Cols{
		"issue_id": issueID, "position": 1, "holder_user_id": holder,
		"title": "review", "state": service.ChainStateParked,
	})
	dbfx.Insert(t, "issue_chain_step", testutil.Cols{
		"issue_id": issueID, "position": 2, "holder_user_id": testUserID,
		"agent_id": nextAgent, "title": "ship", "state": service.ChainStatePending,
	})

	return relayFixture{
		issueID:     issueID,
		squadID:     squadID,
		leaderAgent: leaderAgent,
		nextAgent:   nextAgent,
		parkedUser:  holder,
	}
}

func stepState(t *testing.T, issueID string, position int) string {
	t.Helper()
	var state string
	dbfx.QueryRow(t,
		`SELECT state FROM issue_chain_step WHERE issue_id = $1 AND position = $2`,
		issueID, position,
	).Scan(&state)
	return state
}

func TestSkipIssueChainStep(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	f := newRelayFixture(t)

	var resp IssueChainResponse
	testutil.Call(t, testHandler.SkipIssueChainStep, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+f.issueID+"/chain/skip", nil),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusOK).JSON(&resp)

	if resp.Parked {
		t.Fatalf("chain still reports parked after skipping its only parked step: %+v", resp.Steps)
	}
	if len(resp.Steps) != 3 {
		t.Fatalf("expected 3 steps, got %d", len(resp.Steps))
	}
	if got := resp.Steps[1].State; got != service.ChainStateSkipped {
		t.Fatalf("step 1 state: got %q want %q", got, service.ChainStateSkipped)
	}
	// The relay moved on: step 2 has an agent, so it starts.
	if got := resp.Steps[2].State; got != service.ChainStateDoing {
		t.Fatalf("step 2 state: got %q want %q", got, service.ChainStateDoing)
	}
	if got := stepState(t, f.issueID, 2); got != service.ChainStateDoing {
		t.Fatalf("step 2 state in the database: got %q want %q", got, service.ChainStateDoing)
	}

	// Nothing is parked anymore — a second skip is a conflict, not a silence.
	testutil.Call(t, testHandler.SkipIssueChainStep, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+f.issueID+"/chain/skip", nil),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusConflict)
}

func TestSkipIssueChainStepWithoutChain(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	issueID := dbfx.Issue(t, "Plain task", nil)

	testutil.Call(t, testHandler.SkipIssueChainStep, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+issueID+"/chain/skip", nil),
		"workspaceId", testWorkspaceID, "id", issueID,
	)).Want(http.StatusBadRequest)
}

func TestListIssueChainsBulk(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	f := newRelayFixture(t)
	plainIssueID := dbfx.Issue(t, "Plain task", nil)

	var resp struct {
		Chains []struct {
			IssueID string `json:"issue_id"`
			Parked  bool   `json:"parked"`
			Steps   []struct {
				Position int32  `json:"position"`
				State    string `json:"state"`
			} `json:"steps"`
		} `json:"chains"`
	}
	testutil.Call(t, testHandler.ListIssueChains, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/chains", map[string]any{
			"issue_ids": []string{f.issueID, plainIssueID},
		}),
		"workspaceId", testWorkspaceID,
	)).Want(http.StatusOK).JSON(&resp)

	if len(resp.Chains) != 1 {
		t.Fatalf("expected exactly the one chained task, got %d chains", len(resp.Chains))
	}
	chain := resp.Chains[0]
	if chain.IssueID != f.issueID {
		t.Fatalf("chain belongs to %s, want %s", chain.IssueID, f.issueID)
	}
	if !chain.Parked {
		t.Fatalf("the relay is parked on a holder with no agent; flag says otherwise")
	}
	if len(chain.Steps) != 3 || chain.Steps[1].State != service.ChainStateParked {
		t.Fatalf("unexpected chain steps: %+v", chain.Steps)
	}
}

func TestListIssueChainsScopesToWorkspace(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	// A chained issue in a workspace the caller is not asking about. The ids
	// are caller-supplied, so tenancy must come from the join, not the ids.
	otherWorkspaceID := dbfx.Workspace(t, "Other workspace", "other-ws-relay-test")
	otherIssueID := dbfx.Insert(t, "issue", testutil.Cols{
		"workspace_id": otherWorkspaceID,
		"title":        "Other tenant's task",
		"status":       "todo",
		"priority":     "none",
		"creator_type": "member",
		"creator_id":   testUserID,
		"position":     0,
		"number":       1,
	})
	dbfx.Insert(t, "issue_chain_step", testutil.Cols{
		"issue_id": otherIssueID, "position": 0, "holder_user_id": testUserID,
		"title": "other", "state": service.ChainStateDoing,
	})

	var resp struct {
		Chains []struct {
			IssueID string `json:"issue_id"`
		} `json:"chains"`
	}
	testutil.Call(t, testHandler.ListIssueChains, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/chains", map[string]any{
			"issue_ids": []string{otherIssueID},
		}),
		"workspaceId", testWorkspaceID,
	)).Want(http.StatusOK).JSON(&resp)

	if len(resp.Chains) != 0 {
		t.Fatalf("a chain from another workspace leaked into the response: %+v", resp.Chains)
	}
}

func TestListIssueChainsEmptyWindowAnswersEmpty(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	var resp struct {
		Chains []any `json:"chains"`
	}
	testutil.Call(t, testHandler.ListIssueChains, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/chains", map[string]any{
			"issue_ids": []string{},
		}),
		"workspaceId", testWorkspaceID,
	)).Want(http.StatusOK).JSON(&resp)

	if resp.Chains == nil || len(resp.Chains) != 0 {
		t.Fatalf("expected an empty chains array, got %#v", resp.Chains)
	}
}

func TestUpdateSquadMemberAgentResumesParkedChain(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	f := newRelayFixture(t)

	// The parked holder now owns an agent — binding it is what should unpark
	// the relay, without anyone touching the task.
	runtimeID := handlerTestRuntimeID(t)
	holderAgentID := dbfx.Agent(t, "holder's agent", runtimeID, testutil.Cols{
		"owner_id":   f.parkedUser,
		"visibility": "workspace",
	})

	testutil.Call(t, testHandler.UpdateSquadMemberAgent, testutil.WithURLParams(
		newRequestAs(f.parkedUser, http.MethodPatch, "/api/squads/"+f.squadID+"/members/agent", map[string]any{
			"member_type": "member",
			"member_id":   f.parkedUser,
			"agent_id":    holderAgentID,
		}),
		"workspaceId", testWorkspaceID, "id", f.squadID,
	)).Want(http.StatusOK)

	if got := stepState(t, f.issueID, 1); got != service.ChainStateDoing {
		t.Fatalf("parked step did not resume after its holder bound an agent: state %q", got)
	}
	var stepAgent string
	dbfx.QueryRow(t,
		`SELECT COALESCE(agent_id::text, '') FROM issue_chain_step WHERE issue_id = $1 AND position = 1`,
		f.issueID,
	).Scan(&stepAgent)
	if stepAgent != holderAgentID {
		t.Fatalf("resumed step records agent %q, want %q", stepAgent, holderAgentID)
	}

	// The step resumed onto the agent that just got bound, so a run exists.
	queued := dbfx.Count(t,
		`SELECT count(*) FROM agent_task_queue WHERE issue_id = $1 AND agent_id = $2`,
		f.issueID, holderAgentID,
	)
	if queued != 1 {
		t.Fatalf("expected one enqueued run for the resumed step, got %d", queued)
	}
}

// The compose canvas arranges a route and hands it in without saving it as a
// playbook, so the create endpoint takes steps directly. Three sources feed the
// relay after the leader and the precedence between them is the contract: a
// named playbook, then the handed-in route, then the squad's own order.
func TestCreateIssueChainSources(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	leaderAgent := createHandlerTestAgent(t, "chain-source-leader", nil)
	squadID := dbfx.Squad(t, "Chain source squad", leaderAgent)
	dbfx.SquadMember(t, squadID, "member", testUserID, testutil.Cols{"role": "leader"})

	second := dbfx.User(t, "Second holder", "chain-second@example.test")
	third := dbfx.User(t, "Third holder", "chain-third@example.test")
	for _, u := range []string{second, third} {
		dbfx.Member(t, testWorkspaceID, u, "member")
		dbfx.SquadMember(t, squadID, "member", u, testutil.Cols{"role": "executor"})
	}

	newTask := func(t *testing.T) string {
		t.Helper()
		return dbfx.Issue(t, "Chain source task", testutil.Cols{
			"assignee_type": "squad",
			"assignee_id":   squadID,
		})
	}
	postChain := func(t *testing.T, issueID string, body any) []IssueChainStepResponse {
		t.Helper()
		var resp IssueChainResponse
		testutil.Call(t, testHandler.CreateIssueChain, testutil.WithURLParams(
			newRequest(http.MethodPost, "/api/workspaces/"+testWorkspaceID+"/issues/"+issueID+"/chain", body),
			"workspaceId", testWorkspaceID, "id", issueID,
		)).Want(http.StatusCreated).JSON(&resp)
		return resp.Steps
	}
	holderAt := func(steps []IssueChainStepResponse, position int32) string {
		t.Helper()
		for _, s := range steps {
			if s.Position == position {
				return s.HolderUserID
			}
		}
		t.Fatalf("no step at position %d in %+v", position, steps)
		return ""
	}

	t.Run("handed-in route is written after the leader", func(t *testing.T) {
		steps := postChain(t, newTask(t), map[string]any{
			"steps": []map[string]any{
				{"holder_user_id": second, "title": "实现"},
				{"holder_user_id": third, "title": "验证"},
			},
		})
		if len(steps) != 3 {
			t.Fatalf("expected leader + 2 handed-in steps, got %+v", steps)
		}
		if got := holderAt(steps, 0); got != testUserID {
			t.Errorf("step 0 holds %q, want the squad leader %q", got, testUserID)
		}
		if got := holderAt(steps, 1); got != second {
			t.Errorf("step 1 holds %q, want %q", got, second)
		}
		if got := holderAt(steps, 2); got != third {
			t.Errorf("step 2 holds %q, want %q", got, third)
		}
	})

	// A named playbook is the record of what was agreed; a route sent alongside
	// it must not quietly replace it.
	t.Run("a named playbook wins over the handed-in route", func(t *testing.T) {
		playbookID := dbfx.Insert(t, "squad_playbook", testutil.Cols{
			"workspace_id": testWorkspaceID,
			"squad_id":     squadID,
			"name":         "source test route",
			"description":  "",
			"steps":        `[{"holder_user_id":"` + third + `","title":"playbook step"}]`,
			"created_by":   testUserID,
		})
		steps := postChain(t, newTask(t), map[string]any{
			"playbook_id": playbookID,
			"steps": []map[string]any{
				{"holder_user_id": second, "title": "handed-in"},
			},
		})
		if len(steps) != 2 {
			t.Fatalf("expected leader + the playbook's one step, got %+v", steps)
		}
		if got := holderAt(steps, 1); got != third {
			t.Errorf("step 1 holds %q; the playbook names %q", got, third)
		}
	})

	// A bare POST is the pre-existing behavior: the squad's members in the
	// order they joined. Nothing about the new field may change it.
	t.Run("no playbook and no route falls back to the squad's own order", func(t *testing.T) {
		steps := postChain(t, newTask(t), nil)
		if len(steps) != 3 {
			t.Fatalf("expected the leader plus both members, got %+v", steps)
		}
		if got := holderAt(steps, 1); got != second {
			t.Errorf("step 1 holds %q, want the first-joined member %q", got, second)
		}
		if got := holderAt(steps, 2); got != third {
			t.Errorf("step 2 holds %q, want %q", got, third)
		}
	})

	// Naming the leader in the relay would run the briefing twice, so
	// InstantiateChain drops them. The handed-in route gets the same treatment.
	t.Run("a handed-in step for the leader is dropped, not duplicated", func(t *testing.T) {
		steps := postChain(t, newTask(t), map[string]any{
			"steps": []map[string]any{
				{"holder_user_id": testUserID, "title": "leader again"},
				{"holder_user_id": third, "title": "验证"},
			},
		})
		if len(steps) != 2 {
			t.Fatalf("expected leader + 1 step, got %+v", steps)
		}
		if got := holderAt(steps, 1); got != third {
			t.Errorf("step 1 holds %q, want %q", got, third)
		}
	})

	// An unparsable holder would silently drop a link from the relay, which is
	// worse than no relay at all.
	t.Run("a malformed holder fails the whole instantiation", func(t *testing.T) {
		issueID := newTask(t)
		testutil.Call(t, testHandler.CreateIssueChain, testutil.WithURLParams(
			newRequest(http.MethodPost, "/api/workspaces/"+testWorkspaceID+"/issues/"+issueID+"/chain", map[string]any{
				"steps": []map[string]any{{"holder_user_id": "not-a-uuid", "title": "bad"}},
			}),
			"workspaceId", testWorkspaceID, "id", issueID,
		)).Want(http.StatusInternalServerError)

		if n := dbfx.Count(t, `SELECT count(*) FROM issue_chain_step WHERE issue_id = $1`, issueID); n != 0 {
			t.Fatalf("a rejected route left %d chain steps behind; the write must be all-or-nothing", n)
		}
	})
}

// The relay's review gate (owner's personal-view model, 2026-10-14): a run
// finishing no longer advances the chain — it parks the step in `reviewing`,
// and only its holder's own 通过 hands the baton on. The 403 below is the
// permission the whole model hangs on ("只有这一棒的负责人能点通过"), so it is
// pinned here rather than left to the UI.

type reviewFixture struct {
	issueID   string
	outsider  string
	nextAgent string
}

// newReviewFixture: 0 done → 1 reviewing (held by the acting test user) →
// 2 pending with an agent bound, so an approval has somewhere to land.
func newReviewFixture(t *testing.T) reviewFixture {
	t.Helper()

	nextAgent := createHandlerTestAgent(t, "review-next", nil)
	squadID := dbfx.Squad(t, "Review squad", nextAgent)

	outsider := dbfx.User(t, "Review outsider", "review-outsider@example.test")
	dbfx.Member(t, testWorkspaceID, outsider, "member")

	issueID := dbfx.Issue(t, "Review task", testutil.Cols{
		"assignee_type": "squad",
		"assignee_id":   squadID,
	})

	dbfx.Insert(t, "issue_chain_step", testutil.Cols{
		"issue_id": issueID, "position": 0, "holder_user_id": testUserID,
		"agent_id": nextAgent, "title": "break down", "state": service.ChainStateDone,
	})
	dbfx.Insert(t, "issue_chain_step", testutil.Cols{
		"issue_id": issueID, "position": 1, "holder_user_id": testUserID,
		"agent_id": nextAgent, "title": "implement", "state": service.ChainStateReviewing,
	})
	dbfx.Insert(t, "issue_chain_step", testutil.Cols{
		"issue_id": issueID, "position": 2, "holder_user_id": testUserID,
		"agent_id": nextAgent, "title": "verify", "state": service.ChainStatePending,
	})

	return reviewFixture{issueID: issueID, outsider: outsider, nextAgent: nextAgent}
}

func TestApproveIssueChainStep(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	f := newReviewFixture(t)

	// Somebody who is not this leg's holder cannot carry the relay on.
	testutil.Call(t, testHandler.ApproveIssueChainStep, testutil.WithURLParams(
		newRequestAsUser(f.outsider, http.MethodPost, "/api/issues/"+f.issueID+"/chain/approve", nil),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusForbidden)
	if got := stepState(t, f.issueID, 1); got != service.ChainStateReviewing {
		t.Fatalf("a refused approval moved the step: got %q", got)
	}

	// The holder's own 通过 is what moves it, and the next step starts.
	var resp IssueChainResponse
	testutil.Call(t, testHandler.ApproveIssueChainStep, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+f.issueID+"/chain/approve", nil),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusOK).JSON(&resp)
	if resp.Reviewing {
		t.Fatalf("chain still reports reviewing after its holder approved: %+v", resp.Steps)
	}
	if got := resp.Steps[1].State; got != service.ChainStateDone {
		t.Fatalf("step 1 state: got %q want %q", got, service.ChainStateDone)
	}
	if got := stepState(t, f.issueID, 1); got != service.ChainStateDone {
		t.Fatalf("step 1 state in the database: got %q want %q", got, service.ChainStateDone)
	}
	if got := stepState(t, f.issueID, 2); got != service.ChainStateDoing {
		t.Fatalf("step 2 should have started: got %q want %q", got, service.ChainStateDoing)
	}

	// Nothing is waiting for review anymore — a second approve is a conflict.
	testutil.Call(t, testHandler.ApproveIssueChainStep, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+f.issueID+"/chain/approve", nil),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusConflict)
}

// 审核 = 交接单: the approve request carries the package the holder curated —
// the summary they wrote and the files they ticked — and the finished leg
// publishes it to every reader of the chain.
func TestApproveIssueChainStepHandoff(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	f := newReviewFixture(t)

	// A malformed package is refused by the boundary, not the UI: a file with
	// no name is not a curated entry.
	testutil.Call(t, testHandler.ApproveIssueChainStep, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+f.issueID+"/chain/approve",
			map[string]any{"summary": "x", "files": []any{map[string]any{"name": "  "}}}),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusBadRequest)
	if got := stepState(t, f.issueID, 1); got != service.ChainStateReviewing {
		t.Fatalf("a rejected package moved the step: got %q", got)
	}

	var resp IssueChainResponse
	testutil.Call(t, testHandler.ApproveIssueChainStep, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+f.issueID+"/chain/approve", map[string]any{
			"summary": "  退避改 1/2/4，超 3 次进 audit_queue；对账口径补失败分支。  ",
			"files": []map[string]any{
				{"name": "实施清单.md", "kind": "attachment", "attachment_id": "11111111-1111-4111-8111-111111111111"},
				{"name": "feat/retry-backoff", "kind": "branch"},
			},
		}),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusOK).JSON(&resp)

	approved := resp.Steps[1]
	if approved.State != service.ChainStateDone {
		t.Fatalf("step 1 state: got %q want %q", approved.State, service.ChainStateDone)
	}
	if approved.Handoff == nil {
		t.Fatalf("the approved leg published no handoff: %+v", approved)
	}
	if approved.Handoff.Summary != "退避改 1/2/4，超 3 次进 audit_queue；对账口径补失败分支。" {
		t.Fatalf("summary was not trimmed and stored: %q", approved.Handoff.Summary)
	}
	if len(approved.Handoff.Files) != 2 || approved.Handoff.Files[1].Kind != "branch" {
		t.Fatalf("files did not round-trip: %+v", approved.Handoff.Files)
	}

	// The package lives on the step: a later chain read (by anyone) shows it.
	var reread IssueChainResponse
	testutil.Call(t, testHandler.ListIssueChain, testutil.WithURLParams(
		newRequest(http.MethodGet, "/api/issues/"+f.issueID+"/chain", nil),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusOK).JSON(&reread)
	if reread.Steps[1].Handoff == nil || reread.Steps[1].Handoff.Summary == "" {
		t.Fatalf("the approved leg's package is missing on re-read: %+v", reread.Steps[1])
	}
	if reread.Steps[0].Handoff != nil {
		t.Fatalf("a leg with no package must not grow one: %+v", reread.Steps[0])
	}
}

func TestSetIssueChainStepPlan(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	f := newReviewFixture(t)

	// The holder writes their own leg's brief.
	var resp IssueChainResponse
	testutil.Call(t, testHandler.SetIssueChainStepPlan, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+f.issueID+"/chain/plan",
			map[string]string{"plan": "按上一棒清单实现 1/2/4 退避"}),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusOK).JSON(&resp)
	var plan string
	dbfx.QueryRow(t,
		`SELECT plan FROM issue_chain_step WHERE issue_id = $1 AND position = 1`,
		f.issueID,
	).Scan(&plan)
	if plan != "按上一棒清单实现 1/2/4 退避" {
		t.Fatalf("plan not saved: %q", plan)
	}

	// Writing somebody else's leg is refused: that is what keeps the view
	// personal — nobody authors a brief on another person's behalf.
	testutil.Call(t, testHandler.SetIssueChainStepPlan, testutil.WithURLParams(
		newRequestAsUser(f.outsider, http.MethodPost, "/api/issues/"+f.issueID+"/chain/plan",
			map[string]string{"plan": "替别人写"}),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusForbidden)
	dbfx.QueryRow(t,
		`SELECT plan FROM issue_chain_step WHERE issue_id = $1 AND position = 1`,
		f.issueID,
	).Scan(&plan)
	if plan != "按上一棒清单实现 1/2/4 退避" {
		t.Fatalf("a refused write changed the plan: %q", plan)
	}
}

// 单流分界: a leg-scoped comment belongs to its holder. Posting into somebody
// else's leg is refused at the server, and the timeline query only returns leg
// content to the leg's holder — everyone else gets the room and a count.
func TestIssueChainLegCommentBoundary(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	f := newReviewFixture(t)

	var stepID string
	dbfx.QueryRow(t,
		`SELECT id::text FROM issue_chain_step WHERE issue_id = $1 AND position = 1`,
		f.issueID,
	).Scan(&stepID)

	// The holder posts into their own leg: accepted, and the row carries the
	// attribution the read side filters on.
	testutil.Call(t, testHandler.CreateComment, testutil.WithURLParams(
		newRequestAsUser(testUserID, http.MethodPost, "/api/issues/"+f.issueID+"/comments",
			map[string]any{"content": "这一棒先这样", "chain_step_id": stepID}),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusCreated)

	// Somebody else tries to write into the same leg: 403, and nothing lands.
	testutil.Call(t, testHandler.CreateComment, testutil.WithURLParams(
		newRequestAsUser(f.outsider, http.MethodPost, "/api/issues/"+f.issueID+"/comments",
			map[string]any{"content": "替别人说话", "chain_step_id": stepID}),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusForbidden)

	// A room comment from the outsider is unchanged behaviour.
	testutil.Call(t, testHandler.CreateComment, testutil.WithURLParams(
		newRequestAsUser(f.outsider, http.MethodPost, "/api/issues/"+f.issueID+"/comments",
			map[string]any{"content": "催一下"}),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusCreated)

	var legCount, roomCount int
	dbfx.QueryRow(t,
		`SELECT count(*) FROM comment WHERE issue_id = $1 AND chain_step_id = $2`,
		f.issueID, stepID,
	).Scan(&legCount)
	dbfx.QueryRow(t,
		`SELECT count(*) FROM comment WHERE issue_id = $1 AND chain_step_id IS NULL`,
		f.issueID,
	).Scan(&roomCount)
	if legCount != 1 {
		t.Fatalf("leg comments: got %d want 1 (the refused post must not land)", legCount)
	}
	if roomCount != 1 {
		t.Fatalf("room comments: got %d want 1", roomCount)
	}

	// Read side: the holder sees their leg's comment, the outsider does not.
	issueUUID := parseUUID(f.issueID)
	holderRows, err := testHandler.Queries.ListCommentsForIssue(context.Background(), db.ListCommentsForIssueParams{
		IssueID:     issueUUID,
		WorkspaceID: parseUUID(testWorkspaceID),
		ViewerID:    parseUUID(testUserID),
		RowLimit:    100,
	})
	if err != nil {
		t.Fatalf("holder read: %v", err)
	}
	if len(holderRows) != 2 {
		t.Fatalf("holder sees %d comments, want 2 (room + own leg)", len(holderRows))
	}
	outsiderRows, err := testHandler.Queries.ListCommentsForIssue(context.Background(), db.ListCommentsForIssueParams{
		IssueID:     issueUUID,
		WorkspaceID: parseUUID(testWorkspaceID),
		ViewerID:    parseUUID(f.outsider),
		RowLimit:    100,
	})
	if err != nil {
		t.Fatalf("outsider read: %v", err)
	}
	if len(outsiderRows) != 1 {
		t.Fatalf("outsider sees %d comments, want 1 (room only)", len(outsiderRows))
	}

	// The chain response carries the count the locked placeholder renders.
	var chain IssueChainResponse
	testutil.Call(t, testHandler.ListIssueChain, testutil.WithURLParams(
		newRequest(http.MethodGet, "/api/issues/"+f.issueID+"/chain", nil),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusOK).JSON(&chain)
	if chain.Steps[1].LegCommentCount != 1 {
		t.Fatalf("leg_comment_count: got %d want 1", chain.Steps[1].LegCommentCount)
	}
}

// A squad task's status is a projection of its relay: the relay starting,
// parking and finishing each lands on issue.status, so the surfaces that
// still speak status (filters, inbox, the sweeper) agree with the chain
// without anyone setting it by hand.
func TestChainDrivesIssueStatus(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	statusOf := func(issueID string) string {
		t.Helper()
		var status string
		dbfx.QueryRow(t, `SELECT status FROM issue WHERE id = $1`, issueID).Scan(&status)
		return status
	}
	skip := func(issueID string) {
		t.Helper()
		testutil.Call(t, testHandler.SkipIssueChainStep, testutil.WithURLParams(
			newRequest(http.MethodPost, "/api/issues/"+issueID+"/chain/skip", nil),
			"workspaceId", testWorkspaceID, "id", issueID,
		)).Want(http.StatusOK)
	}

	// Skipping past a parked step with a runnable next leg moves the relay on:
	// the task is in progress again.
	live := newRelayFixture(t)
	skip(live.issueID)
	if got := statusOf(live.issueID); got != "in_progress" {
		t.Fatalf("status after the relay moved on: got %q want %q", got, "in_progress")
	}

	// A relay that parks again parks the task too — blocked is the projection's
	// word for exactly this state.
	leaderAgent := createHandlerTestAgent(t, "status-leader", nil)
	squadID := dbfx.Squad(t, "Status squad", leaderAgent)
	holder := dbfx.User(t, "Status holder", "status-holder@example.test")
	dbfx.Member(t, testWorkspaceID, holder, "member")
	issueID := dbfx.Issue(t, "Status task", testutil.Cols{
		"assignee_type": "squad",
		"assignee_id":   squadID,
	})
	dbfx.Insert(t, "issue_chain_step", testutil.Cols{
		"issue_id": issueID, "position": 0, "holder_user_id": testUserID,
		"agent_id": leaderAgent, "title": "break down", "state": service.ChainStateDone,
	})
	dbfx.Insert(t, "issue_chain_step", testutil.Cols{
		"issue_id": issueID, "position": 1, "holder_user_id": holder,
		"title": "review", "state": service.ChainStateParked,
	})
	dbfx.Insert(t, "issue_chain_step", testutil.Cols{
		"issue_id": issueID, "position": 2, "holder_user_id": holder,
		"title": "verify", "state": service.ChainStatePending,
	})
	skip(issueID)
	if got := statusOf(issueID); got != "blocked" {
		t.Fatalf("status after the relay parked: got %q want %q", got, "blocked")
	}

	// The last leg passing completes the task. (Driving the step straight to
	// reviewing stands in for its run finishing; the projection is what is
	// under test, not the queue.)
	dbfx.QueryRow(t, `UPDATE issue_chain_step SET state = $1 WHERE issue_id = $2 AND position = 2 RETURNING state`,
		service.ChainStateReviewing, issueID).Scan(new(string))
	var resp IssueChainResponse
	testutil.Call(t, testHandler.ApproveIssueChainStep, testutil.WithURLParams(
		newRequestAsUser(holder, http.MethodPost, "/api/issues/"+issueID+"/chain/approve", nil),
		"workspaceId", testWorkspaceID, "id", issueID,
	)).Want(http.StatusOK).JSON(&resp)
	if got := statusOf(issueID); got != "done" {
		t.Fatalf("status after the last leg passed: got %q want %q", got, "done")
	}

}

// A cancelled task is the person's word against the chains: late relay events
// never resurrect it. (Own test so the shared fixture's names stay unique.)
func TestChainStatusRespectsCancelled(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	cancelled := newRelayFixture(t)
	dbfx.QueryRow(t, `UPDATE issue SET status = 'cancelled' WHERE id = $1 RETURNING status`, cancelled.issueID).Scan(new(string))
	testutil.Call(t, testHandler.SkipIssueChainStep, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+cancelled.issueID+"/chain/skip", nil),
		"workspaceId", testWorkspaceID, "id", cancelled.issueID,
	)).Want(http.StatusOK)
	var status string
	dbfx.QueryRow(t, `SELECT status FROM issue WHERE id = $1`, cancelled.issueID).Scan(&status)
	if status != "cancelled" {
		t.Fatalf("relay events resurrected a cancelled task: got %q", status)
	}
}

// 产出 md: the holder asks their leg's own agent to write the leg's handoff
// document (审核 phase). The run is the leg agent's worker turn carrying the
// output instruction; a non-holder cannot ask, and a second ask while the
// first run still holds the turn is refused instead of silently stacking.
func TestGenerateIssueChainLegOutput(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	f := newReviewFixture(t)

	// Somebody who is not this leg's holder cannot ask for its output.
	testutil.Call(t, testHandler.GenerateIssueChainLegOutput, testutil.WithURLParams(
		newRequestAsUser(f.outsider, http.MethodPost, "/api/issues/"+f.issueID+"/chain/output", nil),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusForbidden)

	// The holder's ask enqueues the leg agent's run with the instruction note,
	// as a worker turn — no leader framing, no squad context.
	var out struct {
		TaskID string `json:"task_id"`
		Status string `json:"status"`
	}
	testutil.Call(t, testHandler.GenerateIssueChainLegOutput, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+f.issueID+"/chain/output", nil),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusOK).JSON(&out)
	if out.TaskID == "" || out.Status != "queued" {
		t.Fatalf("output ask = %+v, want a queued task id", out)
	}

	var note string
	var isLeader bool
	var squadIDValid bool
	dbfx.QueryRow(t, `
		SELECT handoff_note, is_leader_task, squad_id IS NOT NULL
		FROM agent_task_queue WHERE id = $1
	`, out.TaskID).Scan(&note, &isLeader, &squadIDValid)
	if !strings.Contains(note, "quickwork-relay-leg-output") {
		t.Fatalf("output run carries no instruction note: %q", note)
	}
	if isLeader || squadIDValid {
		t.Fatalf("output run must be a plain leg-agent turn: is_leader=%v squad=%v", isLeader, squadIDValid)
	}

	// A second ask while that run holds the turn is a conflict, not a stack.
	testutil.Call(t, testHandler.GenerateIssueChainLegOutput, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+f.issueID+"/chain/output", nil),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusConflict)
}
