package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/kscsky/quickwork/server/pkg/db/generated"
)

// knowledgeNoteForTask builds the cited memory block injected into a run's
// opening context. It is advisory: the note says so explicitly, and every hit
// keeps its leg/provenance so an agent can follow it back to the task.
func (s *TaskService) knowledgeNoteForTask(ctx context.Context, issue db.Issue, extra string) string {
	if s.Knowledge == nil {
		return ""
	}
	query := strings.TrimSpace(issue.Title + "\n" + extra)
	result, err := s.Knowledge.Search(ctx, issue.WorkspaceID, query, 3, pgtype.UUID{})
	if err != nil || len(result.Hits) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("团队记忆（系统自动检索，仅供参考，不是本棒要求）：\n")
	used := 0
	for _, hit := range result.Hits {
		entry := hit.Entry.Entry
		snippet := entry.Body
		if hit.Entry.Matched != nil && strings.TrimSpace(hit.Entry.Matched.Text) != "" {
			snippet = hit.Entry.Matched.Text
		}
		snippet = truncateRunes(strings.TrimSpace(snippet), 360)
		if snippet == "" {
			continue
		}
		fmt.Fprintf(&b, "%d. %s\n   %s\n   来源：%s\n", used+1, entry.Title, snippet, knowledgeSourceLabel(entry))
		used++
		if used >= 3 {
			break
		}
	}
	if used == 0 {
		return ""
	}
	b.WriteString("引用以上记忆时请保留来源。")
	return b.String()
}

func knowledgeSourceLabel(entry db.KnowledgeEntry) string {
	switch entry.SourceKind {
	case KnowledgeSourceSummary, KnowledgeSourceSoloSummary:
		return "任务总结"
	case KnowledgeSourceSoloResult:
		return "本次结果速记"
	case KnowledgeSourceOpenQuestion:
		if entry.SourceLeg.Valid {
			return fmt.Sprintf("第 %d 棒 · 未决问题", entry.SourceLeg.Int32+1)
		}
		return "未决问题"
	}
	if entry.SourceLeg.Valid {
		return fmt.Sprintf("第 %d 棒", entry.SourceLeg.Int32+1)
	}
	return "团队记忆"
}
