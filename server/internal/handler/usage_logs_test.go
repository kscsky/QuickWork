package handler

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/kscsky/quickwork/server/internal/testutil"
)

// TestUsageOverviewAndLogs pins the reconciliation contract between the two
// new endpoints: same window, same project filter, same call count. It also
// exercises the log's status filter, search, pagination and sorting through
// the real handlers and SQL.
func TestUsageOverviewAndLogs(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()

	var runtimeID, agentID string
	if err := testPool.QueryRow(ctx, `
		SELECT id FROM agent_runtime WHERE workspace_id = $1 LIMIT 1
	`, testWorkspaceID).Scan(&runtimeID); err != nil {
		t.Skipf("fixture workspace has no runtime: %v", err)
	}
	if err := testPool.QueryRow(ctx, `
		SELECT id FROM agent WHERE workspace_id = $1 AND kind = 'user' LIMIT 1
	`, testWorkspaceID).Scan(&agentID); err != nil {
		t.Skipf("fixture workspace has no user agent: %v", err)
	}

	projectID := dbfx.Project(t, "usage log test project")
	projectIssueID := dbfx.Issue(t, "usage log test project issue", testutil.Cols{
		"project_id": projectID,
	})
	otherIssueID := dbfx.Issue(t, "usage log test other issue")

	now := pinDayWindowClock(t, time.Now())
	started, completed := runFinishedToday(now, dashboardFixtureLoc(t))
	const model = "test-usage-log-model"
	const otherModel = "test-usage-log-other-model"

	mkTask := func(issueID, status, model string, input, output int64, costTicks *int64) {
		taskID := dbfx.Task(t, agentID, testutil.Cols{
			"issue_id":     issueID,
			"runtime_id":   runtimeID,
			"status":       status,
			"started_at":   started,
			"completed_at": completed,
			"created_at":   completed,
		})
		cols := testutil.Cols{
			"task_id":       taskID,
			"provider":      "claude",
			"model":         model,
			"input_tokens":  input,
			"output_tokens": output,
			"created_at":    completed,
		}
		if costTicks != nil {
			cols["cost_usd_ticks"] = *costTicks
		}
		dbfx.Insert(t, "task_usage", cols)
	}

	cost := int64(2_500_000_000)
	mkTask(projectIssueID, "completed", model, 1_000, 200, &cost)
	mkTask(projectIssueID, "failed", model, 500, 100, nil)
	mkTask(otherIssueID, "completed", otherModel, 9_999, 999, nil)

	findModel := func(rows []usageModelSummary, name string) (usageModelSummary, bool) {
		for _, row := range rows {
			if row.Model == name {
				return row, true
			}
		}
		return usageModelSummary{}, false
	}

	projectQuery := "days=1&tz=" + dashboardFixtureTZ + "&project_id=" + projectID

	var overview usageOverviewResponse
	testutil.Call(t, testHandler.GetUsageOverview,
		newRequest("GET", "/api/dashboard/usage/overview?"+projectQuery, nil),
	).Want(http.StatusOK).JSON(&overview)

	modelRow, ok := findModel(overview.ByModel, model)
	if !ok {
		t.Fatalf("overview is missing the fixture model: %+v", overview.ByModel)
	}
	if modelRow.CallCount != 2 || modelRow.SuccessCalls != 1 || modelRow.FailedCalls != 1 {
		t.Fatalf("overview calls = %d success = %d failed = %d, want 2/1/1",
			modelRow.CallCount, modelRow.SuccessCalls, modelRow.FailedCalls)
	}
	if _, found := findModel(overview.ByModel, otherModel); found {
		t.Fatal("project-filtered overview included the other project's model")
	}
	if len(overview.ByAgent) == 0 {
		t.Fatal("overview has no per-agent rows")
	}
	foundAgent := false
	for _, row := range overview.ByAgent {
		if row.AgentID == agentID && row.Model == model && row.CallCount == 2 {
			foundAgent = true
		}
	}
	if !foundAgent {
		t.Fatalf("overview per-agent rows do not carry the fixture agent's two calls: %+v", overview.ByAgent)
	}

	var logPage usageLogResponse
	testutil.Call(t, testHandler.GetUsageLogs,
		newRequest("GET", "/api/dashboard/usage/logs?"+projectQuery+"&page=1&page_size=25", nil),
	).Want(http.StatusOK).JSON(&logPage)

	if logPage.Total != 2 || len(logPage.Rows) != 2 {
		t.Fatalf("log total/rows = %d/%d, want 2/2", logPage.Total, len(logPage.Rows))
	}
	if logPage.Summary.StatusCounts.All != 2 ||
		logPage.Summary.StatusCounts.Success != 1 ||
		logPage.Summary.StatusCounts.Failed != 1 {
		t.Fatalf("status counts = %+v, want all=2 success=1 failed=1", logPage.Summary.StatusCounts)
	}
	for _, row := range logPage.Rows {
		if row.AgentID != agentID || row.AgentName == "" || row.AgentRestricted {
			t.Fatalf("visible agent row came back restricted or unnamed: %+v", row)
		}
		if row.IssueIdentifier != fmt.Sprintf("%s-%d", issuePrefix(t), issueNumber(t, projectIssueID)) {
			t.Fatalf("issue identifier = %q, want the project issue's identifier", row.IssueIdentifier)
		}
		if row.Model != model {
			t.Fatalf("project-filtered log leaked model %q", row.Model)
		}
	}

	// Status filter: counts stay for the whole filter set, rows narrow.
	var failedPage usageLogResponse
	testutil.Call(t, testHandler.GetUsageLogs,
		newRequest("GET", "/api/dashboard/usage/logs?"+projectQuery+"&status=failed", nil),
	).Want(http.StatusOK).JSON(&failedPage)
	if failedPage.Total != 1 || len(failedPage.Rows) != 1 || failedPage.Rows[0].Status != "failed" {
		t.Fatalf("failed filter = total %d rows %+v", failedPage.Total, failedPage.Rows)
	}
	if failedPage.Summary.StatusCounts.All != 2 || failedPage.Summary.StatusCounts.Failed != 1 {
		t.Fatalf("failed filter lost the unfiltered status counts: %+v", failedPage.Summary.StatusCounts)
	}

	// Search hits the issue title and the model id, but not the other project.
	var searched usageLogResponse
	testutil.Call(t, testHandler.GetUsageLogs,
		newRequest("GET", "/api/dashboard/usage/logs?"+projectQuery+"&q="+model, nil),
	).Want(http.StatusOK).JSON(&searched)
	if searched.Total != 2 {
		t.Fatalf("model search total = %d, want 2", searched.Total)
	}

	// Sorting is global, not page-local: descending input puts the 1,000-token
	// row first even though the default time order may tie.
	var sorted usageLogResponse
	testutil.Call(t, testHandler.GetUsageLogs,
		newRequest("GET", "/api/dashboard/usage/logs?"+projectQuery+"&sort=input&dir=desc&page_size=25", nil),
	).Want(http.StatusOK).JSON(&sorted)
	if len(sorted.Rows) != 2 || sorted.Rows[0].InputTokens != 1_000 {
		t.Fatalf("input-desc sort first row = %+v", sorted.Rows)
	}

	// Pagination: the second page holds the remaining row while total stays 2.
	var secondPage usageLogResponse
	testutil.Call(t, testHandler.GetUsageLogs,
		newRequest("GET", "/api/dashboard/usage/logs?"+projectQuery+"&page=2&page_size=1", nil),
	).Want(http.StatusOK).JSON(&secondPage)
	if secondPage.Total != 2 || len(secondPage.Rows) != 1 {
		t.Fatalf("second page total/rows = %d/%d, want 2/1", secondPage.Total, len(secondPage.Rows))
	}
}

func issuePrefix(t *testing.T) string {
	t.Helper()
	var prefix string
	if err := testPool.QueryRow(context.Background(),
		`SELECT issue_prefix FROM workspace WHERE id = $1`, testWorkspaceID).Scan(&prefix); err != nil {
		t.Fatalf("read workspace prefix: %v", err)
	}
	return prefix
}

func issueNumber(t *testing.T, issueID string) int32 {
	t.Helper()
	var number int32
	if err := testPool.QueryRow(context.Background(),
		`SELECT number FROM issue WHERE id = $1`, issueID).Scan(&number); err != nil {
		t.Fatalf("read issue number: %v", err)
	}
	return number
}
