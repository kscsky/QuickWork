"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BarChart3, RefreshCw } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@quickwork/ui/components/ui/skeleton";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useCustomPricingStore } from "@quickwork/core/runtimes/custom-pricing-store";
import { agentListOptions } from "@quickwork/core/workspace/queries";
import { projectListOptions } from "@quickwork/core/projects/queries";
import { dashboardKeys, usageOverviewOptions } from "@quickwork/core/dashboard";
import type { UsageOverview } from "@quickwork/core/types";
import { useViewingTimezone } from "../../common/use-viewing-timezone";
import { CollapsedNavTrigger } from "../../layout/page-header";
import { useNavigation } from "../../navigation";
import { useT } from "../../i18n";
import { ALL_PROJECTS } from "./dashboard-shared";
import { UsageOverviewView } from "./usage-overview";
import { UsageLogView } from "./usage-log-view";
import {
  formatUsageDateLabel,
  formatUsageInt,
  formatUsagePercent,
  formatUsageTokens,
  formatUsageUsd,
  usageCostDelta,
  usageDateWindow,
  usageModelRows,
  usageTotals,
} from "../usage-utils";
import "./usage.css";

type UsageRange = 7 | 30 | 90;
type DashboardTab = "overview" | "logs";

const USAGE_RANGES: readonly UsageRange[] = [7, 30, 90];
const DEFAULT_RANGE: UsageRange = 30;
const TAB_QUERY_KEY = "tab";
const EMPTY_OVERVIEW: UsageOverview = {
  daily: [],
  by_model: [],
  by_agent: [],
  previous_by_model: [],
};

function useFreshness(
  updatedAt: number | undefined,
  viewTZ: string,
  locales: Intl.LocalesArgument,
) {
  return useMemo(() => {
    try {
      const tzLabel =
        new Intl.DateTimeFormat(locales, {
          timeZone: viewTZ,
          timeZoneName: "shortOffset",
        })
          .formatToParts(new Date())
          .find((part) => part.type === "timeZoneName")?.value ?? null;
      const updatedLabel =
        updatedAt && updatedAt > 0
          ? new Intl.DateTimeFormat(locales, {
              timeZone: viewTZ,
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(updatedAt))
          : null;
      return { tzLabel, updatedLabel };
    } catch {
      return { tzLabel: null, updatedLabel: null };
    }
  }, [updatedAt, viewTZ, locales]);
}

/** A wall clock in the viewer's timezone, refreshed every half minute. Starts
 *  empty so server and client markup agree on the first paint. */
function useClock(viewTZ: string, locales: Intl.LocalesArgument): string {
  const [clock, setClock] = useState("");
  useEffect(() => {
    const tick = () => {
      try {
        setClock(
          new Intl.DateTimeFormat(locales, {
            timeZone: viewTZ,
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).format(new Date()),
        );
      } catch {
        setClock("");
      }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [viewTZ, locales]);
  return clock;
}

/**
 * Workspace usage: a metering desk. The masthead carries the window total and
 * the one-line live counts, the toolbar narrows both tabs, and the body is
 * either the daily-by-model chart plus its ledger, or the per-(task, provider,
 * model) call log behind it.
 *
 * Both tabs read the same raw task_usage window and the same project filter,
 * so the headline and the log summary reconcile. The log tab is mounted only
 * while selected; its query starts on first visit and stops being observed
 * when the tab closes.
 */
export function DashboardPage() {
  const { t, i18n } = useT("usage");
  const wsId = useWorkspaceId();
  const viewTZ = useViewingTimezone();
  const navigation = useNavigation();
  const locales = i18n.resolvedLanguage ?? i18n.language;

  const [days, setDays] = useState<UsageRange>(DEFAULT_RANGE);
  const [projectValue, setProjectValue] = useState<string>(ALL_PROJECTS);
  const [logModel, setLogModel] = useState<{ provider: string; model: string } | null>(
    null,
  );
  const [logAgent, setLogAgent] = useState<string | null>(null);

  // Pricing overrides live in a Zustand store the pure cost helpers read
  // imperatively. Carry the snapshot into every memo below: a store update must
  // re-price the already-fetched rows, not wait for a refetch.
  const pricings = useCustomPricingStore((state) => state.pricings);

  const tabFromUrl = navigation.searchParams.get(TAB_QUERY_KEY);
  const tab: DashboardTab = tabFromUrl === "logs" ? "logs" : "overview";
  const handleTabChange = (next: string) => {
    const params = new URLSearchParams(navigation.searchParams);
    if (next === "overview") params.delete(TAB_QUERY_KEY);
    else params.set(TAB_QUERY_KEY, next);
    const query = params.toString();
    navigation.replace(query ? `${navigation.pathname}?${query}` : navigation.pathname);
  };

  const projectsQuery = useQuery(projectListOptions(wsId));
  const agentsQuery = useQuery(agentListOptions(wsId));
  const projects = projectsQuery.data ?? [];
  const agents = agentsQuery.data ?? [];

  // A stale project id (deleted project, workspace switch) must not silently
  // narrow every query while the filter still reads "All projects".
  const projectId = useMemo(() => {
    if (projectValue === ALL_PROJECTS) return null;
    return projects.some((project) => project.id === projectValue) ? projectValue : null;
  }, [projectValue, projects]);

  const overviewQuery = useQuery(usageOverviewOptions(wsId, days, projectId, viewTZ));
  const overview = overviewQuery.data ?? EMPTY_OVERVIEW;

  const queryClient = useQueryClient();
  const handleRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.all(wsId) });
  };

  const { updatedLabel } = useFreshness(
    overviewQuery.dataUpdatedAt,
    viewTZ,
    locales,
  );
  const clock = useClock(viewTZ, locales);

  const totals = useMemo(
    () => usageTotals(overview.by_model),
    [overview.by_model, pricings],
  );
  const previousTotals = useMemo(
    () => usageTotals(overview.previous_by_model),
    [overview.previous_by_model, pricings],
  );
  const costDelta = usageCostDelta(totals.cost, previousTotals.cost);
  const modelOptions = useMemo(
    () => usageModelRows(overview.by_model),
    [overview.by_model, pricings],
  );
  const callCount = useMemo(
    () => overview.by_model.reduce((sum, row) => sum + row.call_count, 0),
    [overview.by_model],
  );
  const projectName =
    projects.find((project) => project.id === projectId)?.title ??
    t(($) => $.filter.all_projects);

  const rangeOptions = USAGE_RANGES.map((value) => ({
    value,
    label: t(($) => $.range.days, { days: value }),
  }));

  // The window reads as a ledger period, not a date picker: both ends in the
  // viewer's own calendar, the same day boundary every query slices by.
  const windowDates = usageDateWindow(days, viewTZ);
  const windowLabel = `${formatUsageDateLabel(windowDates.from, locales)} → ${formatUsageDateLabel(windowDates.to, locales)}`;

  // The underline is measured rather than derived from flex widths: the log
  // tab grows when its call count lands, and the motion should follow the
  // label, not jump a frame later.
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const tabEls = useRef<Record<DashboardTab, HTMLButtonElement | null>>({
    overview: null,
    logs: null,
  });
  const [tabLine, setTabLine] = useState({ left: 0, width: 0, ready: false });

  const measureTab = useCallback((key: DashboardTab) => {
    const container = tabsRef.current;
    const button = tabEls.current[key];
    if (!container || !button) return null;
    const containerRect = container.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    return { left: buttonRect.left - containerRect.left, width: buttonRect.width };
  }, []);

  const moveTabLine = useCallback(
    (key: DashboardTab) => {
      const next = measureTab(key);
      if (!next) return;
      setTabLine((current) =>
        current.ready && current.left === next.left && current.width === next.width
          ? current
          : { ...next, ready: true },
      );
    },
    [measureTab],
  );

  useLayoutEffect(() => {
    moveTabLine(tab);
  }, [tab, moveTabLine, callCount]);

  useEffect(() => {
    const onResize = () => moveTabLine(tab);
    window.addEventListener("resize", onResize);
    void document.fonts?.ready.then(onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [tab, moveTabLine]);

  const drillModel = (provider: string, model: string) => {
    setLogModel({ provider, model });
    setLogAgent(null);
    handleTabChange("logs");
  };
  const drillAgent = (agentId: string) => {
    setLogAgent(agentId);
    setLogModel(null);
    handleTabChange("logs");
  };
  const viewAllLogs = () => {
    setLogModel(null);
    setLogAgent(null);
    handleTabChange("logs");
  };

  // The IANA name is the one the mockup shows ("Asia/Shanghai"), and it is
  // what the viewer picked in Preferences; shortOffset renders "GMT+8", which
  // hides DST and tells a Shanghai user nothing they did not already know.
  const syncHint = updatedLabel
    ? t(($) => $.header.timezone_and_updated, { tz: viewTZ, time: updatedLabel })
    : viewTZ;

  return (
    <div className="qw-us-page">
      <header className="qw-us-masthead">
        <div className="qw-us-mast-main">
          <div className="qw-us-mast-line">
            <div className="qw-us-mast-lead">
              <span className="qw-us-nav">
                <CollapsedNavTrigger />
              </span>
              <h1>{t(($) => $.title)}</h1>
            </div>
            <span className="qw-us-count">
              <b>{overviewQuery.isLoading ? "—" : formatUsageUsd(totals.cost)}</b>
              <span>USD</span>
            </span>
          </div>
          <p className="qw-us-live">
            <span>{t(($) => $.console.days_near, { days })}</span>
            <span className="sep" aria-hidden="true">
              ·
            </span>
            <span>
              <b>{formatUsageInt(callCount)}</b> {t(($) => $.console.calls_unit)}
            </span>
            <span className="sep" aria-hidden="true">
              ·
            </span>
            <span>
              <b>{formatUsageTokens(totals.tokens)}</b>{" "}
              {t(($) => $.console.tokens_unit)}
            </span>
            <span className="sep" aria-hidden="true">
              ·
            </span>
            <span>
              {t(($) => $.overview.kpi.cache)}{" "}
              <b>{formatUsagePercent(totals.cacheHitRate)}</b>
            </span>
            <span className="sep" aria-hidden="true">
              ·
            </span>
            <span className="qw-us-delta">
              {costDelta == null
                ? `${t(($) => $.overview.hero.vs_previous)} —`
                : `${costDelta >= 0 ? "↑" : "↓"} ${Math.abs(costDelta).toFixed(1)}% ${t(($) => $.overview.hero.vs_previous)}`}
            </span>
          </p>
        </div>
        <div className="qw-us-sync">
          <span className="sync">
            <i aria-hidden="true" />
            SYNCED
          </span>
          <span className="time">{clock || "—"}</span>
          <span className="hint">{syncHint}</span>
          <button
            type="button"
            className="qw-us-refresh"
            aria-label={t(($) => $.header.refresh)}
            onClick={handleRefresh}
            disabled={overviewQuery.isFetching}
          >
            <RefreshCw className={overviewQuery.isFetching ? "animate-spin" : undefined} />
          </button>
        </div>
      </header>

      <div className="qw-us-toolbar">
        <div
          className="qw-us-tabs"
          role="tablist"
          aria-label={t(($) => $.title)}
          ref={tabsRef}
        >
          <span
            className="qw-us-tabline"
            style={{
              left: tabLine.left,
              width: tabLine.width,
              opacity: tabLine.ready ? 1 : 0,
            }}
            aria-hidden="true"
          />
          <button
            type="button"
            role="tab"
            id="qw-usage-tab-overview"
            aria-controls="qw-usage-panel-overview"
            aria-selected={tab === "overview"}
            data-active={tab === "overview" ? "" : undefined}
            className="qw-us-tab"
            ref={(node) => {
              tabEls.current.overview = node;
            }}
            onClick={() => handleTabChange("overview")}
          >
            {t(($) => $.tabs.overview)}
          </button>
          <button
            type="button"
            role="tab"
            id="qw-usage-tab-logs"
            aria-controls="qw-usage-panel-logs"
            aria-selected={tab === "logs"}
            data-active={tab === "logs" ? "" : undefined}
            className="qw-us-tab"
            ref={(node) => {
              tabEls.current.logs = node;
            }}
            onClick={() => handleTabChange("logs")}
          >
            {t(($) => $.tabs.logs)}
            <em>{formatUsageInt(callCount)}</em>
          </button>
        </div>
        <div className="qw-us-toolbar-right">
          <span className="qw-us-window">{windowLabel}</span>
          <select
            className="qw-us-project"
            aria-label={t(($) => $.filter.project_label)}
            value={projectId ?? ALL_PROJECTS}
            onChange={(event) => setProjectValue(event.target.value)}
          >
            <option value={ALL_PROJECTS}>{t(($) => $.filter.all_projects)}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
          <div className="qw-us-range" role="group" aria-label={t(($) => $.range.label)}>
            {rangeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={days === option.value}
                data-active={days === option.value ? "" : undefined}
                onClick={() => setDays(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="qw-us-body">
        <div
          className="qw-us-panel"
          role="tabpanel"
          id={`qw-usage-panel-${tab}`}
          aria-labelledby={`qw-usage-tab-${tab}`}
        >
          {tab === "overview" ? (
            overviewQuery.isLoading ? (
              <DashboardSkeleton />
            ) : overviewQuery.isError && !overviewQuery.data ? (
              <div className="qw-us-state">
                <BarChart3 aria-hidden="true" />
                <h3>{t(($) => $.overview.error_title)}</h3>
                <p>{t(($) => $.overview.error_body)}</p>
                <button
                  type="button"
                  className="qw-us-btn"
                  onClick={() => void overviewQuery.refetch()}
                >
                  {t(($) => $.overview.error_retry)}
                </button>
              </div>
            ) : (
              <UsageOverviewView
                overview={overview}
                agents={agents}
                pricings={pricings}
                days={days}
                viewTZ={viewTZ}
                locale={locales}
                onDrillModel={drillModel}
                onDrillAgent={drillAgent}
                onViewAllLogs={viewAllLogs}
              />
            )
          ) : (
            <UsageLogView
              wsId={wsId}
              days={days}
              projectId={projectId}
              projectName={projectName}
              viewTZ={viewTZ}
              agents={agents}
              projects={projects}
              pricings={pricings}
              modelOptions={modelOptions}
              modelFilter={logModel}
              onModelFilterChange={setLogModel}
              agentFilter={logAgent}
              onAgentFilterChange={setLogAgent}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="qw-us-skeleton">
      <div className="qw-us-skeleton-main">
        <Skeleton className="qw-us-skeleton-chart rounded-sm" />
        <Skeleton className="qw-us-skeleton-table rounded-sm" />
      </div>
      <div className="qw-us-skeleton-rail">
        <Skeleton className="rail-block rounded-sm" />
        <Skeleton className="rail-block rounded-sm" />
      </div>
    </div>
  );
}
