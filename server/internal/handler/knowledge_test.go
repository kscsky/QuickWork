package handler

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/kscsky/quickwork/server/internal/knowledge"
	"github.com/kscsky/quickwork/server/internal/service"
	"github.com/kscsky/quickwork/server/internal/testutil"
	"github.com/kscsky/quickwork/server/internal/util"
)

func knowledgeRequest(workspaceID, query string) *http.Request {
	return testutil.WithHeaders(
		testutil.JSONRequest(http.MethodGet, "/api/knowledge/search?q="+url.QueryEscape(query), nil),
		"X-User-ID", testUserID,
		"X-Workspace-ID", workspaceID,
	)
}

func insertCompletedKnowledgeRelay(t *testing.T, issueID string) {
	t.Helper()
	dbfx.Exec(t, `INSERT INTO issue_chain_step
		(issue_id, position, holder_user_id, title, state, handoff_summary, handoff_package, completed_at)
		VALUES
		($1, 0, $2, '拆解与定方案', 'done',
		 '把内容包拆成 3 篇笔记与 9 张图；标题不超过 20 字，发布包附排期。',
		 '{"acceptance":[{"label":"标题","requirement":"不超过 20 字","delivered":"3 篇 13/12/11 字","state":"pass"}],"open_questions":["第 3 篇绑定哪款产品？"],"next_brief":["按发布包排期"]}'::jsonb,
		 now()),
		($1, 1, $2, '出图与发布', 'done',
		 '9 张配图与发布包已交付，色调统一，排期 10/30、11/1、11/3。',
		 '{}'::jsonb,
		 now())`,
		issueID, testUserID)
}

// A finished relay distils into one document plus FAQ drafts; publishing turns
// them into retrievable memory, and the keyword fallback finds them without an
// embedding provider.
func TestKnowledgeDistilDepositAndSearch(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	issueID := dbfx.Issue(t, "秋季内容包沉淀", testutil.Cols{})
	insertCompletedKnowledgeRelay(t, issueID)

	var preview service.KnowledgePreview
	testutil.Call(t, testHandler.PreviewIssueKnowledge, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+issueID+"/knowledge/preview", nil),
		"workspaceId", testWorkspaceID, "id", issueID,
	)).Want(http.StatusOK).JSON(&preview)

	if !strings.Contains(preview.Summary, "拆解与定方案") || !strings.Contains(preview.Summary, "第 3 篇绑定哪款产品？") {
		t.Fatalf("summary document is missing relay content: %s", preview.Summary)
	}
	if len(preview.Entries) != 4 {
		t.Fatalf("preview entries = %d, want summary + 2 leg FAQs + 1 open question", len(preview.Entries))
	}
	if preview.EmbeddingEnabled {
		t.Fatal("embedding enabled without a configured provider")
	}

	var created []KnowledgeEntryResponse
	testutil.Call(t, testHandler.DepositIssueKnowledge, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+issueID+"/knowledge/deposit",
			map[string]any{"keys": []string{"summary", "faq-0"}, "publish": true}),
		"workspaceId", testWorkspaceID, "id", issueID,
	)).Want(http.StatusCreated).JSON(&created)
	if len(created) != 2 {
		t.Fatalf("created entries = %d, want 2", len(created))
	}
	if created[0].Status != service.KnowledgeStatusPublished {
		t.Fatalf("first entry status = %q, want published", created[0].Status)
	}
	if created[0].SourceIssueID == nil || *created[0].SourceIssueID != issueID {
		t.Fatalf("entry lost its source issue: %+v", created[0])
	}

	var search KnowledgeSearchResponse
	testutil.Call(t, activityWorkspaceHandler(testHandler.SearchKnowledge),
		knowledgeRequest(testWorkspaceID, "内容包 标题")).Want(http.StatusOK).JSON(&search)
	if search.Mode != "keyword" {
		t.Fatalf("search mode = %q, want keyword without an embedding provider", search.Mode)
	}
	if len(search.Hits) == 0 {
		t.Fatal("keyword search found none of the just-published entries")
	}
	found := false
	for _, hit := range search.Hits {
		if hit.Entry.ID == created[0].ID || hit.Entry.ID == created[1].ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("search hits do not include the published entries: %+v", search.Hits)
	}
}

// Drafts stay out of retrieval until an owner/admin publishes them; archiving
// removes an entry from the list's default view only via its status.
func TestKnowledgeDraftPublishArchive(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	issueID := dbfx.Issue(t, "知识库发布与归档", testutil.Cols{})
	insertCompletedKnowledgeRelay(t, issueID)

	var created []KnowledgeEntryResponse
	testutil.Call(t, testHandler.DepositIssueKnowledge, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+issueID+"/knowledge/deposit",
			map[string]any{"keys": []string{"faq-1"}, "publish": false}),
		"workspaceId", testWorkspaceID, "id", issueID,
	)).Want(http.StatusCreated).JSON(&created)
	if len(created) != 1 || created[0].Status != service.KnowledgeStatusDraft {
		t.Fatalf("deposit did not create one draft: %+v", created)
	}

	var search KnowledgeSearchResponse
	testutil.Call(t, activityWorkspaceHandler(testHandler.SearchKnowledge),
		knowledgeRequest(testWorkspaceID, "出图与发布")).Want(http.StatusOK).JSON(&search)
	for _, hit := range search.Hits {
		if hit.Entry.ID == created[0].ID {
			t.Fatal("a draft surfaced in published-only search")
		}
	}

	var published KnowledgeEntryResponse
	testutil.Call(t, testHandler.PublishKnowledgeEntry, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/knowledge/"+created[0].ID+"/publish", nil),
		"workspaceId", testWorkspaceID, "id", created[0].ID,
	)).Want(http.StatusOK).JSON(&published)
	if published.Status != service.KnowledgeStatusPublished || published.PublishedAt == nil {
		t.Fatalf("publish did not stamp the entry: %+v", published)
	}

	var archived KnowledgeEntryResponse
	testutil.Call(t, testHandler.ArchiveKnowledgeEntry, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/knowledge/"+created[0].ID+"/archive", nil),
		"workspaceId", testWorkspaceID, "id", created[0].ID,
	)).Want(http.StatusOK).JSON(&archived)
	if archived.Status != service.KnowledgeStatusArchived {
		t.Fatalf("archive status = %q, want archived", archived.Status)
	}
}

// Distilling half a relay would bake in an unfinished judgment; the endpoint
// refuses with a conflict.
func TestKnowledgePreviewRequiresFinishedRelay(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	issueID := dbfx.Issue(t, "未完成的接力", testutil.Cols{})
	dbfx.Exec(t, `INSERT INTO issue_chain_step
		(issue_id, position, holder_user_id, title, state)
		VALUES ($1, 0, $2, '还在跑', 'doing')`, issueID, testUserID)

	testutil.Call(t, testHandler.PreviewIssueKnowledge, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+issueID+"/knowledge/preview", nil),
		"workspaceId", testWorkspaceID, "id", issueID,
	)).Want(http.StatusConflict)
}

type fakeEmbedder struct{}

func (fakeEmbedder) Model() string { return "fake-1024" }
func (fakeEmbedder) Dims() int     { return knowledge.EmbeddingDims }

// Deterministic three-way embedding: "标题" → axis 0, "出图" → axis 1,
// anything else → axis 2. Enough to prove cosine ordering and the pgvector
// round-trip without a network provider.
func (fakeEmbedder) Embed(_ context.Context, texts []string) ([][]float32, error) {
	vectors := make([][]float32, len(texts))
	for i, text := range texts {
		vectors[i] = make([]float32, knowledge.EmbeddingDims)
		switch {
		case strings.Contains(text, "标题"):
			vectors[i][0] = 1
		case strings.Contains(text, "出图"):
			vectors[i][1] = 1
		default:
			vectors[i][2] = 1
		}
	}
	return vectors, nil
}

// With an embedder configured, publishing stores vectors and search runs in
// vector mode; the closest entry wins.
func TestKnowledgeVectorSearchRanksByEmbedding(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	issueID := dbfx.Issue(t, "向量检索排序", testutil.Cols{})
	insertCompletedKnowledgeRelay(t, issueID)
	issueUUID, err := util.ParseUUID(issueID)
	if err != nil {
		t.Fatal(err)
	}
	workspaceUUID, err := util.ParseUUID(testWorkspaceID)
	if err != nil {
		t.Fatal(err)
	}
	actorUUID, err := util.ParseUUID(testUserID)
	if err != nil {
		t.Fatal(err)
	}
	issue, err := testHandler.Queries.GetIssue(context.Background(), issueUUID)
	if err != nil {
		t.Fatal(err)
	}
	svc := service.NewKnowledgeService(testHandler.Queries, fakeEmbedder{})
	created, err := svc.DepositTaskKnowledge(context.Background(), issue, actorUUID, []string{"faq-0", "faq-1"}, true, pgtype.UUID{})
	if err != nil {
		t.Fatalf("deposit: %v", err)
	}
	if len(created) != 2 {
		t.Fatalf("created = %d, want 2", len(created))
	}

	result, err := svc.Search(context.Background(), workspaceUUID, "标题怎么写", 5, pgtype.UUID{})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if result.Mode != "vector" {
		t.Fatalf("search mode = %q, want vector", result.Mode)
	}
	if len(result.Hits) == 0 {
		t.Fatal("vector search returned no hits")
	}
	if !strings.Contains(result.Hits[0].Entry.Entry.Title, "拆解与定方案") {
		t.Fatalf("top hit = %q, want the leg whose handoff covers 标题", result.Hits[0].Entry.Entry.Title)
	}
	if result.Hits[0].Score < 0.99 {
		t.Fatalf("top score = %.3f, want ~1 for an aligned vector", result.Hits[0].Score)
	}
}
