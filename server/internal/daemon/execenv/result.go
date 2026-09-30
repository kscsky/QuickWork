package execenv

// Bringing a sandbox run's commits home.
//
// The transport is a git bundle in both directions, not the workdir's .git
// directory: a task worktree is created with `git worktree add`, which leaves a
// POINTER FILE at <workdir>/.git (`gitdir: .../worktrees/<name>`) rather than a
// repository. Copying the workdir alone yields a tree with no history, so a
// sandbox cloned from it could never produce a commit that merges back into the
// user's branch. A bundle carries the real objects and, because it is created
// over `<base>..HEAD`, only what the run actually added.

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/kscsky/quickwork/server/pkg/e2b"
)

// resultStagingPath is where the sandbox writes the outgoing bundle. /tmp keeps
// it clear of the workdir the agent was editing.
const resultStagingPath = "/tmp/quickwork-result.bundle"

// resultRefName is the ref the sandbox publishes its HEAD under so the bundle
// has a name to fetch by. A detached HEAD has no ref for `git bundle` to
// record, and cloning or fetching by sha is more awkward than by name.
const resultRefName = "quickwork-result"

// CollectOptions describes the sandbox side of a result.
type CollectOptions struct {
	// WorkDir is the repository inside the sandbox.
	WorkDir string
	// BaseCommit is the revision the environment was built from. The bundle
	// carries `<BaseCommit>..HEAD`, so history that already exists locally does
	// not travel back.
	BaseCommit string
	// LeftoverMessage is the commit message used when the agent left
	// uncommitted changes, mirroring what the local worktree finalizer does.
	LeftoverMessage string
}

// CollectOutcome is what came back.
type CollectOutcome struct {
	// Bundle is the git bundle. Empty when the run produced no new commits —
	// `git bundle` refuses to create an empty one, and there is nothing to
	// import in that case anyway.
	Bundle []byte
	// HeadCommit is the sandbox repository's HEAD after leftover commit.
	HeadCommit string
	// CommittedLeftovers reports whether uncommitted changes had to be
	// committed before bundling.
	CommittedLeftovers bool
}

// CollectResult commits anything the agent left dirty, bundles the new commits,
// and reads the bundle out of the sandbox.
//
// Committing leftovers rather than failing on a dirty tree matches the local
// finalizer: an agent that edited files without committing has still done the
// work, and dropping it because of a missing `git commit` would be the wrong
// trade.
func CollectResult(
	ctx context.Context,
	client *e2b.Client,
	conn e2b.SandboxConn,
	opts CollectOptions,
) (CollectOutcome, error) {
	if strings.TrimSpace(opts.WorkDir) == "" {
		return CollectOutcome{}, fmt.Errorf("collect: workdir is required")
	}
	if strings.TrimSpace(opts.BaseCommit) == "" {
		return CollectOutcome{}, fmt.Errorf("collect: base commit is required")
	}
	message := opts.LeftoverMessage
	if strings.TrimSpace(message) == "" {
		message = "quickwork: commit pending changes from the task"
	}

	script := fmt.Sprintf(`set -e
cd %[1]s
committed=0
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git -c user.name=quickwork -c user.email=quickwork@localhost commit -q -m %[2]s
  committed=1
fi
git branch -f %[3]s HEAD
base=%[4]s
if [ "$(git rev-parse %[3]s)" != "$(git rev-parse "$base")" ]; then
  git bundle create %[5]s "$base"..%[3]s >/dev/null
  echo "BUNDLE=yes"
else
  echo "BUNDLE=no"
fi
echo "COMMITTED=$committed"
echo "HEAD=$(git rev-parse %[3]s)"
`,
		e2b.ShellQuote(opts.WorkDir),
		e2b.ShellQuote(message),
		e2b.ShellQuote(resultRefName),
		e2b.ShellQuote(opts.BaseCommit),
		e2b.ShellQuote(resultStagingPath),
	)

	res, err := client.RunCommand(ctx, conn, "/bin/bash", []string{"-c", script}, e2b.RunCommandOptions{})
	if err != nil {
		return CollectOutcome{}, fmt.Errorf("collect: %w", err)
	}
	if res.ExitCode != 0 {
		return CollectOutcome{}, fmt.Errorf("collect: git failed in the sandbox: %s",
			strings.TrimSpace(res.Stderr+res.Stdout+res.Status))
	}

	out := CollectOutcome{
		HeadCommit:         fieldValue(res.Stdout, "HEAD="),
		CommittedLeftovers: fieldValue(res.Stdout, "COMMITTED=") == "1",
	}
	if fieldValue(res.Stdout, "BUNDLE=") != "yes" {
		// No new commits: a clean checkout that the agent did not touch.
		return out, nil
	}

	body, err := client.DownloadFile(ctx, conn, resultStagingPath)
	if err != nil {
		return out, fmt.Errorf("collect: read bundle: %w", err)
	}
	defer body.Close()
	// One byte over the cap, so hitting it is distinguishable from landing
	// exactly on it.
	bundle, err := io.ReadAll(io.LimitReader(body, maxBundleBytes+1))
	if err != nil {
		return out, fmt.Errorf("collect: read bundle: %w", err)
	}
	if int64(len(bundle)) > maxBundleBytes {
		return out, fmt.Errorf("collect: bundle exceeds the %d byte cap", maxBundleBytes)
	}
	out.Bundle = bundle
	return out, nil
}

// maxBundleBytes caps what we will pull back in one go. A bundle is
// incremental, so this is generous; it exists to stop a runaway run from
// turning into an out-of-memory in the daemon rather than to bound normal use.
const maxBundleBytes = 512 << 20

// fieldValue pulls `KEY=value` out of the sandbox script's line output.
func fieldValue(out, key string) string {
	for _, line := range strings.Split(out, "\n") {
		if v, ok := strings.CutPrefix(strings.TrimSpace(line), key); ok {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// ImportResult fetches a collected bundle into the local repository and returns
// the imported commit's sha.
//
// It deliberately stops at the fetch: the bundle's commits are now objects in
// repoDir with FETCH_HEAD pointing at the tip, and deciding what the user's
// branch should point at (fast-forward, merge, or leave alone for a human) is
// the caller's call, not this function's.
func ImportResult(ctx context.Context, repoDir string, bundle []byte) (string, error) {
	if len(bundle) == 0 {
		return "", nil
	}
	tmp, err := os.CreateTemp("", "quickwork-result-*.bundle")
	if err != nil {
		return "", fmt.Errorf("import: %w", err)
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(bundle); err != nil {
		tmp.Close()
		return "", fmt.Errorf("import: write bundle: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return "", fmt.Errorf("import: close bundle: %w", err)
	}

	fetchCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(fetchCtx, "git", "-C", repoDir, "fetch", "--no-tags",
		tmp.Name(), resultRefName)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("import: git fetch: %w: %s", err, strings.TrimSpace(stderr.String()))
	}

	rev := exec.CommandContext(fetchCtx, "git", "-C", repoDir, "rev-parse", "FETCH_HEAD")
	sha, err := rev.Output()
	if err != nil {
		return "", fmt.Errorf("import: resolve FETCH_HEAD: %w", err)
	}
	return strings.TrimSpace(string(sha)), nil
}

// GitCommonDir returns the repository a worktree shares objects with — the
// directory a bundle has to be fetched into for the worktree to see the
// commits. For a plain clone that is <repo>/.git; for a linked worktree it is
// the main repository's .git, which is the whole reason this helper exists.
func GitCommonDir(ctx context.Context, workDir string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", "-C", workDir, "rev-parse", "--git-common-dir")
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git rev-parse --git-common-dir: %w", err)
	}
	common := strings.TrimSpace(string(out))
	if !filepath.IsAbs(common) {
		common = filepath.Join(workDir, common)
	}
	return filepath.Clean(common), nil
}
