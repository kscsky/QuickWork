package execenv

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// git runs a git command in dir with a fixed identity, so test commits do not
// depend on the machine's git config.
func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	full := append([]string{"-C", dir, "-c", "user.name=test", "-c", "user.email=test@example.com"}, args...)
	cmd := exec.Command("git", full...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		t.Fatalf("git %s: %v: %s", strings.Join(args, " "), err, stderr.String())
	}
	return strings.TrimSpace(stdout.String())
}

func initRepo(t *testing.T, dir string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	git(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-q", "-m", "initial")
}

// TestImportResultRoundTripsThroughABundle is the local half of the collection
// flow: a repository produces a `<base>..head` bundle the way the sandbox does,
// and the local side fetches it back.
func TestImportResultRoundTripsThroughABundle(t *testing.T) {
	ctx := context.Background()
	localRepo := filepath.Join(t.TempDir(), "local")
	initRepo(t, localRepo)
	base := git(t, localRepo, "rev-parse", "HEAD")

	// Stand in for the sandbox: clone, commit, publish the ref, bundle.
	sandbox := filepath.Join(t.TempDir(), "sandbox")
	git(t, filepath.Dir(sandbox), "clone", "-q", localRepo, sandbox)
	if err := os.WriteFile(filepath.Join(sandbox, "work.txt"), []byte("from the sandbox\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	git(t, sandbox, "add", "-A")
	git(t, sandbox, "commit", "-q", "-m", "work done in the sandbox")
	git(t, sandbox, "branch", "-f", resultRefName, "HEAD")
	head := git(t, sandbox, "rev-parse", "HEAD")

	bundlePath := filepath.Join(t.TempDir(), "result.bundle")
	git(t, sandbox, "bundle", "create", bundlePath, base+".."+resultRefName)
	bundle, err := os.ReadFile(bundlePath)
	if err != nil {
		t.Fatal(err)
	}
	if len(bundle) == 0 {
		t.Fatal("bundle is empty")
	}

	// The local side must not have the commit yet — otherwise the fetch below
	// proves nothing.
	if _, err := os.Stat(filepath.Join(localRepo, "work.txt")); err == nil {
		t.Fatal("the local repo already has the sandbox's file")
	}

	sha, err := ImportResult(ctx, localRepo, bundle)
	if err != nil {
		t.Fatalf("ImportResult: %v", err)
	}
	if sha != head {
		t.Errorf("imported sha = %q, want %q", sha, head)
	}
	// The object is really in the local repo now, not just named.
	if got := git(t, localRepo, "cat-file", "-t", sha); got != "commit" {
		t.Errorf("cat-file -t %s = %q, want commit", sha, got)
	}
	if got := git(t, localRepo, "show", "--name-only", "--format=", sha); !strings.Contains(got, "work.txt") {
		t.Errorf("imported commit does not carry the new file: %q", got)
	}
	// And the new commit descends from the local base, which is what makes it
	// mergeable back onto the user's branch.
	if got := git(t, localRepo, "merge-base", "--is-ancestor", base, sha); got != "" {
		t.Errorf("unexpected output from merge-base: %q", got)
	}
}

// TestImportResultEmptyBundleIsANoop covers the clean-run case: nothing to
// collect must not be an error.
func TestImportResultEmptyBundleIsANoop(t *testing.T) {
	sha, err := ImportResult(context.Background(), t.TempDir(), nil)
	if err != nil {
		t.Fatalf("ImportResult(nil): %v", err)
	}
	if sha != "" {
		t.Errorf("sha = %q, want empty", sha)
	}
}

// TestGitCommonDirOnWorktree is the claim the whole design rests on: a task
// worktree's .git is a pointer file, so the objects a returned bundle has to
// land in live in the MAIN repository, not under the worktree.
func TestGitCommonDirOnWorktree(t *testing.T) {
	ctx := context.Background()
	main := filepath.Join(t.TempDir(), "main")
	initRepo(t, main)

	worktree := filepath.Join(t.TempDir(), "task-worktree")
	git(t, main, "worktree", "add", "-q", "-b", "quickwork/task-1", worktree)

	// The premise: .git under the worktree is a file, not a directory.
	info, err := os.Stat(filepath.Join(worktree, ".git"))
	if err != nil {
		t.Fatal(err)
	}
	if info.IsDir() {
		t.Fatal(".git under a worktree is a directory; this test's premise no longer holds")
	}

	common, err := GitCommonDir(ctx, worktree)
	if err != nil {
		t.Fatalf("GitCommonDir: %v", err)
	}
	wantCommon, err := filepath.EvalSymlinks(filepath.Join(main, ".git"))
	if err != nil {
		t.Fatal(err)
	}
	gotCommon, err := filepath.EvalSymlinks(common)
	if err != nil {
		t.Fatal(err)
	}
	if gotCommon != wantCommon {
		t.Errorf("GitCommonDir = %q, want %q (the main repo, not the worktree)", gotCommon, wantCommon)
	}

	// A bundle fetched into the common dir must be visible from the worktree —
	// that is what makes the returned commits usable by the task's checkout.
	sandbox := filepath.Join(t.TempDir(), "sandbox")
	git(t, filepath.Dir(sandbox), "clone", "-q", main, sandbox)
	if err := os.WriteFile(filepath.Join(sandbox, "from-sandbox.txt"), []byte("x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	git(t, sandbox, "add", "-A")
	git(t, sandbox, "commit", "-q", "-m", "sandbox work")
	git(t, sandbox, "branch", "-f", resultRefName, "HEAD")
	sha := git(t, sandbox, "rev-parse", "HEAD")

	bundlePath := filepath.Join(t.TempDir(), "r.bundle")
	git(t, sandbox, "bundle", "create", bundlePath, "HEAD~1.."+resultRefName)
	bundle, err := os.ReadFile(bundlePath)
	if err != nil {
		t.Fatal(err)
	}

	imported, err := ImportResult(ctx, common, bundle)
	if err != nil {
		t.Fatalf("ImportResult into the common dir: %v", err)
	}
	if imported != sha {
		t.Errorf("imported sha = %q, want %q", imported, sha)
	}
	// Visible from the worktree's own git (which resolves through the pointer).
	if got := git(t, worktree, "cat-file", "-t", imported); got != "commit" {
		t.Errorf("the worktree cannot see the imported commit: %q", got)
	}
}

func TestFieldValue(t *testing.T) {
	out := "some noise\nBUNDLE=yes\nCOMMITTED=0\nHEAD=abc123\n"
	if got := fieldValue(out, "BUNDLE="); got != "yes" {
		t.Errorf("BUNDLE = %q", got)
	}
	if got := fieldValue(out, "HEAD="); got != "abc123" {
		t.Errorf("HEAD = %q", got)
	}
	if got := fieldValue(out, "MISSING="); got != "" {
		t.Errorf("missing key = %q, want empty", got)
	}
	// A key that is a prefix of a value must not match mid-line.
	if got := fieldValue("xHEAD=zzz\n", "HEAD="); got != "" {
		t.Errorf("prefix match leaked: %q", got)
	}
}
