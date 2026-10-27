"use client";

import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@quickwork/ui/lib/utils";

/**
 * One card in the task-detail right rail. Mirrors the squad workbench's
 * surface treatment (surface fill, hairline border, one soft shadow) so solo
 * tasks and relay tasks read as the same product.
 */
export function RailCard({
  id,
  title,
  count,
  open = true,
  onToggle,
  bare = false,
  className,
  children,
}: {
  id?: string;
  title?: ReactNode;
  count?: ReactNode;
  open?: boolean;
  onToggle?: () => void;
  /** The child owns its own padding and header (e.g. ExecutionLogSection). */
  bare?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn(
        "overflow-hidden rounded-lg border border-surface-border bg-surface shadow-[var(--shadow-surface)]",
        className,
      )}
    >
      {title != null ? (
        <header className="flex items-center gap-2 px-3.5 pb-1.5 pt-3">
          {onToggle ? (
            <button
              type="button"
              onClick={onToggle}
              className="flex min-w-0 items-center gap-1.5 text-left text-caption font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronRight
                className={cn(
                  "size-3 shrink-0 transition-transform",
                  open && "rotate-90",
                )}
              />
              <span className="truncate">{title}</span>
            </button>
          ) : (
            <h3 className="min-w-0 truncate text-caption font-semibold text-muted-foreground">
              {title}
            </h3>
          )}
          {count != null ? (
            <span className="font-mono text-micro text-faint-foreground">
              {count}
            </span>
          ) : null}
        </header>
      ) : null}
      {open ? (
        <div className={bare ? undefined : "px-3.5 pb-3.5"}>{children}</div>
      ) : null}
    </section>
  );
}
