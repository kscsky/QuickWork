"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  Bot,
  PenLine,
  Server,
  Settings2,
  Trash2,
  UserRound,
} from "lucide-react";
import type {
  Agent,
  AgentRuntime,
  MemberWithUser,
} from "@quickwork/core/types";
import {
  agentTasksOptions,
  effectiveAccessScope,
  useWorkspaceActivityMap,
} from "@quickwork/core/agents";
import { issueDetailOptions } from "@quickwork/core/issues/queries";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { squadListOptions } from "@quickwork/core/workspace/queries";
import { cn } from "@quickwork/ui/lib/utils";
import { useT, useTimeAgo } from "../../i18n";
import { ProviderLogo } from "../../runtimes/components/provider-logo";
import { taskStatusConfig } from "../config";
import { ActivitySparkline } from "./activity-sparkline";
import { AgentProfileCard, AgentExecutionCard } from "./agent-detail-inspector";
import type { DetailTab, SecondaryTab } from "./agent-overview-pane";
import type { SettingsSaveStatus } from "../../settings/components/settings-layout";
import {
  machineIdOf,
  machineShortLabel,
  runtimeHue,
  UNBOUND_HUE,
} from "./machine-rail";

/**
 * The 机架 (module rack): the agent's configuration as a stack of lamped
 * modules — 身份 / 执行 / 能力 / 授权 — each with a mono id, a state lamp and
 * a status chip, next to a live column carrying the machine seat, the latest
 * runs and the relay (which squads hand it work). Replaces the flat form:
 * "which part is not set up yet" is a chip, not a scroll.
 */
type AgentsT = ReturnType<typeof useT<"agents">>["t"];

export function AgentConsole({
  agent,
  runtime,
  runtimes,
  members,
  owner,
  currentUserId,
  canEdit,
  onUpdate,
  onOpenView,
  onArchive,
  capabilityTabs,
  settingsTabs,
}: {
  agent: Agent;
  runtime: AgentRuntime | null;
  runtimes: AgentRuntime[];
  members: MemberWithUser[];
  owner: MemberWithUser | null;
  currentUserId: string | null;
  canEdit: boolean;
  onUpdate: (id: string, data: Record<string, unknown>) => Promise<void>;
  onOpenView: (view: DetailTab) => void;
  onArchive?: () => void;
  capabilityTabs: SecondaryTab[];
  /** Settings tabs WITHOUT 通用 — that module's fields already live inline
   *  in 身份 / 执行. */
  settingsTabs: SecondaryTab[];
}) {
  const { t } = useT("agents");
  const [saveStatus, setSaveStatus] = useState<SettingsSaveStatus>("idle");
  const wsId = useWorkspaceId();
  const { byAgent: activityMap } = useWorkspaceActivityMap(wsId);

  const bound = !!runtime;
  const offline = !!runtime && runtime.status !== "online";

  // 能力: count the surfaces with nothing configured yet.
  const capabilityGaps = useMemo(
    () => capabilityTabs.filter((tab) => needsSetup(tab.id, agent) === true).length,
    [agent, capabilityTabs],
  );
  const scope = effectiveAccessScope(
    agent.permission_mode,
    agent.invocation_targets,
  );
  const scopeLabel = t(($) =>
    scope === "workspace"
      ? $.access.scope_labels.workspace
      : scope === "specific-people"
        ? $.access.scope_labels.specific_people
        : $.access.scope_labels.owner_only,
  );

  const hue = runtime ? runtimeHue(runtime) : UNBOUND_HUE;

  return (
    <div
      style={{ "--mh": hue } as React.CSSProperties}
      className="qw-mh mx-auto grid w-full max-w-[1440px] gap-3.5 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_264px]"
    >
      <div className="flex min-w-0 flex-col gap-3.5">
        <Module
          id="MOD-01"
          index={0}
          title={t(($) => $.console.identity)}
          tone="ok"
          chip={<SaveChip status={saveStatus} />}
        >
          <AgentProfileCard
            agent={agent}
            canEdit={canEdit}
            onUpdate={onUpdate}
            onSaveStatusChange={setSaveStatus}
            className="rounded-none border-0 bg-transparent shadow-none"
          />
        </Module>

        <Module
          id="MOD-02"
          index={1}
          title={t(($) => $.console.execution)}
          tone={offline || !bound ? "off" : "ok"}
          chip={
            !bound ? (
              <StateChip tone="none">{t(($) => $.row.needs_runtime)}</StateChip>
            ) : offline ? (
              <StateChip tone="warn">
                {t(($) => $.console.runtime_offline)}
              </StateChip>
            ) : undefined
          }
        >
          <AgentExecutionCard
            agent={agent}
            runtime={runtime}
            runtimes={runtimes}
            members={members}
            currentUserId={currentUserId}
            canEdit={canEdit}
            onUpdate={onUpdate}
            className="rounded-none border-0 bg-transparent shadow-none"
          />
        </Module>

        <Module
          id="MOD-03"
          index={2}
          title={t(($) => $.console.capability)}
          tone={capabilityGaps > 0 ? "warn" : "ok"}
          chip={
            capabilityGaps > 0 ? (
              <StateChip tone="warn">
                {t(($) => $.console.needs_setup, { count: capabilityGaps })}
              </StateChip>
            ) : (
              <StateChip tone="ok">{t(($) => $.console.set)}</StateChip>
            )
          }
        >
          {capabilityTabs.map((tab) => (
            <ModuleRow
              key={tab.id}
              icon={capabilityIcon(tab.id)}
              label={t(($) => $.tabs[tab.labelKey])}
              state={capabilityState(tab.id, agent, t)}
              action={
                <LinkButton onClick={() => onOpenView(tab.id)}>
                  {t(($) => $.console.go_configure)}
                </LinkButton>
              }
            />
          ))}
        </Module>

        <Module
          id="MOD-04"
          index={3}
          title={t(($) => $.console.access)}
          tone="ok"
          chip={<StateChip tone="hue">{scopeLabel}</StateChip>}
        >
          <ModuleRow
            icon={<UserRound aria-hidden="true" className="size-3.5" />}
            label={t(($) => $.inspector.prop_owner)}
            state={owner?.name ?? "—"}
            action={null}
          />
          {settingsTabs.map((tab) => (
            <ModuleRow
              key={tab.id}
              icon={<Settings2 aria-hidden="true" className="size-3.5" />}
              label={t(($) => $.tabs[tab.labelKey])}
              state={settingsState(tab.id, agent, t, scopeLabel)}
              action={
                <LinkButton onClick={() => onOpenView(tab.id)}>
                  {t(($) => $.console.go_configure)}
                </LinkButton>
              }
            />
          ))}
          {onArchive ? (
            <div className="flex items-center gap-2.5 px-3.5 py-2.5">
              <Trash2 aria-hidden="true" className="size-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
                {t(($) => $.console.danger)}
              </span>
              <button
                type="button"
                onClick={onArchive}
                className="shrink-0 text-caption text-destructive underline-offset-4 hover:underline"
              >
                {t(($) => $.detail.more_archive)}
              </button>
            </div>
          ) : null}
        </Module>
      </div>

      <div className="flex min-w-0 flex-col gap-3.5">
        <MachineSeatCard
          runtime={runtime}
          buckets={activityMap.get(agent.id)?.buckets ?? []}
        />
        <RecentRunsCard agent={agent} />
        <RelayCard agent={agent} />
      </div>
    </div>
  );
}

/* ── module shell ─────────────────────────────────────────────────────── */

type Tone = "ok" | "warn" | "off";

function Module({
  id,
  title,
  tone,
  chip,
  index,
  children,
}: {
  id: string;
  title: string;
  tone: Tone;
  chip?: ReactNode;
  /** Rack position — drives the staggered rise. */
  index: number;
  children: ReactNode;
}) {
  return (
    <section
      style={{ animationDelay: `${index * 60}ms` }}
      className="qw-module qw-rise overflow-hidden rounded-[var(--radius)] border bg-surface shadow-[var(--shadow-surface)]"
    >
      <header className="qw-module-head flex items-center gap-2.5 border-b px-3.5 py-2.5">
        <span
          aria-hidden="true"
          className={cn(
            "size-2 shrink-0 rounded-[2px]",
            tone === "ok" && "bg-success",
            tone === "warn" && "bg-warning",
            tone === "off" && "bg-muted-foreground/40",
          )}
        />
        <span className="shrink-0 font-mono text-[10px] font-semibold tracking-[0.07em] text-[var(--hue)]">
          {id}
        </span>
        <span className="truncate text-[13.5px] font-semibold">{title}</span>
        <span className="min-w-0 flex-1" />
        {chip}
      </header>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

/** Borderless "go configure" affordance used by the module rows. */
function LinkButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-[var(--radius)] px-1.5 py-0.5 text-caption text-brand transition-[color,background-color,transform] hover:translate-x-0.5 hover:bg-brand/10"
    >
      {children} ↗
    </button>
  );
}

function StateChip({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "none" | "hue";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-px font-mono text-[10.5px] whitespace-nowrap",
        tone === "ok" && "bg-success/15 text-[color-mix(in_oklab,var(--success)_72%,var(--foreground))]",
        tone === "warn" && "qw-shimmer bg-warning/20 qw-st-none",
        tone === "none" && "qw-shimmer bg-warning/20 qw-st-none",
        tone === "hue" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function SaveChip({ status }: { status: SettingsSaveStatus }) {
  const { t } = useT("settings");
  if (status === "idle") return null;
  return (
    <StateChip tone={status === "error" ? "warn" : "ok"}>
      {status === "saving"
        ? t(($) => $.auto_save.saving)
        : status === "saved"
          ? t(($) => $.auto_save.saved)
          : t(($) => $.auto_save.failed)}
    </StateChip>
  );
}

function ModuleRow({
  icon,
  label,
  state,
  action,
}: {
  icon: ReactNode;
  label: string;
  state: string | null;
  action: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 px-3.5 py-2.5">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="shrink-0 text-label">{label}</span>
      {state ? (
        <span className="min-w-0 truncate text-caption text-muted-foreground">
          {state}
        </span>
      ) : null}
      <span className="min-w-0 flex-1" />
      {action}
    </div>
  );
}

/* ── live column ──────────────────────────────────────────────────────── */

function LiveCard({
  title,
  children,
  wash,
}: {
  title: string;
  children: ReactNode;
  wash?: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[var(--radius)] border bg-surface shadow-[var(--shadow-surface)]">
      {wash}
      <div className="px-3.5 py-3">
        <div className="font-mono text-[10px] tracking-[0.08em] text-faint-foreground uppercase">
          {title}
        </div>
        {children}
      </div>
    </section>
  );
}

function MachineSeatCard({
  runtime,
  buckets,
}: {
  runtime: AgentRuntime | null;
  /** The agent's 30-day activity, drawn as the seat's sparkline. */
  buckets: readonly { total: number }[];
}) {
  const { t } = useT("agents");
  if (!runtime) {
    return (
      <LiveCard title={t(($) => $.console.machine)}>
        <div className="mt-2 flex items-center gap-2">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-[2px] bg-warning" />
          <span className="min-w-0 truncate text-caption qw-st-none">
            {t(($) => $.rail.unbound)}
          </span>
        </div>
        <p className="mt-1.5 text-caption leading-5 text-muted-foreground">
          {t(($) => $.rail.unbound_hint)}
        </p>
      </LiveCard>
    );
  }
  const hue = runtimeHue(runtime);
  const offline = runtime.status !== "online";
  const version = runtime.device_info?.split(" · ")[1]?.trim() ?? "";
  return (
    <LiveCard
      wash={
        <span
          aria-hidden="true"
          className="block h-[60px] -mb-[60px]"
          style={{
            background: `linear-gradient(180deg, color-mix(in oklab, oklch(0.55 0.15 ${hue}) 9%, var(--surface)), transparent)`,
          }}
        />
      }
      title={t(($) => $.console.machine)}
    >
      <div className="relative mt-2 flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            "size-2 shrink-0 rounded-[2px]",
            offline ? "bg-muted-foreground/40" : "bg-success",
          )}
        />
        <span className="min-w-0 truncate font-mono text-caption">
          {machineIdOf(runtime)}
        </span>
      </div>
      <div className="relative mt-1.5 flex items-center gap-2 text-caption text-muted-foreground">
        <ProviderLogo provider={runtime.provider} className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          {machineShortLabel(runtime)}
          {version ? ` · ${version}` : ""}
        </span>
      </div>
      <div className="relative mt-2 flex flex-wrap items-center gap-1.5">
        <span
          className="rounded-[3px] px-1.5 py-px font-mono text-[10.5px]"
          style={{
            background: `color-mix(in oklab, oklch(0.55 0.15 ${hue}) 12%, transparent)`,
            color: `color-mix(in oklab, oklch(0.55 0.15 ${hue}) 70%, var(--foreground))`,
          }}
        >
          {t(($) => $.console.hue, { value: hue })}
        </span>
        <span className="rounded-[3px] bg-muted px-1.5 py-px font-mono text-[10.5px] text-muted-foreground">
          {runtime.runtime_mode === "cloud"
            ? t(($) => $.row.fallback_runtime_cloud)
            : t(($) => $.row.fallback_runtime_local)}
        </span>
        <span className="min-w-0 flex-1" />
        {buckets.length >= 2 ? (
          <ActivitySparkline buckets={buckets} className="h-4 w-[68px]" />
        ) : null}
      </div>
    </LiveCard>
  );
}

function RecentRunsCard({ agent }: { agent: Agent }) {
  const { t } = useT("agents");
  const timeAgo = useTimeAgo();
  const wsId = useWorkspaceId();
  const { data: tasks = [] } = useQuery({
    ...agentTasksOptions(wsId ?? "", agent.id),
    enabled: !!wsId,
  });
  const recent = useMemo(
    () =>
      tasks
        .filter(
          (task) =>
            task.status === "completed" ||
            task.status === "failed" ||
            task.status === "cancelled",
        )
        .toSorted((a, b) => runTime(b) - runTime(a))
        .slice(0, 3),
    [tasks],
  );
  const issues = useQueries({
    queries: recent.map((task) => ({
      ...issueDetailOptions(wsId ?? "", task.issue_id || "00000000-0000-0000-0000-000000000000"),
      enabled: !!wsId && !!task.issue_id,
    })),
  });

  return (
    <LiveCard title={t(($) => $.console.recent_runs)}>
      {recent.length === 0 ? (
        <p className="mt-2 text-caption leading-5 text-muted-foreground">
          {t(($) => $.tab_body.activity.empty_recent)}
        </p>
      ) : (
        <div className="mt-1">
          {recent.map((task, index) => {
            const status = taskStatusConfig[task.status] ?? taskStatusConfig.completed;
            const Icon = status?.icon;
            const title = issues[index]?.data?.title;
            return (
              <div
                key={task.id}
                className="flex items-center gap-2 border-b border-border py-1.5 last:border-b-0"
              >
                {Icon ? (
                  <Icon
                    aria-hidden="true"
                    className={cn("size-3 shrink-0", status?.color)}
                  />
                ) : null}
                <span className="min-w-0 flex-1 truncate text-caption">
                  {title ??
                    t(($) => $.console.run_fallback, {
                      status: t(($) => $.tab_body.activity.status[task.status]),
                    })}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-faint-foreground">
                  {timeAgo(task.completed_at ?? task.started_at ?? agent.updated_at)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </LiveCard>
  );
}

function RelayCard({ agent }: { agent: Agent }) {
  const { t } = useT("agents");
  const wsId = useWorkspaceId();
  const { data: squads = [] } = useQuery({
    ...squadListOptions(wsId ?? ""),
    enabled: !!wsId,
  });
  // Best-effort: member_preview can be truncated by the API, so a squad where
  // the agent is a non-previewed member won't be listed. The leader match is
  // exact.
  const relays = useMemo(
    () =>
      squads
        .map((squad) => {
          if (squad.leader_id === agent.id) {
            return { squad, role: "leader" as const };
          }
          const isMember = (squad.member_preview ?? []).some(
            (m) => m.member_type === "agent" && m.member_id === agent.id,
          );
          return isMember ? { squad, role: "member" as const } : null;
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    [agent.id, squads],
  );

  return (
    <LiveCard title={t(($) => $.console.relay)}>
      {relays.length === 0 ? (
        <p className="mt-2 text-caption leading-5 text-muted-foreground">
          {t(($) => $.console.relay_empty)}
        </p>
      ) : (
        <div className="mt-1">
          {relays.map(({ squad, role }) => (
            <div key={squad.id} className="flex items-center gap-2 py-1.5">
              <svg
                aria-hidden="true"
                className="h-2 w-[26px] shrink-0"
                viewBox="0 0 26 8"
              >
                <line
                  x1="0"
                  y1="4"
                  x2="26"
                  y2="4"
                  stroke="var(--hue)"
                  strokeWidth="1.5"
                  strokeDasharray="5 3"
                  className="qw-dash-flow"
                />
              </svg>
              <span className="min-w-0 flex-1 truncate text-caption">
                {squad.name}
              </span>
              <span className="shrink-0 rounded-[3px] bg-muted px-1.5 py-px font-mono text-[10.5px] text-muted-foreground">
                {role === "leader"
                  ? t(($) => $.console.relay_leader)
                  : t(($) => $.console.relay_member)}
              </span>
            </div>
          ))}
        </div>
      )}
    </LiveCard>
  );
}

/* ── state derivation ─────────────────────────────────────────────────── */

/** null = no cheap signal for this surface; true/false = knowable. */
function needsSetup(tabId: DetailTab, agent: Agent): boolean | null {
  switch (tabId) {
    case "instructions":
      return !agent.instructions?.trim();
    case "skills":
      return (agent.skills?.length ?? 0) === 0;
    case "mcp_config":
      return !(agent.mcp_config_redacted === true || agent.mcp_config != null);
    default:
      return null;
  }
}

function capabilityState(
  tabId: DetailTab,
  agent: Agent,
  t: AgentsT,
): string | null {
  switch (tabId) {
    case "instructions":
      return t(($) =>
        needsSetup(tabId, agent) ? $.console.unset : $.console.set,
      );
    case "skills": {
      const count = agent.skills?.length ?? 0;
      return count > 0
        ? t(($) => $.console.count_items, { count })
        : t(($) => $.console.unset);
    }
    case "mcp_config":
      return t(($) =>
        needsSetup(tabId, agent) ? $.console.unset : $.console.set,
      );
    default:
      return null;
  }
}

function settingsState(
  tabId: DetailTab,
  agent: Agent,
  t: AgentsT,
  scopeLabel: string,
): string | null {
  switch (tabId) {
    case "access":
      return scopeLabel;
    case "env": {
      const count = agent.custom_env_key_count ?? 0;
      return t(($) => $.console.count_entries, { count });
    }
    case "custom_args": {
      const count = agent.custom_args?.length ?? 0;
      return t(($) => $.console.count_items, { count });
    }
    default:
      return null;
  }
}

function capabilityIcon(tabId: DetailTab): ReactNode {
  switch (tabId) {
    case "instructions":
      return <PenLine aria-hidden="true" className="size-3.5" />;
    case "skills":
      return <Bot aria-hidden="true" className="size-3.5" />;
    default:
      return <Server aria-hidden="true" className="size-3.5" />;
  }
}

function runTime(task: { completed_at: string | null; started_at: string | null }) {
  return Date.parse(task.completed_at ?? task.started_at ?? "") || 0;
}
