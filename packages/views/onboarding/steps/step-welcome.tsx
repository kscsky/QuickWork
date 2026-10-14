"use client";

import { useState } from "react";
import { ArrowRight, Download, Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@quickwork/ui/components/ui/button";
import { QuickWorkIcon } from "@quickwork/ui/components/common/quickwork-icon";
import { cn } from "@quickwork/ui/lib/utils";
import { DragStrip } from "@quickwork/views/platform";
import { WelcomeSignal } from "../components/welcome-signal";
import { useT } from "../../i18n";

/**
 * Step 0 — the one-shot product intro shown on every onboarding
 * entry (which-step-are-you-on is not persisted). Returning users
 * who are already onboarded never reach this screen; they're gated
 * out earlier by `!hasOnboarded`.
 *
 * One column, read downward: the ask on top (what this is, and the two buttons
 * that act on it), a rule, then the route underneath — the four handoffs a task
 * makes, in the order they happen, with the zone each one lands in. An earlier
 * pass set the same two things side by side, which split every reader's
 * attention between the claim and its evidence and left the rail with a tall
 * empty pane to sit in. Stacked, the rail is the page's spine and the sentence
 * above it is the caption.
 *
 * The screen is dark and the only saturated thing on it is `--inflight`. That
 * is the whole art direction: `--inflight` is the mark the board uses for work
 * an agent is holding, so the colour the user meets here is the colour they
 * meet again when they assign their first issue. Nothing on this screen
 * introduces a palette the product does not already have — the dark theme
 * supplies the canvas and the foreground, and `--inflight-foreground` keeps the
 * button legible.
 *
 * There is one action. It used to have a second, "I've done this before",
 * which did what the primary one now does whenever a workspace already
 * exists — so the primary took the behaviour over and the pair collapsed.
 *
 * `isWeb` flips two things when true: the subheading acknowledges
 * that web users have an extra runtime step (so "3 minutes" stops
 * being a lie), and a "Download Desktop" secondary CTA surfaces
 * before the user has invested in questionnaire / workspace. Desktop
 * bundles a daemon, so the same prompt would be noise there.
 */
export function StepWelcome({
  onNext,
  isWeb = false,
}: {
  onNext: () => void | Promise<void>;
  isWeb?: boolean;
}) {
  const { t } = useT("onboarding");
  // Tracks whether the primary action is mid-flight, so its spinner shows and
  // the button cannot be fired twice.
  const [pending, setPending] = useState(false);

  const handleNext = async () => {
    if (pending) return;
    setPending(true);
    try {
      await onNext();
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="dark flex h-full min-h-[640px] flex-col bg-background text-foreground">
      <DragStrip />

      <div className="flex-1 overflow-y-auto">
        {/* 840px is the measure the headline sets: at lg the display size is
            60px, and the second line is thirteen characters of CJK, so a
            narrower column breaks it after 接 and leaves 手。 orphaned. */}
        <div className="animate-onboarding-enter mx-auto flex w-full max-w-[840px] flex-col gap-10 px-6 pb-20 pt-16 sm:px-10">
          {/* The ask. */}
          <div className="flex flex-col gap-7">
            <div className="flex items-center gap-2.5">
              <QuickWorkIcon className="size-5 text-inflight" noSpin />
              <span className="font-mono text-micro uppercase tracking-[0.24em] text-inflight">
                {t(($) => $.welcome.wordmark)}
              </span>
            </div>

            {/* The accent is a whole line rather than a phrase inside one, so
                the sentence still reads as one claim and the colour lands on
                the half the product is actually about. */}
            <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-5xl lg:text-6xl">
              {t(($) => $.welcome.headline_line1)}
              <br />
              <span className="text-inflight">
                {t(($) => $.welcome.headline_line2)}
              </span>
            </h1>

            <div className="flex max-w-[620px] flex-col gap-4">
              <p className="text-title leading-relaxed text-foreground">
                {t(($) => $.welcome.lede)}
              </p>
              <p className="text-body leading-relaxed text-muted-foreground">
                {isWeb
                  ? t(($) => $.welcome.lede_web)
                  : t(($) => $.welcome.lede_desktop)}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {isWeb ? (
                <>
                  {/* `<a>` rather than `<Button onClick={window.open}>`
                      so middle-click / cmd-click / "Copy link" all
                      behave and screen readers announce it as a link
                      (it navigates; `Continue on web` is the button
                      that mutates flow state). New tab preserves this
                      onboarding tab in case the desktop install
                      stalls and the user falls back here. */}
                  <a
                    href="/download"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      buttonVariants({ size: "lg" }),
                      "bg-inflight text-inflight-foreground hover:bg-inflight/90",
                    )}
                  >
                    <Download className="h-4 w-4" />
                    {t(($) => $.welcome.download_desktop)}
                  </a>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={handleNext}
                    disabled={pending}
                  >
                    {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                    {t(($) => $.welcome.continue_on_web)}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <Button
                  size="lg"
                  onClick={handleNext}
                  disabled={pending}
                  className="bg-inflight text-inflight-foreground hover:bg-inflight/90"
                >
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t(($) => $.welcome.start_exploring)}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* The proof. The rule is the seam between the two halves; without it
              the rail reads as another paragraph. */}
          <div className="max-w-[560px] border-t border-border pt-10">
            <WelcomeSignal />
          </div>
        </div>
      </div>
    </div>
  );
}
