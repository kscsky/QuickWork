import type { OnboardingStep } from "./types";

/**
 * Canonical order of the persisted onboarding steps.
 *
 * Single source of truth for "what step comes after what" — consumed
 * by the UI progress indicator to compute `index of current_step` and
 * `total step count`. Inserting, reordering, or removing a step only
 * requires changing this array; every call site that reads it updates
 * automatically.
 *
 * Intentionally excludes "welcome": welcome is a first-entry product
 * intro, not a persisted step. It doesn't show a progress indicator
 * for the same reason — users shouldn't think of reading the intro
 * as progress toward completing setup.
 *
 * The questions are intentionally NOT steps:
 *
 *   - "source" (How did you hear about QuickWork?) is pure attribution
 *     data with zero user-facing payoff, so it never taxes the critical
 *     path. It is collected post-onboarding by the workspace
 *     source-backfill prompt, and only after agents have completed
 *     work for the user — see `needs-backfill.ts`.
 *   - "role" / "use_case" had a step of their own ("about_you") that asked
 *     what the member does and what they want QuickWork for. It sat between
 *     the intro and the setup, which is the one place a new member has no
 *     basis to answer yet — they had not used the product, and the answers
 *     only ever fed Mika's kickoff copy. The step is gone; the answers are
 *     still collected by the same server-persisted field, so anyone who
 *     answered before this change keeps their context.
 *
 * Runtime is the final form step. A connected path provisions Mika and opens
 * the interactive onboarding chat as part of the runtime step's submit action;
 * that chat is the product experience itself, not another progress-screen step.
 */
export const ONBOARDING_STEP_ORDER: readonly OnboardingStep[] = [
  "workspace",
] as const;
