package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/kscsky/quickwork/server/internal/dispatch"
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
	// the relay, without anyone touching the task. The agent must sit on a
	// runtime its owner can actually claim on: the shared test runtime is
	// private to the test user, and the readiness gate correctly refuses to
	// "resume" onto a machine that will never take the work.
	holderRuntimeID := dbfx.Insert(t, "agent_runtime", testutil.Cols{
		"workspace_id": testWorkspaceID,
		"name":         "Parked holder runtime",
		"runtime_mode": "cloud",
		"provider":     "handler_test_holder_runtime",
		"status":       "online",
		"device_info":  "holder runtime",
		"metadata":     testutil.Raw("'{}'::jsonb"),
		"owner_id":     f.parkedUser,
		"last_seen_at": testutil.Raw("now()"),
	})
	holderAgentID := dbfx.Agent(t, "holder's agent", holderRuntimeID, testutil.Cols{
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
		newRequest(http.MethodPost, "/api/issues/"+f.issueID+"/chain/approve", map[string]any{
			"summary":    "leg delivered",
			"acceptance": []map[string]any{{"label": "done", "requirement": "work delivered", "state": "pass"}},
			"next_brief": []string{"continue the relay"},
		}),
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
			"acceptance": []map[string]any{
				{"label": "口径", "requirement": "超 3 次进审计队列", "delivered": "见实施清单 §2", "state": "pass"},
				{"label": "来源", "requirement": "每个结论可复核", "delivered": "3 条待补", "state": "warn"},
			},
			"open_questions": []string{"人工队列的容量上限还没定"},
			"next_brief":     []string{"补 1/2/4 退避的压测数据", "把审计队列接进对账报表"},
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
	if len(approved.Handoff.Acceptance) != 2 ||
		approved.Handoff.Acceptance[1].State != "warn" ||
		approved.Handoff.Acceptance[0].Label != "口径" {
		t.Fatalf("acceptance ledger did not round-trip: %+v", approved.Handoff.Acceptance)
	}
	if len(approved.Handoff.OpenQuestions) != 1 || len(approved.Handoff.NextBrief) != 2 {
		t.Fatalf("open questions / next brief did not round-trip: %+v", approved.Handoff)
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

// 退回修改: the holder preserves the package they were reviewing, records why
// it is not acceptable, and sends the leg back to its own agent. The baton
// must not move, and the reason must reach the revision run.
func TestReturnIssueChainStep(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	f := newReviewFixture(t)

	testutil.Call(t, testHandler.ReturnIssueChainStep, testutil.WithURLParams(
		newRequestAsUser(f.outsider, http.MethodPost, "/api/issues/"+f.issueID+"/chain/return",
			map[string]any{"reason": "not mine"}),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusForbidden)
	if got := stepState(t, f.issueID, 1); got != service.ChainStateReviewing {
		t.Fatalf("a refused return moved the step: got %q", got)
	}

	testutil.Call(t, testHandler.ReturnIssueChainStep, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+f.issueID+"/chain/return",
			map[string]any{"reason": "   "}),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusBadRequest)
	if got := stepState(t, f.issueID, 1); got != service.ChainStateReviewing {
		t.Fatalf("a reasonless return moved the step: got %q", got)
	}

	var resp IssueChainResponse
	testutil.Call(t, testHandler.ReturnIssueChainStep, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+f.issueID+"/chain/return", map[string]any{
			"reason":         "  下沉市场证据不足，补齐 6 条来源。  ",
			"summary":        "第一轮拆解与方案",
			"acceptance":     []map[string]any{{"label": "来源", "requirement": "每个结论可复核", "delivered": "3 条待补", "state": "warn"}},
			"open_questions": []string{"下沉市场样本只有 2 条"},
			"next_brief":     []string{"补齐 6 条来源", "逐条校验 URL"},
		}),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusOK).JSON(&resp)

	returned := resp.Steps[1]
	if returned.State != service.ChainStateDoing {
		t.Fatalf("returned step state: got %q want %q", returned.State, service.ChainStateDoing)
	}
	if returned.Handoff == nil || returned.Handoff.Returned == nil {
		t.Fatalf("the return did not preserve a package with its reason: %+v", returned.Handoff)
	}
	if returned.Handoff.Returned.Reason != "下沉市场证据不足，补齐 6 条来源。" {
		t.Fatalf("return reason was not trimmed and stored: %q", returned.Handoff.Returned.Reason)
	}
	if len(returned.Handoff.Acceptance) != 1 || len(returned.Handoff.NextBrief) != 2 {
		t.Fatalf("the package was not preserved across the return: %+v", returned.Handoff)
	}
	if got := stepState(t, f.issueID, 1); got != service.ChainStateDoing {
		t.Fatalf("returned step state in the database: got %q want %q", got, service.ChainStateDoing)
	}

	var note string
	dbfx.QueryRow(t, `
		SELECT COALESCE(handoff_note, '')
		FROM agent_task_queue
		WHERE issue_id = $1 AND agent_id = $2
		ORDER BY created_at DESC
		LIMIT 1
	`, f.issueID, f.nextAgent).Scan(&note)
	if !strings.Contains(note, "下沉市场证据不足") {
		t.Fatalf("the revision run did not carry the return reason: %q", note)
	}

	// The step is doing again — there is nothing left to return.
	testutil.Call(t, testHandler.ReturnIssueChainStep, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+f.issueID+"/chain/return",
			map[string]any{"reason": "again"}),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusConflict)
}

func TestReturnIssueChainStepWaitsForLegOutput(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	f := newReviewFixture(t)
	dbfx.Insert(t, "agent_task_queue", testutil.Cols{
		"agent_id":     f.nextAgent,
		"issue_id":     f.issueID,
		"runtime_id":   handlerTestRuntimeID(t),
		"status":       "running",
		"handoff_note": service.LegOutputInstruction,
	})

	testutil.Call(t, testHandler.ReturnIssueChainStep, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+f.issueID+"/chain/return",
			map[string]any{"reason": "should wait for the summary"}),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusConflict)
	if got := stepState(t, f.issueID, 1); got != service.ChainStateReviewing {
		t.Fatalf("a blocked return moved the step: got %q", got)
	}
}

// The review gate stays shut while the leg's own summary run is alive. This is
// the KSCS-25 leak: a page reload dropped the UI's "generating" flag and the
// empty package was approved underneath a live summary.
func TestApproveIssueChainStepWaitsForLegOutput(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	f := newReviewFixture(t)

	taskID := dbfx.Insert(t, "agent_task_queue", testutil.Cols{
		"agent_id":     f.nextAgent,
		"issue_id":     f.issueID,
		"runtime_id":   handlerTestRuntimeID(t),
		"status":       "running",
		"handoff_note": service.LegOutputInstruction,
	})

	var chain IssueChainResponse
	testutil.Call(t, testHandler.ListIssueChain, testutil.WithURLParams(
		newRequest(http.MethodGet, "/api/issues/"+f.issueID+"/chain", nil),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusOK).JSON(&chain)
	reviewing := chain.Steps[1]
	if reviewing.OutputTaskID != taskID {
		t.Fatalf("active summary task not exposed on the reviewing step: %+v", reviewing)
	}
	if reviewing.OutputTaskAt == "" {
		t.Fatalf("summary run start time not exposed: %+v", reviewing)
	}

	testutil.Call(t, testHandler.ApproveIssueChainStep, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+f.issueID+"/chain/approve",
			map[string]any{"summary": "should not land"}),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusConflict)
	if got := stepState(t, f.issueID, 1); got != service.ChainStateReviewing {
		t.Fatalf("a blocked approval moved the step: got %q", got)
	}

	// Once the summary run lands, the same approval goes through.
	dbfx.Exec(t, `UPDATE agent_task_queue SET status = 'completed', completed_at = now() WHERE id = $1`, taskID)
	testutil.Call(t, testHandler.ApproveIssueChainStep, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+f.issueID+"/chain/approve",
			map[string]any{
				"summary":    "summary landed",
				"acceptance": []map[string]any{{"label": "done", "requirement": "delivered", "state": "pass"}},
				"next_brief": []string{"continue"},
			}),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusOK)
	if got := stepState(t, f.issueID, 1); got != service.ChainStateDone {
		t.Fatalf("step did not pass after the summary landed: got %q", got)
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
		newRequestAsUser(holder, http.MethodPost, "/api/issues/"+issueID+"/chain/approve", map[string]any{
			"summary":    "final leg delivered",
			"acceptance": []map[string]any{{"label": "done", "requirement": "work delivered", "state": "pass"}},
		}),
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

// A leg whose agent is bound to another member's PRIVATE runtime can never be
// claimed — ClaimAgentTask refuses it. Advancing the relay must park the leg
// with that reason instead of enqueueing a task that sits queued forever, which
// is exactly how KSCS-8/25/26/30's second legs died unnoticed.
func TestAdvanceChainParksOnForeignPrivateRuntime(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	foreign := dbfx.User(t, "Foreign machine owner", "foreign-machine@example.test")
	dbfx.Member(t, testWorkspaceID, foreign, "member")
	foreignRuntime := dbfx.Insert(t, "agent_runtime", testutil.Cols{
		"workspace_id": testWorkspaceID,
		"name":         "Foreign private Claude",
		"runtime_mode": "local",
		"provider":     "claude",
		"status":       "online",
		"visibility":   "private",
		"owner_id":     foreign,
		"last_seen_at": testutil.Raw("now()"),
	})
	stranded := dbfx.Agent(t, "stranded on another machine", foreignRuntime, nil)

	squadID := dbfx.Squad(t, "Parking squad", createHandlerTestAgent(t, "parking leader", nil))
	issueID := dbfx.Issue(t, "Parked relay", testutil.Cols{
		"assignee_type": "squad",
		"assignee_id":   squadID,
	})
	dbfx.Insert(t, "issue_chain_step", testutil.Cols{
		"issue_id": issueID, "position": 0, "holder_user_id": testUserID,
		"title": "plan", "state": service.ChainStateDone,
	})
	dbfx.Insert(t, "issue_chain_step", testutil.Cols{
		"issue_id": issueID, "position": 1, "holder_user_id": testUserID,
		"agent_id": stranded, "title": "deliver", "state": service.ChainStatePending,
	})

	next, err := testHandler.TaskService.AdvanceChain(context.Background(), testHandler.Queries, parseUUID(issueID), pgtype.UUID{})
	if err != nil {
		t.Fatalf("advance: %v", err)
	}
	if next == nil || next.State != service.ChainStateParked {
		t.Fatalf("next step = %+v, want a parked leg", next)
	}
	if next.ParkedReason != string(dispatch.ReasonRuntimePrivateForeign) {
		t.Fatalf("parked_reason = %q, want %q", next.ParkedReason, dispatch.ReasonRuntimePrivateForeign)
	}

	// The point of parking instead of queueing: nothing was handed to the
	// daemon, because nothing would ever claim it.
	if n := dbfx.Count(t, `SELECT count(*) FROM agent_task_queue WHERE issue_id = $1`, issueID); n != 0 {
		t.Fatalf("queued %d task(s) for an agent that cannot claim; want 0", n)
	}

	// The wire carries the explanation the UI localizes.
	chain, err := testHandler.chainResponse(context.Background(), parseUUID(issueID))
	if err != nil {
		t.Fatalf("chain response: %v", err)
	}
	if len(chain.Steps) != 2 || chain.Steps[1].ParkedReason != string(dispatch.ReasonRuntimePrivateForeign) {
		t.Fatalf("chain response reason = %+v, want the parked reason on step 1", chain.Steps)
	}
	if !chain.Parked {
		t.Fatal("chain response must report parked so the list/detail treat it as a wait")
	}
}

// A leg whose run was interrupted (watchdog, stalled stream, cancel) must be
// restartable by its holder without losing the relay: the step stays doing,
// the new run keeps the failed run's lineage, and a second click while that
// run is queued is a conflict instead of a duplicate.
func TestRetryIssueChainStep(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	agentID := createHandlerTestAgent(t, "retry-agent", nil)
	leader := createHandlerTestAgent(t, "retry-leader", nil)
	squadID := dbfx.Squad(t, "Retry squad", leader)
	issueID := dbfx.Issue(t, "Retried relay", testutil.Cols{
		"assignee_type": "squad",
		"assignee_id":   squadID,
	})
	dbfx.Insert(t, "issue_chain_step", testutil.Cols{
		"issue_id": issueID, "position": 0, "holder_user_id": testUserID,
		"agent_id": leader, "title": "plan", "state": service.ChainStateDone,
	})
	dbfx.Insert(t, "issue_chain_step", testutil.Cols{
		"issue_id": issueID, "position": 1, "holder_user_id": testUserID,
		"agent_id": agentID, "title": "deliver", "state": service.ChainStateDoing,
	})
	failedTask := dbfx.Task(t, agentID, testutil.Cols{
		"issue_id":       issueID,
		"status":         "failed",
		"failure_reason": "idle_watchdog",
		"error":          "agent produced no new messages",
		"completed_at":   testutil.Raw("now()"),
	})

	var resp IssueChainRetryResponse
	testutil.Call(t, testHandler.RetryIssueChainStep, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+issueID+"/chain/retry", nil),
		"workspaceId", testWorkspaceID, "id", issueID,
	)).Want(http.StatusOK).JSON(&resp)

	if resp.TaskID == "" {
		t.Fatalf("retry returned no task: %+v", resp.Steps)
	}
	if resp.Steps[1].State != service.ChainStateDoing {
		t.Fatalf("retry moved the leg: state = %q, want doing", resp.Steps[1].State)
	}
	var rerunOf string
	dbfx.QueryRow(t, `SELECT rerun_of_task_id::text FROM agent_task_queue WHERE id = $1`, resp.TaskID).Scan(&rerunOf)
	if rerunOf != failedTask {
		t.Fatalf("retry lineage = %q, want the failed task %q", rerunOf, failedTask)
	}

	// The new run holds the leg's turn; a second retry must not stack another.
	testutil.Call(t, testHandler.RetryIssueChainStep, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+issueID+"/chain/retry", nil),
		"workspaceId", testWorkspaceID, "id", issueID,
	)).Want(http.StatusConflict)
}

// Creating a relay writes the chain and dispatches the leader in one request.
// When the leader cannot claim, the chain's head must say so instead of
// pretending a run is in flight — the exact "chain lies" failure that left
// KSCS-8's first leg doing with nothing behind it.
func TestCreateIssueWithChainParksBlockedLeader(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	foreign := dbfx.User(t, "Relay foreign owner", "relay-foreign@example.test")
	dbfx.Member(t, testWorkspaceID, foreign, "member")
	foreignRuntime := dbfx.Insert(t, "agent_runtime", testutil.Cols{
		"workspace_id": testWorkspaceID,
		"name":         "Foreign private leader runtime",
		"runtime_mode": "local",
		"provider":     "claude",
		"status":       "online",
		"visibility":   "private",
		"owner_id":     foreign,
		"last_seen_at": testutil.Raw("now()"),
	})
	// Owned by the caller, bound to another member's private machine.
	blockedLeader := dbfx.Agent(t, "blocked relay leader", foreignRuntime, nil)
	squadID := dbfx.Squad(t, "Atomic relay squad", blockedLeader)
	dbfx.SquadMember(t, squadID, "member", testUserID, testutil.Cols{
		"role":     "leader",
		"agent_id": blockedLeader,
	})

	w := httptest.NewRecorder()
	testHandler.CreateIssue(w, newRequest(http.MethodPost, "/api/issues?workspace_id="+testWorkspaceID, map[string]any{
		"title":         "Blocked relay create",
		"assignee_type": "squad",
		"assignee_id":   squadID,
		"chain_steps":   []any{},
	}))
	if w.Code != http.StatusCreated {
		t.Fatalf("create relay: got %d: %s", w.Code, w.Body.String())
	}
	var out struct {
		ID     string              `json:"id"`
		Status string              `json:"status"`
		Chain  *IssueChainResponse `json:"chain"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if out.Chain == nil || len(out.Chain.Steps) != 1 {
		t.Fatalf("create response carried no chain: %s", w.Body.String())
	}
	if out.Chain.Steps[0].State != service.ChainStateParked ||
		out.Chain.Steps[0].ParkedReason != string(dispatch.ReasonRuntimePrivateForeign) {
		t.Fatalf("leader step = %+v, want parked/runtime_private_foreign", out.Chain.Steps[0])
	}
	if out.Status != "blocked" {
		t.Fatalf("issue status = %q, want blocked for a parked leader", out.Status)
	}
	if n := dbfx.Count(t, `SELECT count(*) FROM agent_task_queue WHERE issue_id = $1`, out.ID); n != 0 {
		t.Fatalf("queued %d leader task(s) for an agent that cannot claim", n)
	}
}

// The same request on a runnable leader writes step 0 as doing and enqueues
// the leader's run — the chain and the dispatch agree from the first read.
func TestCreateIssueWithChainStartsReadyLeader(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	leaderAgent := createHandlerTestAgent(t, "ready relay leader", nil)
	squadID := dbfx.Squad(t, "Ready relay squad", leaderAgent)
	dbfx.SquadMember(t, squadID, "member", testUserID, testutil.Cols{
		"role":     "leader",
		"agent_id": leaderAgent,
	})

	w := httptest.NewRecorder()
	testHandler.CreateIssue(w, newRequest(http.MethodPost, "/api/issues?workspace_id="+testWorkspaceID, map[string]any{
		"title":         "Ready relay create",
		"assignee_type": "squad",
		"assignee_id":   squadID,
		"chain_steps":   []any{},
	}))
	if w.Code != http.StatusCreated {
		t.Fatalf("create relay: got %d: %s", w.Code, w.Body.String())
	}
	var out struct {
		ID    string              `json:"id"`
		Chain *IssueChainResponse `json:"chain"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if out.Chain == nil || len(out.Chain.Steps) != 1 || out.Chain.Steps[0].State != service.ChainStateDoing {
		t.Fatalf("leader step = %+v, want one doing step", out.Chain)
	}
	if n := dbfx.Count(t, `SELECT count(*) FROM agent_task_queue WHERE issue_id = $1 AND agent_id = $2`, out.ID, leaderAgent); n != 1 {
		t.Fatalf("leader task count = %d, want 1", n)
	}
}

// The holder can stop a stalled run. The step stays doing, and the cancelled
// run is exactly what the retry action accepts — the second half of the
// stall → cancel → retry loop.
func TestCancelIssueChainStep(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	agentID := createHandlerTestAgent(t, "cancel-agent", nil)
	leader := createHandlerTestAgent(t, "cancel-leader", nil)
	squadID := dbfx.Squad(t, "Cancel squad", leader)
	issueID := dbfx.Issue(t, "Cancelled relay", testutil.Cols{
		"assignee_type": "squad",
		"assignee_id":   squadID,
	})
	dbfx.Insert(t, "issue_chain_step", testutil.Cols{
		"issue_id": issueID, "position": 0, "holder_user_id": testUserID,
		"agent_id": leader, "title": "plan", "state": service.ChainStateDone,
	})
	dbfx.Insert(t, "issue_chain_step", testutil.Cols{
		"issue_id": issueID, "position": 1, "holder_user_id": testUserID,
		"agent_id": agentID, "title": "deliver", "state": service.ChainStateDoing,
	})
	taskID := dbfx.Task(t, agentID, testutil.Cols{
		"issue_id":   issueID,
		"status":     "running",
		"started_at": testutil.Raw("now()"),
	})

	var resp IssueChainCancelResponse
	testutil.Call(t, testHandler.CancelIssueChainStep, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+issueID+"/chain/cancel", nil),
		"workspaceId", testWorkspaceID, "id", issueID,
	)).Want(http.StatusOK).JSON(&resp)

	if resp.Cancelled != 1 {
		t.Fatalf("cancelled = %d, want 1", resp.Cancelled)
	}
	if resp.Steps[1].State != service.ChainStateDoing {
		t.Fatalf("cancel moved the leg: state = %q, want doing", resp.Steps[1].State)
	}
	var status string
	dbfx.QueryRow(t, `SELECT status FROM agent_task_queue WHERE id = $1`, taskID).Scan(&status)
	if status != "cancelled" {
		t.Fatalf("task status = %q, want cancelled", status)
	}
	testutil.Call(t, testHandler.CancelIssueChainStep, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+issueID+"/chain/cancel", nil),
		"workspaceId", testWorkspaceID, "id", issueID,
	)).Want(http.StatusConflict)
}

// A leg that parks on someone must land in that person's inbox, not only in
// the room's feed: the relay's next action is theirs.
func TestParkedLegNotifiesItsHolder(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	leader := createHandlerTestAgent(t, "notify-leader", nil)
	holder := dbfx.User(t, "Notify holder", "notify-holder@example.test")
	dbfx.Member(t, testWorkspaceID, holder, "member")
	squadID := dbfx.Squad(t, "Notify squad", leader)
	issueID := dbfx.Issue(t, "Notify relay", testutil.Cols{
		"assignee_type": "squad",
		"assignee_id":   squadID,
	})
	dbfx.Insert(t, "issue_chain_step", testutil.Cols{
		"issue_id": issueID, "position": 0, "holder_user_id": testUserID,
		"agent_id": leader, "title": "plan", "state": service.ChainStateReviewing,
	})
	dbfx.Insert(t, "issue_chain_step", testutil.Cols{
		"issue_id": issueID, "position": 1, "holder_user_id": holder,
		"title": "deliver", "state": service.ChainStatePending,
	})

	testutil.Call(t, testHandler.ApproveIssueChainStep, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+issueID+"/chain/approve", map[string]any{
			"summary":    "leg delivered",
			"acceptance": []map[string]any{{"label": "done", "requirement": "delivered", "state": "pass"}},
			"next_brief": []string{"take the next leg"},
		}),
		"workspaceId", testWorkspaceID, "id", issueID,
	)).Want(http.StatusOK)

	if n := dbfx.Count(t, `SELECT count(*) FROM inbox_item WHERE recipient_id = $1 AND type = 'relay_turn'`, holder); n != 1 {
		t.Fatalf("relay-turn inbox items for the holder = %d, want 1", n)
	}
}

// Approving the final leg closes the relay and leaves a completion record in
// the room: total legs, skipped legs, and how long the whole relay took.
func TestFinalApprovalRecordsRelayCompletion(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	leader := createHandlerTestAgent(t, "complete-leader", nil)
	squadID := dbfx.Squad(t, "Complete squad", leader)
	issueID := dbfx.Issue(t, "Completing relay", testutil.Cols{
		"assignee_type": "squad",
		"assignee_id":   squadID,
	})
	dbfx.Insert(t, "issue_chain_step", testutil.Cols{
		"issue_id": issueID, "position": 0, "holder_user_id": testUserID,
		"agent_id": leader, "title": "only leg", "state": service.ChainStateReviewing,
		"started_at": testutil.Raw("now() - interval '2 hours'"),
	})

	testutil.Call(t, testHandler.ApproveIssueChainStep, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+issueID+"/chain/approve", map[string]any{
			"summary":    "final delivery",
			"acceptance": []map[string]any{{"label": "done", "requirement": "delivered", "state": "pass"}},
		}),
		"workspaceId", testWorkspaceID, "id", issueID,
	)).Want(http.StatusOK)

	if n := dbfx.Count(t, `SELECT count(*) FROM squad_message WHERE squad_id = $1 AND kind = 'chain_completed'`, squadID); n != 1 {
		t.Fatalf("completion records = %d, want 1", n)
	}
}

// A workspace owner/admin can recover a leg whose holder is unreachable. The
// retry still passes the invoke gate on the agent; the override is logged.
func TestWorkspaceAdminRetriesSomeoneElsesLeg(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	holder := dbfx.User(t, "Admin retry holder", "admin-retry-holder@example.test")
	dbfx.Member(t, testWorkspaceID, holder, "member")
	holderRuntime := dbfx.Insert(t, "agent_runtime", testutil.Cols{
		"workspace_id": testWorkspaceID,
		"name":         "Admin retry holder runtime",
		"runtime_mode": "cloud",
		"provider":     "handler_test_admin_retry_runtime",
		"status":       "online",
		"device_info":  "holder runtime",
		"metadata":     testutil.Raw("'{}'::jsonb"),
		"owner_id":     holder,
		"last_seen_at": testutil.Raw("now()"),
	})
	holderAgent := dbfx.Agent(t, "admin retry agent", holderRuntime, testutil.Cols{
		"owner_id":        holder,
		"visibility":      "workspace",
		"permission_mode": "public_to",
	})
	dbfx.Exec(t, `
		INSERT INTO agent_invocation_target (agent_id, target_type, target_id)
		VALUES ($1, 'workspace', $2) ON CONFLICT DO NOTHING
	`, holderAgent, testWorkspaceID)
	leader := createHandlerTestAgent(t, "admin retry leader", nil)
	squadID := dbfx.Squad(t, "Admin retry squad", leader)
	issueID := dbfx.Issue(t, "Admin retry relay", testutil.Cols{
		"assignee_type": "squad",
		"assignee_id":   squadID,
	})
	dbfx.Insert(t, "issue_chain_step", testutil.Cols{
		"issue_id": issueID, "position": 0, "holder_user_id": testUserID,
		"agent_id": leader, "title": "plan", "state": service.ChainStateDone,
	})
	dbfx.Insert(t, "issue_chain_step", testutil.Cols{
		"issue_id": issueID, "position": 1, "holder_user_id": holder,
		"agent_id": holderAgent, "title": "deliver", "state": service.ChainStateDoing,
	})
	dbfx.Task(t, holderAgent, testutil.Cols{
		"issue_id":     issueID,
		"status":       "cancelled",
		"completed_at": testutil.Raw("now()"),
	})

	var resp IssueChainRetryResponse
	testutil.Call(t, testHandler.RetryIssueChainStep, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+issueID+"/chain/retry", nil),
		"workspaceId", testWorkspaceID, "id", issueID,
	)).Want(http.StatusOK).JSON(&resp)
	if resp.TaskID == "" {
		t.Fatal("admin retry queued no task")
	}
}

// The leg-output document is the single handoff artifact: its `handoff` block
// is extracted into the reviewing step's package, and the explicit re-extract
// reports a document without that block instead of silently doing nothing.
func TestExtractIssueChainHandoff(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	agentID := createHandlerTestAgent(t, "extract-agent", nil)
	leader := createHandlerTestAgent(t, "extract-leader", nil)
	squadID := dbfx.Squad(t, "Extract squad", leader)
	issueID := dbfx.Issue(t, "Extract relay", testutil.Cols{
		"assignee_type": "squad",
		"assignee_id":   squadID,
	})
	dbfx.Insert(t, "issue_chain_step", testutil.Cols{
		"issue_id": issueID, "position": 0, "holder_user_id": testUserID,
		"agent_id": leader, "title": "plan", "state": service.ChainStateDone,
	})
	dbfx.Insert(t, "issue_chain_step", testutil.Cols{
		"issue_id": issueID, "position": 1, "holder_user_id": testUserID,
		"agent_id": agentID, "title": "deliver", "state": service.ChainStateReviewing,
	})
	taskID := dbfx.Task(t, agentID, testutil.Cols{
		"issue_id":     issueID,
		"status":       "completed",
		"handoff_note": service.LegOutputInstruction,
		"started_at":   testutil.Raw("now() - interval '3 minutes'"),
		"completed_at": testutil.Raw("now()"),
	})
	commentID := dbfx.Insert(t, "comment", testutil.Cols{
		"issue_id":       issueID,
		"workspace_id":   testWorkspaceID,
		"author_type":    "agent",
		"author_id":      agentID,
		"content":        "# 交付文档\n\n正文。\n\n```handoff\n{\"summary\":\"提取后的摘要\",\"acceptance\":[{\"label\":\"口径\",\"requirement\":\"超 3 次进审计队列\",\"delivered\":\"见 §2\",\"state\":\"pass\"}],\"open_questions\":[\"容量上限\"],\"next_brief\":[\"补压测数据\"]}\n```\n",
		"source_task_id": taskID,
	})

	var resp IssueChainResponse
	testutil.Call(t, testHandler.ExtractIssueChainHandoff, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+issueID+"/chain/extract", nil),
		"workspaceId", testWorkspaceID, "id", issueID,
	)).Want(http.StatusOK).JSON(&resp)
	if resp.Steps[1].Handoff == nil {
		t.Fatalf("extract returned no handoff: %+v", resp.Steps[1])
	}
	if resp.Steps[1].Handoff.Summary != "提取后的摘要" ||
		len(resp.Steps[1].Handoff.Acceptance) != 1 ||
		len(resp.Steps[1].Handoff.NextBrief) != 1 {
		t.Fatalf("extracted package = %+v", resp.Steps[1].Handoff)
	}

	// A document without the block is a conflict the holder can act on, not a
	// silent success.
	dbfx.Exec(t, `UPDATE comment SET content = $1 WHERE id = $2`, "只有正文，没有 handoff 块。", commentID)
	testutil.Call(t, testHandler.ExtractIssueChainHandoff, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+issueID+"/chain/extract", nil),
		"workspaceId", testWorkspaceID, "id", issueID,
	)).Want(http.StatusConflict)
}

// An unreachable holder must not dead-end the relay. An owner/admin can move a
// waiting leg to another squad member; a plain member cannot, and a reassigned
// reviewing leg keeps the agent that did the work.
func TestReassignReviewingChainStep(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	f := newReviewFixture(t)
	var squadID string
	dbfx.QueryRow(t, `SELECT assignee_id::text FROM issue WHERE id = $1`, f.issueID).Scan(&squadID)
	dbfx.SquadMember(t, squadID, "member", f.outsider, testutil.Cols{"role": "executor"})

	var resp IssueChainResponse
	testutil.Call(t, testHandler.ReassignIssueChainStep, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+f.issueID+"/chain/reassign",
			map[string]any{"holder_user_id": f.outsider}),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusOK).JSON(&resp)
	if resp.Steps[1].HolderUserID != f.outsider {
		t.Fatalf("holder = %q, want the new holder %q", resp.Steps[1].HolderUserID, f.outsider)
	}
	if resp.Steps[1].State != service.ChainStateReviewing {
		t.Fatalf("reassign changed the state: %q", resp.Steps[1].State)
	}
	var agentID string
	dbfx.QueryRow(t, `SELECT agent_id::text FROM issue_chain_step WHERE issue_id = $1 AND position = 1`, f.issueID).Scan(&agentID)
	if agentID != f.nextAgent {
		t.Fatalf("reassign replaced the working agent: %q, want %q", agentID, f.nextAgent)
	}

	// A plain member cannot move someone else's turn.
	testutil.Call(t, testHandler.ReassignIssueChainStep, testutil.WithURLParams(
		newRequestAs(f.outsider, http.MethodPost, "/api/issues/"+f.issueID+"/chain/reassign",
			map[string]any{"holder_user_id": testUserID}),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusForbidden)
}

// Skipping a reviewing leg bypasses its holder's judgment, so it is reserved
// for owner/admin; skipping a parked leg stays the room's ordinary escape.
func TestAdminSkipsReviewingChainStep(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	f := newReviewFixture(t)

	// A plain member cannot skip the review.
	testutil.Call(t, testHandler.SkipIssueChainStep, testutil.WithURLParams(
		newRequestAs(f.outsider, http.MethodPost, "/api/issues/"+f.issueID+"/chain/skip", nil),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusConflict)
	if got := stepState(t, f.issueID, 1); got != service.ChainStateReviewing {
		t.Fatalf("a non-admin skip moved the step: %q", got)
	}

	// The owner may skip it; the next leg starts.
	testutil.Call(t, testHandler.SkipIssueChainStep, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+f.issueID+"/chain/skip", nil),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusOK)
	if got := stepState(t, f.issueID, 1); got != service.ChainStateSkipped {
		t.Fatalf("step 1 state = %q, want skipped", got)
	}
	if got := stepState(t, f.issueID, 2); got != service.ChainStateDoing {
		t.Fatalf("step 2 state = %q, want doing", got)
	}
}
