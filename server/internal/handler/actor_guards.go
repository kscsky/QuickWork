package handler

import (
	"net/http"
)

// RequireHumanActor is a chi-style middleware that rejects requests
// authenticated via a machine credential — currently mat_ task tokens.
// It exists for endpoints whose authorization model is "the human owner
// authorized this", not "anyone holding the owner's credentials
// authorized this".
//
// Why this guard is needed (read carefully — auth here is subtle):
//
// The general Auth middleware (server/internal/middleware/auth.go)
// turns each bearer format into the same shape — a stamped
// `X-User-ID` header — so downstream handlers don't have to care which
// token kind the caller used:
//
//   - JWT cookie / mul_ PAT  → X-User-ID = the human's user id.
//     X-Actor-Source is left empty.
//   - mat_ task token        → X-User-ID = the OWNING human's user id,
//     plus X-Agent-ID, X-Task-ID, and the
//     authoritative server-set header
//     `X-Actor-Source: task_token`.
//
// The mat_ design (MUL-2600) was deliberately built this way: every
// request the agent makes is treated as the owner's, so it can post
// comments, claim issues, register runtimes, etc., as if the owner had
// done it. That is correct for issue / comment / chat scopes — those
// are bounded by workspace membership and by the task binding.
//
// It is NOT correct for account-level scopes: a machine credential
// that gets compromised — by a prompt injection or a bad MCP tool —
// must not be able to act on the owner's account.
//
// `X-Actor-Source` is server-set only. The Auth middleware deletes any
// client-supplied value first (see auth.go: `r.Header.Del("X-Actor-Source")`),
// then re-sets it ONLY on the mat_ branch. So checking this header is
// the safe, fast, single-source-of-truth way to know "is the request
// from a machine credential?" — without re-querying the token table.
//
// We deliberately do NOT use h.resolveActor() here:
//
//   - resolveActor's primary job is "agent vs member" classification
//     for ownership / authorship attribution (issue creator, comment
//     author, etc.). It also has a fallback path that trusts
//     X-Agent-ID + X-Task-ID for legacy CLI flows; that fallback is
//     valid for resolving authorship but is irrelevant here. The
//     authorization decision needs the strict "machine credential →
//     forbidden" gate, nothing else.
//   - resolveActor takes a workspaceID parameter, which threads
//     irrelevant context through callers that have no workspace scope.
//
// Apply via `r.Use(handler.RequireHumanActor)` on a chi route group.
// The middleware is intentionally NOT wired in via the router's main
// Auth chain — the default contract elsewhere (issues, chat, etc.) is
// "agent and human are interchangeable", and adding a global gate
// would break legitimate agent traffic. Only attach it where the
// scope is truly human-only.
//
// To extend: any new machine-credential auth branch added to
// auth.go (e.g. a hypothetical service-account token) MUST stamp a
// distinct X-Actor-Source value AND get reviewed against this gate
// at the same time. The denylist below is intentionally explicit —
// silently passing an unknown actor source is a feature, not a bug
// (see TestRequireHumanActor_IgnoresUnknownActorSource), but the
// addition of a new value is the moment to decide whether it's
// human-equivalent or machine-equivalent.
func RequireHumanActor(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isMachineCredentialActor(r) {
			writeError(w, http.StatusForbidden, "this endpoint is only available to human actors")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// isMachineCredentialActor centralizes the authoritative actor-source check so
// sensitive handlers can keep a fail-closed backstop in addition to their
// router middleware. Unknown actor sources intentionally remain human-equivalent
// until their authentication branch is explicitly classified here.
func isMachineCredentialActor(r *http.Request) bool {
	// X-Actor-Source is server-set only. The auth middleware strips any
	// client-supplied value before stamping its own, so a recognized value here
	// is authoritative.
	switch r.Header.Get("X-Actor-Source") {
	case "task_token":
		return true
	default:
		return false
	}
}
