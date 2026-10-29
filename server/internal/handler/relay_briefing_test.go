// The next leg must receive the holder's curated package, not just the prose
// summary: the next-leg brief, the open questions, and the acceptance ledger
// are the parts the agent is expected to act on.
package handler

import (
	"context"
	"strings"
	"testing"

	"github.com/kscsky/quickwork/server/internal/service"
	db "github.com/kscsky/quickwork/server/pkg/db/generated"
)

func TestBuildRelayLegBriefingCarriesStructuredHandoff(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	prevHolder := dbfx.User(t, "Briefing prior holder", "briefing-prior@example.test")
	currHolder := dbfx.User(t, "Briefing current holder", "briefing-current@example.test")
	agentID := dbfx.Agent(t, "briefing agent", handlerTestRuntimeID(t), nil)

	steps := []db.IssueChainStep{
		{
			Position:       0,
			HolderUserID:   parseUUID(prevHolder),
			State:          service.ChainStateDone,
			HandoffSummary: "the previous leg delivered",
			HandoffPackage: []byte(`{
				"acceptance": [
					{"label": "口径", "requirement": "超 3 次进审计队列", "delivered": "见清单 §2", "state": "pass"}
				],
				"open_questions": ["人工队列容量上限未定"],
				"next_brief": ["补 1/2/4 退避压测数据", "把审计队列接进对账报表"]
			}`),
		},
		{
			Position:     1,
			HolderUserID: parseUUID(currHolder),
			AgentID:      parseUUID(agentID),
			State:        service.ChainStateDoing,
			Plan:         "write the revised draft",
		},
	}

	briefing, ok := buildRelayLegBriefing(context.Background(), testHandler.Queries, db.Issue{}, steps, agentID)
	if !ok {
		t.Fatal("no briefing built for the leg's agent")
	}
	for _, want := range []string{
		"next leg's brief",
		"补 1/2/4 退避压测数据",
		"open questions carried over",
		"人工队列容量上限未定",
		"acceptance ledger",
		"[pass] 口径",
		"超 3 次进审计队列",
		"write the revised draft",
	} {
		if !strings.Contains(briefing, want) {
			t.Errorf("briefing missing %q:\n%s", want, briefing)
		}
	}

	// A malformed package degrades to the summary, never a failed briefing.
	steps[0].HandoffPackage = []byte(`{"acceptance":`)
	broken, ok := buildRelayLegBriefing(context.Background(), testHandler.Queries, db.Issue{}, steps, agentID)
	if !ok || !strings.Contains(broken, "the previous leg delivered") {
		t.Fatalf("malformed package broke the briefing: ok=%v\n%s", ok, broken)
	}
}
