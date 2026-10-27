// @vitest-environment node
import { describe, expect, it } from "vitest";
import type {
  UsageLogRow,
  UsageModelSummary,
  UsageOverviewDaily,
  UsageOverviewByAgent,
} from "@quickwork/core/types";
import {
  usageAgentRows,
  usageLogTimeParts,
  usageLogsToCsv,
  usageModelRows,
  usageTotals,
  usageTrendChart,
} from "./usage-utils";
import { addDaysIso, todayIso } from "../runtimes/utils";

function summary(over: Partial<UsageModelSummary> = {}): UsageModelSummary {
  return {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    call_count: 2,
    input_tokens: 1_000,
    output_tokens: 200,
    cache_read_tokens: 500,
    cache_write_tokens: 0,
    cost_usd_ticks: 0,
    uncosted_input_tokens: 1_000,
    uncosted_output_tokens: 200,
    uncosted_cache_read_tokens: 500,
    uncosted_cache_write_tokens: 0,
    success_calls: 1,
    failed_calls: 1,
    cancelled_calls: 0,
    running_calls: 0,
    ...over,
  };
}

describe("usageTotals", () => {
  it("keeps the cost breakdown summing to the headline cost", () => {
    const totals = usageTotals([summary()]);
    expect(totals.calls).toBe(2);
    expect(totals.success).toBe(1);
    expect(totals.failed).toBe(1);
    expect(totals.tokens).toBe(1_700);
    expect(totals.cacheHitRate).toBeCloseTo((500 / 1_500) * 100);
    expect(totals.cost).toBeGreaterThan(0);
    expect(totals.savings).toBeGreaterThan(0);
    const breakdownTotal =
      totals.breakdown.input +
      totals.breakdown.output +
      totals.breakdown.cacheRead +
      totals.breakdown.cacheWrite;
    expect(breakdownTotal).toBeCloseTo(totals.cost, 10);
    expect(totals.modelCount).toBe(1);
  });

  it("uses provider ticks for the authoritative half and estimates the rest", () => {
    const totals = usageTotals([
      summary({
        cost_usd_ticks: 1_000_000_000, // $0.10
        uncosted_input_tokens: 0,
        uncosted_output_tokens: 0,
        uncosted_cache_read_tokens: 0,
        uncosted_cache_write_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
      }),
    ]);
    expect(totals.cost).toBeCloseTo(0.1, 10);
  });

  it("returns zeros for an empty window", () => {
    const totals = usageTotals([]);
    expect(totals.calls).toBe(0);
    expect(totals.cost).toBe(0);
    expect(totals.cacheHitRate).toBe(0);
  });
});

describe("usageTrendChart", () => {
  const today = todayIso("UTC");
  const yesterday = addDaysIso(today, -1);

  function daily(over: Partial<UsageOverviewDaily>): UsageOverviewDaily {
    return { date: today, ...summary(), ...over };
  }

  it("zero-fills the window and totals the selected metric", () => {
    const rows = [daily({}), daily({ date: yesterday })];
    const byModel = [summary()];
    const calls = usageTrendChart(rows, byModel, 7, "UTC", "en", "calls", "Other");
    expect(calls.data).toHaveLength(7);
    expect(calls.total).toBe(4);
    expect(calls.series).toHaveLength(1);
    expect(calls.series[0]?.label).toBe("claude-sonnet-4-6");

    const costs = usageTrendChart(rows, byModel, 7, "UTC", "en", "cost", "Other");
    expect(costs.total).toBeCloseTo(usageTotals(byModel).cost * 2, 10);
  });

  it("groups models outside the top five into one Other series", () => {
    const models = Array.from({ length: 6 }, (_, index) =>
      summary({
        model: `model-${index}`,
        input_tokens: (6 - index) * 1_000,
        output_tokens: 0,
        cache_read_tokens: 0,
        uncosted_input_tokens: (6 - index) * 1_000,
        uncosted_output_tokens: 0,
        uncosted_cache_read_tokens: 0,
      }),
    );
    const rows = models.map((model) => ({ date: today, ...model }));
    const chart = usageTrendChart(rows, models, 7, "UTC", "en", "tokens", "Other");
    expect(chart.series.map((series) => series.label)).toContain("Other");
    expect(chart.total).toBe(
      models.reduce((sum, model) => sum + model.input_tokens, 0),
    );
  });
});

describe("usageModelRows and usageAgentRows", () => {
  it("sorts model rows by cost and keeps shares summing to 100", () => {
    const rows = usageModelRows([
      summary(),
      summary({ provider: "openai", model: "gpt-5.2-codex", input_tokens: 10_000 }),
    ]);
    expect(rows[0]?.model).toBe("claude-sonnet-4-6");
    expect(rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(100, 6);
  });

  it("folds a restricted agent's rows into one bucket", () => {
    const byAgent: UsageOverviewByAgent[] = [
      { agent_id: "agent-1", ...summary() },
      { agent_id: "__restricted_agents__", ...summary() },
      { agent_id: "__restricted_agents__", ...summary({ call_count: 1 }) },
    ];
    const rows = usageAgentRows(byAgent);
    const restricted = rows.find((row) => row.agentId === "__restricted_agents__");
    expect(restricted?.calls).toBe(3);
    expect(restricted?.cost).toBeGreaterThan(0);
  });
});

describe("log helpers", () => {
  it("formats a timestamp in the viewer's timezone", () => {
    expect(usageLogTimeParts("2026-10-20T00:30:00Z", "Asia/Tokyo")).toEqual({
      date: "10-20",
      time: "09:30:00",
    });
    expect(usageLogTimeParts("2026-10-20T00:30:00Z", "UTC")).toEqual({
      date: "10-20",
      time: "00:30:00",
    });
  });

  it("escapes CSV fields and records the cost source", () => {
    const row: UsageLogRow = {
      id: "u1",
      task_id: "t1",
      status: "success",
      db_status: "completed",
      agent_id: "a1",
      agent_name: "Agent One",
      agent_restricted: false,
      issue_id: "i1",
      issue_identifier: "ACME-1",
      issue_title: 'Fix "login", retry',
      project_id: "p1",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      trigger: "comment",
      failure_reason: "",
      created_at: "2026-10-20T00:30:00Z",
      input_tokens: 1_000,
      output_tokens: 200,
      cache_read_tokens: 500,
      cache_write_tokens: 0,
    };
    const csv = usageLogsToCsv([row]);
    expect(csv.split("\n")[0]).toContain("time_utc,status,agent_id");
    expect(csv).toContain('"Fix ""login"", retry"');
    expect(csv).toContain(",estimated,");

    const reported = usageLogsToCsv([{ ...row, cost_usd_ticks: 1_000_000_000 }]);
    expect(reported).toContain(",provider,");
  });
});
