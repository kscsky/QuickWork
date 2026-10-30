package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/kscsky/quickwork/server/internal/issuestatus"
	"github.com/kscsky/quickwork/server/internal/knowledge"
	"github.com/kscsky/quickwork/server/internal/util"
	db "github.com/kscsky/quickwork/server/pkg/db/generated"
)

// The knowledge base distils a finished relay into two things: one summary
// document, and FAQ entries that later legs can retrieve. Composition is
// deterministic — it reads the handoff packages the holders already approved —
// so the memory cannot invent facts an agent never handed over. An entry is
// embedded once, under the embedding profile chosen when it was deposited:
// its model and dimension are part of the entry's identity, and retrieval
// never compares vectors from different corpora.

const (
	KnowledgeKindSummary = "summary"
	KnowledgeKindFAQ     = "faq"

	KnowledgeStatusDraft     = "draft"
	KnowledgeStatusPublished = "published"
	KnowledgeStatusArchived  = "archived"

	KnowledgeSourceSummary      = "relay_summary"
	KnowledgeSourceHandoff      = "handoff"
	KnowledgeSourceOpenQuestion = "open_question"
	KnowledgeSourceSoloSummary  = "solo_summary"
	KnowledgeSourceSoloResult   = "solo_result"
	KnowledgeSourceManual       = "manual"

	KnowledgeSourceRelay = "relay"
	KnowledgeSourceSolo  = "solo"
)

var (
	ErrKnowledgeNoChain        = errors.New("this task has no relay to distil")
	ErrKnowledgeTaskNotDone    = errors.New("the relay is not finished yet")
	ErrKnowledgeEmptySelection = errors.New("select at least one knowledge entry")
	ErrKnowledgeEntryNotFound  = errors.New("knowledge entry not found")
)

// KnowledgeEntryPreview is one entry the deposit dialog can include.
type KnowledgeEntryPreview struct {
	Key        string   `json:"key"`
	Kind       string   `json:"kind"`
	Title      string   `json:"title"`
	Body       string   `json:"body"`
	Tags       []string `json:"tags"`
	SourceLeg  int32    `json:"source_leg"`
	SourceKind string   `json:"source_kind"`
}

// KnowledgePreview is the composed summary document and its FAQ drafts.
type KnowledgePreview struct {
	Summary            string                  `json:"summary"`
	Source             string                  `json:"source"` // "relay" | "solo"
	Entries            []KnowledgeEntryPreview `json:"entries"`
	EmbeddingEnabled   bool                    `json:"embedding_enabled"`
	EmbeddingProfileID string                  `json:"embedding_profile_id"`
	EmbeddingProvider  string                  `json:"embedding_provider"`
	EmbeddingModel     string                  `json:"embedding_model"`
	EmbeddingDims      int                     `json:"embedding_dims"`
}

// KnowledgeEntryStamp is the dimension stamp copied from the embedding row.
// A nil stamp means the entry is published but not indexed (keyword only).
type KnowledgeEntryStamp struct {
	ProfileID pgtype.UUID
	Model     string
	Dims      int32
}

type KnowledgeEntryRecord struct {
	Entry db.KnowledgeEntry
	Stamp *KnowledgeEntryStamp
}

type KnowledgeHit struct {
	Entry KnowledgeEntryRecord
	Score float64
}

type KnowledgeProfileRef struct {
	ID       string `json:"id"`
	Provider string `json:"provider"`
	Model    string `json:"model"`
	Dims     int    `json:"dims"`
}

type KnowledgeSearch struct {
	Hits    []KnowledgeHit
	Mode    string // "vector" | "keyword"
	Profile *KnowledgeProfileRef
}

type KnowledgeEmbeddingStatus struct {
	Enabled   bool
	ProfileID string
	Provider  string
	Model     string
	Dims      int
}

type KnowledgeService struct {
	Queries  *db.Queries
	Embedder knowledge.Embedder
	Profiles *EmbeddingProfileService
}

func NewKnowledgeService(q *db.Queries, embedder knowledge.Embedder) *KnowledgeService {
	return &KnowledgeService{Queries: q, Embedder: embedder}
}

// EmbeddingStatus reports the corpus new deposits would join: the active
// workspace profile, or the legacy environment embedder when a deployment
// still relies on one.
func (s *KnowledgeService) EmbeddingStatus(ctx context.Context, wsID pgtype.UUID) KnowledgeEmbeddingStatus {
	row, resolved, err := s.embeddingTarget(ctx, wsID, pgtype.UUID{})
	if err != nil {
		slog.Warn("knowledge embedding status unavailable",
			"workspace_id", util.UUIDToString(wsID), "error", err)
	}
	if row != nil {
		return KnowledgeEmbeddingStatus{
			Enabled:   resolved != nil,
			ProfileID: util.UUIDToString(row.ID),
			Provider:  row.Provider,
			Model:     row.Model,
			Dims:      int(row.Dims),
		}
	}
	if resolved != nil {
		return KnowledgeEmbeddingStatus{
			Enabled:  true,
			Provider: "env",
			Model:    resolved.Model,
			Dims:     resolved.Dims,
		}
	}
	return KnowledgeEmbeddingStatus{Dims: knowledge.ColumnDims}
}

// embeddingTarget resolves the requested profile (or the active one) into a
// row and a ready embedder. A broken key leaves the row in place but returns a
// nil embedder: the page can still show the corpus and fall back to keyword.
func (s *KnowledgeService) embeddingTarget(
	ctx context.Context,
	wsID, requested pgtype.UUID,
) (*db.WorkspaceEmbeddingProfile, *ResolvedEmbedding, error) {
	if s.Profiles != nil {
		var row db.WorkspaceEmbeddingProfile
		var err error
		if requested.Valid {
			row, err = s.Profiles.Get(ctx, wsID, requested)
		} else {
			row, err = s.Profiles.Active(ctx, wsID)
			if errors.Is(err, ErrEmbeddingProfileNotFound) {
				err = nil
			}
		}
		if err != nil {
			return nil, nil, err
		}
		if row.ID.Valid {
			resolved, resolveErr := s.Profiles.Resolve(ctx, wsID, row.ID)
			if resolveErr != nil {
				slog.Warn("embedding profile could not be decrypted",
					"profile_id", util.UUIDToString(row.ID), "error", resolveErr)
				return &row, nil, nil
			}
			return &row, resolved, nil
		}
		if requested.Valid {
			return nil, nil, ErrEmbeddingProfileNotFound
		}
	}
	if s.Embedder != nil {
		return nil, &ResolvedEmbedding{
			Model:    s.Embedder.Model(),
			Dims:     s.Embedder.Dims(),
			Embedder: s.Embedder,
		}, nil
	}
	return nil, nil, nil
}

// ComposeTaskKnowledge builds the summary document and the FAQ drafts from the
// relay's own approved handoffs. It refuses tasks whose chain has not finished:
// half a relay is not a lesson yet.
func (s *KnowledgeService) ComposeTaskKnowledge(ctx context.Context, issue db.Issue) (*KnowledgePreview, error) {
	steps, err := s.Queries.ListIssueChainSteps(ctx, issue.ID)
	if err != nil {
		return nil, err
	}
	if len(steps) == 0 {
		return s.composeSoloKnowledge(ctx, issue)
	}
	for _, step := range steps {
		if step.State != ChainStateDone && step.State != ChainStateSkipped {
			return nil, ErrKnowledgeTaskNotDone
		}
	}
	ws, err := s.Queries.GetWorkspace(ctx, issue.WorkspaceID)
	if err != nil {
		return nil, err
	}
	identifier := IssueIdentifier(ws.IssuePrefix, issue.Number)
	holderNames := map[string]string{}
	if members, err := s.Queries.ListMembersWithUser(ctx, issue.WorkspaceID); err == nil {
		for _, member := range members {
			holderNames[util.UUIDToString(member.UserID)] = member.UserName
		}
	}

	var summary strings.Builder
	fmt.Fprintf(&summary, "# %s · %s\n\n", identifier, issue.Title)
	doneAt := ""
	for i := len(steps) - 1; i >= 0; i-- {
		if steps[i].CompletedAt.Valid {
			doneAt = steps[i].CompletedAt.Time.Format("2006-01-02")
			break
		}
	}
	if doneAt == "" {
		doneAt = issue.UpdatedAt.Time.Format("2006-01-02")
	}
	skipped := 0
	for _, step := range steps {
		if step.State == ChainStateSkipped {
			skipped++
		}
	}
	fmt.Fprintf(&summary, "> 来自 QuickWork 接力记录 · %d 棒 · 完成于 %s", len(steps), doneAt)
	if skipped > 0 {
		fmt.Fprintf(&summary, "（其中跳过 %d 棒）", skipped)
	}
	summary.WriteString("\n\n## 目标\n\n")
	if desc := strings.TrimSpace(issue.Description.String); desc != "" {
		summary.WriteString(desc)
	} else {
		summary.WriteString("（任务没有写描述。）")
	}
	summary.WriteString("\n\n## 路线\n\n")
	for _, step := range steps {
		holder := holderNames[util.UUIDToString(step.HolderUserID)]
		if holder == "" {
			holder = "未知成员"
		}
		state := step.State
		switch step.State {
		case ChainStateDone:
			state = "完成"
		case ChainStateSkipped:
			state = "跳过"
		}
		title := strings.TrimSpace(step.Title)
		if title == "" {
			title = fmt.Sprintf("第 %d 棒", step.Position+1)
		}
		fmt.Fprintf(&summary, "%d. **%s** · %s — %s\n", step.Position+1, title, holder, state)
	}

	entries := make([]KnowledgeEntryPreview, 0, len(steps)+1)
	for _, step := range steps {
		var pkg ChainHandoffPackage
		if len(step.HandoffPackage) > 0 {
			_ = json.Unmarshal(step.HandoffPackage, &pkg)
		}
		handoffSummary := strings.TrimSpace(step.HandoffSummary)
		if handoffSummary == "" && len(pkg.Acceptance) == 0 {
			continue
		}
		legTitle := strings.TrimSpace(step.Title)
		if legTitle == "" {
			legTitle = fmt.Sprintf("第 %d 棒", step.Position+1)
		}
		summary.WriteString("\n## 第 ")
		summary.WriteString(strconv.Itoa(int(step.Position + 1)))
		summary.WriteString(" 棒 · ")
		summary.WriteString(legTitle)
		summary.WriteString("\n\n")
		if handoffSummary != "" {
			summary.WriteString(handoffSummary)
			summary.WriteString("\n\n")
		}
		if len(pkg.Acceptance) > 0 {
			summary.WriteString("**验收**\n\n")
			for _, row := range pkg.Acceptance {
				fmt.Fprintf(&summary, "- [%s] %s — %s → %s\n", row.State, row.Label, row.Requirement, row.Delivered)
			}
			summary.WriteString("\n")
		}
		if len(pkg.OpenQuestions) > 0 {
			summary.WriteString("**未决问题**\n\n")
			for _, question := range pkg.OpenQuestions {
				fmt.Fprintf(&summary, "- %s\n", question)
			}
			summary.WriteString("\n")
		}
		if len(pkg.NextBrief) > 0 {
			summary.WriteString("**下一棒交办**\n\n")
			for _, item := range pkg.NextBrief {
				fmt.Fprintf(&summary, "- %s\n", item)
			}
			summary.WriteString("\n")
		}

		faqBody := strings.Builder{}
		faqBody.WriteString(handoffSummary)
		if len(pkg.Acceptance) > 0 {
			faqBody.WriteString("\n\n验收要点：\n")
			for i, row := range pkg.Acceptance {
				if i >= 6 {
					break
				}
				fmt.Fprintf(&faqBody, "- [%s] %s：%s → %s\n", row.State, row.Label, row.Requirement, row.Delivered)
			}
		}
		entries = append(entries, KnowledgeEntryPreview{
			Key:        fmt.Sprintf("faq-%d", len(entries)),
			Kind:       KnowledgeKindFAQ,
			Title:      fmt.Sprintf("「%s」这一棒怎么做的？", legTitle),
			Body:       strings.TrimSpace(faqBody.String()),
			Tags:       []string{"接力", legTitle},
			SourceLeg:  step.Position,
			SourceKind: KnowledgeSourceHandoff,
		})
	}

	// Open questions are the most valuable part of a handoff: they name what
	// the next team should not rediscover. Deduplicate within the preview.
	seenQuestions := map[string]bool{}
	summary.WriteString("\n## 未决问题汇总\n\n")
	anyOpen := false
	for _, step := range steps {
		var pkg ChainHandoffPackage
		if len(step.HandoffPackage) == 0 {
			continue
		}
		_ = json.Unmarshal(step.HandoffPackage, &pkg)
		for _, question := range pkg.OpenQuestions {
			trimmed := strings.TrimSpace(question)
			if trimmed == "" || seenQuestions[trimmed] {
				continue
			}
			seenQuestions[trimmed] = true
			anyOpen = true
			fmt.Fprintf(&summary, "- %s\n", trimmed)
			title := trimmed
			if len([]rune(title)) > 200 {
				title = string([]rune(title)[:200]) + "…"
			}
			entries = append(entries, KnowledgeEntryPreview{
				Key:        fmt.Sprintf("faq-%d", len(entries)),
				Kind:       KnowledgeKindFAQ,
				Title:      title,
				Body:       fmt.Sprintf("来自「%s」第 %d 棒的未决问题，尚未确认。重复出现时应在发布前定稿，或在任务里开一条确认。", issue.Title, step.Position+1),
				Tags:       []string{"未决"},
				SourceLeg:  step.Position,
				SourceKind: KnowledgeSourceOpenQuestion,
			})
		}
	}
	if !anyOpen {
		summary.WriteString("（没有未决问题。）\n")
	}

	status := s.EmbeddingStatus(ctx, issue.WorkspaceID)
	preview := &KnowledgePreview{
		Summary:            strings.TrimSpace(summary.String()) + "\n",
		Source:             KnowledgeSourceRelay,
		Entries:            entries,
		EmbeddingEnabled:   status.Enabled,
		EmbeddingProfileID: status.ProfileID,
		EmbeddingProvider:  status.Provider,
		EmbeddingModel:     status.Model,
		EmbeddingDims:      status.Dims,
	}
	// The summary document itself is always the first selectable entry.
	preview.Entries = append([]KnowledgeEntryPreview{{
		Key:        "summary",
		Kind:       KnowledgeKindSummary,
		Title:      issue.Title,
		Body:       preview.Summary,
		Tags:       []string{"接力总结"},
		SourceLeg:  0,
		SourceKind: KnowledgeSourceSummary,
	}}, preview.Entries...)
	return preview, nil
}

// composeSoloKnowledge distils a completed task that never had a relay. The
// source is the issue itself: its goal, the final agent delivery, and the
// result comment. It never invents FAQ items the task did not produce.
func (s *KnowledgeService) composeSoloKnowledge(ctx context.Context, issue db.Issue) (*KnowledgePreview, error) {
	category := issuestatus.Effective(ctx, s.Queries, issue.WorkspaceID, issue.Status)
	if category != issuestatus.Done {
		return nil, ErrKnowledgeTaskNotDone
	}
	ws, err := s.Queries.GetWorkspace(ctx, issue.WorkspaceID)
	if err != nil {
		return nil, err
	}
	identifier := IssueIdentifier(ws.IssuePrefix, issue.Number)
	completedAt := issue.UpdatedAt.Time
	if !issue.UpdatedAt.Valid {
		completedAt = issue.CreatedAt.Time
	}
	result := s.latestSoloResult(ctx, issue)

	var summary strings.Builder
	fmt.Fprintf(&summary, "# %s · %s\n\n", identifier, issue.Title)
	fmt.Fprintf(&summary, "> 来自 QuickWork 单人任务 · 完成于 %s\n\n", completedAt.Format("2006-01-02"))
	summary.WriteString("## 目标\n\n")
	if desc := strings.TrimSpace(issue.Description.String); desc != "" {
		summary.WriteString(desc)
	} else {
		summary.WriteString("（任务没有写描述。）")
	}
	summary.WriteString("\n\n## 结果\n\n")
	if result != "" {
		summary.WriteString(result)
	} else {
		summary.WriteString("（任务没有留下结果评论。）")
	}

	entries := make([]KnowledgeEntryPreview, 0, 1)
	if result != "" {
		entries = append(entries, KnowledgeEntryPreview{
			Key:        "faq-0",
			Kind:       KnowledgeKindFAQ,
			Title:      "这次任务是怎么完成的？",
			Body:       result,
			Tags:       []string{"单人任务", "结果"},
			SourceLeg:  0,
			SourceKind: KnowledgeSourceSoloResult,
		})
	}

	status := s.EmbeddingStatus(ctx, issue.WorkspaceID)
	preview := &KnowledgePreview{
		Summary:            strings.TrimSpace(summary.String()) + "\n",
		Source:             KnowledgeSourceSolo,
		Entries:            entries,
		EmbeddingEnabled:   status.Enabled,
		EmbeddingProfileID: status.ProfileID,
		EmbeddingProvider:  status.Provider,
		EmbeddingModel:     status.Model,
		EmbeddingDims:      status.Dims,
	}
	preview.Entries = append([]KnowledgeEntryPreview{{
		Key:        "summary",
		Kind:       KnowledgeKindSummary,
		Title:      issue.Title,
		Body:       preview.Summary,
		Tags:       []string{"单人任务", "任务总结"},
		SourceLeg:  0,
		SourceKind: KnowledgeSourceSoloSummary,
	}}, preview.Entries...)
	return preview, nil
}

// latestSoloResult prefers the last agent delivery; a member's final note is
// the fallback. System notices are never treated as a result.
func (s *KnowledgeService) latestSoloResult(ctx context.Context, issue db.Issue) string {
	comments, err := s.Queries.ListCommentsForIssue(ctx, db.ListCommentsForIssueParams{
		IssueID:     issue.ID,
		WorkspaceID: issue.WorkspaceID,
		ViewerID:    issue.CreatorID,
		RowLimit:    50,
	})
	if err != nil {
		return ""
	}
	var agentResult, memberResult string
	for _, comment := range comments {
		content := strings.TrimSpace(comment.Content)
		if content == "" {
			continue
		}
		switch comment.AuthorType {
		case "agent":
			agentResult = content
		case "member":
			memberResult = content
		}
	}
	if agentResult != "" {
		return truncateRunes(agentResult, 4000)
	}
	return truncateRunes(memberResult, 4000)
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + "…"
}

// DepositTaskKnowledge writes the selected preview entries into the workspace
// knowledge base. Publishing is the caller's role decision, checked by the
// handler; drafts are inert until someone publishes them. A published entry is
// stamped with the chosen profile and its dimension.
func (s *KnowledgeService) DepositTaskKnowledge(
	ctx context.Context,
	issue db.Issue,
	actorID pgtype.UUID,
	keys []string,
	publish bool,
	profileID pgtype.UUID,
) ([]KnowledgeEntryRecord, error) {
	preview, err := s.ComposeTaskKnowledge(ctx, issue)
	if err != nil {
		return nil, err
	}
	var resolved *ResolvedEmbedding
	if publish {
		if _, resolved, err = s.embeddingTarget(ctx, issue.WorkspaceID, profileID); err != nil {
			return nil, err
		}
	}
	selected := map[string]bool{}
	for _, key := range keys {
		selected[key] = true
	}
	status := KnowledgeStatusDraft
	if publish {
		status = KnowledgeStatusPublished
	}
	created := make([]KnowledgeEntryRecord, 0, len(preview.Entries))
	for _, entry := range preview.Entries {
		if len(selected) > 0 && !selected[entry.Key] {
			continue
		}
		tagsJSON, err := json.Marshal(entry.Tags)
		if err != nil {
			return nil, err
		}
		var squadID pgtype.UUID
		if issue.AssigneeType.String == "squad" && issue.AssigneeID.Valid {
			squadID = issue.AssigneeID
		}
		row, err := s.Queries.CreateKnowledgeEntry(ctx, db.CreateKnowledgeEntryParams{
			WorkspaceID:   issue.WorkspaceID,
			SquadID:       squadID,
			Kind:          entry.Kind,
			Title:         entry.Title,
			Body:          entry.Body,
			Tags:          tagsJSON,
			Status:        status,
			SourceIssueID: issue.ID,
			SourceLeg:     pgtype.Int4{Int32: entry.SourceLeg, Valid: true},
			SourceKind:    entry.SourceKind,
			CreatedBy:     actorID,
		})
		if err != nil {
			return nil, err
		}
		record := KnowledgeEntryRecord{Entry: row}
		if publish && resolved != nil {
			if s.embedEntryBestEffort(ctx, row, resolved) {
				record.Stamp = &KnowledgeEntryStamp{
					ProfileID: resolved.ProfileID,
					Model:     resolved.Model,
					Dims:      int32(resolved.Dims),
				}
			}
		}
		created = append(created, record)
	}
	if len(created) == 0 {
		return nil, ErrKnowledgeEmptySelection
	}
	return created, nil
}

// List returns the workspace's entries, newest first. dimsFilter is the corpus
// selector: 0 = all, -1 = unindexed, positive = that embedding width.
func (s *KnowledgeService) List(
	ctx context.Context,
	wsID pgtype.UUID,
	status, kind string,
	profileID pgtype.UUID,
	dimsFilter int32,
	limit int32,
) ([]KnowledgeEntryRecord, error) {
	rows, err := s.Queries.ListKnowledgeEntries(ctx, db.ListKnowledgeEntriesParams{
		WorkspaceID: wsID,
		Status:      status,
		Kind:        kind,
		ProfileID:   profileID,
		DimsFilter:  dimsFilter,
		RowLimit:    limit,
	})
	if err != nil {
		return nil, err
	}
	out := make([]KnowledgeEntryRecord, 0, len(rows))
	for _, row := range rows {
		out = append(out, KnowledgeEntryRecord{
			Entry: db.KnowledgeEntry{
				ID:            row.ID,
				WorkspaceID:   row.WorkspaceID,
				SquadID:       row.SquadID,
				Kind:          row.Kind,
				Title:         row.Title,
				Body:          row.Body,
				Tags:          row.Tags,
				Status:        row.Status,
				SourceIssueID: row.SourceIssueID,
				SourceLeg:     row.SourceLeg,
				SourceKind:    row.SourceKind,
				CreatedBy:     row.CreatedBy,
				PublishedBy:   row.PublishedBy,
				PublishedAt:   row.PublishedAt,
				UsageCount:    row.UsageCount,
				CreatedAt:     row.CreatedAt,
				UpdatedAt:     row.UpdatedAt,
			},
			Stamp: stampFromRow(row.EmbeddingProfileID, row.EmbeddingModel, row.EmbeddingDims),
		})
	}
	return out, nil
}

func stampFromRow(profileID pgtype.UUID, model pgtype.Text, dims pgtype.Int4) *KnowledgeEntryStamp {
	if !dims.Valid {
		return nil
	}
	return &KnowledgeEntryStamp{ProfileID: profileID, Model: model.String, Dims: dims.Int32}
}

// Stats returns counts keyed as "<kind>:<status>", for the page's corpus card.
func (s *KnowledgeService) Stats(ctx context.Context, wsID pgtype.UUID) (map[string]int64, error) {
	rows, err := s.Queries.CountKnowledgeEntries(ctx, wsID)
	if err != nil {
		return nil, err
	}
	out := make(map[string]int64, len(rows))
	for _, row := range rows {
		out[row.Kind+":"+row.Status] += row.Count
	}
	return out, nil
}

// Publish flips a draft (or archived entry) to published and embeds it into
// the active corpus. The trgm fallback keeps it searchable regardless.
func (s *KnowledgeService) Publish(ctx context.Context, wsID, id, actorID pgtype.UUID) (db.KnowledgeEntry, error) {
	row, err := s.Queries.SetKnowledgeEntryStatus(ctx, db.SetKnowledgeEntryStatusParams{
		ID:          id,
		WorkspaceID: wsID,
		Status:      KnowledgeStatusPublished,
		ActorID:     actorID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.KnowledgeEntry{}, ErrKnowledgeEntryNotFound
		}
		return db.KnowledgeEntry{}, err
	}
	if _, resolved, err := s.embeddingTarget(ctx, wsID, pgtype.UUID{}); err == nil && resolved != nil {
		s.embedEntryBestEffort(ctx, row, resolved)
	}
	return row, nil
}

// Archive hides an entry from retrieval without deleting its provenance.
func (s *KnowledgeService) Archive(ctx context.Context, wsID, id, actorID pgtype.UUID) (db.KnowledgeEntry, error) {
	row, err := s.Queries.SetKnowledgeEntryStatus(ctx, db.SetKnowledgeEntryStatusParams{
		ID:          id,
		WorkspaceID: wsID,
		Status:      KnowledgeStatusArchived,
		ActorID:     actorID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.KnowledgeEntry{}, ErrKnowledgeEntryNotFound
		}
		return db.KnowledgeEntry{}, err
	}
	return row, nil
}

// Search retrieves published entries from one corpus. The requested profile
// (or the active one) supplies both the query embedding and the profile
// filter; a provider failure degrades to keyword inside the same corpus.
func (s *KnowledgeService) Search(
	ctx context.Context,
	wsID pgtype.UUID,
	query string,
	limit int32,
	profileID pgtype.UUID,
) (KnowledgeSearch, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return KnowledgeSearch{Hits: []KnowledgeHit{}, Mode: "keyword"}, nil
	}
	if limit <= 0 {
		limit = 5
	}
	profileRow, resolved, err := s.embeddingTarget(ctx, wsID, profileID)
	if err != nil {
		return KnowledgeSearch{}, err
	}
	result := KnowledgeSearch{Hits: []KnowledgeHit{}, Mode: "keyword"}
	if profileRow != nil {
		result.Profile = &KnowledgeProfileRef{
			ID:       util.UUIDToString(profileRow.ID),
			Provider: profileRow.Provider,
			Model:    profileRow.Model,
			Dims:     int(profileRow.Dims),
		}
	} else if resolved != nil {
		result.Profile = &KnowledgeProfileRef{Provider: "env", Model: resolved.Model, Dims: resolved.Dims}
	}

	var corpusID pgtype.UUID
	if profileRow != nil {
		corpusID = profileRow.ID
	}
	if resolved != nil {
		vectors, err := resolved.Embedder.Embed(ctx, []string{query})
		if err == nil && len(vectors) == 1 {
			literal, literalErr := vectorLiteral(vectors[0])
			if literalErr != nil {
				return KnowledgeSearch{}, literalErr
			}
			rows, err := s.Queries.SearchKnowledgeByVector(ctx, db.SearchKnowledgeByVectorParams{
				WorkspaceID:    wsID,
				QueryEmbedding: literal,
				Dims:           int32(resolved.Dims),
				ProfileID:      resolved.ProfileID,
				RowLimit:       limit,
			})
			if err == nil {
				hits := make([]KnowledgeHit, 0, len(rows))
				for _, row := range rows {
					hits = append(hits, KnowledgeHit{
						Entry: KnowledgeEntryRecord{
							Entry: vectorRowToEntry(row),
							Stamp: &KnowledgeEntryStamp{
								ProfileID: row.EmbeddingProfileID,
								Model:     row.EmbeddingModel,
								Dims:      row.EmbeddingDims,
							},
						},
						Score: row.Score,
					})
				}
				result.Hits = hits
				result.Mode = "vector"
				return result, nil
			}
			slog.Warn("knowledge vector search failed; falling back to keyword",
				"workspace_id", util.UUIDToString(wsID), "error", err)
		} else if err != nil {
			slog.Warn("knowledge query embedding failed; falling back to keyword",
				"workspace_id", util.UUIDToString(wsID), "error", err)
		}
	}
	rows, err := s.Queries.SearchKnowledgeByKeyword(ctx, db.SearchKnowledgeByKeywordParams{
		WorkspaceID: wsID,
		Terms:       knowledgeQueryTerms(query),
		ProfileID:   corpusID,
		RowLimit:    limit,
	})
	if err != nil {
		return KnowledgeSearch{}, err
	}
	hits := make([]KnowledgeHit, 0, len(rows))
	for _, row := range rows {
		hits = append(hits, KnowledgeHit{
			Entry: KnowledgeEntryRecord{
				Entry: keywordRowToEntry(row),
				Stamp: stampFromRow(row.EmbeddingProfileID, row.EmbeddingModel, row.EmbeddingDims),
			},
			Score: row.Score,
		})
	}
	result.Hits = hits
	return result, nil
}

// ReembedMissing embeds published entries that have no vector yet. Entries
// already stamped with another corpus are left alone: an entry belongs to
// exactly one dimension.
func (s *KnowledgeService) ReembedMissing(
	ctx context.Context,
	wsID, profileID pgtype.UUID,
	limit int32,
) (int, error) {
	_, resolved, err := s.embeddingTarget(ctx, wsID, profileID)
	if err != nil {
		return 0, err
	}
	if resolved == nil {
		return 0, nil
	}
	rows, err := s.Queries.ListKnowledgeEntriesMissingEmbedding(ctx, db.ListKnowledgeEntriesMissingEmbeddingParams{
		WorkspaceID: wsID,
		Limit:       limit,
	})
	if err != nil {
		return 0, err
	}
	embedded := 0
	for _, entry := range rows {
		if s.embedEntryBestEffort(ctx, entry, resolved) {
			embedded++
		}
	}
	return embedded, nil
}

func (s *KnowledgeService) embedEntryBestEffort(
	ctx context.Context,
	entry db.KnowledgeEntry,
	resolved *ResolvedEmbedding,
) bool {
	if resolved == nil || resolved.Embedder == nil {
		return false
	}
	embedCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	vectors, err := resolved.Embedder.Embed(embedCtx, []string{entry.Title + "\n\n" + entry.Body})
	if err != nil || len(vectors) != 1 || len(vectors[0]) != resolved.Dims {
		slog.Warn("knowledge entry could not be embedded",
			"entry_id", util.UUIDToString(entry.ID), "error", err)
		return false
	}
	literal, err := vectorLiteral(vectors[0])
	if err != nil {
		slog.Warn("knowledge embedding could not be encoded",
			"entry_id", util.UUIDToString(entry.ID), "error", err)
		return false
	}
	hash := sha256.Sum256([]byte(fmt.Sprintf("%s\n%d\n%s\n%s", resolved.Model, resolved.Dims, entry.Title, entry.Body)))
	if err := s.Queries.UpsertKnowledgeEmbedding(ctx, db.UpsertKnowledgeEmbeddingParams{
		EntryID:     entry.ID,
		ProfileID:   resolved.ProfileID,
		Model:       resolved.Model,
		Dims:        int32(resolved.Dims),
		Embedding:   literal,
		ContentHash: hex.EncodeToString(hash[:]),
	}); err != nil {
		slog.Warn("knowledge embedding could not be stored",
			"entry_id", util.UUIDToString(entry.ID), "error", err)
		return false
	}
	return true
}

func vectorRowToEntry(row db.SearchKnowledgeByVectorRow) db.KnowledgeEntry {
	return db.KnowledgeEntry{
		ID:            row.ID,
		WorkspaceID:   row.WorkspaceID,
		SquadID:       row.SquadID,
		Kind:          row.Kind,
		Title:         row.Title,
		Body:          row.Body,
		Tags:          row.Tags,
		Status:        row.Status,
		SourceIssueID: row.SourceIssueID,
		SourceLeg:     row.SourceLeg,
		SourceKind:    row.SourceKind,
		CreatedBy:     row.CreatedBy,
		PublishedBy:   row.PublishedBy,
		PublishedAt:   row.PublishedAt,
		UsageCount:    row.UsageCount,
		CreatedAt:     row.CreatedAt,
		UpdatedAt:     row.UpdatedAt,
	}
}

// knowledgeQueryTerms splits a question into searchable terms. Chinese has no
// spaces, so punctuation is a split too; the whole query survives as one term
// when nothing splits it, and trigram similarity still ranks that case.
func knowledgeQueryTerms(query string) []string {
	fields := strings.FieldsFunc(query, func(r rune) bool {
		return unicode.IsSpace(r) || strings.ContainsRune("，,。.？?！!；;、：:", r)
	})
	seen := map[string]bool{}
	terms := make([]string, 0, len(fields))
	for _, field := range fields {
		term := strings.TrimSpace(field)
		if term == "" || seen[term] {
			continue
		}
		seen[term] = true
		terms = append(terms, term)
		if len(terms) >= 6 {
			break
		}
	}
	if len(terms) == 0 {
		terms = []string{query}
	}
	return terms
}

func keywordRowToEntry(row db.SearchKnowledgeByKeywordRow) db.KnowledgeEntry {
	return db.KnowledgeEntry{
		ID:            row.ID,
		WorkspaceID:   row.WorkspaceID,
		SquadID:       row.SquadID,
		Kind:          row.Kind,
		Title:         row.Title,
		Body:          row.Body,
		Tags:          row.Tags,
		Status:        row.Status,
		SourceIssueID: row.SourceIssueID,
		SourceLeg:     row.SourceLeg,
		SourceKind:    row.SourceKind,
		CreatedBy:     row.CreatedBy,
		PublishedBy:   row.PublishedBy,
		PublishedAt:   row.PublishedAt,
		UsageCount:    row.UsageCount,
		CreatedAt:     row.CreatedAt,
		UpdatedAt:     row.UpdatedAt,
	}
}

// vectorLiteral zero-pads the embedding to the physical column width. Padding
// with zeros leaves cosine similarity unchanged, so vectors from a 512, 768 or
// 1024-dimension model can share the 1536-wide HNSW index.
func vectorLiteral(values []float32) (string, error) {
	if len(values) > knowledge.ColumnDims {
		return "", fmt.Errorf("embedding has %d dimensions, more than the %d-wide column", len(values), knowledge.ColumnDims)
	}
	var b strings.Builder
	b.WriteByte('[')
	for i := 0; i < knowledge.ColumnDims; i++ {
		if i > 0 {
			b.WriteByte(',')
		}
		value := float32(0)
		if i < len(values) {
			value = values[i]
		}
		b.WriteString(strconv.FormatFloat(float64(value), 'f', 6, 32))
	}
	b.WriteByte(']')
	return b.String(), nil
}
