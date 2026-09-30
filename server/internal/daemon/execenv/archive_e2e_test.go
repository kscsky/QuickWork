//go:build e2b_e2e

// End-to-end verification of the remote-execution delivery path: pack a
// prepared environment, ship it to a real sandbox, and prove the tree arrived
// intact.
//
// This is the pair that matters — WriteArchive here, UploadArchive in pkg/e2b —
// and it lives in execenv because that is the layer that would orchestrate it.
// Skipped unless both a build tag and an explicit opt-in are present:
//
//	E2B_API_KEY=e2b_... QUICKWORK_RUN_E2B_E2E=1 \
//	  go test -tags=e2b_e2e ./internal/daemon/execenv/ -run TestRealSandboxArchive -v -count=1 -timeout 10m
package execenv

import (
	"bytes"
	"context"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/kscsky/quickwork/server/pkg/e2b"
)

// buildPreparedFixture lays out the shape Prepare actually produces — a
// managed CLAUDE.md beside a workdir and per-CLI skill directories — rather
// than a couple of arbitrary files, so the tree assertions mean something.
func buildPreparedFixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	files := map[string]string{
		"CLAUDE.md":                           "# managed block\nrun the tests\n",
		"workdir/README.md":                   "workdir readme\n",
		"workdir/pkg/main.go":                 "package main\n\nfunc main() {}\n",
		"workdir/.claude/skills/neo/SKILL.md": "---\nname: neo\n---\ndo the thing\n",
		"workdir/.git/HEAD":                   "ref: refs/heads/main\n",
		"workdir/node_modules/dep/x.js":       "module.exports={}\n",
		"logs/.keep":                          "",
	}
	for rel, body := range files {
		full := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

// sourceTree lists the files under root the way the sandbox reports them:
// slash-separated, relative, sorted, with the archive's excludes applied.
func sourceTree(t *testing.T, root string) []string {
	t.Helper()
	var out []string
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return relErr
		}
		rel = filepath.ToSlash(rel)
		if excluded(rel, DefaultArchiveExcludes) {
			return nil
		}
		out = append(out, rel)
		return nil
	})
	if err != nil {
		t.Fatalf("walk fixture: %v", err)
	}
	sort.Strings(out)
	return out
}

// sandboxEnvRoot is defined in result_e2e_test.go; see the note there on why
// the extraction target must be user-owned.
func TestRealSandboxArchiveRoundTrip(t *testing.T) {
	if os.Getenv("QUICKWORK_RUN_E2B_E2E") != "1" {
		t.Skip("set QUICKWORK_RUN_E2B_E2E=1 to spend real sandbox credit")
	}
	key := os.Getenv("E2B_API_KEY")
	if key == "" {
		if home, err := os.UserHomeDir(); err == nil {
			if raw, readErr := os.ReadFile(filepath.Join(home, ".e2b_key")); readErr == nil {
				key = strings.TrimSpace(string(raw))
			}
		}
	}
	if key == "" {
		t.Skip("no E2B key: set E2B_API_KEY or write ~/.e2b_key")
	}

	srcDir := buildPreparedFixture(t)

	var archive bytes.Buffer
	packStart := time.Now()
	if err := WriteArchive(&archive, srcDir, ArchiveOptions{Exclude: DefaultArchiveExcludes}); err != nil {
		t.Fatalf("WriteArchive: %v", err)
	}
	t.Logf("packed %s in %s (%d bytes compressed)", srcDir, time.Since(packStart).Round(time.Millisecond), archive.Len())

	client := e2b.NewClient("", key)
	ctx := context.Background()
	created, err := client.CreateSandbox(ctx, "claude", 300)
	if err != nil {
		t.Fatalf("CreateSandbox: %v", err)
	}
	t.Logf("sandbox %s", created.SandboxID)
	defer func() {
		killCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := client.KillSandbox(killCtx, created.SandboxID); err != nil {
			t.Errorf("KillSandbox: %v", err)
		}
	}()

	conn := e2b.SandboxConn{SandboxID: created.SandboxID, AccessToken: created.AccessToken}

	uploadStart := time.Now()
	if err := client.UploadArchive(ctx, conn, sandboxEnvRoot, bytes.NewReader(archive.Bytes())); err != nil {
		t.Fatalf("UploadArchive: %v", err)
	}
	t.Logf("uploaded and extracted in %s", time.Since(uploadStart).Round(time.Millisecond))

	// What the sandbox actually has, in sorted order so the comparison is a
	// real equality rather than a membership check.
	listed, err := client.RunCommand(ctx, conn, "/bin/bash",
		[]string{"-c", "cd " + sandboxEnvRoot + " && find . -type f | sed 's|^\\./||' | sort"},
		e2b.RunCommandOptions{})
	if err != nil {
		t.Fatalf("RunCommand(find): %v", err)
	}
	got := strings.Fields(listed.Stdout)

	// The invariant is "the sandbox mirrors the source tree", so the
	// expectation is read off the fixture rather than hand-written — a
	// hand-written list drifts the moment the fixture changes and then the
	// test is asserting the wrong thing.
	want := sourceTree(t, srcDir)
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("sandbox tree does not mirror the source tree\n got: %v\nwant: %v\nstderr: %s",
			got, want, listed.Stderr)
	}
	if strings.Contains(listed.Stdout, "node_modules") {
		t.Errorf("node_modules travelled to the sandbox; the exclude list did not apply:\n%s", listed.Stdout)
	}

	// Content, not just names: a file that arrives empty passes the listing.
	readBack, err := client.RunCommand(ctx, conn, "/bin/bash",
		[]string{"-c", "cat " + sandboxEnvRoot + "/CLAUDE.md && cat " + sandboxEnvRoot + "/workdir/.git/HEAD"},
		e2b.RunCommandOptions{})
	if err != nil {
		t.Fatalf("RunCommand(cat): %v", err)
	}
	if !strings.Contains(readBack.Stdout, "run the tests") {
		t.Errorf("CLAUDE.md body did not survive: %q", readBack.Stdout)
	}
	if !strings.Contains(readBack.Stdout, "ref: refs/heads/main") {
		t.Errorf(".git did not survive — the agent could not commit: %q", readBack.Stdout)
	}

	// And the agent CLI reads the delivered environment, which is the whole
	// point of shipping it.
	t.Run("claude reads the delivered env", func(t *testing.T) {
		envs := map[string]string{}
		for _, kv := range []string{"ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_MODEL"} {
			if v := os.Getenv(kv); v != "" {
				envs[kv] = v
			}
		}
		if envs["ANTHROPIC_AUTH_TOKEN"] == "" {
			t.Skip("no ANTHROPIC_AUTH_TOKEN to forward into the sandbox")
		}
		runCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		defer cancel()
		res, err := client.RunCommand(runCtx, conn, "claude",
			[]string{"--dangerously-skip-permissions", "-p",
				"Read ../CLAUDE.md and reply with the words that follow the heading."},
			// cwd mirrors the local layout: the CLI runs in the env
			// root's workdir, not at the extraction root.
			e2b.RunCommandOptions{Cwd: sandboxEnvRoot + "/workdir", Envs: envs})
		if err != nil {
			t.Fatalf("RunCommand(claude): %v", err)
		}
		t.Logf("claude exit=%d stdout=%q", res.ExitCode, strings.TrimSpace(res.Stdout))
		if !strings.Contains(strings.ToLower(res.Stdout), "run the tests") {
			t.Errorf("agent did not read the delivered CLAUDE.md: %q (stderr tail %q)",
				res.Stdout, res.Stderr)
		}
	})
}
