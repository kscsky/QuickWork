"use client";

import Link from "next/link";
import { ArrowRight, Download } from "lucide-react";
import { useAuthStore } from "@quickwork/core/auth";
import { cn } from "@quickwork/ui/lib/utils";
import { useLocale } from "../i18n";
import { useDashboardCtaHref } from "../utils/use-dashboard-cta";
import {
  ClaudeCodeLogo,
  CodexLogo,
  GeminiCliLogo,
  OpenClawLogo,
  OpenCodeLogo,
} from "./shared";

/**
 * The fold is light and left-aligned: the argument on the left, the product's
 * own dispatch surface on the right. The panel is built from the real
 * orchestration UI rather than a screenshot, so it stays sharp at any zoom and
 * never goes stale against a redesign.
 */
export function LandingHero() {
  const { t } = useLocale();
  const user = useAuthStore((s) => s.user);
  const ctaHref = useDashboardCtaHref();

  return (
    <section className="border-b border-border bg-gradient-to-b from-app-shell to-background">
      <div className="mx-auto grid max-w-[1220px] grid-cols-1 items-center gap-12 px-5 py-16 sm:px-6 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,1fr)] lg:gap-16 lg:px-8 lg:py-[72px]">
        <div className="min-w-0">
          <div className="mb-5 flex items-center gap-2.5 font-mono text-micro uppercase tracking-[0.11em] text-brand">
            <span aria-hidden className="h-px w-[22px] bg-brand" />
            {t.hero.overline}
          </div>

          <h1 className="max-w-[15ch] text-[clamp(2.5rem,3.9vw,3.5rem)] font-semibold leading-[1.06] tracking-[-0.032em]">
            {t.hero.headlineLine1}
            <br />
            {t.hero.headlineLine2} <em className="not-italic text-brand">{t.hero.headlineAccent}</em>
          </h1>

          <p className="mt-5 max-w-[46ch] text-body-lg leading-[1.6] text-muted-foreground">
            {t.hero.subheading}
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-2.5">
            <Link href={ctaHref} className={ctaClassName("solid")}>
              {user ? t.header.dashboard : t.hero.cta}
            </Link>
            <Link href="/download" className={ctaClassName("outline")}>
              <Download className="size-4" aria-hidden />
              {t.hero.downloadDesktop}
            </Link>
            <Link
              href="/contact-sales"
              className="group inline-flex items-center gap-1.5 px-2 py-2 text-body font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {t.hero.talkToSales}
              <ArrowRight
                className="size-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </div>

          <div className="mt-9 flex flex-wrap items-center gap-x-3.5 gap-y-3">
            <span className="font-mono text-micro uppercase tracking-[0.08em] text-faint-foreground">
              {t.hero.runtimesLabel}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <RuntimeChip icon={<ClaudeCodeLogo className="size-3.5" />} label="Claude Code" />
              <RuntimeChip icon={<CodexLogo className="size-3.5" />} label="Codex" />
              <RuntimeChip icon={<GeminiCliLogo className="size-3.5" />} label="Gemini CLI" />
              <RuntimeChip icon={<OpenClawLogo className="size-3.5" />} label="OpenClaw" />
              <RuntimeChip icon={<OpenCodeLogo className="size-3.5" />} label="OpenCode" />
            </div>
          </div>
        </div>

        <OrchestrationPanel />
      </div>
    </section>
  );
}

function RuntimeChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex h-[26px] items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-caption text-muted-foreground">
      <span aria-hidden className="flex size-3.5 items-center justify-center">
        {icon}
      </span>
      {label}
    </span>
  );
}

const DEMO_ROWS = [
  { key: "KSK-412", status: "done" as const },
  { key: "KSK-413", status: "working" as const },
  { key: "KSK-414", status: "blocked" as const },
];

/**
 * Status pills stay lowercase English in every locale — issue statuses are
 * schema-level vocabulary, not page copy (i18n glossary, conventions.mdx).
 * Agent handles in the actor column are names and never translate either; only
 * the squad in row 01 comes from the dictionary.
 */
function OrchestrationPanel() {
  const { t } = useLocale();
  const { panel } = t.hero;

  return (
    <div className="min-w-0 overflow-hidden rounded-[0.6rem] border border-input bg-card shadow-(--floating-shadow)">
      <div className="flex h-10 items-center gap-2 border-b border-border bg-app-shell px-3">
        <span aria-hidden className="flex flex-col gap-0.5">
          <span className="block h-[3px] w-2 rounded-[1px] bg-zone-1" />
          <span className="block h-[3px] w-2 rounded-[1px] bg-zone-2" />
          <span className="block h-[3px] w-2 rounded-[1px] bg-zone-3" />
        </span>
        <span className="truncate text-label font-medium">{panel.title}</span>
        <span className="flex-1" />
        <span className="flex items-center gap-0.5 text-caption text-muted-foreground">
          {panel.tabs.map((tab, index) => (
            <span
              key={tab}
              className={cn(
                "rounded-sm px-2 py-0.5",
                index === 0 && "bg-card text-foreground shadow-[0_0_0_1px_var(--border)]",
              )}
            >
              {tab}
            </span>
          ))}
        </span>
      </div>

      <div className="border-b border-border px-3.5 pb-3 pt-3.5">
        <div className="flex items-center gap-2 text-label text-muted-foreground">
          <span aria-hidden className="size-[18px] shrink-0 rounded-lg bg-zone-1" />
          <span className="truncate text-foreground">{panel.squad}</span>
          <span className="text-faint-foreground">·</span>
          <span className="shrink-0 text-faint-foreground">{panel.members}</span>
        </div>

        <p className="mt-3 min-h-11 border-l-2 border-brand pl-3 text-body">
          {panel.prompt}
          <span aria-hidden className="ml-0.5 inline-block h-[15px] w-px translate-y-[2px] bg-brand" />
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={ctaClassName("solid", "sm")}>{panel.submit}</span>
          <span className="hidden text-micro text-faint-foreground sm:inline">{panel.hint}</span>
        </div>
      </div>

      <ul className="list-none">
        {DEMO_ROWS.map((row, index) => (
          <li
            key={row.key}
            className="grid grid-cols-[26px_58px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-border px-3.5 py-2.5 text-label last:border-b-0"
          >
            <span className="font-mono text-micro text-faint-foreground">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="font-mono text-micro text-muted-foreground">{row.key}</span>
            <span className="truncate">{panel.rows[index]}</span>
            <StatusPill status={row.status} />
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2.5 border-t border-border bg-app-shell px-3.5 py-2.5 font-mono text-micro text-faint-foreground">
        <span className="truncate">{panel.footerIssues}</span>
        <span className="flex-1" />
        <span className="shrink-0">{panel.footerDaemon}</span>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: "done" | "working" | "blocked" }) {
  return (
    <span
      className={cn(
        "rounded-sm px-1.5 py-0.5 font-mono text-micro tracking-[0.02em]",
        status === "working" && "bg-brand/12 text-brand",
        status === "done" && "bg-success/14 text-success",
        status === "blocked" && "bg-warning/20 text-warning",
      )}
    >
      {status}
    </span>
  );
}

function ctaClassName(tone: "solid" | "outline", size: "md" | "sm" = "md") {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors",
    size === "md" ? "h-[38px] px-4 text-body" : "h-7 px-3 text-label",
    tone === "solid"
      ? "bg-brand text-brand-foreground hover:bg-brand/88"
      : "border border-input bg-card text-foreground hover:bg-accent",
  );
}
