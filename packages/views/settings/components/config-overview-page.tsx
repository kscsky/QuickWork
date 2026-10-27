"use client";

import {
  BookOpenText,
  Boxes,
  GitBranch,
  Key,
  Monitor,
  Plug,
  Server,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useWorkspacePaths } from "@quickwork/core/paths";
import { runtimeListOptions } from "@quickwork/core/runtimes";
import { skillListOptions } from "@quickwork/core/workspace/queries";
import { Skeleton } from "@quickwork/ui/components/ui/skeleton";
import { AppLink } from "../../navigation";
import { useT } from "../../i18n";

export function ConfigOverviewPage() {
  const { t } = useT("settings");
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const { data: runtimes = [], isLoading: runtimesLoading } = useQuery(
    runtimeListOptions(wsId),
  );
  const { data: skills = [], isLoading: skillsLoading } = useQuery(
    skillListOptions(wsId),
  );

  const online = runtimes.filter((runtime) => runtime.status === "online").length;
  const modules = [
    {
      key: "model_pool",
      icon: Boxes,
      href: paths.models(),
      title: t(($) => $.page.tabs.model_pool),
      desc: t(($) => $.page.config_model_pool_desc),
      meta: null,
      live: false,
    },
    {
      key: "runtimes",
      icon: Monitor,
      href: paths.runtimes(),
      title: t(($) => $.page.tabs.runtimes),
      desc: t(($) => $.page.config_runtimes_desc),
      meta: runtimesLoading
        ? null
        : t(($) => $.config_overview.runtime_online, {
            online,
            total: runtimes.length,
          }),
      live: online > 0,
    },
    {
      key: "skills",
      icon: BookOpenText,
      href: paths.skills(),
      title: t(($) => $.page.tabs.skills),
      desc: t(($) => $.page.config_skills_desc),
      meta: skillsLoading
        ? null
        : t(($) => $.config_overview.skills_count, { count: skills.length }),
      live: skills.length > 0,
    },
    {
      key: "mcp",
      icon: Server,
      href: paths.mcp(),
      title: t(($) => $.page.tabs.mcp),
      desc: t(($) => $.page.config_mcp_desc),
      meta: null,
      live: false,
    },
    {
      key: "github",
      icon: GitBranch,
      href: paths.github(),
      title: t(($) => $.page.tabs.github),
      desc: t(($) => $.page.config_github_desc),
      meta: null,
      live: false,
    },
    {
      key: "integrations",
      icon: Plug,
      href: paths.integrations(),
      title: t(($) => $.page.tabs.integrations),
      desc: t(($) => $.page.config_integrations_desc),
      meta: null,
      live: false,
    },
    {
      key: "tokens",
      icon: Key,
      href: paths.tokens(),
      title: t(($) => $.page.tabs.tokens),
      desc: t(($) => $.page.config_tokens_desc),
      meta: null,
      live: false,
    },
  ];

  const clock = (() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes(),
    ).padStart(2, "0")}`;
  })();

  return (
    <div className="qw-cfg-page">
      <header className="qw-cfg-masthead">
        <div className="qw-cfg-mast-main">
          <div className="qw-cfg-mast-line">
            <h1>{t(($) => $.page.config_title)}</h1>
            <span className="qw-cfg-count">
              <b>7</b>
              <span>{t(($) => $.config_overview.modules_cap)}</span>
            </span>
          </div>
          <p className="qw-cfg-live">
            {t(($) => $.page.tabs.runtimes)}{" "}
            <b>{runtimesLoading ? "—" : online}</b>{" "}
            {t(($) => $.config_overview.online_word)}
            <span className="sep">·</span>
            {t(($) => $.page.tabs.skills)}{" "}
            <b>{skillsLoading ? "—" : skills.length}</b>
            <span className="sep">·</span>
            <span className="quiet">
              {t(($) => $.config_overview.modules_count, { count: 7 })}
            </span>
          </p>
        </div>
        <div className="qw-cfg-sync">
          <span className="sync">
            <i aria-hidden="true" />
            SYNCED
          </span>
          <span className="time">{clock}</span>
          <span className="hint">{t(($) => $.config_overview.sync_hint)}</span>
        </div>
      </header>

      <div className="qw-cfg-body">
        <div className="qw-cfg-wrap">
          <p className="qw-cfg-lede">{t(($) => $.config_overview.lede)}</p>
          <div className="qw-cfg-sec-head">
            <span>{t(($) => $.config_overview.section)}</span>
            <em>7</em>
          </div>
          <div className="qw-cfg-modules">
            {runtimesLoading || skillsLoading ? (
              Array.from({ length: 7 }, (_, index) => (
                <Skeleton
                  key={index}
                  className="h-[68px] w-full rounded-none"
                />
              ))
            ) : (
              modules.map((module) => (
                <AppLink
                  key={module.key}
                  href={module.href}
                  className="qw-cfg-module"
                >
                  <span className="qw-cfg-glyph">
                    <module.icon className="size-3.5" aria-hidden="true" />
                  </span>
                  <span className="qw-cfg-module-main">
                    <b>{module.title}</b>
                    <span>{module.desc}</span>
                  </span>
                  {module.meta ? (
                    <span
                      className="qw-cfg-meta"
                      data-idle={module.live ? undefined : "true"}
                    >
                      <i aria-hidden="true" />
                      {module.meta}
                    </span>
                  ) : null}
                  <span className="qw-cfg-arrow" aria-hidden="true">
                    →
                  </span>
                </AppLink>
              ))
            )}
          </div>
          <p className="qw-cfg-note">{t(($) => $.config_overview.note)}</p>
        </div>
      </div>
    </div>
  );
}
