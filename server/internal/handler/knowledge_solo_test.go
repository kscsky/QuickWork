package handler

import (
	"net/http"
	"strings"
	"testing"

	"github.com/kscsky/quickwork/server/internal/service"
	"github.com/kscsky/quickwork/server/internal/testutil"
)

// A solo task has no handoff packages. Its memory is the goal plus the final
// delivery comment; the completion card uses the status endpoint to avoid
// depositing the same task twice.
func TestKnowledgeSoloTaskDistilDepositAndStatus(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	issueID := dbfx.Issue(t, "单人任务沉淀：梳子清洁图文", testutil.Cols{
		"status":      "done",
		"description": "按 xhs-note-factory 跑一条梳子清洁笔记，交付 3 张 1080×1440 图和发布包。",
	})
	dbfx.Comment(t, issueID, "已完成三张图和发布包；素材来自 Pexels，逐张筛选，排除露脸与重复图。", testutil.Cols{
		"author_type": "member",
	})
	t.Cleanup(func() {
		dbfx.Exec(t, `DELETE FROM knowledge_embedding WHERE entry_id IN (SELECT id FROM knowledge_entry WHERE source_issue_id = $1)`, issueID)
		dbfx.Exec(t, `DELETE FROM knowledge_entry WHERE source_issue_id = $1`, issueID)
	})

	var before IssueKnowledgeStatusResponse
	testutil.Call(t, testHandler.IssueKnowledgeStatus, testutil.WithURLParams(
		newRequest(http.MethodGet, "/api/issues/"+issueID+"/knowledge/status", nil),
		"workspaceId", testWorkspaceID, "id", issueID,
	)).Want(http.StatusOK).JSON(&before)
	if before.Deposited {
		t.Fatal("a fresh task was reported as already deposited")
	}

	var preview service.KnowledgePreview
	testutil.Call(t, testHandler.PreviewIssueKnowledge, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+issueID+"/knowledge/preview", nil),
		"workspaceId", testWorkspaceID, "id", issueID,
	)).Want(http.StatusOK).JSON(&preview)
	if preview.Source != service.KnowledgeSourceSolo {
		t.Fatalf("preview source = %q, want solo", preview.Source)
	}
	if !strings.Contains(preview.Summary, "梳子清洁图文") || !strings.Contains(preview.Summary, "Pexels") {
		t.Fatalf("solo summary is missing the goal or result: %s", preview.Summary)
	}
	if len(preview.Entries) != 2 {
		t.Fatalf("entries = %d, want summary + result", len(preview.Entries))
	}
	if preview.Entries[1].Title != "这次任务是怎么完成的？" {
		t.Fatalf("result entry = %q", preview.Entries[1].Title)
	}

	var created []KnowledgeEntryResponse
	testutil.Call(t, testHandler.DepositIssueKnowledge, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+issueID+"/knowledge/deposit",
			map[string]any{"keys": []string{"summary", "faq-0"}, "publish": false}),
		"workspaceId", testWorkspaceID, "id", issueID,
	)).Want(http.StatusCreated).JSON(&created)
	if len(created) != 2 {
		t.Fatalf("created = %d, want 2", len(created))
	}

	var after IssueKnowledgeStatusResponse
	testutil.Call(t, testHandler.IssueKnowledgeStatus, testutil.WithURLParams(
		newRequest(http.MethodGet, "/api/issues/"+issueID+"/knowledge/status", nil),
		"workspaceId", testWorkspaceID, "id", issueID,
	)).Want(http.StatusOK).JSON(&after)
	if !after.Deposited || after.Entries < 2 {
		t.Fatalf("status after deposit = %+v", after)
	}

	openID := dbfx.Issue(t, "单人任务未完成", testutil.Cols{"status": "in_progress"})
	testutil.Call(t, testHandler.PreviewIssueKnowledge, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+openID+"/knowledge/preview", nil),
		"workspaceId", testWorkspaceID, "id", openID,
	)).Want(http.StatusConflict)
}
