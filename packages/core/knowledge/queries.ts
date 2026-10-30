import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";
import type {
  EmbeddingProfile,
  EmbeddingProvider,
  KnowledgeListResponse,
  KnowledgePreview,
  KnowledgeSearchResponse,
} from "../types";

export const knowledgeKeys = {
  all: (wsId: string) => ["knowledge", wsId] as const,
  list: (wsId: string, corpus?: string | "unindexed" | null) =>
    [...knowledgeKeys.all(wsId), "list", corpus ?? "all"] as const,
  search: (wsId: string, query: string, profileId?: string) =>
    [...knowledgeKeys.all(wsId), "search", profileId ?? "active", query] as const,
  profiles: (wsId: string) => [...knowledgeKeys.all(wsId), "profiles"] as const,
  providers: (wsId: string) => [...knowledgeKeys.all(wsId), "providers"] as const,
  /** The deposit preview is keyed by issue, not workspace: it is the task's
   *  own distillation and must not be reused across tasks. */
  preview: (issueId: string) => ["knowledge", "preview", issueId] as const,
};

export function knowledgeListOptions(
  wsId: string,
  corpus?: string | "unindexed" | null,
) {
  return queryOptions<KnowledgeListResponse>({
    queryKey: knowledgeKeys.list(wsId, corpus),
    queryFn: () =>
      api.listKnowledge(
        corpus === "unindexed"
          ? { dims: "unindexed" }
          : corpus
            ? { profileId: corpus }
            : undefined,
      ),
    enabled: !!wsId,
    staleTime: 0,
  });
}

export function knowledgeSearchOptions(
  wsId: string,
  query: string,
  limit = 5,
  profileId?: string,
) {
  const trimmed = query.trim();
  return queryOptions<KnowledgeSearchResponse>({
    queryKey: knowledgeKeys.search(wsId, trimmed, profileId),
    queryFn: () => api.searchKnowledge(trimmed, limit, profileId),
    enabled: !!wsId && trimmed.length > 0,
    staleTime: 0,
  });
}

export function knowledgeProfilesOptions(wsId: string) {
  return queryOptions<EmbeddingProfile[]>({
    queryKey: knowledgeKeys.profiles(wsId),
    queryFn: () => api.listEmbeddingProfiles(),
    enabled: !!wsId,
    staleTime: 30_000,
  });
}

export function embeddingProvidersOptions(wsId: string) {
  return queryOptions<EmbeddingProvider[]>({
    queryKey: knowledgeKeys.providers(wsId),
    queryFn: () => api.listEmbeddingProviders(),
    enabled: !!wsId,
    staleTime: 300_000,
  });
}

export function knowledgePreviewOptions(issueId: string, enabled: boolean) {
  return queryOptions<KnowledgePreview>({
    queryKey: knowledgeKeys.preview(issueId),
    queryFn: () => api.previewIssueKnowledge(issueId),
    enabled: enabled && !!issueId,
    staleTime: 0,
  });
}
