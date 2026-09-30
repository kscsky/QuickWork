import io

def patch(path, subs):
    with io.open(path, encoding='utf-8', newline='') as f:
        s = f.read()
    orig = s
    for old, new in subs:
        if old not in s:
            print("MISS %s: %r" % (path, old[:110]))
            continue
        s = s.replace(old, new, 1)
    if s != orig:
        with io.open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(s)
        print("OK  ", path)

patch('cmd/quickwork/cmd_auth.go', [
 ("""// loginTokenPrefixes are the token prefixes `quickwork login --token` accepts.
// The CLI used to hardcode `mul_` only, which made it impossible to log in
// with a QuickWork Cloud Node PAT (`mcn_`) even though the server happily
// authenticates both kinds. Keep this list in sync with the prefix branches
// in server/internal/middleware/auth.go.
var loginTokenPrefixes = []string{"mul_", auth.CloudPATPrefix}""",
  """// loginTokenPrefixes are the token prefixes `quickwork login --token` accepts.
// Keep this list in sync with the prefix branches in
// server/internal/middleware/auth.go.
var loginTokenPrefixes = []string{"mul_"}"""),
])

patch('cmd/quickwork/cmd_login.go', [
 ("""	loginCmd.Flags().String("token", "", "Authenticate using a personal access token (mul_... user PAT or mcn_... Cloud Node PAT). Pass --token mul_... / --token mcn_... to supply it inline, or --token alone to be prompted interactively.")
	// NoOptDefVal lets `--token` (no value) keep its old prompt-mode behavior
	// while `--token mul_...` / `--token mcn_...` and the `=value` form
	// consume the value normally.""",
  """	loginCmd.Flags().String("token", "", "Authenticate using a personal access token (mul_...). Pass --token mul_... to supply it inline, or --token alone to be prompted interactively.")
	// NoOptDefVal lets `--token` (no value) keep its old prompt-mode behavior
	// while `--token mul_...` and the `=value` form consume the value normally."""),
])

patch('internal/handler/invitation.go', [
 ("\t_, err := h.Queries.ExpireStalePendingInvitations(r.Context(), db.ExpireStalePendingInvitationsParams{",
  "\t_, err = h.Queries.ExpireStalePendingInvitations(r.Context(), db.ExpireStalePendingInvitationsParams{"),
 ("\t\tID: uuidToPG(invitationID), WorkspaceID: requester.WorkspaceID, InviterID: requester.UserID,",
  "\t\tID: pgtype.UUID{Bytes: invitationID, Valid: true}, WorkspaceID: requester.WorkspaceID, InviterID: requester.UserID,"),
])

patch('internal/handler/onboarding_shim.go', [
 ("\tissueCountPolicy := service.ResolveIssueCountPolicy(r.Context(), h.Entitlements, wsUUID)\n", ""),
])

patch('internal/handler/workspace_revoke.go', [
 ("""	if h.seatCapacityEnabled() {
		if err := enqueueMemberCapacityRelease(ctx, qtx, uuid.UUID(workspaceID.Bytes), uuid.UUID(memberID.Bytes)); err != nil {
			return empty, err
		}
	}
""", ""),
])

patch('internal/handler/autopilot_webhook.go', [
 ('\t"github.com/kscsky/quickwork/server/internal/service"\n', ''),
])

patch('internal/handler/webhook_delivery_worker.go', [
 ('\t"github.com/kscsky/quickwork/server/internal/service"\n', ''),
])

patch('internal/handler/share_link.go', [
 ('\t"github.com/google/uuid"\n', ''),
])
