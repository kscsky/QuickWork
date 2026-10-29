package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/kscsky/quickwork/server/internal/service"
	"github.com/kscsky/quickwork/server/internal/util"
	db "github.com/kscsky/quickwork/server/pkg/db/generated"
)

// buildRelayLegBriefing composes the system briefing appended to a relay leg's
// agent at claim time.
//
// A relay (小队接力) uses none of the squad-leader machinery: each leg's agent
// does its own leg's work, and the baton moves when the leg's holder approves
// (审核通过) — the platform dispatches the next leg itself. The squad operating
// protocol ("coordinate, do not do the work, delegate by @mention") therefore
// must never reach a leg agent: it contradicts the relay, and its roster's
// member-agent mention targets are uninvocable private agents, so following it
// dead-ends in invocation_not_allowed. This briefing is what a leg run gets
// instead: which leg it is, the holder's own brief, what the previous leg
// handed over, and how the run's output travels (a comment, reviewed by the
// holder).
//
// Returns ok=false when this agent is not an agent of any step, so a run that
// merely mentions into a relay issue is not told it is a leg.
func buildRelayLegBriefing(ctx context.Context, q *db.Queries, issue db.Issue, steps []db.IssueChainStep, agentID string) (string, bool) {
	var step *db.IssueChainStep
	for i := range steps {
		s := &steps[i]
		if !s.AgentID.Valid || uuidToString(s.AgentID) != agentID {
			continue
		}
		// Prefer the leg this agent currently holds; fall back to any leg it
		// is named on (a rebind between enqueue and claim).
		if s.State == service.ChainStateDoing || s.State == service.ChainStateReviewing {
			step = s
			break
		}
		if step == nil {
			step = s
		}
	}
	if step == nil {
		return "", false
	}

	seq := int(step.Position) + 1
	total := len(steps)
	title := strings.TrimSpace(step.Title)
	if title == "" {
		title = fmt.Sprintf("Leg %d", seq)
	}

	var sb strings.Builder
	sb.WriteString("## Relay Leg Briefing\n\n")
	fmt.Fprintf(&sb,
		"This task runs as a relay (接力): %d legs run in order, each on the agent its holder lends. "+
			"You are the agent on leg %d/%d — \"%s\" — held by %s. Do this leg's own work.\n\n",
		total, seq, total, title, userName(ctx, q, step.HolderUserID))

	sb.WriteString("- The relay moves only when a leg's holder approves (审核通过) — never when agents talk. " +
		"Do not @mention another member's agent to hand work off: other people's agents are private to them " +
		"and cannot be invoked by you, and the platform dispatches the next leg the moment your holder approves.\n")

	sb.WriteString("- Your holder's brief for this leg (their own words):\n")
	if plan := strings.TrimSpace(step.Plan); plan != "" {
		for _, line := range strings.Split(plan, "\n") {
			sb.WriteString("  > ")
			sb.WriteString(line)
			sb.WriteString("\n")
		}
	} else {
		sb.WriteString("  > (not written yet — work from the issue and the room)\n")
	}

	if step.Position > 0 {
		prev := steps[step.Position-1]
		fmt.Fprintf(&sb, "- Handed over from leg %d (%s):\n", prev.Position+1, userName(ctx, q, prev.HolderUserID))
		if summary := strings.TrimSpace(prev.HandoffSummary); summary != "" {
			for _, line := range strings.Split(summary, "\n") {
				sb.WriteString("  > ")
				sb.WriteString(line)
				sb.WriteString("\n")
			}
		} else {
			sb.WriteString("  > (no summary — read the leg's comments)\n")
		}
		if files := relayHandoffFileNames(prev.HandoffFiles); len(files) > 0 {
			fmt.Fprintf(&sb, "  > files: %s (attachments on this issue)\n", strings.Join(files, ", "))
		}
		// The structured package is the holder's curated handover. The summary
		// above is prose; these fields are the parts the next leg must ACT on,
		// so they are carried explicitly instead of hoping the agent infers
		// them from comment history.
		if pkg, ok := relayHandoffPackage(prev.HandoffPackage); ok {
			if len(pkg.NextBrief) > 0 {
				sb.WriteString("  > next leg's brief:\n")
				for _, item := range pkg.NextBrief {
					if item = strings.TrimSpace(item); item != "" {
						fmt.Fprintf(&sb, "  >   - %s\n", item)
					}
				}
			}
			if len(pkg.OpenQuestions) > 0 {
				sb.WriteString("  > open questions carried over (resolve or account for them):\n")
				for _, question := range pkg.OpenQuestions {
					if question = strings.TrimSpace(question); question != "" {
						fmt.Fprintf(&sb, "  >   - %s\n", question)
					}
				}
			}
			if len(pkg.Acceptance) > 0 {
				sb.WriteString("  > acceptance ledger from the previous leg:\n")
				for _, row := range pkg.Acceptance {
					fmt.Fprintf(&sb, "  >   - [%s] %s — %s", row.State, row.Label, row.Requirement)
					if delivered := strings.TrimSpace(row.Delivered); delivered != "" {
						fmt.Fprintf(&sb, " → %s", delivered)
					}
					sb.WriteString("\n")
				}
			}
		}
	} else {
		sb.WriteString("- This is the first leg — nothing has been handed over.\n")
	}

	sb.WriteString("- When your work is done, post one comment in your own words: what you did, what you are handing over, " +
		"and what your holder needs to know to review it. Your holder curates the outputs and approves to move the relay.\n")
	if seq == total {
		sb.WriteString("- This is the final leg: once your holder approves, the relay is complete.\n")
	}
	return sb.String(), true
}

// relayHandoffPackage parses the structured part of the previous leg's
// handoff. A malformed blob degrades to "no structured package", never to a
// briefing that fails to render.
func relayHandoffPackage(raw []byte) (service.ChainHandoffPackage, bool) {
	if len(raw) == 0 {
		return service.ChainHandoffPackage{}, false
	}
	var pkg service.ChainHandoffPackage
	if err := json.Unmarshal(raw, &pkg); err != nil {
		return service.ChainHandoffPackage{}, false
	}
	return pkg, true
}

// relayHandoffFileNames names the previous leg's handoff files for the
// briefing, tolerating blobs written by other versions.
func relayHandoffFileNames(raw []byte) []string {
	if len(raw) == 0 {
		return nil
	}
	var files []service.ChainHandoffFile
	if err := json.Unmarshal(raw, &files); err != nil {
		return nil
	}
	names := make([]string, 0, len(files))
	for _, f := range files {
		if name := strings.TrimSpace(f.Name); name != "" {
			names = append(names, name)
		}
	}
	return names
}

func userName(ctx context.Context, q *db.Queries, userID pgtype.UUID) string {
	user, err := q.GetUser(ctx, userID)
	if err != nil || strings.TrimSpace(user.Name) == "" {
		return util.UUIDToString(userID)
	}
	return user.Name
}
