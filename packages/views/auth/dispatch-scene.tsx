"use client";

import { useEffect, useMemo, useReducer, type CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { UI_EASE_OUT, UI_MOTION_DURATION } from "@quickwork/ui/lib/motion";
import { cn } from "@quickwork/ui/lib/utils";
import { useT } from "../i18n";

/**
 * The identity panel's backdrop: the dispatch board the product actually runs.
 *
 * Five lanes — demand, review, execute, test, accept — with task cards that
 * only ever move one lane to the right. A card keeps its place inside its lane
 * (the lane's queue drains upward as its head advances), so the panel reads as
 * a board with work spread across it instead of as one card crossing the whole
 * screen.
 *
 * Three things about it are load-bearing:
 *
 * 1. The clock is a reducer ticked by one interval. Every number the panel
 *    shows — the two lane counts and the two totals — is derived from the same
 *    card list, so a count can only change when a card really did. A CSS
 *    odometer cannot do that: it cannot make a total grow, cannot carry between
 *    digits, and cannot count a lane down. Re-rendering five cards every 1.4s
 *    is the cheaper half of the trade.
 * 2. Card motion is `motion` with a spring on x/y, because position is derived
 *    (`lane * stair + row * pitch`) rather than animated by hand — a card that
 *    changes lane and a card whose queue shifted are then the same code path.
 * 3. Everything purely decorative — the progress fill, the agent ring, the
 *    accept check, the board sweep — is a CSS keyframe in
 *    `packages/ui/styles/base.css` (`login-scene-*`), which is also where the
 *    reduced-motion opt-out for each of them lives.
 *
 * The whole scene is decorative: the root is `aria-hidden`, and a reader who
 * prefers reduced motion gets the seeded frame with no interval at all.
 */

// ---------------------------------------------------------------------------
// Board geometry
// ---------------------------------------------------------------------------

/** Lanes, left to right. A lane index is also a card's stage. */
const STAGE_COUNT = 5;
/** The execute lane: the only one that shows an agent and a progress bar. */
const EXECUTE_STAGE = 2;
const ACCEPT_STAGE = STAGE_COUNT - 1;

/** Distance between two cards sharing a lane. Sized for a card plus the
 *  execute strip that hangs below it, so a stack never lands on itself. */
const ROW_PITCH = 48;
/** How much lower each lane's queue starts than the lane before it. This
 *  staircase is what makes the direction of travel readable before anything
 *  moves. */
const COLUMN_STAIR = 24;
/** Room reserved for the deepest queue the board can produce: the deepest lane
 *  plus one card behind the head, or the execute lane with its strip. */
const BOARD_HEIGHT = 170;

/** One tick of the conveyor. */
const TICK_MS = 1400;

/** Ticks a card spends in each lane, picked by card id. Four rows that all
 *  total six: every card crosses in the same time, but no two neighbours in the
 *  sequence advance on the same tick, so the board never steps in unison and
 *  the lane counts keep moving. */
const DWELL = [
  [2, 1, 1, 1, 1],
  [1, 1, 2, 1, 1],
  [1, 2, 1, 1, 1],
  [1, 1, 1, 2, 1],
] as const;

/** The board opens mid-flight rather than empty: five cards, one per lane, the
 *  oldest furthest along. Ids and the completed total are drawn from the same
 *  day's sequence so the two numbers agree with each other. */
const FIRST_ID = 9;
const SEED_CARDS = 5;
const SEED_COMPLETED = 8;

/** Agent names are product nouns, not copy — untranslated, like the workspace
 *  names elsewhere in the product. */
const AGENTS = ["Fleet", "Sentry", "Archivist"] as const;

const EASE_OUT: [number, number, number, number] = [...UI_EASE_OUT];

/** The status ramp, in three stops: grey while the card is queued, amber once
 *  an agent has it, green once it is accepted. Expressed as a function rather
 *  than a table so the ramp is one thing to read and cannot fall out of step
 *  with `STAGE_COUNT`. Semantic tokens only. */
function laneDot(lane: number): string {
  if (lane === ACCEPT_STAGE) return "bg-success";
  if (lane >= EXECUTE_STAGE) return "bg-inflight";
  return lane === 0 ? "bg-muted-foreground/40" : "bg-muted-foreground/70";
}

function cardTone(lane: number): string {
  if (lane === ACCEPT_STAGE)
    return "border-success/45 bg-success/10 text-foreground";
  if (lane >= EXECUTE_STAGE) {
    return "border-inflight/45 bg-inflight-surface text-foreground";
  }
  return lane === 0
    ? "border-surface-border bg-surface-raised text-muted-foreground"
    : "border-surface-border bg-surface-raised text-foreground";
}

// ---------------------------------------------------------------------------
// Board state
// ---------------------------------------------------------------------------

interface SceneCard {
  id: number;
  stage: number;
  /** Ticks left in this stage; `1` means it advances on the next tick. */
  dwell: number;
  /** How long this card's execute progress bar runs. Fixed on entry, because
   *  the bar has to finish exactly when the card leaves the lane. */
  runMs: number;
}

interface BoardState {
  cards: SceneCard[];
  /** Accepted tasks since the page opened. Monotonic — the one number the
   *  panel shows that must never go down. */
  completed: number;
  /** Id handed to the next card that enters the first lane. */
  nextId: number;
}

/** The table is square — one row per phase, one column per lane — so the
 *  lookup is total; the fallbacks only satisfy the index signature, which
 *  cannot see that `id % DWELL.length` is bounded by the table's own size. */
function taskCard(id: number, stage: number): SceneCard {
  const dwell = DWELL[id % DWELL.length]?.[stage] ?? 1;
  return { id, stage, dwell, runMs: dwell * TICK_MS };
}

/** Which agent picks the card up. Ids rotate the roster, so consecutive cards
 *  are run by different agents and the execute lane keeps changing hands. */
function agentFor(id: number): string {
  return AGENTS[id % AGENTS.length] ?? AGENTS[0];
}

function createBoard(): BoardState {
  return {
    cards: Array.from({ length: SEED_CARDS }, (_, index) =>
      taskCard(FIRST_ID + index, SEED_CARDS - 1 - index),
    ),
    completed: SEED_COMPLETED,
    nextId: FIRST_ID + SEED_CARDS,
  };
}

/**
 * One tick: every card either spends it in its lane or moves one lane right. A
 * card with nowhere left to go leaves the board, and its successor enters the
 * first lane on the same tick — that swap is what keeps work flowing forever
 * without the board thinning out.
 *
 * Pure, and the only place either number moves: `completed` and `nextId` live
 * in the same state as `cards`, so a double-invoked reducer cannot count a task
 * twice.
 */
function advance(state: BoardState): BoardState {
  const cards: SceneCard[] = [];
  let { completed, nextId } = state;

  for (const card of state.cards) {
    if (card.dwell > 1) {
      cards.push({ ...card, dwell: card.dwell - 1 });
      continue;
    }

    const stage = card.stage + 1;
    if (stage < STAGE_COUNT) {
      cards.push(taskCard(card.id, stage));
      continue;
    }

    completed += 1;
    cards.push(taskCard(nextId, 0));
    nextId += 1;
  }

  return { cards, completed, nextId };
}

/** Ids per lane, oldest first — that is queue order: the head sits at the top
 *  of the lane and everything behind it shifts up when the head advances. */
function lanesOf(cards: readonly SceneCard[]): number[][] {
  return Array.from({ length: STAGE_COUNT }, (_, lane) =>
    cards
      .filter((card) => card.stage === lane)
      .map((card) => card.id)
      .sort((a, b) => a - b),
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** A number that is never allowed to swap in place: the outgoing value slides
 *  out as the incoming one slides in, so a count reads as a change rather than
 *  as a repaint. */
function LiveNumber({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  return (
    <span className="relative inline-flex overflow-hidden">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={value}
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -10, opacity: 0 }}
          transition={{ duration: UI_MOTION_DURATION.fast, ease: EASE_OUT }}
          className={cn("font-mono tabular-nums", className)}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** The `+1` that leaves the total on every acceptance — the panel's proof that
 *  the number is counting rather than merely displaying. Keyed on the new total
 *  so it replays without any follow-up state of its own. */
function AcceptedDelta() {
  return (
    <motion.span
      initial={{ opacity: 0, y: 2 }}
      animate={{ opacity: [0, 1, 1, 0], y: -12 }}
      transition={{ duration: 1, times: [0, 0.15, 0.6, 1], ease: EASE_OUT }}
      className="pointer-events-none absolute left-full ml-1 text-micro font-medium text-success"
    >
      +1
    </motion.span>
  );
}

/** A lane's state as a glyph: an empty ring while queued, a live dot once an
 *  agent is on it, a check once accepted. */
function StageMark({ stage }: { stage: number }) {
  if (stage === ACCEPT_STAGE) {
    return (
      <svg
        className="login-scene-check size-2.5 shrink-0 text-success"
        viewBox="0 0 10 10"
        fill="none"
      >
        <path
          d="M2 5.3 4.1 7.4 8 3.2"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (stage >= EXECUTE_STAGE) {
    return (
      <span className="login-scene-pulse size-1.5 shrink-0 rounded-full bg-inflight" />
    );
  }

  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full border",
        stage === 0
          ? "border-muted-foreground/40"
          : "border-muted-foreground/70",
      )}
    />
  );
}

/**
 * One card. Position is derived, never stored: the lane is the stage and the
 * row is the card's place in that lane's queue — which is what keeps a card
 * inside its lane and drains the queue upward instead of tracking the card
 * across the board.
 *
 * The execute strip hangs below the card box, inside the pitch, rather than
 * inside it: the box keeps one height for its whole life, so entering the
 * execute lane adds an agent and a filling bar without resizing anything, and
 * two cards in one lane never overlap.
 */
function TaskCard({
  card,
  row,
  agent,
  still,
}: {
  card: SceneCard;
  row: number;
  agent: string;
  still: boolean;
}) {
  const lane = card.stage;
  const x = `${lane * 100}%`;
  const y = lane * COLUMN_STAIR + row * ROW_PITCH;

  return (
    <motion.div
      className="absolute left-0 top-0 w-1/5"
      initial={still ? false : { opacity: 0, scale: 0.96, x, y: y - 10 }}
      animate={{ opacity: 1, scale: 1, x, y }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={{
        x: { type: "spring", stiffness: 320, damping: 32 },
        y: { type: "spring", stiffness: 320, damping: 32 },
        opacity: { duration: UI_MOTION_DURATION.standard, ease: EASE_OUT },
        scale: { duration: UI_MOTION_DURATION.standard, ease: EASE_OUT },
      }}
    >
      <div className="mx-[5px]">
        <div
          className={cn(
            "login-scene-card flex h-[22px] items-center justify-between gap-1 rounded-md border px-2",
            cardTone(lane),
          )}
        >
          <span className="font-mono text-micro">{`Q-${card.id}`}</span>
          <StageMark stage={lane} />
        </div>

        <AnimatePresence>
          {lane === EXECUTE_STAGE && (
            <motion.div
              initial={{ opacity: 0, y: -2 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: UI_MOTION_DURATION.fast, ease: EASE_OUT }}
              className="mt-1 flex flex-col gap-[3px]"
            >
              <span className="flex items-center gap-1">
                <span className="login-scene-agent relative flex size-3.5 shrink-0 items-center justify-center rounded-full bg-inflight/15 text-micro font-medium text-inflight">
                  {agent.slice(0, 1)}
                </span>
                <span className="truncate text-micro text-muted-foreground">
                  {agent}
                </span>
              </span>
              {/* Fills over exactly the ticks this card spends in the lane. */}
              <span className="block h-[3px] overflow-hidden rounded-full bg-inflight/15">
                <span
                  className="login-scene-run block h-full w-full rounded-full bg-inflight"
                  style={
                    {
                      "--login-scene-run-ms": `${card.runMs}ms`,
                    } as CSSProperties
                  }
                />
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export function DispatchScene() {
  const { t } = useT("auth");
  const shouldReduceMotion = useReducedMotion() ?? false;
  const [board, tick] = useReducer(advance, undefined, createBoard);

  useEffect(() => {
    if (shouldReduceMotion) return;
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [shouldReduceMotion]);

  const lanes = useMemo(() => lanesOf(board.cards), [board.cards]);
  const rows = useMemo(() => {
    const map = new Map<number, number>();
    lanes.forEach((ids) => ids.forEach((id, index) => map.set(id, index)));
    return map;
  }, [lanes]);

  const laneLabels = [
    t(($) => $.signin.dispatch.stage.demand),
    t(($) => $.signin.dispatch.stage.review),
    t(($) => $.signin.dispatch.stage.execute),
    t(($) => $.signin.dispatch.stage.test),
    t(($) => $.signin.dispatch.stage.accept),
  ];

  const inFlight = board.cards.filter(
    (card) => card.stage < ACCEPT_STAGE,
  ).length;

  return (
    <div className="flex flex-col gap-4 pr-14" aria-hidden="true">
      {/* The two totals. They are what makes the panel read as live: one only
          ever climbs, the other tracks what is on the board right now. */}
      <div className="flex items-baseline justify-between text-caption text-muted-foreground">
        <span className="flex items-baseline gap-1.5">
          <span>{t(($) => $.signin.dispatch.completed_today)}</span>
          <span className="relative inline-flex">
            <LiveNumber
              value={board.completed}
              className="text-label font-medium text-success"
            />
            {board.completed > SEED_COMPLETED && (
              <AcceptedDelta key={board.completed} />
            )}
          </span>
        </span>
        <span className="flex items-baseline gap-1.5">
          <span>{t(($) => $.signin.dispatch.in_flight)}</span>
          <LiveNumber
            value={inFlight}
            className="text-label font-medium text-foreground"
          />
        </span>
      </div>

      {/* Lane headers, each with the count of what is standing in that lane. */}
      <div className="grid grid-cols-5">
        {laneLabels.map((label, lane) => (
          <div key={label} className="flex items-center gap-1.5 pl-[5px]">
            <span
              className={cn("size-1.5 shrink-0 rounded-full", laneDot(lane))}
            />
            <span className="min-w-0 truncate text-caption text-muted-foreground">
              {label}
            </span>
            <LiveNumber
              value={lanes[lane]?.length ?? 0}
              className="ml-auto pr-[5px] text-caption font-medium text-foreground"
            />
          </div>
        ))}
      </div>

      <div className="relative" style={{ height: BOARD_HEIGHT }}>
        {/* Lanes. Execute carries a warm tint because it is the one lane where
            an agent is doing something. */}
        <div className="absolute inset-0 grid grid-cols-5">
          {laneLabels.map((label, lane) => (
            <span
              key={label}
              className={cn(
                "mx-[3px] rounded-md",
                lane === EXECUTE_STAGE
                  ? "bg-inflight-surface/70"
                  : "bg-foreground/[0.012]",
              )}
            />
          ))}
        </div>

        {/* Ambient sweep, so the board is not a still image between ticks. */}
        <span className="login-scene-sweep pointer-events-none absolute inset-0" />

        <div className="absolute inset-0">
          <AnimatePresence>
            {board.cards.map((card) => (
              <TaskCard
                key={card.id}
                card={card}
                row={rows.get(card.id) ?? 0}
                agent={agentFor(card.id)}
                still={shouldReduceMotion}
              />
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
