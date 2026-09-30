"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Loader2, Save } from "lucide-react";
import type { Agent } from "@quickwork/core/types";
import {
  type AgentSandboxConfig,
  SANDBOX_MAX_TIMEOUT_SECONDS,
  agentSandboxConfigEquals,
  parseAgentSandboxConfig,
  serializeAgentSandboxConfig,
} from "@quickwork/core/agents";
import { api } from "@quickwork/core/api";
import type { AgentSandboxProbeResponse } from "@quickwork/core/types";
import { Button } from "@quickwork/ui/components/ui/button";
import { Input } from "@quickwork/ui/components/ui/input";
import { Label } from "@quickwork/ui/components/ui/label";
import { Switch } from "@quickwork/ui/components/ui/switch";
import { toast } from "sonner";
import { useT } from "../../../i18n";

// Form state mirrors AgentSandboxConfig, but keeps timeout as a string so the
// input can hold intermediate values ("18" on the way to "1800") without the
// number parser rewriting what the user is typing.
interface FormState {
  enabled: boolean;
  template: string;
  timeout: string;
}

function configToForm(cfg: AgentSandboxConfig): FormState {
  return {
    enabled: cfg.enabled === true,
    template: cfg.template ?? "",
    timeout: cfg.timeout_seconds ? String(cfg.timeout_seconds) : "",
  };
}

function formToConfig(state: FormState): AgentSandboxConfig {
  const cfg: AgentSandboxConfig = { enabled: state.enabled };
  if (state.template.trim() !== "") cfg.template = state.template.trim();
  const seconds = Number.parseInt(state.timeout, 10);
  if (Number.isFinite(seconds) && seconds > 0) cfg.timeout_seconds = seconds;
  return cfg;
}

function formEquals(a: FormState, b: FormState): boolean {
  return (
    a.enabled === b.enabled && a.template === b.template && a.timeout === b.timeout
  );
}

// Sandbox execution settings. Unlike the OpenClaw runtime tab this is not
// provider-specific — any agent can be pointed at a sandbox — so the pane
// shows it whenever the workspace has an E2B connection.
//
// Nothing reads this config for routing yet. The tab is explicit about that:
// the caption under the switch states where tasks run TODAY, so nobody saves
// "enabled" and expects their next task to leave the machine.
export function SandboxTab({
  agent,
  onSave,
  onDirtyChange,
}: {
  agent: Agent;
  onSave: (updates: { sandbox_config: Record<string, unknown> }) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useT("agents");

  const original = useMemo<AgentSandboxConfig>(
    () => parseAgentSandboxConfig(agent.sandbox_config),
    [agent.sandbox_config],
  );
  const originalForm = useMemo(() => configToForm(original), [original]);

  const [state, setState] = useState<FormState>(originalForm);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<AgentSandboxProbeResponse | null>(null);

  // Adopt a new server value only when the user has no in-flight edits —
  // same pattern as RuntimeConfigTab / McpConfigTab.
  const previousFormRef = useRef(originalForm);
  useEffect(() => {
    setState((current) =>
      formEquals(current, previousFormRef.current) ? originalForm : current,
    );
    previousFormRef.current = originalForm;
  }, [originalForm]);

  const currentCfg = useMemo(() => formToConfig(state), [state]);
  const dirty = !agentSandboxConfigEquals(original, currentCfg);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const timeoutSeconds = Number.parseInt(state.timeout, 10);
  const timeoutValid =
    state.timeout.trim() === "" ||
    (/^\d+$/.test(state.timeout.trim()) &&
      timeoutSeconds > 0 &&
      timeoutSeconds <= SANDBOX_MAX_TIMEOUT_SECONDS);
  const canSave = timeoutValid && !saving;

  // The probe reads the SAVED config server-side, so running it against
  // unsaved edits would report on something other than what the form shows.
  const handleProbe = async () => {
    if (probing || dirty) return;
    setProbing(true);
    setProbe(null);
    try {
      setProbe(await api.testAgentSandbox(agent.id));
      toast.success(t(($) => $.tab_body.sandbox.probe_ok));
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : t(($) => $.tab_body.sandbox.probe_failed),
      );
    } finally {
      setProbing(false);
    }
  };

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({ sandbox_config: serializeAgentSandboxConfig(currentCfg) });
      toast.success(t(($) => $.tab_body.sandbox.saved_toast));
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : t(($) => $.tab_body.sandbox.save_failed_toast),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col space-y-4">
      <p className="text-caption text-muted-foreground">
        {t(($) => $.tab_body.sandbox.intro)}
      </p>

      <div className="flex items-center justify-between gap-4 rounded-md border p-3">
        <div className="space-y-0.5">
          <Label htmlFor="agent-sandbox-enabled" className="text-caption font-medium">
            {t(($) => $.tab_body.sandbox.enabled_label)}
          </Label>
          <p className="text-caption text-muted-foreground">
            {t(($) => $.tab_body.sandbox.enabled_hint)}
          </p>
        </div>
        <Switch
          id="agent-sandbox-enabled"
          checked={state.enabled}
          onCheckedChange={(checked: boolean) =>
            setState((s) => ({ ...s, enabled: checked }))
          }
        />
      </div>

      <fieldset
        className={`space-y-3 rounded-md border p-3 ${state.enabled ? "" : "opacity-50"}`}
        disabled={!state.enabled}
      >
        <legend className="px-1 text-caption font-medium">
          {t(($) => $.tab_body.sandbox.legend)}
        </legend>

        <div className="space-y-1.5">
          <Label htmlFor="agent-sandbox-template" className="text-caption">
            {t(($) => $.tab_body.sandbox.template_label)}
          </Label>
          <Input
            id="agent-sandbox-template"
            value={state.template}
            onChange={(e) => setState((s) => ({ ...s, template: e.target.value }))}
            placeholder={t(($) => $.tab_body.sandbox.template_placeholder)}
            className="font-mono text-caption"
          />
          <p className="text-caption text-muted-foreground">
            {t(($) => $.tab_body.sandbox.template_hint)}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="agent-sandbox-timeout" className="text-caption">
            {t(($) => $.tab_body.sandbox.timeout_label)}
          </Label>
          <Input
            id="agent-sandbox-timeout"
            value={state.timeout}
            onChange={(e) => setState((s) => ({ ...s, timeout: e.target.value }))}
            placeholder="1800"
            inputMode="numeric"
            aria-invalid={!timeoutValid || undefined}
            className="font-mono text-caption"
          />
          {timeoutValid ? (
            <p className="text-caption text-muted-foreground">
              {t(($) => $.tab_body.sandbox.timeout_hint, {
                max: SANDBOX_MAX_TIMEOUT_SECONDS,
              })}
            </p>
          ) : (
            <p className="text-caption text-destructive">
              {t(($) => $.tab_body.sandbox.timeout_invalid, {
                max: SANDBOX_MAX_TIMEOUT_SECONDS,
              })}
            </p>
          )}
        </div>
      </fieldset>

      <div className="space-y-2 rounded-md border p-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-caption font-medium">
              {t(($) => $.tab_body.sandbox.probe_title)}
            </p>
            <p className="text-caption text-muted-foreground">
              {dirty
                ? t(($) => $.tab_body.sandbox.probe_save_first)
                : t(($) => $.tab_body.sandbox.probe_hint)}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleProbe}
            disabled={probing || dirty}
            className="shrink-0"
          >
            {probing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Box className="h-3.5 w-3.5" />
            )}
            {probing
              ? t(($) => $.tab_body.sandbox.probing)
              : t(($) => $.tab_body.sandbox.probe_action)}
          </Button>
        </div>

        {probe && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t pt-2 text-caption sm:grid-cols-3">
            <ProbeFact
              label={t(($) => $.tab_body.sandbox.probe_template)}
              value={probe.template || t(($) => $.tab_body.sandbox.probe_default)}
            />
            <ProbeFact
              label={t(($) => $.tab_body.sandbox.probe_spec)}
              value={`${probe.cpu_count} vCPU · ${probe.memory_mb} MiB`}
            />
            <ProbeFact
              label={t(($) => $.tab_body.sandbox.probe_disk)}
              value={`${Math.round(probe.disk_size_mb / 1024)} GiB`}
            />
            <ProbeFact
              label={t(($) => $.tab_body.sandbox.probe_state)}
              value={probe.state}
            />
            <ProbeFact
              label={t(($) => $.tab_body.sandbox.probe_create_ms)}
              value={`${probe.create_ms} ms`}
            />
            <ProbeFact
              label={t(($) => $.tab_body.sandbox.probe_total_ms)}
              value={`${probe.total_ms} ms`}
            />
          </dl>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        {dirty && (
          <span className="text-caption text-muted-foreground">
            {t(($) => $.tab_body.common.unsaved_changes)}
          </span>
        )}
        <Button onClick={handleSave} disabled={!dirty || !canSave} size="sm">
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {t(($) => $.tab_body.common.save)}
        </Button>
      </div>
    </div>
  );
}

/** One label/value pair in the probe result grid. */
function ProbeFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono">{value}</dd>
    </div>
  );
}
