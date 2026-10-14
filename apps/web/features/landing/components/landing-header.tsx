"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { QuickWorkIcon } from "@quickwork/ui/components/common/quickwork-icon";
import { cn } from "@quickwork/ui/lib/utils";
import { useAuthStore } from "@quickwork/core/auth";
import { docsHrefForLocale, useLocale } from "../i18n";
import { useDashboardCtaHref } from "../utils/use-dashboard-cta";
import { formatStarCount, useGithubStars } from "../utils/use-github-stars";
import { GitHubMark, githubUrl, headerButtonClassName } from "./shared";

/**
 * Two variants, deliberately not sharing a container width:
 *  - `light` is the landing page's chrome — sticky, 56px, semantic tokens,
 *    brand-blue CTA. It sits on the light fold.
 *  - `dark` is the transparent bar that floats over the dark hero on the
 *    download and use-cases pages. Left as it was: those pages still have a
 *    dark hero, and re-styling them is a separate change.
 */
export function LandingHeader({
  variant = "dark",
}: {
  variant?: "dark" | "light";
}) {
  const { t, locale } = useLocale();
  const user = useAuthStore((s) => s.user);
  const stars = useGithubStars();
  const starsLabel = stars != null ? formatStarCount(stars) : null;
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const docsHref = docsHrefForLocale(locale);
  const navLinks = [
    { href: "/usecases", label: t.header.useCases },
    { href: docsHref, label: t.header.docs },
    { href: "/changelog", label: t.header.changelog },
  ];
  const ctaHref = useDashboardCtaHref();
  const ctaLabel = user ? t.header.dashboard : t.header.cta;
  const isLight = variant === "light";

  return (
    <header
      className={cn(
        "inset-x-0 top-0 z-30",
        isLight
          ? "sticky border-b border-border bg-background/86 backdrop-blur-md backdrop-saturate-150"
          : "absolute bg-transparent",
      )}
    >
      <div
        className={cn(
          "mx-auto flex items-center justify-between",
          isLight
            ? "h-14 max-w-[1220px] gap-8 px-5 sm:px-6 lg:px-8"
            : "h-[76px] max-w-[1320px] px-4 sm:px-6 lg:px-8",
        )}
      >
        <div className="flex min-w-0 items-center gap-6 lg:gap-8">
          <Link
            href="/"
            className={cn(
              "flex shrink-0 items-center",
              isLight ? "gap-2.5" : "gap-3",
            )}
          >
            <QuickWorkIcon
              className={cn(
                "size-5",
                isLight ? "text-brand" : "text-white",
              )}
              noSpin
            />
            <span
              className={cn(
                "lowercase",
                isLight
                  ? "text-title-sm font-semibold tracking-[-0.015em] text-foreground"
                  : "text-title font-semibold tracking-[0.04em] text-white/92 sm:text-title-lg",
              )}
            >
              quickwork
            </span>
          </Link>

          <nav
            aria-label={t.header.navigation}
            className={cn(
              "hidden items-center md:flex",
              isLight ? "gap-5" : "gap-1",
            )}
          >
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={navLinkClassName(variant)}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
          <button
            type="button"
            aria-label={isMenuOpen ? t.header.closeMenu : t.header.openMenu}
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen((open) => !open)}
            className={cn(headerBtn("ghost", variant), "px-3 md:hidden")}
          >
            {isMenuOpen ? (
              <X className="size-4" aria-hidden />
            ) : (
              <Menu className="size-4" aria-hidden />
            )}
          </button>
          <Link
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className={cn(headerBtn("ghost", variant), "hidden lg:inline-flex")}
          >
            <GitHubMark className="size-3.5" />
            {t.header.github}
            {starsLabel ? <GitHubStarsBadge label={starsLabel} /> : null}
          </Link>
          <Link href={ctaHref} className={headerBtn("solid", variant)}>
            {ctaLabel}
          </Link>
        </div>
      </div>

      {isMenuOpen ? (
        <div
          className={cn(
            "absolute left-4 right-4 top-[calc(100%+8px)] z-50 rounded-[14px] border p-2 shadow-[0_18px_60px_rgba(0,0,0,0.18)] backdrop-blur-xl md:hidden",
            variant === "dark"
              ? "border-white/14 bg-[#070a10]/95 text-white"
              : "border-border bg-card text-foreground",
          )}
        >
          <nav aria-label={t.header.navigation} className="flex flex-col">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsMenuOpen(false)}
                className={mobileNavLinkClassName(variant)}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div
            className={cn(
              "mt-2 border-t pt-2",
              variant === "dark" ? "border-white/10" : "border-border",
            )}
          >
            <Link
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => setIsMenuOpen(false)}
              className={mobileNavLinkClassName(variant)}
            >
              <GitHubMark className="size-3.5" />
              {t.header.github}
              {starsLabel ? <GitHubStarsBadge label={starsLabel} /> : null}
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}

/** Star-count segment appended to the header's GitHub button — a faint
 *  divider and the compact count (e.g. "37.6k"). No star glyph: in the GitHub
 *  button context the number reads as the star count on its own. Inherits the
 *  button's text color so it adapts to both the dark and light header
 *  variants. */
function GitHubStarsBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      <span aria-hidden className="h-3 w-px bg-current opacity-25" />
      {label}
    </span>
  );
}

/**
 * The shared helper's `light` branch still paints hardcoded ink for the older
 * marketing pages. The landing's chrome is token-driven, so it gets its own
 * pair here rather than a change that would repaint those pages too.
 */
function headerBtn(tone: "ghost" | "solid", variant: "dark" | "light") {
  if (variant === "dark") return headerButtonClassName(tone, "dark");
  return cn(
    "inline-flex h-9 items-center justify-center gap-2 rounded-lg text-body font-medium transition-colors",
    tone === "solid"
      ? "bg-brand px-4 text-brand-foreground hover:bg-brand/88"
      : "border border-input bg-card px-3 text-foreground hover:bg-accent",
  );
}

function navLinkClassName(variant: "dark" | "light") {
  return cn(
    "inline-flex items-center transition-colors",
    variant === "dark"
      ? "h-9 rounded-[9px] px-3 text-label font-medium text-white/72 hover:bg-white/8 hover:text-white"
      : "text-body text-muted-foreground hover:text-foreground",
  );
}

function mobileNavLinkClassName(variant: "dark" | "light") {
  return cn(
    "flex min-h-11 items-center gap-2 rounded-[10px] px-3 text-body font-medium transition-colors",
    variant === "dark"
      ? "text-white/76 hover:bg-white/8 hover:text-white"
      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
  );
}
