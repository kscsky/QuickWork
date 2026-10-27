"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Cpu,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useAuthStore } from "@quickwork/core/auth";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useWorkspacePaths } from "@quickwork/core/paths";
import { modelPoolCatalogOptions } from "@quickwork/core/model-pool";
import { runtimeListOptions, runtimeModelsOptions } from "@quickwork/core/runtimes";
import { agentListOptions } from "@quickwork/core/workspace/queries";
import type { AgentRuntime, RuntimeModel } from "@quickwork/core/types";
import { useT } from "../../i18n";
import { useNavigation } from "../../navigation";
import { ProviderKeyDialog } from "./provider-key-dialog";

type HarnessFit = "direct" | "gateway" | "none";
type PoolFilter = "all" | "tools" | "bound" | "long";
type PoolView = "table" | "matrix";

interface PoolItem {
  key: string;
  id: string;
  name: string;
  source: string;
  sourceLabel: string;
  protocol: string;
  context: number;
  tools: boolean | null;
  reasoning: boolean;
  free: boolean;
  runtimeId: string | null;
}

const SOURCE_ORDER: Record<string, number> = {
  runtime: 0,
  openrouter: 1,
  nvidia: 2,
};

const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  opencode: "OpenCode",
  qwen: "Qwen Code",
  gemini: "Gemini CLI",
  pi: "Pi",
  openclaw: "OpenClaw",
};

const HARNESSES = [
  { key: "cc", label: "Claude Code" },
  { key: "cx", label: "Codex CLI" },
  { key: "oc", label: "OpenCode" },
  { key: "cl", label: "Cline / Roo" },
  { key: "qc", label: "Qwen Code" },
  { key: "gc", label: "Gemini CLI" },
] as const;

function formatContext(value: number): string {
  if (!value || value <= 0) return "—";
  if (value >= 1_000_000) {
    return `${Math.round((value / 1_000_000) * 10) / 10}M`;
  }
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return String(value);
}

function providerLabel(provider: string | undefined) {
  if (!provider) return "Runtime";
  return PROVIDER_LABELS[provider] ?? provider;
}

function runtimeAccepts(item: PoolItem, runtime: AgentRuntime): boolean {
  if (item.runtimeId) return item.runtimeId === runtime.id;
  if (runtime.provider === "claude") return item.protocol === "anthropic";
  return item.protocol === "openai";
}

function harnessFits(item: PoolItem): Record<string, HarnessFit> {
  const openai = item.protocol !== "anthropic";
  return {
    cc: openai ? "gateway" : "direct",
    cx: openai ? "direct" : "none",
    oc: openai ? "direct" : "none",
    cl: openai ? "direct" : "none",
    qc: openai ? "direct" : "none",
    gc: "none",
  };
}

function ModelConnectionTest({
  item,
  runtimeProvider,
  runtimeName,
  runtimeId,
}: {
  item: PoolItem;
  runtimeProvider: string;
  runtimeName: string;
  runtimeId: string;
}) {
  const { t } = useT("settings");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<null | {
    tone: "ok" | "warn" | "error";
    text: string;
  }>(null);

  const run = () => {
    setTesting(true);
    setResult({ tone: "warn", text: t(($) => $.model_pool.test_testing) });
    window.setTimeout(() => {
      setTesting(false);
      if (item.source === "runtime") {
        const belongs = item.runtimeId === runtimeId;
        setResult({
          tone: belongs ? "ok" : "error",
          text: belongs
            ? t(($) => $.model_pool.test_runtime_ok)
            : t(($) => $.model_pool.test_other_runtime),
        });
        return;
      }
      if (runtimeProvider === "claude" && item.protocol !== "anthropic") {
        setResult({
          tone: "error",
          text: t(($) => $.model_pool.test_protocol_blocked),
        });
        return;
      }
      setResult({ tone: "warn", text: t(($) => $.model_pool.test_needs_key) });
    }, 650);
  };

  return (
    <div className="qw-pool-test">
      <div className="qw-pool-rail-k">
        {runtimeName
          ? t(($) => $.model_pool.test_on_runtime, { name: runtimeName })
          : t(($) => $.model_pool.test_connection)}
      </div>
      <button type="button" className="qw-pool-act" onClick={run} disabled={testing}>
        {testing
          ? t(($) => $.model_pool.test_testing)
          : t(($) => $.model_pool.test_connection)}
      </button>
      {result ? (
        <p className={`qw-pool-test-result ${result.tone}`}>{result.text}</p>
      ) : null}
    </div>
  );
}

export function ModelsPage() {
  const { t } = useT("settings");
  const wsId = useWorkspaceId();
  const navigation = useNavigation();
  const paths = useWorkspacePaths();
  const currentUser = useAuthStore((s) => s.user);

  const catalogQuery = useQuery(modelPoolCatalogOptions(wsId));
  const runtimesQuery = useQuery(runtimeListOptions(wsId));
  const agentsQuery = useQuery(agentListOptions(wsId));

  const runtimes = runtimesQuery.data ?? [];
  const onlineRuntimes = runtimes.filter((runtime) => runtime.status === "online");
  const [runtimeId, setRuntimeId] = useState("");
  const effectiveRuntimeId =
    runtimeId || onlineRuntimes[0]?.id || runtimes[0]?.id || "";
  const selectedRuntime =
    runtimes.find((runtime) => runtime.id === effectiveRuntimeId) ?? null;

  const runtimeModelsQuery = useQuery(
    runtimeModelsOptions(effectiveRuntimeId || null),
  );
  const runtimeModels = runtimeModelsQuery.data?.models ?? [];

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PoolFilter>("all");
  const [runtimeFilter, setRuntimeFilter] = useState("");
  const [view, setView] = useState<PoolView>("table");
  const [selectedKey, setSelectedKey] = useState("");

  const items = useMemo<PoolItem[]>(() => {
    const catalogSources = catalogQuery.data?.sources ?? [];
    const catalogItems: PoolItem[] = (catalogQuery.data?.models ?? []).map(
      (model) => ({
        key: `${model.source}:${model.id}`,
        id: model.id,
        name: model.name || model.id,
        source: model.source,
        sourceLabel:
          catalogSources.find((source) => source.id === model.source)?.name ??
          model.source,
        protocol: model.protocol || "openai",
        context: model.context_length ?? 0,
        tools: model.supports_tools ?? null,
        reasoning: model.reasoning === true,
        free: model.free === true,
        runtimeId: null,
      }),
    );
    const runtimeItems: PoolItem[] = runtimeModels.map(
      (model: RuntimeModel) => ({
        key: `runtime:${effectiveRuntimeId}:${model.id}`,
        id: model.id,
        name: model.label || model.id,
        source: "runtime",
        sourceLabel: providerLabel(selectedRuntime?.provider),
        protocol: selectedRuntime?.provider === "claude" ? "anthropic" : "openai",
        context: 0,
        tools: null,
        reasoning: false,
        free: true,
        runtimeId: effectiveRuntimeId,
      }),
    );
    return [...runtimeItems, ...catalogItems].sort((a, b) => {
      const sourceDelta =
        (SOURCE_ORDER[a.source] ?? 9) - (SOURCE_ORDER[b.source] ?? 9);
      if (sourceDelta !== 0) return sourceDelta;
      const toolsDelta = Number(b.tools === true) - Number(a.tools === true);
      if (toolsDelta !== 0) return toolsDelta;
      return a.name.localeCompare(b.name);
    });
  }, [catalogQuery.data, effectiveRuntimeId, runtimeModels, selectedRuntime]);

  const agents = (agentsQuery.data ?? []).filter(
    (agent) => !agent.archived_at && agent.runtime_bound !== false,
  );
  const boundAgentFor = (itemId: string) =>
    agents.find(
      (agent) =>
        agent.model === itemId ||
        // OpenCode stores provider/model, so a bound `nvidia/<id>` still
        // points at the same catalog entry.
        (agent.model !== "" && agent.model.endsWith(`/${itemId}`)),
    ) ?? null;
  const boundAgents = agents.filter((agent) => agent.model !== "");

  const counts = useMemo(
    () => ({
      all: items.length,
      tools: items.filter((item) => item.tools === true).length,
      bound: items.filter((item) => boundAgentFor(item.id) !== null).length,
      long: items.filter((item) => item.context >= 256_000).length,
    }),
    [items, agents],
  );

  const filterRuntime =
    runtimes.find((runtime) => runtime.id === runtimeFilter) ?? null;
  const testRuntime = filterRuntime ?? selectedRuntime;
  const testAgents = agents.filter(
    (agent) =>
      agent.owner_id === currentUser?.id &&
      agent.runtime_id === testRuntime?.id,
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === "tools" && item.tools !== true) return false;
      if (filter === "bound" && boundAgentFor(item.id) === null) return false;
      if (filter === "long" && item.context < 256_000) return false;
      if (filterRuntime && !runtimeAccepts(item, filterRuntime)) return false;
      if (!needle) return true;
      return (
        item.name.toLowerCase().includes(needle) ||
        item.id.toLowerCase().includes(needle) ||
        item.sourceLabel.toLowerCase().includes(needle)
      );
    });
  }, [items, filter, query, agents, filterRuntime]);

  const selected =
    filtered.find((item) => item.key === selectedKey) ??
    filtered.find((item) => item.id === "cohere/north-mini-code:free") ??
    filtered[0] ??
    null;

  const selectedBoundAgent = selected ? boundAgentFor(selected.id) : null;

  const goBind = () => {
    toast(t(($) => $.model_pool.open_agent_hint));
    navigation.push(paths.agents());
  };

  const recommended =
    items.find((item) => item.source === "nvidia" && /nemotron-3-ultra/.test(item.id)) ??
    items.find((item) => item.tools === true) ??
    items[0] ??
    null;

  const applyRecommendation = () => {
    if (!recommended) return;
    setSelectedKey(recommended.key);
    setView("table");
    document.getElementById("qw-pool-rail")?.scrollIntoView({ behavior: "smooth" });
    toast(t(($) => $.model_pool.recommended_applied));
  };

  const refresh = () => {
    void catalogQuery.refetch();
    void runtimeModelsQuery.refetch();
  };

  const selectModel = (item: PoolItem) => {
    setSelectedKey(item.key);
    if (window.innerWidth < 960) {
      document.getElementById("qw-pool-rail")?.scrollIntoView({ behavior: "smooth" });
    }
  };

  const sources = catalogQuery.data?.sources ?? [];
  const connected = sources.filter((source) => source.status === "ok").length;
  const clock = (() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes(),
    ).padStart(2, "0")}`;
  })();

  const fits = selected ? harnessFits(selected) : null;
  const quotaFor = (sourceId: string) =>
    sourceId === "nvidia"
      ? t(($) => $.model_pool.quota_nvidia)
      : sourceId === "openrouter"
        ? t(($) => $.model_pool.quota_openrouter)
        : t(($) => $.model_pool.quota_runtime);

  return (
    <div className="qw-pool-page">
      <header className="qw-pool-masthead">
        <div className="qw-pool-mast-main">
          <div className="qw-pool-mast-line">
            <h1>{t(($) => $.model_pool.title)}</h1>
            <span className="qw-pool-count">
              <b>{counts.tools}</b>
              <span>AGENT-READY</span>
            </span>
          </div>
          <p className="qw-pool-live">
            <span className="lamp" aria-hidden="true" />
            <b>{connected}</b> 个平台已连接
            <span className="sep">·</span>
            <b>{counts.all}</b> 个免费模型
            <span className="sep">·</span>
            <b>{counts.tools}</b> 个支持工具调用
            <span className="sep">·</span>
            <b>{boundAgents.length}</b> 个已绑定智能体
          </p>
        </div>
        <div className="qw-pool-sync">
          <span className="sync">
            <i aria-hidden="true" />
            SYNCED
          </span>
          <span className="time">{clock}</span>
          <span className="hint">{t(($) => $.model_pool.last_synced)}</span>
        </div>
      </header>

      <div className="qw-pool-body">
        <div className="qw-pool-wrap">
          <div className="qw-pool-sources">
            {sources.map((source) => {
              const SourceIcon =
                source.id === "nvidia"
                  ? Cpu
                  : source.id === "openrouter"
                    ? Sparkles
                    : Zap;
              return (
                <div key={source.id} className="qw-pool-src">
                  <div className="qw-pool-src-head">
                    <span className="qw-pool-src-glyph">
                      <SourceIcon className="size-3" aria-hidden="true" />
                    </span>
                    <span className="qw-pool-src-name">{source.name}</span>
                    <span
                      className={`qw-pool-src-state${source.status === "ok" ? "" : " warn"}`}
                    >
                      <i aria-hidden="true" />
                      {source.status === "ok"
                        ? t(($) => $.model_pool.source_ok)
                        : t(($) => $.model_pool.source_error)}
                    </span>
                  </div>
                  <div className="qw-pool-src-metrics">
                    <b>{source.free_count}</b>
                    <span>{t(($) => $.model_pool.source_models)}</span>
                  </div>
                  <div className="qw-pool-src-bar">
                    <i
                      style={{
                        width: `${source.id === "nvidia" ? 34 : 62}%`,
                      }}
                    />
                  </div>
                  <div className="qw-pool-src-foot">
                    <span>
                      {source.error
                        ? source.error
                        : quotaFor(source.id)}
                    </span>
                    <button
                      type="button"
                      className="qw-pool-mini"
                      onClick={() => {
                        refresh();
                        toast(
                          t(($) => $.model_pool.source_sync_done, {
                            name: source.name,
                          }),
                        );
                      }}
                    >
                      {t(($) => $.model_pool.pull)}
                    </button>
                  </div>
                </div>
              );
            })}

            <div className="qw-pool-src">
              <div className="qw-pool-src-head">
                <span className="qw-pool-src-glyph">
                  <Cpu className="size-3" aria-hidden="true" />
                </span>
                <span className="qw-pool-src-name">
                  {t(($) => $.model_pool.runtime_source)}
                </span>
                <span className="qw-pool-src-state">
                  <i aria-hidden="true" />
                  {onlineRuntimes.length}/{runtimes.length}
                </span>
              </div>
              <div className="qw-pool-src-metrics">
                <b>
                  {runtimeModelsQuery.isLoading || runtimeModelsQuery.isError
                    ? "—"
                    : runtimeModels.length}
                </b>
                <span>{t(($) => $.model_pool.source_models)}</span>
              </div>
              <select
                className="qw-pool-select"
                value={effectiveRuntimeId}
                onChange={(event) => setRuntimeId(event.target.value)}
                aria-label={t(($) => $.model_pool.runtime_select)}
              >
                {runtimes.map((runtime) => (
                  <option key={runtime.id} value={runtime.id}>
                    {runtime.name} · {runtime.provider}
                  </option>
                ))}
              </select>
              {runtimeModelsQuery.isError ? (
                <div className="qw-pool-src-foot">
                  <span>{t(($) => $.model_pool.runtime_failed)}</span>
                </div>
              ) : null}
            </div>

            <button
              type="button"
              className="qw-pool-src add"
              onClick={() => toast(t(($) => $.model_pool.add_source_soon))}
            >
              <span className="qw-pool-src-head">
                <span className="qw-pool-src-glyph">
                  <Plus className="size-3" aria-hidden="true" />
                </span>
                <span className="qw-pool-src-name">
                  {t(($) => $.model_pool.add_source)}
                </span>
              </span>
              <span className="qw-pool-src-foot">
                {t(($) => $.model_pool.add_source_hint)}
              </span>
            </button>
          </div>

          <div className="qw-pool-reco">
            <span className="qw-pool-reco-k">
              {t(($) => $.model_pool.recommend_title)}
            </span>
            <span className="qw-pool-reco-chip">
              <i aria-hidden="true" />
              {t(($) => $.model_pool.recommend_primary)}
            </span>
            <span className="qw-pool-reco-plus">+</span>
            <span className="qw-pool-reco-chip">
              <i aria-hidden="true" />
              {t(($) => $.model_pool.recommend_fallback)}
            </span>
            <span className="qw-pool-reco-note">
              {t(($) => $.model_pool.recommend_note)}
            </span>
            <button
              type="button"
              className="qw-pool-reco-apply"
              onClick={applyRecommendation}
            >
              {t(($) => $.model_pool.apply)}
            </button>
          </div>

          <div className="qw-pool-toolbar">
            <div className="qw-pool-tabs" role="tablist">
              {(
                [
                  ["all", t(($) => $.model_pool.filter_all)],
                  ["tools", t(($) => $.model_pool.tools_only)],
                  ["bound", t(($) => $.model_pool.bound_word)],
                  ["long", t(($) => $.model_pool.filter_long)],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={filter === key ? "on" : ""}
                  onClick={() => setFilter(key)}
                >
                  {label} <em>{counts[key]}</em>
                </button>
              ))}
            </div>
            <span className="qw-pool-div" aria-hidden="true" />
            <div className="qw-pool-view">
              <button
                type="button"
                className={view === "table" ? "on" : ""}
                onClick={() => setView("table")}
              >
                {t(($) => $.model_pool.view_table)}
              </button>
              <button
                type="button"
                className={view === "matrix" ? "on" : ""}
                onClick={() => setView("matrix")}
              >
                {t(($) => $.model_pool.view_matrix)}
              </button>
            </div>
            <select
              className="qw-pool-runtime-filter"
              value={runtimeFilter}
              onChange={(event) => setRuntimeFilter(event.target.value)}
              aria-label={t(($) => $.model_pool.filter_runtime_label)}
            >
              <option value="">
                {t(($) => $.model_pool.filter_all_runtimes)}
              </option>
              {runtimes.map((runtime) => (
                <option key={runtime.id} value={runtime.id}>
                  {runtime.name} · {runtime.provider}
                </option>
              ))}
            </select>
            <label className="qw-pool-search">
              <Search className="i size-3" aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t(($) => $.model_pool.search_placeholder)}
                type="search"
              />
            </label>
            <button type="button" className="qw-pool-sync-btn" onClick={refresh}>
              <RefreshCw className="size-3" aria-hidden="true" />
              {t(($) => $.model_pool.sync_all)}
            </button>
          </div>

          {view === "table" ? (
            <div className="qw-pool-legend">
              <span>
                <span className="qw-pool-hb ad">CC</span>
                Claude Code · {t(($) => $.model_pool.harness_gateway)}
              </span>
              <span>
                <span className="qw-pool-hb">CX</span>Codex CLI ·{" "}
                {t(($) => $.model_pool.harness_direct)}
              </span>
              <span>
                <span className="qw-pool-hb">OC</span>OpenCode ·{" "}
                {t(($) => $.model_pool.harness_direct)}
              </span>
              <span>
                <span className="qw-pool-hb">CL</span>Cline / Roo ·{" "}
                {t(($) => $.model_pool.harness_direct)}
              </span>
              <span className="qw-pool-legend-note">
                {t(($) => $.model_pool.legend_note)}
              </span>
            </div>
          ) : null}

          <div className="qw-pool-split">
            {view === "table" ? (
              <div className="qw-pool-table-wrap">
                <table className="qw-pool-table">
                  <thead>
                    <tr>
                      <th>{t(($) => $.model_pool.col_model)}</th>
                      <th>{t(($) => $.model_pool.col_context)}</th>
                      <th>{t(($) => $.model_pool.capabilities)}</th>
                      <th>{t(($) => $.model_pool.quota_col)}</th>
                      <th>HARNESS</th>
                      <th>{t(($) => $.model_pool.bound_word)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item) => {
                      const bound = boundAgentFor(item.id);
                      return (
                        <tr
                          key={item.key}
                          className={selected?.key === item.key ? "sel" : ""}
                          onClick={() => selectModel(item)}
                        >
                          <td>
                            <span className="qw-pool-model">
                              <span
                                className="qw-pool-dot"
                                style={{
                                  background:
                                    item.source === "runtime"
                                      ? "var(--brand)"
                                      : item.source === "nvidia"
                                        ? "#76b900"
                                        : "#6a737d",
                                }}
                              />
                              <span className="qw-pool-model-main">
                                <b>{item.name}</b>
                                {item.id !== item.name ? <small>{item.id}</small> : null}
                              </span>
                            </span>
                          </td>
                          <td>{formatContext(item.context)}</td>
                          <td>
                            <span className="qw-pool-caps">
                              {item.tools === true ? (
                                <span className="qw-pool-cap">TOOLS</span>
                              ) : item.tools === false ? (
                                <span className="qw-pool-cap mute">NO TOOLS</span>
                              ) : (
                                <span className="qw-pool-cap mute">CHAT</span>
                              )}
                              {item.reasoning ? (
                                <span className="qw-pool-cap">REASONING</span>
                              ) : null}
                            </span>
                          </td>
                          <td>
                            <span className="qw-pool-cap mute">
                              {quotaFor(item.source)}
                            </span>
                          </td>
                          <td>
                            <span className="qw-pool-hbrow">
                              {HARNESSES.slice(0, 4).map((harness) => (
                                <span
                                  key={harness.key}
                                  className={`qw-pool-hb ${item ? (harnessFits(item)[harness.key] === "none" ? "no" : harnessFits(item)[harness.key] === "gateway" ? "ad" : "") : ""}`}
                                  title={harness.label}
                                >
                                  {harness.key.toUpperCase()}
                                </span>
                              ))}
                            </span>
                          </td>
                          <td>
                            {bound ? (
                              <span className="qw-pool-bound">
                                <span className="ava">{bound.name.slice(0, 1)}</span>
                                {bound.name}
                              </span>
                            ) : (
                              <span style={{ color: "var(--muted-foreground)" }}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filtered.length === 0 ? (
                  <p className="qw-pool-empty">
                    {t(($) => $.model_pool.empty)}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="qw-pool-matrix-wrap">
                <table className="qw-pool-matrix">
                  <thead>
                    <tr>
                      <th>{t(($) => $.model_pool.col_model)}</th>
                      {HARNESSES.map((harness) => (
                        <th key={harness.key}>{harness.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item) => {
                      const itemFits = harnessFits(item);
                      return (
                        <tr
                          key={item.key}
                          className={selected?.key === item.key ? "sel" : ""}
                          onClick={() => selectModel(item)}
                        >
                          <td>
                            <span className="qw-pool-model">
                              <span
                                className="qw-pool-dot"
                                style={{
                                  background:
                                    item.source === "runtime"
                                      ? "var(--brand)"
                                      : item.source === "nvidia"
                                        ? "#76b900"
                                        : "#6a737d",
                                }}
                              />
                              <span className="qw-pool-model-main">
                                <b>{item.name}</b>
                                {item.id !== item.name ? <small>{item.id}</small> : null}
                              </span>
                            </span>
                          </td>
                          {HARNESSES.map((harness) => {
                            const fit = itemFits[harness.key];
                            return (
                              <td key={harness.key}>
                                <span className={`pm ${fit}`}>
                                  <i aria-hidden="true" />
                                  {fit === "direct"
                                    ? t(($) => $.model_pool.harness_direct)
                                    : fit === "gateway"
                                      ? t(($) => $.model_pool.harness_gateway)
                                      : "—"}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="qw-pool-matrix-note">
                  {t(($) => $.model_pool.matrix_note)}
                </p>
              </div>
            )}

            <aside className="qw-pool-rail" id="qw-pool-rail">
              {selected ? (
                <>
                  <div className="qw-pool-rail-sec">
                    <div className="qw-pool-rail-k">
                      {t(($) => $.model_pool.detail_title)}
                    </div>
                    <h3>{selected.name}</h3>
                    <div className="qw-pool-rail-sub">{selected.id}</div>
                    <div className="qw-pool-rail-badges">
                      {selected.tools === true ? (
                        <span className="qw-pool-cap">TOOLS</span>
                      ) : selected.tools === false ? (
                        <span className="qw-pool-cap mute">NO TOOLS</span>
                      ) : (
                        <span className="qw-pool-cap mute">CHAT</span>
                      )}
                      {selected.reasoning ? (
                        <span className="qw-pool-cap">REASONING</span>
                      ) : null}
                      <span className="qw-pool-cap mute">{selected.sourceLabel}</span>
                    </div>
                  </div>

                  <div className="qw-pool-rail-sec">
                    <div className="qw-pool-rail-k">
                      {t(($) => $.model_pool.protocol_label)}
                    </div>
                    <div className="qw-pool-kv">
                      <span>{t(($) => $.model_pool.col_protocol)}</span>
                      <b>
                        {selected.protocol === "anthropic"
                          ? t(($) => $.model_pool.protocol_anthropic)
                          : t(($) => $.model_pool.protocol_openai)}
                      </b>
                    </div>
                    <div className="qw-pool-kv">
                      <span>{t(($) => $.model_pool.col_context)}</span>
                      <b>{formatContext(selected.context)}</b>
                    </div>
                    <div className="qw-pool-kv">
                      <span>{t(($) => $.model_pool.col_tools)}</span>
                      <b className={selected.tools === true ? "ok" : "warn"}>
                        {selected.tools === true
                          ? t(($) => $.model_pool.tool_yes)
                          : selected.tools === false
                            ? t(($) => $.model_pool.tool_no)
                            : t(($) => $.model_pool.tool_unknown)}
                      </b>
                    </div>
                    <div className="qw-pool-kv">
                      <span>{t(($) => $.model_pool.col_source)}</span>
                      <b>{selected.sourceLabel}</b>
                    </div>
                  </div>

                  <div className="qw-pool-rail-sec">
                    <div className="qw-pool-rail-k">
                      {t(($) => $.model_pool.bind_title)}
                    </div>
                    {selectedBoundAgent ? (
                      <div className="qw-pool-bound read">
                        <span className="ava">
                          {selectedBoundAgent.name.slice(0, 1)}
                        </span>
                        <span>
                          <b>{selectedBoundAgent.name}</b>
                          <span>{selectedBoundAgent.model}</span>
                        </span>
                      </div>
                    ) : (
                      <p className="qw-pool-note">
                        {t(($) => $.model_pool.pool_bind_hint)}
                      </p>
                    )}
                    <button type="button" className="bind-primary" onClick={goBind}>
                      {selectedBoundAgent
                        ? t(($) => $.model_pool.open_agent_view)
                        : t(($) => $.model_pool.open_agent_bind)}
                    </button>
                    <p className="qw-pool-note">
                      {t(($) => $.model_pool.pool_bind_note)}
                    </p>
                  </div>

                  <div className="qw-pool-rail-sec">
                    <div className="qw-pool-rail-k">
                      {t(($) => $.model_pool.harness_title)}
                    </div>
                    <ul className="qw-pool-fit">
                      {fits
                        ? HARNESSES.map((harness) => {
                            const fit = fits[harness.key];
                            return (
                              <li key={harness.key}>
                                <span>{harness.label}</span>
                                <b
                                  className={
                                    fit === "gateway"
                                      ? "ad"
                                      : fit === "none"
                                        ? "no"
                                        : ""
                                  }
                                >
                                  {fit === "direct"
                                    ? t(($) => $.model_pool.harness_direct)
                                    : fit === "gateway"
                                      ? t(($) => $.model_pool.harness_gateway)
                                      : t(($) => $.model_pool.harness_none)}
                                </b>
                              </li>
                            );
                          })
                        : null}
                    </ul>
                    <ModelConnectionTest
                      key={testRuntime?.id ?? "none"}
                      item={selected}
                      runtimeProvider={testRuntime?.provider ?? ""}
                      runtimeName={testRuntime?.name ?? ""}
                      runtimeId={testRuntime?.id ?? ""}
                    />
                    {selected.source !== "runtime" ? (
                      testRuntime?.provider === "opencode" ? (
                        <ProviderKeyDialog
                          model={selected}
                          runtime={testRuntime}
                          agents={testAgents}
                          onOpenAgent={(agentId) =>
                            navigation.push(paths.agentDetail(agentId))
                          }
                        />
                      ) : (
                        <p className="qw-pool-note">
                          当前一键配置仅支持 OpenCode；Codex / Pi / Claude 的
                          provider 配置在各自 CLI 配置里。
                        </p>
                      )
                    ) : null}
                    <p className="qw-pool-note">
                      {t(($) => $.model_pool.note_keys)}
                    </p>
                  </div>

                  <div className="qw-pool-rail-sec">
                    <div className="qw-pool-rail-k">
                      {t(($) => $.model_pool.quota_label)}
                    </div>
                    <div className="qw-pool-quota">
                      <div className="qw-pool-quota-bar">
                        <i style={{ width: "34%" }} />
                      </div>
                      <div className="qw-pool-quota-meta">
                        <span>{quotaFor(selected.source)}</span>
                        <span>{t(($) => $.model_pool.quota_hint)}</span>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <p className="qw-pool-note">
                  {t(($) => $.model_pool.detail_hint)}
                </p>
              )}
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
