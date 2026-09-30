import type { Metadata } from "next";
import { QuickWorkLanding } from "@/features/landing/components/quickwork-landing";

export const metadata: Metadata = {
  title: "Homepage",
  description:
    "QuickWork — open-source platform that turns coding agents into real teammates. Assign tasks, track progress, compound skills.",
  openGraph: {
    title: "QuickWork — Project Management for Human + Agent Teams",
    description:
      "Manage your human + agent workforce in one place.",
    url: "/homepage",
  },
  alternates: {
    canonical: "/homepage",
  },
};

export default function HomepagePage() {
  return <QuickWorkLanding />;
}
