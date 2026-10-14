"use client";

import { Maximize2, Minimize2, XIcon } from "lucide-react";

import { useT } from "../i18n";

/**
 * The create dialog's top strip: the solo-task label, the workspace tag, and
 * the window controls. There is deliberately no mode switch — the 单人任务
 * dialog only creates agent work ("自己写" was removed: execution lands on an
 * agent either way, so the manual form never belonged in this entry).
 */
export function DocketStrip({
  workspaceName,
  isExpanded,
  onToggleExpanded,
  onClose,
}: {
  workspaceName: string;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onClose: () => void;
}) {
  const { t } = useT("modals");
  const expandLabel = isExpanded
    ? t(($) => $.common.collapse_tooltip)
    : t(($) => $.common.expand_tooltip);

  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-b bg-muted pl-4 pr-2.5">
      <span className="shrink-0 text-micro font-semibold tracking-[0.06em] text-muted-foreground">
        {t(($) => $.create_issue.task_label)}
      </span>
      <span className="ml-auto min-w-0 truncate font-mono text-micro text-faint-foreground">
        {workspaceName}
      </span>
      <button
        type="button"
        onClick={onToggleExpanded}
        title={expandLabel}
        aria-label={expandLabel}
        className="grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
      >
        {isExpanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
      </button>
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
