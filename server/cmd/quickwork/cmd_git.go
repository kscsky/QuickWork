package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
)

var gitCmd = &cobra.Command{
	Use:   "git",
	Short: "Inspect or switch the current branch of a local git repository (standalone/local mode)",
	Long: "Runs git directly against a repository on this machine (default: the current working " +
		"directory), like a git GUI does. Useful for viewing and switching the branch of a " +
		"project's local working copy without going through a daemon round-trip.",
}

var gitBranchCmd = &cobra.Command{
	Use:   "branch [path]",
	Short: "Show the current branch and list local branches",
	Args:  cobra.MaximumNArgs(1),
	RunE:  runGitBranch,
}

var gitCheckoutCmd = &cobra.Command{
	Use:   "checkout <branch> [path]",
	Short: "Switch the repository to a branch",
	Args:  cobra.RangeArgs(1, 2),
	RunE:  runGitCheckout,
}

var gitOutput string
var gitForce bool

func init() {
	gitBranchCmd.Flags().StringVar(&gitOutput, "output", "table", "Output format: table or json")
	gitCheckoutCmd.Flags().BoolVar(&gitForce, "force", false, "Switch even if the working tree has uncommitted changes")
	gitCheckoutCmd.Flags().StringVar(&gitOutput, "output", "table", "Output format: table or json")
	gitCmd.AddCommand(gitBranchCmd)
	gitCmd.AddCommand(gitCheckoutCmd)
}

// resolveGitRoot returns the top-level of the git repository at path (default:
// the current directory), or an error when the path is not inside a repo.
func resolveGitRoot(path string) (string, error) {
	if strings.TrimSpace(path) == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return "", fmt.Errorf("get working directory: %w", err)
		}
		path = cwd
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("resolve path %q: %w", path, err)
	}
	out, err := exec.Command("git", "-C", abs, "rev-parse", "--show-toplevel").Output()
	if err != nil {
		return "", fmt.Errorf("%s is not a git repository", abs)
	}
	return strings.TrimSpace(string(out)), nil
}

// gitRun runs a git subcommand in dir and returns trimmed stdout, folding stderr
// into the error on failure.
func gitRun(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git %s: %s: %w", strings.Join(args, " "), strings.TrimSpace(stderr.String()), err)
	}
	return strings.TrimSpace(string(out)), nil
}

// gitBranchState reads the current branch, dirty flag, and local branch names.
func gitBranchState(dir string) (current string, dirty bool, branches []string, err error) {
	if current, err = gitRun(dir, "rev-parse", "--abbrev-ref", "HEAD"); err != nil {
		return
	}
	porcelain, perr := gitRun(dir, "status", "--porcelain")
	if perr != nil {
		err = perr
		return
	}
	dirty = strings.TrimSpace(porcelain) != ""
	raw, ferr := gitRun(dir, "for-each-ref", "--format=%(refname:short)", "refs/heads")
	if ferr != nil {
		err = ferr
		return
	}
	for _, line := range strings.Split(raw, "\n") {
		if s := strings.TrimSpace(line); s != "" {
			branches = append(branches, s)
		}
	}
	return
}

func runGitBranch(cmd *cobra.Command, args []string) error {
	path := ""
	if len(args) > 0 {
		path = args[0]
	}
	dir, err := resolveGitRoot(path)
	if err != nil {
		return err
	}
	current, dirty, branches, err := gitBranchState(dir)
	if err != nil {
		return err
	}
	if gitOutput == "json" {
		return json.NewEncoder(os.Stdout).Encode(map[string]any{
			"repo": dir, "current": current, "dirty": dirty, "branches": branches,
		})
	}
	dirtyLabel := "no"
	if dirty {
		dirtyLabel = "yes (uncommitted changes)"
	}
	fmt.Fprintf(os.Stdout, "repo:         %s\n", dir)
	fmt.Fprintf(os.Stdout, "branch:       %s\n", current)
	fmt.Fprintf(os.Stdout, "uncommitted:  %s\n", dirtyLabel)
	fmt.Fprintln(os.Stdout, "branches:")
	for _, b := range branches {
		mark := "  "
		if b == current {
			mark = "* "
		}
		fmt.Fprintf(os.Stdout, "%s%s\n", mark, b)
	}
	return nil
}

func runGitCheckout(cmd *cobra.Command, args []string) error {
	branch := args[0]
	path := ""
	if len(args) > 1 {
		path = args[1]
	}
	dir, err := resolveGitRoot(path)
	if err != nil {
		return err
	}
	if !gitForce {
		porcelain, perr := gitRun(dir, "status", "--porcelain")
		if perr != nil {
			return perr
		}
		if strings.TrimSpace(porcelain) != "" {
			return fmt.Errorf("working tree has uncommitted changes; commit or stash first, or pass --force to switch anyway")
		}
	}
	if _, err := gitRun(dir, "checkout", branch); err != nil {
		return err
	}
	current, _ := gitRun(dir, "rev-parse", "--abbrev-ref", "HEAD")
	if gitOutput == "json" {
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"repo": dir, "current": current})
	}
	fmt.Fprintf(os.Stdout, "switched %s to branch %s\n", dir, current)
	return nil
}
