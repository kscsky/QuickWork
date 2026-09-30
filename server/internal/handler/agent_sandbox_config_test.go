package handler

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/kscsky/quickwork/server/internal/testutil"
)

// The sandbox config is written wholesale by UpdateAgent, so the two things
// worth pinning are the round trip and the "omitted field preserves" rule —
// the same contract conversation_starters and runtime_config carry, and the
// one the settings form depends on when it PATCHes a single field.
func TestAgentSandboxConfigRoundTrip(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}

	var created AgentResponse
	testutil.Call(t, testHandler.CreateAgent, newRequest(http.MethodPost, "/api/agents", map[string]any{
		"name":       fmt.Sprintf("sandbox-config-%d", time.Now().UnixNano()),
		"runtime_id": handlerTestRuntimeID(t),
	})).Want(http.StatusCreated).JSON(&created)
	dbfx.Cleanup(t, `DELETE FROM agent WHERE id = $1`, created.ID)
	if created.SandboxConfig != nil {
		t.Fatalf("new agent sandbox_config = %#v, want nil (unset means run on the daemon)", created.SandboxConfig)
	}

	var saved AgentResponse
	testutil.Call(t, testHandler.UpdateAgent, withURLParam(
		newRequest(http.MethodPut, "/api/agents/"+created.ID, map[string]any{
			"sandbox_config": map[string]any{
				"enabled":         true,
				"template":        "claude",
				"timeout_seconds": 1800,
			},
		}),
		"id",
		created.ID,
	)).Want(http.StatusOK).JSON(&saved)

	got, _ := saved.SandboxConfig.(map[string]any)
	if got == nil {
		t.Fatalf("sandbox_config = %#v, want the saved object", saved.SandboxConfig)
	}
	if got["enabled"] != true {
		t.Errorf("enabled = %#v, want true", got["enabled"])
	}
	if got["template"] != "claude" {
		t.Errorf("template = %#v, want claude", got["template"])
	}
	// JSON numbers decode as float64 through `any`.
	if got["timeout_seconds"] != float64(1800) {
		t.Errorf("timeout_seconds = %#v, want 1800", got["timeout_seconds"])
	}

	// An update that says nothing about sandbox_config must leave it alone:
	// the form saves one field at a time and the column is written wholesale.
	var preserved AgentResponse
	testutil.Call(t, testHandler.UpdateAgent, withURLParam(
		newRequest(http.MethodPut, "/api/agents/"+created.ID, map[string]any{
			"description": "sandbox config untouched",
		}),
		"id",
		created.ID,
	)).Want(http.StatusOK).JSON(&preserved)
	preservedCfg, _ := preserved.SandboxConfig.(map[string]any)
	if preservedCfg == nil || preservedCfg["template"] != "claude" {
		t.Fatalf("omitted update sandbox_config = %#v, want the stored config preserved", preserved.SandboxConfig)
	}

	// Turning it off is an explicit false, not an omission — there is no
	// NULL-clear path through UpdateAgent's COALESCE.
	var disabled AgentResponse
	testutil.Call(t, testHandler.UpdateAgent, withURLParam(
		newRequest(http.MethodPut, "/api/agents/"+created.ID, map[string]any{
			"sandbox_config": map[string]any{"enabled": false},
		}),
		"id",
		created.ID,
	)).Want(http.StatusOK).JSON(&disabled)
	disabledCfg, _ := disabled.SandboxConfig.(map[string]any)
	if disabledCfg == nil || disabledCfg["enabled"] != false {
		t.Fatalf("disabled sandbox_config = %#v, want enabled:false", disabled.SandboxConfig)
	}
}
