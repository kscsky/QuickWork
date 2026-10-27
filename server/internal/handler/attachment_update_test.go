package handler

import (
	"net/http"
	"testing"

	"github.com/kscsky/quickwork/server/internal/testutil"
)

// TestUpdateAttachmentContent drives the delivered-document edit path: a
// member replaces a markdown attachment's bytes in place, and the text proxy
// serves the new revision under the same attachment id — the id stability is
// the whole point, since handoff packages reference it.
func TestUpdateAttachmentContent(t *testing.T) {
	origStorage := testHandler.Storage
	store := &mockStorage{files: map[string][]byte{}}
	testHandler.Storage = store
	t.Cleanup(func() { testHandler.Storage = origStorage })

	issueID := dbfx.Issue(t, "attachment update target")
	oldKey := "workspaces/" + testWorkspaceID + "/old/plan.md"
	attID := dbfx.Insert(t, "attachment", testutil.Cols{
		"workspace_id":  testWorkspaceID,
		"issue_id":      issueID,
		"uploader_type": "member",
		"uploader_id":   testUserID,
		"filename":      "plan.md",
		"url":           store.ObjectURL(oldKey),
		"content_type":  "text/markdown",
		"size_bytes":    len("# v1"),
	})
	store.files[oldKey] = []byte("# v1")

	put := func(attachmentID, body string) *http.Request {
		return testutil.WithURLParams(
			testutil.WithHeaders(
				testutil.JSONRequest("PUT", "/api/attachments/"+attachmentID+"/content", map[string]any{"content": body}),
				"X-User-ID", testUserID,
				"X-Workspace-ID", testWorkspaceID,
			), "id", attachmentID)
	}

	// The update lands under the same id, with the new size.
	newBody := "# v2\n\nedited by the next leg"
	var out AttachmentResponse
	testutil.Call(t, testHandler.UpdateAttachmentContent, put(attID, newBody)).
		Want(http.StatusOK).
		JSON(&out)
	if out.ID != attID {
		t.Fatalf("update returned attachment %q, want %q", out.ID, attID)
	}
	if out.Filename != "plan.md" {
		t.Fatalf("update changed the filename to %q", out.Filename)
	}

	// The text proxy serves the NEW bytes under the same id.
	contentReq := testutil.WithURLParams(
		testutil.WithHeaders(
			testutil.JSONRequest("GET", "/api/attachments/"+attID+"/content", nil),
			"X-User-ID", testUserID,
			"X-Workspace-ID", testWorkspaceID,
		), "id", attID)
	resp := testutil.Call(t, testHandler.GetAttachmentContent, contentReq).Want(http.StatusOK)
	if got := resp.Body.String(); got != newBody {
		t.Fatalf("content proxy served %q, want %q", got, newBody)
	}

	// Binary attachments refuse editing: the bytes cannot round-trip through
	// a JSON body, and the client never offers the affordance for them.
	binID := dbfx.Insert(t, "attachment", testutil.Cols{
		"workspace_id":  testWorkspaceID,
		"issue_id":      issueID,
		"uploader_type": "member",
		"uploader_id":   testUserID,
		"filename":      "shot.png",
		"url":           store.ObjectURL("workspaces/" + testWorkspaceID + "/old/shot.png"),
		"content_type":  "image/png",
		"size_bytes":    10,
	})
	testutil.Call(t, testHandler.UpdateAttachmentContent, put(binID, "not really a png")).
		Want(http.StatusUnsupportedMediaType)

	// A body that is not the {content} object is rejected before anything is
	// written.
	testutil.Call(t, testHandler.UpdateAttachmentContent, testutil.WithURLParams(
		testutil.WithHeaders(
			testutil.JSONRequest("PUT", "/api/attachments/"+attID+"/content", "not an object"),
			"X-User-ID", testUserID,
			"X-Workspace-ID", testWorkspaceID,
		), "id", attID)).
		Want(http.StatusBadRequest)

	// And the rejected calls left the stored revision alone.
	resp = testutil.Call(t, testHandler.GetAttachmentContent, contentReq).Want(http.StatusOK)
	if got := resp.Body.String(); got != newBody {
		t.Fatalf("rejected edits changed the content: %q", got)
	}
}
