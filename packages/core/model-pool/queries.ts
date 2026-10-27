import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const modelPoolKeys = {
  all: (wsId: string) => ["workspaces", wsId, "model-pool"] as const,
  catalog: (wsId: string) => [...modelPoolKeys.all(wsId), "catalog"] as const,
};

/**
 * Public free-model catalog. Workspace-scoped only because every API call is;
 * the payload itself is global and credential-free, so a five-minute staleTime
 * matches the server's own ten-minute upstream cache.
 */
export function modelPoolCatalogOptions(wsId: string) {
  return queryOptions({
    queryKey: modelPoolKeys.catalog(wsId),
    queryFn: () => api.getModelPoolCatalog(),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    enabled: Boolean(wsId),
  });
}
