import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { knowledgeKeys } from "./queries";

export function useDepositIssueKnowledge(wsId: string, issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { keys: string[]; publish: boolean }) =>
      api.depositIssueKnowledge(issueId, vars.keys, vars.publish),
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
    mutationFn: () => api.reindexKnowledge(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: knowledgeKeys.all(wsId) });
    },
  });
}
