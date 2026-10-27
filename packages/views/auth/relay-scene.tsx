"use client";

import type { CSSProperties } from "react";
import { FileText, Lock, Package, Users } from "lucide-react";
import { cn } from "@quickwork/ui/lib/utils";
import { useT } from "../i18n";

/**
 * The identity panel's backdrop: the relay the product actually runs.
 *
 * Three legs and one loop, in the visitor's own seat: 我 runs a leg with an
 * agent, approves it, and the handoff package flies to 王磊; his leg runs and
 * hands to 陈静 — who has bound no agent, so the task parks on her step until
 * someone acts. That last beat is the point: parking is the product's honest
 * answer to a missing agent, not an error.
 *
 * The whole scene is decorative and lives under `aria-hidden`. The timeline is
 * CSS (`login-relay-*` in base.css, one 13s cycle); the node states, the flying
 * package, the baton spark and the parked note are keyframed windows over that
 * cycle, so nothing here costs a render. A reader who prefers reduced motion
 * gets the resting frame — leg one running — via the shared opt-out in
 * base.css.
 *
 * Person names are product nouns, not copy — untranslated, like the agent
 * names this scene replaced.
 */

const OTHER_NAMES = ["王磊", "陈静"] as const;

const TONES: Record<string, string> = {
  done: "bg-success/15 text-success",
  busy: "bg-inflight-surface text-inflight",
  review: "bg-brand/10 text-brand",
  wait: "bg-muted text-muted-foreground",
  park: "bg-warning/20 text-warning",
};

/** One node's stacked state chips; the cycle decides which one shows when. */
function NodeChips({
  chips,
  labels,
}: {
  chips: Array<{ key: string; cls: string }>;
  labels: Record<string, string>;
}) {
  return (
    <>
      {chips.map(({ key, cls }) => (
        <span
          key={cls}
          className={cn(
            "login-relay-chip absolute left-1/2 -translate-x-1/2 rounded-[3px] px-1.5 py-px font-mono text-micro whitespace-nowrap",
            cls,
            TONES[key],
          )}
        >
          {labels[key]}
        </span>
      ))}
    </>
  );
}

function Node({
  initial,
  name,
  tone,
  halo,
  bar,
  chips,
  labels,
}: {
  initial: string;
  name: string;
  tone: string;
  halo: string;
  bar?: string;
  chips: Array<{ key: string; cls: string }>;
  labels: Record<string, string>;
}) {
  return (
    <div className="relative flex flex-col items-center gap-[7px]">
      <span className="relative grid size-[34px] place-items-center">
        <span
          className={cn(
            "grid size-[34px] place-items-center rounded-md font-mono text-micro text-white",
            "shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_20%,transparent)]",
            tone,
          )}
        >
          {initial}
        </span>
        <span
          className={cn(
            "login-relay-halo pointer-events-none absolute -inset-[3px] rounded-[9px]",
            halo,
          )}
        />
      </span>
      <span className="text-caption font-medium">{name}</span>
      <span className="relative block h-[18px] w-full">
        <NodeChips chips={chips} labels={labels} />
      </span>
      {bar ? (
        <span
          className={cn(
            "login-relay-bar h-1 w-[78px] overflow-hidden rounded-full bg-muted opacity-0",
            bar,
          )}
        >
          <i className="block h-full w-0 bg-inflight" />
        </span>
      ) : null}
    </div>
  );
}

export function RelayScene() {
  const { t } = useT("auth");
  const [wang, chen] = OTHER_NAMES;
  const labels: Record<string, string> = {
    done: t(($) => $.signin.relay.state_done),
    busy: t(($) => $.signin.relay.state_busy),
    review: t(($) => $.signin.relay.state_review),
    wait: t(($) => $.signin.relay.state_wait),
    park: t(($) => $.signin.relay.state_parked),
  };
  return (
    <div aria-hidden="true" className="login-relay flex flex-col gap-3.5">
      <div className="overflow-hidden rounded-lg border border-surface-border bg-surface shadow-[var(--shadow-surface)]">
        <header className="flex items-center gap-2 border-b border-border bg-muted/45 px-3.5 py-2 text-caption">
          <span className="font-mono text-micro text-brand">KSCS-7</span>
          <span className="font-semibold">{t(($) => $.signin.relay.task_title)}</span>
          <span className="flex-1" />
          <span className="relative inline-block h-4 w-16">
            {[1, 2, 3].map((n) => (
              <span
                key={n}
                className={cn(
                  "login-relay-leg absolute right-0 top-1/2 -translate-y-1/2 rounded-[3px] bg-brand/10 px-1.5 py-px font-mono text-micro whitespace-nowrap text-brand",
                  `login-relay-leg-${n}`,
                )}
              >
                {t(($) => $.signin.relay.leg_chip, { seq: n, total: 3 })}
              </span>
            ))}
          </span>
        </header>

        <div className="relative px-[26px] pt-6 pb-[18px]">
          <span className="login-relay-track absolute left-[46px] right-[46px] top-[42px] h-0.5" />
          <span className="login-relay-trackdone absolute left-[46px] top-[42px] h-0.5" />
          <span className="login-relay-spark absolute top-[38px] size-2.5 rounded-full bg-inflight" />
          {/* No translate utility on purpose: the flash's keyframes own the
              whole transform, so the centring translate lives there too. */}
          <span className="login-relay-flash absolute left-[16.6%] top-6 size-[34px] rounded-[9px] border-2 border-success/80" />
          <span className="login-relay-sparks absolute left-[16.6%] top-[41px]">
            {[
              ["-26px", "-18px"],
              ["24px", "-22px"],
              ["30px", "12px"],
            ].map(([dx, dy]) => (
              <i
                key={dx}
                className="login-relay-sparkdot absolute size-1 rounded-full bg-success"
                style={{ "--dx": dx, "--dy": dy } as CSSProperties}
              />
            ))}
          </span>
          <span className="login-relay-pkg absolute top-1.5 inline-flex items-center gap-1.5 rounded-[4px] border border-border bg-surface px-2 py-0.5 font-mono text-micro text-muted-foreground">
            <Package className="size-3" />
            {t(($) => $.signin.relay.pkg)}
          </span>

          <div className="relative grid grid-cols-3">
            <Node
              initial="我"
              name={t(($) => $.signin.relay.me)}
              tone="bg-primary"
              halo="login-relay-ha"
              bar="login-relay-ba"
              chips={[
                { key: "busy", cls: "login-relay-c1a" },
                { key: "review", cls: "login-relay-c1b" },
                { key: "done", cls: "login-relay-c1c" },
              ]}
              labels={labels}
            />
            <Node
              initial={wang.slice(0, 1)}
              name={wang}
              tone="bg-[oklch(0.6_0.14_200)]"
              halo="login-relay-hb"
              bar="login-relay-bb"
              chips={[
                { key: "wait", cls: "login-relay-c2a" },
                { key: "busy", cls: "login-relay-c2b" },
                { key: "review", cls: "login-relay-c2c" },
                { key: "done", cls: "login-relay-c2d" },
              ]}
              labels={labels}
            />
            <Node
              initial={chen.slice(0, 1)}
              name={chen}
              tone="bg-[oklch(0.62_0.16_40)]"
              halo="login-relay-hc"
              chips={[
                { key: "wait", cls: "login-relay-c3a" },
                { key: "park", cls: "login-relay-c3b" },
              ]}
              labels={labels}
            />
          </div>

          <div className="login-relay-note mt-3.5 flex items-center gap-1.5 text-micro text-[color-mix(in_oklab,var(--warning)_60%,var(--foreground))]">
            <Users className="size-3.5" />
            {t(($) => $.signin.relay.park_note, { name: chen })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-md border border-surface-border bg-surface px-3 py-2.5 shadow-[var(--shadow-surface)]">
          <div className="flex items-center gap-1.5 text-micro font-semibold">
            <FileText className="size-3" />
            {t(($) => $.signin.relay.ctx_title)}
            <span className="ml-auto rounded-[3px] bg-muted px-1.5 py-px font-normal text-muted-foreground">
              {t(($) => $.signin.relay.ctx_chip)}
            </span>
          </div>
          <div className="mt-1 text-micro leading-[18px] text-muted-foreground">
            {t(($) => $.signin.relay.ctx_line)}
          </div>
        </div>
        <div className="rounded-md border border-surface-border bg-surface px-3 py-2.5 shadow-[var(--shadow-surface)]">
          <div className="flex items-center gap-1.5 text-micro font-semibold">
            <Lock className="size-3" />
            {t(($) => $.signin.relay.res_title)}
            <span className="ml-auto rounded-[3px] bg-muted px-1.5 py-px font-normal text-muted-foreground">
              {t(($) => $.signin.relay.res_chip)}
            </span>
          </div>
          <div className="mt-1 text-micro leading-[18px] text-muted-foreground">
            {t(($) => $.signin.relay.res_line)}
          </div>
        </div>
      </div>
    </div>
  );
}
