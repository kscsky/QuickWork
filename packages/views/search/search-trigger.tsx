"use client";

import { Search } from "lucide-react";
import { SidebarMenuButton } from "@quickwork/ui/components/ui/sidebar";
import {
  useShortcut,
} from "@quickwork/core/shortcuts";
import { useSearchStore } from "./search-store";
import { useT } from "../i18n";
import { ShortcutKeycaps } from "../common/shortcut-keycaps";

export function SearchTrigger() {
  const { t } = useT("search");
  const shortcut = useShortcut("openSearch");
  return (
    <SidebarMenuButton
      className="h-[40px] gap-[9px] rounded-none border-0 border-b border-border bg-transparent px-[8px] py-0 text-[13px] leading-[18px] font-normal text-muted-foreground shadow-none hover:bg-foreground/[0.03] hover:text-secondary-foreground focus-visible:ring-0 [&_svg]:size-[16px]"
      onClick={() => useSearchStore.getState().setOpen(true)}
    >
      <Search />
      <span className="min-w-0 flex-1 truncate text-left">{t(($) => $.trigger.label)}</span>
      {shortcut ? (
        <ShortcutKeycaps
          shortcut={shortcut}
          decorative
          className="pointer-events-none ml-auto shrink-0 gap-[3px]"
          keyClassName="h-[19px] min-w-[20px] rounded-[3px] border-border bg-background px-1 font-mono text-[10px] font-medium text-muted-foreground shadow-none"
        />
      ) : null}
    </SidebarMenuButton>
  );
}
