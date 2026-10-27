"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Cloud,
  Monitor,
  Pencil,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent, AgentRuntime, RuntimeUsage } from "@quickwork/core/types";
import { useAuthStore } from "@quickwork/core/auth";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useWorkspacePaths } from "@quickwork/core/paths";
import { useWorkspacePresenceMap } from "@quickwork/core/agents";
import { agentTaskSnapshotOptions } from "@quickwork/core/agents";
import {
  providerDisplayName,
  runtimeDisplayLabel,
  runtimeProfileListOptions,
  runtimeUsageOptions,
} from "@quickwork/core/runtimes";
import { runtimeKeys, runtimeListOptions } from "@quickwork/core/runtimes/queries";
import { useWSEvent } from "@quickwork/core/realtime";
import {
  agentListOptions,
  memberListOptions,
} from "@quickwork/core/workspace/queries";
import { Skeleton } from "@quickwork/ui/components/ui/skeleton";
import { AppLink, useNavigation } from "../../navigation";
import { ActorAvatar } from "../../common/actor-avatar";
import { ProviderLogo } from "./provider-logo";
import { buildWorkloadIndex, type RuntimeWorkload } from "./runtime-list";
import {
  buildRuntimeMachines,
  sharedCustomName,
} from "./runtime-machines";
import { RenameMachineDialog } from "./rename-machine-dialog";
import { RuntimeProfilesDialog } from "./runtime-profiles-dialog";
import { DeleteRuntimeDialog } from "./delete-runtime-dialog";
import {
  isPendingCustomRuntime,
  pendingRuntimesForProfiles,
} from "./pending-runtime";
import { MachineCliSection } from "./machine-cli-section";
import { useHealthLabel } from "./shared";
import { estimateCost, formatTokens, formatUsd } from "../utils";
import { useViewingTimezone } from "../../common/use-viewing-timezone";
import { useT, useTimeAgo } from "../../i18n";

export interface RuntimeDetailPageProps {
  /** A machine id, or a legacy runtime id that locates its machine. */
  runtimeId: string;
  localDaemonId?: string | null;
  localMachineName?: string | null;
  localMachineActions?: React.ReactNode;
  hasLocalMachine?: boolean;
  bootstrapping?: boolean;
}

function useNowTick(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function decodeRouteParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function findMachine(
  machines: ReturnType<typeof buildRuntimeMachines>,
  locator: string,
) {
  return (
    machines.find(
      (candidate) =>
        candidate.id === locator ||
        candidate.runtimes.some((runtime) => runtime.id === locator),
    ) ??
    (locator === "local:placeholder"
      ? machines.find((candidate) => candidate.isCurrent) ?? null
      : null)
  );
}

function runtimeVersion(runtime: AgentRuntime): string | null {
  const raw = runtime.metadata?.cli_version;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function runtimeLauncher(runtime: AgentRuntime): string | null {
  const raw = runtime.metadata?.launched_by;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function totalTokens(rows: RuntimeUsage[]): number {
  return rows.reduce(
    (sum, row) =>
      sum +
      row.input_tokens +
      row.output_tokens +
      row.cache_read_tokens +
      row.cache_write_tokens,
    0,
  );
}

function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Seven local-day buckets, so the tape reads left-to-right into today. */
function buildTape(rows: RuntimeUsage[], now: Date) {
  const buckets: { key: string; tokens: number }[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(now);
    day.setDate(day.getDate() - offset);
    buckets.push({ key: dayKey(day), tokens: 0 });
  }
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  for (const row of rows) {
    const bucket = byKey.get(row.date.slice(0, 10));
    if (!bucket) continue;
    bucket.tokens +=
      row.input_tokens +
      row.output_tokens +
      row.cache_read_tokens +
      row.cache_write_tokens;
  }
  const max = Math.max(1, ...buckets.map((bucket) => bucket.tokens));
  return buckets.map((bucket) => ({
    key: bucket.key,
    tokens: bucket.tokens,
    height: Math.max(10, Math.round((bucket.tokens / max) * 100)),
  }));
}

export function RuntimeDetailPage({
  runtimeId,
  localDaemonId,
  localMachineName,
  localMachineActions,
  hasLocalMachine,
  bootstrapping,
}: RuntimeDetailPageProps) {
  const { t } = useT("runtimes");
  const tz = useViewingTimezone();
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const qc = useQueryClient();
  const healthLabel = useHealthLabel();
  const timeAgo = useTimeAgo();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const { data: runtimes = [], isLoading } = useQuery(runtimeListOptions(wsId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: tasks = [] } = useQuery(agentTaskSnapshotOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: runtimeProfiles = [] } = useQuery(
    runtimeProfileListOptions(wsId),
  );
  const { byAgent: presence } = useWorkspacePresenceMap(wsId);
  const now = useNowTick();
  const machineLocator = decodeRouteParam(runtimeId);
  const [renameOpen, setRenameOpen] = useState(false);
  const [createProfileOpen, setCreateProfileOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string | null>(
    null,
  );
  const workloadIndex = useMemo(
    () => buildWorkloadIndex(agents, tasks),
    [agents, tasks],
  );
  const baseMachines = useMemo(
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
  const baseMachine = findMachine(baseMachines, machineLocator);
  const profileRows = useMemo(
    () =>
      runtimeProfiles.map((profile) => {
        const createdAt = Date.parse(profile.created_at);
        return {
          profile,
          createdAt: Number.isFinite(createdAt) ? createdAt : 0,
        };
      }),
    [runtimeProfiles],
  );
  const machineRuntimes = useMemo(() => {
    if (!baseMachine) return [];
    if (baseMachine.mode !== "local") return baseMachine.runtimes;
    return pendingRuntimesForProfiles({
      pendingProfiles: profileRows,
      runtimes: baseMachine.runtimes,
      localDaemonId: baseMachine.daemonId,
      localMachineName: baseMachine.title,
      fallbackMachineName: baseMachine.title,
    });
  }, [baseMachine, profileRows]);
  const machine = baseMachine;
  const selectedRuntime =
    machineRuntimes.find((runtime) => runtime.id === selectedRuntimeId) ??
    machineRuntimes[0] ??
    null;
  const selectedIsPending = selectedRuntime
    ? isPendingCustomRuntime(selectedRuntime)
    : false;

  useEffect(() => {
    setSelectedRuntimeId(null);
  }, [machine?.id]);

  useEffect(() => {
    if (
      selectedRuntimeId &&
      !machineRuntimes.some((runtime) => runtime.id === selectedRuntimeId)
    ) {
      setSelectedRuntimeId(null);
    }
  }, [machineRuntimes, selectedRuntimeId]);

  const { data: usage = [] } = useQuery({
    ...runtimeUsageOptions(selectedRuntime?.id ?? "", 7, tz),
    enabled: !!selectedRuntime && !selectedIsPending,
  });

  const handleDaemonEvent = useCallback(() => {
    qc.invalidateQueries({ queryKey: runtimeKeys.all(wsId) });
  }, [qc, wsId]);
  useWSEvent("daemon:register", handleDaemonEvent);

  const currentMember = currentUserId
    ? members.find((member) => member.user_id === currentUserId)
    : null;
  const isAdmin =
    currentMember?.role === "owner" || currentMember?.role === "admin";
  const canAddRuntime =
    isAdmin && machine?.mode === "local" && !!machine.daemonId;
  const renameTarget = useMemo(() => {
    if (!machine || machine.runtimes.length === 0) return null;
    const editable = isAdmin
      ? machine.runtimes[0]
      : machine.runtimes.find((runtime) => runtime.owner_id === currentUserId);
    if (!editable) return null;
    return {
      runtimeId: editable.id,
      currentName: sharedCustomName(machine.runtimes) ?? "",
    };
  }, [machine, isAdmin, currentUserId]);

  const machineAgents = useMemo(() => {
    if (!machine) return [];
    const ids = new Set(machineRuntimes.map((runtime) => runtime.id));
    return agents.filter(
      (agent) =>
        !agent.archived_at &&
        agent.runtime_id !== null &&
        ids.has(agent.runtime_id),
    );
  }, [agents, machine, machineRuntimes]);

  const runtimeAgents = useMemo(() => {
    if (!selectedRuntime) return [];
    return machineAgents.filter(
      (agent) => agent.runtime_id === selectedRuntime.id,
    );
  }, [machineAgents, selectedRuntime]);

  const runtimeWorkload: RuntimeWorkload =
    (selectedRuntime && workloadIndex.get(selectedRuntime.id)) ?? {
      agentIds: [],
      runningCount: 0,
      queuedCount: 0,
    };
  const capacity = runtimeAgents.reduce(
    (sum, agent) => sum + (agent.max_concurrent_tasks ?? 1),
    0,
  );
  const capacityTotal = Math.max(
    capacity,
    runtimeWorkload.runningCount + runtimeWorkload.queuedCount,
    1,
  );

  const models = useMemo(() => {
    const counts = new Map<string, number>();
    for (const agent of runtimeAgents) {
      const model = agent.model?.trim();
      if (!model) continue;
      counts.set(model, (counts.get(model) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [runtimeAgents]);

  const tape = useMemo(() => {
    if (usage.length === 0) return [];
    return buildTape(usage, new Date(now));
  }, [usage, now]);
  const usageTokens = totalTokens(usage);
  const usageCost = usage.reduce((sum, row) => sum + estimateCost(row), 0);

  if (isLoading) return <MachineDetailSkeleton />;

  if (!machine) {
    return (
      <div className="qw-rd-page">
        <div className="qw-rd-topbar">
          <AppLink href={paths.runtimes()} className="qw-rd-back">
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {t(($) => $.page.title)}
          </AppLink>
        </div>
        <div className="qw-rd-statepage">
          <AlertCircle className="size-8 text-destructive" aria-hidden="true" />
          <h3>{t(($) => $.machine.not_found_title)}</h3>
          <p>{t(($) => $.machine.not_found_hint)}</p>
          <AppLink href={paths.runtimes()} className="qw-rd-btn">
            {t(($) => $.detail.all_runtimes)}
          </AppLink>
        </div>
      </div>
    );
  }

  const MachineIcon = machine.section === "cloud" ? Cloud : Monitor;
  const online = machine.onlineCount > 0;
  const stateLabel =
    machine.runtimes.length === 0
      ? t(($) => $.console.unbound)
      : online
        ? t(($) => $.console.online)
        : healthLabel(machine.health);
  const heartbeat = machine.lastSeenAt
    ? timeAgo(machine.lastSeenAt)
    : t(($) => $.detail.never_seen);
  const machineSub = [
    machine.daemonId ? `daemon ${machine.daemonId}` : null,
    machine.deviceInfo ?? machine.subtitle,
    heartbeat,
  ]
    .filter((part): part is string => !!part)
    .join(" · ");

  const runtimeRemovable =
    !!selectedRuntime &&
    !selectedIsPending &&
    (isAdmin || selectedRuntime.owner_id === currentUserId);

  return (
    <div className="qw-rd-page">
      <div className="qw-rd-topbar">
        <AppLink href={paths.runtimes()} className="qw-rd-back">
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          {t(($) => $.page.title)}
        </AppLink>
        <span className="qw-rd-crumb">
          {t(($) => $.console.crumb_config)} / {t(($) => $.page.title)} /{" "}
          {machine.title}
        </span>
        <span className="qw-rd-online" data-on={online ? "" : undefined}>
          <i aria-hidden="true" />
          {stateLabel}
        </span>
      </div>

      <div className="qw-rd-scroll">
        <div className="qw-rd-wrap">
          <header className="qw-rd-machine-head">
            <span className="qw-rd-machine-mark">
              <MachineIcon className="size-4" aria-hidden="true" />
            </span>
            <div className="qw-rd-machine-main">
              <h1>{machine.title}</h1>
              <p>{machineSub}</p>
            </div>
            <div className="qw-rd-machine-actions">
              {renameTarget ? (
                <button
                  type="button"
                  className="qw-rd-btn"
                  onClick={() => setRenameOpen(true)}
                >
                  <Pencil className="size-3" aria-hidden="true" />
                  {t(($) => $.machine.rename)}
                </button>
              ) : null}
              {canAddRuntime ? (
                <button
                  type="button"
                  className="qw-rd-btn"
                  onClick={() => setCreateProfileOpen(true)}
                >
                  <Plus className="size-3" aria-hidden="true" />
                  {t(($) => $.profiles.add_custom)}
                </button>
              ) : null}
              {machine.isCurrent ? localMachineActions : null}
            </div>
          </header>

          <div className="qw-rd-stats">
            <span>
              <b>{machineAgents.length}</b>
              {t(($) => $.console.stat_agents, { count: machineAgents.length })}
            </span>
            <span>
              <b>{machine.runningCount}</b>
              {t(($) => $.console.stat_running)}
            </span>
            <span>
              <b>{machine.queuedCount}</b>
              {t(($) => $.console.stat_queued)}
            </span>
            <span>
              <b>{machineRuntimes.length}</b>
              {t(($) => $.console.stat_runtimes, {
                count: machineRuntimes.length,
              })}
            </span>
          </div>

          <div className="qw-rd-cli">
            <MachineCliSection
              machine={machine}
              currentUserId={currentUserId}
              canManagePublicRuntimes={isAdmin}
            />
          </div>

          <div className="qw-rd-body">
            <section className="qw-rd-runtimes">
              <div className="qw-rd-sec-head">
                <span>{t(($) => $.console.runtimes_head)}</span>
                <em>{machineRuntimes.length}</em>
              </div>
              {machineRuntimes.length === 0 ? (
                <div className="qw-rd-empty">
                  {bootstrapping
                    ? t(($) => $.page.bootstrapping.title)
                    : t(($) => $.console.no_runtimes)}
                </div>
              ) : (
                machineRuntimes.map((runtime) => {
                  const workload = workloadIndex.get(runtime.id);
                  const agentCount = machineAgents.filter(
                    (agent) => agent.runtime_id === runtime.id,
                  ).length;
                  const version = runtimeVersion(runtime);
                  const runtimeCapacity = agents
                    .filter(
                      (agent) =>
                        !agent.archived_at &&
                        agent.runtime_id === runtime.id,
                    )
                    .reduce(
                      (sum, agent) => sum + (agent.max_concurrent_tasks ?? 1),
                      0,
                    );
                  return (
                    <button
                      key={runtime.id}
                      type="button"
                      className="qw-rd-row"
                      data-on={
                        runtime.id === selectedRuntime?.id ? "" : undefined
                      }
                      onClick={() => setSelectedRuntimeId(runtime.id)}
                    >
                      <span className="qw-rd-row-mark">
                        <ProviderLogo
                          provider={runtime.provider}
                          className="size-[15px]"
                        />
                      </span>
                      <span className="qw-rd-row-main">
                        <b>
                          {runtimeDisplayLabel(runtime)}
                          {version ? ` ${version}` : ""}
                        </b>
                        <span>
                          {providerDisplayName(runtime.provider)} ·{" "}
                          {t(($) => $.console.runtime_agents, {
                            count: agentCount,
                          })}
                        </span>
                      </span>
                      <span className="qw-rd-row-meta">
                        <em>
                          {t(($) => $.console.capacity_row, {
                            running: workload?.runningCount ?? 0,
                            capacity: Math.max(runtimeCapacity, 1),
                          })}
                        </em>
                        <b>
                          {runtime.last_seen_at
                            ? timeAgo(runtime.last_seen_at)
                            : "—"}
                        </b>
                      </span>
                      <span
                        className="qw-rd-row-state"
                        data-on={runtime.status === "online" ? "" : undefined}
                      >
                        <i aria-hidden="true" />
                        {runtime.status === "online"
                          ? t(($) => $.console.online)
                          : t(($) => $.console.offline)}
                      </span>
                    </button>
                  );
                })
              )}
            </section>

            <aside className="qw-rd-detail">
              {!selectedRuntime ? (
                <div className="qw-rd-empty">
                  {t(($) => $.console.select_runtime)}
                </div>
              ) : (
                <>
                  <div className="qw-rd-detail-head">
                    <div className="qw-rd-detail-top">
                      <ProviderLogo
                        provider={selectedRuntime.provider}
                        className="size-[14px]"
                      />
                      {providerDisplayName(selectedRuntime.provider)}
                      {runtimeVersion(selectedRuntime)
                        ? ` · ${runtimeVersion(selectedRuntime)}`
                        : ""}
                    </div>
                    <h2>{runtimeDisplayLabel(selectedRuntime)}</h2>
                    <div className="qw-rd-detail-sub">
                      {selectedRuntime.status === "online"
                        ? t(($) => $.console.online)
                        : t(($) => $.console.offline)}
                      {selectedRuntime.last_seen_at
                        ? ` · ${timeAgo(selectedRuntime.last_seen_at)}`
                        : ""}
                    </div>
                    <div className="qw-rd-detail-actions">
                      {selectedIsPending ? null : (
                        <AppLink
                          href={paths.runtimeSettings(
                            machine.id,
                            selectedRuntime.id,
                          )}
                          className="qw-rd-btn primary"
                        >
                          {t(($) => $.console.open_settings)}
                        </AppLink>
                      )}
                      {runtimeRemovable ? (
                        <button
                          type="button"
                          className="qw-rd-btn"
                          onClick={() => setRemoveOpen(true)}
                        >
                          {t(($) => $.console.remove)}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {selectedIsPending ? (
                    <p className="qw-rd-note">
                      {t(($) => $.console.pending_notice)}
                    </p>
                  ) : null}

                  <section className="qw-rd-section">
                    <div className="qw-rd-sec-head">
                      {t(($) => $.console.capacity)}
                    </div>
                    <div className="qw-rd-fact">
                      <span>{t(($) => $.console.concurrency_limit)}</span>
                      <b>{capacity}</b>
                    </div>
                    <div className="qw-rd-fact">
                      <span>{t(($) => $.console.stat_running)}</span>
                      <b>{runtimeWorkload.runningCount}</b>
                    </div>
                    <div className="qw-rd-fact">
                      <span>{t(($) => $.console.stat_queued)}</span>
                      <b>{runtimeWorkload.queuedCount}</b>
                    </div>
                    <div className="qw-rd-cap" aria-hidden="true">
                      {Array.from({ length: capacityTotal }).map((_, index) => (
                        <i
                          key={index}
                          data-kind={
                            index < runtimeWorkload.runningCount
                              ? "running"
                              : index <
                                  runtimeWorkload.runningCount +
                                    runtimeWorkload.queuedCount
                                ? "queued"
                                : "free"
                          }
                        />
                      ))}
                    </div>
                  </section>

                  <section className="qw-rd-section">
                    <div className="qw-rd-sec-head">
                      {t(($) => $.console.identity)}
                    </div>
                    <div className="qw-rd-fact">
                      <span>{t(($) => $.console.daemon)}</span>
                      <b>{machine.daemonId ?? "—"}</b>
                    </div>
                    <div className="qw-rd-fact">
                      <span>{t(($) => $.console.cli_version)}</span>
                      <b>{runtimeVersion(selectedRuntime) ?? "—"}</b>
                    </div>
                    <div className="qw-rd-fact">
                      <span>{t(($) => $.console.launched_by)}</span>
                      <b>{runtimeLauncher(selectedRuntime) ?? "—"}</b>
                    </div>
                    <div className="qw-rd-fact">
                      <span>{t(($) => $.console.last_used)}</span>
                      <b>
                        {selectedRuntime.last_seen_at
                          ? timeAgo(selectedRuntime.last_seen_at)
                          : "—"}
                      </b>
                    </div>
                  </section>

                  <section className="qw-rd-section">
                    <div className="qw-rd-sec-head">
                      {t(($) => $.console.models)}
                      <em>{models.length}</em>
                    </div>
                    {models.length === 0 ? (
                      <p className="qw-rd-note">{t(($) => $.console.no_models)}</p>
                    ) : (
                      <div className="qw-rd-models">
                        {models.map(([model, count]) => (
                          <div key={model} className="qw-rd-model">
                            <span>{model}</span>
                            <em>{count}</em>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="qw-rd-section">
                    <div className="qw-rd-sec-head">
                      {t(($) => $.console.agents)}
                      <em>{runtimeAgents.length}</em>
                    </div>
                    {runtimeAgents.length === 0 ? (
                      <p className="qw-rd-note">{t(($) => $.detail.no_agents)}</p>
                    ) : (
                      <div className="qw-rd-agents">
                        {runtimeAgents.map((agent: Agent) => {
                          const state = presence.get(agent.id);
                          return (
                            <div key={agent.id} className="qw-rd-agent">
                              <span className="qw-rd-agent-ava">
                                <ActorAvatar
                                  actorType="agent"
                                  actorId={agent.id}
                                  size="sm"
                                />
                              </span>
                              <span className="qw-rd-agent-name">
                                {agent.name}
                              </span>
                              <span>
                                {state?.workload === "working"
                                  ? t(($) => $.console.running)
                                  : t(($) => $.console.idle)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  <section className="qw-rd-section">
                    <div className="qw-rd-sec-head">
                      {t(($) => $.console.activity)}
                    </div>
                    {tape.length === 0 ? (
                      <p className="qw-rd-note">
                        {selectedIsPending
                          ? t(($) => $.console.pending_notice)
                          : t(($) => $.console.no_activity)}
                      </p>
                    ) : (
                      <>
                        <div className="qw-rd-tape" aria-hidden="true">
                          {tape.map((day, index) => (
                            <i
                              key={day.key}
                              data-today={
                                index === tape.length - 1 ? "" : undefined
                              }
                              style={{ height: `${day.height}%` }}
                            />
                          ))}
                        </div>
                        <div className="qw-rd-tape-foot">
                          <span>
                            {formatTokens(usageTokens)}{" "}
                            {t(($) => $.console.tokens)}
                          </span>
                          <span>{formatUsd(usageCost)}</span>
                        </div>
                      </>
                    )}
                  </section>
                </>
              )}
            </aside>
          </div>
        </div>
      </div>

      {renameTarget ? (
        <RenameMachineDialog
          open={renameOpen}
          onOpenChange={setRenameOpen}
          wsId={wsId}
          runtimeId={renameTarget.runtimeId}
          currentName={renameTarget.currentName}
        />
      ) : null}
      {canAddRuntime && createProfileOpen ? (
        <RuntimeProfilesDialog
          wsId={wsId}
          intent="create"
          machineName={machine.title}
          onClose={() => setCreateProfileOpen(false)}
        />
      ) : null}
      {runtimeRemovable && selectedRuntime ? (
        <DeleteRuntimeDialog
          open={removeOpen}
          onOpenChange={setRemoveOpen}
          runtime={selectedRuntime}
          wsId={wsId}
          onDeleted={() => {
            setRemoveOpen(false);
            toast.success(t(($) => $.detail.toast_deleted));
            if (machineRuntimes.length > 1) {
              setSelectedRuntimeId(null);
            } else {
              navigation.push(paths.runtimes());
            }
          }}
        />
      ) : null}
    </div>
  );
}

function MachineDetailSkeleton() {
  return (
    <div className="qw-rd-page">
      <div className="qw-rd-topbar">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-44" />
      </div>
      <div className="qw-rd-scroll">
        <div className="qw-rd-wrap">
          <div className="qw-rd-machine-head">
            <Skeleton className="size-9 rounded-md" />
            <div className="flex-1">
              <Skeleton className="h-7 w-64" />
              <Skeleton className="mt-2 h-3 w-72" />
            </div>
          </div>
          <div className="flex gap-4 py-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-4 w-24" />
            ))}
          </div>
          <div className="flex gap-7">
            <div className="flex-1">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton
                  key={index}
                  className="mt-px h-16 w-full rounded-none"
                />
              ))}
            </div>
            <Skeleton className="h-80 w-[340px]" />
          </div>
        </div>
      </div>
    </div>
  );
}
