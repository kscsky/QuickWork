"use client";

import { useMemo } from "react";
import { ALL_STATUSES } from "@quickwork/core/issues/config";
import { useIssueStatuses } from "@quickwork/core/issue-statuses/hooks";
import { issueStatusColor } from "@quickwork/core/issue-statuses/queries";
import type { IssueStatus, IssueStatusCategory } from "@quickwork/core/types";
import { useStatusLabel } from "./status-label";

export interface StatusOption {
  key: IssueStatus;
  /** The category this status behaves as — drives its icon and hover color. */
  category: IssueStatusCategory;
  label: string;
  /** `#rrggbb` for a custom status; null for a built-in, which keeps its token color. */
  color: string | null;
}

/**
 * The statuses a user can pick or filter by, as one flat list in canonical
 * category order (MUL-6243, MUL-6399).
 *
 * Category is carried per option rather than expressed as a heading: it is the
 * behavior a status inherits, which the icon and hover color already say, and
 * a heading per category turned a 7-row list into 14 rows of half whitespace.
 *
 * Shared by the status picker and the status filter so the two can never drift
 * — a status offered in one and missing from the other is exactly how an issue
 * becomes unfindable.
 *
 * Archived statuses are excluded by default: archiving retires a status from
 * future assignment. A read-only filter can opt specific current keys back in
 * through `includeArchivedKeys`, so existing issues remain findable without a
 * picker offering a retired value for assignment.
 */
const NO_ARCHIVED_STATUS_KEYS: readonly IssueStatus[] = [];

export function useStatusOptions(
  wsId: string,
  includeArchivedKeys: readonly IssueStatus[] = NO_ARCHIVED_STATUS_KEYS,
): StatusOption[] {
  const { statuses, isLoaded } = useIssueStatuses(wsId);
  const labelOf = useStatusLabel(wsId);

  return useMemo(
    () => {
      const includedArchived = new Set(includeArchivedKeys);
      return ALL_STATUSES.flatMap((category) => {
        const entries = statuses.filter(
          (entry) =>
            entry.category === category &&
            (!entry.archived_at || includedArchived.has(entry.key)),
        );
        if (entries.length === 0) {
          // A LOADED, non-empty catalog with no row for this category is
          // deliberate: this product does not offer that status (the
          // legacy backlog / in_review / blocked). Offering it anyway is
          // what would keep a deleted status alive in every picker.
          if (isLoaded && statuses.length > 0) {
            return [];
          }
          // Otherwise — still in flight, failed, or an empty catalog (a
          // pre-seed workspace) — offer the built-in, whose key IS the
          // category, so a lifecycle step is never missing.
          return [
            {
              key: category as IssueStatus,
              category,
              label: labelOf(category),
              color: null,
            },
          ];
        }
        return entries.map((e) => ({
          key: e.key as IssueStatus,
          category,
          label: labelOf(e.key),
          color: issueStatusColor(e),
        }));
      });
    },
    [includeArchivedKeys, isLoaded, labelOf, statuses],
  );
}
