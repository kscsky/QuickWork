"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Download,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@quickwork/ui/components/ui/skeleton";
import type { Agent, UsageLogRow, UsageModelSummary } from "@quickwork/core/types";
import { useWorkspaceSlug, paths } from "@quickwork/core/paths";
import { fetchAllUsageLogs, usageLogsOptions } from "@quickwork/core/dashboard";
import { useT } from "../../i18n";
import { AppLink } from "../../navigation";
import { ProviderLogo } from "../../runtimes/components/provider-logo";
import { collectUnmappedModels, isModelPriced } from "../../runtimes/utils";
import {
  formatUsageDuration,
  formatUsageInt,
  formatUsagePercent,
  formatUsageTokens,
  formatUsageUsd,
  formatUsageUsd4,
  usageLogCost,
  usageLogCostBreakdown,
  usageLogTimeParts,
  usageLogTimestamp,
  usageLogsToCsv,
  usageTotals,
  type UsageModelRow,
} from "../usage-utils";
import "./usage.css";

const EMPTY_SUMMARY_MODELS: UsageModelSummary[] = [];
const DETAIL_COLUMNS = 10;

type StatusKey = "all" | "success" | "failed" | "cancelled" | "running";
type SortKey = "time" | "duration" | "input" | "output" | "cache";

interface UsageProjectOption {
  id: string;
  title: string;
}

type StatusLabelKey = "success" | "failed" | "cancelled" | "running" | "unknown";

const STATUS_META: Record<
  string,
  { color: string; labelKey: StatusLabelKey }
> = {
  success: { color: "var(--success)", labelKey: "success" },
  failed: { color: "var(--destructive)", labelKey: "failed" },
  cancelled: { color: "var(--faint-foreground)", labelKey: "cancelled" },
  running: { color: "var(--inflight)", labelKey: "running" },
};

function statusTone(status: string): { color: string; labelKey: StatusLabelKey } {
  return STATUS_META[status] ?? {
    color: "var(--faint-foreground)",
    labelKey: "unknown",
  };
}

type TriggerLabelKey =
  | "comment"
  | "autopilot"
  | "direct"
  | "retry"
  | "rerun"
  | "chat"
  | "quick_create"
  | "other";

function triggerKey(trigger: string): TriggerLabelKey {
  switch (trigger) {
    case "comment":
    case "autopilot":
    case "direct":
    case "retry":
    case "rerun":
    case "chat":
    case "quick_create":
      return trigger;
    default:
      return "other";
  }
}

function avatarColor(id: string): string {
  const colors = [
    "var(--zone-1)",
    "var(--zone-2)",
    "var(--zone-3)",
    "var(--zone-4)",
    "var(--zone-5)",
    "var(--zone-6)",
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return colors[Math.abs(hash) % colors.length]!;
}

function pageNumbers(page: number, pages: number): Array<number | "gap"> {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  const out: Array<number | "gap"> = [1];
  if (page > 3) out.push("gap");
  const start = Math.max(2, page - 1);
  const end = Math.min(pages - 1, page + 1);
  for (let index = start; index <= end; index++) out.push(index);
  if (page < pages - 2) out.push("gap");
  out.push(pages);
  return out;
}

function TokenBar({ row }: { row: UsageLogRow }) {
  const total =
    row.input_tokens + row.output_tokens + row.cache_read_tokens + row.cache_write_tokens;
  const parts = [
    { key: "input", value: row.input_tokens, color: "var(--chart-1)" },
    { key: "output", value: row.output_tokens, color: "var(--chart-2)" },
    { key: "cacheRead", value: row.cache_read_tokens, color: "var(--chart-4)" },
    { key: "cacheWrite", value: row.cache_write_tokens, color: "var(--chart-3)" },
  ];
  return (
    <div className="qw-us-detail-tokens" aria-hidden="true">
      {parts.map((part) => (
        <i
          key={part.key}
          style={{
            width: `${total > 0 ? (part.value / total) * 100 : 0}%`,
            background: part.color,
          }}
        />
      ))}
    </div>
  );
}

export function UsageLogView({
  wsId,
  days,
  projectId,
  projectName,
  viewTZ,
  agents,
  projects,
  pricings,
  modelOptions,
  modelFilter,
  onModelFilterChange,
  agentFilter,
  onAgentFilterChange,
}: {
  wsId: string;
  days: number;
  projectId: string | null;
  projectName: string;
  viewTZ: string;
  agents: Agent[];
  projects: UsageProjectOption[];
  pricings: Record<string, unknown>;
  modelOptions: readonly UsageModelRow[];
  modelFilter: { provider: string; model: string } | null;
  onModelFilterChange: (value: { provider: string; model: string } | null) => void;
  agentFilter: string | null;
  onAgentFilterChange: (value: string | null) => void;
}) {
  const { t } = useT("usage");
  const slug = useWorkspaceSlug();

  const [status, setStatus] = useState<StatusKey>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<SortKey>("time");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 180);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
    setExpanded(new Set());
    // Model filter identity is compared by field, not by object, because the
    // parent rebuilds it on every render.
  }, [
    status,
    agentFilter,
    query,
    days,
    projectId,
    sort,
    dir,
    modelFilter?.provider,
    modelFilter?.model,
  ]);

  const logsParams = useMemo(
    () => ({
      days,
      projectId,
      tz: viewTZ,
      status: status === "all" ? undefined : status,
      provider: modelFilter?.provider,
      model: modelFilter?.model,
      agentId: agentFilter ?? undefined,
      q: query || undefined,
      page,
      pageSize,
      sort,
      dir,
    }),
    [
      days,
      projectId,
      viewTZ,
      status,
      modelFilter,
      agentFilter,
      query,
      page,
      pageSize,
      sort,
      dir,
    ],
  );

  const logsQuery = useQuery(usageLogsOptions(wsId, logsParams));
  const data = logsQuery.data;
  const rows = data?.rows ?? [];
  const summaryModels = data?.summary.by_model ?? EMPTY_SUMMARY_MODELS;
  const totals = useMemo(() => usageTotals(summaryModels), [summaryModels, pricings]);
  const counts = data?.summary.status_counts;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const failRate = totals.calls > 0 ? (totals.failed / totals.calls) * 100 : 0;
  const rangeLabel = t(($) => $.range.days, { days });

  useEffect(() => {
    if (data && page > totalPages) setPage(totalPages);
  }, [data, page, totalPages]);

  const unpricedModels = useMemo(
    () => collectUnmappedModels(summaryModels),
    [summaryModels, pricings],
  );
  const agentsById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const agentOptionValues = useMemo(
    () => new Set(agents.map((agent) => agent.id)),
    [agents],
  );
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  // A deleted agent can still own historical rows (and be drilled into from
  // the overview rail). The picker must keep naming it instead of falling
  // back to a blank selected value.
  const filteredAgentName = agentFilter
    ? rows.find((row) => row.agent_id === agentFilter)?.agent_name
    : undefined;

  const modelSelectValue = modelFilter
    ? `${modelFilter.provider}::${modelFilter.model}`
    : "all";
  const modelOptionValues = new Set(
    modelOptions.map((option) => `${option.provider}::${option.model}`),
  );

  const activeFilters =
    status !== "all" ||
    agentFilter != null ||
    modelFilter != null ||
    search.trim().length > 0;

  const resetFilters = () => {
    setStatus("all");
    setSearch("");
    setQuery("");
    onModelFilterChange(null);
    onAgentFilterChange(null);
    setPage(1);
  };

  const toggleExpanded = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const changeSort = (next: SortKey) => {
    if (sort === next) setDir((current) => (current === "desc" ? "asc" : "desc"));
    else {
      setSort(next);
      setDir("desc");
    }
    setPage(1);
  };

  const sortIndicator = (key: SortKey) => {
    if (sort !== key) return "↕";
    return dir === "asc" ? "↑" : "↓";
  };

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const result = await fetchAllUsageLogs({
        days,
        projectId,
        tz: viewTZ,
        status: status === "all" ? undefined : status,
        provider: modelFilter?.provider,
        model: modelFilter?.model,
        agentId: agentFilter ?? undefined,
        q: query || undefined,
        sort: sort === "time" ? undefined : sort,
        dir,
      });
      if (result.truncated) {
        toast.error(t(($) => $.logs.export_too_large, { limit: formatUsageInt(20000) }));
        return;
      }
      if (result.rows.length === 0) {
        toast.error(t(($) => $.logs.export_empty));
        return;
      }
      const blob = new Blob(["﻿" + usageLogsToCsv(result.rows)], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `quickwork-usage-${days}d-${Date.now()}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(t(($) => $.logs.export_success, { count: result.rows.length }));
    } catch {
      toast.error(t(($) => $.logs.export_failed));
    } finally {
      setExporting(false);
    }
  };

  const statuses: Array<{ key: StatusKey; label: string; count: number }> = [
    { key: "all", label: t(($) => $.logs.status.all), count: counts?.all ?? 0 },
    { key: "success", label: t(($) => $.logs.status.success), count: counts?.success ?? 0 },
    { key: "failed", label: t(($) => $.logs.status.failed), count: counts?.failed ?? 0 },
    { key: "cancelled", label: t(($) => $.logs.status.cancelled), count: counts?.cancelled ?? 0 },
  ];
  if ((counts?.running ?? 0) > 0 || status === "running") {
    statuses.push({
      key: "running",
      label: t(($) => $.logs.status.running),
      count: counts?.running ?? 0,
    });
  }

  const sortableHeader = (key: SortKey, label: string, className?: string) => (
    <th
      scope="col"
      aria-sort={sort === key ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={className}
    >
      <button type="button" onClick={() => changeSort(key)}>
        {label}
        <span className="qw-us-sort-arrow" data-active={sort === key ? "" : undefined}>
          {sortIndicator(key)}
        </span>
      </button>
    </th>
  );

  if (logsQuery.isError && !data) {
    return (
      <div className="qw-us-state">
        <h3>{t(($) => $.logs.error_title)}</h3>
        <p>{t(($) => $.logs.error_body)}</p>
        <button type="button" className="qw-us-btn" onClick={() => void logsQuery.refetch()}>
          {t(($) => $.logs.error_retry)}
        </button>
      </div>
    );
  }

  const kpis = [
    {
      key: "calls",
      label: t(($) => $.logs.summary.calls),
      value: logsQuery.isLoading ? "—" : formatUsageInt(totals.calls),
      hint: t(($) => $.logs.summary.calls_hint, {
        success: formatUsageInt(totals.success),
        failed: formatUsageInt(totals.failed),
        cancelled: formatUsageInt(totals.cancelled),
      }),
    },
    {
      key: "cost",
      label: t(($) => $.logs.summary.cost),
      value: logsQuery.isLoading ? "—" : formatUsageUsd(totals.cost),
      hint: t(($) => $.logs.summary.cost_hint),
    },
    {
      key: "avg",
      label: t(($) => $.logs.summary.avg),
      value: logsQuery.isLoading
        ? "—"
        : formatUsageUsd(totals.calls > 0 ? totals.cost / totals.calls : 0),
      hint: t(($) => $.logs.summary.avg_hint),
    },
    {
      key: "fail",
      label: t(($) => $.logs.summary.fail_rate),
      value: logsQuery.isLoading ? "—" : formatUsagePercent(failRate),
      hint: t(($) => $.logs.summary.fail_hint, { failed: formatUsageInt(totals.failed) }),
    },
  ];

  return (
    <div className="qw-us-logs">
      <h2 className="sr-only">{t(($) => $.logs.title)}</h2>

      <section className="qw-us-kpis" aria-label={t(($) => $.logs.title)}>
        {kpis.map((kpi) => (
          <div key={kpi.key} className="qw-us-kpi">
            <div className="k">{kpi.label}</div>
            <div className="v">{kpi.value}</div>
            <div className="h">{kpi.hint}</div>
          </div>
        ))}
      </section>

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

      <div className="qw-us-log-bar">
        <div className="qw-us-status" role="group" aria-label={t(($) => $.logs.status.all)}>
          {statuses.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={status === item.key}
              data-active={status === item.key ? "" : undefined}
              onClick={() => setStatus(item.key)}
            >
              {item.label}
              <em>{formatUsageInt(item.count)}</em>
            </button>
          ))}
        </div>
        <select
          className="qw-us-select"
          aria-label={t(($) => $.logs.filters.model_label)}
          value={modelSelectValue}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "all") onModelFilterChange(null);
            else {
              const [provider, ...rest] = value.split("::");
              onModelFilterChange({ provider: provider ?? "", model: rest.join("::") });
            }
          }}
        >
          <option value="all">{t(($) => $.logs.filters.all_models)}</option>
          {modelOptions.map((option) => (
            <option
              key={`${option.provider}::${option.model}`}
              value={`${option.provider}::${option.model}`}
            >
              {option.model}
            </option>
          ))}
          {modelFilter && !modelOptionValues.has(modelSelectValue) ? (
            <option value={modelSelectValue}>{modelFilter.model}</option>
          ) : null}
        </select>
        <select
          className="qw-us-select"
          aria-label={t(($) => $.logs.filters.agent_label)}
          value={agentFilter ?? "all"}
          onChange={(event) => {
            const value = event.target.value;
            onAgentFilterChange(value === "all" ? null : value);
          }}
        >
          <option value="all">{t(($) => $.logs.filters.all_agents)}</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
          {agentFilter && !agentOptionValues.has(agentFilter) ? (
            <option value={agentFilter}>
              {filteredAgentName || t(($) => $.logs.unknown_agent)}
            </option>
          ) : null}
        </select>
        <label className="qw-us-search">
          <Search aria-hidden="true" />
          <span className="sr-only">{t(($) => $.logs.search_placeholder)}</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t(($) => $.logs.search_placeholder)}
            autoComplete="off"
          />
        </label>
        {activeFilters ? (
          <button type="button" className="qw-us-reset" onClick={resetFilters}>
            {t(($) => $.logs.filters.reset)}
          </button>
        ) : null}
        <button
          type="button"
          className="qw-us-export"
          onClick={() => void handleExport()}
          disabled={exporting}
        >
          {exporting ? (
            <RefreshCw className="animate-spin" aria-hidden="true" />
          ) : (
            <Download aria-hidden="true" />
          )}
          {t(($) => $.logs.export)}
        </button>
      </div>

      <div className="qw-us-log-wrap">
        <table className="qw-us-log-table">
          <thead>
            <tr>
              {sortableHeader("time", t(($) => $.logs.table.time))}
              <th scope="col">{t(($) => $.logs.table.status)}</th>
              <th scope="col">{t(($) => $.logs.table.issue)}</th>
              <th scope="col" className="qw-us-col-agent">
                {t(($) => $.logs.table.agent)}
              </th>
              <th scope="col">{t(($) => $.logs.table.model)}</th>
              {sortableHeader("input", t(($) => $.logs.table.input))}
              {sortableHeader("output", t(($) => $.logs.table.output), "qw-us-col-output")}
              {sortableHeader("cache", t(($) => $.logs.table.cache), "qw-us-col-cache")}
              {sortableHeader("duration", t(($) => $.logs.table.duration))}
              <th scope="col">{t(($) => $.logs.table.cost)}</th>
            </tr>
          </thead>
          <tbody>
            {logsQuery.isLoading ? (
              Array.from({ length: 9 }).map((_, index) => (
                <tr key={index}>
                  <td colSpan={DETAIL_COLUMNS} className="qw-us-log-loading">
                    <Skeleton className="h-6 w-full" />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={DETAIL_COLUMNS}>
                  <div className="qw-us-empty">
                    <p>{t(($) => $.logs.empty_title)}</p>
                    <p>{t(($) => $.logs.empty_body)}</p>
                    <button type="button" className="qw-us-btn" onClick={resetFilters}>
                      {t(($) => $.logs.empty_reset)}
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const open = expanded.has(row.id);
                const tone = statusTone(row.status);
                const statusLabel = t(($) => $.logs.status[tone.labelKey]);
                const agent = agentsById.get(row.agent_id);
                const agentLabel = row.agent_restricted
                  ? t(($) => $.logs.restricted_agent)
                  : row.agent_name || agent?.name || t(($) => $.logs.unknown_agent);
                const time = usageLogTimeParts(row.created_at, viewTZ);
                const cost = usageLogCost(row);
                const reported = row.cost_usd_ticks !== undefined;
                const issueHref =
                  slug && row.issue_id
                    ? paths.workspace(slug).issueDetail(row.issue_id)
                    : null;
                const project = projectsById.get(row.project_id);
                const breakdown = usageLogCostBreakdown(row);
                const tokenTotal =
                  row.input_tokens +
                  row.output_tokens +
                  row.cache_read_tokens +
                  row.cache_write_tokens;
                const durationMs =
                  row.started_at && row.completed_at
                    ? Math.max(
                        0,
                        new Date(row.completed_at).getTime() -
                          new Date(row.started_at).getTime(),
                      )
                    : null;

                return (
                  <Fragment key={row.id}>
                    <tr
                      className="qw-us-log-row"
                      data-open={open ? "" : undefined}
                      tabIndex={0}
                      aria-expanded={open}
                      onClick={() => toggleExpanded(row.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          toggleExpanded(row.id);
                        }
                      }}
                    >
                      <td>
                        <span className="qw-us-log-time">
                          {time.date} {time.time.slice(0, 5)}
                        </span>
                      </td>
                      <td>
                        <span className="qw-us-log-status">
                          <i style={{ background: tone.color }} />
                          {statusLabel}
                        </span>
                      </td>
                      <td>
                        <span className="qw-us-log-task">
                          <b>
                            {row.issue_identifier ? (
                              <AppLink
                                href={issueHref ?? "#"}
                                onClick={(event) => event.stopPropagation()}
                              >
                                {row.issue_identifier}
                              </AppLink>
                            ) : (
                              t(($) => $.logs.no_issue)
                            )}
                          </b>
                          <span title={row.issue_title}>
                            {row.issue_title || "—"}
                          </span>
                        </span>
                      </td>
                      <td className="qw-us-col-agent">
                        <span className="qw-us-log-agent">
                          <span
                            className="ava"
                            style={{
                              background: row.agent_restricted
                                ? "var(--muted-foreground)"
                                : avatarColor(row.agent_id),
                            }}
                            aria-hidden="true"
                          >
                            {row.agent_restricted
                              ? "?"
                              : (agentLabel || "?").slice(0, 1).toUpperCase()}
                          </span>
                          <span title={agentLabel}>{agentLabel}</span>
                        </span>
                      </td>
                      <td>
                        <span
                          className="qw-us-log-model"
                          title={`${row.model} · ${row.provider}`}
                        >
                          <ProviderLogo
                            provider={row.provider}
                            className="qw-us-model-mark"
                          />
                          <span>{row.model}</span>
                        </span>
                      </td>
                      <td className="num" title={formatUsageInt(row.input_tokens)}>
                        {formatUsageTokens(row.input_tokens)}
                      </td>
                      <td
                        className="num qw-us-col-output"
                        title={formatUsageInt(row.output_tokens)}
                      >
                        {formatUsageTokens(row.output_tokens)}
                      </td>
                      <td
                        className="num qw-us-col-cache"
                        title={`${formatUsageInt(row.cache_read_tokens)} / ${formatUsageInt(row.cache_write_tokens)}`}
                      >
                        {formatUsageTokens(row.cache_read_tokens)} /{" "}
                        {formatUsageTokens(row.cache_write_tokens)}
                      </td>
                      <td className="num">{formatUsageDuration(durationMs)}</td>
                      <td>
                        <span className="qw-us-log-cost">
                          {row.status === "running"
                            ? "—"
                            : `${reported ? "" : "≈ "}${formatUsageUsd(cost)}`}
                        </span>
                      </td>
                    </tr>
                    {open ? (
                      <tr className="qw-us-log-detail">
                        <td colSpan={DETAIL_COLUMNS}>
                          <div className="qw-us-detail">
                            <div className="qw-us-detail-main">
                              <div className="qw-us-detail-label">
                                {t(($) => $.logs.detail.tokens)}
                              </div>
                              {tokenTotal === 0 ? (
                                <div className="qw-us-detail-note">
                                  {row.status === "running"
                                    ? t(($) => $.logs.detail.running_usage)
                                    : t(($) => $.logs.detail.no_usage)}
                                </div>
                              ) : (
                                <>
                                  <TokenBar row={row} />
                                  <div className="qw-us-detail-meta">
                                    <span>
                                      {t(($) => $.logs.detail.input)}{" "}
                                      <b>{formatUsageInt(row.input_tokens)}</b>
                                    </span>
                                    <span>
                                      {t(($) => $.logs.detail.output)}{" "}
                                      <b>{formatUsageInt(row.output_tokens)}</b>
                                    </span>
                                    <span>
                                      {t(($) => $.logs.detail.cache_read)}{" "}
                                      <b>{formatUsageInt(row.cache_read_tokens)}</b>
                                    </span>
                                    <span>
                                      {t(($) => $.logs.detail.cache_write)}{" "}
                                      <b>{formatUsageInt(row.cache_write_tokens)}</b>
                                    </span>
                                  </div>
                                </>
                              )}
                              <div className="qw-us-detail-meta">
                                <span>
                                  {t(($) => $.logs.detail.task_id)}{" "}
                                  <b>{row.task_id}</b>
                                </span>
                                <span>
                                  {t(($) => $.logs.detail.trigger)}{" "}
                                  <b>{t(($) => $.logs.trigger[triggerKey(row.trigger)])}</b>
                                </span>
                                <span>
                                  {t(($) => $.logs.detail.started)}{" "}
                                  <b>{usageLogTimestamp(row.started_at, viewTZ)}</b>
                                </span>
                                <span>
                                  {t(($) => $.logs.detail.agent_project)}{" "}
                                  <b>
                                    {agentLabel} · {project?.title ?? "—"}
                                  </b>
                                </span>
                              </div>
                              {row.failure_reason ? (
                                <div className="qw-us-detail-failure">
                                  {row.failure_reason}
                                </div>
                              ) : null}
                              {!reported && !isModelPriced(row.model, row.provider) ? (
                                <p className="qw-us-detail-note">
                                  {t(($) => $.logs.detail.unpriced)}
                                </p>
                              ) : null}
                              {issueHref ? (
                                <AppLink
                                  href={issueHref}
                                  className="qw-us-open-task"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  {t(($) => $.logs.detail.view_run)}
                                  <ArrowUpRight aria-hidden="true" />
                                </AppLink>
                              ) : null}
                            </div>
                            <div className="qw-us-rate">
                              {tokenTotal === 0 ? (
                                <div className="row">
                                  <span>{t(($) => $.logs.detail.total)}</span>
                                  <span>—</span>
                                </div>
                              ) : (
                                <>
                                  <div className="row">
                                    <span>{t(($) => $.logs.detail.input)}</span>
                                    <span>{formatUsageUsd4(breakdown.input)}</span>
                                  </div>
                                  <div className="row">
                                    <span>{t(($) => $.logs.detail.output)}</span>
                                    <span>{formatUsageUsd4(breakdown.output)}</span>
                                  </div>
                                  <div className="row">
                                    <span>{t(($) => $.logs.detail.cache_read)}</span>
                                    <span>{formatUsageUsd4(breakdown.cacheRead)}</span>
                                  </div>
                                  <div className="row">
                                    <span>{t(($) => $.logs.detail.cache_write)}</span>
                                    <span>{formatUsageUsd4(breakdown.cacheWrite)}</span>
                                  </div>
                                  <div className="row tot">
                                    <span>{t(($) => $.logs.detail.total)}</span>
                                    <span>
                                      {row.status === "running"
                                        ? "—"
                                        : `${reported ? "" : "≈ "}${formatUsageUsd4(cost)}`}
                                    </span>
                                  </div>
                                </>
                              )}
                              <div className="src">
                                {row.status === "running"
                                  ? t(($) => $.logs.detail.running_usage)
                                  : reported
                                    ? t(($) => $.logs.detail.reported)
                                    : t(($) => $.logs.detail.estimated)}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="qw-us-logs-foot">
        <div className="left">
          <span>
            {t(($) => $.logs.pagination.showing, {
              from: formatUsageInt(total === 0 ? 0 : (page - 1) * pageSize + 1),
              to: formatUsageInt(Math.min(page * pageSize, total)),
              total: formatUsageInt(total),
            })}
          </span>
          <span aria-hidden="true">·</span>
          <span>{rangeLabel}</span>
          <select
            className="qw-us-perpage"
            aria-label={t(($) => $.logs.pagination.per_page_label)}
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}
          >
            {[25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {t(($) => $.logs.pagination.per_page, { count: size })}
              </option>
            ))}
          </select>
          {logsQuery.isFetching && !logsQuery.isLoading ? (
            <RefreshCw
              className="size-3 animate-spin text-faint-foreground"
              aria-label={t(($) => $.header.refresh)}
            />
          ) : null}
        </div>
        <div className="right">
          <button
            type="button"
            className="qw-us-pagebtn"
            aria-label={t(($) => $.logs.pagination.prev)}
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          {pageNumbers(page, totalPages).map((item, index) =>
            item === "gap" ? (
              <span key={`gap-${index}`} className="qw-us-pagegap">
                …
              </span>
            ) : (
              <button
                key={item}
                type="button"
                className="qw-us-pagebtn"
                aria-current={item === page ? "page" : undefined}
                onClick={() => setPage(item)}
              >
                {item}
              </button>
            ),
          )}
          <button
            type="button"
            className="qw-us-pagebtn"
            aria-label={t(($) => $.logs.pagination.next)}
            disabled={page >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </div>
      <p className="qw-us-logs-note">
        {t(($) => $.logs.subtitle, { range: rangeLabel, project: projectName })}
      </p>
    </div>
  );
}
