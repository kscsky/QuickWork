//go:build e2b_e2e

// The full result round trip against a real sandbox: ship a repository, do work
// in it, collect the commits, and prove they land in the local repo as
// descendants of the commit that was shipped.
//
//	E2B_API_KEY=e2b_... QUICKWORK_RUN_E2B_E2E=1 \
//	  go test -tags=e2b_e2e ./internal/daemon/execenv/ -run TestRealSandboxResult -v -count=1 -timeout 10m
package execenv

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/kscsky/quickwork/server/pkg/e2b"
)

// sandboxEnvRoot is where a prepared environment is placed in a sandbox.
//
// It has to be a directory the sandbox's own user owns. E2B's default /code is
// root-owned (mode 0777, which is enough for reading but not for git): git
// refuses to operate on a repository whose owner differs from the caller, so
// cloning into /code fails with "detected dubious ownership". $HOME is the one
// path the sandbox user reliably owns.
const sandboxEnvRoot = "/home/user/quickwork-env"

func TestRealSandboxResultRoundTrip(t *testing.T) {
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

	ctx := context.Background()
	localRepo := filepath.Join(t.TempDir(), "local")
	initRepo(t, localRepo)
	base := git(t, localRepo, "rev-parse", "HEAD")
	t.Logf("local base commit %s", base[:8])

	// Ship the repository the way the daemon would: a bundle, not the workdir's
	// .git pointer file.
	bundlePath := filepath.Join(t.TempDir(), "in.bundle")
	git(t, localRepo, "bundle", "create", bundlePath, "--all")
	inbound, err := os.ReadFile(bundlePath)
	if err != nil {
		t.Fatal(err)
	}

	client := e2b.NewClient("", key)
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

	if err := client.WriteFile(ctx, conn, "/tmp/in.bundle", inbound); err != nil {
		t.Fatalf("upload bundle: %v", err)
	}
	setup, err := client.RunCommand(ctx, conn, "/bin/bash", []string{"-c", `set -e
git --version
git clone -q /tmp/in.bundle ` + sandboxEnvRoot + `
cd ` + sandboxEnvRoot + `
git log --oneline | head -3`}, e2b.RunCommandOptions{})
	if err != nil {
		t.Fatalf("RunCommand(clone): %v", err)
	}
	if setup.ExitCode != 0 {
		t.Fatalf("clone failed: %s%s", setup.Stdout, setup.Stderr)
	}
	t.Logf("sandbox repo:\n%s", setup.Stdout)

	// Stand in for the agent: one commit, plus a dirty file it forgot to
	// commit, so the leftover path is exercised too.
	arrival, err := client.RunCommand(ctx, conn, "/bin/bash", []string{"-c", `set -e
cd ` + sandboxEnvRoot + `
printf 'committed by the run\n' > agent-work.txt
git -c user.name=agent -c user.email=agent@localhost add agent-work.txt
git -c user.name=agent -c user.email=agent@localhost commit -q -m "agent: add agent-work.txt"
printf 'left behind\n' > leftover.txt
git status --porcelain`}, e2b.RunCommandOptions{})
	if err != nil {
		t.Fatalf("RunCommand(agent): %v", err)
	}
	if arrival.ExitCode != 0 {
		t.Fatalf("agent simulation failed: %s%s", arrival.Stdout, arrival.Stderr)
	}
	t.Logf("dirty before collect: %q", strings.TrimSpace(arrival.Stdout))

	collectStart := time.Now()
	outcome, err := CollectResult(ctx, client, conn, CollectOptions{
		WorkDir:    sandboxEnvRoot,
		BaseCommit: base,
	})
	if err != nil {
		t.Fatalf("CollectResult: %v", err)
	}
	t.Logf("collected in %s: head=%s bundle=%d bytes leftoversCommitted=%v",
		time.Since(collectStart).Round(time.Millisecond), outcome.HeadCommit, len(outcome.Bundle), outcome.CommittedLeftovers)

	if !outcome.CommittedLeftovers {
		t.Error("the dirty file was not committed; the leftover path did not run")
	}
	if len(outcome.Bundle) == 0 {
		t.Fatal("no bundle came back")
	}

	sha, err := ImportResult(ctx, localRepo, outcome.Bundle)
	if err != nil {
		t.Fatalf("ImportResult: %v", err)
	}
	t.Logf("imported %s", sha)
	if sha != outcome.HeadCommit {
		t.Errorf("imported %s, want the sandbox head %s", sha, outcome.HeadCommit)
	}
	// The commits must descend from what was shipped, or they cannot go onto
	// the user's branch.
	if out := git(t, localRepo, "merge-base", "--is-ancestor", base, sha); out != "" {
		t.Errorf("unexpected merge-base output: %q", out)
	}
	// Across the whole imported range, not just the tip: the run produced two
	// commits here (the agent's and the leftover one), and `git show <tip>`
	// would only report the second.
	files := git(t, localRepo, "log", "--name-only", "--format=", base+".."+sha)
	for _, want := range []string{"agent-work.txt", "leftover.txt"} {
		if !strings.Contains(files, want) {
			t.Errorf("the imported range does not contain %s (has %q)", want, files)
		}
	}
	if got := git(t, localRepo, "rev-list", "--count", base+".."+sha); got != "2" {
		t.Errorf("imported %s commits, want 2 (the agent's plus the leftover)", got)
	}
	t.Logf("files across the imported range:\n%s", files)
}
