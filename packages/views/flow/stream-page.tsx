"use client";

import { useQuery } from "@tanstack/react-query";
import { cn } from "@quickwork/ui/lib/utils";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { issueListOptions } from "@quickwork/core/issues/queries";
import { statusCategoryOfKey } from "@quickwork/core/issues";
import { STATUS_CONFIG } from "@quickwork/core/issues/config";
import { useT } from "../i18n";
import { StatusIcon } from "../issues/components/status-icon";

/**
 * The workspace's work as a stream of handoffs, newest first.
 *
 * This is the main interface's first increment: the arrangement, with real
 * data and no invented concepts. What it shows today is each issue and when it
 * last moved, which is the timeline half of the view. The half that makes it
 * this product's rather than anyone's — what was actually handed over at each
 * step, and to whom — needs the comment and run records that the next increment
 * will join in; the layout is being checked first because it is the part that
 * is expensive to change later.
 *
 * Deliberately not a board. A board answers "what is the state of everything",
 * which every tracker already answers; the question this product exists to
 * answer is "what moved, and what did it carry", which is a stream.
 */
export function StreamPage() {
  const wsId = useWorkspaceId();
  const { t } = useT("issues");
  const { data, isLoading } = useQuery(issueListOptions(wsId));

  const issues = data
    ? data.slice().sort((a, b) => {
        const at = a.updated_at ?? "";
        const bt = b.updated_at ?? "";
        return bt.localeCompare(at);
      })
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-baseline justify-between gap-4 px-6 py-5">
        <h1 className="text-title font-semibold text-foreground">
          {t(($) => $.list.stream_title)}
        </h1>
        <span className="font-mono text-micro uppercase tracking-[0.22em] text-muted-foreground">
          {issues.length} items
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10">
        {isLoading ? (
          <div className="flex flex-col gap-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-muted/50" />
            ))}
          </div>
        ) : issues.length === 0 ? (
          <p className="py-16 text-center text-body text-muted-foreground">
            {t(($) => $.list.empty_status)}
          </p>
        ) : (
          <ol className="flex flex-col">
            {issues.map((issue, i) => {
              const category = statusCategoryOfKey(issue.status);
              const cfg = STATUS_CONFIG[category];
              const at = issue.updated_at
                ? new Date(issue.updated_at)
                : null;
              return (
                <li key={issue.id} className="flex gap-4">
                  {/* The thread: one rule down the left, a node per item, so the
                      eye reads order without numbers. */}
                  <div className="flex w-3 shrink-0 flex-col items-center pt-1.5">
                    <span
                      className={cn("size-2 shrink-0 rounded-full", cfg.iconColor)}
                    >
                      <span className="sr-only">{issue.status}</span>
                    </span>
                    {i < issues.length - 1 && (
                      <span className="w-px flex-1 bg-border" />
                    )}
                  </div>

                  <div
                    className={`flex min-w-0 flex-1 items-baseline gap-3 ${
                      i < issues.length - 1 ? "pb-5" : ""
                    }`}
                  >
                    <span className="w-11 shrink-0 font-mono text-micro text-muted-foreground">
                      {at
                        ? `${String(at.getHours()).padStart(2, "0")}:${String(
                            at.getMinutes(),
                          ).padStart(2, "0")}`
                        : "—"}
                    </span>
                    <span className="w-16 shrink-0 font-mono text-micro text-muted-foreground">
                      {issue.identifier ?? "—"}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-body text-foreground">
                        {issue.title}
                      </span>
                      <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
                        <StatusIcon
                          status={issue.status}
                          className={cn("h-3.5 w-3.5", cfg.iconColor)}
                        />
                        {t(($) => $.status[category])}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
