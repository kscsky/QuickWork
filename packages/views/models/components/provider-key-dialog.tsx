"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { api } from "@quickwork/core/api";
import type { Agent, AgentRuntime } from "@quickwork/core/types";
import { Button } from "@quickwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@quickwork/ui/components/ui/dialog";
import { Input } from "@quickwork/ui/components/ui/input";

export interface KeyConfigModel {
  id: string;
  name: string;
  source: string;
  sourceLabel: string;
}

const PROVIDERS: Record<
  string,
  { alias: string; name: string; baseURL: string }
> = {
  nvidia: {
    alias: "nvidia",
    name: "NVIDIA NIM",
    baseURL: "https://integrate.api.nvidia.com/v1",
  },
  openrouter: {
    alias: "openrouter",
    name: "OpenRouter Free",
    baseURL: "https://openrouter.ai/api/v1",
  },
};

/**
 * Writes one provider credential into an OpenCode agent's
 * OPENCODE_CONFIG_CONTENT. The key lives in the agent env, never in the pool
 * catalog or this page's state after the dialog closes.
 */
export function ProviderKeyDialog({
  model,
  runtime,
  agents,
  onOpenAgent,
}: {
  model: KeyConfigModel;
  runtime: AgentRuntime | null;
  agents: Agent[];
  onOpenAgent: (agentId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const provider = PROVIDERS[model.source];
  if (!provider || runtime?.provider !== "opencode") return null;
  const selectedAgent = agents.find((agent) => agent.id === agentId) ?? null;

  const save = async () => {
    if (!selectedAgent) {
      setError("请选择一个 OpenCode 智能体。");
      return;
    }
    if (!key.trim()) {
      setError("请填写 API Key。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const current = await api.getAgentEnv(selectedAgent.id);
      const env = current.custom_env ?? {};
      let config: Record<string, unknown> = {};
      if (env.OPENCODE_CONFIG_CONTENT) {
        try {
          config = JSON.parse(env.OPENCODE_CONFIG_CONTENT) as Record<
            string,
            unknown
          >;
        } catch {
          throw new Error(
            "该智能体现有的 OPENCODE_CONFIG_CONTENT 不是合法 JSON，请先在智能体 Env 里修正。",
          );
        }
      }
      const providers =
        (config.provider as Record<string, Record<string, unknown>>) ?? {};
      const previous = providers[provider.alias] ?? {};
      const previousOptions =
        (previous.options as Record<string, unknown>) ?? {};
      const previousModels =
        (previous.models as Record<string, Record<string, unknown>>) ?? {};
      config.provider = {
        ...providers,
        [provider.alias]: {
          ...previous,
          npm: "@ai-sdk/openai-compatible",
          name: provider.name,
          options: {
            ...previousOptions,
            baseURL: provider.baseURL,
            apiKey: key.trim(),
          },
          models: {
            ...previousModels,
            [model.id]: { name: model.name },
          },
        },
      };
      await api.updateAgentEnv(selectedAgent.id, {
        custom_env: {
          ...env,
          OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
        },
      });
      toast.success(`Key 已写入 ${selectedAgent.name}`);
      setOpen(false);
      setKey("");
      onOpenAgent(selectedAgent.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "写入失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2 w-full"
        disabled={agents.length === 0}
        onClick={() => setOpen(true)}
      >
        <KeyRound className="mr-1.5 h-3.5 w-3.5" />
        配置 Key 到智能体
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>配置 {provider.name} Key</DialogTitle>
            <DialogDescription>
              写入所选 OpenCode 智能体的 OPENCODE_CONFIG_CONTENT。Key 只保存在该智能体的环境变量里，不进入模型池或服务端配置。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block text-caption font-medium">
              智能体
              <select
                className="mt-1.5 h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-body"
                value={agentId}
                onChange={(event) => setAgentId(event.target.value)}
              >
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-caption font-medium">
              Base URL
              <Input
                readOnly
                value={provider.baseURL}
                className="mt-1.5 font-mono"
              />
            </label>
            <label className="block text-caption font-medium">
              API Key
              <Input
                type="password"
                autoComplete="off"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder={model.source === "nvidia" ? "nvapi-..." : "sk-or-v1-..."}
                className="mt-1.5 font-mono"
              />
            </label>
            <p className="text-caption leading-5 text-muted-foreground">
              保存后会打开该智能体，接着在“模型池 → 从模型池选择”里绑定
              {model.name}。OpenCode 会使用 provider/模型ID 写入。
            </p>
            {error ? (
              <p className="text-caption text-destructive">{error}</p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button size="sm" disabled={saving} onClick={() => void save()}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
