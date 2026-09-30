package e2b

// envd is the daemon inside every sandbox: it runs commands and owns the
// filesystem. Both operations below speak to the shared gateway
// (https://sandbox.{domain}) rather than a per-sandbox hostname, identifying
// the target with headers.
//
// The contract here was reverse-engineered from E2B's own SDK and verified
// against live sandboxes — there is no public spec and no Go SDK:
//
//   - Every call carries e2b-sandbox-id, e2b-sandbox-port (49983) and
//     x-access-token (the envdAccessToken returned by Sandbox.create).
//   - Commands use Connect-RPC with the JSON codec, and STREAMING and UNARY
//     methods speak different dialects of it. Start is server-streaming:
//     `application/connect+json` with bodies enveloped as
//     [1 byte flags][4 byte big-endian length][payload], and its bytes fields
//     (stdout/stderr) arrive base64-encoded. SendInput and CloseStdin are
//     unary: a bare JSON body under `application/json`. Sending the enveloped
//     form to a unary method answers 415, which reads like an auth or selector
//     problem and cost two abandoned attempts.
//   - A running process is addressed by the pid from the start event. A tag
//     passed to StartRequest looks like a selector and is not one.
//   - File writes are a plain multipart POST, not an RPC.
//
// Going through JSON is what keeps this file small: the alternative was
// hand-writing a protobuf codec or shipping a sidecar process.

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strings"
	"sync/atomic"
	"time"
)

// envdPort is the in-sandbox port every deployment we have seen listens on.
// It travels as a header rather than in the URL because the gateway routes on
// it.
const envdPort = 49983

// connectFlagEndStream marks the trailer frame that closes a Connect stream.
const connectFlagEndStream = 0x02

// SandboxConn identifies one running sandbox for envd calls. The access token
// comes from SandboxDetail/CreateSandbox; it is per-sandbox, not the account
// API key.
type SandboxConn struct {
	SandboxID   string
	AccessToken string
}

// envdBaseURL derives the shared envd gateway from the API base:
// https://api.e2b.app -> https://sandbox.e2b.app.
//
// The rule is a prefix swap because that is the only mapping E2B publishes;
// sandboxes are addressed by header, so every deployment shares one host. A
// deployment that does not follow the convention can override with
// Client.EnvdURL.
func envdBaseURL(apiURL string) string {
	if i := strings.Index(apiURL, "//api."); i >= 0 {
		return apiURL[:i] + "//sandbox." + apiURL[i+len("//api."):]
	}
	return apiURL
}

// EnvdURL overrides the derived gateway. Set it only for deployments whose
// envd host does not follow the api. -> sandbox. convention.
func (c *Client) EnvdURL(raw string) *Client {
	c.envdURL = strings.TrimRight(raw, "/")
	return c
}

func (c *Client) envdHost() string {
	if c.envdURL != "" {
		return c.envdURL
	}
	return envdBaseURL(c.apiURL)
}

// envdHeaders are the three headers every envd call needs.
func envdHeaders(req *http.Request, conn SandboxConn) {
	req.Header.Set("e2b-sandbox-id", conn.SandboxID)
	req.Header.Set("e2b-sandbox-port", fmt.Sprintf("%d", envdPort))
	req.Header.Set("x-access-token", conn.AccessToken)
}

// WriteFile writes content to path inside the sandbox.
func (c *Client) WriteFile(ctx context.Context, conn SandboxConn, path string, content []byte) error {
	return c.WriteFileFrom(ctx, conn, path, bytes.NewReader(content))
}

// WriteFileFrom writes a stream to path inside the sandbox. The multipart field
// name is fixed at "file" and the path travels twice — in the query and as the
// part's filename — which is what the SDK does; either alone is rejected.
//
// The body streams through an io.Pipe rather than being buffered, because the
// caller that matters here ships archive-sized payloads.
func (c *Client) WriteFileFrom(ctx context.Context, conn SandboxConn, path string, content io.Reader) error {
	pr, pw := io.Pipe()
	mw := multipart.NewWriter(pw)
	contentType := mw.FormDataContentType()

	go func() {
		partHeader := textproto.MIMEHeader{}
		partHeader.Set("Content-Disposition",
			fmt.Sprintf(`form-data; name="file"; filename="%s"`, path))
		partHeader.Set("Content-Type", "application/octet-stream")
		part, err := mw.CreatePart(partHeader)
		if err == nil {
			_, err = io.Copy(part, content)
		}
		if closeErr := mw.Close(); err == nil {
			err = closeErr
		}
		// Closing with the error unblocks the request body reader, which is
		// how a failed copy surfaces instead of hanging the HTTP client.
		pw.CloseWithError(err)
	}()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.envdHost()+"/files?path="+url.QueryEscape(path), pr)
	if err != nil {
		pr.Close()
		return err
	}
	envdHeaders(req, conn)
	req.Header.Set("Content-Type", contentType)

	resp, err := c.streamClient().Do(req)
	if err != nil {
		pr.Close()
		return fmt.Errorf("envd unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		return fmt.Errorf("envd write %s: %s: %s", path, resp.Status, strings.TrimSpace(string(detail)))
	}
	return nil
}

// DownloadFile reads a file out of the sandbox. Same path as WriteFileFrom,
// just a GET; the response body is the raw bytes.
//
// The caller owns the returned reader and must close it. Read it to completion
// (or close it) before issuing another envd call on the same client if you care
// about connection reuse.
func (c *Client) DownloadFile(ctx context.Context, conn SandboxConn, path string) (io.ReadCloser, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		c.envdHost()+"/files?path="+url.QueryEscape(path), nil)
	if err != nil {
		return nil, err
	}
	envdHeaders(req, conn)

	resp, err := c.streamClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("envd unreachable: %w", err)
	}
	switch {
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		resp.Body.Close()
		return nil, ErrUnauthorized
	case resp.StatusCode == http.StatusNotFound:
		resp.Body.Close()
		return nil, ErrNotFound
	case resp.StatusCode < 200 || resp.StatusCode > 299:
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		resp.Body.Close()
		return nil, fmt.Errorf("envd read %s: %s: %s", path, resp.Status, strings.TrimSpace(string(detail)))
	}
	return resp.Body, nil
}

// UploadArchive streams a gzipped tar into the sandbox and unpacks it at dir.
// The archive is staged in the sandbox's /tmp and removed afterwards, so a
// failed extraction still leaves the caller a clean path to retry.
//
// This is how a prepared environment reaches a sandbox: WriteArchive on the
// daemon side, this on the transport side, and the two together reproduce the
// local tree at dir.
func (c *Client) UploadArchive(ctx context.Context, conn SandboxConn, dir string, archive io.Reader) error {
	staged := fmt.Sprintf("/tmp/quickwork-env-%d.tar.gz", time.Now().UnixNano())
	if err := c.WriteFileFrom(ctx, conn, staged, archive); err != nil {
		return err
	}
	script := fmt.Sprintf(
		"set -e; mkdir -p %s; tar -xzf %s -C %s; rm -f %s",
		shellQuote(dir), shellQuote(staged), shellQuote(dir), shellQuote(staged))
	res, err := c.RunCommand(ctx, conn, "/bin/bash", []string{"-c", script}, RunCommandOptions{})
	if err != nil {
		return fmt.Errorf("envd extract: %w", err)
	}
	if res.ExitCode != 0 {
		return fmt.Errorf("envd extract failed at %s: %s", dir, strings.TrimSpace(res.Stderr+res.Status))
	}
	return nil
}

// ShellQuote wraps s in single quotes for /bin/bash. Callers building scripts
// for RunCommand should use it on every interpolated value: a path that reaches
// a shell unquoted is a habit worth not forming.
func ShellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func shellQuote(s string) string { return ShellQuote(s) }

// RunCommandOptions carries everything that varies between invocations.
type RunCommandOptions struct {
	Cwd  string
	Envs map[string]string
	// Stdin, when set, is forwarded to the remote process. The process starts
	// with stdin enabled and SendInput/CloseStdin feed and terminate it.
	//
	// This is not optional for the agent CLIs: the stream-json providers run
	// with `--input-format stream-json` and receive the prompt as a JSON line
	// on stdin, so a remote run that cannot write stdin cannot start them.
	Stdin io.Reader
	// OnStdout/OnStderr, when set, observe output as it arrives. They are
	// called from the goroutine reading the stream, so they must not block.
	OnStdout func(string)
	OnStderr func(string)
}

// CommandResult is the terminal state of a command.
type CommandResult struct {
	// ExitCode is the process's exit status. A zero is indistinguishable from
	// an absent field on the wire — proto3 omits zero values for `sint32
	// exit_code = 1`, and the sandbox sends no field at all for a clean exit —
	// so an absent code decodes as 0 here, which is what it means. A non-zero
	// exit always arrives explicitly. Use Status for the human-readable form.
	ExitCode int
	Status   string
	Stdout   string
	Stderr   string
}

// startRequest is the JSON form of process.StartRequest. Field names follow
// protobuf's JSON mapping (lowerCamelCase); the proto definition is
// StartRequest { ProcessConfig process = 1; bool stdin = 4; } and
// ProcessConfig { string cmd = 1; repeated string args = 2; map envs = 3;
// string cwd = 4; }.
type startRequest struct {
	Process startProcessConfig `json:"process"`
	// Stdin opens the process's input. Proto3 omits false, so a run without
	// stdin sends the same bytes it always did.
	Stdin bool `json:"stdin,omitempty"`
}

type startProcessConfig struct {
	Cmd  string            `json:"cmd"`
	Args []string          `json:"args"`
	Envs map[string]string `json:"envs,omitempty"`
	Cwd  string            `json:"cwd,omitempty"`
}

// startResponse is one streamed process.ProcessEvent. Only the fields this
// client consumes are modelled; unknown ones are ignored, which is what keeps
// this file from having to track every event type E2B adds.
type startResponse struct {
	Event *processEvent `json:"event,omitempty"`
	// Error is the Connect trailer's failure body, present on the final frame
	// when the RPC itself failed (as opposed to the command exiting non-zero).
	Error *connectError `json:"error,omitempty"`
}

type processEvent struct {
	// Start carries the pid that SendInput and CloseStdin address. There is no
	// other handle on a running process: a tag passed to StartRequest is not a
	// usable selector (measured — calls against it are silent no-ops).
	Start *struct {
		PID uint32 `json:"pid,omitempty"`
	} `json:"start,omitempty"`
	Data *struct {
		// Base64: these are protobuf `bytes` fields.
		Stdout string `json:"stdout,omitempty"`
		Stderr string `json:"stderr,omitempty"`
	} `json:"data,omitempty"`
	End *struct {
		ExitCode *int   `json:"exitCode,omitempty"`
		Exited   bool   `json:"exited,omitempty"`
		Status   string `json:"status,omitempty"`
		Error    string `json:"error,omitempty"`
	} `json:"end,omitempty"`
}

type connectError struct {
	Code    string `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}

// RunCommand starts cmd inside the sandbox and streams its output until it
// exits. The whole run is bounded by ctx; cancelling closes the response body,
// which the gateway turns into a process kill.
func (c *Client) RunCommand(
	ctx context.Context,
	conn SandboxConn,
	cmd string,
	args []string,
	opts RunCommandOptions,
) (CommandResult, error) {
	payload, err := json.Marshal(startRequest{
		Process: startProcessConfig{Cmd: cmd, Args: args, Envs: opts.Envs, Cwd: opts.Cwd},
		Stdin:   opts.Stdin != nil,
	})
	if err != nil {
		return CommandResult{}, err
	}

	var body bytes.Buffer
	if err := writeConnectFrame(&body, 0, payload); err != nil {
		return CommandResult{}, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.envdHost()+"/process.Process/Start", &body)
	if err != nil {
		return CommandResult{}, err
	}
	envdHeaders(req, conn)
	req.Header.Set("Content-Type", "application/connect+json")
	req.Header.Set("Accept", "application/connect+json")

	// The default client timeout would cap a long agent run. The caller's ctx
	// is the only bound that should apply here.
	resp, err := c.streamClient().Do(req)
	if err != nil {
		return CommandResult{}, fmt.Errorf("envd start: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return CommandResult{}, ErrUnauthorized
	}
	if resp.StatusCode != http.StatusOK {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		return CommandResult{}, fmt.Errorf("envd start: %s: %s", resp.Status, strings.TrimSpace(string(detail)))
	}

	var stdin StdinPump
	if opts.Stdin != nil {
		reader := opts.Stdin
		stdin = func(pumpCtx context.Context, pid uint32) error {
			return c.pumpStdin(pumpCtx, conn, pid, reader)
		}
	}
	var out CommandResult
	var pumpErr atomic.Value
	out, err = readCommandStream(ctx, resp.Body, opts, stdin, &pumpErr)
	if v := pumpErr.Load(); v != nil {
		// Surfaced rather than swallowed: a failed stdin pump is the
		// difference between "the command chose to exit" and "the command
		// never received its input", and those look identical in the output.
		out.Stderr += "\n[quickwork] stdin delivery failed: " + v.(error).Error()
	}
	return out, err
}

// StdinPump feeds a remote process's stdin. readCommandStream calls it once the
// sandbox reports the process is up, passing the pid that addresses it.
type StdinPump func(ctx context.Context, pid uint32) error

// pumpStdin forwards r into a running process's stdin and then closes it.
//
// Both halves are required and each was learned the hard way:
//
//   - CloseStdin is not tidiness. Every CLI reads until EOF, so a run that
//     only sends data blocks until its own timeout kills it.
//   - Both calls address the process by the pid from the start event. A tag
//     passed to StartRequest looks like a selector but is not one.
//
// The calls go through envdCall, which speaks Connect's UNARY protocol. Sending
// the enveloped streaming protocol here is what produced "415 Unsupported Media
// Type" and, once that was tolerated silently, runs that hung.
func (c *Client) pumpStdin(ctx context.Context, conn SandboxConn, pid uint32, r io.Reader) error {
	buf := make([]byte, 32<<10)
	for {
		n, readErr := r.Read(buf)
		if n > 0 {
			// ProcessInput.stdin is protobuf `bytes`, so base64 on the wire.
			if err := c.envdCall(ctx, conn, "SendInput", map[string]any{
				"process": map[string]any{"pid": pid},
				"input":   map[string]any{"stdin": base64.StdEncoding.EncodeToString(buf[:n])},
			}); err != nil {
				return err
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	return c.envdCall(ctx, conn, "CloseStdin", map[string]any{
		"process": map[string]any{"pid": pid},
	})
}

// envdCall issues one UNARY Connect RPC.
//
// Unary and streaming are different protocols on the wire, and mixing them
// fails in a way that reads like an auth or selector problem: a bare JSON body
// with `application/json` is what the unary methods accept, while
// `application/connect+json` plus [flags][length] framing — correct for
// Start — is rejected here with 415.
func (c *Client) envdCall(ctx context.Context, conn SandboxConn, method string, body any) error {
	encoded, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.envdHost()+"/process.Process/"+method, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	envdHeaders(req, conn)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.streamClient().Do(req)
	if err != nil {
		return fmt.Errorf("envd %s: %w", method, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("envd %s: %s: %s", method, resp.Status, strings.TrimSpace(string(raw)))
	}
	return nil
}

// RunCommandOptions carries everything that varies between invocations.
func readCommandStream(
	ctx context.Context,
	r io.Reader,
	opts RunCommandOptions,
	stdin StdinPump,
	pumpErr *atomic.Value,
) (CommandResult, error) {
	reader := bufio.NewReader(r)
	var out CommandResult
	var stdout, stderr strings.Builder

	for {
		flags, payload, err := readConnectFrame(reader)
		if errors.Is(err, io.EOF) {
			return out, nil
		}
		if err != nil {
			return out, err
		}
		if flags&connectFlagEndStream != 0 {
			// Trailer: either an empty object or an error body.
			var trailer startResponse
			if len(bytes.TrimSpace(payload)) > 0 {
				if jsonErr := json.Unmarshal(payload, &trailer); jsonErr == nil && trailer.Error != nil {
					return out, fmt.Errorf("envd: %s: %s", trailer.Error.Code, trailer.Error.Message)
				}
			}
			return out, nil
		}

		var msg startResponse
		if err := json.Unmarshal(payload, &msg); err != nil {
			// A frame we cannot read is not worth failing the whole run for;
			// the transcript is a best-effort view.
			continue
		}
		if msg.Event == nil {
			continue
		}
		if msg.Event.Start != nil && stdin != nil {
			// The process is up, so its pid is addressable. Detach from the
			// stream context: the pump outlives individual frames, and the
			// caller's cancellation must still let it close stdin so the
			// remote process can exit instead of waiting for its own timeout.
			pump, pid := stdin, msg.Event.Start.PID
			stdin = nil
			go func() {
				if err := pump(context.WithoutCancel(ctx), pid); err != nil {
					pumpErr.Store(err)
				}
			}()
		}
		if d := msg.Event.Data; d != nil {
			if d.Stdout != "" {
				if chunk, decErr := base64.StdEncoding.DecodeString(d.Stdout); decErr == nil {
					stdout.Write(chunk)
					if opts.OnStdout != nil {
						opts.OnStdout(string(chunk))
					}
				}
			}
			if d.Stderr != "" {
				if chunk, decErr := base64.StdEncoding.DecodeString(d.Stderr); decErr == nil {
					stderr.Write(chunk)
					if opts.OnStderr != nil {
						opts.OnStderr(string(chunk))
					}
				}
			}
		}
		if e := msg.Event.End; e != nil {
			if e.ExitCode != nil {
				out.ExitCode = *e.ExitCode
			}
			out.Status = e.Status
			if e.Error != "" && out.Status == "" {
				out.Status = e.Error
			}
			out.Stdout = stdout.String()
			out.Stderr = stderr.String()
			return out, nil
		}
	}
}

// writeConnectFrame emits one enveloped message.
func writeConnectFrame(w io.Writer, flags byte, payload []byte) error {
	header := make([]byte, 5)
	header[0] = flags
	binary.BigEndian.PutUint32(header[1:], uint32(len(payload)))
	if _, err := w.Write(header); err != nil {
		return err
	}
	_, err := w.Write(payload)
	return err
}

// readConnectFrame reads one enveloped message. io.EOF means the stream ended
// cleanly between frames.
func readConnectFrame(r *bufio.Reader) (byte, []byte, error) {
	header := make([]byte, 5)
	if _, err := io.ReadFull(r, header); err != nil {
		return 0, nil, err
	}
	length := binary.BigEndian.Uint32(header[1:])
	// Guard against a corrupt length turning into a huge allocation.
	if length > 8<<20 {
		return 0, nil, fmt.Errorf("connect frame too large: %d bytes", length)
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(r, payload); err != nil {
		return 0, nil, err
	}
	return header[0], payload, nil
}
