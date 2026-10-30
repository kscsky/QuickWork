import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { EmbeddingMatchResult, EmbeddingProfileInput } from "../types";
import { knowledgeKeys } from "./queries";

export function useDepositIssueKnowledge(wsId: string, issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { keys: string[]; publish: boolean; profileId?: string }) =>
      api.depositIssueKnowledge(issueId, vars.keys, vars.publish, vars.profileId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: knowledgeKeys.all(wsId) });
      qc.invalidateQueries({ queryKey: knowledgeKeys.preview(issueId) });
    },
  });
}

export function usePublishKnowledgeEntry(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => api.publishKnowledgeEntry(entryId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: knowledgeKeys.all(wsId) });
    },
  });
}

export function useArchiveKnowledgeEntry(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => api.archiveKnowledgeEntry(entryId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: knowledgeKeys.all(wsId) });
    },
  });
}

export function useReindexKnowledge(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (profileId?: string) => api.reindexKnowledge(profileId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: knowledgeKeys.all(wsId) });
    },
  });
}

export function useMatchEmbeddingModels() {
  return useMutation<EmbeddingMatchResult, Error, {
    provider: string;
    base_url?: string;
    model?: string;
    dims?: number;
    api_key: string;
  }>({
    mutationFn: (input) => api.matchEmbeddingModels(input),
    onSuccess: () => {
      // Matching is a probe; nothing is stored, so no query changes.
    },
  });
}

export function useCreateEmbeddingProfile(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EmbeddingProfileInput) => api.createEmbeddingProfile(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: knowledgeKeys.all(wsId) });
    },
  });
}

export function useActivateEmbeddingProfile(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (profileId: string) => api.activateEmbeddingProfile(profileId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: knowledgeKeys.all(wsId) });
    },
  });
}

export function useDeleteEmbeddingProfile(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (profileId: string) => api.deleteEmbeddingProfile(profileId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: knowledgeKeys.all(wsId) });
    },
  });
}
