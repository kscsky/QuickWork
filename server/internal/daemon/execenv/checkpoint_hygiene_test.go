package execenv

import (
	"errors"
	"strings"
	"testing"
)

func TestGitCommandErrorPrefersFatalOverWarningFlood(t *testing.T) {
	out := "warning: in the working copy of 'a.tsx', LF will be replaced by CRLF\n" +
		strings.Repeat("warning: in the working copy of 'b.tsx', LF will be replaced by CRLF\n", 200) +
		"fatal: unable to write 104386-file index: out of memory"
	err := errors.New("exit status 1")
	got := gitCommandError("git add", out, err).Error()
	if !strings.Contains(got, "fatal: unable to write") {
		t.Fatalf("fatal line lost: %s", got)
	}
	if strings.Count(got, "warning:") > 0 {
		t.Fatalf("warning noise leaked into error: %s", got)
	}
	if !strings.HasPrefix(got, "git add: ") || !strings.HasSuffix(got, "exit status 1") {
		t.Fatalf("envelope broken: %s", got)
	}
}

func TestGitCommandErrorSkipsWarningsToLastRealLine(t *testing.T) {
	out := "warning: x\nsome raw failure detail without prefix\nwarning: y"
	got := gitCommandError("git commit", out, errors.New("exit status 1")).Error()
	if !strings.Contains(got, "some raw failure detail") {
		t.Fatalf("fallback line lost: %s", got)
	}
	if strings.Contains(got, "warning:") {
		t.Fatalf("warning should not be the head when a real line exists: %s", got)
	}
}

func TestGitCommandErrorHeadsUpOutputWithoutAnyLine(t *testing.T) {
	// The incident shape: exit 1 with ONLY advisory noise in the output.
	out := strings.Repeat("warning: LF will be replaced by CRLF in .pnpm-store/v10/files/00/f403bca1d5\n", 50)
	got := gitCommandError("git add", out, errors.New("exit status 1")).Error()
	if strings.Contains(got, "f403bca1d5") {
		t.Fatalf("hex blob path must not survive into the error (classifier fuel): %s", got)
	}
	if len(got) > 300 {
		t.Fatalf("error not bounded: %d chars", len(got))
	}
}

func TestGitCommandErrorEmptyOutput(t *testing.T) {
	got := gitCommandError("git add", "", errors.New("exit status 128")).Error()
	if got != "git add: exit status 128" {
		t.Fatalf("empty-output envelope wrong: %q", got)
	}
}

func TestCountNonEmptyLines(t *testing.T) {
	if n := countNonEmptyLines("a\n\nb\n  \nc\n"); n != 3 {
		t.Fatalf("count = %d, want 3", n)
	}
	if n := countNonEmptyLines("   \n\n"); n != 0 {
		t.Fatalf("blank-only count = %d, want 0", n)
	}
}
