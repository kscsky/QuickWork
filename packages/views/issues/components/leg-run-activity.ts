/**
 * How long has this leg's run been silent?
 *
 * The daemon force-stops a silent run after two hours, which is far too late
 * for someone watching a relay. The UI's job is earlier and deliberately
 * weaker: report the silence and flag it, without pretending to know the run is
 * dead — long model turns and long tools are legitimate. The last event (not
 * the task start) is the anchor, so a run that streamed a minute ago never
 * looks stalled just because it started two hours ago.
 */
export const LEG_STALL_AFTER_MS = 10 * 60_000;

export interface LegRunActivity {
  lastActivityAt: number | null;
  silentMs: number;
  stalled: boolean;
}

export function legRunActivity({
  live,
  lastEventAt,
  startedAt,
  now,
}: {
  live: boolean;
  lastEventAt?: string | null;
  startedAt?: string | null;
  now: number;
}): LegRunActivity {
  const anchor = lastEventAt ?? startedAt ?? null;
  const at = anchor ? Date.parse(anchor) : Number.NaN;
  const lastActivityAt = Number.isFinite(at) ? at : null;
  const silentMs =
    live && lastActivityAt !== null ? Math.max(0, now - lastActivityAt) : 0;
  return {
    lastActivityAt,
    silentMs,
    stalled: live && silentMs >= LEG_STALL_AFTER_MS,
  };
}

/** Whole minutes since the last event, floored at 1 for any positive silence. */
export function silentMinutes(ms: number): number {
  return Math.max(1, Math.floor(ms / 60_000));
}
