// Package sandbox runs a task's agent CLI inside an E2B sandbox instead of on
// the daemon host.
//
// The integration point is deliberately a process shim rather than a new
// agent.Backend. The backends own the protocol with each CLI — argv shape, the
// stream-json channel, exit-code handling, process-group teardown — and none of
// that changes just because the process runs somewhere else. Making the sandbox
// look like a local process means claude.go and its siblings need no
// modification and no second copy of their parsers.
//
// Wiring: the daemon points Config.ExecutablePath at the quickwork binary and
// Config.LaunchPrefix at [ShimArg, <real CLI path>], so the argv a backend
// builds for `claude --flag ...` becomes
//
//	quickwork __multica_sandbox_exec claude --flag ...
//
// and this file is what runs.
package sandbox

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/kscsky/quickwork/server/pkg/e2b"
)

// ShimArg selects the private shim mode in the quickwork binary. Naming follows
// execenv.PreparationHelperArg: a double-underscore argument no user types.
const ShimArg = "__multica_sandbox_exec"

// Environment variables the daemon sets on the shimmed process.
const (
	// EnvAPIURL and EnvAPIKey are the workspace's E2B account, used by
	// startSession to create the sandbox this process runs in.
	EnvAPIURL = "QUICKWORK_SANDBOX_API_URL"
	EnvAPIKey = "QUICKWORK_SANDBOX_API_KEY"
	// EnvForward is a JSON object of the variables to set on the remote
	// process. It is explicit rather than "forward everything" because the
	// shim inherits the daemon's whole environment — buildEnv merges
	// os.Environ() into every agent launch — and copying that into a sandbox
	// would hand it the host's credentials, which is the exposure the sandbox
	// exists to prevent.
	EnvForward = "QUICKWORK_SANDBOX_ENV"
)

// RunShim runs one command inside the sandbox described by the environment and
// returns the process exit code.
//
// stdout and stderr are streamed as they arrive rather than buffered until the
// end: the backends parse stdout incrementally and the transcript UI renders it
// live, both of which a buffer-until-exit shim would silently break.
func RunShim(ctx context.Context, args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintf(stderr, "%s: no command given\n", ShimArg)
		return 2
	}

	// The sandbox is created here, not by the daemon: the shim is spawned once
	// per backend.Execute, so it owns the whole lifecycle — including teardown
	// on every exit path below.
	sess, err := startSession(ctx)
	if err != nil {
		fmt.Fprintf(stderr, "%s: %v\n", ShimArg, err)
		return 1
	}
	// Collect the run's commits, then destroy the sandbox. Deferred so a
	// failed or aborted run tears down exactly like a successful one.
	defer sess.finish(ctx)

	envs, err := parseForwardedEnv(os.Getenv(EnvForward))
	if err != nil {
		fmt.Fprintf(stderr, "%s: %s is not valid JSON: %v\n", ShimArg, EnvForward, err)
		return 2
	}

	// Any argument naming a local file is meaningless remotely; ship those
	// files and point the arguments at their sandbox copies.
	remoteArgs, err := sess.rewriteFileArgs(ctx, args[1:])
	if err != nil {
		fmt.Fprintf(stderr, "%s: %v\n", ShimArg, err)
		return 1
	}

	res, err := sess.client.RunCommand(ctx, sess.conn, args[0], remoteArgs, e2b.RunCommandOptions{
		Cwd:      sess.workdir,
		Envs:     envs,
		Stdin:    stdin,
		OnStdout: func(s string) { _, _ = io.WriteString(stdout, s) },
		OnStderr: func(s string) { _, _ = io.WriteString(stderr, s) },
	})
	if err != nil {
		// Exit 1 rather than the remote code: the command never ran, and a
		// zero would read as success to every caller.
		fmt.Fprintf(stderr, "%s: %v\n", ShimArg, err)
		return 1
	}
	// Output is not repeated here: the callbacks above streamed every byte as
	// it arrived, and res.Stdout/res.Stderr are the same bytes buffered.
	return res.ExitCode
}

// parseForwardedEnv reads the JSON object of variables to set remotely. An
// empty value means "forward nothing", which is the correct reading of an
// unset variable.
func parseForwardedEnv(raw string) (map[string]string, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var out map[string]string
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil, err
	}
	return out, nil
}
