/**
 * Workspace-level E2B sandbox connection.
 *
 * This is the configuration half of "run this agent's tasks in a sandbox": the
 * workspace names the E2B deployment it can reach and the API key that
 * authorises it. The execution half (routing a task's CLI into the sandbox) is
 * not wired yet — a saved connection currently changes nothing about how tasks
 * run.
 *
 * The key never appears in any response: the server stores it sealed and every
 * read path returns this projection without it.
 */
export interface SandboxConnection {
  configured: boolean;
  /** E2B API base, e.g. https://api.e2b.app (no trailing slash). */
  api_url?: string;
  /** When the stored key last proved good. The save path probes the
   * deployment first, so a configured connection was working at this moment. */
  verified_at?: string;
  updated_at?: string;
  /** Whether this deployment offers the integration at all. Older backends
   * omit it; treat as true so the section still renders. */
  available?: boolean;
  /** Whether the caller can connect / disconnect. Non-admins get false. */
  can_manage?: boolean;
}

export interface SandboxConnectionTestResponse {
  ok: boolean;
  /** Running sandboxes visible to the key at probe time. */
  sandbox_count: number;
}

/**
 * Result of booting one real sandbox with an agent's configured template and
 * timeout. The server destroys the sandbox before responding, so nothing here
 * refers to a live resource.
 */
export interface AgentSandboxProbeResponse {
  sandbox_id: string;
  /** The template as requested — empty when the agent asks for the default. */
  template: string;
  /** What E2B resolved the request to, which is how a wrong name shows up. */
  resolved_template_id: string;
  state: string;
  cpu_count: number;
  memory_mb: number;
  disk_size_mb: number;
  /** Create round trip, and the whole probe including the detail read. */
  create_ms: number;
  total_ms: number;
}

export interface SandboxConnectionRequest {
  api_url?: string;
  /** The E2B key. The sentinel `****` keeps the stored one (the settings form
   * round-trips a masked value without clobbering the secret). */
  api_key: string;
}
