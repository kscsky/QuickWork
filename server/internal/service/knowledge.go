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

	"github.com/kscsky/quickwork/server/internal/knowledge"
	"github.com/kscsky/quickwork/server/internal/util"
	db "github.com/kscsky/quickwork/server/pkg/db/generated"
)

// The knowledge base distils a finished relay into two things: one summary
// document, and FAQ entries that later legs can retrieve. Composition is
// deterministic — it reads the handoff packages the holders already approved —
// so the memory cannot invent facts an agent never handed over. An optional
// embedding provider turns the entries into vectors; without one the page falls
// back to trigram search and embeddings stay pending.

const (
	KnowledgeKindSummary = "summary"
	KnowledgeKindFAQ     = "faq"

	KnowledgeStatusDraft     = "draft"
	KnowledgeStatusPublished = "published"
	KnowledgeStatusArchived  = "archived"

	KnowledgeSourceSummary      = "relay_summary"
	KnowledgeSourceHandoff      = "handoff"
	KnowledgeSourceOpenQuestion = "open_question"
	KnowledgeSourceManual       = "manual"
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
	Summary          string                  `json:"summary"`
	Entries          []KnowledgeEntryPreview `json:"entries"`
	EmbeddingEnabled bool                    `json:"embedding_enabled"`
	EmbeddingModel   string                  `json:"embedding_model"`
	EmbeddingDims    int                     `json:"embedding_dims"`
}

// KnowledgeHit is one search result with its score (cosine similarity or
// trigram similarity depending on the mode).
type KnowledgeHit struct {
	Entry db.KnowledgeEntry
	Score float64
}

type KnowledgeSearch struct {
	Hits []KnowledgeHit
	Mode string // "vector" | "keyword"
}

type KnowledgeService struct {
	Queries  *db.Queries
	Embedder knowledge.Embedder
}

func NewKnowledgeService(q *db.Queries, embedder knowledge.Embedder) *KnowledgeService {
	return &KnowledgeService{Queries: q, Embedder: embedder}
}

func (s *KnowledgeService) EmbeddingStatus() (bool, string, int) {
	if s.Embedder == nil {
		return false, "", knowledge.EmbeddingDims
	}
	return true, s.Embedder.Model(), s.Embedder.Dims()
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
		return nil, ErrKnowledgeNoChain
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

	embeddingEnabled, embeddingModel, embeddingDims := s.EmbeddingStatus()
	preview := &KnowledgePreview{
		Summary:          strings.TrimSpace(summary.String()) + "\n",
		Entries:          entries,
		EmbeddingEnabled: embeddingEnabled,
		EmbeddingModel:   embeddingModel,
		EmbeddingDims:    embeddingDims,
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

// DepositTaskKnowledge writes the selected preview entries into the workspace
// knowledge base. Publishing is the caller's role decision, checked by the
// handler; drafts are inert until someone publishes them.
func (s *KnowledgeService) DepositTaskKnowledge(
	ctx context.Context,
	issue db.Issue,
	actorID pgtype.UUID,
	keys []string,
	publish bool,
) ([]db.KnowledgeEntry, error) {
	preview, err := s.ComposeTaskKnowledge(ctx, issue)
	if err != nil {
		return nil, err
	}
	selected := map[string]bool{}
	for _, key := range keys {
		selected[key] = true
	}
	status := KnowledgeStatusDraft
	if publish {
		status = KnowledgeStatusPublished
	}
	created := make([]db.KnowledgeEntry, 0, len(preview.Entries))
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
		created = append(created, row)
	}
	if len(created) == 0 {
		return nil, ErrKnowledgeEmptySelection
	}
	if publish {
		for _, entry := range created {
			s.embedEntryBestEffort(ctx, entry)
		}
	}
	return created, nil
}

// List returns the workspace's entries, newest first.
func (s *KnowledgeService) List(ctx context.Context, wsID pgtype.UUID, status, kind string, limit int32) ([]db.KnowledgeEntry, error) {
	return s.Queries.ListKnowledgeEntries(ctx, db.ListKnowledgeEntriesParams{
		WorkspaceID: wsID,
		Status:      status,
		Kind:        kind,
		RowLimit:    limit,
	})
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

// Publish flips a draft (or archived entry) to published and embeds it when a
// provider is configured. The trgm fallback keeps it searchable regardless.
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
	s.embedEntryBestEffort(ctx, row)
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

// Search retrieves published entries. Vector search is used when an embedder
// is configured; a provider failure degrades to keyword instead of failing the
// page. Drafts never surface here.
func (s *KnowledgeService) Search(ctx context.Context, wsID pgtype.UUID, query string, limit int32) (KnowledgeSearch, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return KnowledgeSearch{Hits: []KnowledgeHit{}, Mode: "keyword"}, nil
	}
	if limit <= 0 {
		limit = 5
	}
	if s.Embedder != nil {
		vectors, err := s.Embedder.Embed(ctx, []string{query})
		if err == nil && len(vectors) == 1 {
			rows, err := s.Queries.SearchKnowledgeByVector(ctx, db.SearchKnowledgeByVectorParams{
				WorkspaceID:    wsID,
				QueryEmbedding: vectorLiteral(vectors[0]),
				RowLimit:       limit,
			})
			if err == nil {
				hits := make([]KnowledgeHit, 0, len(rows))
				for _, row := range rows {
					hits = append(hits, KnowledgeHit{Entry: rowToEntry(row), Score: row.Score})
				}
				return KnowledgeSearch{Hits: hits, Mode: "vector"}, nil
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
		RowLimit:    limit,
	})
	if err != nil {
		return KnowledgeSearch{}, err
	}
	hits := make([]KnowledgeHit, 0, len(rows))
	for _, row := range rows {
		hits = append(hits, KnowledgeHit{Entry: keywordRowToEntry(row), Score: row.Score})
	}
	return KnowledgeSearch{Hits: hits, Mode: "keyword"}, nil
}

// ReembedMissing embeds published entries that have no vector yet (a provider
// was configured after they were published). Returns the number embedded.
func (s *KnowledgeService) ReembedMissing(ctx context.Context, wsID pgtype.UUID, limit int32) (int, error) {
	if s.Embedder == nil {
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
		if s.embedEntryBestEffort(ctx, entry) {
			embedded++
		}
	}
	return embedded, nil
}

func (s *KnowledgeService) embedEntryBestEffort(ctx context.Context, entry db.KnowledgeEntry) bool {
	if s.Embedder == nil {
		return false
	}
	embedCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	vectors, err := s.Embedder.Embed(embedCtx, []string{entry.Title + "\n\n" + entry.Body})
	if err != nil || len(vectors) != 1 {
		slog.Warn("knowledge entry could not be embedded",
			"entry_id", util.UUIDToString(entry.ID), "error", err)
		return false
	}
	hash := sha256.Sum256([]byte(s.Embedder.Model() + "\n" + entry.Title + "\n" + entry.Body))
	if err := s.Queries.UpsertKnowledgeEmbedding(ctx, db.UpsertKnowledgeEmbeddingParams{
		EntryID:     entry.ID,
		Model:       s.Embedder.Model(),
		Dims:        int32(s.Embedder.Dims()),
		Embedding:   vectorLiteral(vectors[0]),
		ContentHash: hex.EncodeToString(hash[:]),
	}); err != nil {
		slog.Warn("knowledge embedding could not be stored",
			"entry_id", util.UUIDToString(entry.ID), "error", err)
		return false
	}
	return true
}

func rowToEntry(row db.SearchKnowledgeByVectorRow) db.KnowledgeEntry {
	entry := db.KnowledgeEntry{
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
	return entry
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

func vectorLiteral(values []float32) string {
	var b strings.Builder
	b.WriteByte('[')
	for i, value := range values {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(strconv.FormatFloat(float64(value), 'f', 6, 32))
	}
	b.WriteByte(']')
	return b.String()
}
