"use client";

import type { ReactNode } from "react";
import { Maximize2, Minimize2, XIcon } from "lucide-react";

import { useT } from "../i18n";

/**
 * The create dialog's top strip: the task-type switch, the workspace tag, and
 * the window controls. The switch is the merged entry's whole idea — one
 * dialog creates both a solo task and a squad relay, and the reader picks the
 * type here instead of choosing between two entry points.
 */
export function DocketStrip({
  workspaceName,
  isExpanded,
  onToggleExpanded,
  onClose,
  leading,
  showExpand = true,
}: {
  workspaceName: string;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onClose: () => void;
  /** The type switch; falls back to the static 单人任务 label when absent. */
  leading?: ReactNode;
  /** No expand state to toggle in the squad composer. */
  showExpand?: boolean;
}) {
  const { t } = useT("modals");
  const expandLabel = isExpanded
    ? t(($) => $.common.collapse_tooltip)
    : t(($) => $.common.expand_tooltip);

  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-b bg-muted pl-4 pr-2.5">
      {leading ?? (
        <span className="shrink-0 text-micro font-semibold tracking-[0.06em] text-muted-foreground">
          {t(($) => $.create_issue.task_label)}
        </span>
      )}
      <span className="ml-auto min-w-0 truncate font-mono text-micro text-faint-foreground">
        {workspaceName}
      </span>
      {showExpand ? (
        <button
          type="button"
          onClick={onToggleExpanded}
          title={expandLabel}
          aria-label={expandLabel}
          className="grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        >
          {isExpanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onClose}
        title={t(($) => $.common.close)}
        aria-label={t(($) => $.common.close)}
        className="grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
