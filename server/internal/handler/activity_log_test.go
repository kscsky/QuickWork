package handler

import (
	"net/http"
	"strings"
	"testing"

	"github.com/kscsky/quickwork/server/internal/middleware"
	"github.com/kscsky/quickwork/server/internal/testutil"
)

func activityWorkspaceHandler(handler http.HandlerFunc) http.HandlerFunc {
	return middleware.RequireWorkspaceMember(testHandler.Queries)(handler).ServeHTTP
}

func activityRequest(workspaceID string) *http.Request {
	return testutil.WithHeaders(
		testutil.JSONRequest(http.MethodGet, "/api/activity", nil),
		"X-User-ID", testUserID,
		"X-Workspace-ID", workspaceID,
	)
}

// Reassigning and skipping are the two privileged moves a relay can make; each
// must leave a row that the activity page can read back, marked as an admin
// action with the leg it touched.
func TestRelayActivityRecordedAndListed(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	f := newReviewFixture(t)
	var squadID string
	dbfx.QueryRow(t, `SELECT assignee_id::text FROM issue WHERE id = $1`, f.issueID).Scan(&squadID)
	dbfx.SquadMember(t, squadID, "member", f.outsider, testutil.Cols{"role": "executor"})

	testutil.Call(t, testHandler.ReassignIssueChainStep, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+f.issueID+"/chain/reassign",
			map[string]any{"holder_user_id": f.outsider}),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusOK)

	// The reassigned holder is told it is their turn; the item is pending until
	// the leg moves again.
	var turnID string
	dbfx.QueryRow(t, `INSERT INTO inbox_item (workspace_id, recipient_type, recipient_id, type, severity, issue_id, title, details)
		VALUES ($1, 'member', $2, 'relay_turn', 'action_required', $3, 'Your turn', $4::jsonb)
		RETURNING id::text`,
		testWorkspaceID, f.outsider, f.issueID, `{"position":1,"state":"reviewing"}`).Scan(&turnID)

	testutil.Call(t, testHandler.SkipIssueChainStep, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+f.issueID+"/chain/skip", nil),
		"workspaceId", testWorkspaceID, "id", f.issueID,
	)).Want(http.StatusOK)

	// A turn notification for a leg that no longer waits must not linger.
	var turnRead, turnArchived bool
	dbfx.QueryRow(t, `SELECT read, archived FROM inbox_item WHERE id = $1`, turnID).Scan(&turnRead, &turnArchived)
	if !turnRead || !turnArchived {
		t.Fatalf("stale relay turn item read/archived = %v/%v, want true/true", turnRead, turnArchived)
	}

	var events []ActivityEventResponse
	testutil.Call(t, activityWorkspaceHandler(testHandler.ListActivityEvents),
		activityRequest(testWorkspaceID)).
		Want(http.StatusOK).
		JSON(&events)

	byAction := map[string]ActivityEventResponse{}
	for _, event := range events {
		if event.IssueID == f.issueID {
			byAction[event.Action] = event
		}
	}
	reassign, ok := byAction["relay_reassigned"]
	if !ok {
		t.Fatalf("no relay_reassigned event for the issue: %+v", events)
	}
	if reassign.Leg != 2 {
		t.Errorf("reassign leg = %d, want 2", reassign.Leg)
	}
	if !reassign.Admin {
		t.Error("reassign event is not marked as an admin action")
	}
	if reassign.FromUserID == nil || *reassign.FromUserID != testUserID {
		t.Errorf("reassign from = %v, want %s", reassign.FromUserID, testUserID)
	}
	if reassign.ToUserID == nil || *reassign.ToUserID != f.outsider {
		t.Errorf("reassign to = %v, want %s", reassign.ToUserID, f.outsider)
	}
	if reassign.Identifier == "" || !strings.Contains(reassign.Identifier, "-") {
		t.Errorf("identifier = %q, want the workspace-prefixed issue identifier", reassign.Identifier)
	}

	skip, ok := byAction["relay_skipped"]
	if !ok {
		t.Fatalf("no relay_skipped event for the issue: %+v", events)
	}
	if skip.Leg != 2 || !skip.Admin {
		t.Errorf("skip event leg/admin = %d/%v, want 2/true", skip.Leg, skip.Admin)
	}
}
