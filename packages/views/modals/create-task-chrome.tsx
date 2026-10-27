"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { DialogTitle } from "@quickwork/ui/components/ui/dialog";
import { cn } from "@quickwork/ui/lib/utils";
import type { IssuePriority } from "@quickwork/core/types";
import { useT } from "../i18n";

const DISPATCH_PRIORITIES: IssuePriority[] = ["low", "medium", "high", "urgent"];

/** The dark panel's segmented priority control; click the active one to clear. */
export function DispatchPriority({
  value,
  onChange,
  disabled = false,
}: {
  value: IssuePriority;
  onChange: (value: IssuePriority) => void;
  disabled?: boolean;
}) {
  const { t } = useT("issues");
  const { t: tModals } = useT("modals");
  return (
    <div
      className="qk-priority"
      role="group"
      aria-label={tModals(($) => $.create_issue.field_priority)}
    >
      {DISPATCH_PRIORITIES.map((priority) => (
        <button
          key={priority}
          type="button"
          data-active={value === priority ? "" : undefined}
          aria-pressed={value === priority}
          disabled={disabled}
          onClick={() => onChange(value === priority ? "none" : priority)}
        >
          {t(($) => $.priority[priority])}
        </button>
      ))}
    </div>
  );
}

/** The one in-dialog type switch: solo dispatch note vs squad relay order. */
export function TaskTypeSwitch({
  value,
  onChange,
  disabled = false,
}: {
  value: "single" | "squad";
  onChange: (value: "single" | "squad") => void;
  disabled?: boolean;
}) {
  const { t } = useT("modals");
  const options = [
    { key: "single" as const, label: t(($) => $.create_issue.mode_solo), cap: "SOLO" },
    { key: "squad" as const, label: t(($) => $.create_issue.mode_squad), cap: "SQUAD" },
  ];
  return (
    <span className="qk-create-modes" role="radiogroup" aria-label={t(($) => $.create_issue.type_switch_aria)}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          role="radio"
          aria-checked={value === option.key}
          data-active={value === option.key ? "" : undefined}
          disabled={disabled}
          onClick={() => onChange(option.key)}
          className="qk-mode"
        >
          {option.label}
          <em>{option.cap}</em>
        </button>
      ))}
    </span>
  );
}

/**
 * The refresh dialog chrome: serif masthead, task-type switch, close, then
 * the paper / dark-panel split. Each body owns its two columns; the chrome
 * only supplies the shared frame and its entry motion.
 */
export function CreateTaskChrome({
  onClose,
  typeSwitch,
  busy = false,
  children,
}: {
  onClose: () => void;
  typeSwitch?: ReactNode;
  busy?: boolean;
  children: ReactNode;
}) {
  const { t } = useT("modals");
  return (
    <>
      <header className="qk-create-header">
        <div className="qk-create-heading">
          <DialogTitle className="qk-create-title">
            {t(($) => $.create_issue.dialog_title)}
          </DialogTitle>
          <span className="qk-create-kicker">{t(($) => $.create_issue.kicker)}</span>
        </div>
        {typeSwitch}
        <span className="qk-create-no">{t(($) => $.create_issue.no_auto)}</span>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label={t(($) => $.common.close)}
          title={t(($) => $.common.close)}
          className="qk-create-close"
        >
          <X className="size-3.5" />
        </button>
      </header>
      <div className={cn("qk-create-split", busy && "is-busy")}>{children}</div>
    </>
  );
}
