"use client";

import type { AgentRuntime } from "@quickwork/core/types";
import { cn } from "@quickwork/ui/lib/utils";

import { ActorAvatar } from "../../common/actor-avatar";
import { useT } from "../../i18n";
import { ProviderLogo } from "../../runtimes/components/provider-logo";
import type { AgentListRow } from "./agents-page";

/** The synthetic bucket for agents with no runtime bound. */
export const UNBOUND_MACHINE = "unbound";

/**
 * Machine key for an agent's `runtime_id`.
 *
 * Unbound agents carry an EMPTY STRING (the API type keeps `runtime_id`
 * non-nullable), so `?? UNBOUND_MACHINE` alone would bucket them under "" and
 * render them as an unknown machine instead of the unbound slot.
 */
export function machineKeyOf(runtimeId: string | null | undefined): string {
  return (runtimeId ?? "").trim() || UNBOUND_MACHINE;
}
/** The rail's "show everything" key. */
export const ALL_MACHINES = "all";

/**
 * Zone hues, mirrored from the token palette. A machine's hue is derived from
 * its runtime id so a machine keeps its colour across sessions and pages, the
 * same way a workspace keeps its zone.
 */
export const ZONE_HUES = [258, 200, 160, 105, 62, 28, 340, 300];
export const UNBOUND_HUE = 28;

export function machineHue(runtimeId: string | null | undefined): number {
  const id = (runtimeId ?? "").trim();
  if (!id) return UNBOUND_HUE;
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ZONE_HUES[h % ZONE_HUES.length] ?? UNBOUND_HUE;
}

/**
 * CLI families whose hue is pinned by the design, so the page reads the same
 * in every workspace: Claude keeps the brand blue, Codex amber, Pi green.
 * Every other runtime falls back to a stable hash of its id — a machine
 * still keeps one colour, it just does not have a reserved one.
 */
const PROVIDER_HUES: Record<string, number> = {
  claude: 258,
  codex: 62,
  pi: 160,
};

export function runtimeHue(
  runtime: Pick<AgentRuntime, "id" | "provider">,
): number {
  const pinned = PROVIDER_HUES[runtime.provider?.trim().toLowerCase() ?? ""];
  return pinned ?? machineHue(runtime.id);
}

/**
 * The machine (host) a runtime runs on, as reported by the daemon. The
 * daemon either composes `device_info` as "<host> · <version>" or bakes the
 * host into `name` as "Claude (host)"; both are parsed here so the rail's
 * second line and the card tag can name the machine, not the runtime.
 */
export function machineIdOf(
  runtime: Pick<AgentRuntime, "name" | "device_info">,
): string {
  const fromDevice = runtime.device_info?.split(" · ")[0]?.trim();
  if (fromDevice) return fromDevice;
  return runtime.name.match(/\(([^)]+)\)\s*$/)?.[1]?.trim() ?? "";
}

/**
 * The machine's short label — a user alias when set, otherwise the daemon
 * name with its host suffix stripped ("Claude (host)" → "Claude"), because
 * the host is the tag/second line's job.
 */
export function machineShortLabel(
  runtime: Pick<AgentRuntime, "name" | "custom_name">,
): string {
  const custom = runtime.custom_name?.trim();
  if (custom) return custom;
  return runtime.name.replace(/\s*\([^)]*\)\s*$/, "").trim() || runtime.name;
}

export interface MachineSlot {
  /** runtime id, or UNBOUND_MACHINE. */
  key: string;
  runtimeId: string | null;
  rows: AgentListRow[];
}

/**
 * Group assembled rows by the machine they run on.
 *
 * Pure and exported so the machine-key bucketing can be tested without a
 * DOM. Order follows first appearance in `rows`, which is already sorted by
 * the page's active sort — the rail then re-orders for display (online first,
 * most agents first).
 */
export function groupRowsByMachine(rows: AgentListRow[]): MachineSlot[] {
  const slots = new Map<string, MachineSlot>();
  for (const row of rows) {
    const runtimeId = (row.agent.runtime_id ?? "").trim();
    const key = machineKeyOf(runtimeId);
    let slot = slots.get(key);
    if (!slot) {
      slot = { key, runtimeId: runtimeId || null, rows: [] };
      slots.set(key, slot);
    }
    slot.rows.push(row);
  }
  return [...slots.values()];
}

interface MachineTile {
  key: string;
  label: string;
  /** Mono second line — the host the runtime reports, or "" for a slot
   *  without one (the all/unbound tiles keep the line height so the tiles
   *  stay aligned). */
  machineId: string;
  lamp: "online" | "offline" | "unbound";
  rows: AgentListRow[];
  /** Drives the dashed, flat, de-tinted treatment. */
  offline: boolean;
  /** The runtime this tile stands for — null for the all/unbound/unknown
   *  slots, which colour themselves from the id hash instead. */
  runtime: AgentRuntime | null;
}

function buildTiles(
  rows: AgentListRow[],
  runtimes: AgentRuntime[],
  labels: { all: string; unbound: string; unboundHint: string; unknownMachine: string },
): MachineTile[] {
  const slots = groupRowsByMachine(rows);
  const slotByKey = new Map(slots.map((s) => [s.key, s]));
  const tiles: MachineTile[] = [
    {
      key: ALL_MACHINES,
      label: labels.all,
      machineId: "",
      lamp: "online",
      rows,
      offline: false,
      runtime: null,
    },
  ];

  const machineTiles: MachineTile[] = runtimes.map((runtime) => {
    const slot = slotByKey.get(runtime.id);
    const offline = runtime.status !== "online";
    return {
      key: runtime.id,
      label: machineShortLabel(runtime),
      machineId: machineIdOf(runtime),
      lamp: (offline ? "offline" : "online") as MachineTile["lamp"],
      rows: slot?.rows ?? [],
      offline,
      runtime,
    };
  });

  // A runtime row the list no longer carries (removed machine) still holds
  // agents — keep them reachable instead of silently dropping the bucket.
  for (const slot of slots) {
    if (slot.key === UNBOUND_MACHINE) continue;
    if (runtimes.some((r) => r.id === slot.key)) continue;
    machineTiles.push({
      key: slot.key,
      label: labels.unknownMachine,
      machineId: "",
      lamp: "offline",
      rows: slot.rows,
      offline: true,
      runtime: null,
    });
  }

  // Working machines first, then by how much they are holding; offline and
  // empty ones sink so the rail opens on what can actually take work.
  machineTiles.sort(
    (a, b) =>
      Number(a.offline) - Number(b.offline) ||
      b.rows.length - a.rows.length ||
      a.label.localeCompare(b.label),
  );

  const unbound = slotByKey.get(UNBOUND_MACHINE);
  return [
    ...tiles,
    ...machineTiles,
    ...(unbound
      ? [
          {
            key: UNBOUND_MACHINE,
            label: labels.unbound,
            machineId: labels.unboundHint,
            lamp: "unbound" as const,
            rows: unbound.rows,
            offline: true,
            runtime: null,
          },
        ]
      : []),
  ];
}

/**
 * The machine rail: one tile per runtime plus the unbound bucket, answering
 * "which machine holds what" before any agent row is read. Selecting a tile
 * scopes the list below it; the lamp, the hue band and the host line are the
 * machine's own identity, not a decoration.
 */
export function MachineRail({
  rows,
  runtimes,
  selected,
  onSelect,
}: {
  rows: AgentListRow[];
  runtimes: AgentRuntime[];
  selected: string;
  onSelect: (key: string) => void;
}) {
  const { t } = useT("agents");
  const tiles = buildTiles(rows, runtimes, {
    all: t(($) => $.rail.all),
    unbound: t(($) => $.rail.unbound),
    unboundHint: t(($) => $.rail.unbound_hint),
    unknownMachine: t(($) => $.rail.unknown_machine),
  });

  return (
    <div className="shrink-0 px-[22px] pb-3">
      <div className="flex items-stretch gap-2.5 overflow-x-auto pb-1">
        {tiles.map((tile) => {
          const active = tile.key === selected;
          // The "all" tile has no machine and stays neutral.
          const hue =
            tile.key === ALL_MACHINES
              ? null
              : tile.runtime
                ? runtimeHue(tile.runtime)
                : machineHue(tile.key === UNBOUND_MACHINE ? "" : tile.key);
          return (
            <button
              key={tile.key}
              type="button"
              onClick={() => onSelect(tile.key)}
              aria-pressed={active}
              style={hue === null ? undefined : ({ "--mh": hue } as React.CSSProperties)}
              className={cn(
                "qw-mh relative flex min-w-[196px] flex-1 flex-col rounded-[var(--radius)] border bg-surface px-3 pt-[11px] pb-3 text-left",
                "shadow-[var(--shadow-surface)] transition-colors hover:border-input",
                tile.offline && "border-dashed bg-muted/40 shadow-none",
                active &&
                  "border-brand shadow-[2px_2px_0_color-mix(in_oklab,var(--brand)_32%,transparent)]",
              )}
            >
              {hue !== null && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute inset-x-0 top-0 h-[3px]",
                    tile.offline ? "bg-input" : "qw-band-hue",
                  )}
                />
              )}
              {active && (
                <span
                  aria-hidden="true"
                  className="qw-slide-rail absolute left-0 top-2.5 bottom-2.5 w-[2px] bg-brand"
                />
              )}
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-2 shrink-0 rounded-[2px]",
                    tile.lamp === "online" && "bg-success",
                    tile.lamp === "offline" && "bg-muted-foreground/40",
                    tile.lamp === "unbound" && "bg-warning",
                  )}
                />
                {tile.runtime && (
                  <ProviderLogo
                    provider={tile.runtime.provider}
                    className="size-3.5 shrink-0"
                  />
                )}
                <span className="min-w-0 truncate text-[13px] font-semibold">
                  {tile.label}
                </span>
              </span>
              <span className="mt-0.5 block h-[15px] min-w-0 truncate font-mono text-micro tracking-normal text-muted-foreground">
                {tile.machineId}
              </span>
              <span className="mt-[9px] flex min-w-0 items-center gap-2">
                <span className="truncate text-micro tracking-normal text-muted-foreground">
                  {t(($) => $.rail.agents_count, { value: tile.rows.length })}
                </span>
                <span className="ml-auto flex items-center">
                  {tile.rows.slice(0, 3).map((row) => (
                    <span
                      key={row.agent.id}
                      // The surface ring keeps overlapping avatars readable
                      // (the same separator the mockup's avatar stack draws).
                      className="inline-flex -ml-1 rounded-[4px] ring-2 ring-surface first:ml-0"
                    >
                      <ActorAvatar
                        actorType="agent"
                        actorId={row.agent.id}
                        size="sm"
                        profileLink={false}
                      />
                    </span>
                  ))}
                  {tile.rows.length > 3 && (
                    <span className="ml-1 text-micro tabular-nums text-faint-foreground">
                      +{tile.rows.length - 3}
                    </span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
