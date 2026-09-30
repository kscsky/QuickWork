// Per-agent sandbox execution settings.
//
// Stored under `agent.sandbox_config` as freeform JSONB — deliberately NOT
// inside `runtime_config`, which UpdateAgent replaces wholesale and the
// OpenClaw settings tab serializes from scratch; a key living there would be
// erased the first time someone edited an OpenClaw agent's gateway settings.
//
// Nothing in the execution path reads this yet: tasks still run on the runtime
// that hosts the daemon. `enabled !== true` means exactly that, so an agent
// with no saved config and an agent with the switch off behave identically —
// on the daemon.

export interface AgentSandboxConfig {
  enabled?: boolean;
  /** E2B template the sandbox boots from, e.g. "claude". Empty = deployment default. */
  template?: string;
  /** How long one sandbox may run, in seconds. E2B's Hobby plan caps continuous runtime at 3600. */
  timeout_seconds?: number;
}

/** E2B's Hobby-plan ceiling on continuous runtime. Values above this fail at create time. */
export const SANDBOX_MAX_TIMEOUT_SECONDS = 3600;

/**
 * Whether tasks for this config run in a sandbox. The single place the
 * "unset means daemon" rule is expressed — callers that need to label the
 * destination should use this rather than testing `enabled` themselves.
 */
export function runsInSandbox(cfg: AgentSandboxConfig | null | undefined): boolean {
  return cfg?.enabled === true;
}

/**
 * Parse an arbitrary sandbox_config payload into the typed schema. Unknown keys
 * are dropped and malformed payloads collapse to `{}` — the form never throws
 * on bad input, so a corrupted row renders as defaults instead of a crash.
 */
export function parseAgentSandboxConfig(raw: unknown): AgentSandboxConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const root = raw as Record<string, unknown>;
  const out: AgentSandboxConfig = {};
  if (typeof root.enabled === "boolean") out.enabled = root.enabled;
  if (typeof root.template === "string" && root.template.trim() !== "") {
    out.template = root.template.trim();
  }
  if (
    typeof root.timeout_seconds === "number" &&
    Number.isFinite(root.timeout_seconds) &&
    root.timeout_seconds > 0
  ) {
    out.timeout_seconds = Math.floor(root.timeout_seconds);
  }
  return out;
}

/**
 * Render the typed form state back into the wire shape the API accepts.
 * `enabled` is always written so switching off is an explicit false rather
 * than an omitted field — the column has no NULL-clear path, and an explicit
 * false is what the form needs to read back.
 */
export function serializeAgentSandboxConfig(
  cfg: AgentSandboxConfig,
): Record<string, unknown> {
  const out: Record<string, unknown> = { enabled: cfg.enabled === true };
  if (cfg.template) out.template = cfg.template;
  if (cfg.timeout_seconds) out.timeout_seconds = cfg.timeout_seconds;
  return out;
}

/** Stable shallow equality for the form's dirty detector. */
export function agentSandboxConfigEquals(
  a: AgentSandboxConfig,
  b: AgentSandboxConfig,
): boolean {
  return (
    (a.enabled === true) === (b.enabled === true) &&
    (a.template ?? "") === (b.template ?? "") &&
    (a.timeout_seconds ?? 0) === (b.timeout_seconds ?? 0)
  );
}
