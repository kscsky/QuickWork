package handler

import (
	"net/http"
	"testing"

	"github.com/kscsky/quickwork/server/internal/testutil"
)

// GetTaskIssue (GET /api/tasks/{taskId}/issue) exists because quick-create
// cannot answer with an issue id: creating the issue IS the run's job, so the
// link only exists once the agent has finished and LinkTaskToIssue attached it.
// The distinction the home page's poll depends on is "not yet" (200, empty id)
// versus "no such task" (404), so both are pinned here.

func taskIssueRequest(t *testing.T, taskID string) *http.Request {
	t.Helper()
	req := newRequestAs(testUserID, http.MethodGet, "/api/tasks/"+taskID+"/issue", nil)
	req = withURLParam(req, "taskId", taskID)
	return withChatTestWorkspaceCtx(t, req)
}

func TestGetTaskIssue_ReportsUnlinkedThenLinked(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}

	agentID := createHandlerTestAgent(t, "TaskIssueAgent", []byte("[]"))
	taskID := dbfx.Task(t, agentID, testutil.Cols{"issue_id": nil})

	// The run has not created its issue yet. 200 with an empty id, not 404 —
	// a poller that cannot tell these apart either gives up early or never does.
	var unlinked TaskIssueResponse
	testutil.Call(t, testHandler.GetTaskIssue, taskIssueRequest(t, taskID)).
		Want(http.StatusOK).
		JSON(&unlinked)
	if unlinked.IssueID != "" {
		t.Errorf("unlinked task issue_id = %q, want empty", unlinked.IssueID)
	}

	// Same endpoint once the link lands: this is the id the caller navigates to.
	issueID := dbfx.Issue(t, "task-issue-linked")
	dbfx.Exec(t, `UPDATE agent_task_queue SET issue_id = $1 WHERE id = $2`, issueID, taskID)

	var linked TaskIssueResponse
	testutil.Call(t, testHandler.GetTaskIssue, taskIssueRequest(t, taskID)).
		Want(http.StatusOK).
		JSON(&linked)
	if linked.IssueID != issueID {
		t.Errorf("linked task issue_id = %q, want %q", linked.IssueID, issueID)
	}
}

// A task from another workspace must read as missing rather than forbidden.
// The task id is handed to the submitter in the quick-create response, so it is
// not a secret, and the endpoint must not confirm that a foreign id exists.
func TestGetTaskIssue_HidesForeignWorkspaceTask(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}

	foreignWorkspaceID := dbfx.Workspace(t, "Foreign Task Issue WS", "foreign-task-issue-ws")
	foreignRuntimeID := dbfx.Runtime(t, "Foreign Task Issue Runtime",
		testutil.Cols{"workspace_id": foreignWorkspaceID})
	foreignAgentID := dbfx.Agent(t, "Foreign Task Issue Agent", foreignRuntimeID,
		testutil.Cols{"workspace_id": foreignWorkspaceID})
	foreignTaskID := dbfx.Task(t, foreignAgentID, testutil.Cols{"issue_id": nil})

	testutil.Call(t, testHandler.GetTaskIssue, taskIssueRequest(t, foreignTaskID)).
		Want(http.StatusNotFound)
}

func TestGetTaskIssue_RejectsMalformedTaskID(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}

	testutil.Call(t, testHandler.GetTaskIssue, taskIssueRequest(t, "not-a-uuid")).
		Want(http.StatusBadRequest)
}
