import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";
import type { RelayActivityEvent } from "../types";

export const activityKeys = {
  all: (wsId: string) => ["activity", wsId] as const,
};

/**
 * The workspace's key relay decisions. Workspace-scoped, newest first; the
 * page filters and groups them client-side.
 */
export function activityListOptions(wsId: string) {
  return queryOptions<RelayActivityEvent[]>({
    queryKey: activityKeys.all(wsId),
    queryFn: () => api.listActivity(),
    enabled: !!wsId,
    staleTime: 0,
  });
}
