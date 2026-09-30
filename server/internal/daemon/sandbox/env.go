package sandbox

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/kscsky/quickwork/server/internal/daemon/execenv"
)

// LaunchConfig is what the daemon knows at launch time and the shim cannot
// discover for itself.
type LaunchConfig struct {
	// TaskID namespaces the remote root so concurrent tasks on one account do
	// not collide inside their sandboxes.
	TaskID string
	// LocalRoot is the prepared environment on this machine.
	LocalRoot string
	// WorkDir is the agent's cwd inside that root; the remote workdir is
	// derived from its position under LocalRoot.
	WorkDir string
	// RepoDir is the local repository to import results into. Empty for a task
	// with no repository. For a worktree this is the MAIN repository's git
	// directory, not the worktree's — see execenv.GitCommonDir.
	RepoDir string
	// BaseCommit is what the environment was built from.
	BaseCommit string

	APIURL         string
	APIKey         string
	Template       string
	TimeoutSeconds int

	// CustomEnv is the agent's own environment, forwarded verbatim: it is
	// already how the agent's owner hands the CLI its configuration.
	CustomEnv map[string]string
	// Ambient is the daemon's process environment, consulted only for the
	// names in forwardAllowlist.
	Ambient []string
}

// forwardAllowlist is the set of ambient variables that reach the sandbox.
//
// An allowlist rather than "everything the CLI would see": locally the CLI
// inherits the daemon's whole environment, and copying that into a sandbox
// would hand a remote machine the host's credentials — which is the exposure
// the sandbox exists to prevent. These names are the ones the agent CLIs need
// to reach their model provider; an agent that needs more can declare it in its
// own environment, which is forwarded wholesale.
var forwardAllowlist = []string{
	"ANTHROPIC_API_KEY",
	"ANTHROPIC_AUTH_TOKEN",
	"ANTHROPIC_BASE_URL",
	"ANTHROPIC_MODEL",
	"OPENAI_API_KEY",
	"OPENAI_BASE_URL",
	"OPENAI_MODEL",
	"GEMINI_API_KEY",
	"DEEPSEEK_API_KEY",
	"CLAUDE_CODE_USE_BEDROCK",
	"CLAUDE_CODE_USE_VERTEX",
	"AWS_REGION",
	"AWS_PROFILE",
	"HTTPS_PROXY",
	"HTTP_PROXY",
	"NO_PROXY",
}

// LaunchEnvironment builds the environment for the shim process.
func LaunchEnvironment(cfg LaunchConfig) (map[string]string, error) {
	if cfg.LocalRoot == "" {
		return nil, fmt.Errorf("sandbox: local root is required")
	}
	workSubdir, err := workSubdirOf(cfg.LocalRoot, cfg.WorkDir)
	if err != nil {
		return nil, err
	}

	forward := map[string]string{}
	for _, name := range forwardAllowlist {
		if v, ok := lookupEnv(cfg.Ambient, name); ok && v != "" {
			forward[name] = v
		}
	}
	for k, v := range cfg.CustomEnv {
		forward[k] = v
	}
	encodedForward, err := json.Marshal(forward)
	if err != nil {
		return nil, err
	}

	remoteRoot := "/home/user/quickwork-env"
	if cfg.TaskID != "" {
		remoteRoot = filepath.ToSlash(filepath.Join(remoteRoot, cfg.TaskID))
	}

	out := map[string]string{
		EnvAPIURL:     cfg.APIURL,
		EnvAPIKey:     cfg.APIKey,
		EnvLocalRoot:  cfg.LocalRoot,
		EnvRemoteRoot: remoteRoot,
		EnvWorkSubdir: workSubdir,
		EnvForward:    string(encodedForward),
	}
	if cfg.Template != "" {
		out[EnvTemplate] = cfg.Template
	}
	if cfg.TimeoutSeconds > 0 {
		out[EnvTimeoutSeconds] = fmt.Sprintf("%d", cfg.TimeoutSeconds)
	}
	if cfg.RepoDir != "" {
		out[EnvRepoDir] = cfg.RepoDir
	}
	if cfg.BaseCommit != "" {
		out[EnvBaseCommit] = cfg.BaseCommit
	}
	return out, nil
}

// workSubdirOf returns WorkDir's path relative to root, which is how the shim
// knows where inside the shipped tree the CLI should run. The local layout is
// mirrored remotely so relative paths inside the environment — CLAUDE.md, skill
// directories — resolve exactly as they do on this machine.
func workSubdirOf(root, workDir string) (string, error) {
	if workDir == "" {
		return "", nil
	}
	rel, err := filepath.Rel(root, workDir)
	if err != nil {
		return "", fmt.Errorf("sandbox: workdir %s is not under the environment root %s: %w", workDir, root, err)
	}
	if strings.HasPrefix(rel, "..") {
		// A local_directory resource points the workdir at the user's own
		// path, outside the root. Shipping that is a different design (the
		// files are not daemon-owned scratch), so it is refused rather than
		// half-supported.
		return "", fmt.Errorf("sandbox: workdir %s is outside the environment root; local-directory tasks cannot run in a sandbox yet", workDir)
	}
	return filepath.ToSlash(rel), nil
}

// lookupEnv searches a KEY=VALUE slice, the shape os.Environ returns.
func lookupEnv(environ []string, name string) (string, bool) {
	prefix := name + "="
	for _, kv := range environ {
		if strings.HasPrefix(kv, prefix) {
			return kv[len(prefix):], true
		}
	}
	return "", false
}

// SelfExecutable is overridable for tests, mirroring the daemon's own
// indirection for the preparation helper.
var selfExecutable = os.Executable

// ResolveSelfExecutable returns the quickwork binary the shim runs from.
func ResolveSelfExecutable() (string, error) {
	return selfExecutable()
}

// ResultTarget resolves where a run's commits should land locally: the
// repository a bundle must be fetched into, and the revision the environment
// was built from.
//
// The repository is the worktree's COMMON git directory, not the worktree
// itself — commits fetched into the worktree's own .git (a pointer file) would
// not be visible from the branch the user checks out.
//
// Returns empty strings when the workdir is not a repository, which is a
// legitimate shape: tasks without a repository still run, they just have no
// results to bring back.
func ResultTarget(ctx context.Context, workDir string) (string, string) {
	if workDir == "" {
		return "", ""
	}
	common, err := execenv.GitCommonDir(ctx, workDir)
	if err != nil {
		return "", ""
	}
	out, err := exec.CommandContext(ctx, "git", "-C", workDir, "rev-parse", "HEAD").Output()
	if err != nil {
		return "", ""
	}
	return common, strings.TrimSpace(string(out))
}

// RemoteCommandName turns the daemon's local path to a CLI into the name to
// invoke inside the sandbox.
//
// The local path is meaningless remotely — it is a Windows path when the
// daemon runs on Windows and the sandbox is Linux — so only the program's
// identity travels. The sandbox template is what supplies the actual binary,
// and it puts it on PATH under the CLI's own name.
//
// Only the Windows shim extensions are stripped. Trimming filepath.Ext would
// also eat a version suffix from a name like `tool.v2`, and a wrong command
// name fails inside the sandbox where it is expensive to diagnose, so the
// transformation stays narrow.
func RemoteCommandName(localPath string) string {
	name := filepath.Base(localPath)
	lower := strings.ToLower(name)
	for _, ext := range []string{".exe", ".cmd", ".bat", ".ps1"} {
		if strings.HasSuffix(lower, ext) {
			return name[:len(name)-len(ext)]
		}
	}
	return name
}
