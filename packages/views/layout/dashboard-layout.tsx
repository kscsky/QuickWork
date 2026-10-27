"use client";

import type { ReactNode } from "react";
import { SidebarProvider, SidebarInset } from "@quickwork/ui/components/ui/sidebar";
import { ModalRegistry } from "../modals/registry";
import { SourceBackfillModal } from "../onboarding";
import { AppSidebar } from "./app-sidebar";
import { CanvasBackdrop } from "./canvas-backdrop";
import { DashboardGuard } from "./dashboard-guard";
import { NavigationProgress } from "./navigation-progress";
import { WorkspacePresencePrefetch } from "./workspace-presence-prefetch";
import { GlobalShortcuts } from "./global-shortcuts";

interface DashboardLayoutProps {
  children: ReactNode;
  /** Rendered inside SidebarInset (e.g. ChatWindow, ChatFab — absolute-positioned overlays) */
  extra?: ReactNode;
  /** Rendered inside sidebar header as a search trigger */
  searchSlot?: ReactNode;
  /** Loading indicator */
  loadingIndicator?: ReactNode;
}

export function DashboardLayout({
  children,
  extra,
  searchSlot,
  loadingIndicator,
}: DashboardLayoutProps) {
  return (
    <DashboardGuard
      loadingFallback={
        <div className="flex h-svh items-center justify-center">
          {loadingIndicator}
        </div>
      }
    >
      <SidebarProvider className="h-svh bg-app-shell">
        <GlobalShortcuts />
        <WorkspacePresencePrefetch />
        <AppSidebar searchSlot={searchSlot} />
        <SidebarInset className="relative overflow-hidden">
          {/* The workspace canvas paints under everything; the content wrapper
              lifts the real app above it (positioned spans beat plain flow
              content at equal z, so the order in the DOM is not enough). */}
          <CanvasBackdrop />
          <div className="relative z-[1] flex min-h-0 flex-1 flex-col">
            <NavigationProgress />
            {children}
            <ModalRegistry />
            <SourceBackfillModal />
            {extra}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </DashboardGuard>
  );
}
