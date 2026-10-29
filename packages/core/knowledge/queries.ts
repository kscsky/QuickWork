import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";
import type {
  KnowledgeListResponse,
  KnowledgePreview,
  KnowledgeSearchResponse,
} from "../types";

export const knowledgeKeys = {
  all: (wsId: string) => ["knowledge", wsId] as const,
  list: (wsId: string) => [...knowledgeKeys.all(wsId), "list"] as const,
  search: (wsId: string, query: string) =>
    [...knowledgeKeys.all(wsId), "search", query] as const,
  /** The deposit preview is keyed by issue, not workspace: it is the task's
   *  own distillation and must not be reused across tasks. */
  preview: (issueId: string) => ["knowledge", "preview", issueId] as const,
};

export function knowledgeListOptions(wsId: string) {
  return queryOptions<KnowledgeListResponse>({
    queryKey: knowledgeKeys.list(wsId),
    queryFn: () => api.listKnowledge(),
    enabled: !!wsId,
    staleTime: 0,
  });
}

export function knowledgeSearchOptions(wsId: string, query: string, limit = 5) {
  const trimmed = query.trim();
  return queryOptions<KnowledgeSearchResponse>({
    queryKey: knowledgeKeys.search(wsId, trimmed),
    queryFn: () => api.searchKnowledge(trimmed, limit),
    enabled: !!wsId && trimmed.length > 0,
    staleTime: 0,
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
