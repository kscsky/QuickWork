"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { motion, useReducedMotion } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CardTitle,
  CardDescription,
} from "@quickwork/ui/components/ui/card";
import { Input } from "@quickwork/ui/components/ui/input";
import { Button } from "@quickwork/ui/components/ui/button";
import { Label } from "@quickwork/ui/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@quickwork/ui/components/ui/input-otp";
import { UI_EASE_OUT } from "@quickwork/ui/lib/motion";
import { useAuthStore } from "@quickwork/core/auth";
import { workspaceKeys } from "@quickwork/core/workspace/queries";
import { api } from "@quickwork/core/api";
import type { User } from "@quickwork/core/types";
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

/**
 * Rail art for the sign-in panel: one rail per zone, each carrying a few task
 * blocks. It is the product's own model drawn with the product's own tokens —
 * work sitting on rails, tinted by the zone that owns it — rather than a stock
 * illustration. The layout is a literal rather than generated so the backdrop
 * is byte-stable across renders and does not reshuffle when the window resizes.
 */
const ZONE_DOT = [
  "bg-zone-1",
  "bg-zone-2",
  "bg-zone-3",
  "bg-zone-4",
  "bg-zone-5",
  "bg-zone-6",
  "bg-zone-7",
  "bg-zone-8",
] as const;

/**
 * Rail art for the sign-in panel: one rail per zone, each carrying a few task
 * blocks. It is the product's own model drawn with the product's own tokens —
 * work sitting on rails, tinted by the zone that owns it — rather than a stock
 * illustration.
 *
 * Every block drifts toward the panel edge and dissolves, then comes back. The
 * durations and offsets are literals, not generated: the backdrop must not
 * reshuffle when the window resizes, and the rails must not fall into lockstep,
 * because zones do not process at the same rate. `base.css` owns the keyframes
 * and the reduced-motion opt-out.
 */
const RAILS: readonly {
  lead: number;
  duration: number;
  offset: number;
  blocks: readonly number[];
}[] = [
  { lead: 0, duration: 21, offset: 0, blocks: [168, 112, 64] },
  { lead: 92, duration: 29, offset: 5.5, blocks: [132, 184] },
  { lead: 36, duration: 24, offset: 11, blocks: [88, 156, 96] },
  { lead: 148, duration: 33, offset: 2.5, blocks: [196, 84] },
  { lead: 64, duration: 26, offset: 8, blocks: [112, 56, 128] },
  { lead: 12, duration: 31, offset: 14, blocks: [144, 96, 172] },
  { lead: 108, duration: 22, offset: 3.5, blocks: [76, 132] },
];

/** Seconds between successive blocks on one rail, so a rail never blinks all at once. */
const RAIL_BLOCK_STAGGER = 3.4;

function RailArt() {
  return (
    <div className="-mr-14 flex flex-col gap-4" aria-hidden="true">
      {RAILS.map((rail, i) => (
        <div key={i} className="flex items-center gap-3">
          <span
            className={`size-1.5 shrink-0 rounded-full ${ZONE_DOT[i % ZONE_DOT.length]}`}
          />
          <div className="flex items-center gap-2.5" style={{ marginLeft: rail.lead }}>
            {rail.blocks.map((width, j) => (
              <span
                key={j}
                className="animate-rail-drift h-[5px] shrink-0 rounded-full bg-muted-foreground/25"
                style={
                  {
                    width,
                    "--rail-duration": `${rail.duration}s`,
                    "--rail-delay": `${(rail.offset + j * RAIL_BLOCK_STAGGER).toFixed(1)}s`,
                    "--rail-drift": "16px",
                  } as CSSProperties
                }
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Sign-in chrome. The identity panel is the desktop half of the page and is
 * deliberately absent on a phone: at that width the form is the entire job, and
 * a decorative half-screen would only push the field below the fold.
 *
 * The form is deliberately NOT wrapped in a card. A bordered box floating in a
 * column says nothing about the product, and the identity panel already carries
 * the page's visual weight — the form only has to be quiet and legible.
 */
function LoginShell({ children }: { children: React.ReactNode }) {
  const { t } = useT("auth");
  const shouldReduceMotion = useReducedMotion() ?? false;

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

          <RailArt />
        </div>

        <div aria-hidden="true" />
      </aside>

      <main className="flex items-center justify-center px-6 py-12">
        <motion.div
          initial={shouldReduceMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [...UI_EASE_OUT] }}
          className="flex w-full max-w-[25rem] flex-col gap-7"
        >
          {children}
        </motion.div>
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
  const qc = useQueryClient();
  const [step, setStep] = useState<"email" | "code" | "cli_confirm">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [existingUser, setExistingUser] = useState<User | null>(null);
  // Tracks how the existing session was detected so handleCliAuthorize
  // uses the matching token source (cookie → issueCliToken, localStorage → direct).
  const authSourceRef = useRef<"cookie" | "localStorage">("cookie");

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
          err instanceof Error
            ? err.message
            : t(($) => $.errors.code_invalid),
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

  // -------------------------------------------------------------------------
  // CLI confirm step
  // -------------------------------------------------------------------------

  if (step === "cli_confirm" && existingUser) {
    return (
      <LoginShell>
          <div className="flex flex-col items-center gap-1.5 text-center">
            {logo && <div className="mx-auto mb-4">{logo}</div>}
            <CardTitle className="text-display-sm">
              {t(($) => $.cli.title)}
            </CardTitle>
            <CardDescription>
              {t(($) => $.cli.description, { email: existingUser.email })}
            </CardDescription>
          </div>
          <div className="flex flex-col gap-3">
            <Button
              onClick={handleCliAuthorize}
              disabled={loading}
              className="w-full"
              size="lg"
            >
              {loading
                ? t(($) => $.cli.authorizing)
                : t(($) => $.cli.authorize)}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                setExistingUser(null);
                setStep("email");
              }}
            >
              {t(($) => $.cli.different_account)}
            </Button>
          </div>
      </LoginShell>
    );
  }

  // -------------------------------------------------------------------------
  // Code verification step
  // -------------------------------------------------------------------------

  if (step === "code") {
    return (
      <LoginShell>
          <div className="flex flex-col items-center gap-1.5 text-center">
            {logo && <div className="mx-auto mb-4">{logo}</div>}
            <CardTitle className="text-display-sm">
              {t(($) => $.verify.title)}
            </CardTitle>
            <CardDescription>
              {t(($) => $.verify.description, { email })}
            </CardDescription>
          </div>
          <div className="flex flex-col items-center gap-4">
            <InputOTP
              autoFocus
              maxLength={6}
              value={code}
              onChange={(value) => {
                setCode(value);
                if (value.length === 6) handleVerify(value);
              }}
              disabled={loading}
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
            {error && (
              <p className="text-body text-destructive">{error}</p>
            )}
            <div className="flex items-center gap-2 text-body text-muted-foreground">
              <button
                type="button"
                onClick={handleResend}
                disabled={cooldown > 0}
                className="text-primary underline-offset-4 hover:underline disabled:text-muted-foreground disabled:no-underline disabled:cursor-not-allowed"
              >
                {cooldown > 0
                  ? t(($) => $.verify.resend_cooldown, { seconds: cooldown })
                  : t(($) => $.verify.resend)}
              </button>
            </div>
          </div>
          <div>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setStep("email");
                setCode("");
                setError("");
              }}
            >
              {t(($) => $.common.back)}
            </Button>
          </div>
      </LoginShell>
    );
  }

  // -------------------------------------------------------------------------
  // Email step
  // -------------------------------------------------------------------------

  return (
    <LoginShell>
        <div className="flex flex-col items-center gap-1.5 text-center">
          {logo && <div className="mx-auto mb-4">{logo}</div>}
          <CardTitle className="text-display-sm">
            {t(($) => $.signin.title)}
          </CardTitle>
          <CardDescription>
            {t(($) => $.signin.description)}
          </CardDescription>
        </div>
        <div>
          <form id="login-form" onSubmit={handleSendCode} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="login-email">{t(($) => $.common.email)}</Label>
              <Input
                id="login-email"
                type="email"
                placeholder={t(($) => $.common.email_placeholder)}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                required
              />
            </div>
            {error && (
              <p className="text-body text-destructive">{error}</p>
            )}
          </form>
        </div>
        <div className="flex flex-col gap-3">
          <Button
            type="submit"
            form="login-form"
            className="w-full"
            size="lg"
            disabled={!email || loading}
          >
            {loading
              ? t(($) => $.signin.sending)
              : t(($) => $.signin.continue)}
          </Button>
          {(google || onGoogleLogin) && (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              size="lg"
              onClick={handleGoogleLogin}
              disabled={loading}
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
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
              {t(($) => $.signin.google)}
            </Button>
          )}
          {extra && <div className="w-full pt-1 text-center">{extra}</div>}
        </div>
    </LoginShell>
  );
}
