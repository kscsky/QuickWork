package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kscsky/quickwork/server/internal/service"
)

// addSecondWorkspaceMember creates another member of the handler test
// workspace. Quill is per workspace but sessions are per member, so the second
// member is the case both bugs below lived in.
func addSecondWorkspaceMember(t *testing.T, email string) string {
	t.Helper()
	ctx := context.Background()

	var userID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO "user" (name, email) VALUES ('Second Member', $1) RETURNING id
	`, email).Scan(&userID); err != nil {
		t.Fatalf("create second member: %v", err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM chat_session WHERE creator_id = $1`, userID)
		testPool.Exec(context.Background(), `DELETE FROM "user" WHERE id = $1`, userID)
	})

	if _, err := testPool.Exec(ctx, `
		INSERT INTO member (workspace_id, user_id, role) VALUES ($1, $2, 'member')
	`, testWorkspaceID, userID); err != nil {
		t.Fatalf("add second member: %v", err)
	}
	return userID
}

func createQuillAs(t *testing.T, userID string, body any) *httptest.ResponseRecorder {
	t.Helper()
	req := withChatTestWorkspaceCtx(t, newRequestAs(userID, "POST", "/api/agents/quill", body))
	w := httptest.NewRecorder()
	testHandler.CreateQuillAgent(w, req)
	return w
}

func decodeQuill(t *testing.T, w *httptest.ResponseRecorder) quillAgentResponse {
	t.Helper()
	var resp quillAgentResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode quill response: %v (body %s)", err, w.Body.String())
	}
	return resp
}

// TestStartQuillOnboarding_AllowsAnyMemberNotJustTheOwner is the race the
// CreateQuillAgent advisory lock exists to survive, followed one call further.
//
// Uniqueness worked: the second member got the first member's Quill. But
// StartQuillOnboarding then required the agent owner, so the member who lost
// the race received a valid agent, opened a valid session, and could not start
// onboarding at all — a 403 with no way forward.
func TestStartQuillOnboarding_AllowsAnyMemberNotJustTheOwner(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	cleanupQuill(t)

	// Provisioned by the fixture user, so the caller below is never the owner.
	owner := createQuill(t, map[string]any{
		"runtime_id": handlerTestRuntimeID(t),
		"language":   "en",
	})
	if owner.Code != http.StatusCreated {
		t.Fatalf("provision quill: expected 201, got %d: %s", owner.Code, owner.Body.String())
	}

	second := addSecondWorkspaceMember(t, "quill-second-member@quickwork.test")
	joined := createQuillAs(t, second, map[string]any{
		"runtime_id":    handlerTestRuntimeID(t),
		"language":      "en",
		"session_title": "Getting started with Quill",
	})
	if joined.Code != http.StatusOK {
		t.Fatalf("second member: expected the existing Quill (200), got %d: %s", joined.Code, joined.Body.String())
	}
	resp := decodeQuill(t, joined)
	if resp.SystemKey != service.QuillSystemKey {
		t.Fatalf("second member did not get the workspace Quill: %+v", resp)
	}
	if resp.OnboardingSession == nil {
		t.Fatal("second member got no onboarding session")
	}
	sessionID := resp.OnboardingSession.ID
	cleanupSessionTasks(t, sessionID)

	req := withChatTestWorkspaceCtx(t, withURLParam(
		newRequestAs(second, "POST", "/api/chat/sessions/"+sessionID+"/onboarding",
			map[string]any{"language": "en"}),
		"sessionId", sessionID,
	))
	w := httptest.NewRecorder()
	testHandler.StartQuillOnboarding(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("non-owner member must be able to start onboarding, got %d: %s", w.Code, w.Body.String())
	}
}

// TestCreateQuillAgent_RecoversFromAPartialBootstrap is the retry path for the
// state that used to be terminal: the agent committed but the member's session
// did not. The endpoint has to rebuild the missing half rather than treat the
// surviving agent as proof the flow finished.
func TestCreateQuillAgent_RecoversFromAPartialBootstrap(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	cleanupQuill(t)
	runtimeID := handlerTestRuntimeID(t)

	first := decodeQuill(t, createQuill(t, map[string]any{
		"runtime_id": runtimeID, "language": "en", "session_title": "Getting started with Quill",
	}))
	if first.OnboardingSession == nil {
		t.Fatal("first call returned no onboarding session")
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM chat_session WHERE creator_id = $1`, testUserID)
	})

	// Stand in for "the session step failed after the agent committed".
	if _, err := testPool.Exec(context.Background(),
		`DELETE FROM chat_session WHERE id = $1`, first.OnboardingSession.ID); err != nil {
		t.Fatalf("drop session: %v", err)
	}

	retry := createQuill(t, map[string]any{
		"runtime_id": runtimeID, "language": "en", "session_title": "Getting started with Quill",
	})
	if retry.Code != http.StatusOK {
		t.Fatalf("retry: expected 200, got %d: %s", retry.Code, retry.Body.String())
	}
	retryResp := decodeQuill(t, retry)
	if retryResp.OnboardingSession == nil {
		t.Fatal("retry must rebuild the missing session, got none")
	}
	if retryResp.OnboardingSession.ID == first.OnboardingSession.ID {
		t.Fatal("retry returned the deleted session id")
	}
	if retryResp.ID != first.ID {
		t.Fatalf("retry must reuse the same Quill, got %s then %s", first.ID, retryResp.ID)
	}
}

// TestCreateQuillAgent_SessionIsPerMemberAndStable covers the other half: the
// session used to be resolved client-side by listing sessions and matching on
// the localized title, which is both a check-then-insert race and
// language-dependent. It is now (workspace, member, Quill) server-side.
func TestCreateQuillAgent_SessionIsPerMemberAndStable(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	cleanupQuill(t)
	runtimeID := handlerTestRuntimeID(t)

	first := createQuill(t, map[string]any{
		"runtime_id": runtimeID, "language": "en", "session_title": "Getting started with Quill",
	})
	if first.Code != http.StatusCreated {
		t.Fatalf("first call: expected 201, got %d: %s", first.Code, first.Body.String())
	}
	firstResp := decodeQuill(t, first)
	if firstResp.OnboardingSession == nil {
		t.Fatal("first call returned no onboarding session")
	}
	var explicitlyCreated bool
	if err := testPool.QueryRow(context.Background(),
		`SELECT explicitly_created_at IS NOT NULL FROM chat_session WHERE id = $1`,
		firstResp.OnboardingSession.ID,
	).Scan(&explicitlyCreated); err != nil {
		t.Fatalf("load Quill session origin: %v", err)
	}
	if !explicitlyCreated {
		t.Fatal("Quill onboarding session must be marked as an explicit first-party Chat")
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM chat_session WHERE creator_id = $1`, testUserID)
	})

	// A different title must not mint a second session — this is the retry
	// after a language switch, which used to open a whole new conversation
	// with its own kickoff.
	second := createQuill(t, map[string]any{
		"runtime_id": runtimeID, "language": "zh", "session_title": "开始使用 Quill",
	})
	if second.Code != http.StatusOK {
		t.Fatalf("second call: expected 200, got %d: %s", second.Code, second.Body.String())
	}
	secondResp := decodeQuill(t, second)
	if secondResp.OnboardingSession == nil {
		t.Fatal("second call returned no onboarding session")
	}
	if firstResp.OnboardingSession.ID != secondResp.OnboardingSession.ID {
		t.Fatalf("expected the same session back, got %s then %s",
			firstResp.OnboardingSession.ID, secondResp.OnboardingSession.ID)
	}

	// Another member of the same workspace gets their own conversation with
	// the same Quill, not the first member's.
	other := addSecondWorkspaceMember(t, "quill-session-owner@quickwork.test")
	otherResp := decodeQuill(t, createQuillAs(t, other, map[string]any{
		"runtime_id": runtimeID, "language": "en", "session_title": "Getting started with Quill",
	}))
	if otherResp.OnboardingSession == nil {
		t.Fatal("second member returned no onboarding session")
	}
	if otherResp.OnboardingSession.ID == firstResp.OnboardingSession.ID {
		t.Fatal("sessions are per member — the second member must not inherit the first member's conversation")
	}
	if otherResp.ID != firstResp.ID {
		t.Fatalf("both members must share one Quill, got %s and %s", firstResp.ID, otherResp.ID)
	}

	var count int
	if err := testPool.QueryRow(context.Background(),
		`SELECT count(*) FROM chat_session WHERE workspace_id = $1 AND agent_id = $2 AND creator_id = $3`,
		testWorkspaceID, firstResp.ID, testUserID).Scan(&count); err != nil {
		t.Fatalf("count sessions: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected exactly 1 onboarding session for the member, got %d", count)
	}
}
