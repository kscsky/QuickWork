//go:build e2b_e2e

// Real-sandbox verification for the envd client: create → upload → run the
// agent CLI → stream → destroy.
//
// Never runs by default. It spends real sandbox credit and needs a live E2B
// key plus a model endpoint the sandbox can reach, so it is gated behind both
// a build tag and an explicit opt-in:
//
//	E2B_API_KEY=e2b_... QUICKWORK_RUN_E2B_E2E=1 \
//	  go test -tags=e2b_e2e ./pkg/e2b/ -run TestRealSandbox -v -count=1 -timeout 10m
//
// The model credentials are read from the developer's own environment
// (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL) and forwarded
// into the sandbox, mirroring how a daemon would hand the runtime its env.
package e2b

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func e2eKey(t *testing.T) string {
	t.Helper()
	if k := os.Getenv("E2B_API_KEY"); k != "" {
		return k
	}
	home, err := os.UserHomeDir()
	if err == nil {
		if raw, readErr := os.ReadFile(filepath.Join(home, ".e2b_key")); readErr == nil {
			return strings.TrimSpace(string(raw))
		}
	}
	t.Skip("no E2B key: set E2B_API_KEY or write ~/.e2b_key")
	return ""
}

func TestRealSandboxCommandRoundTrip(t *testing.T) {
	if os.Getenv("QUICKWORK_RUN_E2B_E2E") != "1" {
		t.Skip("set QUICKWORK_RUN_E2B_E2E=1 to spend real sandbox credit")
	}
	client := NewClient("", e2eKey(t))
	ctx := context.Background()

	created, err := client.CreateSandbox(ctx, "claude", 300)
	if err != nil {
		t.Fatalf("CreateSandbox: %v", err)
	}
	t.Logf("sandbox %s (template %s)", created.SandboxID, created.TemplateID)
	defer func() {
		killCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := client.KillSandbox(killCtx, created.SandboxID); err != nil {
			t.Errorf("KillSandbox: %v", err)
		}
	}()

	conn := SandboxConn{SandboxID: created.SandboxID, AccessToken: created.AccessToken}

	// 1. Upload, the way a daemon would ship a prepared workdir.
	marker := "e2b-e2e-marker-42"
	if err := client.WriteFile(ctx, conn, "/code/CLAUDE.md", []byte("# probe\n"+marker+"\n")); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	// 2. Read it back through the shell — proves the upload landed where the
	// CLI will look, not just that the request returned 200.
	got, err := client.RunCommand(ctx, conn, "/bin/bash",
		[]string{"-c", "cat /code/CLAUDE.md"}, RunCommandOptions{Cwd: "/code"})
	if err != nil {
		t.Fatalf("RunCommand(cat): %v", err)
	}
	if !strings.Contains(got.Stdout, marker) {
		t.Fatalf("uploaded file not readable: %q (%s)", got.Stdout, got.Status)
	}

	// 3. Streaming callbacks fire before the command finishes.
	var chunks []string
	facts, err := client.RunCommand(ctx, conn, "/bin/bash", []string{"-c",
		"for i in 1 2 3; do echo line-$i; sleep 0.2; done"}, RunCommandOptions{
		OnStdout: func(s string) { chunks = append(chunks, s) },
	})
	if err != nil {
		t.Fatalf("RunCommand(stream): %v", err)
	}
	if !strings.Contains(facts.Stdout, "line-3") {
		t.Errorf("stdout = %q", facts.Stdout)
	}
	if len(chunks) < 2 {
		t.Errorf("OnStdout fired %d times; streaming is not chunking", len(chunks))
	}

	// 4. The agent CLI itself, with the caller's model endpoint forwarded in.
	t.Run("claude CLI", func(t *testing.T) {
		envs := map[string]string{}
		for _, kv := range []string{"ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_MODEL"} {
			if v := os.Getenv(kv); v != "" {
				envs[kv] = v
			}
		}
		if envs["ANTHROPIC_AUTH_TOKEN"] == "" {
			t.Skip("no ANTHROPIC_AUTH_TOKEN in the environment to forward into the sandbox")
		}
		runCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		defer cancel()

		res, err := client.RunCommand(runCtx, conn, "claude",
			[]string{"--dangerously-skip-permissions", "-p",
				"Read CLAUDE.md in this directory and reply with exactly the marker string you find there."},
			RunCommandOptions{Cwd: "/code", Envs: envs,
				OnStdout: func(s string) { t.Logf("[agent] %s", strings.TrimRight(s, "\n")) }})
		if err != nil {
			t.Fatalf("RunCommand(claude): %v", err)
		}
		t.Logf("claude exit=%d status=%q\n--- stdout ---\n%s\n--- stderr (tail) ---\n%s",
			res.ExitCode, res.Status, res.Stdout, tail(res.Stderr, 600))
		if !strings.Contains(res.Stdout, marker) {
			t.Errorf("the agent did not read the uploaded file back; stdout=%q stderr=%q",
				res.Stdout, tail(res.Stderr, 300))
		}
	})
}

func tail(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return "..." + s[len(s)-n:]
}

// TestRealSandboxStdin proves the piece the agent CLIs depend on: a remote
// process reading its input from stdin, and learning that the input ended.
//
// Both halves are load-bearing and each cost a failed attempt — data delivery
// needs SendInput addressed by the pid from the start event, EOF needs
// CloseStdin, and both need Connect's unary protocol rather than the enveloped
// one Start uses.
func TestRealSandboxStdin(t *testing.T) {
	if os.Getenv("QUICKWORK_RUN_E2B_E2E") != "1" {
		t.Skip("set QUICKWORK_RUN_E2B_E2E=1 to spend real sandbox credit")
	}
	client := NewClient("", e2eKey(t))
	ctx := context.Background()

	created, err := client.CreateSandbox(ctx, "claude", 300)
	if err != nil {
		t.Fatalf("CreateSandbox: %v", err)
	}
	defer func() {
		killCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = client.KillSandbox(killCtx, created.SandboxID)
	}()
	conn := SandboxConn{SandboxID: created.SandboxID, AccessToken: created.AccessToken}

	// Several times one 32 KiB send, so the pump has to chunk.
	line := "stdin-chunk-line\n"
	payload := strings.Repeat(line, 4000)
	wantLines := strings.Count(payload, line)

	runCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	res, err := client.RunCommand(runCtx, conn, "/bin/bash", []string{"-c", "cat"},
		RunCommandOptions{Stdin: strings.NewReader(payload)})
	if err != nil {
		t.Fatalf("RunCommand with stdin: %v", err)
	}
	// Without EOF the command blocks until the sandbox timeout and reports no
	// exit, which is exactly the failure this test exists to catch.
	if res.ExitCode != 0 {
		t.Fatalf("exit=%d status=%q stderr=%q", res.ExitCode, res.Status, tail(res.Stderr, 400))
	}
	if got := strings.Count(res.Stdout, line); got != wantLines {
		t.Errorf("echoed %d lines, want %d — stdin was truncated", got, wantLines)
	}
	t.Logf("round-tripped %d bytes (%d lines) and got a clean EOF", len(payload), wantLines)
}

// TestRealSandboxClaudeStreamJSON is the whole remote-execution question in one
// test: run the agent CLI in a sandbox exactly as the daemon runs it locally —
// the same argv, the prompt delivered as a stream-json line on stdin — and get
// parseable stream-json back.
//
// If this passes, nothing protocol-level blocks remote execution any more.
func TestRealSandboxClaudeStreamJSON(t *testing.T) {
	if os.Getenv("QUICKWORK_RUN_E2B_E2E") != "1" {
		t.Skip("set QUICKWORK_RUN_E2B_E2E=1 to spend real sandbox credit")
	}
	envs := map[string]string{}
	for _, kv := range []string{"ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_MODEL"} {
		if v := os.Getenv(kv); v != "" {
			envs[kv] = v
		}
	}
	if envs["ANTHROPIC_AUTH_TOKEN"] == "" {
		t.Skip("no ANTHROPIC_AUTH_TOKEN to forward into the sandbox")
	}

	client := NewClient("", e2eKey(t))
	ctx := context.Background()
	created, err := client.CreateSandbox(ctx, "claude", 300)
	if err != nil {
		t.Fatalf("CreateSandbox: %v", err)
	}
	defer func() {
		killCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = client.KillSandbox(killCtx, created.SandboxID)
	}()
	conn := SandboxConn{SandboxID: created.SandboxID, AccessToken: created.AccessToken}

	// The argv buildClaudeArgs produces for a default agent.
	args := []string{
		"-p",
		"--output-format", "stream-json",
		"--input-format", "stream-json",
		"--verbose",
		"--permission-mode", "bypassPermissions",
		"--disallowedTools", "AskUserQuestion",
	}
	// The stdin line buildClaudeInput produces.
	prompt := `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Reply with exactly the word: sandboxed"}]}}` + "\n"

	runCtx, cancel := context.WithTimeout(ctx, 4*time.Minute)
	defer cancel()
	res, err := client.RunCommand(runCtx, conn, "claude", args, RunCommandOptions{
		Cwd:   "/code",
		Envs:  envs,
		Stdin: strings.NewReader(prompt),
	})
	if err != nil {
		t.Fatalf("RunCommand(claude): %v", err)
	}
	t.Logf("exit=%d status=%q", res.ExitCode, res.Status)
	if res.ExitCode != 0 {
		t.Fatalf("claude failed: stderr=%s", tail(res.Stderr, 800))
	}

	// The output must be the stream-json the local backend parses, not just
	// text that happens to mention the word.
	sawResult, sawText := false, false
	for _, line := range strings.Split(res.Stdout, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || line[0] != '{' {
			continue
		}
		var msg map[string]any
		if err := json.Unmarshal([]byte(line), &msg); err != nil {
			continue
		}
		switch msg["type"] {
		case "assistant":
			sawText = true
		case "result":
			sawResult = true
		}
	}
	if !sawResult {
		t.Errorf("no stream-json result event in the output; got:\n%s", tail(res.Stdout, 800))
	}
	if !sawText {
		t.Errorf("no stream-json assistant event in the output")
	}
	if !strings.Contains(strings.ToLower(res.Stdout), "sandboxed") {
		t.Errorf("the agent's answer is missing from the output; got:\n%s", tail(res.Stdout, 600))
	}
	t.Logf("stream-json round trip ok (%d bytes of transcript)", len(res.Stdout))
}
