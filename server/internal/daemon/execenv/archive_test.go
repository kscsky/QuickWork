package execenv

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"testing"
)

// readArchive unpacks a WriteArchive payload into name -> entry, so assertions
// can talk about the tree rather than the byte stream.
type entry struct {
	body  string
	mode  int64
	link  string
	isDir bool
}

func readArchive(t *testing.T, raw []byte) map[string]entry {
	t.Helper()
	gz, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("gzip.NewReader: %v", err)
	}
	out := map[string]entry{}
	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("tar.Next: %v", err)
		}
		e := entry{mode: hdr.Mode, link: hdr.Linkname, isDir: hdr.Typeflag == tar.TypeDir}
		if hdr.Typeflag == tar.TypeReg {
			body, readErr := io.ReadAll(tr)
			if readErr != nil {
				t.Fatalf("read %s: %v", hdr.Name, readErr)
			}
			e.body = string(body)
		}
		out[hdr.Name] = e
	}
	return out
}

func writeFixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	mustWrite := func(rel, body string, mode os.FileMode) {
		full := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), mode); err != nil {
			t.Fatal(err)
		}
	}
	mustWrite("CLAUDE.md", "# managed block\n", 0o644)
	mustWrite("workdir/main.go", "package main\n", 0o644)
	mustWrite("skills/probe/run.sh", "#!/bin/sh\necho hi\n", 0o755)
	mustWrite("node_modules/dep/index.js", "module.exports={}\n", 0o644)
	mustWrite("apps/web/.next/build.json", "{}", 0o644)
	return root
}

func TestWriteArchivePreservesTree(t *testing.T) {
	root := writeFixture(t)
	var buf bytes.Buffer
	if err := WriteArchive(&buf, root, ArchiveOptions{Exclude: DefaultArchiveExcludes}); err != nil {
		t.Fatalf("WriteArchive: %v", err)
	}
	got := readArchive(t, buf.Bytes())

	for _, want := range []string{"CLAUDE.md", "workdir/main.go", "skills/probe/run.sh", "skills/probe/", "workdir/"} {
		if _, ok := got[want]; !ok {
			t.Errorf("archive is missing %q (has %v)", want, keys(got))
		}
	}
	if got["CLAUDE.md"].body != "# managed block\n" {
		t.Errorf("CLAUDE.md body = %q", got["CLAUDE.md"].body)
	}
	// The exec bit is the reason this preserves modes at all: a skill script
	// that arrives non-executable fails in the sandbox but not locally. Not
	// assertable on Windows, where the filesystem has no such bit to round-trip
	// — see the caveat on WriteArchive.
	if runtime.GOOS != "windows" && got["skills/probe/run.sh"].mode&0o111 == 0 {
		t.Errorf("run.sh mode = %o, want the executable bit set", got["skills/probe/run.sh"].mode)
	}
}

func TestWriteArchiveHonoursExcludes(t *testing.T) {
	root := writeFixture(t)
	var buf bytes.Buffer
	if err := WriteArchive(&buf, root, ArchiveOptions{Exclude: DefaultArchiveExcludes}); err != nil {
		t.Fatalf("WriteArchive: %v", err)
	}
	got := readArchive(t, buf.Bytes())

	for _, unwanted := range []string{"node_modules/dep/index.js", "apps/web/.next/build.json"} {
		if _, ok := got[unwanted]; ok {
			t.Errorf("archive contains %q, which the exclude list should have dropped", unwanted)
		}
	}
	// A nested exclude must not take its parent with it.
	if _, ok := got["apps/web/"]; !ok {
		t.Error("excluding apps/web/.next also dropped apps/web/")
	}
}

func TestWriteArchiveKeepsSymlinksAsLinks(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("creating symlinks on Windows needs privileges this suite does not assume")
	}
	root := writeFixture(t)
	target := filepath.Join(root, "CLAUDE.md")
	link := filepath.Join(root, "CLAUDE.link")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlink unsupported here: %v", err)
	}

	var buf bytes.Buffer
	if err := WriteArchive(&buf, root, ArchiveOptions{}); err != nil {
		t.Fatalf("WriteArchive: %v", err)
	}
	got := readArchive(t, buf.Bytes())

	e, ok := got["CLAUDE.link"]
	if !ok {
		t.Fatalf("symlink missing from archive (has %v)", keys(got))
	}
	if e.link != target {
		t.Errorf("link target = %q, want %q (it must not be flattened to a copy)", e.link, target)
	}
	if e.body != "" {
		t.Errorf("symlink carried %d bytes of content; it should be a link entry", len(e.body))
	}
}

func TestWriteArchiveRejectsNonDirectory(t *testing.T) {
	f := filepath.Join(t.TempDir(), "file.txt")
	if err := os.WriteFile(f, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := WriteArchive(&buf, f, ArchiveOptions{}); err == nil {
		t.Fatal("want an error for a non-directory root, got nil")
	}
}

func TestExcludedMatching(t *testing.T) {
	cases := []struct {
		rel      string
		patterns []string
		want     bool
	}{
		// A bare name matches at any depth...
		{"node_modules", []string{"node_modules"}, true},
		{"node_modules/dep/x.js", []string{"node_modules"}, true},
		{"apps/web/node_modules", []string{"node_modules"}, true},
		{"packages/core/node_modules/dep", []string{"node_modules"}, true},
		{"apps/web/.next", []string{".next"}, true},
		// ...without swallowing lookalikes.
		{"my_node_modules", []string{"node_modules"}, false},
		{".nextjs", []string{".next"}, false},
		// A pattern with a slash is anchored to the root.
		{"apps/web/.next", []string{"apps/web/.next"}, true},
		{"apps/web/.next/cache", []string{"apps/web/.next"}, true},
		{"apps/web", []string{"apps/web/.next"}, false},
		{"other/apps/web/.next", []string{"apps/web/.next"}, false},
		{"anything", nil, false},
		{"anything", []string{"  ", "/"}, false},
	}
	for _, tc := range cases {
		if got := excluded(tc.rel, tc.patterns); got != tc.want {
			t.Errorf("excluded(%q, %v) = %v, want %v", tc.rel, tc.patterns, got, tc.want)
		}
	}
}

func keys(m map[string]entry) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
