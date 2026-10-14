package handler

import (
	"net/http"
	"testing"

	"github.com/kscsky/quickwork/server/internal/service"
	"github.com/kscsky/quickwork/server/internal/testutil"
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
