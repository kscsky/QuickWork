"use client";

import type { AgentRuntime } from "@quickwork/core/types";
import { isAgentRuntimeBound } from "@quickwork/core/agents";
import { cn } from "@quickwork/ui/lib/utils";

import { ActorAvatar } from "../../common/actor-avatar";
import { useT } from "../../i18n";
import { ProviderLogo } from "../../runtimes/components/provider-logo";
import { ActivitySparkline } from "./activity-sparkline";
import { AgentRowActions } from "./agent-row-actions";
import { CountUp } from "./count-up";
import type { AgentListRow } from "./agents-page";
import {
  machineHue,
  machineIdOf,
  machineShortLabel,
  runtimeHue,
} from "./machine-rail";

function MachineTag({ runtime }: { runtime: AgentRuntime | null }) {
  const { t } = useT("agents");
  const label = machineShortLabel(runtime ?? { name: "", custom_name: null });
  const machine = runtime ? machineIdOf(runtime) : "";
  return (
    <span className="qw-tag-hue inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-[3px] px-1.5 py-px font-mono text-[11px] leading-4">
      {runtime ? (
        <ProviderLogo provider={runtime.provider} className="size-3 shrink-0" />
      ) : null}
      <span className="truncate">
        {runtime ? (machine ? `${label} · ${machine}` : label) : t(($) => $.rail.unbound)}
      </span>
    </span>
  );
}

/** 8px square lamp — the one lamp shape on the page (rail and cards). */
function Lamp({ tone, pulse }: { tone: "ok" | "busy" | "off" | "none"; pulse?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 shrink-0 rounded-[2px]",
        tone === "ok" && "bg-success",
        tone === "busy" && "bg-inflight",
        tone === "off" && "bg-muted-foreground/40",
        tone === "none" && "bg-warning",
        pulse && "qw-pulse",
      )}
    />
  );
}

const STATUS_TEXT = {
  ok: "qw-st-ok",
  busy: "text-inflight font-medium",
  off: "text-muted-foreground",
  none: "qw-st-none",
} as const;

function Kpi({
  label,
  value,
  hot,
  roll,
}: {
  label: string;
  value: number;
  hot?: boolean;
  roll?: boolean;
}) {
  return (
    <span className="text-micro tracking-normal text-muted-foreground">
      {label}
      <b
        className={cn(
          "block text-title-lg leading-none font-semibold tabular-nums",
          hot ? "text-inflight" : "text-foreground",
        )}
      >
        {roll ? <CountUp value={value} /> : value}
      </b>
    </span>
  );
}

/**
 * One agent as a card: who it is, which machine it stands on, and what that
 * machine is holding. The machine's hue paints the top wash and the machine
 * tag; running agents carry a progress ring and an orange count, while an
 * offline or unbound card goes dashed + flat and its KPIs give way to the
 * sentence explaining where its work goes — the colour IS the state, never
 * decoration.
 */
export function AgentCard({
  row,
  onOpen,
  duplicateHref,
}: {
  row: AgentListRow;
  onOpen: () => void;
  duplicateHref: string;
}) {
  const { t } = useT("agents");
  const { agent, presence, runtime } = row;
  const archived = !!agent.archived_at;
  const bound = isAgentRuntimeBound(agent);
  const hue = runtime ? runtimeHue(runtime) : machineHue(agent.runtime_id);
  const offline = !!runtime && runtime.status !== "online";
  const running = presence?.runningCount ?? 0;
  const queued = presence?.queuedCount ?? 0;
  const capacity = presence?.capacity ?? agent.max_concurrent_tasks;
  const dead = archived || !bound || offline;
  // Ring: share of capacity currently running (0 when nothing runs).
  const ringShare = capacity > 0 ? Math.min(1, running / capacity) : 0;
  const hasSpark = !dead && (row.activity?.buckets.length ?? 0) >= 2;

  // One status language, most specific state first.
  let tone: keyof typeof STATUS_TEXT;
  let statusLabel: string;
  if (archived) {
    tone = "off";
    statusLabel = t(($) => $.row.archived);
  } else if (!bound) {
    tone = "none";
    statusLabel = t(($) => $.row.needs_runtime);
  } else if (offline) {
    tone = "off";
    statusLabel = t(($) => $.card.machine_offline);
  } else if (running > 0) {
    tone = "busy";
    statusLabel = t(($) => $.card.running);
  } else if (presence?.availability === "unstable") {
    tone = "none";
    statusLabel = t(($) => $.availability.unstable);
  } else if (presence) {
    tone = "ok";
    statusLabel = t(($) => $.workload.idle);
  } else {
    tone = "off";
    statusLabel = "—";
  }

  // The KPIs give way to the explanatory sentence only when there is no work
  // to count (an offline machine with queued work still shows the numbers —
  // that queue IS the stuck signal). Archived/unbound cards follow the same
  // rule so their sentence is the whole middle block.
  const showSentence = dead && running + queued === 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{ "--mh": hue } as React.CSSProperties}
      className={cn(
        "qw-mh qw-rise relative flex cursor-pointer flex-col overflow-hidden rounded-[var(--radius)] border bg-surface px-3.5 pt-[13px] pb-3.5 text-left",
        "shadow-[var(--shadow-surface)] transition-[border-color,box-shadow] duration-150 hover:border-input",
        dead && "border-dashed shadow-none",
        archived && "opacity-60",
      )}
    >
      <span
        aria-hidden="true"
        className="qw-wash pointer-events-none absolute inset-x-0 top-0 h-[74px]"
      />

      <div className="relative flex items-center gap-2.5">
        <ActorAvatar
          actorType="agent"
          actorId={agent.id}
          size="lg"
          profileLink={false}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-label font-semibold">
            {agent.name}
          </span>
          <span className="mt-0.5 block truncate text-micro tracking-normal text-muted-foreground">
            {agent.description || t(($) => $.row.no_description)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={cn("inline-flex items-center gap-1.5 text-caption whitespace-nowrap", STATUS_TEXT[tone])}>
            <Lamp tone={tone} pulse={tone === "busy"} />
            {statusLabel}
          </span>
          <span
            onClick={(e) => e.stopPropagation()}
            className="flex shrink-0 items-center"
          >
            <AgentRowActions
              agent={agent}
              presence={presence}
              canManage={row.canManage}
              duplicateHref={duplicateHref}
            />
          </span>
        </span>
      </div>

      <div className="relative mt-3 flex items-center gap-3">
        {running > 0 && (
          <svg aria-hidden="true" className="size-[46px] shrink-0" viewBox="0 0 46 46">
            <circle
              cx="23"
              cy="23"
              r="18"
              fill="none"
              strokeWidth="5"
              strokeLinecap="butt"
              className="stroke-muted"
            />
            <circle
              cx="23"
              cy="23"
              r="18"
              fill="none"
              strokeWidth="5"
              className="qw-ring-val stroke-inflight"
              strokeDashoffset={113 * (1 - ringShare)}
            />
          </svg>
        )}
        {showSentence ? (
          <span
            className={cn(
              "min-w-0 text-micro tracking-normal",
              archived || offline ? "text-muted-foreground" : "qw-st-none",
            )}
          >
            {archived
              ? t(($) => $.row.archived)
              : !bound
                ? t(($) => $.card.unbound_note)
                : t(($) => $.card.offline_note)}
          </span>
        ) : (
          <span className="flex min-w-0 items-start gap-3">
            <Kpi label={t(($) => $.card.running)} value={running} hot={running > 0} roll />
            <Kpi label={t(($) => $.card.queued)} value={queued} roll />
            <Kpi label={t(($) => $.card.capacity)} value={capacity} />
          </span>
        )}
      </div>

      <div className="relative mt-3 flex items-center gap-2.5 border-t border-border pt-2.5">
        <MachineTag runtime={runtime} />
        <span className="flex-1" />
        {queued > 0 && (
          <span className="qw-shimmer qw-st-none inline-flex shrink-0 items-center rounded-[3px] bg-warning/15 px-[7px] py-px text-[11px] leading-4 tabular-nums">
            {t(($) => $.row.task_count, { count: queued })}
          </span>
        )}
        {hasSpark ? (
          <ActivitySparkline buckets={(row.activity?.buckets ?? []).slice(-14)} />
        ) : offline && !archived ? (
          <span className="shrink-0 text-caption qw-st-none">
            {t(($) => $.card.pending_recovery)}
          </span>
        ) : !bound && !archived ? (
          <span className="shrink-0 text-caption text-muted-foreground">—</span>
        ) : null}
      </div>
    </div>
  );
}
