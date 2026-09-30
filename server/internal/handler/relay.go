package handler

// Cross-workspace relay (fork feature): one workspace's activity wakes an
// agent in ANOTHER workspace, carrying a "context pack" (source card, recent
// discussion, the hand-off intent) so the target agent starts with the same
// picture instead of a bare title.
//
// Design boundaries, deliberate and load-bearing:
//
//   - Trigger is a status entry in the SOURCE workspace ("card landed in
//     交付待对接"), not a task-completion event: the human moving the card is
//     the opt-in signal, mirroring the distill lane's design.
//   - The forwarding identity is a personal access token from relay config
//     (a human's PAT). Agent task tokens cannot cross workspaces by design
//     (ResolveWorkspaceIDFromRequest ignores any widening attempt), so the
//     relay is the only legitimate automated cross-workspace channel — and it
//     acts as the authorized human, never as one agent borrowing another's
//     scope.
//   - Delivery goes through the public HTTP surface (create issue / add
//     comment) instead of in-process service calls, because that path is
//     where every gate lives: assign validation, mention trigger computation,
//     run enqueue, realtime fan-out. The relay adds zero new trigger logic.
//   - Idempotency: the target card is located by a source marker inside its
//     description, so a re-delivery on the same source card comments on the
//     existing target card instead of creating a twin. Best-effort by
//     construction — the marker search is a page of recent target cards.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/kscsky/quickwork/server/internal/events"
	"github.com/kscsky/quickwork/server/internal/util"
)

var relayLog = slog.With("component", "relay")

// RelayConfigEnv points at the relay config file; empty = feature disabled.
// The default is per-profile so a desktop-local daemon and a containerised
// server on one machine do not read each other's rules.
const RelayConfigEnv = "QUICKWORK_RELAY_CONFIG"

// RelayConfigFile is the container/daemon-neutral default location.
const relayDefaultConfigFile = ".quickwork/relay.json"

// relayMarkerPrefix stamps target cards with their provenance. Kept as a
// hidden HTML comment so it never renders in the UI but survives editing.
// The EXACT byte layout lives here and nowhere else: a space after the colon
// in one place and not the other made every receipt lookup miss (the receipt
// searches for prefix+identifier; the writer must emit exactly that).
const relayMarkerPrefix = "<!--relay-source:"
const relayMarkerSuffix = "-->"

type RelayConfig struct {
	// PAT of the human the relay acts as. Needs membership in EVERY workspace
	// that appears as a source or target.
	Token string      `json:"token"`
	Rules []RelayRule `json:"rules"`
}

type RelayRule struct {
	Name string `json:"name"`
	// SourceWorkspace is the slug of the workspace whose events fire this rule.
	SourceWorkspace string `json:"source_workspace"`
	// SourceStatus is the raw status key that must be ENTERED to fire.
	SourceStatus string `json:"source_status"`
	// IssueIDs, when non-empty, narrows the rule to those cards ("watch these
	// tasks"); empty fires for any card entering the status ("watch the lane").
	IssueIDs []string `json:"issue_ids"`
	// ChatSessionID, when set, adds that conversation's recent messages to the
	// context pack as a separately labelled section. Rules cannot derive it:
	// chat sessions are not bound to cards.
	ChatSessionID string `json:"chat_session_id"`
	// TargetWorkspace is the slug of the workspace receiving the work.
	TargetWorkspace string `json:"target_workspace"`
	// TargetKind picks the delivery shape: "" / "issue" creates a new card
	// (the hand-off leg); "comment" posts the context pack onto the card that
	// carries the matching relay marker (the receipt leg). Comment mode exists
	// so the return path cannot bounce back and forth as new cards — a receipt
	// is information, and its arrival must not itself be a status entry.
	TargetKind string `json:"target_kind"`
	// TargetAgentID is the agent in the target workspace to wake (issue mode).
	// The created card is assigned to it, which is what starts the run.
	TargetAgentID string `json:"target_agent_id"`
	// TaskTemplate is the target card title; {{title}}/{{identifier}} expand
	// from the source card.
	TaskTemplate string `json:"task_template"`
	// TargetStatus is the status the new card is created in (default "todo").
	TargetStatus string `json:"target_status"`
	// Note is an extra instruction appended to the context pack ("把接口文档
	// 收尾", "按上一版口径继续"). Optional.
	Note string `json:"note"`
	// ContextComments caps how many recent source comments ride along.
	ContextComments int `json:"context_comments"`
}

// Relay acts on issue:updated events. Forward is safe to call from the bus
// goroutine: the HTTP calls carry their own timeouts and the config is
// swapped atomically on reload.
type Relay struct {
	serverURL string
	http      *http.Client

	mu    sync.RWMutex
	cfg   RelayConfig
	rules []relayRuleIndex // config order preserved for stable logging

	// workspace cache: slug -> {id, issue_prefix}
	wsMu    sync.Mutex
	wsCache map[string]relayWorkspace
}

type relayRuleIndex struct {
	id      string // handoff_rule row id; "" for file-loaded rules
	rule    RelayRule
	source  relayWorkspace
	target  relayWorkspace
	agentID string
}

// RelayWatchPruner drops an issue from a rule's watch list after a successful
// delivery. Set from main (handler package cannot import main); nil = pruning
// disabled (file-mode rules have no watch list anyway).
var RelayWatchPruner func(ctx context.Context, ruleID, issueID string) error

// RelayTranscriptReader reads a chat session's recent messages for the context
// pack. The public chat API is creator-only; a server component reading rows
// directly is the narrow path that neither widens that API nor pretends the
// relay is the session's owner. Nil = chat capture disabled.
var RelayTranscriptReader func(ctx context.Context, sessionID string, limit int) ([]relayChatLine, error)

type relayChatLine struct {
	Role    string
	Content string
}

type relayWorkspace struct {
	ID     string
	Slug   string
	Prefix string
}

// NewRelay builds the relay. serverURL is the base address the server answers
// on (the public URL); the relay calls its own HTTP surface so the request
// rides the exact middleware and trigger pipeline a browser request would.
func NewRelay(serverURL string) *Relay {
	return &Relay{
		serverURL: strings.TrimRight(serverURL, "/"),
		http:      &http.Client{Timeout: 20 * time.Second},
		wsCache:   map[string]relayWorkspace{},
	}
}

// Load reads the config file and resolves workspace slugs and the target
// agent against the live database (via the server's own API). Returns the
// number of active rules; disabled (no file / no token / no rules) is not an
// error — the feature is simply off.
func (r *Relay) Load(ctx context.Context) (int, error) {
	path := os.Getenv(RelayConfigEnv)
	if path == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return 0, nil
		}
		path = filepath.Join(home, relayDefaultConfigFile)
	}
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("relay: read config: %w", err)
	}
	var cfg RelayConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return 0, fmt.Errorf("relay: parse config %s: %w", path, err)
	}
	if strings.TrimSpace(cfg.Token) == "" {
		return 0, fmt.Errorf("relay: config %s has no token", path)
	}
	if len(cfg.Rules) == 0 {
		return 0, nil
	}

	indexed := make([]relayRuleIndex, 0, len(cfg.Rules))
	for i, rule := range cfg.Rules {
		rule.Name = strings.TrimSpace(rule.Name)
		if rule.Name == "" {
			rule.Name = fmt.Sprintf("rule-%d", i+1)
		}
		if rule.SourceWorkspace == "" || rule.SourceStatus == "" || rule.TargetWorkspace == "" {
			return 0, fmt.Errorf("relay: rule %q needs source_workspace/source_status/target_workspace", rule.Name)
		}
		// agent_id is an issue-mode requirement: comment mode (receipt) only
		// needs somewhere to look the origin card up, nothing to wake.
		if rule.TargetKind != "comment" && rule.TargetAgentID == "" {
			return 0, fmt.Errorf("relay: rule %q needs target_agent_id", rule.Name)
		}
		source, err := r.lookupWorkspace(ctx, cfg.Token, rule.SourceWorkspace)
		if err != nil {
			return 0, fmt.Errorf("relay: rule %q source: %w", rule.Name, err)
		}
		target, err := r.lookupWorkspace(ctx, cfg.Token, rule.TargetWorkspace)
		if err != nil {
			return 0, fmt.Errorf("relay: rule %q target: %w", rule.Name, err)
		}
		if rule.TargetAgentID != "" {
			if _, err := util.ParseUUID(rule.TargetAgentID); err != nil {
				return 0, fmt.Errorf("relay: rule %q target_agent_id is not a UUID", rule.Name)
			}
		}
		indexed = append(indexed, relayRuleIndex{
			rule: rule, source: source, target: target, agentID: rule.TargetAgentID,
		})
	}

	r.mu.Lock()
	r.cfg = cfg
	r.rules = indexed
	r.mu.Unlock()
	return len(indexed), nil
}

// RuleCount reports how many rules are active (for startup logging / health).
func (r *Relay) RuleCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.rules)
}

// HandleIssueEvent is the bus entry point. It fires only when the SOURCE card
// actually entered the rule's status — the prev==next guard keeps re-emits
// (edits that republish the payload) from re-delivering.
func (r *Relay) HandleIssueEvent(ctx context.Context, e events.Event) {
	// Member actions are the hand-off opt-in (a human moving a card), and an
	// AGENT action is the receipt signal: the target-side agent finishes and
	// moves its card into the receipt status itself. Both pass; anything else
	// (system) stays out so automated status writes cannot pull a card across
	// workspaces on their own.
	if e.ActorType != "member" && e.ActorType != "agent" {
		return
	}
	payload, ok := e.Payload.(map[string]any)
	if !ok {
		return
	}
	if changed, _ := payload["status_changed"].(bool); !changed {
		return
	}
	issue, ok := payload["issue"].(IssueResponse)
	if !ok || issue.ID == "" {
		return
	}
	prev, _ := payload["prev_status"].(string)
	if prev == issue.Status {
		return
	}

	r.mu.RLock()
	cfg := r.cfg
	rules := r.rules
	r.mu.RUnlock()

	for _, ri := range rules {
		if ri.source.ID != e.WorkspaceID || ri.rule.SourceStatus != issue.Status {
			continue
		}
		if !relayRuleWatches(ri.rule.IssueIDs, issue.ID) {
			continue
		}
		if err := r.forward(ctx, cfg.Token, ri, issue); err != nil {
			// The source card keeps its human context; the log line is the
			// operator's trail until a delivery ledger exists (phase 2).
			relayLog.Warn("relay delivery failed",
				"rule", ri.rule.Name, "source_issue", issue.Identifier, "error", err)
			continue
		}
		relayLog.Info("relay delivered",
			"rule", ri.rule.Name, "source_issue", issue.Identifier,
			"target_workspace", ri.target.Slug, "target_agent", ri.agentID)
		// Hand-off succeeded: the card leaves the watch list (issue-mode only;
		// the receipt leg's comment delivery must not clear anything).
		if ri.id != "" && ri.rule.TargetKind != "comment" && RelayWatchPruner != nil {
			if err := RelayWatchPruner(ctx, ri.id, issue.ID); err != nil {
				relayLog.Warn("relay: watch-list prune failed", "rule", ri.rule.Name, "issue", issue.Identifier, "error", err)
			}
		}
	}
}

// forward dispatches one delivery to the rule's target kind. Issue mode is the
// hand-off leg (create card, assign agent); comment mode is the receipt leg —
// it finds the card that was handed off from this source and appends the
// context pack onto it, so the origin learns the outcome without a new card
// (and without a new status entry that could re-fire the outbound rule).
func (r *Relay) forward(ctx context.Context, token string, ri relayRuleIndex, issue IssueResponse) error {
	if ri.rule.TargetKind == "comment" {
		return r.forwardComment(ctx, token, ri, issue)
	}
	title := expandRelayTemplate(ri.rule.TaskTemplate, issue)
	if strings.TrimSpace(title) == "" {
		title = issue.Identifier + " " + issue.Title
	}
	description := relayTargetDescription(ri, issue)
	discussion := r.sourceDiscussion(ctx, token, ri.source, issue.ID, ri.rule.ContextComments)
	chatLines := r.sourceChatTranscript(ctx, ri.rule.ChatSessionID, ri.rule.ContextComments)
	contextBody := r.relayContextComment(ri, issue, discussion, chatLines)

	// One drag = one new task (owner's workflow): every delivery creates a
	// FRESH card, so the target side always gets a visible, self-contained
	// task with a live run. Reusing an existing card (the old findTarget
	// path) silently turned re-deliveries into comments on a stale card,
	// which read as "nothing happened". Accidental repeats are prevented
	// upstream: a watched card leaves the watch list once it fires.

	status := ri.rule.TargetStatus
	if status == "" {
		status = "todo"
	}
	targetID, err := r.createIssue(ctx, token, ri.target.ID, map[string]any{
		"title":         title,
		"description":   description,
		"status":        status,
		"priority":      issue.Priority,
		"assignee_type": "agent",
		"assignee_id":   ri.agentID,
		// The platform's active-duplicate guard (same title, live card) would
		// 409 a re-delivery of the same source card. A repeat hand-off is a
		// deliberate act here (a fresh task each drag), so the guard is
		// explicitly overridden — the source marker keeps the cards traceable.
		"allow_duplicate": true,
	})
	if err != nil {
		return fmt.Errorf("create target card: %w", err)
	}
	if err := r.addComment(ctx, token, ri.target.ID, targetID, contextBody); err != nil {
		relayLog.Warn("relay: target card created but context comment failed",
			"rule", ri.rule.Name, "target_issue", targetID, "error", err)
	}
	return nil
}

// forwardComment is the receipt leg: the source card is the card that was
// handed off FROM something earlier — its description carries the marker of
// that origin — and the delivery is a comment appended to the origin card in
// the target workspace.
func (r *Relay) forwardComment(ctx context.Context, token string, ri relayRuleIndex, issue IssueResponse) error {
	origin := relayMarkerSource(issue)
	if origin == "" {
		// A human-authored card in this status without a relay marker: there is
		// no origin to report to, and inventing one (matching by title) would
		// put a comment on an unrelated card. Skip loudly.
		relayLog.Warn("relay: comment-mode source has no relay marker; skipping",
			"rule", ri.rule.Name, "issue", issue.Identifier)
		return nil
	}
	targetID := r.findTarget(ctx, token, ri.target, origin)
	if targetID == "" {
		relayLog.Warn("relay: comment-mode target card not found",
			"rule", ri.rule.Name, "source_issue", issue.Identifier, "origin", origin)
		return nil
	}
	body := fmt.Sprintf("**来自 %s 的回执**\n\n- 对方卡片: %s · %s(工作区 %s)\n\n---\n\n%s",
		ri.source.Slug, issue.Identifier, issue.Title, ri.source.Slug,
		relayReceiptDiscussion(r.sourceDiscussion(ctx, token, ri.source, issue.ID, ri.rule.ContextComments)))
	return r.addComment(ctx, token, ri.target.ID, targetID, body)
}

// relayMarkerSource reads the origin identifier out of a relay-created card's
// description marker ("<!-- relay-source: NEO-11 -->").
func relayMarkerSource(issue IssueResponse) string {
	if issue.Description == nil {
		return ""
	}
	idx := strings.Index(*issue.Description, relayMarkerPrefix)
	if idx < 0 {
		return ""
	}
	rest := (*issue.Description)[idx+len(relayMarkerPrefix):]
	if end := strings.Index(rest, "-->"); end >= 0 {
		return strings.TrimSpace(rest[:end])
	}
	return ""
}

// relayReceiptDiscussion renders the receipt body: the discussion lines, or a
// fallback line when the run left no prose behind.
func relayReceiptDiscussion(discussion []string) string {
	if len(discussion) == 0 {
		return "(对方卡片没有留下文字结论,请打开对方卡片查看。)"
	}
	var b strings.Builder
	for _, line := range discussion {
		b.WriteString(line)
		b.WriteString("\n\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

// findTarget scans a page of the target workspace's recent issues for the
// source marker. Best-effort by design: a miss creates a new card, which is
// the intended behavior for the FIRST delivery anyway.
func (r *Relay) findTarget(ctx context.Context, token string, target relayWorkspace, sourceIdentifier string) string {
	var list struct {
		Issues []struct {
			ID          string  `json:"id"`
			Description *string `json:"description"`
		} `json:"issues"`
	}
	if err := r.request(ctx, token, target.ID, http.MethodGet, "/api/issues?limit=100", nil, &list); err != nil {
		relayLog.Warn("relay: target lookup failed; assuming none", "workspace", target.Slug, "error", err)
		return ""
	}
	marker := relayMarkerPrefix + sourceIdentifier
	for _, it := range list.Issues {
		if it.Description != nil && strings.Contains(*it.Description, marker) {
			return it.ID
		}
	}
	return ""
}

func (r *Relay) createIssue(ctx context.Context, token, workspaceID string, body map[string]any) (string, error) {
	// The create endpoint returns the issue object flat (no envelope) — the
	// same shape IssueResponse marshals to.
	var resp struct {
		ID string `json:"id"`
	}
	if err := r.request(ctx, token, workspaceID, http.MethodPost, "/api/issues", body, &resp); err != nil {
		return "", err
	}
	if resp.ID == "" {
		return "", fmt.Errorf("create issue returned no id")
	}
	return resp.ID, nil
}

func (r *Relay) addComment(ctx context.Context, token, workspaceID, issueID, content string) error {
	return r.addCommentSuppressing(ctx, token, workspaceID, issueID, content, nil)
}

// addCommentSuppressing posts a comment while keeping listed agents out of the
// comment-trigger set. The flow needs this: a baton comment would otherwise
// wake the very assignee the reassignment just woke, running the node twice.
func (r *Relay) addCommentSuppressing(ctx context.Context, token, workspaceID, issueID, content string, suppressAgentIDs []string) error {
	body := map[string]any{"content": content}
	if len(suppressAgentIDs) > 0 {
		body["suppress_agent_ids"] = suppressAgentIDs
	}
	return r.request(ctx, token, workspaceID, http.MethodPost,
		"/api/issues/"+issueID+"/comments", body, nil)
}

// request is the relay's HTTP lane into the server's own API. X-Workspace-ID
// selects the target workspace; the PAT authorizes it as the relay user.
func (r *Relay) request(ctx context.Context, token, workspaceID, method, path string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, r.serverURL+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Workspace-ID", workspaceID)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := r.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("%s %s: %d %s", method, path, resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	if out != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			return fmt.Errorf("decode %s %s: %w", method, path, err)
		}
	}
	return nil
}

// lookupWorkspace resolves a slug through the server's own workspace list,
// cached per process. The PAT must be a member of that workspace, otherwise
// the list simply won't contain it — the error names the configuration gap.
func (r *Relay) lookupWorkspace(ctx context.Context, token, slug string) (relayWorkspace, error) {
	slug = strings.TrimSpace(slug)
	if slug == "" {
		return relayWorkspace{}, fmt.Errorf("empty workspace slug")
	}
	r.wsMu.Lock()
	if ws, ok := r.wsCache[slug]; ok {
		r.wsMu.Unlock()
		return ws, nil
	}
	r.wsMu.Unlock()

	var list []struct {
		ID          string `json:"id"`
		Slug        string `json:"slug"`
		IssuePrefix string `json:"issue_prefix"`
	}
	if err := r.request(ctx, token, "", http.MethodGet, "/api/workspaces", nil, &list); err != nil {
		return relayWorkspace{}, fmt.Errorf("list workspaces: %w", err)
	}
	r.wsMu.Lock()
	defer r.wsMu.Unlock()
	for _, w := range list {
		r.wsCache[w.Slug] = relayWorkspace{ID: w.ID, Slug: w.Slug, Prefix: w.IssuePrefix}
	}
	if ws, ok := r.wsCache[slug]; ok {
		return ws, nil
	}
	return relayWorkspace{}, fmt.Errorf("workspace %q not visible to the relay token", slug)
}

// expandRelayTemplate substitutes the source card's fields into the target
// title template.
func expandRelayTemplate(tpl string, issue IssueResponse) string {
	if strings.TrimSpace(tpl) == "" {
		return ""
	}
	out := strings.NewReplacer(
		"{{title}}", issue.Title,
		"{{identifier}}", issue.Identifier,
	).Replace(tpl)
	return strings.TrimSpace(out)
}

// relayTargetDescription is the persistent half of the provenance: the marker
// findTarget searches for, plus the "what to do" line.
func relayTargetDescription(ri relayRuleIndex, issue IssueResponse) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s%s%s\n", relayMarkerPrefix, issue.Identifier, relayMarkerSuffix)
	fmt.Fprintf(&b, "由 [%s] 工作区的 %s 自动转发(规则:%s)。\n", ri.source.Slug, issue.Identifier, ri.rule.Name)
	if note := strings.TrimSpace(ri.rule.Note); note != "" {
		fmt.Fprintf(&b, "\n**本任务的交接说明:**%s\n", note)
	}
	b.WriteString("\n来源卡标题:")
	b.WriteString(issue.Title)
	return b.String()
}

// relayContextComment is the context pack: source card link, its description
// summary, and the recent discussion tail — the "why it was done" that code
// and issue titles never carry. The trailing @agent mention is what actually
// wakes the assignee when the card already existed.
func (r *Relay) relayContextComment(ri relayRuleIndex, issue IssueResponse, discussion, chatLines []string) string {
	var b strings.Builder
	b.WriteString("**跨区交接上下文包**\n\n")
	fmt.Fprintf(&b, "- 来源: %s · %s(工作区 %s)\n", issue.Identifier, issue.Title, ri.source.Slug)
	if issue.Description != nil {
		if d := strings.TrimSpace(*issue.Description); d != "" {
			fmt.Fprintf(&b, "- 需求描述:\n\n%s\n", headOfRelay(d, 3000))
		}
	}
	// Two labelled sections, in reading order: the conversation that shaped the
	// work first, then the card's review comments. The labels are load-bearing —
	// the receiving side must be able to tell dialogue from review notes.
	if len(chatLines) > 0 {
		b.WriteString("\n## 💬 聊天对话记录(源工作区的会话,时间序)\n\n")
		for _, line := range chatLines {
			b.WriteString(line)
			b.WriteString("\n\n")
		}
	}
	if len(discussion) > 0 {
		b.WriteString("\n## 📋 来源卡评论(任务卡上的讨论)\n\n")
		for _, line := range discussion {
			b.WriteString(line)
			b.WriteString("\n\n")
		}
	}
	b.WriteString("\n---\n\n")
	fmt.Fprintf(&b, "[@目标执行人](mention://agent/%s) 请接单执行上方的交接说明。", ri.agentID)
	return b.String()
}

// sourceChatTranscript reads the tail of a chat session through the source
// workspace. Roles render as 我(=发起人)/助手(=agent) so the label reads
// naturally on the target side.
// sourceChatTranscript renders the tail of a chat session for the context
// pack. Reads through RelayTranscriptReader (direct DB) because the HTTP chat
// API is creator-only by design. Roles render as 我(=发起人)/助手(=agent).
func (r *Relay) sourceChatTranscript(_ context.Context, sessionID string, limit int) []string {
	if strings.TrimSpace(sessionID) == "" || RelayTranscriptReader == nil {
		return nil
	}
	if limit <= 0 || limit > 30 {
		limit = 20
	}
	msgs, err := RelayTranscriptReader(context.Background(), sessionID, limit)
	if err != nil {
		relayLog.Warn("relay: chat transcript read failed; packing without it",
			"session", sessionID, "error", err)
		return nil
	}
	out := make([]string, 0, len(msgs))
	for i := len(msgs) - 1; i >= 0; i-- { // query returned newest-first
		body := strings.TrimSpace(msgs[i].Content)
		if body == "" {
			continue
		}
		who := "助手"
		if msgs[i].Role == "user" {
			who = "我"
		}
		out = append(out, fmt.Sprintf("> **[%s]** %s", who, headOfRelay(body, 600)))
	}
	return out
}

// sourceDiscussion reads the tail of the source card's comment thread. Empty
// when the card had no discussion or the read failed — the pack must still
// deliver, and a missing tail is a degraded pack, not a failed one.
func (r *Relay) sourceDiscussion(ctx context.Context, token string, source relayWorkspace, issueID string, limit int) []string {
	if limit <= 0 {
		limit = 8
	}
	// The comments endpoint answers with a flat array, not an envelope.
	var comments []struct {
		AuthorType string `json:"author_type"`
		Content    string `json:"content"`
		CreatedAt  string `json:"created_at"`
	}
	if err := r.request(ctx, token, source.ID, http.MethodGet,
		fmt.Sprintf("/api/issues/%s/comments?limit=%d", issueID, limit), nil, &comments); err != nil {
		relayLog.Warn("relay: source discussion read failed; packing without it",
			"issue", issueID, "error", err)
		return nil
	}
	out := make([]string, 0, len(comments))
	for _, c := range comments {
		body := strings.TrimSpace(c.Content)
		if body == "" || strings.HasPrefix(body, "/note") {
			continue
		}
		out = append(out, "> ["+c.AuthorType+"] "+headOfRelay(body, 600))
	}
	return out
}

// headOfRelay cuts n bytes on a rune boundary.
func headOfRelay(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && s[n]&0xC0 == 0x80 {
		n--
	}
	return s[:n] + "\n…(截断)"
}

// relayRuleWatches reports whether a rule's watch list admits this issue. An
// empty list watches the whole lane.
func relayRuleWatches(watched []string, issueID string) bool {
	if len(watched) == 0 {
		return true
	}
	for _, id := range watched {
		if id == issueID {
			return true
		}
	}
	return false
}
