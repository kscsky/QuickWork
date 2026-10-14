"use client";

import { LandingHeader } from "./landing-header";
import { LandingHero } from "./landing-hero";
import { LandingPillars } from "./landing-pillars";
import { LandingBand } from "./landing-band";
import { LandingFooter } from "./landing-footer";

/**
 * Header → hero → three numbered pillars → call-to-action band → footer.
 *
 * Deliberately short. The longer sections this page used to carry
 * (how-it-works, open-source, FAQ) are still in the tree but no longer
 * composed here — their components were built against the old dark band
 * styling. Fold one back in by styling it to this page's language first.
 */
export function QuickWorkLanding() {
  return (
    <>
      <LandingHeader variant="light" />
      <LandingHero />
      <LandingPillars />
      <LandingBand />
      <LandingFooter />
    </>
  );
}
