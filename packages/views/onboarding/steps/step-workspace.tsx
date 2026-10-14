"use client";

import { type ReactNode, useRef, useEffect, useState } from "react";
import { ArrowLeft, Dices, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@quickwork/ui/components/ui/button";
import { cn } from "@quickwork/ui/lib/utils";
import { useCreateWorkspace } from "@quickwork/core/workspace/mutations";
import type { Workspace } from "@quickwork/core/types";
import { isImeComposing } from "@quickwork/core/utils";
import { matchLocale } from "@quickwork/core/i18n";
import { useConfigStore } from "@quickwork/core/config";
import { workspaceUrlHost } from "@quickwork/core/workspace/workspace-url";
import { useLogout } from "../../auth";
import { DragStrip } from "../../platform";
import { RadioMark } from "../components/option-card";
import { WorkspaceAvatar } from "../../workspace/workspace-avatar";
import { useT } from "../../i18n";
import {
  WORKSPACE_SLUG_REGEX,
  isWorkspaceSlugConflict,
  nameToWorkspaceSlug,
  randomCelestialWorkspaceIdentity,
} from "../../workspace/slug";
import { isReservedSlug } from "@quickwork/core/paths";

/**
 * Step 2 — create your first workspace, or continue with one set up in
 * an earlier session.
 *
 * Single full-width column, like every other step: a 3-region app shell
 * (header / scrolling middle / footer) with the form centred in it. One
 * **unified footer CTA** handles both paths — `Open X` when the user picks
 * an existing
 * workspace, `Create X` when they name a new one. The name / slug
 * fields are inlined here (not via the shared `CreateWorkspaceForm`)
 * because the footer-driven interaction needs externalized submit; the
 * shared form's own button would fight the footer CTA.
 *
 * The create-fields block doubles as a pedagogical preview: the URL is
 * rendered as a `<host>/[slug]` pill (host derived from the deployment's
 * app URL so self-hosted instances show their own domain), and a live
 * `Issues will look
 * like ACME-123` line shows the user what their issue IDs will read
 * like before they've created anything. The issue prefix behind that line
 * is an editable field pre-filled from the slug (MUL-6050) — it used to be
 * read-only, which left every non-ASCII-named workspace stuck on the
 * server's old `WS` fallback with no in-flow way out.
 *
 * Resume path ships two picker cards (existing + create-new) and the
 * user toggles between them. No-existing path just shows the create
 * fields directly.
 */

function issuePrefix(slug: string): string {
  // Mirrors the server's default prefix derivation
  // (handler.defaultIssuePrefixFromSlug) — alphanumerics of the slug, first
  // 4 chars, uppercased. Lowercase first because the server lowercases the
  // slug before deriving, so a user who types "ACME" here sees the same
  // "ACME" the server would produce rather than an empty strip. Returns ""
  // for a slug with nothing to derive from; that slug can't be submitted, so
  // only the preview has to cope with it.
  return slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 4)
    .toUpperCase();
}

// Letters + digits only, uppercase, capped at 10 — the same guardrail the
// settings tab applies, and the same shape the server now validates
// (`^[A-Z0-9]{1,10}$`).
function normalizePrefix(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
}

/** The value side of a row. No box: the row's own hairline is the field's
 *  only edge, so the input contributes nothing but the text and the caret. */
const GLASS_FIELD =
  "h-full w-full min-w-0 bg-transparent text-body text-white outline-none " +
  "placeholder:text-white/25";

/** Small mono caps — the label is a name for the row, not a sentence about it. */
const GLASS_LABEL =
  "font-mono text-micro uppercase tracking-[0.22em] text-white/40";

export function StepWorkspace({
  existing,
  onCreated,
  onBusyChange,
  onBack,
  backDisabled,
}: {
  existing?: Workspace | null;
  onCreated: (workspace: Workspace) => void | Promise<void>;
  /** Reports the create request's in-flight state to the flow, which owns
   *  navigation: Back has to lock while a workspace is being created, and
   *  only this step knows when that is. */
  onBusyChange?: (busy: boolean) => void;
  /** Return to the intro. This step renders outside `StepShell`, which is
   *  where every other step gets its Back from, so it takes one instead. */
  onBack?: () => void;
  backDisabled?: boolean;
}) {
  const { t, i18n } = useT("onboarding");
  const locale = matchLocale([i18n.resolvedLanguage ?? i18n.language]);
  const workspaceCreationDisabled = useConfigStore((s) => s.workspaceCreationDisabled);
  const urlHost = workspaceUrlHost(useConfigStore((s) => s.daemonAppUrl));
  // Single source of truth for "can the user reach the create path on this
  // instance?" — drives the resume-mode picker, the eyebrow/headline/lede
  // copy and the footer CTA so the disabled state can't
  // leak a clickable create affordance even if /api/config arrives late
  // (#3433 review feedback).
  const workspaceCreationAllowed = !workspaceCreationDisabled;
  const logout = useLogout();

  const reusing = existing ?? null;
  // Resume path only: user picks which card. `null` = neither yet, so
  // the footer CTA stays disabled. Clicking either card toggles — a
  // second click on the same card deselects it. No-existing path
  // ignores this state entirely. When workspace creation is disabled
  // and a workspace already exists, default to "existing" so the user
  // can press the CTA immediately — the only valid action.
  const [mode, setMode] = useState<"existing" | "create" | null>(() =>
    !workspaceCreationAllowed && existing ? "existing" : null,
  );
  const pickExisting = () =>
    setMode((m) => (m === "existing" ? null : "existing"));
  const pickCreate = () =>
    setMode((m) => (m === "create" ? null : "create"));

  // Form state for the create path. Mirrors CreateWorkspaceForm's
  // internals: slug auto-fills from name until the user manually edits
  // it; server-side slug conflicts show inline. Kept at this level so
  // the footer CTA can read `canCreate` and trigger `handleCreate`.
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugServerError, setSlugServerError] = useState<string | null>(null);
  const slugTouched = useRef(false);
  // Prefix follows the slug the same way the slug follows the name, and stops
  // following the moment the user edits it (MUL-6050). Editable here because
  // settings was the only place to change it, and a user who never noticed the
  // default would never go looking.
  const [prefix, setPrefix] = useState("");
  const prefixTouched = useRef(false);

  const slugValidationError =
    slug.length > 0 && !WORKSPACE_SLUG_REGEX.test(slug)
      ? t(($) => $.step_workspace.slug_format_error)
      : null;
  const slugReservedError =
    slug.length > 0 && isReservedSlug(slug)
      ? t(($) => $.step_workspace.slug_reserved_error)
      : null;
  const slugError = slugValidationError ?? slugReservedError ?? slugServerError;
  const canCreate =
    name.trim().length > 0 && slug.trim().length > 0 && !slugError;

  // What the workspace will actually be created with. Clearing the prefix
  // input reverts to the slug-derived default rather than blocking the CTA —
  // the placeholder shows that default, so an empty field is never a
  // surprise. Empty only while the slug is (a name that romanizes to nothing
  // derives none), which is also exactly when `canCreate` is false, so submit
  // always carries a real prefix.
  const derivedPrefix = issuePrefix(slug);
  const effectivePrefix = prefix || derivedPrefix;

  // Every slug write goes through here so the untouched prefix can't drift
  // out of sync with the slug it is derived from.
  const applySlug = (value: string) => {
    setSlug(value);
    setSlugServerError(null);
    if (!prefixTouched.current) setPrefix(issuePrefix(value));
  };

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugTouched.current) {
      // Locale decides whether Han characters are read as Chinese; see
      // nameToWorkspaceSlug.
      applySlug(nameToWorkspaceSlug(value, locale));
    }
  };

  const handleSlugChange = (value: string) => {
    slugTouched.current = true;
    applySlug(value);
  };

  const handlePrefixChange = (value: string) => {
    prefixTouched.current = true;
    setPrefix(normalizePrefix(value));
  };

  const handleRandomName = () => {
    const identity = randomCelestialWorkspaceIdentity(locale);
    slugTouched.current = true;
    setName(identity.name);
    applySlug(identity.slug);
  };

  const createWorkspace = useCreateWorkspace();

  const handleCreate = () => {
    if (!canCreate || createWorkspace.isPending) return;
    createWorkspace.mutate(
      {
        name: name.trim(),
        slug: slug.trim(),
        // Send what the user was shown. The server derives the same value
        // from the slug when the field is omitted, so the preview and the
        // created workspace agree either way — but submitting it explicitly
        // is what makes an edited prefix stick.
        issue_prefix: effectivePrefix,
      },
      {
        onSuccess: onCreated,
        onError: (error) => {
          if (isWorkspaceSlugConflict(error)) {
            setSlugServerError(t(($) => $.step_workspace.slug_taken_error));
            toast.error(t(($) => $.step_workspace.slug_conflict_toast));
            return;
          }
          toast.error(
            error instanceof Error && error.message
              ? error.message
              : t(($) => $.step_workspace.create_failed_toast),
          );
        },
      },
    );
  };

  // Compute the footer CTA from whichever path the user is on. `null`
  // is only reachable in the resume path; `existing` is only valid
  // when we actually have a `reusing` workspace; everything else
  // (including the no-existing path) funnels through `create` — except
  // when this instance has DISABLE_WORKSPACE_CREATION=true, in which
  // case the create path is unreachable and a no-reusing user falls
  // through to the disabled notice (rendered separately below).
  const isCreating = createWorkspace.isPending;
  useEffect(() => {
    onBusyChange?.(isCreating);
    // Clear on unmount: a successful create advances the flow immediately, so
    // without this the shell would stay locked on the next step.
    return () => onBusyChange?.(false);
  }, [isCreating, onBusyChange]);
  const creatingActive =
    workspaceCreationAllowed && (!reusing || mode === "create");
  const existingActive = Boolean(reusing) && mode === "existing";

  let hint: string;
  let continueLabel: string;
  let continueDisabled: boolean;
  let onContinue: () => void;

  if (existingActive && reusing) {
    hint = t(($) => $.step_workspace.hint_opening, { name: reusing.name });
    continueLabel = t(($) => $.step_workspace.cta_open, { name: reusing.name });
    continueDisabled = isCreating;
    onContinue = () => onCreated(reusing);
  } else if (creatingActive) {
    if (isCreating) {
      hint = t(($) => $.step_workspace.hint_creating_pending, {
        name: name.trim() || t(($) => $.step_workspace.hint_creating_fallback),
      });
      continueLabel = t(($) => $.step_workspace.cta_creating);
      continueDisabled = true;
      onContinue = () => {};
    } else if (canCreate) {
      hint = t(($) => $.step_workspace.hint_creating, { name: name.trim() });
      continueLabel = t(($) => $.step_workspace.cta_create_named, { name: name.trim() });
      continueDisabled = false;
      onContinue = handleCreate;
    } else {
      hint = t(($) => $.step_workspace.hint_name_first);
      continueLabel = t(($) => $.step_workspace.cta_create_workspace);
      continueDisabled = true;
      onContinue = () => {};
    }
  } else {
    hint = t(($) => $.step_workspace.hint_pick);
    continueLabel = t(($) => $.common.continue);
    continueDisabled = true;
    onContinue = () => {};
  }

  // Hand-rolled rather than built on the shared `Field` primitives, which is
  // the one place this step leaves the product's form language: their resting
  // state is a filled field whose border only shows itself on error, and on
  // this pane each row has to read as a strip of the glass panel instead. The
  // label / hint / error wiring they standardise is reproduced by hand below.
  const createFields = (
    <div className="onboarding-glass-card onboarding-glass-rise flex flex-col rounded-2xl px-6">
      {/* Rows of a dispatch form, not fields of a web form: a mono label
          holding a fixed left column, the value on the right, and one hairline
          between rows. No box — a rounded bordered input is the generic shape
          every tracker draws, and a boxed field would also fight the panel it
          sits on. Focus moves the rule to the product's own `--inflight` and
          turns the caret with it. */}

      {/* Name — the only thing this step asks for. */}
      <div
        className="onboarding-glass-row flex items-center gap-4 border-b border-white/[0.07] py-5 transition-colors focus-within:border-inflight/50"
        style={{ animationDelay: "80ms" }}
      >
        <label htmlFor="ws-name" className={cn(GLASS_LABEL, "w-[7.5rem] shrink-0")}>
          {t(($) => $.step_workspace.name_label)}
        </label>
        <input
          id="ws-name"
          autoFocus
          type="text"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder={t(($) => $.step_workspace.name_placeholder)}
          className={cn(GLASS_FIELD, "caret-inflight")}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return;
            if (e.key === "Enter") handleCreate();
          }}
        />
        <button
          type="button"
          onClick={handleRandomName}
          disabled={isCreating}
          title={t(($) => $.step_workspace.random_name)}
          aria-label={t(($) => $.step_workspace.random_name)}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
        >
          <Dices className="size-4" />
        </button>
      </div>

      {/* Address — derived from the name, so it is shown rather than asked
          for. The editable form appears only when the derivation produced
          nothing (a kana, Hangul or emoji name has no ASCII slug), which is
          also the only case where the value has to come from the member. */}
      <div
        className="onboarding-glass-row flex items-center gap-4 border-b border-white/[0.07] py-5 transition-colors focus-within:border-inflight/50"
        style={{ animationDelay: "160ms" }}
        data-invalid={slugError ? true : undefined}
      >
        <label htmlFor="ws-slug" className={cn(GLASS_LABEL, "w-[7.5rem] shrink-0")}>
          {t(($) => $.step_workspace.url_label)}
        </label>
        {slug ? (
          <span className="min-w-0 truncate font-mono text-body text-white/70">
            {`${urlHost}/`}
            <span className="text-white">{slug}</span>
          </span>
        ) : (
          <input
            id="ws-slug"
            type="text"
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            placeholder={t(($) => $.step_workspace.slug_placeholder)}
            className={cn(GLASS_FIELD, "caret-inflight font-mono")}
            onKeyDown={(e) => {
              if (isImeComposing(e)) return;
              if (e.key === "Enter") handleCreate();
            }}
          />
        )}
      </div>
      {slugError ? (
        <p className="-mt-2 pb-3 pl-[8.5rem] text-caption text-destructive">
          {slugError}
        </p>
      ) : null}

      {/* Issue prefix — pre-filled from the address, and what the member's
          issues will read as from here on. */}
      <div
        className="onboarding-glass-row flex flex-col gap-2 py-5 transition-colors focus-within:border-inflight/50"
        style={{ animationDelay: "240ms" }}
      >
        <div className="flex items-center gap-4">
          <label
            htmlFor="ws-issue-prefix"
            className={cn(GLASS_LABEL, "w-[7.5rem] shrink-0")}
          >
            {t(($) => $.step_workspace.issue_prefix_label)}
          </label>
          <input
            id="ws-issue-prefix"
            type="text"
            value={prefix}
            onChange={(e) => handlePrefixChange(e.target.value)}
            placeholder={derivedPrefix}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={10}
            className={cn(GLASS_FIELD, "caret-inflight w-24 font-mono uppercase tracking-[0.14em]")}
            onKeyDown={(e) => {
              if (isImeComposing(e)) return;
              if (e.key === "Enter") handleCreate();
            }}
          />
        </div>
        <p className="pl-[8.5rem] text-caption text-white/40">
          {effectivePrefix ? (
            <>
              {t(($) => $.step_workspace.issue_prefix_prefix)}
              <span className="font-mono text-white">{effectivePrefix}-123</span>
              {t(($) => $.step_workspace.issue_prefix_suffix)}
            </>
          ) : (
            t(($) => $.step_workspace.issue_prefix_pending)
          )}
        </p>
      </div>
    </div>
  );

  return (
    <div className="dark onboarding-glass-pane flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground">
      <DragStrip />

      {/* No rail on this step, so Back has to carry itself. */}
      <div className="flex shrink-0 items-center px-6 pt-5 sm:px-10">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            disabled={backDisabled}
            className="flex items-center gap-1.5 rounded-md text-caption text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <ArrowLeft className="size-3.5" />
            {t(($) => $.common.back)}
          </button>
        )}
      </div>

      <div className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10">
        <div className="animate-onboarding-enter flex w-full max-w-[540px] flex-col gap-9">
        {/* The eyebrow is gone with the rest of them, but its disabled-state
            wording is not: "Workspace creation is disabled" was the only
            thing on this screen that said so before the notice below, so
            that variant is folded into the heading's own copy. */}
        {/* Display scale, not a form label: this is the first decision the
            product asks a member to make, and `StepHeading`'s title-lg reads
            as one field of a longer form. */}
        <header className="flex flex-col gap-4">
          <span className="font-mono text-micro uppercase tracking-[0.3em] text-white/35">
            {t(($) => $.step_nav.wordmark)}
          </span>
          <h1 className="text-balance text-3xl font-semibold leading-[1.06] tracking-[-0.035em] text-white sm:text-4xl">
            {reusing
              ? workspaceCreationAllowed
                ? t(($) => $.step_workspace.headline_resume, { name: reusing.name })
                : t(($) => $.step_workspace.creation_disabled_headline_resume, { name: reusing.name })
              : workspaceCreationAllowed
                ? t(($) => $.step_workspace.headline_first)
                : t(($) => $.step_workspace.creation_disabled_headline)}
          </h1>
          <p className="max-w-[46ch] text-pretty text-body leading-relaxed text-white/55">
            {reusing
              ? workspaceCreationAllowed
                ? t(($) => $.step_workspace.lede_resume)
                : t(($) => $.step_workspace.creation_disabled_lede_resume)
              : workspaceCreationAllowed
                ? t(($) => $.step_workspace.lede_first)
                : t(($) => $.step_workspace.creation_disabled_lede)}
          </p>
        </header>

        <div>
          {reusing ? (
            <div className="flex flex-col gap-3">
              <ExistingWorkspaceCard
                workspace={reusing}
                selected={mode === "existing"}
                onSelect={pickExisting}
              />
              {/* Hide the create-new card entirely when the self-host
                  gate (DISABLE_WORKSPACE_CREATION) is on (#3433) — the
                  backend would 403 the POST and the user would be stuck
                  with a useless form. */}
              {!workspaceCreationDisabled && (
                <CreateNewWorkspaceCard
                  selected={mode === "create"}
                  onSelect={pickCreate}
                >
                  {createFields}
                </CreateNewWorkspaceCard>
              )}
            </div>
          ) : workspaceCreationDisabled ? (
            <CreationDisabledNotice onLogout={logout} />
          ) : (
            createFields
          )}
        </div>

        {!(workspaceCreationDisabled && !reusing) && (
          <div className="flex flex-col gap-3">
            <Button
              className="onboarding-glass-cta h-12 rounded-xl text-body font-semibold"
              disabled={continueDisabled}
              onClick={onContinue}
            >
              {continueLabel}
            </Button>
            {hint ? (
              <p className="text-center text-caption text-muted-foreground">
                {hint}
              </p>
            ) : null}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

/**
 * Onboarding-step notice rendered when the operator has set
 * DISABLE_WORKSPACE_CREATION=true (#3433) AND the user has no existing
 * workspace yet. The headline / lede above this block already carry the
 * messaging; this component only provides the logout escape so a user who
 * landed here without an invitation is not trapped.
 */
function CreationDisabledNotice({ onLogout }: { onLogout: () => void }) {
  const { t } = useT("onboarding");
  return (
    <div className="flex flex-col gap-3">
      <Button variant="outline" size="lg" onClick={onLogout}>
        {t(($) => $.step_workspace.creation_disabled_logout)}
      </Button>
    </div>
  );
}

function ExistingWorkspaceCard({
  workspace,
  selected,
  onSelect,
}: {
  workspace: Workspace;
  selected: boolean;
  onSelect: () => void;
}) {
  const urlHost = workspaceUrlHost(useConfigStore((s) => s.daemonAppUrl));
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "onboarding-glass-card flex w-full items-center gap-4 rounded-lg border px-5 py-4 text-left transition-all",
        // Hover moves the border, not the fill: the fill is translucent glass
        // shared with the pane behind it, so tinting it reads as smudge rather
        // than as response.
        selected
          ? "border-foreground shadow-[inset_0_0_0_1px_var(--color-foreground)]"
          : "hover:border-foreground/40",
      )}
    >
      <WorkspaceAvatar name={workspace.name} avatarUrl={workspace.avatar_url} size="lg" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="truncate text-body font-medium text-foreground">
          {workspace.name}
        </div>
        <div className="truncate font-mono text-caption text-muted-foreground">
          {`${urlHost}/${workspace.slug}`}
        </div>
      </div>
      <RadioMark selected={selected} />
    </button>
  );
}

/**
 * Collapsible "Create a new workspace" radio card — shown in the resume
 * path alongside the existing-workspace card. Clicking the header
 * toggles selection; selected state expands to reveal the name / slug
 * fields (passed in as children by the caller). Submission is driven
 * by the parent's footer CTA, not a button inside this card.
 */
function CreateNewWorkspaceCard({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  const { t } = useT("onboarding");
  return (
    <div
      className={cn(
        "onboarding-glass-card overflow-hidden rounded-lg border transition-all",
        selected
          ? "border-foreground shadow-[inset_0_0_0_1px_var(--color-foreground)]"
          : "hover:border-foreground/40",
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        aria-expanded={selected}
        onClick={onSelect}
        className="flex w-full items-center gap-4 px-5 py-4 text-left"
      >
        <div
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
        >
          <Plus className="h-4 w-4" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="truncate text-body font-medium text-foreground">
            {t(($) => $.step_workspace.create_new_title)}
          </div>
          <div className="truncate text-caption text-muted-foreground">
            {t(($) => $.step_workspace.create_new_subtitle)}
          </div>
        </div>
        <RadioMark selected={selected} />
      </button>
      {selected && <div className="border-t px-5 py-5">{children}</div>}
    </div>
  );
}
