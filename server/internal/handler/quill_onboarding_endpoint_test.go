package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kscsky/quickwork/server/internal/service"
	"github.com/kscsky/quickwork/server/pkg/protocol"
)

// startQuillOnboarding drives the endpoint the way the router does: session id
// as a chi URL param plus the workspace/member context the middleware sets.
func startQuillOnboarding(t *testing.T, sessionID string, body any) *httptest.ResponseRecorder {
	t.Helper()
	req := newRequest("POST", "/api/chat/sessions/"+sessionID+"/onboarding", body)
	req = withURLParam(req, "sessionId", sessionID)
	req = withChatTestWorkspaceCtx(t, req)
	w := httptest.NewRecorder()
	testHandler.StartQuillOnboarding(w, req)
	return w
}

// markAsQuill stamps the system_key that identifies the workspace's built-in
// agent. The onboarding endpoint gates on this rather than the display name,
// so a fixture merely named "Quill" is not enough.
func markAsQuill(t *testing.T, agentID string) string {
	t.Helper()
	if _, err := testPool.Exec(context.Background(),
		`UPDATE agent SET system_key = $2 WHERE id = $1`, agentID, service.QuillSystemKey,
	); err != nil {
		t.Fatalf("mark agent as quill: %v", err)
	}
	return agentID
}

func decodeStartQuillOnboarding(t *testing.T, w *httptest.ResponseRecorder) startQuillOnboardingResponse {
	t.Helper()
	var resp startQuillOnboardingResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode start onboarding response: %v", err)
	}
	return resp
}

func countSessionTasks(t *testing.T, sessionID string) int {
	t.Helper()
	var count int
	if err := testPool.QueryRow(context.Background(),
		`SELECT count(*) FROM agent_task_queue WHERE chat_session_id = $1`, sessionID,
	).Scan(&count); err != nil {
		t.Fatalf("count session tasks: %v", err)
	}
	return count
}

// cleanupSessionTasks drops the tasks the endpoint enqueued so the shared
// handler fixture does not leak queue rows into later tests.
func cleanupSessionTasks(t *testing.T, sessionID string) {
	t.Helper()
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM agent_task_queue WHERE chat_session_id = $1`, sessionID)
	})
}

// TestStartQuillOnboarding_WritesTheOpeningWithoutRunningAnAgent covers the
// endpoint's whole reason to exist after MUL-5827: the member's first message
// from Quill is already final when this call returns, and no agent ran to
// produce it. The hidden kickoff is written alongside it, unowned, waiting for
// the member's first real send to adopt it.
func TestStartQuillOnboarding_WritesTheOpeningWithoutRunningAnAgent(t *testing.T) {
	agentID := markAsQuill(t, createHandlerTestAgent(t, "Quill", nil))
	sessionID := createHandlerTestChatSession(t, agentID)
	cleanupSessionTasks(t, sessionID)

	w := startQuillOnboarding(t, sessionID, map[string]any{"language": "en"})
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeStartQuillOnboarding(t, w)
	if !resp.Started || resp.MessageID == "" {
		t.Fatalf("expected a started opening with a message id, got %+v", resp)
	}

	// Nothing is enqueued: this is the runtime cold start the change removes.
	if tasks := countSessionTasks(t, sessionID); tasks != 0 {
		t.Fatalf("the opening must not enqueue any task, got %d", tasks)
	}

	type row struct {
		role    string
		kind    string
		content string
		hasTask bool
	}
	rows, err := testPool.Query(context.Background(),
		`SELECT role, message_kind, content, task_id IS NOT NULL
		   FROM chat_message WHERE chat_session_id = $1
		  ORDER BY created_at ASC, id ASC`, sessionID)
	if err != nil {
		t.Fatalf("load onboarding rows: %v", err)
	}
	defer rows.Close()
	var got []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.role, &r.kind, &r.content, &r.hasTask); err != nil {
			t.Fatalf("scan onboarding row: %v", err)
		}
		got = append(got, r)
	}
	if len(got) != 2 {
		t.Fatalf("expected the kickoff and the opening, got %d row(s): %+v", len(got), got)
	}

	// Order is load-bearing: both rows are written in one transaction, so a
	// shared now() would let the kickoff sort last and become the session's
	// "last message" — which buildChatLastMessage reports as none at all.
	kickoff, opening := got[0], got[1]
	if kickoff.role != "user" || kickoff.kind != protocol.ChatMessageKindOnboardingKickoff {
		t.Fatalf("first row must be the hidden kickoff, got %+v", kickoff)
	}
	if kickoff.hasTask {
		t.Error("the kickoff must be written unowned; the member's first send adopts it")
	}
	if kickoff.content == "" {
		t.Error("the kickoff must carry the product-authored context for the runtime")
	}
	if opening.role != "assistant" || opening.kind != protocol.ChatMessageKindOnboardingOpening {
		t.Fatalf("second row must be the opening, got %+v", opening)
	}
	if opening.hasTask {
		t.Error("no agent produced the opening, so it must carry no task id")
	}
	if !strings.Contains(opening.content, "QuickWork") {
		t.Errorf("the opening does not read like the product copy: %q", opening.content)
	}
	// The kickoff quotes the opening — that is what stops Quill greeting twice.
	if !strings.Contains(kickoff.content, opening.content) {
		t.Errorf("the kickoff must quote the opening the member already read:\n%s", kickoff.content)
	}

	// The member sees exactly one bubble: the opening. The kickoff is carrier,
	// not conversation.
	listReq := withChatTestWorkspaceCtx(t, withURLParam(
		newRequest("GET", "/api/chat/sessions/"+sessionID+"/messages", nil),
		"sessionId", sessionID,
	))
	listW := httptest.NewRecorder()
	testHandler.ListChatMessages(listW, listReq)
	if listW.Code != http.StatusOK {
		t.Fatalf("list messages: expected 200, got %d: %s", listW.Code, listW.Body.String())
	}
	var visible []ChatMessageResponse
	if err := json.Unmarshal(listW.Body.Bytes(), &visible); err != nil {
		t.Fatalf("decode visible messages: %v", err)
	}
	if len(visible) != 1 {
		t.Fatalf("expected only the opening to be visible, got %d message(s)", len(visible))
	}
	if visible[0].MessageKind != protocol.ChatMessageKindOnboardingOpening {
		t.Fatalf("visible message kind = %q, want the opening (starter cards key on it)", visible[0].MessageKind)
	}
}

// TestStartQuillOnboarding_OpeningFollowsTheRequestedLanguage pins the one
// personalization the template does branch on.
func TestStartQuillOnboarding_OpeningFollowsTheRequestedLanguage(t *testing.T) {
	agentID := markAsQuill(t, createHandlerTestAgent(t, "Quill", nil))
	sessionID := createHandlerTestChatSession(t, agentID)
	cleanupSessionTasks(t, sessionID)

	if w := startQuillOnboarding(t, sessionID, map[string]any{"language": "zh"}); w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var content string
	if err := testPool.QueryRow(context.Background(),
		`SELECT content FROM chat_message
		  WHERE chat_session_id = $1 AND message_kind = $2`,
		sessionID, protocol.ChatMessageKindOnboardingOpening,
	).Scan(&content); err != nil {
		t.Fatalf("load opening: %v", err)
	}
	if !strings.Contains(content, "工作区") {
		t.Fatalf("zh request produced a non-Chinese opening: %q", content)
	}
}

// TestStartQuillOnboarding_IsIdempotent is the retry / double-submit guarantee
// the handler documents: a second call must not write a second opening — which
// would greet the member twice in their own transcript.
func TestStartQuillOnboarding_IsIdempotent(t *testing.T) {
	agentID := markAsQuill(t, createHandlerTestAgent(t, "Quill", nil))
	sessionID := createHandlerTestChatSession(t, agentID)
	cleanupSessionTasks(t, sessionID)

	first := startQuillOnboarding(t, sessionID, map[string]any{"language": "zh"})
	if first.Code != http.StatusCreated {
		t.Fatalf("first call: expected 201, got %d: %s", first.Code, first.Body.String())
	}

	second := startQuillOnboarding(t, sessionID, map[string]any{"language": "zh"})
	if second.Code != http.StatusOK {
		t.Fatalf("second call: expected 200, got %d: %s", second.Code, second.Body.String())
	}
	if resp := decodeStartQuillOnboarding(t, second); resp.Started {
		t.Fatalf("second call must report started=false, got %+v", resp)
	}
	if tasks := countSessionTasks(t, sessionID); tasks != 0 {
		t.Fatalf("a retry must not enqueue work, got %d task(s)", tasks)
	}

	var messages int
	if err := testPool.QueryRow(context.Background(),
		`SELECT count(*) FROM chat_message WHERE chat_session_id = $1`, sessionID,
	).Scan(&messages); err != nil {
		t.Fatalf("count messages: %v", err)
	}
	if messages != 2 {
		t.Fatalf("after retry: expected still the kickoff plus one opening, got %d", messages)
	}
}

func TestStartQuillOnboarding_RejectsBadInput(t *testing.T) {
	quillID := markAsQuill(t, createHandlerTestAgent(t, "Quill", nil))
	quillSession := createHandlerTestChatSession(t, quillID)
	cleanupSessionTasks(t, quillSession)

	otherID := createHandlerTestAgent(t, "Not Quill", nil)
	otherSession := createHandlerTestChatSession(t, otherID)
	cleanupSessionTasks(t, otherSession)

	tests := []struct {
		name      string
		sessionID string
		body      any
	}{
		{"unsupported language", quillSession, map[string]any{"language": "fr"}},
		{"missing language", quillSession, map[string]any{}},
		{"agent without the quill system_key", otherSession, map[string]any{"language": "en"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := startQuillOnboarding(t, tc.sessionID, tc.body)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
			}
		})
	}

	if tasks := countSessionTasks(t, quillSession); tasks != 0 {
		t.Fatalf("rejected requests must not enqueue work, got %d task(s)", tasks)
	}
	if tasks := countSessionTasks(t, otherSession); tasks != 0 {
		t.Fatalf("rejected requests must not enqueue work, got %d task(s)", tasks)
	}
}
