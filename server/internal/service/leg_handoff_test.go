package service

import "testing"

func TestParseLegHandoffDocument(t *testing.T) {
	doc := "# 本棒交付文档\n\n正文。\n\n" +
		"```handoff\n" +
		`{"summary":"一句话交付","acceptance":[` +
		`{"label":"口径","requirement":"超 3 次进审计队列","delivered":"见清单 §2","state":"warn"},` +
		`{"label":"","requirement":"没有标签的行被丢弃"},` +
		`{"label":"来源","requirement":"每个结论可复核","delivered":"3 条待补"}` +
		`],"open_questions":["容量上限未定"],"next_brief":["补压测数据"]}` +
		"\n```\n"

	handoff, ok := parseLegHandoffDocument(doc)
	if !ok {
		t.Fatalf("valid block rejected")
	}
	if handoff.Summary != "一句话交付" {
		t.Errorf("summary = %q", handoff.Summary)
	}
	if len(handoff.Acceptance) != 2 {
		t.Fatalf("acceptance rows = %d, want 2 (the label-less row is dropped)", len(handoff.Acceptance))
	}
	if handoff.Acceptance[0].State != "warn" {
		t.Errorf("explicit warn state lost: %+v", handoff.Acceptance[0])
	}
	if handoff.Acceptance[1].State != "pass" {
		t.Errorf("missing state should default to pass: %+v", handoff.Acceptance[1])
	}
	if len(handoff.OpenQuestions) != 1 || len(handoff.NextBrief) != 1 {
		t.Errorf("lists lost: %+v", handoff)
	}

	for name, broken := range map[string]string{
		"no block":           "# prose only",
		"unclosed block":     "```handoff\n{\"summary\":\"s\"}",
		"malformed json":     "```handoff\n{not json}\n```",
		"empty summary":      "```handoff\n{\"summary\":\"\",\"acceptance\":[{\"label\":\"a\",\"requirement\":\"b\"}]}\n```",
		"no acceptance rows": "```handoff\n{\"summary\":\"s\",\"acceptance\":[]}\n```",
	} {
		if _, ok := parseLegHandoffDocument(broken); ok {
			t.Errorf("%s: parsed as a valid handoff", name)
		}
	}
}
