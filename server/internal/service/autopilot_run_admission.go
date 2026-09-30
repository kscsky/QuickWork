package service

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/kscsky/quickwork/server/pkg/db/generated"
)

func newAutopilotIdempotencyKey() string { return uuid.NewString() }

// NewRequestIdempotencyKey is used only when an HTTP caller omitted its key;
// the generated value scopes idempotency to that single request.
func NewRequestIdempotencyKey() string { return newAutopilotIdempotencyKey() }

func validAutopilotExecutionSource(source string) bool {
	switch source {
	case "schedule", "manual", "webhook", "api":
		return true
	default:
		return false
	}
}

// createAutopilotRun persists a new run row after asserting that the execution
// source is one the dispatcher knows how to attribute.
func (s *AutopilotService) createAutopilotRun(ctx context.Context, params db.CreateAutopilotRunParams) (db.AutopilotRun, error) {
	if !validAutopilotExecutionSource(params.Source) {
		return db.AutopilotRun{}, fmt.Errorf("invalid autopilot execution source %q", params.Source)
	}
	return s.Queries.CreateAutopilotRun(ctx, params)
}

// recoverPartialAutopilotRun flips an abandoned partial run back to a terminal
// state so its partial-unique slot is released. Reports whether this call was
// the one that changed the row.
func (s *AutopilotService) recoverPartialAutopilotRun(ctx context.Context, run db.AutopilotRun) (bool, error) {
	rows, err := s.Queries.RecoverPartialAutopilotRun(ctx, run.ID)
	return rows > 0, err
}

// FailAutopilotRunsByIssue fails the create_issue runs anchored to an issue
// that is being deleted, so run history does not outlive the issue row it
// points at.
func (s *AutopilotService) FailAutopilotRunsByIssue(ctx context.Context, issueID pgtype.UUID) error {
	_, err := s.Queries.FailAutopilotRunsByIssue(ctx, issueID)
	return err
}
