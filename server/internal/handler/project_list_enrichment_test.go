package handler

import (
	"net/http"
	"testing"

	"github.com/kscsky/quickwork/server/internal/testutil"
)

// listProjectsByID calls the projects list and indexes the response by project
// id, so a test can assert on the row it created without depending on ordering.
func listProjectsByID(t *testing.T) map[string]ProjectResponse {
	t.Helper()
	if testHandler == nil {
		t.Skip("database not available")
	}
	var out struct {
		Projects []ProjectResponse `json:"projects"`
	}
	testutil.Call(t, testHandler.ListProjects, newRequest("GET", "/api/projects", nil)).
		Want(http.StatusOK).
		JSON(&out)
	byID := make(map[string]ProjectResponse, len(out.Projects))
	for _, p := range out.Projects {
		byID[p.ID] = p
	}
	return byID
}

func TestListProjects_LocalDirectorySummary(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	worktreeProject := dbfx.Project(t, "project with a worktree directory")
	dbfx.Insert(t, "project_resource", testutil.Cols{
		"project_id":    worktreeProject,
		"workspace_id":  testWorkspaceID,
		"resource_type": "local_directory",
		"resource_ref":  `{"daemon_id":"daemon-a","local_path":"/srv/worktree-repo","execution_mode":"worktree"}`,
		"position":      0,
	})

	// A row written before execution_mode existed has no field at all. The
	// summary must report in_place so the client never has to re-derive the
	// default.
	legacyProject := dbfx.Project(t, "project with a legacy directory row")
	dbfx.Insert(t, "project_resource", testutil.Cols{
		"project_id":    legacyProject,
		"workspace_id":  testWorkspaceID,
		"resource_type": "local_directory",
		"resource_ref":  `{"daemon_id":"daemon-b","local_path":"/srv/legacy-repo"}`,
		"position":      0,
	})

	// The row column is what current renames write, so it outranks the label
	// still stored inside the ref.
	renamedProject := dbfx.Project(t, "project with a renamed directory")
	dbfx.Insert(t, "project_resource", testutil.Cols{
		"project_id":    renamedProject,
		"workspace_id":  testWorkspaceID,
		"resource_type": "local_directory",
		"resource_ref":  `{"daemon_id":"daemon-c","local_path":"/srv/renamed-repo","label":"stale-ref-label"}`,
		"label":         "current-column-label",
		"position":      0,
	})

	bareProject := dbfx.Project(t, "project with no directory")

	byID := listProjectsByID(t)

	if got := byID[worktreeProject].LocalDirectory; got == nil {
		t.Fatal("worktree project: local_directory missing")
	} else {
		if got.ExecutionMode != localDirectoryModeWorktree {
			t.Errorf("worktree project: execution_mode = %q, want %q", got.ExecutionMode, localDirectoryModeWorktree)
		}
		if got.LocalPath != "/srv/worktree-repo" {
			t.Errorf("worktree project: local_path = %q", got.LocalPath)
		}
		if got.DaemonID != "daemon-a" {
			t.Errorf("worktree project: daemon_id = %q", got.DaemonID)
		}
		// No label anywhere: the path is the last resort so the card is never
		// nameless.
		if got.Label != "/srv/worktree-repo" {
			t.Errorf("worktree project: label = %q, want the path as fallback", got.Label)
		}
	}

	if got := byID[legacyProject].LocalDirectory; got == nil {
		t.Fatal("legacy project: local_directory missing")
	} else if got.ExecutionMode != localDirectoryModeInPlace {
		t.Errorf("legacy project: execution_mode = %q, want %q (absent field defaults to in_place)",
			got.ExecutionMode, localDirectoryModeInPlace)
	}

	if got := byID[renamedProject].LocalDirectory; got == nil {
		t.Fatal("renamed project: local_directory missing")
	} else if got.Label != "current-column-label" {
		t.Errorf("renamed project: label = %q, want the row column to outrank the ref copy", got.Label)
	}

	if got := byID[bareProject].LocalDirectory; got != nil {
		t.Errorf("project without a directory: local_directory = %+v, want nil", got)
	}
}

func TestListProjects_RepoURL(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	projectID := dbfx.Project(t, "project with a repo")
	// position 0 wins: the summary carries the primary repo, not an arbitrary one.
	dbfx.Insert(t, "project_resource", testutil.Cols{
		"project_id":    projectID,
		"workspace_id":  testWorkspaceID,
		"resource_type": "github_repo",
		"resource_ref":  `{"url":"https://github.com/example/secondary"}`,
		"position":      1,
	})
	dbfx.Insert(t, "project_resource", testutil.Cols{
		"project_id":    projectID,
		"workspace_id":  testWorkspaceID,
		"resource_type": "github_repo",
		"resource_ref":  `{"url":"https://github.com/example/primary"}`,
		"position":      0,
	})

	byID := listProjectsByID(t)
	got := byID[projectID].RepoURL
	if got == nil {
		t.Fatal("repo_url missing")
	}
	if *got != "https://github.com/example/primary" {
		t.Errorf("repo_url = %q, want the position-0 repo", *got)
	}
}

func TestListProjects_ActiveTaskCount(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	var agentID, runtimeID string
	dbfx.QueryRow(t,
		`SELECT id, runtime_id FROM agent WHERE workspace_id = $1 LIMIT 1`,
		testWorkspaceID,
	).Scan(&agentID, &runtimeID)

	projectID := dbfx.Project(t, "project with in-flight work")
	otherProjectID := dbfx.Project(t, "unrelated project")

	// Every status the daemon can be in while the work is still live. The
	// waiting_local_directory case matters most: the task holds its slot while
	// it waits for the directory lock, so it is load, not history.
	for i, status := range []string{"queued", "dispatched", "running", "waiting_local_directory"} {
		issueID := dbfx.Issue(t, "in-flight issue", testutil.Cols{
			"project_id": projectID,
			"number":     91000 + i,
		})
		dbfx.Task(t, agentID, testutil.Cols{
			"runtime_id": runtimeID,
			"issue_id":   issueID,
			"status":     status,
		})
	}

	// Terminal states are not in-flight, whichever way they ended.
	for i, status := range []string{"completed", "cancelled", "failed"} {
		issueID := dbfx.Issue(t, "settled issue", testutil.Cols{
			"project_id": projectID,
			"number":     91100 + i,
		})
		dbfx.Task(t, agentID, testutil.Cols{
			"runtime_id": runtimeID,
			"issue_id":   issueID,
			"status":     status,
		})
	}

	// Another project's live work must not be attributed to this one.
	otherIssueID := dbfx.Issue(t, "other project in-flight issue", testutil.Cols{
		"project_id": otherProjectID,
		"number":     91200,
	})
	dbfx.Task(t, agentID, testutil.Cols{
		"runtime_id": runtimeID,
		"issue_id":   otherIssueID,
		"status":     "running",
	})

	// A project-less issue is not anyone's load either.
	orphanIssueID := dbfx.Issue(t, "issue with no project", testutil.Cols{"number": 91201})
	dbfx.Task(t, agentID, testutil.Cols{
		"runtime_id": runtimeID,
		"issue_id":   orphanIssueID,
		"status":     "running",
	})

	byID := listProjectsByID(t)

	if got := byID[projectID].ActiveTaskCount; got != 4 {
		t.Errorf("active_task_count = %d, want 4 (the four live statuses; settled and foreign work excluded)", got)
	}
	if got := byID[otherProjectID].ActiveTaskCount; got != 1 {
		t.Errorf("other project active_task_count = %d, want 1", got)
	}
}
