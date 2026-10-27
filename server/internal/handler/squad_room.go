package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/kscsky/quickwork/server/internal/util"
	db "github.com/kscsky/quickwork/server/pkg/db/generated"
	"github.com/kscsky/quickwork/server/pkg/protocol"
)

// The squad room: a squad's message stream, plus the per-member switch that
// decides whether work handed to the room may run on that member's agents.
//
// This is the part of a squad that behaves like a group chat rather than like
// a dispatch list. Membership is the existing `squad_member` row; identity is
// whatever the person registered under, resolved by the client from the user
// record — the room itself stores only who spoke and what they said.

const (
	squadRoomDefaultLimit = 80
	squadRoomMaxLimit     = 200
	squadRoomMaxBodyLen   = 8000
)

type SquadMessageResponse struct {
	ID         string `json:"id"`
	SquadID    string `json:"squad_id"`
	AuthorType string `json:"author_type"`
	// Absent for `system` entries, which are the room narrating itself.
	AuthorID  string         `json:"author_id,omitempty"`
	Body      string         `json:"body"`
	Kind      string         `json:"kind"`
	Metadata  map[string]any `json:"metadata"`
	CreatedAt string         `json:"created_at"`
}

type SquadRoomResponse struct {
	Messages []SquadMessageResponse `json:"messages"`
	// More rows exist past this page. The room loads the newest page only; a
	// client that wants older ones asks again with a larger limit rather than
	// tracking a cursor, because the room is not a paged archive.
	HasMore bool `json:"has_more"`
}

func squadMessageToResponse(m db.SquadMessage) SquadMessageResponse {
	meta := map[string]any{}
	if len(m.Metadata) > 0 {
		// A malformed blob is not worth failing a page of the room over: the
		// message is still readable without its decoration.
		_ = json.Unmarshal(m.Metadata, &meta)
	}
	out := SquadMessageResponse{
		ID:         uuidToString(m.ID),
		SquadID:    uuidToString(m.SquadID),
		AuthorType: m.AuthorType,
		Body:       m.Body,
		Kind:       m.Kind,
		Metadata:   meta,
		CreatedAt:  timestampToString(m.CreatedAt),
	}
	if m.AuthorID.Valid {
		out.AuthorID = uuidToString(m.AuthorID)
	}
	return out
}

// ListSquadMessages returns the newest page of a room, oldest-first.
//
// Any workspace member may read: the room is a workspace-scoped surface and a
// squad is not a private channel — its whole point is that the work is visible
// to the people who might pick it up.
func (h *Handler) ListSquadMessages(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	if _, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found"); !ok {
		return
	}
	squad, _, ok := h.loadSquadInWorkspace(w, r)
	if !ok {
		return
	}

	limit := squadRoomDefaultLimit
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			limit = n
			if limit > squadRoomMaxLimit {
				limit = squadRoomMaxLimit
			}
		}
	}

	// One extra row is the cheapest "is there more" answer there is.
	rows, err := h.Queries.ListSquadMessages(r.Context(), db.ListSquadMessagesParams{
		SquadID: squad.ID,
		Limit:   int32(limit) + 1,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load squad messages")
		return
	}

	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}

	// The query walks newest-first to use the index; the room reads the other
	// way round.
	out := make([]SquadMessageResponse, 0, len(rows))
	for i := len(rows) - 1; i >= 0; i-- {
		out = append(out, squadMessageToResponse(rows[i]))
	}
	writeJSON(w, http.StatusOK, SquadRoomResponse{Messages: out, HasMore: hasMore})
}

// CreateSquadMessage posts a line into a room as the calling user.
//
// Only people in the room may speak in it: being able to read a workspace does
// not make you a participant. Admins and the squad's creator can also post,
// which is what lets a workspace owner answer a question about a room they
// have not joined.
func (h *Handler) CreateSquadMessage(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	member, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found")
	if !ok {
		return
	}
	squad, _, ok := h.loadSquadInWorkspace(w, r)
	if !ok {
		return
	}

	userID := requestUserID(r)
	userUUID, ok := parseUUIDOrBadRequest(w, userID, "user_id")
	if !ok {
		return
	}

	if !canManageSquad(member, squad) {
		inRoom, err := h.Queries.IsSquadMember(r.Context(), db.IsSquadMemberParams{
			SquadID:    squad.ID,
			MemberType: "member",
			MemberID:   userUUID,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to check squad membership")
			return
		}
		if !inRoom {
			writeError(w, http.StatusForbidden, "join the squad before posting in its room")
			return
		}
	}

	var req struct {
		Body     string         `json:"body"`
		Kind     string         `json:"kind"`
		Metadata map[string]any `json:"metadata"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Body == "" {
		writeError(w, http.StatusBadRequest, "body is required")
		return
	}
	if len(req.Body) > squadRoomMaxBodyLen {
		writeError(w, http.StatusBadRequest, "body is too long")
		return
	}
	kind := req.Kind
	if kind == "" {
		kind = "text"
	}

	meta := req.Metadata
	if meta == nil {
		meta = map[string]any{}
	}
	rawMeta, err := json.Marshal(meta)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid metadata")
		return
	}

	msg, err := h.Queries.CreateSquadMessage(r.Context(), db.CreateSquadMessageParams{
		SquadID:    squad.ID,
		AuthorType: "member",
		AuthorID:   userUUID,
		Body:       req.Body,
		Kind:       kind,
		Metadata:   rawMeta,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to post message")
		return
	}

	h.notifySquadMessageInbox(r.Context(), workspaceID, squad, userUUID, req.Body)

	resp := squadMessageToResponse(msg)
	h.publish(protocol.EventSquadMessageCreated, workspaceID, "member", userID, map[string]any{
		"squad_id": uuidToString(squad.ID),
		"message":  resp,
	})
	writeJSON(w, http.StatusCreated, resp)
}

// UpdateSquadMemberWork flips whether work handed to the room may run on a
// member's agents.
//
// Separate from the role endpoint because the two are independent: role is what
// someone decides in the room, this is whether their machine is available. A
// member who goes away for the afternoon switches this off and keeps their role.
func (h *Handler) UpdateSquadMemberWork(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	member, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found")
	if !ok {
		return
	}
	squad, _, ok := h.loadSquadInWorkspace(w, r)
	if !ok {
		return
	}
	if !canManageSquad(member, squad) {
		writeError(w, http.StatusForbidden, "insufficient permissions")
		return
	}

	var req struct {
		MemberType     string `json:"member_type"`
		MemberID       string `json:"member_id"`
		CanReceiveWork *bool  `json:"can_receive_work"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.CanReceiveWork == nil {
		writeError(w, http.StatusBadRequest, "can_receive_work is required")
		return
	}
	memberUUID, ok := parseUUIDOrBadRequest(w, req.MemberID, "member_id")
	if !ok {
		return
	}

	sm, err := h.Queries.UpdateSquadMemberWork(r.Context(), db.UpdateSquadMemberWorkParams{
		SquadID:        squad.ID,
		MemberType:     req.MemberType,
		MemberID:       memberUUID,
		CanReceiveWork: *req.CanReceiveWork,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "squad member not found")
		return
	}

	h.publish(protocol.EventSquadUpdated, workspaceID, "member", requestUserID(r), map[string]any{
		"squad_id": uuidToString(squad.ID),
	})
	writeJSON(w, http.StatusOK, squadMemberToResponse(sm))
}

// notifySquadMessageInbox fans a human room message out to every other human
// member as a chat notification. Best-effort: a notification failure must not
// fail the message the author already sent. Agent rows are skipped (they do
// not have inboxes) and the author never notifies themselves.
func (h *Handler) notifySquadMessageInbox(
	ctx context.Context,
	workspaceID string,
	squad db.Squad,
	authorID pgtype.UUID,
	body string,
) {
	wsUUID, err := util.ParseUUID(workspaceID)
	if err != nil {
		return
	}
	members, err := h.Queries.ListSquadMembers(ctx, squad.ID)
	if err != nil {
		slog.Error("squad room: list members for inbox failed",
			"squad_id", uuidToString(squad.ID), "error", err)
		return
	}
	authorName := "成员"
	if author, err := h.Queries.GetUser(ctx, authorID); err == nil && author.Name != "" {
		authorName = author.Name
	}
	details, err := json.Marshal(map[string]any{
		"squad_id":   uuidToString(squad.ID),
		"squad_name": squad.Name,
	})
	if err != nil {
		return
	}
	title := fmt.Sprintf("%s 在小队「%s」发了消息", authorName, squad.Name)
	author := uuidToString(authorID)
	for _, member := range members {
		if member.MemberType != "member" {
			continue
		}
		recipient := uuidToString(member.MemberID)
		if recipient == "" || recipient == author {
			continue
		}
		item, err := h.Queries.CreateInboxItem(ctx, db.CreateInboxItemParams{
			WorkspaceID:   wsUUID,
			RecipientType: "member",
			RecipientID:   member.MemberID,
			Type:          "squad_message",
			Severity:      "info",
			IssueID:       pgtype.UUID{},
			Title:         title,
			Body:          pgtype.Text{String: body, Valid: true},
			ActorType:     pgtype.Text{String: "member", Valid: true},
			ActorID:       authorID,
			Details:       details,
		})
		if err != nil {
			slog.Error("squad room: inbox write failed",
				"squad_id", uuidToString(squad.ID),
				"recipient_id", recipient,
				"error", err)
			continue
		}
		h.publish(protocol.EventInboxNew, workspaceID, "member", author, map[string]any{
			"item": inboxItemEventPayload(item),
		})
	}
}

// PostSystemSquadMessage writes a room entry nobody authored — membership
// changes and handoff notices the room narrates for itself.
//
// Exported for the relay: a cross-zone handoff is the room's most important
// event, and it is not "said" by the person whose card triggered it.
func (h *Handler) PostSystemSquadMessage(ctx context.Context, squadID pgtype.UUID, body, kind string, metadata map[string]any) error {
	rawMeta, err := json.Marshal(metadata)
	if err != nil {
		rawMeta = []byte("{}")
	}
	_, err = h.Queries.CreateSquadMessage(ctx, db.CreateSquadMessageParams{
		SquadID:    squadID,
		AuthorType: "system",
		AuthorID:   pgtype.UUID{},
		Body:       body,
		Kind:       kind,
		Metadata:   rawMeta,
	})
	return err
}

// resolveLentAgent validates the agent a member offers to the room.
//
// A person may only lend their OWN agent — the whole point of the field is that
// each member decides what they bring, and letting one member attach another's
// agent would make the roster a claim about someone else's machine. Agents are
// their own member kind and are not lent, so an agent row passes through
// unchanged.
//
// An empty id is valid and means "brings none": a member without an agent is a
// normal participant, not an error.
func (h *Handler) resolveLentAgent(
	w http.ResponseWriter,
	r *http.Request,
	memberType string,
	memberID pgtype.UUID,
	agentID string,
) (pgtype.UUID, bool) {
	if agentID == "" {
		return pgtype.UUID{}, true
	}
	agentUUID, ok := parseUUIDOrBadRequest(w, agentID, "agent_id")
	if !ok {
		return pgtype.UUID{}, false
	}
	if memberType != "member" {
		return agentUUID, true
	}
	agent, err := h.Queries.GetAgent(r.Context(), agentUUID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "agent not found")
		return pgtype.UUID{}, false
	}
	if uuidToString(agent.OwnerID) != uuidToString(memberID) {
		writeError(w, http.StatusForbidden, "a member can only lend an agent they own")
		return pgtype.UUID{}, false
	}
	return agentUUID, true
}

// UpdateSquadMemberAgent sets which of their agents a member lends to the room.
//
// When the member leads, the squad's routing agent follows: `squad.leader_id` is
// what the briefing and the task dispatcher read, and it has to agree with the
// person's own choice rather than drifting from it. Both writes happen here
// because this is the only place either one changes.
func (h *Handler) UpdateSquadMemberAgent(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	member, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found")
	if !ok {
		return
	}
	squad, _, ok := h.loadSquadInWorkspace(w, r)
	if !ok {
		return
	}

	var req struct {
		MemberType string `json:"member_type"`
		MemberID   string `json:"member_id"`
		AgentID    string `json:"agent_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	memberUUID, ok := parseUUIDOrBadRequest(w, req.MemberID, "member_id")
	if !ok {
		return
	}

	// Members may set their own; managers may set anyone's.
	userID := requestUserID(r)
	isSelf := req.MemberType == "member" && uuidToString(memberUUID) == userID
	if !isSelf && !canManageSquad(member, squad) {
		writeError(w, http.StatusForbidden, "insufficient permissions")
		return
	}

	lentAgent, ok := h.resolveLentAgent(w, r, req.MemberType, memberUUID, req.AgentID)
	if !ok {
		return
	}

	sm, err := h.Queries.UpdateSquadMemberAgent(r.Context(), db.UpdateSquadMemberAgentParams{
		SquadID:    squad.ID,
		MemberType: req.MemberType,
		MemberID:   memberUUID,
		AgentID:    lentAgent,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "squad member not found")
		return
	}

	if sm.Role == "leader" && lentAgent.Valid {
		// Only the routing agent is written: UpdateSquad coalesces on NULL, so
		// the untouched fields keep what they already hold instead of being
		// rewritten from a copy read before the update.
		if _, err := h.Queries.UpdateSquad(r.Context(), db.UpdateSquadParams{
			ID:       squad.ID,
			LeaderID: lentAgent,
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to route the squad's work")
			return
		}
	}

	// Relays parked on this person were parked by the missing binding, so the
	// binding is what unparkes them: their steps start on their own instead of
	// waiting for someone to notice the obstacle is gone. Best effort — the
	// binding is committed, and a resume that failed must not undo it.
	if req.MemberType == "member" && lentAgent.Valid && h.TaskService != nil {
		h.TaskService.ResumeParkedChain(r.Context(), h.Queries, squad.ID, memberUUID, lentAgent)
	}

	h.publish(protocol.EventSquadUpdated, workspaceID, "member", userID, map[string]any{
		"squad_id": uuidToString(squad.ID),
	})
	writeJSON(w, http.StatusOK, squadMemberToResponse(sm))
}
