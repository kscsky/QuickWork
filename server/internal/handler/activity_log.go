package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	db "github.com/kscsky/quickwork/server/pkg/db/generated"
)

// ActivityEventResponse is one key relay decision for the workspace activity
// page. Only approve / return / reassign / skip are returned; runs, comments
// and parking stay on the issue.
type ActivityEventResponse struct {
	ID         string  `json:"id"`
	IssueID    string  `json:"issue_id"`
	Identifier string  `json:"identifier"`
	IssueTitle string  `json:"issue_title"`
	ActorID    string  `json:"actor_id"`
	Action     string  `json:"action"`
	Leg        int32   `json:"leg"`
	FromUserID *string `json:"from_user_id"`
	ToUserID   *string `json:"to_user_id"`
	Reason     string  `json:"reason"`
	Admin      bool    `json:"admin"`
	CreatedAt  string  `json:"created_at"`
}

type relayActivityDetails struct {
	Leg        int32  `json:"leg"`
	FromUserID string `json:"from_user_id"`
	ToUserID   string `json:"to_user_id"`
	Reason     string `json:"reason"`
	Admin      bool   `json:"admin"`
}

// ListActivityEvents returns the workspace's relay decisions, newest first.
func (h *Handler) ListActivityEvents(w http.ResponseWriter, r *http.Request) {
	workspaceID := ctxWorkspaceID(r.Context())
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	limit := int32(100)
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			if n > 200 {
				n = 200
			}
			limit = int32(n)
		}
	}
	rows, err := h.Queries.ListRelayActivityEvents(r.Context(), db.ListRelayActivityEventsParams{
		WorkspaceID: wsUUID,
		Limit:       limit,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list activity")
		return
	}
	prefix := h.getIssuePrefix(r.Context(), wsUUID)
	resp := make([]ActivityEventResponse, 0, len(rows))
	for _, row := range rows {
		var details relayActivityDetails
		if len(row.Details) > 0 {
			_ = json.Unmarshal(row.Details, &details)
		}
		item := ActivityEventResponse{
			ID:         uuidToString(row.ID),
			IssueID:    uuidToString(row.IssueID),
			Identifier: fmt.Sprintf("%s-%d", prefix, row.IssueNumber),
			IssueTitle: row.IssueTitle,
			ActorID:    uuidToString(row.ActorID),
			Action:     row.Action,
			Leg:        details.Leg,
			Reason:     details.Reason,
			Admin:      details.Admin,
			CreatedAt:  timestampToString(row.CreatedAt),
		}
		if details.FromUserID != "" {
			item.FromUserID = &details.FromUserID
		}
		if details.ToUserID != "" {
			item.ToUserID = &details.ToUserID
		}
		resp = append(resp, item)
	}
	writeJSON(w, http.StatusOK, resp)
}
