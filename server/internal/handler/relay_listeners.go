package handler

// Bootstrap for the cross-workspace relay. Kept beside the relay itself so
// the whole feature is two files plus one call in main.

import (
	"context"
	"os"
	"strings"

	"github.com/kscsky/quickwork/server/internal/util"
	db "github.com/kscsky/quickwork/server/pkg/db/generated"

	"github.com/kscsky/quickwork/server/internal/events"
	"github.com/kscsky/quickwork/server/pkg/protocol"
)

// BootstrapRelay subscribes the relay to issue:updated and loads its rules.
//
// Two sources, in priority order: handoff_rule rows (DB mode, configured
// through the settings UI — a reload closure is returned so rule mutations
// apply without a restart) and, when the database has no rules and no token is
// configured, the legacy relay.json file. Failing to load rules is reported,
// not fatal: the rest of the platform is unaffected by a dead pipe.
func BootstrapRelay(bus *events.Bus, serverURL string, q RelayQueries) (*Relay, func(context.Context) error, error) {
	relayServerURL = strings.TrimRight(serverURL, "/")
	r := NewRelay(serverURL)
	subscribe := func() {
		bus.Subscribe(protocol.EventIssueUpdated, func(e events.Event) {
			r.HandleIssueEvent(context.Background(), e)
		})
	}
	token := RelayToken()
	if q != nil && token != "" {
		if _, err := r.LoadFromDB(context.Background(), q, token); err != nil {
			return nil, nil, err
		}
		// Chat transcript reader (direct DB — the HTTP chat API is
		// creator-only by design).
		if reader, ok := q.(transcriptQueries); ok {
			RelayTranscriptReader = func(ctx context.Context, sessionID string, limit int) ([]relayChatLine, error) {
				sid, err := util.ParseUUID(sessionID)
				if err != nil {
					return nil, err
				}
				rows, err := reader.ListChatTranscriptForSession(ctx, db.ListChatTranscriptForSessionParams{
					SessionID: sid, Limit: int32(limit),
				})
				if err != nil {
					return nil, err
				}
				out := make([]relayChatLine, 0, len(rows))
				for _, m := range rows {
					out = append(out, relayChatLine{Role: m.Role, Content: m.Content})
				}
				return out, nil
			}
		}
		// Watch-list pruning: after a successful hand-off the card leaves the
		// rule's watch list. Wired here where the query surface is in hand.
		if pruner, ok := q.(watchPrunerQueries); ok {
			RelayWatchPruner = func(ctx context.Context, ruleID, issueID string) error {
				rid, err := util.ParseUUID(ruleID)
				if err != nil {
					return err
				}
				iid, err := util.ParseUUID(issueID)
				if err != nil {
					return err
				}
				return pruner.PruneHandoffRuleWatchedIssue(ctx, db.PruneHandoffRuleWatchedIssueParams{
					ID: rid, IssueID: iid,
				})
			}
		}
		subscribe()
		relayLog.Info("relay active (db rules)", "rules", r.RuleCount(), "server", serverURL)
		return r, func(ctx context.Context) error {
			n, err := r.LoadFromDB(ctx, q, token)
			if err == nil {
				relayLog.Info("relay rules reloaded", "rules", n)
			}
			return err
		}, nil
	}

	rules, err := r.Load(context.Background())
	if err != nil {
		return nil, nil, err
	}
	if rules == 0 {
		return r, nil, nil
	}
	subscribe()
	relayLog.Info("relay active", "rules", rules, "server", serverURL,
		"config", os.Getenv(RelayConfigEnv))
	return r, nil, nil
}

// watchPrunerQueries is the slice of *db.Queries the prune callback needs.
type watchPrunerQueries interface {
	PruneHandoffRuleWatchedIssue(ctx context.Context, arg db.PruneHandoffRuleWatchedIssueParams) error
}

// transcriptQueries is the slice of *db.Queries the transcript reader needs.
type transcriptQueries interface {
	ListChatTranscriptForSession(ctx context.Context, arg db.ListChatTranscriptForSessionParams) ([]db.ListChatTranscriptForSessionRow, error)
}
