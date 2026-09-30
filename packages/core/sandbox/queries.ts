import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const sandboxKeys = {
  all: (wsId: string) => ["sandbox", wsId] as const,
  connection: (wsId: string) => [...sandboxKeys.all(wsId), "connection"] as const,
};

export const sandboxConnectionOptions = (wsId: string) =>
  queryOptions({
    queryKey: sandboxKeys.connection(wsId),
    queryFn: () => api.getSandboxConnection(wsId),
    enabled: !!wsId,
  });
