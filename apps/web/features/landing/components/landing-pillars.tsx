"use client";

import { useLocale } from "../i18n";

/**
 * Three numbered cells in one hairline grid. The left border lives on the
 * container and the right border on each cell, so the block reads as a single
 * ruled panel rather than three floating cards.
 */
export function LandingPillars() {
  const { t } = useLocale();

  return (
    <section className="border-b border-border">
      <div className="mx-auto grid max-w-[1220px] grid-cols-1 border-border sm:grid-cols-2 lg:grid-cols-3 lg:border-l lg:border-r">
        {t.pillars.items.map((item, index) => (
          <div
            key={item.title}
            className="border-b border-border px-6 py-[34px] last:border-b-0 sm:border-r sm:last:border-r-0 lg:border-b-0"
          >
            <div className="font-mono text-micro tracking-[0.08em] text-faint-foreground">
              {String(index + 1).padStart(2, "0")}
            </div>
            <h3 className="mt-3.5 text-title-sm font-semibold tracking-[-0.01em]">
              {item.title}
            </h3>
            <p className="mt-2.5 text-body leading-[1.6] text-muted-foreground">
              {item.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
