package sandbox

// The sandbox lifecycle lives in the shim process, not in the daemon.
//
// The shim is spawned once per backend.Execute — one sandbox per task — and it
// exits when the CLI does, so it has a natural place to create and tear down
// the sandbox around the run. Keeping it here rather than in the daemon's task
// pipeline means the daemon needs no session object threaded through the
// ~1000 lines between preparing the environment and launching the backend: it
// swaps three Config fields and the rest of the task path is untouched.

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/kscsky/quickwork/server/internal/daemon/execenv"
	"github.com/kscsky/quickwork/server/pkg/e2b"
)

// Environment variables describing what to ship. Split from the connection
// variables in shim.go because these describe an environment, not a sandbox.
const (
	// EnvLocalRoot is the prepared environment root on this machine. Its whole
	// tree — workdir, skills, per-CLI config — is what travels.
	EnvLocalRoot = "QUICKWORK_SANDBOX_LOCAL_ROOT"
	// EnvRemoteRoot is where that tree lands in the sandbox. Must be a path
	// the sandbox user owns; see startSession.
	EnvRemoteRoot = "QUICKWORK_SANDBOX_REMOTE_ROOT"
	// EnvWorkSubdir is the workdir's path relative to the root, e.g. "workdir".
	EnvWorkSubdir = "QUICKWORK_SANDBOX_WORK_SUBDIR"
	// EnvTemplate and EnvTimeoutSeconds select the sandbox image and its cap.
	EnvTemplate       = "QUICKWORK_SANDBOX_TEMPLATE"
	EnvTimeoutSeconds = "QUICKWORK_SANDBOX_TIMEOUT_SECONDS"
	// EnvRepoDir is the local git directory whose worktree is being shipped,
	// when the task has a repository. Empty means no repository, and the
	// bundle round trip is skipped.
	EnvRepoDir = "QUICKWORK_SANDBOX_REPO_DIR"
	// EnvBaseCommit is the revision the environment was built from; the
	// returned bundle carries only what the run added.
	EnvBaseCommit = "QUICKWORK_SANDBOX_BASE_COMMIT"
)

// session is one running sandbox with a prepared environment inside it.
type session struct {
	client  *e2b.Client
	conn    e2b.SandboxConn
	root    string // remote env root
	workdir string // remote workdir (root + work subdir)
	repoDir string // local repo to import results into; empty when none
	base    string // base commit for the result bundle
}

// daemonInternalFiles live at the environment root and describe the environment
// to THIS daemon: the task lock, its owner, and the GC and sidecar bookkeeping.
// They mean nothing inside a sandbox, and shipping them is not merely useless —
// .task_lock is held open for the duration of the task, so archiving it fails
// with a sharing violation on Windows and takes the whole run down.
var daemonInternalFiles = []string{
	".task_lock",
	".task_owner",
	".gc_meta.json",
	".managed_env.json",
	".quickwork_sidecar_manifest.json",
}

// startSession creates the sandbox and ships the prepared environment into it.
//
// Shipping uses a git bundle for history plus the file archive for the working
// tree, in that order, because the local workdir is a `git worktree` whose .git
// is a pointer file: archiving it would ship a directory with no repository in
// it, and a sandbox cloned from that could never produce a commit that merges
// back into the user's branch.
func startSession(ctx context.Context) (*session, error) {
	localRoot := os.Getenv(EnvLocalRoot)
	if localRoot == "" {
		return nil, fmt.Errorf("%s must be set", EnvLocalRoot)
	}
	remoteRoot := os.Getenv(EnvRemoteRoot)
	if remoteRoot == "" {
		return nil, fmt.Errorf("%s must be set", EnvRemoteRoot)
	}
	timeoutSeconds := 0
	if raw := strings.TrimSpace(os.Getenv(EnvTimeoutSeconds)); raw != "" {
		if _, err := fmt.Sscanf(raw, "%d", &timeoutSeconds); err != nil {
			return nil, fmt.Errorf("%s is not a number: %q", EnvTimeoutSeconds, raw)
		}
	}

	client := e2b.NewClient(os.Getenv(EnvAPIURL), os.Getenv(EnvAPIKey))
	created, err := client.CreateSandbox(ctx, os.Getenv(EnvTemplate), timeoutSeconds)
	if err != nil {
		return nil, fmt.Errorf("create sandbox: %w", err)
	}
	s := &session{
		client:  client,
		conn:    e2b.SandboxConn{SandboxID: created.SandboxID, AccessToken: created.AccessToken},
		root:    remoteRoot,
		workdir: filepath.ToSlash(filepath.Join(remoteRoot, os.Getenv(EnvWorkSubdir))),
		repoDir: os.Getenv(EnvRepoDir),
		base:    os.Getenv(EnvBaseCommit),
	}

	// Preparation failures must not leak a billing sandbox.
	if err := s.prepare(ctx, localRoot); err != nil {
		s.kill()
		return nil, err
	}
	return s, nil
}

// fileArgFlags are the arguments whose value is a path on THIS machine. The
// backends write them to local temp files — the managed MCP config, the
// per-task Claude settings — and pass an absolute local path, which means
// nothing inside the sandbox.
var fileArgFlags = map[string]bool{
	"--mcp-config": true,
	"--settings":   true,
}

// rewriteFileArgs ships each local file these flags point at and returns argv
// with the paths rewritten to their sandbox copies.
//
// Rewriting rather than shipping the whole temp directory: these files are
// generated per task and can be large (the MCP config lists every server), so
// copying exactly what the argv names keeps the transfer proportional to what
// the CLI actually reads.
func (s *session) rewriteFileArgs(ctx context.Context, args []string) ([]string, error) {
	out := append([]string(nil), args...)
	for i := 0; i+1 < len(out); i++ {
		if !fileArgFlags[out[i]] {
			continue
		}
		local := out[i+1]
		if _, err := os.Stat(local); err != nil {
			// Not a local file: leave it alone rather than guessing. The CLI
			// will report it, and that error names the path we were given.
			continue
		}
		content, err := os.ReadFile(local)
		if err != nil {
			return nil, fmt.Errorf("read %s %s: %w", out[i], local, err)
		}
		remote := fmt.Sprintf("%s/%s-%d", s.workdir, filepath.Base(local), time.Now().UnixNano())
		if err := s.client.WriteFile(ctx, s.conn, remote, content); err != nil {
			return nil, fmt.Errorf("ship %s: %w", out[i], err)
		}
		out[i+1] = remote
	}
	return out, nil
}

func (s *session) prepare(ctx context.Context, localRoot string) error {
	// 1. History first, so the clone has the repository before the archive
	//    overwrites its checked-out files with the live working tree.
	if s.repoDir != "" && s.base != "" {
		bundle, err := bundleBranch(ctx, s.repoDir, s.base)
		if err != nil {
			return err
		}
		if len(bundle) > 0 {
			if err := s.client.WriteFile(ctx, s.conn, "/tmp/quickwork-in.bundle", bundle); err != nil {
				return fmt.Errorf("ship bundle: %w", err)
			}
			res, err := s.client.RunCommand(ctx, s.conn, "/bin/bash", []string{"-c",
				fmt.Sprintf("set -e; mkdir -p %s; git clone -q /tmp/quickwork-in.bundle %s",
					e2b.ShellQuote(s.root), e2b.ShellQuote(s.workdir))},
				e2b.RunCommandOptions{})
			if err != nil || res.ExitCode != 0 {
				return fmt.Errorf("clone in sandbox: %v %s", err, strings.TrimSpace(res.Stderr))
			}
		}
	}

	// 2. The working tree. `.git` is excluded because it is a worktree pointer
	//    locally and, after the clone above, a real repository remotely —
	//    extracting a pointer file over it would break git in the sandbox.
	var archive bytes.Buffer
	if err := execenv.WriteArchive(&archive, localRoot, execenv.ArchiveOptions{
		Exclude: append(append([]string{"workdir/.git"}, daemonInternalFiles...), execenv.DefaultArchiveExcludes...),
	}); err != nil {
		return err
	}
	if err := s.client.UploadArchive(ctx, s.conn, s.root, bytes.NewReader(archive.Bytes())); err != nil {
		return err
	}

	// The archive carries no git identity, and a commit made without one fails.
	res, err := s.client.RunCommand(ctx, s.conn, "/bin/bash", []string{"-c",
		fmt.Sprintf("git -C %s config user.name quickwork && git -C %s config user.email quickwork@localhost",
			e2b.ShellQuote(s.workdir), e2b.ShellQuote(s.workdir))},
		e2b.RunCommandOptions{})
	if err != nil {
		return err
	}
	// A non-repository workdir makes this fail, which is expected rather than
	// fatal: tasks without a repository still run.
	_ = res
	return nil
}

// finish collects the run's commits back into the local repository and destroys
// the sandbox. Both happen even on failure — a task that produced nothing still
// must not leave a sandbox billing.
func (s *session) finish(ctx context.Context) {
	defer s.kill()
	if s.repoDir == "" || s.base == "" {
		return
	}
	outcome, err := execenv.CollectResult(ctx, s.client, s.conn, execenv.CollectOptions{
		WorkDir:    s.workdir,
		BaseCommit: s.base,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "[quickwork] sandbox: could not collect results: %v\n", err)
		return
	}
	if len(outcome.Bundle) == 0 {
		return
	}
	sha, err := execenv.ImportResult(ctx, s.repoDir, outcome.Bundle)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[quickwork] sandbox: could not import results: %v\n", err)
		return
	}
	fmt.Fprintf(os.Stderr, "[quickwork] sandbox: imported %s\n", sha)
}

func (s *session) kill() {
	// A detached context: the caller's may already be cancelled, and teardown
	// is the one thing that must still happen.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := s.client.KillSandbox(ctx, s.conn.SandboxID); err != nil {
		fmt.Fprintf(os.Stderr, "[quickwork] sandbox: kill failed, it will expire on its own timeout: %v\n", err)
	}
}

// bundleBranch packages the repository the shipped worktree belongs to, so the
// sandbox gets real history rather than a copy of the files.
func bundleBranch(ctx context.Context, repoDir, base string) ([]byte, error) {
	tmp, err := os.CreateTemp("", "quickwork-in-*.bundle")
	if err != nil {
		return nil, err
	}
	defer os.Remove(tmp.Name())
	tmp.Close()

	cmd := exec.CommandContext(ctx, "git", "-C", repoDir, "bundle", "create", tmp.Name(), "--all")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("bundle %s: %w: %s", repoDir, err, strings.TrimSpace(stderr.String()))
	}
	return os.ReadFile(tmp.Name())
}
