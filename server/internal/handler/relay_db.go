package handler

// DB-backed rule loading for the relay. The rules used to live in a JSON file
// (relay.go still ships the file loader for deployments that prefer it); the
// settings UI writes them to handoff_rule, and this is the bridge that turns a
// row into the same relayRuleIndex the file loader produces.

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	db "github.com/kscsky/quickwork/server/pkg/db/generated"
)

// RelayTokenEnv is the PAT the relay acts as. In DB mode it is the single
// credential for every rule (the JSON mode carries a per-file token instead).
const RelayTokenEnv = "QUICKWORK_HANDOFF_TOKEN"

// RelayQueries is the narrow DB surface the DB loader needs, so tests and the
// main bootstrap can hand in either a real *db.Queries or a fake.
type RelayQueries interface {
	ListEnabledHandoffRules(ctx context.Context) ([]db.HandoffRule, error)
}

// LoadFromDB rebuilds the relay's rule set from handoff_rule. It resolves each
// rule's workspaces and agent through the token (the same path the file loader
// uses), so a target that has gone missing surfaces as an error naming the
// rule instead of a silent no-op at fire time.
func (r *Relay) LoadFromDB(ctx context.Context, q RelayQueries, token string) (int, error) {
	if strings.TrimSpace(token) == "" {
		return 0, fmt.Errorf("relay: no token configured (%s)", RelayTokenEnv)
	}
	rules, err := q.ListEnabledHandoffRules(ctx)
	if err != nil {
		return 0, fmt.Errorf("relay: list rules: %w", err)
	}

	indexed := make([]relayRuleIndex, 0, len(rules))
	for _, rule := range rules {
		ruleSpec := RelayRule{
			Name:            rule.Name,
			SourceWorkspace: uuidToString(rule.SourceWorkspaceID),
			SourceStatus:    rule.TriggerStatus,
			TargetKind:      "issue",
			TargetWorkspace: uuidToString(rule.TargetWorkspaceID),
			TargetAgentID:   uuidToString(rule.TargetAgentID),
			TaskTemplate:    rule.TaskTemplate,
			TargetStatus:    "todo",
			Note:            rule.Note,
			ContextComments: int(rule.ContextComments),
			IssueIDs:        uuidSliceToStrings(rule.WatchedIssueIds),
			ChatSessionID:   uuidToString(rule.ChatSessionID),
		}
		source, err := r.lookupWorkspaceByID(ctx, token, ruleSpec.SourceWorkspace, "")
		if err != nil {
			return 0, fmt.Errorf("relay: rule %q source: %w", rule.Name, err)
		}
		target, err := r.lookupWorkspaceByID(ctx, token, ruleSpec.TargetWorkspace, "")
		if err != nil {
			return 0, fmt.Errorf("relay: rule %q target: %w", rule.Name, err)
		}
		indexed = append(indexed, relayRuleIndex{
			id: uuidToString(rule.ID), rule: ruleSpec, source: source, target: target, agentID: ruleSpec.TargetAgentID,
		})

		// Receipt leg: derived, not stored as its own rule. The target card
		// carries the origin marker; when it enters the receipt status the
		// relay posts the outcome back to the origin card.
		if strings.TrimSpace(rule.ReceiptStatus) != "" {
			indexed = append(indexed, relayRuleIndex{
				rule: RelayRule{
					Name:            rule.Name + " (回执)",
					SourceWorkspace: ruleSpec.TargetWorkspace,
					SourceStatus:    rule.ReceiptStatus,
					TargetKind:      "comment",
					TargetWorkspace: ruleSpec.SourceWorkspace,
					ContextComments: int(rule.ContextComments),
				},
				source: target, target: source,
			})
		}
	}

	r.mu.Lock()
	r.cfg = RelayConfig{Token: token}
	r.rules = indexed
	r.mu.Unlock()
	return len(indexed), nil
}

// lookupWorkspaceByID resolves a workspace UUID through the server's own
// workspace list (the relay's identity is a member of it). Kept separate from
// lookupWorkspace (slug-based) so DB mode never depends on a slug column.
func (r *Relay) lookupWorkspaceByID(ctx context.Context, token, id, _ string) (relayWorkspace, error) {
	r.wsMu.Lock()
	for _, ws := range r.wsCache {
		if ws.ID == id {
			r.wsMu.Unlock()
			return ws, nil
		}
	}
	r.wsMu.Unlock()

	var list []struct {
		ID          string `json:"id"`
		Slug        string `json:"slug"`
		IssuePrefix string `json:"issue_prefix"`
	}
	if err := r.request(ctx, token, "", "GET", "/api/workspaces", nil, &list); err != nil {
		return relayWorkspace{}, fmt.Errorf("list workspaces: %w", err)
	}
	r.wsMu.Lock()
	defer r.wsMu.Unlock()
	for _, w := range list {
		r.wsCache[w.Slug] = relayWorkspace{ID: w.ID, Slug: w.Slug, Prefix: w.IssuePrefix}
	}
	for _, ws := range r.wsCache {
		if ws.ID == id {
			return ws, nil
		}
	}
	return relayWorkspace{}, fmt.Errorf("workspace %s not visible to the relay token", id)
}

// RelayToken reads the DB-mode credential.
func RelayToken() string {
	return strings.TrimSpace(os.Getenv(RelayTokenEnv))
}

// relayServerURL is the address the relay calls back into (set at bootstrap).
// Handlers that need the relay's own lane reuse it instead of guessing one.
var relayServerURL string

// RelayServerURL returns the bootstrapped self-call base URL ("" before boot).
func RelayServerURL() string { return relayServerURL }

// HandoffTarget is one workspace an agent may be handed off TO, as seen by the
// relay token. Agents are prefiltered to those the token can actually invoke
// (public_to, or owned by the token's user) — offering an invokable-looking
// agent that would 403 at fire time is the failure this list exists to avoid.
type HandoffTarget struct {
	WorkspaceID   string               `json:"workspace_id"`
	WorkspaceSlug string               `json:"workspace_slug"`
	WorkspaceName string               `json:"workspace_name"`
	Agents        []HandoffTargetAgent `json:"agents"`
}

type HandoffTargetAgent struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// relayTargetsCache memoizes the (token, sourceWS) target list briefly: the set
// changes when someone joins a workspace or changes an agent's visibility, both
// human-paced, and every settings-page open would otherwise fan out one request
// per workspace.
var (
	relayTargetsMu    sync.Mutex
	relayTargetsCache = map[string]relayTargetsEntry{}
)

type relayTargetsEntry struct {
	targets []HandoffTarget
	at      time.Time
}

// ListTargets resolves workspaces + invokable agents through the relay token.
func (r *Relay) ListTargets(ctx context.Context, token, sourceWorkspaceID string) ([]HandoffTarget, error) {
	cacheKey := token[:min(len(token), 12)] + "|" + sourceWorkspaceID
	relayTargetsMu.Lock()
	if e, ok := relayTargetsCache[cacheKey]; ok && time.Since(e.at) < 2*time.Minute {
		relayTargetsMu.Unlock()
		return e.targets, nil
	}
	relayTargetsMu.Unlock()

	var workspaces []struct {
		ID   string `json:"id"`
		Slug string `json:"slug"`
		Name string `json:"name"`
	}
	if err := r.request(ctx, token, "", "GET", "/api/workspaces", nil, &workspaces); err != nil {
		return nil, fmt.Errorf("list workspaces: %w", err)
	}

	out := make([]HandoffTarget, 0, len(workspaces))
	for _, ws := range workspaces {
		if ws.ID == sourceWorkspaceID {
			continue
		}
		var agentsResp []struct {
			ID             string  `json:"id"`
			Name           string  `json:"name"`
			PermissionMode string  `json:"permission_mode"`
			OwnerID        *string `json:"owner_id"`
			ArchivedAt     *string `json:"archived_at"`
		}
		if err := r.request(ctx, token, ws.ID, "GET", "/api/agents", nil, &agentsResp); err != nil {
			continue // one unreachable workspace must not sink the list
		}
		agents := make([]HandoffTargetAgent, 0, len(agentsResp))
		for _, a := range agentsResp {
			if a.ArchivedAt != nil && *a.ArchivedAt != "" {
				continue
			}
			// No invokability filter: both sides may pick each other's agents
			// (product call). A rule pointing at an agent the token cannot
			// invoke still fails loudly at delivery time.
			agents = append(agents, HandoffTargetAgent{ID: a.ID, Name: a.Name})
		}
		out = append(out, HandoffTarget{
			WorkspaceID: ws.ID, WorkspaceSlug: ws.Slug, WorkspaceName: ws.Name, Agents: agents,
		})
	}

	relayTargetsMu.Lock()
	relayTargetsCache[cacheKey] = relayTargetsEntry{targets: out, at: time.Now()}
	relayTargetsMu.Unlock()
	return out, nil
}
