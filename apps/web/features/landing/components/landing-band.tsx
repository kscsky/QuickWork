"use client";

import Link from "next/link";
import { useAuthStore } from "@quickwork/core/auth";
import { useLocale } from "../i18n";
import { useDashboardCtaHref } from "../utils/use-dashboard-cta";

/** Full-width call to action on the shell colour — the page's only repeat of
 *  the hero's primary action. */
export function LandingBand() {
  const { t } = useLocale();
  const user = useAuthStore((s) => s.user);
  const ctaHref = useDashboardCtaHref();

  return (
    <section className="border-b border-border bg-app-shell">
      <div className="mx-auto flex max-w-[1220px] flex-col items-start gap-7 px-5 py-[46px] sm:px-6 lg:flex-row lg:items-center lg:px-8">
        <div className="min-w-0">
          <h2 className="max-w-[22ch] text-title-lg font-semibold tracking-[-0.022em]">
            {t.band.title}
          </h2>
          <p className="mt-2 max-w-[52ch] text-body text-muted-foreground">
            {t.band.description}
          </p>
        </div>
        <span className="flex-1" />
        <Link
          href={ctaHref}
          className="inline-flex h-[38px] shrink-0 items-center justify-center rounded-lg bg-brand px-4 text-body font-medium text-brand-foreground transition-colors hover:bg-brand/88"
        >
          {user ? t.header.dashboard : t.band.cta}
        </Link>
      </div>
    </section>
  );
}
