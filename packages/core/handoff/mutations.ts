import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { handoffKeys, type HandoffRuleInput } from "./queries";
import { useWorkspaceId } from "../hooks";

// Rule writes reload the server-side relay index; the list is the only cache
// to refresh, so every mutation invalidates the workspace's rule key.
function useHandoffInvalidation() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return () => qc.invalidateQueries({ queryKey: handoffKeys.all(wsId) });
}

export function useCreateHandoffRule() {
  const invalidate = useHandoffInvalidation();
  return useMutation({
    mutationFn: (input: HandoffRuleInput) => api.createHandoffRule(input),
    onSettled: invalidate,
  });
}

export function useUpdateHandoffRule() {
  const invalidate = useHandoffInvalidation();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<HandoffRuleInput>) =>
      api.updateHandoffRule(id, body),
    onSettled: invalidate,
  });
}

export function useToggleHandoffRule() {
  const invalidate = useHandoffInvalidation();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.toggleHandoffRule(id, enabled),
    onSettled: invalidate,
  });
}

export function useDeleteHandoffRule() {
  const invalidate = useHandoffInvalidation();
  return useMutation({
    mutationFn: (id: string) => api.deleteHandoffRule(id),
    onSettled: invalidate,
  });
}
