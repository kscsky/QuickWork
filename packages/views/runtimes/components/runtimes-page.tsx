"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Cloud,
  Copy,
  Monitor,
  Plus,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@quickwork/core/auth";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useWorkspacePaths } from "@quickwork/core/paths";
import { agentTaskSnapshotOptions } from "@quickwork/core/agents";
import { runtimeProfileListOptions } from "@quickwork/core/runtimes";
import { runtimeListOptions, runtimeKeys } from "@quickwork/core/runtimes/queries";
import { useWSEvent } from "@quickwork/core/realtime";
import { agentListOptions } from "@quickwork/core/workspace/queries";
import { copyText } from "@quickwork/ui/lib/clipboard";
import { Skeleton } from "@quickwork/ui/components/ui/skeleton";
import { useNavigation } from "../../navigation";
import { ConnectRemoteDialog } from "./connect-remote-dialog";
import { ProviderLogo } from "./provider-logo";
import {
  buildWorkloadIndex,
  type RuntimeWorkload,
} from "./runtime-list";
import { pendingRuntimeFromProfile } from "./pending-runtime";
import {
  buildRuntimeMachines,
  runtimeRowLabel,
  type RuntimeMachine,
} from "./runtime-machines";
import { useHealthLabel } from "./shared";
import { useT, useTimeAgo } from "../../i18n";

export interface RuntimesPageProps {
  /** Desktop-only daemon id used to identify this device. */
  localDaemonId?: string | null;
  /** Desktop-only friendly device name for the local daemon. */
  localMachineName?: string | null;
  /** Keep the local device visible even before its first runtime registers. */
  hasLocalMachine?: boolean;
  /** The bundled daemon is starting but has not registered yet. */
  bootstrapping?: boolean;
}

const DAEMON_SETUP_COMMAND = "quickwork setup";

type MachineFilter = "all" | "online" | "issues";

function useNowTick(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function machineMatches(machine: RuntimeMachine, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    machine.title,
    machine.subtitle,
    machine.deviceInfo,
    machine.daemonId,
    machine.providerNames.join(" "),
    machine.runtimes.map((runtime) => runtime.name).join(" "),
    machine.runtimes.map((runtime) => runtime.custom_name ?? "").join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(q);
}

function agentCountFor(machine: RuntimeMachine, workload: Map<string, RuntimeWorkload>): number {
  return machine.runtimes.reduce(
    (sum, runtime) => sum + (workload.get(runtime.id)?.agentIds.length ?? 0),
    0,
  );
}

export function RuntimesPage({
  localDaemonId,
  localMachineName,
  hasLocalMachine,
  bootstrapping,
}: RuntimesPageProps = {}) {
  const { t } = useT("runtimes");
  const healthLabel = useHealthLabel();
  const timeAgo = useTimeAgo();
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const qc = useQueryClient();
  const isAuthLoading = useAuthStore((state) => state.isLoading);
  const currentUserId = useAuthStore((state) => state.user?.id);
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [filter, setFilter] = useState<MachineFilter>("all");
  const [query, setQuery] = useState("");

  const { data: runtimes = [], isLoading: runtimesLoading } = useQuery(
    runtimeListOptions(wsId),
  );
  const { data: runtimeProfiles = [], isLoading: profilesLoading } = useQuery(
    runtimeProfileListOptions(wsId),
  );
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: snapshot = [] } = useQuery(agentTaskSnapshotOptions(wsId));

  const handleDaemonEvent = useCallback(() => {
    qc.invalidateQueries({ queryKey: runtimeKeys.all(wsId) });
  }, [qc, wsId]);
  useWSEvent("daemon:register", handleDaemonEvent);

  const workloadIndex = useMemo(
    () => buildWorkloadIndex(agents, snapshot),
    [agents, snapshot],
  );
  const now = useNowTick();
  const machines = useMemo(
    () =>
      buildRuntimeMachines(runtimes, {
        now,
        localDaemonId,
        localMachineName,
        currentUserId,
        workloadByRuntimeId: workloadIndex,
        ensureLocalMachine: hasLocalMachine,
      }),
    [
      runtimes,
      now,
      localDaemonId,
      localMachineName,
      currentUserId,
      workloadIndex,
      hasLocalMachine,
    ],
  );
  const orphanProfileRuntimes = useMemo(() => {
    if (machines.some((machine) => machine.mode === "local")) return [];
    return runtimeProfiles.map((profile) => {
      const createdAt = Date.parse(profile.created_at);
      return pendingRuntimeFromProfile({
        profile,
        createdAt: Number.isFinite(createdAt) ? createdAt : 0,
        fallbackMachineName: "Unassigned",
      });
    });
  }, [machines, runtimeProfiles]);

  const boundAgentCount = useMemo(
    () => agents.filter((agent) => agent.runtime_id && !agent.archived_at).length,
    [agents],
  );
  const runtimeCount =
    machines.reduce((sum, machine) => sum + machine.runtimes.length, 0) +
    orphanProfileRuntimes.length;
  const onlineMachines = machines.filter(
    (machine) => machine.health === "online",
  ).length;
  const queued = machines.reduce((sum, machine) => sum + machine.queuedCount, 0);

  const visibleMachines = machines.filter((machine) => {
    if (filter === "online" && machine.health !== "online") return false;
    if (filter === "issues" && machine.health === "online") return false;
    return machineMatches(machine, query);
  });
  const visiblePending =
    filter === "online"
      ? []
      : orphanProfileRuntimes.filter((runtime) => {
          const q = query.trim().toLowerCase();
          if (!q) return true;
          return `${runtime.name} ${runtime.provider}`
            .toLowerCase()
            .includes(q);
        });
  const visibleCount = visibleMachines.length + visiblePending.length;
  const machineTotal = machines.length + orphanProfileRuntimes.length;
  const issueMachines = machineTotal - onlineMachines;
  const isEmptyWorkspace =
    machines.length === 0 && orphanProfileRuntimes.length === 0 && !bootstrapping;

  const tabs: { id: MachineFilter; label: string; count: number }[] = [
    { id: "all", label: t(($) => $.console.list_all), count: machineTotal },
    { id: "online", label: t(($) => $.console.list_online), count: onlineMachines },
    { id: "issues", label: t(($) => $.console.list_issues), count: issueMachines },
  ];

  const copySetupCommand = async () => {
    const ok = await copyText(DAEMON_SETUP_COMMAND);
    if (ok) toast.success(t(($) => $.page.command_copied));
    else toast.error(t(($) => $.machine.copy_failed));
  };

  if (isAuthLoading || runtimesLoading || profilesLoading) {
    return <RuntimesPageSkeleton />;
  }

  return (
    <div className="qw-rt-page">
      <header className="qw-rt-masthead">
        <div className="qw-rt-mast-main">
          <div className="qw-rt-mast-line">
            <h1>{t(($) => $.page.title)}</h1>
            <span className="qw-rt-count">
              <b>{runtimeCount}</b>
              <span>{t(($) => $.console.list_cap)}</span>
            </span>
            <div className="qw-rt-mast-actions">
              <button
                type="button"
                className="qw-rt-create"
                onClick={() => setShowConnectDialog(true)}
              >
                <span className="plus">
                  <Plus className="size-3" aria-hidden="true" />
                </span>
                {t(($) => $.page.connect_remote)}
              </button>
            </div>
          </div>
          <p className="qw-rt-live">
            <b>{machines.length}</b>
            {t(($) => $.console.list_machines, { count: machines.length })}
            <span className="sep">·</span>
            <b>{onlineMachines}</b>
            {t(($) => $.console.list_online_unit)}
            <span className="sep">·</span>
            <span className="quiet">
              <b>{boundAgentCount}</b>
              {t(($) => $.console.list_agents, { count: boundAgentCount })}
            </span>
            {queued > 0 ? (
              <>
                <span className="sep">·</span>
                <span className="lamp queued" aria-hidden="true" />
                <b>{queued}</b>
                {t(($) => $.console.list_queued, { count: queued })}
              </>
            ) : null}
          </p>
        </div>
        <div className="qw-rt-sync">
          <span className="sync">
            <i aria-hidden="true" />
            SYNCED
          </span>
          <span className="time">
            {new Intl.DateTimeFormat(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(now))}
          </span>
          <span className="hint">{t(($) => $.console.list_sync_hint)}</span>
        </div>
      </header>

      <div className="qw-rt-toolbar">
        <div className="qw-rt-tabs" role="tablist" aria-label={t(($) => $.console.list_tabs_aria)}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={filter === tab.id}
              className="qw-rt-tab"
              data-on={filter === tab.id ? "" : undefined}
              onClick={() => setFilter(tab.id)}
            >
              {tab.label}
              <em>{tab.count}</em>
            </button>
          ))}
        </div>
        <div className="qw-rt-toolbar-right">
          <label className="qw-rt-search">
            <Search className="size-3" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setQuery("");
              }}
              placeholder={t(($) => $.console.list_search_placeholder)}
              aria-label={t(($) => $.console.list_search_aria)}
              autoComplete="off"
            />
          </label>
        </div>
      </div>

      <div className="qw-rt-board">
        <div className="qw-rt-thead">
          <span>{t(($) => $.console.list_col_machine)}</span>
          <span className="th-mode">{t(($) => $.console.list_col_mode)}</span>
          <span className="th-runtimes">{t(($) => $.console.list_col_runtimes)}</span>
          <span className="th-agents">{t(($) => $.console.list_col_agents)}</span>
          <span className="th-workload">{t(($) => $.console.list_col_workload)}</span>
          <span className="th-state">{t(($) => $.console.list_col_state)}</span>
          <span />
        </div>

        {isEmptyWorkspace ? (
          <div className="qw-rt-empty">
            <Monitor aria-hidden="true" className="size-6" />
            <h3>{t(($) => $.page.empty.title)}</h3>
            <p>{t(($) => $.page.empty.hint)}</p>
            <button type="button" onClick={() => setShowConnectDialog(true)}>
              {t(($) => $.page.connect_remote)}
            </button>
          </div>
        ) : visibleCount === 0 && !bootstrapping ? (
          <div className="qw-rt-empty">
            <p>{t(($) => $.console.list_no_matches)}</p>
            <button
              type="button"
              onClick={() => {
                setFilter("all");
                setQuery("");
              }}
            >
              {t(($) => $.console.list_clear)}
            </button>
          </div>
        ) : (
          <>
            {visibleMachines.map((machine) => {
              const Icon = machine.section === "cloud" ? Cloud : Monitor;
              const busyCount = machine.runningCount + machine.queuedCount;
              const totalAgents = agentCountFor(machine, workloadIndex);
              const modeLabel =
                machine.section === "cloud"
                  ? t(($) => $.machine.section_cloud)
                  : machine.section === "remote"
                    ? t(($) => $.machine.section_remote)
                    : t(($) => $.machine.section_local);
              const details = [
                machine.daemonId ? `daemon ${machine.daemonId}` : null,
                machine.subtitle ?? machine.deviceInfo,
              ]
                .filter((part): part is string => !!part)
                .join(" · ");
              const shownProviders = Array.from(
                new Set(machine.runtimes.map((runtime) => runtime.provider)),
              ).slice(0, 3);
              return (
                <div
                  key={machine.id}
                  role="link"
                  tabIndex={0}
                  className="qw-rt-row"
                  data-offline={machine.health !== "online" ? "" : undefined}
                  aria-label={t(($) => $.console.list_open_machine, {
                    name: machine.title,
                  })}
                  onClick={() => navigation.push(paths.runtimeDetail(machine.id))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      navigation.push(paths.runtimeDetail(machine.id));
                    }
                  }}
                >
                  <span className="qw-rt-machine">
                    <span className="qw-rt-machine-mark">
                      <Icon aria-hidden="true" />
                    </span>
                    <span className="qw-rt-machine-main">
                      <span className="qw-rt-machine-name">
                        {machine.title}
                        {machine.isCurrent ? (
                          <em className="qw-rt-this">
                            {t(($) => $.machine.this_machine)}
                          </em>
                        ) : null}
                      </span>
                      <span className="qw-rt-machine-sub">
                        {details ||
                          (machine.section === "cloud"
                            ? t(($) => $.machine.metrics.cloud_worker)
                            : t(($) => $.machine.metrics.local_daemon))}
                      </span>
                    </span>
                  </span>

                  <span className="qw-rt-mode" data-mode={machine.section}>
                    {modeLabel}
                  </span>

                  <span className="qw-rt-runtime-stack">
                    {machine.runtimes.length === 0 ? (
                      <span className="qw-rt-muted">
                        {t(($) => $.console.list_no_runtimes)}
                      </span>
                    ) : (
                      <>
                        <span className="qw-rt-logos" aria-hidden="true">
                          {shownProviders.map((provider) => (
                            <span key={provider} className="qw-rt-logo">
                              <ProviderLogo provider={provider} className="size-[14px]" />
                            </span>
                          ))}
                        </span>
                        <span className="qw-rt-runtime-names">
                          {machine.runtimes
                            .slice(0, 2)
                            .map((runtime) => runtimeRowLabel(runtime, machine.title))
                            .join(" · ")}
                          {machine.runtimes.length > 2
                            ? ` +${machine.runtimes.length - 2}`
                            : ""}
                        </span>
                      </>
                    )}
                  </span>

                  <span className="qw-rt-num">{totalAgents}</span>

                  <span className="qw-rt-workload">
                    {busyCount > 0
                      ? t(($) => $.console.list_workload, {
                          running: machine.runningCount,
                          queued: machine.queuedCount,
                        })
                      : t(($) => $.machine.metrics.workload_idle)}
                  </span>

                  <span
                    className="qw-rt-state"
                    data-health={machine.health}
                  >
                    <i aria-hidden="true" />
                    {healthLabel(machine.health)}
                    <em>
                      {machine.lastSeenAt ? timeAgo(machine.lastSeenAt) : "—"}
                    </em>
                  </span>

                  <span className="qw-rt-go">
                    <ArrowRight className="size-3" aria-hidden="true" />
                  </span>
                </div>
              );
            })}

            {visiblePending.length > 0 ? (
              <>
                <div className="qw-rt-pending-head">
                  <span>{t(($) => $.profiles.unassigned_title)}</span>
                  <em>{visiblePending.length}</em>
                </div>
                {visiblePending.map((runtime) => (
                  <div key={runtime.id} className="qw-rt-row pending">
                    <span className="qw-rt-machine">
                      <span className="qw-rt-machine-mark">
                        <Cloud aria-hidden="true" />
                      </span>
                      <span className="qw-rt-machine-main">
                        <span className="qw-rt-machine-name">{runtime.name}</span>
                        <span className="qw-rt-machine-sub">
                          {t(($) => $.console.list_pending_hint)}
                        </span>
                      </span>
                    </span>
                    <span className="qw-rt-mode" data-mode="cloud">
                      {t(($) => $.machine.section_cloud)}
                    </span>
                    <span className="qw-rt-runtime-stack">
                      <span className="qw-rt-logos" aria-hidden="true">
                        <span className="qw-rt-logo">
                          <ProviderLogo provider={runtime.provider} className="size-[14px]" />
                        </span>
                      </span>
                      <span className="qw-rt-runtime-names">{runtime.provider}</span>
                    </span>
                    <span className="qw-rt-num">0</span>
                    <span className="qw-rt-workload">
                      {t(($) => $.machine.metrics.workload_idle)}
                    </span>
                    <span className="qw-rt-state" data-health="recently_lost">
                      <i aria-hidden="true" />
                      {t(($) => $.console.list_pending_state)}
                      <em>—</em>
                    </span>
                    <span className="qw-rt-go" />
                  </div>
                ))}
              </>
            ) : null}

            {bootstrapping && machines.length === 0 ? (
              <div className="qw-rt-boot">
                <i aria-hidden="true" />
                <span>{t(($) => $.console.list_bootstrapping)}</span>
              </div>
            ) : null}

            <div className="qw-rt-add">
              <span className="qw-rt-add-icon">
                <Plus className="size-3.5" aria-hidden="true" />
              </span>
              <span className="qw-rt-add-main">
                <b>{t(($) => $.page.add_machine_title)}</b>
                <span>{t(($) => $.page.add_machine_hint)}</span>
              </span>
              <code>{DAEMON_SETUP_COMMAND}</code>
              <button type="button" className="qw-rt-textbtn" onClick={copySetupCommand}>
                <Copy className="size-3" aria-hidden="true" />
                {t(($) => $.page.copy_command)}
              </button>
              <button
                type="button"
                className="qw-rt-add-btn"
                onClick={() => setShowConnectDialog(true)}
              >
                {t(($) => $.page.connect_remote)}
              </button>
            </div>
          </>
        )}
      </div>

      <footer className="qw-rt-pager">
        <span className="sum">
          {visibleCount === machineTotal
            ? `${machines.length} ${t(($) => $.console.list_machines, { count: machines.length })} · ${runtimeCount} ${t(($) => $.console.stat_runtimes, { count: runtimeCount })} · ${boundAgentCount} ${t(($) => $.console.list_agents, { count: boundAgentCount })} · ${onlineMachines} ${t(($) => $.console.list_online_unit)}`
            : `${t(($) => $.console.list_footer_showing, { shown: visibleCount, total: machineTotal })} · ${runtimeCount} ${t(($) => $.console.stat_runtimes, { count: runtimeCount })} · ${onlineMachines} ${t(($) => $.console.list_online_unit)}`}
        </span>
        <span className="grow" />
        <span className="sum">{t(($) => $.console.list_footer_hint)}</span>
      </footer>

      {showConnectDialog ? (
        <ConnectRemoteDialog onClose={() => setShowConnectDialog(false)} />
      ) : null}
    </div>
  );
}

function RuntimesPageSkeleton() {
  return (
    <div className="qw-rt-page">
      <div className="qw-rt-masthead">
        <div className="qw-rt-mast-main">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="mt-2 h-3 w-64" />
        </div>
      </div>
      <div className="qw-rt-board">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="qw-rt-row">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-8" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default RuntimesPage;
