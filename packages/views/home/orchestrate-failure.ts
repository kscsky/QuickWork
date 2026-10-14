import { ApiError, dispatchReasonCode, errorCode } from "@quickwork/core/api";

/**
 * What a failed `quick-create` dispatch means, in the vocabulary the home
 * composer toasts.
 *
 * The server refuses a dispatch with 422 + a structured body when the target
 * agent cannot run right now (`code` + `reason_code`; the human-readable
 * `reason` is English developer detail). The ApiClient's fallback message for
 * that body is "API error: 422 …", which is useless in a toast — so classify
 * the machine-readable pair once, here, and let the caller pick localized
 * copy. `null` means "not a quick-create structured rejection": the caller
 * falls back to its generic failure message.
 */
export type OrchestrateFailure =
  | { kind: "agent_offline" }
  | { kind: "agent_no_runtime" }
  | { kind: "agent_cli_unusable" }
  | { kind: "agent_archived" }
  // agent_unavailable with a reason_code this client does not know (or none at
  // all, from a server that predates reason_code).
  | { kind: "agent_unavailable" }
  | { kind: "daemon_version"; current: string; min: string };

export function orchestrateFailure(error: unknown): OrchestrateFailure | null {
  const code = errorCode(error);
  if (code === "agent_unavailable") {
    switch (dispatchReasonCode(error)) {
      case "runtime_offline":
        return { kind: "agent_offline" };
      case "agent_runtime_required":
        return { kind: "agent_no_runtime" };
      case "runtime_unusable":
        return { kind: "agent_cli_unusable" };
      case "target_unavailable":
        return { kind: "agent_archived" };
      default:
        return { kind: "agent_unavailable" };
    }
  }
  if (code === "daemon_version_unsupported") {
    const body =
      error instanceof ApiError && error.body && typeof error.body === "object"
        ? (error.body as { current_version?: unknown; min_version?: unknown })
        : {};
    return {
      kind: "daemon_version",
      current: typeof body.current_version === "string" ? body.current_version : "",
      min: typeof body.min_version === "string" ? body.min_version : "",
    };
  }
  return null;
}
