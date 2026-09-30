package e2b

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"io"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

// frame builds one Connect envelope, so the tests can speak the wire format
// rather than the helpers under test.
func frame(flags byte, payload string) []byte {
	out := make([]byte, 5)
	out[0] = flags
	binary.BigEndian.PutUint32(out[1:], uint32(len(payload)))
	return append(out, payload...)
}

func TestConnectFrameRoundTrip(t *testing.T) {
	var buf bytes.Buffer
	if err := writeConnectFrame(&buf, 0, []byte(`{"a":1}`)); err != nil {
		t.Fatalf("writeConnectFrame: %v", err)
	}
	flags, payload, err := readConnectFrame(bufio.NewReader(&buf))
	if err != nil {
		t.Fatalf("readConnectFrame: %v", err)
	}
	if flags != 0 {
		t.Errorf("flags = %d, want 0", flags)
	}
	if string(payload) != `{"a":1}` {
		t.Errorf("payload = %q", payload)
	}
}

func TestReadConnectFrameRejectsOversizedLength(t *testing.T) {
	raw := make([]byte, 5)
	binary.BigEndian.PutUint32(raw[1:], 64<<20)
	_, _, err := readConnectFrame(bufio.NewReader(bytes.NewReader(raw)))
	if err == nil {
		t.Fatal("want an error for a 64 MiB frame header, got nil")
	}
	if !strings.Contains(err.Error(), "too large") {
		t.Errorf("err = %v, want a size complaint", err)
	}
}

// runCommandServer stands in for the envd gateway. It asserts the transport
// details (headers, media type, framing) and replays a canned stream, because
// those details are exactly what the reverse-engineered contract consists of.
func runCommandServer(t *testing.T, stream []byte, wantEvents ...string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/process.Process/Start" {
			t.Errorf("path = %q, want /process.Process/Start", r.URL.Path)
		}
		if got := r.Header.Get("Content-Type"); got != "application/connect+json" {
			t.Errorf("Content-Type = %q, want application/connect+json", got)
		}
		for header, want := range map[string]string{
			"e2b-sandbox-id":   "sbx_test",
			"e2b-sandbox-port": "49983",
			"x-access-token":   "tok_test",
		} {
			if got := r.Header.Get(header); got != want {
				t.Errorf("%s = %q, want %q", header, got, want)
			}
		}

		body, _ := io.ReadAll(r.Body)
		flags, payload, err := readConnectFrame(bufio.NewReader(bytes.NewReader(body)))
		if err != nil {
			t.Fatalf("request body is not one framed message: %v", err)
		}
		if flags != 0 {
			t.Errorf("request flags = %d, want 0", flags)
		}
		var req startRequest
		if err := json.Unmarshal(payload, &req); err != nil {
			t.Fatalf("request payload is not JSON: %v", err)
		}
		if req.Process.Cmd != "echo" || len(req.Process.Args) != 1 || req.Process.Args[0] != "hi" {
			t.Errorf("decoded command = %+v, want echo hi", req.Process)
		}
		for _, want := range wantEvents {
			if !strings.Contains(string(payload), want) {
				t.Errorf("request payload %s does not contain %q", payload, want)
			}
		}

		w.Header().Set("Content-Type", "application/connect+json")
		w.Write(stream)
	}))
}

func TestRunCommandStreamsOutputAndExit(t *testing.T) {
	enc := func(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }
	stream := bytes.Join([][]byte{
		frame(0, `{"event":{"start":{"pid":42}}}`),
		frame(0, `{"event":{"data":{"stdout":"`+enc("hello ")+`"}}}`),
		frame(0, `{"event":{"data":{"stdout":"`+enc("world\n")+`"}}}`),
		frame(0, `{"event":{"data":{"stderr":"`+enc("warn\n")+`"}}}`),
		frame(0, `{"event":{"end":{"exited":true,"status":"exit status 0"}}}`),
		frame(connectFlagEndStream, `{}`),
	}, nil)

	srv := runCommandServer(t, stream, `"cwd":"/code"`, `"PROBE":"1"`)
	defer srv.Close()

	var streamed []string
	res, err := NewClient(srv.URL, "k").RunCommand(
		context.Background(),
		SandboxConn{SandboxID: "sbx_test", AccessToken: "tok_test"},
		"echo", []string{"hi"},
		RunCommandOptions{Cwd: "/code", Envs: map[string]string{"PROBE": "1"},
			OnStdout: func(s string) { streamed = append(streamed, s) }},
	)
	if err != nil {
		t.Fatalf("RunCommand: %v", err)
	}
	if res.Stdout != "hello world\n" {
		t.Errorf("stdout = %q, want %q", res.Stdout, "hello world\n")
	}
	if res.Stderr != "warn\n" {
		t.Errorf("stderr = %q, want %q", res.Stderr, "warn\n")
	}
	if len(streamed) != 2 {
		t.Errorf("OnStdout fired %d times, want 2 (it must observe chunks, not the final buffer)", len(streamed))
	}
	// A clean exit omits exitCode entirely: proto3 drops zero values and the
	// field is not `optional`. Absent therefore means 0, not "unknown".
	if res.ExitCode != 0 {
		t.Errorf("ExitCode = %d, want 0 when the end event omits it", res.ExitCode)
	}
	if res.Status != "exit status 0" {
		t.Errorf("Status = %q", res.Status)
	}
}

func TestRunCommandReportsNonZeroExit(t *testing.T) {
	const code = 3
	stream := bytes.Join([][]byte{
		frame(0, `{"event":{"end":{"exited":true,"exitCode":`+strconv.Itoa(code)+`}}}`),
		frame(connectFlagEndStream, `{}`),
	}, nil)

	srv := runCommandServer(t, stream)
	defer srv.Close()

	res, err := NewClient(srv.URL, "k").RunCommand(
		context.Background(),
		SandboxConn{SandboxID: "sbx_test", AccessToken: "tok_test"},
		"echo", []string{"hi"}, RunCommandOptions{},
	)
	if err != nil {
		t.Fatalf("RunCommand: %v", err)
	}
	if res.ExitCode != code {
		t.Errorf("ExitCode = %d, want %d", res.ExitCode, code)
	}
}

func TestRunCommandSurfacesConnectError(t *testing.T) {
	stream := frame(connectFlagEndStream,
		`{"error":{"code":"invalid_argument","message":"protocol error: bad frame"}}`)
	srv := runCommandServer(t, stream)
	defer srv.Close()

	_, err := NewClient(srv.URL, "k").RunCommand(
		context.Background(),
		SandboxConn{SandboxID: "sbx_test", AccessToken: "tok_test"},
		"echo", []string{"hi"}, RunCommandOptions{},
	)
	if err == nil {
		t.Fatal("want an error for an error trailer, got nil")
	}
	if !strings.Contains(err.Error(), "protocol error") {
		t.Errorf("err = %v, want the sandbox's message", err)
	}
}

func TestRunCommandUnauthorized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	_, err := NewClient(srv.URL, "k").RunCommand(
		context.Background(),
		SandboxConn{SandboxID: "sbx_test", AccessToken: "expired"},
		"echo", []string{"hi"}, RunCommandOptions{},
	)
	if err == nil || !strings.Contains(err.Error(), "rejected") {
		t.Fatalf("err = %v, want ErrUnauthorized", err)
	}
}

func TestWriteFilePostsMultipart(t *testing.T) {
	var gotPath, gotFilename, gotContent string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Query().Get("path")
		if r.Header.Get("e2b-sandbox-id") != "sbx_test" {
			t.Errorf("sandbox id header missing")
		}
		mr, err := r.MultipartReader()
		if err != nil {
			t.Fatalf("not multipart: %v", err)
		}
		part, err := mr.NextPart()
		if err != nil {
			t.Fatalf("no part: %v", err)
		}
		// Read the raw header, not part.FileName(): the multipart reader runs
		// that through filepath.Base, which would hide whether we sent the
		// full path. The gateway needs the path in the filename field.
		gotFilename = part.Header.Get("Content-Disposition")
		content, _ := io.ReadAll(part)
		gotContent = string(content)
	}))
	defer srv.Close()

	err := NewClient(srv.URL, "k").WriteFile(
		context.Background(),
		SandboxConn{SandboxID: "sbx_test", AccessToken: "tok_test"},
		"/code/CLAUDE.md", []byte("# hello\n"),
	)
	if err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	if gotPath != "/code/CLAUDE.md" {
		t.Errorf("path query = %q", gotPath)
	}
	if !strings.Contains(gotFilename, `filename="/code/CLAUDE.md"`) {
		t.Errorf("Content-Disposition = %q, want the full path as the filename", gotFilename)
	}
	if gotContent != "# hello\n" {
		t.Errorf("content = %q", gotContent)
	}
}

func TestEnvdBaseURLDerivation(t *testing.T) {
	cases := map[string]string{
		"https://api.e2b.app":        "https://sandbox.e2b.app",
		"https://api.e2b.dev":        "https://sandbox.e2b.dev",
		"http://127.0.0.1:8080":      "http://127.0.0.1:8080",
		"https://selfhosted.example": "https://selfhosted.example",
	}
	for in, want := range cases {
		if got := envdBaseURL(in); got != want {
			t.Errorf("envdBaseURL(%q) = %q, want %q", in, got, want)
		}
	}
}

// uploadArchiveServer captures a multipart upload and answers the extraction
// command, so UploadArchive can be exercised without a sandbox.
func uploadArchiveServer(t *testing.T, captured *bytes.Buffer, extracted *string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/files":
			if got := r.URL.Query().Get("path"); !strings.HasPrefix(got, "/tmp/quickwork-env-") {
				t.Errorf("staged path = %q, want a /tmp/quickwork-env-* file", got)
			}
			mr, err := r.MultipartReader()
			if err != nil {
				t.Fatalf("not multipart: %v", err)
			}
			part, err := mr.NextPart()
			if err != nil {
				t.Fatalf("no part: %v", err)
			}
			if _, err := io.Copy(captured, part); err != nil {
				t.Fatalf("capture: %v", err)
			}
			w.WriteHeader(http.StatusOK)
		case r.Method == http.MethodPost && r.URL.Path == "/process.Process/Start":
			body, _ := io.ReadAll(r.Body)
			_, payload, _ := readConnectFrame(bufio.NewReader(bytes.NewReader(body)))
			var req startRequest
			_ = json.Unmarshal(payload, &req)
			if len(req.Process.Args) == 0 {
				t.Errorf("extract command was empty")
			}
			*extracted = req.Process.Args[len(req.Process.Args)-1]
			w.Header().Set("Content-Type", "application/connect+json")
			w.Write(frame(0, `{"event":{"end":{"exited":true,"status":"exit status 0"}}}`))
			w.Write(frame(connectFlagEndStream, `{}`))
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

// gzipBytes makes an incompressible payload of roughly n bytes, so the upload
// path is forced through the pipe rather than a single short write.
//
// Incompressible on purpose: repeating a string gzips a megabyte into a
// kilobyte, which would quietly turn a streaming test back into a small-write
// test. The generator is seeded so failures are reproducible.
func gzipBytes(t *testing.T, n int) []byte {
	t.Helper()
	raw := make([]byte, n)
	rnd := rand.New(rand.NewSource(20260929))
	if _, err := rnd.Read(raw); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err := gz.Write(raw); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestUploadArchiveStreamsAndExtracts(t *testing.T) {
	archive := gzipBytes(t, 400_000)
	if len(archive) < 100_000 {
		t.Fatalf("fixture is only %d bytes; too small to exercise streaming", len(archive))
	}

	var captured bytes.Buffer
	var extractedCmd string
	srv := uploadArchiveServer(t, &captured, &extractedCmd)
	defer srv.Close()

	err := NewClient(srv.URL, "k").UploadArchive(
		context.Background(),
		SandboxConn{SandboxID: "sbx_test", AccessToken: "tok_test"},
		"/code", bytes.NewReader(archive),
	)
	if err != nil {
		t.Fatalf("UploadArchive: %v", err)
	}
	if !strings.Contains(extractedCmd, "tar -xzf") || !strings.Contains(extractedCmd, "'/code'") {
		t.Errorf("extract command = %q", extractedCmd)
	}
	if captured.Len() != len(archive) {
		t.Errorf("uploaded %d bytes, sent %d — the stream was truncated", captured.Len(), len(archive))
	}
	if !bytes.Equal(captured.Bytes(), archive) {
		t.Error("uploaded bytes differ from the archive; the pipe path corrupted the payload")
	}
}

func TestUploadArchiveSurfacesExtractFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/files") {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.Header().Set("Content-Type", "application/connect+json")
		w.Write(frame(0, `{"event":{"end":{"exited":true,"exitCode":2,"status":"exit status 2"}}}`))
		w.Write(frame(connectFlagEndStream, `{}`))
	}))
	defer srv.Close()

	err := NewClient(srv.URL, "k").UploadArchive(
		context.Background(),
		SandboxConn{SandboxID: "sbx_test", AccessToken: "tok_test"},
		"/code", bytes.NewReader(gzipBytes(t, 64)),
	)
	if err == nil {
		t.Fatal("want an error when tar exits non-zero, got nil")
	}
	if !strings.Contains(err.Error(), "extract failed") {
		t.Errorf("err = %v, want an extract-failed message", err)
	}
}

// fakeEnvdStdin stands in for a sandbox that reports a process and then
// accepts stdin. It asserts the protocol shape that cost two failed attempts:
// SendInput and CloseStdin are UNARY calls — bare JSON with
// application/json — addressed by the pid from the start event.
func fakeEnvdStdin(t *testing.T) (*httptest.Server, *[]string) {
	t.Helper()
	var got []string
	closed := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/process.Process/Start":
			body, _ := io.ReadAll(r.Body)
			flags, payload, err := readConnectFrame(bufio.NewReader(bytes.NewReader(body)))
			if err != nil || flags != 0 {
				t.Errorf("Start request is not one framed message: %v", err)
			}
			var req startRequest
			if err := json.Unmarshal(payload, &req); err != nil {
				t.Fatalf("Start payload: %v", err)
			}
			if !req.Stdin {
				t.Error("Start was sent without stdin:true; the sandbox will not open the process's input")
			}

			w.Header().Set("Content-Type", "application/connect+json")
			w.WriteHeader(http.StatusOK)
			w.Write(frame(0, `{"event":{"start":{"pid":42}}}`))
			w.(http.Flusher).Flush()
			// Hold the stream open until the client closes stdin, the way a
			// real process exits only after EOF.
			<-closed
			w.Write(frame(0, `{"event":{"end":{"exited":true,"status":"exit status 0"}}}`))
			w.Write(frame(connectFlagEndStream, `{}`))

		case "/process.Process/SendInput", "/process.Process/CloseStdin":
			// The regression this guards: these are unary, so the body must be
			// bare JSON. An enveloped body was rejected with 415, and the run
			// then hung with no diagnostic.
			if ct := r.Header.Get("Content-Type"); ct != "application/json" {
				t.Errorf("%s Content-Type = %q, want application/json (unary methods do not take the enveloped protocol)",
					r.URL.Path, ct)
			}
			raw, _ := io.ReadAll(r.Body)
			if len(raw) > 0 && raw[0] == 0 {
				t.Errorf("%s body starts with a frame header; it must be bare JSON", r.URL.Path)
			}
			var unary map[string]map[string]any
			if err := json.Unmarshal(raw, &unary); err != nil {
				t.Fatalf("%s body is not JSON: %v (%q)", r.URL.Path, err, raw)
			}
			if pid, _ := unary["process"]["pid"].(float64); pid != 42 {
				t.Errorf("%s addressed pid %v, want 42 — the pid comes from the start event", r.URL.Path, unary["process"]["pid"])
			}
			if r.URL.Path == "/process.Process/SendInput" {
				got = append(got, unary["input"]["stdin"].(string))
			} else {
				close(closed)
			}
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{}`))

		default:
			t.Errorf("unexpected request %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	return srv, &got
}

func TestRunCommandStdinIsUnaryAndAddressedByPid(t *testing.T) {
	srv, sent := fakeEnvdStdin(t)
	defer srv.Close()

	payload := strings.Repeat("x", 40<<10) // spans more than one SendInput
	res, err := NewClient(srv.URL, "k").RunCommand(
		context.Background(),
		SandboxConn{SandboxID: "sbx_test", AccessToken: "tok_test"},
		"/bin/bash", []string{"-c", "cat"},
		RunCommandOptions{Stdin: strings.NewReader(payload)},
	)
	if err != nil {
		t.Fatalf("RunCommand: %v", err)
	}
	if res.ExitCode != 0 {
		t.Errorf("exit = %d, want 0", res.ExitCode)
	}
	if res.Stderr != "" {
		t.Errorf("stderr = %q, want empty (a failed pump would say so here)", res.Stderr)
	}
	if len(*sent) < 2 {
		t.Fatalf("SendInput called %d times; %d bytes should not fit in one chunk", len(*sent), len(payload))
	}
	var decoded []byte
	for _, chunk := range *sent {
		raw, err := base64.StdEncoding.DecodeString(chunk)
		if err != nil {
			t.Fatalf("stdin chunk is not base64: %v", err)
		}
		decoded = append(decoded, raw...)
	}
	if string(decoded) != payload {
		t.Errorf("reassembled stdin is %d bytes, want %d", len(decoded), len(payload))
	}
}
