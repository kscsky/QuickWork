import { DashboardGuard } from "@quickwork/views/layout";
import { FlowShell } from "@quickwork/views/flow";

/**
 * The stream's own shell, outside the dashboard group.
 *
 * It is a sibling of `(dashboard)` rather than a page inside it because the two
 * answer different questions and therefore want different chrome: the dashboard's
 * sidebar is a menu of nouns, and this screen is a single view that should not be
 * framed as one item of one. `DashboardGuard` still gates it, so a signed-out or
 * workspace-less visitor is handled exactly as everywhere else.
 */
export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  return (
    <DashboardGuard>
      <FlowShell slug={workspaceSlug}>{children}</FlowShell>
    </DashboardGuard>
  );
}
