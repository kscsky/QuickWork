package handler

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/kscsky/quickwork/server/internal/knowledge"
	"github.com/kscsky/quickwork/server/internal/service"
	"github.com/kscsky/quickwork/server/internal/testutil"
)

// deterministicEmbeddings answers every embedding request with a unit vector
// chosen by keyword, so corpus filtering and vector ranking are observable
// without a network provider. The model name carries the requested width.
type deterministicEmbeddings struct {
	t *testing.T
}

func (f deterministicEmbeddings) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/embeddings" {
		http.NotFound(w, r)
		return
	}
	var req struct {
		Model string   `json:"model"`
		Input []string `json:"input"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		f.t.Errorf("decode embedding request: %v", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	dims := 512
	for _, candidate := range []int{512, 768, 1024, 1536} {
		if strings.Contains(req.Model, fmt.Sprintf("%d", candidate)) {
			dims = candidate
			break
		}
	}
	data := make([]map[string]any, len(req.Input))
	for i, text := range req.Input {
		vector := make([]float32, dims)
		switch {
		case strings.Contains(text, "标题"):
			vector[0] = 1
		case strings.Contains(text, "出图"):
			vector[1] = 1
		default:
			vector[2] = 1
		}
		data[i] = map[string]any{"embedding": vector, "index": i}
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"data": data})
}

func knowledgeJSONRequest(method, path string, body any) *http.Request {
	return testutil.WithHeaders(
		testutil.JSONRequest(method, path, body),
		"X-User-ID", testUserID,
		"X-Workspace-ID", testWorkspaceID,
	)
}

// One entry belongs to exactly one dimension. Creating a profile, depositing
// under it, filtering the list by that width and searching the corpus must all
// agree, while another corpus never sees the entry.
func TestKnowledgeEmbeddingProfileCorpora(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	t.Setenv("QUICKWORK_SECRET_KEY", base64.StdEncoding.EncodeToString([]byte(strings.Repeat("s", 32))))
	cipher, err := knowledge.CipherFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	previous := testHandler.Knowledge.Profiles
	testHandler.Knowledge.Profiles = service.NewEmbeddingProfileService(testHandler.Queries, cipher)
	t.Cleanup(func() { testHandler.Knowledge.Profiles = previous })

	server := httptest.NewServer(deterministicEmbeddings{t: t})
	defer server.Close()

	// A previous failed run may have left fake profiles behind; they would
	// change which profile the first creation activates.
	dbfx.Exec(t, `DELETE FROM knowledge_embedding WHERE profile_id IN (SELECT id FROM workspace_embedding_profile WHERE workspace_id = $1 AND model LIKE 'fake-%')`, testWorkspaceID)
	dbfx.Exec(t, `DELETE FROM workspace_embedding_profile WHERE workspace_id = $1 AND model LIKE 'fake-%'`, testWorkspaceID)

	suffix := time.Now().UnixNano()
	issueID := dbfx.Issue(t, "语料分区：单维度归属", testutil.Cols{})
	insertCompletedKnowledgeRelay(t, issueID)
	t.Cleanup(func() {
		dbfx.Exec(t, `DELETE FROM knowledge_embedding WHERE entry_id IN (SELECT id FROM knowledge_entry WHERE source_issue_id = $1)`, issueID)
		dbfx.Exec(t, `DELETE FROM knowledge_entry WHERE source_issue_id = $1`, issueID)
		dbfx.Exec(t, `DELETE FROM workspace_embedding_profile WHERE workspace_id = $1 AND model LIKE 'fake-%'`, testWorkspaceID)
	})

	var profile EmbeddingProfileResponse
	testutil.Call(t, activityWorkspaceHandler(testHandler.CreateEmbeddingProfile),
		knowledgeJSONRequest(http.MethodPost, "/api/knowledge/profiles", map[string]any{
			"provider": "custom",
			"base_url": server.URL,
			"model":    fmt.Sprintf("fake-512-%d", suffix),
			"dims":     512,
			"api_key":  "sk-test-1234",
		})).Want(http.StatusCreated).JSON(&profile)
	if profile.Dims != 512 || profile.KeyHint != "1234" || !profile.IsActive {
		t.Fatalf("profile = %+v", profile)
	}
	raw, _ := json.Marshal(profile)
	if strings.Contains(string(raw), "sk-test-1234") || strings.Contains(string(raw), "api_key_cipher") {
		t.Fatal("profile response leaked the key")
	}

	var preview service.KnowledgePreview
	testutil.Call(t, testHandler.PreviewIssueKnowledge, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+issueID+"/knowledge/preview", nil),
		"workspaceId", testWorkspaceID, "id", issueID,
	)).Want(http.StatusOK).JSON(&preview)
	if !preview.EmbeddingEnabled || preview.EmbeddingDims != 512 || preview.EmbeddingProfileID != profile.ID {
		t.Fatalf("preview embedding = %+v", preview)
	}

	var created []KnowledgeEntryResponse
	testutil.Call(t, testHandler.DepositIssueKnowledge, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/issues/"+issueID+"/knowledge/deposit",
			map[string]any{"keys": []string{"summary", "faq-0"}, "publish": true, "profile_id": profile.ID}),
		"workspaceId", testWorkspaceID, "id", issueID,
	)).Want(http.StatusCreated).JSON(&created)
	if len(created) != 2 {
		t.Fatalf("created = %d, want 2", len(created))
	}
	for _, entry := range created {
		if entry.EmbeddingDims == nil || *entry.EmbeddingDims != 512 || entry.EmbeddingProfileID == nil || *entry.EmbeddingProfileID != profile.ID {
			t.Fatalf("entry was not stamped with the 512-dim corpus: %+v", entry)
		}
	}
	if created[0].EmbeddingChunks < 2 {
		t.Fatalf("summary chunks = %d, want the summary split by section", created[0].EmbeddingChunks)
	}
	if created[1].EmbeddingChunks != 1 {
		t.Fatalf("faq chunks = %d, want one whole-entry vector", created[1].EmbeddingChunks)
	}
	createdIDs := map[string]bool{}
	for _, entry := range created {
		createdIDs[entry.ID] = true
	}

	var list512 KnowledgeListResponse
	testutil.Call(t, activityWorkspaceHandler(testHandler.ListKnowledge),
		knowledgeJSONRequest(http.MethodGet, "/api/knowledge?dims=512", nil),
	).Want(http.StatusOK).JSON(&list512)
	for _, entry := range list512.Entries {
		if entry.EmbeddingDims == nil || *entry.EmbeddingDims != 512 {
			t.Fatalf("dims=512 returned an entry from another corpus: %+v", entry)
		}
	}
	found := 0
	for _, entry := range list512.Entries {
		if createdIDs[entry.ID] {
			found++
		}
	}
	if found != 2 {
		t.Fatalf("dims=512 list contained %d of the 2 created entries", found)
	}
	if len(list512.Corpora) == 0 || list512.Corpora[0].Dims != 512 || list512.Corpora[0].Entries < 2 {
		t.Fatalf("corpora = %+v", list512.Corpora)
	}

	// The corpus identity is the profile, not the width: selecting it must
	// return only vectors produced by that model.
	var listByProfile KnowledgeListResponse
	testutil.Call(t, activityWorkspaceHandler(testHandler.ListKnowledge),
		knowledgeJSONRequest(http.MethodGet, "/api/knowledge?profile_id="+profile.ID, nil),
	).Want(http.StatusOK).JSON(&listByProfile)
	if len(listByProfile.Entries) == 0 {
		t.Fatal("profile-filtered list returned no entries")
	}
	for _, entry := range listByProfile.Entries {
		if entry.EmbeddingProfileID == nil || *entry.EmbeddingProfileID != profile.ID {
			t.Fatalf("profile-filtered list returned another corpus: %+v", entry)
		}
	}

	var list1024 KnowledgeListResponse
	testutil.Call(t, activityWorkspaceHandler(testHandler.ListKnowledge),
		knowledgeJSONRequest(http.MethodGet, "/api/knowledge?dims=1024", nil),
	).Want(http.StatusOK).JSON(&list1024)
	for _, entry := range list1024.Entries {
		if createdIDs[entry.ID] {
			t.Fatal("a 512-dim entry appeared in the 1024-dim corpus")
		}
	}

	var search KnowledgeSearchResponse
	testutil.Call(t, activityWorkspaceHandler(testHandler.SearchKnowledge),
		knowledgeJSONRequest(http.MethodGet, "/api/knowledge/search?q="+url.QueryEscape("标题怎么写")+"&profile_id="+profile.ID, nil),
	).Want(http.StatusOK).JSON(&search)
	if search.Mode != "vector" {
		t.Fatalf("search mode = %q, want vector", search.Mode)
	}
	if search.Profile == nil || search.Profile.Dims != 512 || search.Profile.Model != profile.Model {
		t.Fatalf("search profile = %+v", search.Profile)
	}
	if len(search.Hits) == 0 {
		t.Fatal("corpus search returned no hits")
	}
	for _, hit := range search.Hits {
		if hit.Entry.EmbeddingDims == nil || *hit.Entry.EmbeddingDims != 512 {
			t.Fatalf("hit from another corpus: %+v", hit.Entry)
		}
	}
	if search.Hits[0].Entry.MatchedChunkText == "" {
		t.Fatal("vector hit did not carry the matched child chunk")
	}
	// The fake embedder maps every text containing 标题 to the same axis, so
	// the summary and the leg legitimately tie; both are in this corpus.
	top := search.Hits[0].Entry.Title
	if !strings.Contains(top, "拆解与定方案") && !strings.Contains(top, "语料分区") {
		t.Fatalf("top hit = %q, want an entry from this corpus", top)
	}

	// A second profile is a separate corpus; activating it moves new
	// deposits but the old corpus remains searchable by its own profile id.
	var second EmbeddingProfileResponse
	testutil.Call(t, activityWorkspaceHandler(testHandler.CreateEmbeddingProfile),
		knowledgeJSONRequest(http.MethodPost, "/api/knowledge/profiles", map[string]any{
			"provider": "custom",
			"base_url": server.URL,
			"model":    fmt.Sprintf("fake-768-%d", suffix),
			"dims":     768,
			"api_key":  "sk-test-5678",
		})).Want(http.StatusCreated).JSON(&second)
	if second.IsActive {
		t.Fatal("the second profile became active without being asked")
	}

	testutil.Call(t, activityWorkspaceHandler(testHandler.ActivateEmbeddingProfile),
		testutil.WithURLParams(knowledgeJSONRequest(http.MethodPost, "/api/knowledge/profiles/"+second.ID+"/activate", nil), "id", second.ID),
	).Want(http.StatusOK)

	if err := testHandler.Knowledge.Profiles.Delete(t.Context(), parseUUID(testWorkspaceID), parseUUID(profile.ID)); err == nil {
		t.Fatal("deleting an inactive profile with indexed entries succeeded")
	}

	var empty EmbeddingProfileResponse
	testutil.Call(t, activityWorkspaceHandler(testHandler.CreateEmbeddingProfile),
		knowledgeJSONRequest(http.MethodPost, "/api/knowledge/profiles", map[string]any{
			"provider": "custom",
			"base_url": server.URL,
			"model":    fmt.Sprintf("fake-1024-%d", suffix),
			"dims":     1024,
			"api_key":  "sk-test-9999",
		})).Want(http.StatusCreated).JSON(&empty)
	testutil.Call(t, activityWorkspaceHandler(testHandler.DeleteEmbeddingProfile),
		testutil.WithURLParams(knowledgeJSONRequest(http.MethodDelete, "/api/knowledge/profiles/"+empty.ID, nil), "id", empty.ID),
	).Want(http.StatusNoContent)
}
