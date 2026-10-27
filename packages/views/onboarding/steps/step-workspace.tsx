"use client";

import { type ReactNode, useRef, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Dices, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@quickwork/ui/components/ui/button";
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

  const createFields = (
    <div className="qw-onb-form">
      <label className="qw-onb-field" htmlFor="ws-name">
        <span>{t(($) => $.step_workspace.name_label)}</span>
        <div className="qw-onb-value">
          <input
            id="ws-name"
            aria-label={t(($) => $.step_workspace.name_label)}
            autoFocus
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder={t(($) => $.step_workspace.name_placeholder)}
            className="qw-onb-input"
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
            className="qw-onb-dice"
          >
            <Dices className="size-4" />
          </button>
        </div>
      </label>

      <label className="qw-onb-field" htmlFor="ws-slug" data-invalid={slugError ? true : undefined}>
        <span>{t(($) => $.step_workspace.url_label)}</span>
        <div className="qw-onb-url">
          <span>{`${urlHost}/`}</span>
          <input
            id="ws-slug"
            aria-label={t(($) => $.step_workspace.url_label)}
            type="text"
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            placeholder={t(($) => $.step_workspace.slug_placeholder)}
            className="qw-onb-input mono"
            onKeyDown={(e) => {
              if (isImeComposing(e)) return;
              if (e.key === "Enter") handleCreate();
            }}
          />
        </div>
      </label>
      {slugError ? <p className="qw-onb-field-error">{slugError}</p> : null}

      <label className="qw-onb-field prefix" htmlFor="ws-issue-prefix">
        <span>{t(($) => $.step_workspace.issue_prefix_label)}</span>
        <div className="qw-onb-value">
          <input
            id="ws-issue-prefix"
            aria-label={t(($) => $.step_workspace.issue_prefix_label)}
            type="text"
            value={prefix}
            onChange={(e) => handlePrefixChange(e.target.value)}
            placeholder={derivedPrefix}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={10}
            className="qw-onb-input mono prefix"
            onKeyDown={(e) => {
              if (isImeComposing(e)) return;
              if (e.key === "Enter") handleCreate();
            }}
          />
        </div>
      </label>
      <p className="qw-onb-issue-preview">
        {effectivePrefix ? (
          <>
            {t(($) => $.step_workspace.issue_prefix_prefix)}
            <b>{effectivePrefix}-123</b>
            {t(($) => $.step_workspace.issue_prefix_suffix)}
          </>
        ) : (
          t(($) => $.step_workspace.issue_prefix_pending)
        )}
      </p>
    </div>
  );

  const previewReusing = Boolean(reusing) && mode !== "create";
  const previewName = previewReusing
    ? (reusing?.name ?? "")
    : name.trim() || t(($) => $.step_workspace.preview.default_name);
  const previewSlug = previewReusing
    ? (reusing?.slug ?? "")
    : slug.trim();
  const previewPrefix = previewReusing
    ? (reusing?.issue_prefix ?? "")
    : effectivePrefix;

  const heading = reusing
    ? workspaceCreationAllowed
      ? t(($) => $.step_workspace.headline_resume, { name: reusing.name })
      : t(($) => $.step_workspace.creation_disabled_headline_resume, { name: reusing.name })
    : workspaceCreationAllowed
      ? t(($) => $.step_workspace.headline_first)
      : t(($) => $.step_workspace.creation_disabled_headline);
  const lede = reusing
    ? workspaceCreationAllowed
      ? t(($) => $.step_workspace.lede_resume)
      : t(($) => $.step_workspace.creation_disabled_lede_resume)
    : workspaceCreationAllowed
      ? t(($) => $.step_workspace.lede_first)
      : t(($) => $.step_workspace.creation_disabled_lede);

  return (
    <div className="qw-onb-workspace">
      <DragStrip />
      <div className="qw-onb-ws-top">
        <span className="qw-onb-mark">Q</span>
        <span className="qw-onb-word">{t(($) => $.step_nav.wordmark)}</span>
        <span className="qw-onb-progress">{t(($) => $.step_workspace.progress)}</span>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            disabled={backDisabled}
            className="qw-onb-back"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {t(($) => $.common.back)}
          </button>
        )}
      </div>

      <div className="qw-onb-ws-body">
        <div className="qw-onb-ws-copy">
          <h1>{heading}</h1>
          <p>{lede}</p>

          <div className="qw-onb-ws-form">
            {reusing ? (
              <div className="qw-onb-choice-list">
                <ExistingWorkspaceCard
                  workspace={reusing}
                  selected={mode === "existing"}
                  onSelect={pickExisting}
                />
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
        </div>

        {!(workspaceCreationDisabled && !reusing) && (
          <aside className="qw-onb-ws-preview">
            <div className="qw-onb-ws-label">
              {t(($) => $.step_workspace.preview.label)}
            </div>
            <div className="qw-onb-ws-card">
              <span className="qw-onb-ws-avatar" aria-hidden="true">
                {previewName.trim().charAt(0).toUpperCase() || "Q"}
              </span>
              <div className="min-w-0">
                <b>{previewName}</b>
                <span>
                  {`${urlHost}/`}
                  {previewSlug || "…"}
                </span>
              </div>
            </div>
            <div className="qw-onb-ws-facts">
              <div>
                <span>{t(($) => $.step_workspace.preview.tasks)}</span>
                <b>
                  {previewPrefix
                    ? t(($) => $.step_workspace.preview.issue_start, {
                        prefix: previewPrefix,
                      })
                    : "—"}
                </b>
              </div>
              <div>
                <span>{t(($) => $.step_workspace.preview.members)}</span>
                <b>{t(($) => $.step_workspace.preview.only_you)}</b>
              </div>
              <div>
                <span>{t(($) => $.step_workspace.preview.runtime)}</span>
                <b>{t(($) => $.step_workspace.preview.connect_after)}</b>
              </div>
            </div>
            <p className="qw-onb-ws-note">
              {t(($) => $.step_workspace.preview.note)}
            </p>
          </aside>
        )}
      </div>

      {!(workspaceCreationDisabled && !reusing) && (
        <div className="qw-onb-ws-foot">
          <span className="qw-onb-hint">{hint}</span>
          <button
            type="button"
            className="qw-onb-primary"
            disabled={continueDisabled}
            onClick={onContinue}
          >
            {isCreating ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            {continueLabel}
            {!isCreating ? (
              <ArrowRight className="size-3.5" aria-hidden="true" />
            ) : null}
          </button>
        </div>
      )}
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
      className="qw-onb-choice"
      data-selected={selected ? "" : undefined}
    >
      <WorkspaceAvatar name={workspace.name} avatarUrl={workspace.avatar_url} size="lg" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="qw-onb-choice-title">
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
      className="qw-onb-choice"
      data-selected={selected ? "" : undefined}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        aria-expanded={selected}
        onClick={onSelect}
        className="qw-onb-choice-head"
      >
        <div
          aria-hidden
          className="qw-onb-choice-plus"
        >
          <Plus className="h-4 w-4" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="qw-onb-choice-title">
            {t(($) => $.step_workspace.create_new_title)}
          </div>
          <div className="qw-onb-choice-sub">
            {t(($) => $.step_workspace.create_new_subtitle)}
          </div>
        </div>
        <RadioMark selected={selected} />
      </button>
      {selected && <div className="qw-onb-choice-body">{children}</div>}
    </div>
  );
}
