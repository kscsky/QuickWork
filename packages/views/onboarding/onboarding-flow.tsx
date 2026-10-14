"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useAuthStore } from "@quickwork/core/auth";
import {
  completeOnboarding,
  useWelcomeStore,
  type OnboardingStep,
} from "@quickwork/core/onboarding";
import { useWorkspaceList } from "@quickwork/core/workspace";
import type { Workspace } from "@quickwork/core/types";
import { StepWelcome } from "./steps/step-welcome";
import { StepWorkspace } from "./steps/step-workspace";
import { OnboardingLogoutButton } from "./components/onboarding-logout-button";
import { useT } from "../i18n";

/**
 * Shell's onComplete contract carries the workspace plus an optional
 * destination. Runtime-connected onboarding opens the real Mika conversation
 * started by the final step; other exits land on the workspace issue list.
 *
 * Three exit shapes feed onComplete:
 *   - Skip-existing (Welcome): completeOnboarding marks onboarded; navigate
 *     to the existing workspace's issue list.
 *   - Runtime-skipped (no runtime on Step 3): completeOnboarding marks
 *     onboarded; we push a {choice:"skip"} welcome signal and navigate
 *     to the workspace. The welcome hook in the workspace shell creates
 *     one install-runtime guide issue on landing.
 *   - Runtime-connected: create or repair the workspace's Mika on the selected
 *     runtime, start one hidden onboarding kickoff, mark onboarding complete,
 *     and open Mika's real chat. No fixed specialist team is created.
 *
 * This file never touches createAgent / createIssue. The runtime-skipped
 * guide flow remains in `packages/views/workspace/welcome-after-onboarding.tsx`.
 */
interface OnboardingFlowProps {
  onComplete: (
    workspace?: Workspace,
    destination?: OnboardingDestination,
  ) => void;
  /** "new_workspace" is the same flow run by someone who already uses
   *  QuickWork: it starts at the workspace step, because the intro and the
   *  questionnaire only make sense once per person, and it always creates a
   *  workspace rather than offering to continue with an existing one. */
  mode?: OnboardingMode;
  /** Required in "new_workspace" mode: first-run onboarding has no way out
   *  except signing out, but someone creating a second workspace must be able
   *  to change their mind and return to where they were. */
  onCancel?: () => void;
  /** Web only: the CLI install card. Its presence is also how the flow knows
   *  it is running on web rather than desktop, which the intro's copy and
   *  secondary CTA depend on. */
  runtimeInstructions?: React.ReactNode;
}

export function OnboardingFlow(props: OnboardingFlowProps) {
  return <OnboardingStepFlow {...props} />;
}

function OnboardingStepFlow({
  onComplete,
  mode = "first_run",
  onCancel,
  runtimeInstructions,
}: OnboardingFlowProps) {
  const { t } = useT("onboarding");
  const user = useAuthStore((s) => s.user);
  if (!user) {
    throw new Error("OnboardingFlow requires an authenticated user");
  }

  const isNewWorkspace = mode === "new_workspace";
  const [step, setStep] = useState<OnboardingStep>(
    isNewWorkspace ? "workspace" : "welcome",
  );
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  // Raised by the workspace step while its create request is in flight; locks
  // its Back affordance.
  const [stepBusy, setStepBusy] = useState(false);

  // Fetched at Step 0 + Step 2. Step 2 uses it to detect a pre-existing
  // workspace from an earlier abandoned onboarding (so StepWorkspace shows
  // "Continue with {name}" instead of CreateWorkspaceForm — avoiding the
  // slug conflict that creation would hit). Step 0 uses it to decide
  // whether to render the "I've done this before" skip button — only
  // shown when the user already has at least one workspace, otherwise
  // skipping would land them in limbo.
  const { workspaces, ready: workspacesReady } = useWorkspaceList({
    enabled: step === "welcome" || step === "workspace",
  });
  const existingWorkspace = isNewWorkspace
    ? workspace
    : (workspace ?? workspaces[0] ?? null);
  const canSkipWelcome = workspacesReady && workspaces.length > 0;

  // The `runtimeInstructions` slot is only plumbed by the web shell
  // (desktop bundles a daemon, so a CLI install card would be noise
  // there). We reuse its presence as the web signal rather than
  // introducing a redundant prop.
  const isWeb = !!runtimeInstructions;

  // Derive "what comes after `from`" from ONBOARDING_STEP_ORDER so
  // inserting/reordering a persisted step only requires editing the
  // canonical array. Returns null if `from` is the last persisted step
  // or not in the array (callers fall back to bespoke routing).

  /**
   * Welcome's primary action, and its only one.
   *
   * A member who already has a workspace lands in it: the intro is the last
   * thing standing between them and their board, and everything the flow used
   * to ask on the way — what they do, what they want QuickWork for — is a
   * question a member can only answer after using the product once.
   *
   * A member without one still has to name it, because every screen in the
   * product is scoped to a workspace and there is nowhere else to land. The
   * workspace step recognises an existing one too, so a click that beats the
   * workspace list's fetch still ends up in the same place.
   */
  const handleWelcomeNext = useCallback(async () => {
    // Welcome is not a persisted step — it is the intro — so naming the space
    // is hard-coded as the entry point for anyone who does not already have
    // one.
    if (!canSkipWelcome) {
      setStep("workspace");
      return;
    }
    // Marks onboarding complete server-side (idempotent via COALESCE on
    // onboarded_at) and navigates without creating new workspace content.
    try {
      await completeOnboarding("skip_existing", workspaces[0]?.id);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t(($) => $.errors.skip_failed),
      );
      return;
    }
    onComplete(workspaces[0] ?? undefined);
  }, [canSkipWelcome, workspaces, onComplete, t]);

  /**
   * The flow's only exit now that it is one decision long.
   *
   * Naming the space used to hand off to a step that connected a machine to
   * run agents on. That step is gone — it asked a member to choose between
   * three ways of connecting a computer before they had seen the product work
   * once — so the workspace step finishes instead, through the same
   * "runtime skipped" path that step's own Skip button used: onboarding is
   * marked complete, the welcome signal is set, and the workspace's landing
   * hook opens one guide issue naming the runtimes it can connect.
   *
   * Deliberately NOT setCurrentWorkspace: that singleton is also written by the
   * desktop tab system, which reclaims it whenever the new workspace has no tab
   * group yet. Every call from here on names its target workspace, and the
   * switch happens once, on the navigation in onComplete.
   */
  const handleWorkspaceCreated = useCallback(
    async (ws: Workspace) => {
      setWorkspace(ws);
      try {
        await completeOnboarding("runtime_skipped", ws.id);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t(($) => $.errors.skip_failed),
        );
        return;
      }
      useWelcomeStore.getState().set({
        workspaceId: ws.id,
        choice: "skip",
      });
      onComplete(ws, undefined);
    },
    [onComplete, t],
  );


  const handleBack = useCallback(() => {
    // The workspace step is the only persisted step and the only caller, so
    // Back means one of two things. In new-workspace mode the member came from
    // a workspace they already have, and Back leaves the flow rather than
    // walking into the intro they deliberately skipped. In first-run it
    // returns to the intro.
    if (isNewWorkspace) {
      onCancel?.();
      return;
    }
    setStep("welcome");
  }, [isNewWorkspace, onCancel]);

  if (step === "welcome") {
    // Welcome has no rail, so the escape hatch stays pinned there — and it
    // needs its own `.dark` scope, because `OnboardingLogoutButton` styles
    // itself with the ordinary muted/foreground tokens on the assumption that
    // whatever renders it has already gone dark. StepWelcome owns a dark scope
    // of its own, but this button is its sibling, not a child.
    return (
      <>
        <div className="dark">
          <OnboardingLogoutButton />
        </div>
        <StepWelcome onNext={handleWelcomeNext} isWeb={isWeb} />
      </>
    );
  }

  // Naming the space renders outside the shell, on its own surface.
  //
  // The shell's shape is a rail beside a column, and a rail is a shape that
  // says "there are several of these and you are on one" — true of the steps
  // that ask questions, wrong for the one that is the product's first real
  // decision. Full-window, it reads as a threshold rather than as step 1 of 2.
  // The escape hatch comes along, since there is no rail to hold it.
  return (
    <>
      <div className="dark">
        <OnboardingLogoutButton />
      </div>
      <StepWorkspace
        existing={existingWorkspace}
        onCreated={handleWorkspaceCreated}
        onBusyChange={setStepBusy}
        onBack={handleBack}
        backDisabled={stepBusy}
      />
    </>
  );
}

export type OnboardingMode = "first_run" | "new_workspace";

export type OnboardingDestination =
  | { kind: "issue"; issueId: string }
  | {
      kind: "chat";
      sessionId: string;
    };

export type { OnboardingStep };
