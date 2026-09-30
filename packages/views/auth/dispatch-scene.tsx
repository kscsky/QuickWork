"use client";

import type { CSSProperties } from "react";
import { useT } from "../i18n";

/**
 * The identity panel's backdrop: a dispatch board, live.
 *
 * It draws the product's own loop rather than a stock illustration — a task
 * card leaves the source zone, crosses to an agent in the target zone, is run,
 * and comes back as a receipt. Names, codes and statuses are the product's
 * vocabulary, so the panel answers "who is doing what" instead of showing
 * anonymous blocks.
 *
 * All motion lives in `base.css` as a single 10s keyframe timeline (one source
 * of truth, no React re-renders, deterministic timing); this file only lays
 * the board out and hands each lane its phase. See the `dispatch-*` block
 * there for the frame-by-frame breakdown, and the reduced-motion clause at the
 * bottom of that file for the static frame this falls back to.
 */

interface DispatchLane {
  /** Task code, mono, as it reads in the product. */
  code: string;
  /** Agent that receives the task in the target zone. */
  agent: string;
  /**
   * Start offset in seconds, negative on purpose: a positive delay would leave
   * the lane blank until it elapsed, while a negative one enters the shared
   * timeline already in progress, so every lane is mid-flight on first paint.
   */
  phase: number;
}

/**
 * Three lanes, staggered by 3.5s and 7s. One lane alone would leave the board
 * empty for most of every cycle; three out of phase mean a card is being
 * dispatched, run or receipted at any instant. Literal rather than generated:
 * the backdrop has to be byte-stable across renders.
 */
const LANES: readonly DispatchLane[] = [
  { code: "QW-142", agent: "Fleet", phase: 0 },
  { code: "QW-147", agent: "Sentry", phase: -3.5 },
  { code: "QW-153", agent: "Archivist", phase: -7 },
];

/**
 * Board geometry, as a custom property on each lane root. The percentage
 * resolves against whichever runner uses it — both the card's and the
 * receipt's runner span the lane — and subtracting the card's own width lands
 * a travelling element on the opposite end of the rail rather than a full
 * lane-width past it.
 */
function laneVars(phase: number): CSSProperties {
  return {
    "--dispatch-phase": `${phase}s`,
    "--dispatch-run": "calc(100% - 7rem)",
  } as CSSProperties;
}

function Lane({ code, agent, phase }: DispatchLane) {
  const { t } = useT("auth");

  return (
    <div className="flex items-center gap-3" style={laneVars(phase)}>
      <div className="relative h-14 flex-1">
        {/* The rail itself: where the work travels, and the only part of the
            lane that never moves. Muted-foreground rather than the surface
            border, which sits at almost the same lightness as the panel behind
            it — a rail nobody can see is not a rail. */}
        <span className="absolute inset-x-0 top-[18px] h-px bg-muted-foreground/25" />

        {/* The task: rises inside the source zone, crosses, then dissolves
            before the timeline wraps. */}
        <span className="dispatch-flow dispatch-card-run absolute inset-x-0 top-1 h-7">
          <span className="dispatch-flow dispatch-card absolute left-0 flex h-7 w-28 items-center justify-between gap-1 rounded-md border px-1.5">
            <span className="font-mono text-micro text-muted-foreground">
              {code}
            </span>
            {/* Three labels in one grid cell, cross-faded by the timeline:
                a keyframe cannot swap text content, so the status change is
                three stacked labels handing over. */}
            <span className="grid">
              <span className="dispatch-flow dispatch-status dispatch-status-todo col-start-1 row-start-1 text-micro text-muted-foreground">
                {t(($) => $.signin.dispatch.status_todo)}
              </span>
              <span className="dispatch-flow dispatch-status dispatch-status-running col-start-1 row-start-1 text-micro text-inflight">
                {t(($) => $.signin.dispatch.status_running)}
              </span>
              <span className="dispatch-flow dispatch-status dispatch-status-done col-start-1 row-start-1 text-micro text-success">
                {t(($) => $.signin.dispatch.status_done)}
              </span>
            </span>
            {/* Drawn from the card's trailing edge, so the trail grows out of
                the card instead of out of the lane. */}
            <span className="dispatch-flow dispatch-trail absolute right-full mr-1.5 h-px w-16 bg-inflight/25" />
          </span>
        </span>

        {/* The receipt: the shortest leg of the loop, and the one that makes
            the board read as two-way rather than as work disappearing right. */}
        <span className="dispatch-flow dispatch-receipt absolute inset-x-0 bottom-1 h-4">
          <span className="absolute left-0 flex w-28 items-center gap-1">
            <svg
              className="size-2 shrink-0 text-brand"
              viewBox="0 0 8 8"
              fill="none"
            >
              <path
                d="M7 4H1M1 4l2.2-2.2M1 4l2.2 2.2"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="h-px flex-1 bg-brand/35" />
            <span className="dispatch-flow dispatch-receipt-label rounded-sm bg-brand/12 px-1 text-micro text-brand">
              {t(($) => $.signin.dispatch.receipt)}
            </span>
          </span>
        </span>
      </div>

      {/* The receiving agent. It is the lane's only standing element, which is
          what keeps the board from emptying out as cards come and go. */}
      <div className="flex w-16 shrink-0 flex-col items-center gap-1.5">
        <span className="dispatch-flow dispatch-agent relative flex size-7 items-center justify-center rounded-full bg-zone-4/12 text-micro font-medium text-zone-4">
          {agent.slice(0, 1)}
        </span>
        <span className="text-micro text-muted-foreground">{agent}</span>
        <span className="h-1 w-12 overflow-hidden rounded-full bg-muted-foreground/15">
          <span className="dispatch-flow dispatch-progress-fill block h-full w-full rounded-full bg-inflight" />
        </span>
      </div>
    </div>
  );
}

export function DispatchScene() {
  const { t } = useT("auth");

  return (
    <div className="flex flex-col gap-5 pr-14" aria-hidden="true">
      {/* Both zones, so the direction of travel is readable before anything
          moves: this side hands work off, that side executes it. */}
      <div className="flex items-center justify-between text-caption text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-zone-1" />
          {t(($) => $.signin.dispatch.source_zone)}
        </span>
        <span className="flex items-center gap-1.5">
          {t(($) => $.signin.dispatch.target_zone)}
          <span className="size-1.5 rounded-full bg-zone-4" />
        </span>
      </div>

      <div className="flex flex-col gap-4">
        {LANES.map((lane) => (
          <Lane key={lane.code} {...lane} />
        ))}
      </div>
    </div>
  );
}
