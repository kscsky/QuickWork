"use client";

import {
  useState,
  useEffect,
  useCallback,
  useContext,
  createContext,
  useRef,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@quickwork/ui/components/ui/input";
import { Button } from "@quickwork/ui/components/ui/button";
import { Label } from "@quickwork/ui/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@quickwork/ui/components/ui/input-otp";
import { UI_EASE_OUT, UI_MOTION_DURATION } from "@quickwork/ui/lib/motion";
import { cn } from "@quickwork/ui/lib/utils";
import { useAuthStore } from "@quickwork/core/auth";
import { workspaceKeys } from "@quickwork/core/workspace/queries";
import { api } from "@quickwork/core/api";
import type { User } from "@quickwork/core/types";
import { DispatchScene } from "./dispatch-scene";
import { useT } from "../i18n";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GoogleAuthConfig {
  clientId: string;
  redirectUri: string;
  /** Opaque state passed through Google OAuth (e.g. "platform:desktop"). */
  state?: string;
}

interface CliCallbackConfig {
  /** Validated localhost callback URL */
  url: string;
  /** Opaque state to pass back to CLI */
  state: string;
}

interface LoginPageProps {
  /** Logo element rendered above the title */
  logo?: ReactNode;
  /** Called after successful login. The workspace list is seeded into React
   *  Query before this fires, so the caller can compute a destination URL. */
  onSuccess: () => void;
  /** Google OAuth config. Omit to disable Google login. */
  google?: GoogleAuthConfig;
  /** CLI callback config for authorizing CLI tools. */
  cliCallback?: CliCallbackConfig;
  /** Called after a token is obtained (e.g. to set cookies). */
  onTokenObtained?: () => void;
  /** Override Google login handler (e.g. desktop opens browser externally). When provided, renders the Google button even if `google` config is omitted. */
  onGoogleLogin?: () => void;
  /** Slot rendered at the bottom of the sign-in card, below the
   *  Google button. The web shell uses it for a "Prefer the desktop
   *  app?" prompt; desktop omits it (a download prompt inside the app
   *  would be absurd). */
  extra?: ReactNode;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function redirectToCliCallback(url: string, token: string, state: string) {
  const separator = url.includes("?") ? "&" : "?";
  window.location.href = `${url}${separator}token=${encodeURIComponent(token)}&state=${encodeURIComponent(state)}`;
}

/**
 * Validate that a CLI callback URL points to a safe host over HTTP.
 * Allows localhost and private/LAN IPs (RFC 1918) to support self-hosted setups
 * on local VMs while blocking arbitrary public hosts.
 */
export function validateCliCallback(cliCallback: string): boolean {
  try {
    const cbUrl = new URL(cliCallback);
    if (cbUrl.protocol !== "http:") return false;
    const h = cbUrl.hostname;
    if (h === "localhost" || h === "127.0.0.1") return true;
    // Allow RFC 1918 private IPs: 10.x.x.x, 172.16-31.x.x, 192.168.x.x
    if (/^10\./.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    if (/^192\.168\./.test(h)) return true;
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Seconds between successive items of the sign-in column. */
const REVEAL_STAGGER = 0.06;

const EASE_OUT: [number, number, number, number] = [...UI_EASE_OUT];

/** Digits in a login code. Read by the field's counter, by the render and by
 *  the completion test, so the three cannot disagree. */
const CODE_LENGTH = 6;
/** Seconds before a code can be resent. The cooldown bar drains against this,
 *  so the timer and the bar it draws are the same number. */
const RESEND_SECONDS = 60;

/**
 * Which way the last step change went. The cascade reads it so going forward
 * and coming back are not the same gesture: the column slides in from the side
 * the user moved toward. Defaulted to forward, which is what the first paint of
 * the email step is.
 */
const StepDirectionContext = createContext<1 | -1>(1);

/**
 * One item of the sign-in column. The items arrive one after another — title,
 * then description, then the fields — so the eye is led down the form instead
 * of being given the whole thing at once. The column is remounted on every step
 * change (see `stepKey` below), so the same cascade plays when the code and CLI
 * steps replace the email form rather than the content swapping in flat.
 */
function Reveal({ index, children }: { index: number; children: ReactNode }) {
  const shouldReduceMotion = useReducedMotion() ?? false;
  const direction = useContext(StepDirectionContext);

  return (
    <motion.div
      initial={
        shouldReduceMotion ? false : { opacity: 0, y: 12, x: direction * 10 }
      }
      animate={{ opacity: 1, y: 0, x: 0 }}
      transition={{
        duration: UI_MOTION_DURATION.standard,
        delay: shouldReduceMotion ? 0 : index * REVEAL_STAGGER,
        ease: EASE_OUT,
      }}
    >
      {children}
    </motion.div>
  );
}

function CheckGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-2.5", className)}
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2 5.3 4.1 7.4 8 3.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The mark on the primary action. It points the way the flow goes and leans
 * that way when the button is hovered, so the button's affordance is a
 * direction rather than only a colour change.
 */
function ArrowGlyph() {
  return (
    <svg
      className="size-3.5 transition-transform duration-200 ease-out group-hover/button:translate-x-0.5 group-focus-visible/button:translate-x-0.5"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 8h9.4M9.2 4.6 12.6 8l-3.4 3.4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A shell prompt, for the step that hands the session to a terminal. */
function PromptGlyph() {
  return (
    <svg className="size-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.6 4.6 7 8l-3.4 3.4M8.6 11.6h3.8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GoogleGlyph() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

/**
 * Where the user is in the flow, and how much of it is left. It is shared by
 * all three steps rather than owned by the email form, so the code and CLI
 * screens keep the same sense of position; the CLI step grows a third node
 * because authorizing a terminal is genuinely a step after signing in.
 *
 * Three things move, and each says something the others cannot:
 *
 * - the track between the nodes fills, which is how far along the user is;
 * - the marker travels to the node the user just landed on, which is the
 *   movement between steps — the step change is otherwise only a cross-fade
 *   of the column below and reads as a different screen rather than the next
 *   one;
 * - the marker breathes while it sits there (`.login-form-marker`), which is
 *   what keeps an idle rail from looking like a still image.
 *
 * All of the geometry is derived from one number: node centres sit at
 * `(i + 0.5) / n` of the row, so a two-node rail is inset 25% at each end and
 * a three-node one 16.7%, and the marker's travel is that inset plus the
 * filled fraction of the span between them.
 *
 * The rail is a list, not decoration: the current node is `aria-current` and
 * every moving part is hidden from assistive tech, so the labels carry the
 * meaning.
 */
function StepRail({
  labels,
  active,
}: {
  labels: readonly string[];
  active: number;
}) {
  const shouldReduceMotion = useReducedMotion() ?? false;
  const span = Math.max(labels.length - 1, 1);
  const filled = Math.min(active, span) / span;
  const edge = 50 / labels.length;
  const track = { left: `${edge}%`, right: `${edge}%` };
  const here = `${edge + filled * (100 - 2 * edge)}%`;

  return (
    <div className="relative w-full">
      {/* The track spans node centre to node centre, so it reads as connecting
          the steps rather than as a rule under them. Outside the list: an
          `<ol>` may only hold `<li>`, and the track is not a step. */}
      <span
        className="absolute top-2.5 h-px bg-border"
        style={track}
        aria-hidden="true"
      />
      <motion.span
        className="absolute top-2.5 h-px origin-left bg-brand"
        style={track}
        aria-hidden="true"
        initial={false}
        animate={{ scaleX: filled }}
        transition={{ duration: shouldReduceMotion ? 0 : 0.36, ease: EASE_OUT }}
      />
      <motion.span
        className="login-form-marker absolute top-2.5 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-brand/45 bg-brand/10"
        aria-hidden="true"
        initial={false}
        animate={{ left: here }}
        transition={{ duration: shouldReduceMotion ? 0 : 0.42, ease: EASE_OUT }}
      />
      <ol className="relative flex items-start">
        {labels.map((label, index) => {
          const done = index < active;
          const current = index === active;

          return (
            <li
              key={label}
              aria-current={current ? "step" : undefined}
              className="flex min-w-0 flex-1 flex-col items-center gap-2"
            >
              {/* Opaque, so the track and the marker pass behind the nodes
                  instead of through them. */}
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-full border text-micro leading-none transition-colors duration-300",
                  done && "border-brand bg-brand text-brand-foreground",
                  current && "border-brand bg-surface text-brand",
                  !done &&
                    !current &&
                    "border-border bg-surface text-muted-foreground",
                )}
              >
                {done ? <CheckGlyph className="size-2.5" /> : index + 1}
              </span>
              <span
                className={cn(
                  "truncate text-micro transition-colors duration-300",
                  current ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * A rejected attempt. The shake is a CSS class rather than an animation prop
 * because the node is mounted by `{error && …}` and the handler clears the
 * message before every retry — so a repeat failure is a fresh mount and the
 * animation replays for free, with nothing to key. Deliberately not wrapped in
 * `AnimatePresence`: with an exit animation the message would still be in the
 * DOM while the retry runs, and the same failure twice in a row would keep the
 * same key and never replay the shake.
 */
function ErrorNotice({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="login-form-shake flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-body text-destructive"
    >
      <svg
        className="mt-0.5 size-3.5 shrink-0"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M8 4.9v3.6M8 10.9v.2"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
      <span>{message}</span>
    </p>
  );
}

/**
 * The head of every step: what this screen is, and the one sentence that says
 * what is about to happen. Left-aligned rather than centred — the panel is a
 * console, and a console puts its labels in a column.
 */
function StepHeader({
  logo,
  title,
  description,
}: {
  logo?: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {logo ? <div className="mb-1">{logo}</div> : null}
      <Reveal index={0}>
        <h2 className="text-display-sm font-semibold tracking-tight text-foreground">
          {title}
        </h2>
      </Reveal>
      <Reveal index={1}>
        <p className="text-body-lg text-muted-foreground">{description}</p>
      </Reveal>
    </div>
  );
}

/**
 * A labelled field. The frame belongs to the field, not to the Input: the
 * accent bar has to be positioned against the same box the focus halo is drawn
 * on, and that is not something a utility on the control itself can express —
 * see `.login-field` in `packages/ui/styles/base.css`, which also owns the
 * focus treatment. Children are left to the caller, because the code step's
 * six cells are a frame of their own and must not be nested in this one.
 *
 * `readout` is the quiet mono answer on the right of the label — it restates
 * what the field already holds, so it is hidden from assistive tech.
 */
function Field({
  htmlFor,
  label,
  readout,
  children,
}: {
  htmlFor?: string;
  label: ReactNode;
  readout?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={htmlFor}>{label}</Label>
        {readout ? (
          <span
            aria-hidden="true"
            className="flex items-center font-mono text-micro tabular-nums text-muted-foreground"
          >
            {readout}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/**
 * Sign-in chrome. The identity panel is the desktop half of the page and is
 * deliberately absent on a phone: at that width the form is the entire job, and
 * a decorative half-screen would only push the field below the fold.
 *
 * The form sits on a panel of its own, and the panel is the point. The board on
 * the left is five lanes of instruments; a column of default controls floating
 * on white cannot answer it, and two thirds of the column was empty. Giving the
 * form an edge, a header zone and a footer zone is what makes the two halves
 * read as one page — the panel is the same object as a lane: a bounded work
 * surface with a label and a count.
 *
 * `stepKey` is the identity of the step on screen. Re-keying the column instead
 * of routing an exit animation through AnimatePresence keeps the outgoing step
 * out of the DOM immediately — the new step's content is never delayed behind
 * an exit that failed to fire, and the OTP field is focusable on the frame it
 * appears.
 *
 * The shell itself owns the two things that must outlive a step change: the
 * step rail (it animates *between* steps, so it cannot be inside the keyed
 * column) and the ambient wash behind the panel.
 */
function LoginShell({
  stepKey,
  railSteps,
  railActive,
  direction,
  children,
}: {
  stepKey: string;
  /** How many nodes the rail shows for this step: two for email and code,
   *  three once authorizing a terminal is the last thing left. */
  railSteps: 2 | 3;
  /** Index of the node the user is on. */
  railActive: number;
  direction: 1 | -1;
  children: ReactNode;
}) {
  const { t } = useT("auth");
  const railLabels = [
    t(($) => $.signin.step.email),
    t(($) => $.signin.step.code),
    t(($) => $.signin.step.authorize),
  ].slice(0, railSteps);

  return (
    <div className="grid min-h-svh lg:grid-cols-[1.15fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-surface-border bg-app-shell pl-14 pt-14 pb-16 lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="size-2.5 rounded-[3px] bg-brand" />
          <span className="text-title-sm font-semibold tracking-tight">QuickWork</span>
        </div>

        <div className="flex flex-col gap-12">
          <div className="flex flex-col gap-4">
            <h1 className="max-w-[11ch] text-display font-semibold leading-[1.06] tracking-[-0.035em]">
              {t(($) => $.signin.brand_title)}
            </h1>
            <p className="max-w-[34ch] text-body-lg leading-7 text-muted-foreground">
              {t(($) => $.signin.brand_line)}
            </p>
          </div>

          <DispatchScene />
        </div>

        <div aria-hidden="true" />
      </aside>

      {/* The shell owns the backdrop, so the panel reads as an object placed on
          the page's frame rather than as a floating box on whatever the app
          canvas happens to be. */}
      <main className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden bg-app-shell px-6 py-12">
        {/* First in the DOM on purpose: it paints under the panel without
            needing a stacking context, and it never takes a pointer event. */}
        <span
          aria-hidden="true"
          className="login-form-ambient pointer-events-none absolute left-1/2 top-1/2 size-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full"
        />
        <div className="relative flex w-full max-w-[26rem] flex-col gap-7 overflow-hidden rounded-xl border border-surface-border bg-surface p-7 shadow-[var(--floating-shadow)] sm:p-8">
          {/* A wash off the top edge, so the panel's upper zone is not the same
              flat white as the fields that sit on it. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-brand/6 to-transparent"
          />
          <StepRail labels={railLabels} active={railActive} />
          <StepDirectionContext.Provider value={direction}>
            <div key={stepKey} className="flex flex-col gap-8">
              {children}
            </div>
          </StepDirectionContext.Provider>
        </div>
      </main>
    </div>
  );
}

export function LoginPage({
  logo,
  onSuccess,
  google,
  cliCallback,
  onTokenObtained,
  onGoogleLogin,
  extra,
}: LoginPageProps) {
  const { t } = useT("auth");
  const shouldReduceMotion = useReducedMotion() ?? false;
  const qc = useQueryClient();
  const [step, setStep] = useState<"email" | "code" | "cli_confirm">("email");
  // Which way the column should travel when the step changes: forward when
  // progressing, back when returning to the email field. Read by `Reveal`.
  const [direction, setDirection] = useState<1 | -1>(1);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [existingUser, setExistingUser] = useState<User | null>(null);
  // Tracks how the existing session was detected so handleCliAuthorize
  // uses the matching token source (cookie → issueCliToken, localStorage → direct).
  const authSourceRef = useRef<"cookie" | "localStorage">("cookie");
  const codeInputRef = useRef<HTMLInputElement>(null);

  // Check for existing session when CLI callback is present.
  // Prioritises cookie auth (= current browser session) to avoid authorising
  // the CLI with a stale or mismatched localStorage token.
  useEffect(() => {
    if (!cliCallback) return;

    // Ensure no stale bearer token interferes — we want to test the cookie first.
    api.setToken(null);

    api
      .getMe()
      .then((user) => {
        authSourceRef.current = "cookie";
        setExistingUser(user);
        setDirection(1);
        setStep("cli_confirm");
      })
      .catch(() => {
        // Cookie auth failed — fall back to localStorage token
        const token = localStorage.getItem("quickwork_token");
        if (!token) return;

        api.setToken(token);
        api
          .getMe()
          .then((user) => {
            authSourceRef.current = "localStorage";
            setExistingUser(user);
            setDirection(1);
            setStep("cli_confirm");
          })
          .catch(() => {
            api.setToken(null);
            localStorage.removeItem("quickwork_token");
          });
      });
  }, [cliCallback]);

  // Cooldown timer for resend
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // A rejected code clears the field so the next attempt starts from nothing —
  // but the field is `disabled` while the code is checked, and disabling an
  // input drops focus, so the rejection would leave the caret nowhere and the
  // user typing into the page. Put it back once the field is live again, which
  // is what makes retyping immediately possible.
  useEffect(() => {
    if (step !== "code" || loading || !error) return;
    codeInputRef.current?.focus();
  }, [step, loading, error]);

  const handleSendCode = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!email) {
        setError(t(($) => $.common.email_required));
        return;
      }
      setLoading(true);
      setError("");
      try {
        await useAuthStore.getState().sendCode(email);
        setDirection(1);
        setStep("code");
        setCode("");
        setCooldown(60);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : `${t(($) => $.errors.send_failed)} ${t(($) => $.errors.server_unreachable)}`,
        );
      } finally {
        setLoading(false);
      }
    },
    [email, t],
  );

  const handleVerify = useCallback(
    async (value: string) => {
      if (value.length !== 6) return;
      setLoading(true);
      setError("");
      try {
        if (cliCallback) {
          // CLI path: get token directly for the redirect URL
          const { token } = await api.verifyCode(email, value);
          localStorage.setItem("quickwork_token", token);
          api.setToken(token);
          onTokenObtained?.();
          redirectToCliCallback(cliCallback.url, token, cliCallback.state);
          return;
        }

        // Normal path: seed the workspace list into the Query cache so the
        // caller's onSuccess can read it synchronously to compute a destination
        // URL (first workspace's slug, or /workspaces/new for zero-workspace
        // users).
        await useAuthStore.getState().verifyCode(email, value);
        const wsList = await api.listWorkspaces();
        qc.setQueryData(workspaceKeys.list(), wsList);
        onTokenObtained?.();
        onSuccess();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : t(($) => $.errors.code_invalid),
        );
        setCode("");
        setLoading(false);
      }
    },
    [email, onSuccess, cliCallback, onTokenObtained, qc, t],
  );

  const handleResend = async () => {
    if (cooldown > 0) return;
    setError("");
    try {
      await useAuthStore.getState().sendCode(email);
      setCooldown(60);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t(($) => $.errors.resend_failed),
      );
    }
  };

  const handleCliAuthorize = async () => {
    if (!cliCallback) return;
    setLoading(true);

    try {
      let token: string;

      if (authSourceRef.current === "localStorage") {
        // Session was detected via localStorage — reuse that token directly.
        const stored = localStorage.getItem("quickwork_token");
        if (!stored) throw new Error("token missing");
        token = stored;
      } else {
        // Session was detected via cookie — obtain a bearer token from the server.
        const res = await api.issueCliToken();
        token = res.token;
      }

      onTokenObtained?.();
      redirectToCliCallback(cliCallback.url, token, cliCallback.state);
    } catch {
      setError(t(($) => $.errors.cli_auth_failed));
      setExistingUser(null);
      setDirection(-1);
      setStep("email");
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    if (onGoogleLogin) {
      onGoogleLogin();
      return;
    }
    if (!google) return;
    const params = new URLSearchParams({
      client_id: google.clientId,
      redirect_uri: google.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "select_account",
    });
    if (google.state) params.set("state", google.state);
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  };

  // The field's own readout. Deliberately a shape test and not a validity
  // test: the only thing the browser can know before the request is whether
  // this looks like an address, and the readout is hidden from assistive tech
  // so nothing here claims the address exists.
  const emailLooksValid = /^\S+@\S+\.\S+$/.test(email);

  // -------------------------------------------------------------------------
  // CLI confirm step
  // -------------------------------------------------------------------------

  if (step === "cli_confirm" && existingUser) {
    return (
      <LoginShell
        stepKey="cli_confirm"
        railSteps={3}
        railActive={2}
        direction={direction}
      >
        <StepHeader
          logo={logo}
          title={t(($) => $.cli.title)}
          description={t(($) => $.cli.description, { email: existingUser.email })}
        />
        {/* The command that is asking, in its own frame: authorizing a terminal
            is the one step where "what exactly am I granting?" is a real
            question, and the command is the answer. */}
        <Reveal index={2}>
          <div className="flex items-center gap-3 rounded-lg border border-surface-border bg-app-shell/70 px-3 py-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
              <PromptGlyph />
            </span>
            <span className="font-mono text-label text-foreground">
              quickwork login
            </span>
          </div>
        </Reveal>
        <Reveal index={3}>
          <div className="flex flex-col gap-3">
            <Button
              onClick={handleCliAuthorize}
              disabled={loading}
              variant="brand"
              className={cn("login-cta w-full", loading && "login-cta-busy")}
            >
              {loading
                ? t(($) => $.cli.authorizing)
                : t(($) => $.cli.authorize)}
              {!loading && <ArrowGlyph />}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                setExistingUser(null);
                setDirection(-1);
                setStep("email");
              }}
            >
              {t(($) => $.cli.different_account)}
            </Button>
          </div>
        </Reveal>
        {error && <ErrorNotice message={error} />}
      </LoginShell>
    );
  }

  // -------------------------------------------------------------------------
  // Code verification step
  // -------------------------------------------------------------------------

  if (step === "code") {
    return (
      <LoginShell
        stepKey="code"
        railSteps={2}
        railActive={1}
        direction={direction}
      >
        <StepHeader
          logo={logo}
          title={t(($) => $.verify.title)}
          description={t(($) => $.verify.description, { email })}
        />
        <Reveal index={2}>
          <Field
            htmlFor="login-code"
            label={t(($) => $.verify.code_label)}
            readout={`${code.length} / ${CODE_LENGTH}`}
          >
            <div className="flex flex-col gap-3">
              <InputOTP
                id="login-code"
                ref={codeInputRef}
                autoFocus
                maxLength={CODE_LENGTH}
                value={code}
                onChange={(value) => {
                  setCode(value);
                  if (value.length === CODE_LENGTH) handleVerify(value);
                }}
                disabled={loading}
                containerClassName="w-full"
              >
                {/* Six digits in is the moment the user stops typing and starts
                    waiting, so the field says so: `login-form-otp-complete`
                    turns the cells green, holds a ring around them and draws a
                    rule under them while the code is verified. A rejection
                    replaces that with `login-form-otp-invalid` — red cells and
                    a shake. The two can never both apply, because a failed
                    verify clears the code in the same batch as it sets the
                    message. */}
                <InputOTPGroup
                  className={cn(
                    "login-otp flex w-full gap-2",
                    error && "login-form-otp-invalid",
                    !error &&
                      code.length === CODE_LENGTH &&
                      "login-form-otp-complete",
                  )}
                >
                  {Array.from({ length: CODE_LENGTH }, (_, index) => (
                    <InputOTPSlot
                      key={index}
                      index={index}
                      className="login-otp-cell text-title-lg"
                    />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              {error && <ErrorNotice message={error} />}
            </div>
          </Field>
        </Reveal>
        <Reveal index={3}>
          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={handleResend}
              disabled={cooldown > 0}
              className="self-start text-body font-medium text-primary underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:font-normal disabled:text-muted-foreground disabled:no-underline"
            >
              {cooldown > 0
                ? t(($) => $.verify.resend_cooldown, { seconds: cooldown })
                : t(($) => $.verify.resend)}
            </button>
            {/* The cooldown as a draining rule rather than a sentence alone:
                "resend in 42s" says when, the rule says how much of it is
                left, and it steps once a second so it is the timer's own
                motion rather than a decoration beside it. Quiet on purpose —
                it is a wait, not a task — and it belongs under the line it
                times, not above it. */}
            <span
              aria-hidden="true"
              className="relative block h-px w-full overflow-hidden bg-border"
            >
              <AnimatePresence initial={false}>
                {cooldown > 0 && (
                  <motion.span
                    key="cooldown"
                    className="absolute inset-x-0 top-0 h-px origin-left bg-brand/35"
                    initial={false}
                    animate={{ scaleX: cooldown / RESEND_SECONDS }}
                    exit={{ opacity: 0 }}
                    transition={{
                      duration: shouldReduceMotion ? 0 : 1,
                      ease: "linear",
                    }}
                  />
                )}
              </AnimatePresence>
            </span>
          </div>
        </Reveal>
        <Reveal index={4}>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              setDirection(-1);
              setStep("email");
              setCode("");
              setError("");
            }}
          >
            {t(($) => $.common.back)}
          </Button>
        </Reveal>
      </LoginShell>
    );
  }

  // -------------------------------------------------------------------------
  // Email step
  // -------------------------------------------------------------------------

  return (
    <LoginShell
      stepKey="email"
      railSteps={2}
      railActive={0}
      direction={direction}
    >
      <StepHeader
        logo={logo}
        title={t(($) => $.signin.title)}
        description={t(($) => $.signin.description)}
      />
      <form
        id="login-form"
        onSubmit={handleSendCode}
        className="flex flex-col gap-5"
      >
        <Reveal index={2}>
          <Field
            htmlFor="login-email"
            label={t(($) => $.common.email)}
            readout={
              emailLooksValid ? (
                <CheckGlyph className="size-3 text-success" />
              ) : null
            }
          >
            <div className="login-field">
              <Input
                id="login-email"
                type="email"
                placeholder={t(($) => $.common.email_placeholder)}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                required
                className="h-11 px-3.5"
              />
            </div>
          </Field>
        </Reveal>
        {error && <ErrorNotice message={error} />}
        <Reveal index={3}>
          <Button
            type="submit"
            variant="brand"
            className={cn("login-cta w-full", loading && "login-cta-busy")}
            disabled={!email || loading}
          >
            {loading
              ? t(($) => $.signin.sending)
              : t(($) => $.signin.continue)}
            {!loading && <ArrowGlyph />}
          </Button>
        </Reveal>
      </form>
      <div className="flex flex-col gap-5">
        {(google || onGoogleLogin) && (
          <Reveal index={4}>
            <div className="flex flex-col gap-5">
              <div className="flex items-center gap-3" aria-hidden="true">
                <span className="h-px flex-1 bg-border" />
                <span className="font-mono text-micro text-muted-foreground">
                  {t(($) => $.signin.or)}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <Button
                type="button"
                variant="outline"
                className="login-cta w-full"
                onClick={handleGoogleLogin}
                disabled={loading}
              >
                <GoogleGlyph />
                {t(($) => $.signin.google)}
              </Button>
            </div>
          </Reveal>
        )}
        {extra && <div className="text-center">{extra}</div>}
      </div>
    </LoginShell>
  );
}
