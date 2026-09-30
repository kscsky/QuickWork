package execenv

// Archiving a prepared environment for transport.
//
// Remote execution reuses the local preparation path verbatim: the daemon runs
// Prepare exactly as it does today, then ships the result instead of handing it
// to a local subprocess. That is why this file only packs — it never decides
// what belongs in an environment, so the local and remote paths cannot drift
// apart on content, only on delivery.

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// DefaultArchiveExcludes are the subtrees a prepared environment never needs to
// carry: build outputs that the agent can regenerate and that dominate the
// payload otherwise. Callers pass these explicitly rather than getting them
// implicitly, so an exclusion is always a visible decision at the call site.
//
// .git is deliberately NOT here — the agent commits inside the sandbox, so the
// repository's history has to travel with it.
var DefaultArchiveExcludes = []string{
	"node_modules",
	".next",
	".turbo",
}

// ArchiveOptions tunes what WriteArchive ships.
type ArchiveOptions struct {
	// Exclude holds slash-separated path patterns relative to the archive
	// root. A pattern matches a path exactly or as a parent directory, so
	// "node_modules" skips the subtree at any depth while "apps/web/.next"
	// skips only that one.
	Exclude []string
}

// WriteArchive writes a gzipped tar of root into w. Paths inside the archive
// are relative to root, so extracting into a target directory reproduces the
// tree there.
//
// Modes and symlinks are preserved: a skill file that has to be executable, or
// a worktree entry that is a link, must survive the trip or the sandbox behaves
// differently from the machine the environment was built on.
//
// Caveat for a Windows daemon shipping to a Linux sandbox: NTFS has no
// executable bit, so every file arrives with whatever mode Windows reports and
// +x is lost. Nothing in the archive path can recover it — the caller has to
// restore exec bits after extraction (or the skills involved must not rely on
// them).
func WriteArchive(w io.Writer, root string, opts ArchiveOptions) error {
	info, err := os.Stat(root)
	if err != nil {
		return fmt.Errorf("archive: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("archive: %s is not a directory", root)
	}

	gz := gzip.NewWriter(w)
	tw := tar.NewWriter(gz)

	// Walk in sorted order so the same tree always produces the same archive.
	// Not a reproducibility guarantee (mtimes travel), but it makes failures
	// and diffs comparable between runs.
	var paths []string
	err = filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == root {
			return nil
		}
		rel, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return relErr
		}
		rel = filepath.ToSlash(rel)
		if excluded(rel, opts.Exclude) {
			if d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		paths = append(paths, rel)
		return nil
	})
	if err != nil {
		return fmt.Errorf("archive: walk %s: %w", root, err)
	}
	sort.Strings(paths)

	for _, rel := range paths {
		full := filepath.Join(root, filepath.FromSlash(rel))
		// Lstat, not Stat: a symlink must travel as a symlink rather than
		// being flattened into a copy of its target.
		li, err := os.Lstat(full)
		if err != nil {
			return fmt.Errorf("archive: stat %s: %w", rel, err)
		}
		hdr, err := tar.FileInfoHeader(li, "")
		if err != nil {
			return fmt.Errorf("archive: header %s: %w", rel, err)
		}
		hdr.Name = rel
		if li.IsDir() {
			// Trailing slash marks a directory entry; without it some
			// extractors create a regular file name collision.
			hdr.Name = rel + "/"
		}
		if li.Mode()&os.ModeSymlink != 0 {
			target, err := os.Readlink(full)
			if err != nil {
				return fmt.Errorf("archive: readlink %s: %w", rel, err)
			}
			hdr.Linkname = target
		}
		if err := tw.WriteHeader(hdr); err != nil {
			return fmt.Errorf("archive: write header %s: %w", rel, err)
		}
		if li.Mode().IsRegular() {
			f, err := os.Open(full)
			if err != nil {
				return fmt.Errorf("archive: open %s: %w", rel, err)
			}
			_, copyErr := io.Copy(tw, f)
			closeErr := f.Close()
			if copyErr != nil {
				return fmt.Errorf("archive: copy %s: %w", rel, copyErr)
			}
			if closeErr != nil {
				return fmt.Errorf("archive: close %s: %w", rel, closeErr)
			}
		}
	}

	if err := tw.Close(); err != nil {
		return fmt.Errorf("archive: close tar: %w", err)
	}
	if err := gz.Close(); err != nil {
		return fmt.Errorf("archive: close gzip: %w", err)
	}
	return nil
}

// excluded reports whether rel is skipped, following the convention callers
// already know from .gitignore:
//
//   - a pattern with no slash matches that name at ANY depth, so
//     "node_modules" drops every such directory in the tree;
//   - a pattern with a slash is anchored to the archive root, so
//     "apps/web/.next" drops only that one.
//
// Anchoring the bare names instead was the first implementation and it silently
// shipped nested node_modules — the exclusion looked present at the call site
// and did nothing below the top level.
func excluded(rel string, patterns []string) bool {
	trimmed := strings.Trim(strings.TrimSuffix(rel, "/"), "/")
	for _, p := range patterns {
		p = strings.Trim(strings.TrimSpace(filepath.ToSlash(p)), "/")
		if p == "" {
			continue
		}
		if !strings.Contains(p, "/") {
			for _, seg := range strings.Split(trimmed, "/") {
				if seg == p {
					return true
				}
			}
			continue
		}
		if trimmed == p || strings.HasPrefix(trimmed, p+"/") {
			return true
		}
	}
	return false
}
