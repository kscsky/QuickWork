"use client";

import { useLocale } from "../i18n";

/** The 75-second product demo — real UI footage of the relay model, rendered with Remotion. */
export function LandingDemo() {
  const { t } = useLocale();

  return (
    <section className="border-b border-border bg-background">
      <div className="mx-auto max-w-[1220px] px-5 py-12 sm:px-6 lg:px-8 lg:py-16">
        <h2 className="text-title-lg font-semibold tracking-[-0.022em]">
          {t.demo.title}
        </h2>
        <p className="mt-2 max-w-[62ch] text-body text-muted-foreground">
          {t.demo.description}
        </p>
        <div className="mt-7 overflow-hidden rounded-lg border border-border bg-app-shell">
          <video
            className="block h-auto w-full"
            src="/videos/quickwork-demo.mp4"
            poster="/videos/quickwork-demo-poster.png"
            controls
            muted
            loop
            playsInline
            preload="metadata"
          />
        </div>
      </div>
    </section>
  );
}
