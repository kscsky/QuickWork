import type { Metadata } from "next";
import { QuickWorkLanding } from "@/features/landing/components/quickwork-landing";
import { RedirectIfAuthenticated } from "@/features/landing/components/redirect-if-authenticated";

export const metadata: Metadata = {
  title: {
    absolute: "QuickWork — Project Management for Human + Agent Teams",
  },
  description:
    "Open-source platform that turns coding agents into real teammates. Assign tasks, track progress, compound skills.",
  openGraph: {
    title: "QuickWork — Project Management for Human + Agent Teams",
    description:
      "Manage your human + agent workforce in one place.",
    url: "/",
  },
  alternates: {
    canonical: "/",
  },
};

export default function LandingPage() {
  return (
    <>
      <RedirectIfAuthenticated />
      <QuickWorkLanding />
    </>
  );
}
