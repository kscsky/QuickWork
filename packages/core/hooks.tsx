"use client";

import { useEffect, useState } from "react";
import { useCurrentWorkspace } from "./paths/hooks";

/**
 * A clock that re-renders the caller on an interval.
 *
 * Elapsed timers read as "alive" because the digits move; a duration that only
 * updates when the query refetches reads as frozen and, worse, disagrees with
 * the run it describes. Callers pass the coarsest interval their display can
 * show — a minute-granularity list does not need 60 renders a minute.
 *
 * `intervalMs <= 0` parks the clock: the caller keeps a stable timestamp for
 * derivations that must not change under it, without a branch at every call
 * site.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs <= 0) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Returns the current workspace UUID. Throws if called outside a workspace route.
 *
 * Implementation: derives from useCurrentWorkspace() (URL slug + React Query list).
 * No longer backed by a React Context — the WorkspaceIdProvider has been removed
 * as part of the slug-first refactor. The throw semantics are preserved so existing
 * callers that depend on non-null don't need guard code.
 */
export function useWorkspaceId(): string {
  const ws = useCurrentWorkspace();
  if (!ws) throw new Error("useWorkspaceId: no workspace selected — ensure component renders inside a workspace route");
  return ws.id;
}
