"use client";

import type { ReactNode } from "react";
import {
  Activity,
  Bot,
  FolderKanban,
  Inbox,
  ListTodo,
  Settings,
  Sparkles,
} from "lucide-react";
import { cn } from "@quickwork/ui/lib/utils";
import { AppLink, useNavigation } from "../navigation";
import { useT } from "../i18n";
import { currentPath } from "../navigation/current-path";

/**
 * The shell the stream lives in: an icon rail, not a sidebar.
 *
 * The product's own sidebar was a list of nouns — Issues, Projects, Agents —
 * which is a menu, and a menu answers "where can I go". This screen answers
 * "what is happening", so the rail's job is only to get out of the way: it
 * holds the destinations without naming them, and the one it names is the one
 * you are on. That is why icons carry it and the current item is the only one
 * that grows a label.
 *
 * Dark, and scoped here rather than globally, so this view can ship before the
 * rest of the app is re-dressed. Every token inside resolves against it.
 */

const ITEMS = [
  { href: "flow", icon: Activity, key: "stream_title" },
  { href: "issues", icon: ListTodo, key: null },
  { href: "projects", icon: FolderKanban, key: null },
  { href: "agents", icon: Bot, key: null },
  { href: "inbox", icon: Inbox, key: null },
  { href: "skills", icon: Sparkles, key: null },
] as const;

export function FlowShell({
  slug,
  children,
}: {
  slug: string;
  children: ReactNode;
}) {
  const { t } = useT("issues");
  const { pathname, searchParams, hash } = useNavigation();
  const current = currentPath({ pathname, searchParams, hash });

  return (
    <div className="dark flex h-svh bg-background text-foreground">
      <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border py-4">
        <span className="mb-3 block size-6 rounded-md bg-inflight" aria-hidden />
        {ITEMS.map(({ href, icon: Icon, key }) => {
          const to = `/${slug}/${href}`;
          const active = current === to || current.startsWith(`${to}/`);
          return (
            <AppLink
              key={href}
              href={to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex h-10 items-center justify-center rounded-lg transition-colors",
                // The active item is the only one that grows a label, and it
                // stays identifiable on hover because the hover state moves
                // the text colour rather than replacing the fill.
                active
                  ? "w-full gap-2 px-3 text-foreground"
                  : "w-10 text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
              )}
              title={key ? t(($) => $.list[key]) : href}
            >
              <Icon className="size-4 shrink-0" />
              {active && key && (
                <span className="truncate text-caption">
                  {t(($) => $.list[key])}
                </span>
              )}
            </AppLink>
          );
        })}
        <AppLink
          href={`/${slug}/settings`}
          title="settings"
          className="mt-auto flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <Settings className="size-4" />
        </AppLink>
      </nav>

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
