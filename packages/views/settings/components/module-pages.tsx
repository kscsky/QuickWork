"use client";

import { useWorkspacePaths } from "@quickwork/core/paths";
import { useT } from "../../i18n";
import { AccountTab } from "./account-tab";
import { GitHubTab } from "./github-tab";
import { IntegrationsTab } from "./integrations-tab";
import { McpTab } from "./mcp-tab";
import { NotificationsTab } from "./notifications-tab";
import { PreferencesTab } from "./preferences-tab";
import { TokensTab } from "./tokens-tab";
import { WorkspaceTab } from "./workspace-tab";
import { SettingsModulePage } from "./module-page";

function useConfigCrumb(title: string) {
  const { t } = useT("settings");
  const paths = useWorkspacePaths();
  return {
    title,
    breadcrumb: { label: t(($) => $.page.config_title), href: paths.config() },
  };
}

export function McpSettingsPage() {
  const { t } = useT("settings");
  const crumb = useConfigCrumb(t(($) => $.page.tabs.mcp));
  return (
    <SettingsModulePage {...crumb}>
      <McpTab />
    </SettingsModulePage>
  );
}

export function GitHubSettingsPage() {
  const { t } = useT("settings");
  const crumb = useConfigCrumb(t(($) => $.page.tabs.github));
  return (
    <SettingsModulePage {...crumb}>
      <GitHubTab />
    </SettingsModulePage>
  );
}

export function IntegrationsSettingsPage() {
  const { t } = useT("settings");
  const crumb = useConfigCrumb(t(($) => $.page.tabs.integrations));
  return (
    <SettingsModulePage {...crumb}>
      <IntegrationsTab />
    </SettingsModulePage>
  );
}

export function TokensSettingsPage() {
  const { t } = useT("settings");
  const crumb = useConfigCrumb(t(($) => $.page.tabs.tokens));
  return (
    <SettingsModulePage {...crumb}>
      <TokensTab />
    </SettingsModulePage>
  );
}

export function AccountSettingsPage({
  extraSections,
}: {
  /** Platform-only sections (desktop daemon/update settings). */
  extraSections?: React.ReactNode;
} = {}) {
  const { t } = useT("settings");
  return (
    <SettingsModulePage title={t(($) => $.page.account_title)}>
      <p className="mb-6 text-caption leading-5 text-muted-foreground">
        {t(($) => $.page.account_description)}
      </p>
      <div className="space-y-8">
        <AccountTab />
        <PreferencesTab />
        <NotificationsTab />
        {extraSections}
      </div>
    </SettingsModulePage>
  );
}

export function WorkspaceSettingsPage() {
  const { t } = useT("settings");
  return (
    <SettingsModulePage title={t(($) => $.page.workspace_title)}>
      <WorkspaceTab />
    </SettingsModulePage>
  );
}
