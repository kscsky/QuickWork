package knowledge

import (
	"strings"
	"testing"
)

func TestSplitEntryAutoKeepsFAQWhole(t *testing.T) {
	chunks := SplitEntry("faq", "问答正文", StrategyAuto)
	if len(chunks) != 1 || chunks[0].Text != "问答正文" || chunks[0].Index != 0 {
		t.Fatalf("chunks = %+v", chunks)
	}
}

func TestSplitEntryParentSplitsMarkdownSections(t *testing.T) {
	body := "# 任务总结\n\n概览。\n\n## 目标\n\n交付 3 篇笔记。\n\n## 第 1 棒 · 拆解\n\n拆成 3 块。\n\n## 未决问题\n\n第 3 篇绑定哪款产品？"
	chunks := SplitEntry("summary", body, StrategyParent)
	if len(chunks) < 4 {
		t.Fatalf("chunks = %d, want the intro + three sections", len(chunks))
	}
	headings := make([]string, 0, len(chunks))
	for i, chunk := range chunks {
		if chunk.Index != i {
			t.Fatalf("chunk %d has index %d", i, chunk.Index)
		}
		headings = append(headings, chunk.Heading)
	}
	joined := strings.Join(headings, "|")
	for _, want := range []string{"任务总结", "目标", "第 1 棒 · 拆解", "未决问题"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("headings = %s, missing %s", joined, want)
		}
	}
}

func TestSplitLongSectionProducesOverlappingChunks(t *testing.T) {
	body := strings.Repeat("这是一段需要被切开的正文。", 120)
	chunks := SplitEntry("summary", body, StrategyParent)
	if len(chunks) < 2 {
		t.Fatalf("chunks = %d, want > 1", len(chunks))
	}
	for _, chunk := range chunks {
		if len([]rune(chunk.Text)) > DefaultChunkRunes+DefaultChunkOverlap {
			t.Fatalf("chunk is %d runes, over the limit", len([]rune(chunk.Text)))
		}
	}
}

func TestChunkEmbeddingTextCarriesContext(t *testing.T) {
	text := ChunkEmbeddingText("发布内容包", "配图规范", "统一暖棕 + 米白")
	if !strings.Contains(text, "发布内容包") || !strings.Contains(text, "配图规范") || !strings.Contains(text, "统一暖棕") {
		t.Fatalf("embedding text lacks context: %s", text)
	}
}

func TestSplitEntryEmptyBodyStillYieldsOneChunk(t *testing.T) {
	chunks := SplitEntry("summary", "   ", StrategyParent)
	if len(chunks) != 1 || chunks[0].Text != "" {
		t.Fatalf("chunks = %+v", chunks)
	}
}
