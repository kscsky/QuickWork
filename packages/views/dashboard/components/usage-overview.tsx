"use client";

import { useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import type { Agent, UsageOverview } from "@quickwork/core/types";
import { useT } from "../../i18n";
import { ProviderLogo } from "../../runtimes/components/provider-logo";
import { collectUnmappedModels } from "../../runtimes/utils";
import {
  formatUsageInt,
  formatUsagePercent,
  formatUsageTokens,
  formatUsageUsd,
  usageAgentRows,
  usageModelRows,
  usageTotals,
  usageTrendChart,
  type UsageAgentRow,
  type UsageTrendMetric,
} from "../usage-utils";
import "./usage.css";

const AVATAR_COLORS = [
  "var(--zone-1)",
  "var(--zone-2)",
  "var(--zone-3)",
  "var(--zone-4)",
  "var(--zone-5)",
  "var(--zone-6)",
];

function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}

function agentDisplay(
  row: UsageAgentRow,
  agentsById: Map<string, Agent>,
  restrictedLabel: string,
  deletedLabel: string,
) {
  if (row.agentId === "__restricted_agents__") {
    return { name: restrictedLabel, initial: "?", color: "var(--muted-foreground)" };
  }
  const agent = agentsById.get(row.agentId);
  if (!agent) {
    return { name: deletedLabel, initial: "?", color: "var(--muted-foreground)" };
  }
  return {
    name: agent.name || deletedLabel,
    initial: (agent.name || "?").slice(0, 1).toUpperCase(),
    color: avatarColor(agent.id),
  };
}

/**
 * Axis maxima follow the mockup's 1/2/5 × 10ⁿ ladder. A cost chart whose
 * largest day is $3.20 should read $4, not $3.20, so the bar tops stay below
 * the top rule instead of touching it.
 */
function niceMax(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return 1;
  const exponent = Math.pow(10, Math.floor(Math.log10(value)));
  const fraction = value / exponent;
  const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return step * exponent;
}

function axisLabel(value: number, metric: UsageTrendMetric): string {
  if (metric === "cost") {
    return value >= 10 ? `$${value.toFixed(0)}` : `$${value.toFixed(2)}`;
  }
  if (metric === "tokens") return formatUsageTokens(value);
  return formatUsageInt(value);
}

function metricLabel(value: number, metric: UsageTrendMetric): string {
  if (metric === "cost") return formatUsageUsd(value);
  if (metric === "tokens") return formatUsageTokens(value);
  return formatUsageInt(value);
}

export function UsageOverviewView({
  overview,
  agents,
  pricings,
  days,
  viewTZ,
  locale,
  onDrillModel,
  onDrillAgent,
  onViewAllLogs,
}: {
  overview: UsageOverview;
  agents: Agent[];
  pricings: Record<string, unknown>;
  days: number;
  viewTZ: string;
  locale: string;
  onDrillModel: (provider: string, model: string) => void;
  onDrillAgent: (agentId: string) => void;
  onViewAllLogs: () => void;
}) {
  const { t } = useT("usage");
  const [metricOverride, setMetricOverride] = useState<UsageTrendMetric | null>(null);

  const totals = useMemo(
    () => usageTotals(overview.by_model),
    [overview.by_model, pricings],
  );
  // Cost is the primary lens, but a workspace whose models are all missing
  // from the rate table would render a flat, empty cost chart. Fall back to
  // tokens until the viewer picks another metric; the warning explains why
  // the money figures are zero.
  const metric: UsageTrendMetric =
    metricOverride ?? (totals.cost > 0 ? "cost" : "tokens");

  const rangeLabel = t(($) => $.range.days, { days });
  const modelRows = useMemo(
    () => usageModelRows(overview.by_model),
    [overview.by_model, pricings],
  );
  const agentRows = useMemo(
    () => usageAgentRows(overview.by_agent),
    [overview.by_agent, pricings],
  );
  const agentsById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );
  const unpricedModels = useMemo(
    () => collectUnmappedModels(overview.by_model),
    [overview.by_model, pricings],
  );

  const trend = useMemo(
    () =>
      usageTrendChart(
        overview.daily,
        overview.by_model,
        days,
        viewTZ,
        locale,
        metric,
        t(($) => $.overview.trend.other),
      ),
    [overview.daily, overview.by_model, days, viewTZ, locale, metric, t, pricings],
  );

  const callsByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of overview.daily) {
      map.set(row.date, (map.get(row.date) ?? 0) + row.call_count);
    }
    return map;
  }, [overview.daily]);

  const chartMax = useMemo(() => {
    let max = 0;
    for (const record of trend.data) {
      const total = trend.series.reduce(
        (sum, series) => sum + (Number(record[series.key]) || 0),
        0,
      );
      if (total > max) max = total;
    }
    return niceMax(max);
  }, [trend]);

  const xLabels = useMemo(() => {
    const step = days <= 7 ? 1 : days <= 30 ? 6 : 15;
    const labels: Array<{ index: number; label: string }> = [];
    for (let index = 0; index < trend.data.length; index += step) {
      const record = trend.data[index];
      if (record) labels.push({ index, label: String(record.label) });
    }
    const lastIndex = trend.data.length - 1;
    const lastRecord = trend.data[lastIndex];
    if (
      lastRecord &&
      (labels.length === 0 || labels[labels.length - 1]!.index !== lastIndex)
    ) {
      labels.push({ index: lastIndex, label: String(lastRecord.label) });
    }
    return labels;
  }, [days, trend.data]);

  const compositionRows = [
    {
      key: "input",
      label: t(($) => $.overview.composition.input),
      color: "var(--chart-1)",
      value: totals.breakdown.input,
    },
    {
      key: "output",
      label: t(($) => $.overview.composition.output),
      color: "var(--chart-2)",
      value: totals.breakdown.output,
    },
    {
      key: "cacheRead",
      label: t(($) => $.overview.composition.cache_read),
      color: "var(--chart-4)",
      value: totals.breakdown.cacheRead,
    },
    {
      key: "cacheWrite",
      label: t(($) => $.overview.composition.cache_write),
      color: "var(--chart-3)",
      value: totals.breakdown.cacheWrite,
    },
  ];
  const compositionTotal =
    compositionRows.reduce((sum, row) => sum + row.value, 0) || 1;
  const topAgentCost = Math.max(...agentRows.map((row) => row.cost), 1);

  if (overview.by_model.length === 0 && overview.daily.length === 0) {
    return (
      <div className="qw-us-state">
        <BarChart3 aria-hidden="true" />
        <h3>{t(($) => $.overview.empty_title)}</h3>
        <p>{t(($) => $.overview.empty_body)}</p>
      </div>
    );
  }

  return (
    <div className="qw-us-overview">
      <div className="qw-us-left">
        {unpricedModels.length > 0 ? (
          <p className="qw-us-note">
            <b>{t(($) => $.overview.unpriced_title)}</b>
            <span>
              {t(($) => $.overview.unpriced_body, {
                models: unpricedModels.join(", "),
              })}
            </span>
          </p>
        ) : null}

        <section
          className="qw-us-sec qw-us-chart"
          aria-label={t(($) => $.console.chart_title)}
        >
          <header className="qw-us-sec-head">
            <div>
              <h2>{t(($) => $.console.chart_title)}</h2>
              <p>
                {t(($) => $.overview.trend.subtitle, { range: rangeLabel })}
                {" · "}
                {metric === "cost"
                  ? t(($) => $.overview.trend.metric_cost)
                  : metric === "tokens"
                    ? t(($) => $.overview.trend.metric_tokens)
                    : t(($) => $.overview.trend.metric_calls)}
              </p>
            </div>
            <div
              className="qw-us-metric"
              role="group"
              aria-label={t(($) => $.overview.trend.metric_label)}
            >
              {(["cost", "tokens", "calls"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={metric === option}
                  data-active={metric === option ? "" : undefined}
                  onClick={() => setMetricOverride(option)}
                >
                  {option === "cost"
                    ? t(($) => $.overview.trend.metric_cost)
                    : option === "tokens"
                      ? t(($) => $.overview.trend.metric_tokens)
                      : t(($) => $.overview.trend.metric_calls)}
                </button>
              ))}
            </div>
          </header>

          <div className="qw-us-chart-box">
            <div className="qw-us-y" aria-hidden="true">
              {[1, 0.5, 0].map((fraction) => (
                <span key={fraction}>{axisLabel(chartMax * fraction, metric)}</span>
              ))}
            </div>
            <div
              className="qw-us-plot"
              key={`${metric}:${days}:${trend.total.toFixed(6)}`}
              role="img"
              aria-label={`${t(($) => $.console.chart_title)} ${rangeLabel}`}
            >
              {trend.data.map((record, index) => {
                const segments = trend.series
                  .map((series) => ({
                    key: series.key,
                    color: series.color,
                    value: Number(record[series.key]) || 0,
                  }))
                  .filter((segment) => segment.value > 0);
                const total = segments.reduce((sum, segment) => sum + segment.value, 0);
                const calls = callsByDate.get(String(record.date)) ?? 0;
                const title =
                  metric === "calls"
                    ? `${String(record.label)} · ${formatUsageInt(calls)}`
                    : `${String(record.label)} · ${metricLabel(total, metric)} · ${formatUsageInt(calls)}`;
                return (
                  <div
                    key={String(record.date)}
                    className={`qw-us-day${index === trend.data.length - 1 ? " is-today" : ""}${total === 0 ? " is-flat" : ""}`}
                    title={title}
                  >
                    <div
                      className="qw-us-stack"
                      style={{
                        height: total === 0 ? "1px" : `${(total / chartMax) * 100}%`,
                        animationDelay: `${Math.min(index, 60) * 4}ms`,
                      }}
                    >
                      {segments.map((segment) => (
                        <i
                          key={segment.key}
                          style={{
                            flex: `${segment.value} 1 0`,
                            background: segment.color,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="qw-us-x" aria-hidden="true">
            {xLabels.map((item, index) => {
              const percent =
                trend.data.length > 1
                  ? (item.index / (trend.data.length - 1)) * 100
                  : 0;
              const style =
                index === 0
                  ? { left: 0 }
                  : index === xLabels.length - 1
                    ? { right: 0 }
                    : { left: `${percent}%`, transform: "translateX(-50%)" };
              return (
                <span key={`${item.index}-${item.label}`} style={style}>
                  {item.label}
                </span>
              );
            })}
          </div>

          <div className="qw-us-legend">
            {trend.series
              .filter((series) => series.total > 0)
              .map((series) => (
                <span key={series.key} className="qw-us-legend-item">
                  <i style={{ background: series.color }} />
                  {series.label}
                  <b>{metricLabel(series.total, metric)}</b>
                </span>
              ))}
          </div>
        </section>

        <section
          className="qw-us-sec qw-us-models"
          aria-label={t(($) => $.overview.models.detail_title)}
        >
          <header className="qw-us-sec-head">
            <div>
              <h2>{t(($) => $.overview.models.detail_title)}</h2>
              <p>
                {t(($) => $.overview.models.detail_subtitle, { range: rangeLabel })}
              </p>
            </div>
            <button type="button" className="qw-us-link" onClick={onViewAllLogs}>
              {t(($) => $.overview.models.view_logs)} →
            </button>
          </header>
          <div className="qw-us-model-wrap">
            <table className="qw-us-table">
              <thead>
                <tr>
                  <th scope="col">{t(($) => $.logs.table.model)}</th>
                  <th scope="col">{t(($) => $.overview.models.col_calls)}</th>
                  <th scope="col" className="qw-us-col-in">
                    {t(($) => $.overview.models.col_input)}
                  </th>
                  <th scope="col" className="qw-us-col-out">
                    {t(($) => $.overview.models.col_output)}
                  </th>
                  <th scope="col" className="qw-us-col-cache">
                    {t(($) => $.overview.models.col_cache_read)}
                  </th>
                  <th scope="col">{t(($) => $.overview.models.col_hit)}</th>
                  <th scope="col">{t(($) => $.overview.models.col_avg)}</th>
                  <th scope="col">{t(($) => $.overview.models.col_cost)}</th>
                  <th scope="col">{t(($) => $.overview.models.col_share)}</th>
                </tr>
              </thead>
              <tbody>
                {modelRows.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <div className="qw-us-empty">
                        {t(($) => $.overview.empty_body)}
                      </div>
                    </td>
                  </tr>
                ) : (
                  modelRows.map((row) => (
                    <tr
                      key={`${row.provider} ${row.model}`}
                      tabIndex={0}
                      role="link"
                      title={t(($) => $.overview.models.row_action, {
                        model: row.model,
                      })}
                      onClick={() => onDrillModel(row.provider, row.model)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onDrillModel(row.provider, row.model);
                        }
                      }}
                    >
                      <td>
                        <span className="qw-us-model-name">
                          <ProviderLogo
                            provider={row.provider}
                            className="qw-us-model-mark"
                          />
                          <span className="m">
                            <b>{row.model}</b>
                            <small>{row.provider}</small>
                          </span>
                        </span>
                      </td>
                      <td className="num">{formatUsageInt(row.calls)}</td>
                      <td className="num qw-us-col-in" title={formatUsageInt(row.input)}>
                        {formatUsageTokens(row.input)}
                      </td>
                      <td className="num qw-us-col-out" title={formatUsageInt(row.output)}>
                        {formatUsageTokens(row.output)}
                      </td>
                      <td
                        className="num qw-us-col-cache"
                        title={`${formatUsageInt(row.cacheRead)} / ${formatUsageInt(row.cacheWrite)}`}
                      >
                        {formatUsageTokens(row.cacheRead)}
                      </td>
                      <td className="num">{formatUsagePercent(row.hitRate)}</td>
                      <td className="num">{formatUsageUsd(row.avgCost)}</td>
                      <td className="cost">{formatUsageUsd(row.cost)}</td>
                      <td>
                        <span className="qw-us-share">
                          <span className="qw-us-share-bar">
                            <i
                              style={{
                                width: `${Math.max(0, Math.min(100, row.share))}%`,
                                background: row.color,
                              }}
                            />
                          </span>
                          <em>{formatUsagePercent(row.share)}</em>
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="qw-us-footnote">
            {t(($) => $.overview.models.footnote)}
          </p>
        </section>
      </div>

      <aside className="qw-us-rail">
        <section className="qw-us-rail-sec">
          <div className="qw-us-rail-head">
            <h3>{t(($) => $.overview.composition.title)}</h3>
            <span>{`${days}D`}</span>
          </div>
          <div className="qw-us-comp-bar" aria-hidden="true">
            {compositionRows.map((row) => (
              <i
                key={row.key}
                style={{
                  width: `${(row.value / compositionTotal) * 100}%`,
                  background: row.color,
                }}
              />
            ))}
          </div>
          <div className="qw-us-comp-rows">
            {compositionRows.map((row) => (
              <div key={row.key} className="qw-us-comp-row">
                <i style={{ background: row.color }} />
                <span>{row.label}</span>
                <b>{formatUsageUsd(row.value)}</b>
                <em>{formatUsagePercent((row.value / compositionTotal) * 100)}</em>
              </div>
            ))}
          </div>
          <div className="qw-us-saved">
            <div className="k">{t(($) => $.overview.composition.saved_label)}</div>
            <div className="v">{formatUsageUsd(totals.savings)}</div>
            <div className="h">
              {t(($) => $.overview.composition.saved_hint, {
                rate: formatUsagePercent(totals.cacheHitRate),
              })}
            </div>
          </div>
        </section>

        <section className="qw-us-rail-sec">
          <div className="qw-us-rail-head">
            <h3>{t(($) => $.overview.agents.title)}</h3>
            <span>{t(($) => $.console.top5)}</span>
          </div>
          <div className="qw-us-agents">
            {agentRows.slice(0, 5).map((row, index) => {
              const display = agentDisplay(
                row,
                agentsById,
                t(($) => $.overview.agents.restricted),
                t(($) => $.overview.agents.deleted),
              );
              const failRate = (row.failed / Math.max(1, row.calls)) * 100;
              const hint = t(($) => $.overview.agents.row_hint, {
                calls: formatUsageInt(row.calls),
                rate: formatUsagePercent(failRate),
              });
              const canDrill = row.agentId !== "__restricted_agents__";
              return (
                <button
                  key={row.agentId}
                  type="button"
                  className="qw-us-agent-row"
                  disabled={!canDrill}
                  title={canDrill ? hint : `${display.name} · ${hint}`}
                  onClick={() => onDrillAgent(row.agentId)}
                >
                  <span className="qw-us-agent-rank">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span
                    className="qw-us-agent-ava"
                    style={{ background: display.color }}
                    aria-hidden="true"
                  >
                    {display.initial}
                  </span>
                  <span className="qw-us-agent-name">{display.name}</span>
                  <span className="qw-us-agent-cost">{formatUsageUsd(row.cost)}</span>
                  <span className="qw-us-agent-bar" aria-hidden="true">
                    <i style={{ width: `${(row.cost / topAgentCost) * 100}%` }} />
                  </span>
                </button>
              );
            })}
            {agentRows.length === 0 ? (
              <p className="qw-us-empty">{t(($) => $.overview.empty_body)}</p>
            ) : null}
          </div>
          {agentRows.length > 0 ? (
            <p className="qw-us-footnote">
              {t(($) => $.overview.agents.footnote)}
            </p>
          ) : null}
        </section>
      </aside>
    </div>
  );
}
