"use client";

import { cn } from "@quickwork/ui/lib/utils";
import { useT } from "../../i18n";

/**
 * The welcome step's illustration: the task's handoffs as a descending rail,
 * with the work travelling down it.
 *
 * Two earlier attempts are worth not repeating. Five lanes with cards moving
 * right is the generic tracker picture — this product shares that shape with
 * every other one, so relabelling the lanes renamed the drawing without
 * changing it. A dispatch slip was honest about the round trip and entirely
 * grey, which read as a plainer version of the screen it replaced.
 *
 * This one runs the handoffs down the page in the order they happen, which is
 * the order a reader scans and the order the clock does. The zone column beside
 * them is what makes the crossing legible — origin, origin, target, origin —
 * so the two things this product does that the others do not, leaving the zone
 * and coming back with a receipt, are both visible without reading a word.
 *
 * The spark descending the rail is the only motion, and it lives in
 * `packages/ui/styles/base.css` as a keyframe next to the sign-in scene's,
 * which is where the reduced-motion opt-out for it also lives. The rail's
 * gradient is static: one animated element, one thing to keep in step.
 *
 * The colour is not decoration bolted onto onboarding. `--inflight` is the mark
 * the board uses for work an agent is holding, so the amber here is the same
 * amber a user meets again the moment they assign their first issue; the dark
 * theme supplies the canvas and `--inflight-foreground` the button text.
 * Nothing on this screen is a new palette.
 */

/** Where each handoff happened, in the order it happened. The times are what
 *  the rail records rather than copy — the point is that the crossing took two
 *  minutes. */
const STEPS = [
  { id: "received", time: "00:00", zone: "origin" },
  { id: "dispatched", time: "00:02", zone: "origin" },
  { id: "running", time: "00:07", zone: "target" },
  { id: "receipt", time: "00:09", zone: "origin" },
] as const;

/** Where the spark rests when motion is off: the handoff an agent holds. */
const RESTING_TOP = "66%";

export function WelcomeSignal() {
  const { t } = useT("onboarding");

  const labels = {
    received: t(($) => $.welcome.waybill.checkpoint_received),
    dispatched: t(($) => $.welcome.waybill.checkpoint_dispatched),
    running: t(($) => $.welcome.waybill.checkpoint_running),
    receipt: t(($) => $.welcome.waybill.stamp),
  };
  const zones = {
    origin: t(($) => $.welcome.waybill.zone_origin),
    target: t(($) => $.welcome.waybill.zone_target),
  };

  return (
    <div className="flex w-full flex-col gap-8" aria-hidden="true">
      <ol className="relative flex flex-col gap-8">
        {/* The rail, and the amber it has already carried. Both are pinned to
            the nodes' centre line, which is half of the 14px node column. The
            base has to clear the threshold where a hairline on a near-black
            canvas stops being a line and becomes a rumour. */}
        <span className="absolute bottom-2 left-[7px] top-2 w-px bg-muted-foreground/30" />
        <span className="absolute bottom-2 left-[7px] top-2 w-px bg-gradient-to-b from-inflight via-inflight/55 to-inflight/10" />
        <span
          className="onboarding-signal-spark absolute left-[7px] size-3 -translate-x-1/2 rounded-full bg-inflight shadow-[0_0_26px_9px] shadow-inflight/50"
          style={{ top: RESTING_TOP }}
        />

        {STEPS.map(({ id, time, zone }) => (
          <li key={id} className="flex flex-col gap-2">
            <div className="flex items-baseline gap-3.5">
              {/* Opaque, so the rail reads as passing behind each stop rather
                  than through it. */}
              <span className="relative flex size-3.5 shrink-0 items-center justify-center rounded-full bg-background">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    id === "receipt"
                      ? "bg-success"
                      : id === "running"
                        ? "bg-inflight"
                        : "bg-muted-foreground/50",
                  )}
                />
              </span>
              <span className="flex-1 text-body">{labels[id]}</span>
              <span className="font-mono text-micro text-muted-foreground">
                {zones[zone]} · {time}
              </span>
            </div>

            {/* The handoff where an agent is holding the task is the one that
                needs saying who has it, and where they are working. */}
            {id === "running" && (
              <span className="flex items-center gap-1.5 pl-[26px]">
                <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-inflight/15 text-micro font-medium text-inflight">
                  {t(($) => $.welcome.waybill.agent).slice(0, 1)}
                </span>
                <span className="text-caption text-muted-foreground">
                  {t(($) => $.welcome.waybill.agent)}
                </span>
                <span className="text-caption text-muted-foreground/60">·</span>
                <span className="text-caption text-muted-foreground">
                  {t(($) => $.welcome.waybill.sandbox)}
                </span>
              </span>
            )}
          </li>
        ))}
      </ol>

      <p className="text-body leading-relaxed text-muted-foreground">
        {t(($) => $.welcome.illustration_caption)}
      </p>
    </div>
  );
}
