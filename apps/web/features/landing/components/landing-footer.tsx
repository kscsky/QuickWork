"use client";

import Link from "next/link";
import { QuickWorkIcon } from "@quickwork/ui/components/common/quickwork-icon";
import { cn } from "@quickwork/ui/lib/utils";
import { GitHubMark, githubUrl } from "./shared";
import { docsHrefForLocale, useLocale, locales, localeLabels } from "../i18n";

/**
 * Slim footer: wordmark and copyright on the left, destinations on the right.
 *
 * Only real destinations appear. The old footer also linked to the in-page
 * anchors `#features`, `#how-it-works` and `#open-source`; those sections are
 * no longer composed, so those links are gone rather than left pointing at
 * nothing.
 *
 * The locale switcher stays: it is the landing page's only way to change
 * language, and the header does not carry one.
 */
export function LandingFooter() {
  const { t, locale, setLocale } = useLocale();
  const links = [
    { href: docsHrefForLocale(locale), label: t.header.docs },
    { href: "/changelog", label: t.header.changelog },
    { href: "/download", label: t.footer.download },
  ];

  return (
    <footer className="bg-background">
      <div className="mx-auto flex max-w-[1220px] flex-col gap-4 px-5 py-7 sm:px-6 lg:flex-row lg:items-center lg:gap-6 lg:px-8">
        <span className="inline-flex shrink-0 items-center gap-2.5 text-label font-semibold tracking-[-0.015em]">
          <QuickWorkIcon className="size-4 text-brand" noSpin />
          <span className="lowercase">quickwork</span>
        </span>

        <span className="text-caption text-faint-foreground">
          {t.footer.copyright.replace("{year}", String(new Date().getFullYear()))}
        </span>

        <span className="hidden flex-1 lg:block" />

        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-label text-muted-foreground">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
          >
            <GitHubMark className="size-3.5" />
            GitHub
          </a>
        </nav>

        <span className="flex items-center lg:ml-4">
          {locales.map((candidate, index) => (
            <button
              type="button"
              key={candidate}
              onClick={() => setLocale(candidate)}
              className={cn(
                "px-1.5 py-1 text-caption font-medium transition-colors",
                candidate === locale
                  ? "text-foreground"
                  : "text-faint-foreground hover:text-muted-foreground",
                index > 0 && "border-l border-border",
              )}
            >
              {localeLabels[candidate]}
            </button>
          ))}
        </span>
      </div>
    </footer>
  );
}
