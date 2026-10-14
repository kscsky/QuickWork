import type { SupportedLocale } from "@quickwork/core/i18n";
export { docsHrefForLocale } from "@/lib/docs-href";

export type Locale = SupportedLocale;
export type LandingDictionaryLocale = "en" | "zh" | "ko" | "ja";

export const locales: Locale[] = ["en", "zh-Hans", "ko", "ja"];

export const localeLabels: Record<Locale, string> = {
  en: "EN",
  "zh-Hans": "\u4e2d\u6587",
  ko: "\ud55c\uad6d\uc5b4",
  ja: "\u65e5\u672c\u8a9e",
};

export function toLandingDictionaryLocale(
  locale: Locale,
): LandingDictionaryLocale {
  if (locale === "ko") return "ko";
  if (locale === "ja") return "ja";
  return locale === "zh-Hans" ? "zh" : "en";
}

export function isZhLocale(locale: Locale): boolean {
  return locale === "zh-Hans";
}

export type ContactSalesOption = { value: string; label: string };

export type LandingDict = {
  header: {
    github: string;
    cta: string;
    dashboard: string;
    docs: string;
    changelog: string;
    useCases: string;
    navigation: string;
    openMenu: string;
    closeMenu: string;
  };
  hero: {
    overline: string;
    /** Three parts so the last word can carry the brand colour: the heading
     *  renders as `line1 <br> line2 <em>accent</em>`. Keep whole words in
     *  `accent` — a locale that cannot split the sentence that way should
     *  still read naturally with it at the end. */
    headlineLine1: string;
    headlineLine2: string;
    headlineAccent: string;
    subheading: string;
    cta: string;
    ctaDocs: string;
    downloadDesktop: string;
    talkToSales: string;
    runtimesLabel: string;
    /** Copy for the orchestration panel the hero renders instead of a product
     *  screenshot. The panel's status pills are deliberately NOT part of this
     *  dictionary — issue statuses stay lowercase English in every locale, per
     *  the i18n glossary in apps/docs/content/docs/developers/conventions.mdx.
     *  `actors` is mixed on purpose: the first row is the squad (localised),
     *  the rest are agent handles, which are names and never translate. */
    panel: {
      title: string;
      tabs: string[];
      squad: string;
      members: string;
      prompt: string;
      submit: string;
      hint: string;
      rows: string[];
      actors: string[];
      footerIssues: string;
      footerDaemon: string;
    };
  };
  /** The three numbered cells under the fold. */
  pillars: {
    items: { title: string; description: string }[];
  };
  band: {
    title: string;
    description: string;
    cta: string;
  };
  footer: {
    /** Footer-only label. The docs and changelog links reuse `header.docs` /
     *  `header.changelog` rather than duplicating the same word here. */
    download: string;
    copyright: string;
  };
  about: {
    title: string;
    nameLine: {
      prefix: string;
      mul: string;
      tiplexed: string;
      i: string;
      nformationAnd: string;
      c: string;
      omputing: string;
      a: string;
      gent: string;
    };
    paragraphs: string[];
    cta: string;
  };
  changelog: {
    title: string;
    subtitle: string;
    toc: string;
    categories: {
      features: string;
      improvements: string;
      fixes: string;
    };
    entries: {
      version: string;
      date: string;
      title: string;
      changes: string[];
      features?: string[];
      improvements?: string[];
      fixes?: string[];
    }[];
  };
  download: {
    hero: {
      macArm64: {
        title: string;
        sub: string;
        primary: string;
        altZip: string;
      };
      macIntel: {
        title: string;
        sub: string;
        primary: string;
        altZip: string;
      };
      winX64: { title: string; sub: string; primary: string };
      winArm64: { title: string; sub: string; primary: string };
      linux: {
        title: string;
        sub: string;
        primary: string;
        altFormats: string;
      };
      unknown: { title: string; sub: string };
      safariMacHint: string;
      archFallbackHint: string;
    };
    allPlatforms: {
      title: string;
      macArm64Label: string;
      macX64Label: string;
      winX64Label: string;
      winArm64Label: string;
      linuxX64Label: string;
      linuxArm64Label: string;
      formatDmg: string;
      formatZip: string;
      formatExe: string;
      formatAppImage: string;
      formatDeb: string;
      formatRpm: string;
      unavailable: string;
    };
    cli: {
      title: string;
      sub: string;
      installLabel: string;
      startLabel: string;
      sshNote: string;
      copyLabel: string;
      copiedLabel: string;
    };
    cloud: { title: string; sub: string };
    footer: {
      releaseNotes: string;
      allReleases: string;
      currentVersion: string;
      versionUnavailable: string;
    };
  };
  contactSales: {
    pageTitle: string;
    pageDescription: string;
    eyebrow: string;
    title: string;
    subtitle: string;
    notice: { badge: string; body: string };
    fields: {
      firstName: string;
      lastName: string;
      businessEmail: string;
      businessEmailHint: string;
      companyName: string;
      companySize: string;
      countryRegion: string;
      useCase: string;
      goals: string;
      goalsHint: string;
      selectPlaceholder: string;
      submit: string;
      submitting: string;
    };
    companySizes: ContactSalesOption[];
    useCases: ContactSalesOption[];
    countries: string[];
    consent: {
      intro: string;
      outreach: string;
      updates: string;
      unsubscribe: string;
      submitConsent: string;
      privacyLinkLabel: string;
      privacyLinkHref: string;
    };
    success: { title: string; message: string; cta: string };
    errors: {
      generic: string;
      rateLimit: string;
      freeEmail: string;
      invalidEmail: string;
    };
  };
};
