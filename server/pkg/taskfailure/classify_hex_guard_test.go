package taskfailure

import (
	"strings"
	"testing"
)

// Incident regression (NEO-2): a checkpoint `git add -A` failed with plain
// "exit status 1" amid 104k hex paths; "403" inside a blob hash routed the
// failure to provider_auth_or_access. Hex neighbours must not arm the code
// buckets, while genuine "HTTP 403 Forbidden" prose still must.
func TestHTTPCodeGuardsIgnoreHexEmbeds(t *testing.T) {
	cases := []struct {
		raw    string
		reason Reason
		match  bool
	}{
		{"git add: warning in working copy of '.pnpm-store/v10/files/00/a4fb6206423aabffdbddd242ba26524c72f8366cd01043a3bd544dfc928ffc4ecdc2eaa759973055a9ee9649e044cedc14af3c0488c84cef8a': exit status 1", ReasonAgentProcessFailure, true},
		{"loose object missing at objects/f403bca1d5", ReasonAgentUnknown, false},
		{"loose object at objects/500abcdef", ReasonAgentUnknown, false},
		{"HTTP 403 Forbidden: cannot lock ref", ReasonAgentProviderAuthOrAccess, true},
		{"error: The requested resource returned 401", ReasonAgentProviderAuthOrAccess, true},
		{"got 402 payment required from gateway", ReasonAgentProviderQuotaLimit, true},
		{"rate limited: HTTP 429, retry later", ReasonAgentProviderCapacityOrRateLimit, true},
		{"upstream said 529 overloaded", ReasonAgentProviderCapacityOrRateLimit, true},
	}
	for i, c := range cases {
		got := Classify(c.raw)
		if c.match && got != c.reason {
			t.Errorf("case %d: want %s, got %s for %q", i, c.reason, got, c.raw[:min(len(c.raw), 80)])
		}
		if !c.match && (strings.Contains(c.raw, "403") || strings.Contains(c.raw, "500")) && got == ReasonAgentProviderAuthOrAccess {
			t.Errorf("case %d: hex-embedded code armed auth bucket: %s", i, got)
		}
	}
}

func TestLocalDirectoryConfigFailuresClassifyAsMissingConfig(t *testing.T) {
	for _, raw := range []string{
		`invalid local-directory config: json: cannot unmarshal string into Go value of type []handler.LocalDirectoryPayloadRef`,
		`Invalid Local-Directory Config: nope`,
		`starting task: invalid local-directory config: resource has no resource_ref`,
	} {
		if got := Classify(raw); got != ReasonAgentMissingConfig {
			t.Errorf("Classify(%q) = %s, want %s", raw[:min(len(raw), 60)], got, ReasonAgentMissingConfig)
		}
	}
}
