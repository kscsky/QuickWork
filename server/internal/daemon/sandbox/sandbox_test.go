package sandbox

import (
	"bytes"
	"strings"
	"testing"
)

func TestLaunchEnvironmentDerivesRemoteLayout(t *testing.T) {
	t.Setenv(EnvAPIURL, "")
	env, err := LaunchEnvironment(LaunchConfig{
		TaskID:    "task-1",
		LocalRoot: `/work/envs/task-1`,
		WorkDir:   `/work/envs/task-1/workdir`,
		APIURL:    "https://api.e2b.app",
		APIKey:    "e2b_secret",
		Template:  "claude",
	})
	if err != nil {
		t.Fatalf("LaunchEnvironment: %v", err)
	}
	if got := env[EnvWorkSubdir]; got != "workdir" {
		t.Errorf("work subdir = %q, want workdir", got)
	}
	// Per-task namespacing: two tasks on one account must not land on the same
	// path in their sandboxes.
	if got := env[EnvRemoteRoot]; got != "/home/user/quickwork-env/task-1" {
		t.Errorf("remote root = %q", got)
	}
	if env[EnvLocalRoot] != `/work/envs/task-1` {
		t.Errorf("local root = %q", env[EnvLocalRoot])
	}
}

func TestLaunchEnvironmentForwardsAllowlistAndCustomEnvOnly(t *testing.T) {
	env, err := LaunchEnvironment(LaunchConfig{
		LocalRoot: "/root/env",
		WorkDir:   "/root/env/workdir",
		Ambient: []string{
			"ANTHROPIC_API_KEY=sk-ant",
			"AWS_SECRET_ACCESS_KEY=should-not-travel",
			"PATH=/usr/bin",
			"QUICKWORK_JIRA_SECRET_KEY=nope",
		},
		CustomEnv: map[string]string{"AGENT_SPECIFIC": "yes"},
	})
	if err != nil {
		t.Fatalf("LaunchEnvironment: %v", err)
	}
	forwarded := env[EnvForward]
	if !strings.Contains(forwarded, "sk-ant") {
		t.Errorf("provider credential missing from the forwarded set: %s", forwarded)
	}
	if !strings.Contains(forwarded, "AGENT_SPECIFIC") {
		t.Errorf("agent custom_env missing from the forwarded set: %s", forwarded)
	}
	// The whole point of the allowlist: the daemon's own credentials and PATH
	// stay on this machine.
	for _, leak := range []string{"should-not-travel", "QUICKWORK_JIRA_SECRET_KEY", "PATH"} {
		if strings.Contains(forwarded, leak) {
			t.Errorf("%q reached the sandbox; the allowlist did not hold: %s", leak, forwarded)
		}
	}
}

func TestLaunchEnvironmentRejectsWorkDirOutsideRoot(t *testing.T) {
	_, err := LaunchEnvironment(LaunchConfig{
		LocalRoot: "/root/env",
		WorkDir:   "/somewhere/else",
	})
	if err == nil {
		t.Fatal("want an error for a workdir outside the root, got nil")
	}
	if !strings.Contains(err.Error(), "outside the environment root") {
		t.Errorf("err = %v", err)
	}
}

func TestParseForwardedEnv(t *testing.T) {
	if got, err := parseForwardedEnv(""); err != nil || got != nil {
		t.Errorf("empty: got %v, %v; want nil, nil", got, err)
	}
	got, err := parseForwardedEnv(`{"A":"1"}`)
	if err != nil || got["A"] != "1" {
		t.Errorf("parse: got %v, %v", got, err)
	}
	if _, err := parseForwardedEnv("not json"); err == nil {
		t.Error("want an error for malformed JSON")
	}
}

func TestRunShimRejectsMissingCommand(t *testing.T) {
	var out, errOut bytes.Buffer
	if code := RunShim(t.Context(), nil, strings.NewReader(""), &out, &errOut); code != 2 {
		t.Errorf("exit = %d, want 2", code)
	}
	if !strings.Contains(errOut.String(), "no command given") {
		t.Errorf("stderr = %q", errOut.String())
	}
}

// The shim must refuse to run without an environment rather than silently
// executing the CLI on the daemon host, which would defeat the isolation the
// task asked for.
func TestRunShimRefusesWithoutEnvironment(t *testing.T) {
	t.Setenv(EnvLocalRoot, "")
	var out, errOut bytes.Buffer
	code := RunShim(t.Context(), []string{"/bin/echo", "hi"}, strings.NewReader(""), &out, &errOut)
	if code == 0 {
		t.Fatal("exit = 0; a shim with no sandbox configuration must not report success")
	}
	if !strings.Contains(errOut.String(), EnvLocalRoot) {
		t.Errorf("stderr = %q, want it to name %s", errOut.String(), EnvLocalRoot)
	}
}
