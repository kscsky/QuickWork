package knowledge

import (
	"strings"
)

// Retrieval granularity. A whole entry is one vector; a parent-child corpus
// indexes section-sized child chunks whose entry_id is the parent returned to
// callers. Strategies never change the embedding model or the corpus.
const (
	StrategyAuto   = "auto"
	StrategyEntry  = "entry"
	StrategyParent = "parent"

	DefaultChunkRunes   = 600
	DefaultChunkOverlap = 60
	maxChunksPerEntry   = 40
)

type Chunk struct {
	Index   int
	Text    string
	Heading string
}

func NormalizeStrategy(value string) string {
	switch value {
	case StrategyEntry, StrategyParent, StrategyAuto:
		return value
	default:
		return StrategyAuto
	}
}

// SplitEntry turns one knowledge entry into the chunks to embed. Auto keeps
// short FAQs whole and splits the summary document by section, which is the
// mixture the deposit dialog recommends.
func SplitEntry(kind, body, strategy string) []Chunk {
	strategy = NormalizeStrategy(strategy)
	if strategy == StrategyAuto {
		if kind == "summary" {
			strategy = StrategyParent
		} else {
			strategy = StrategyEntry
		}
	}
	body = strings.TrimSpace(body)
	if strategy == StrategyEntry || body == "" {
		return []Chunk{{Index: 0, Text: body}}
	}
	return splitMarkdown(body)
}

// ChunkEmbeddingText prepends the parent title and the section heading so a
// child chunk keeps its context when it is embedded on its own.
func ChunkEmbeddingText(title, heading, text string) string {
	parts := []string{strings.TrimSpace(title)}
	if heading = strings.TrimSpace(heading); heading != "" {
		parts = append(parts, heading)
	}
	parts = append(parts, strings.TrimSpace(text))
	return strings.Join(parts, "\n")
}

type markdownSection struct {
	heading string
	lines   []string
}

func splitMarkdown(body string) []Chunk {
	body = strings.ReplaceAll(body, "\r\n", "\n")
	sections := make([]markdownSection, 0, 8)
	current := markdownSection{}
	flush := func() {
		if strings.TrimSpace(strings.Join(current.lines, "\n")) == "" && current.heading == "" {
			return
		}
		sections = append(sections, current)
		current = markdownSection{}
	}
	for _, line := range strings.Split(body, "\n") {
		if heading, ok := headingOf(line); ok {
			flush()
			current.heading = heading
			continue
		}
		current.lines = append(current.lines, line)
	}
	flush()

	chunks := make([]Chunk, 0, len(sections))
	for _, section := range sections {
		content := strings.TrimSpace(strings.Join(section.lines, "\n"))
		if content == "" {
			continue
		}
		for _, piece := range splitLong(content, DefaultChunkRunes, DefaultChunkOverlap) {
			if len(chunks) >= maxChunksPerEntry {
				// Keep the tail inside the last chunk instead of silently
				// dropping content or blowing up the embedding bill.
				last := &chunks[len(chunks)-1]
				last.Text = strings.TrimSpace(last.Text + "\n" + piece)
				continue
			}
			chunks = append(chunks, Chunk{Text: piece, Heading: section.heading})
		}
	}
	if len(chunks) == 0 {
		return []Chunk{{Index: 0, Text: strings.TrimSpace(body)}}
	}
	for i := range chunks {
		chunks[i].Index = i
	}
	return chunks
}

func headingOf(line string) (string, bool) {
	trimmed := strings.TrimSpace(line)
	if len(trimmed) < 3 || trimmed[0] != '#' {
		return "", false
	}
	level := 0
	for level < len(trimmed) && trimmed[level] == '#' {
		level++
	}
	if level < 1 || level > 3 || level >= len(trimmed) || trimmed[level] != ' ' {
		return "", false
	}
	return strings.TrimSpace(trimmed[level:]), true
}

// splitLong cuts at a newline or Chinese sentence boundary near the limit so a
// chunk does not end mid-sentence when the source allows a better break.
func splitLong(content string, limit, overlap int) []string {
	runes := []rune(content)
	if len(runes) <= limit {
		return []string{content}
	}
	pieces := make([]string, 0, len(runes)/limit+1)
	start := 0
	for start < len(runes) {
		end := start + limit
		if end > len(runes) {
			end = len(runes)
		}
		if end < len(runes) {
			cut := end
			for i := end; i > start+limit/2; i-- {
				switch runes[i-1] {
				case '\n', '。', '！', '？', '；':
					cut = i
					i = start // stop the scan
				}
			}
			end = cut
		}
		piece := strings.TrimSpace(string(runes[start:end]))
		if piece != "" {
			pieces = append(pieces, piece)
		}
		if end >= len(runes) {
			break
		}
		start = end - overlap
		if start < 0 {
			start = 0
		}
		if start >= end {
			start = end
		}
	}
	return pieces
}
