package e2b

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListSandboxesSendsAPIKeyHeader(t *testing.T) {
	var gotKey, gotAuth, gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotKey = r.Header.Get("x-api-key")
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`[{"sandbox_id":"sbx_1","template_id":"tpl_1","state":"running","cpu_count":2,"memory_mb":512}]`))
	}))
	defer srv.Close()

	boxes, err := NewClient(srv.URL, "e2b_test_key").ListSandboxes(context.Background())
	if err != nil {
		t.Fatalf("ListSandboxes: %v", err)
	}
	// The real API rejects Bearer; a regression to the SDK's codegen default
	// would only show up as a 401 in production, so pin the header here.
	if gotKey != "e2b_test_key" {
		t.Errorf("x-api-key = %q, want the configured key", gotKey)
	}
	if gotAuth != "" {
		t.Errorf("Authorization = %q, want it unset", gotAuth)
	}
	if gotPath != "/v2/sandboxes" {
		t.Errorf("path = %q, want /v2/sandboxes", gotPath)
	}
	if len(boxes) != 1 || boxes[0].SandboxID != "sbx_1" || boxes[0].CPUCount != 2 {
		t.Errorf("parsed sandboxes = %+v, want one sbx_1 with 2 cpus", boxes)
	}
}

func TestListSandboxesEmptyIsNotAnError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`[]`))
	}))
	defer srv.Close()

	boxes, err := NewClient(srv.URL, "k").ListSandboxes(context.Background())
	if err != nil {
		t.Fatalf("ListSandboxes on an empty account: %v", err)
	}
	if len(boxes) != 0 {
		t.Errorf("got %d sandboxes, want 0", len(boxes))
	}
}

func TestListSandboxesUnauthorized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"code":401,"message":"Invalid auth provider token."}`))
	}))
	defer srv.Close()

	_, err := NewClient(srv.URL, "bad").ListSandboxes(context.Background())
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("err = %v, want ErrUnauthorized", err)
	}
}

func TestListSandboxesMalformedBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"not":"an array"}`))
	}))
	defer srv.Close()

	_, err := NewClient(srv.URL, "k").ListSandboxes(context.Background())
	if err == nil {
		t.Fatal("want an error for a non-array body, got nil")
	}
}

func TestListSandboxesUnreachable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	url := srv.URL
	srv.Close()

	_, err := NewClient(url, "k").ListSandboxes(context.Background())
	if err == nil {
		t.Fatal("want an error for a closed server, got nil")
	}
	if errors.Is(err, ErrUnauthorized) {
		t.Errorf("unreachable host must not classify as unauthorized: %v", err)
	}
}

func TestNormalizeAPIURL(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
		ok   bool
	}{
		{"empty falls back to the public cloud", "", DefaultAPIURL, true},
		{"blank falls back too", "   ", DefaultAPIURL, true},
		{"trailing slash is trimmed", "https://api.e2b.app/", "https://api.e2b.app", true},
		{"self-hosted http is allowed", "http://e2b.internal:8080", "http://e2b.internal:8080", true},
		{"no scheme", "api.e2b.app", "", false},
		{"wrong scheme", "ftp://api.e2b.app", "", false},
		{"no host", "https://", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := NormalizeAPIURL(tc.in)
			if tc.ok && err != nil {
				t.Fatalf("NormalizeAPIURL(%q) errored: %v", tc.in, err)
			}
			if !tc.ok {
				if err == nil {
					t.Fatalf("NormalizeAPIURL(%q) succeeded, want an error", tc.in)
				}
				return
			}
			if got != tc.want {
				t.Errorf("NormalizeAPIURL(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}
