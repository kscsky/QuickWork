"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { modelPoolCatalogOptions } from "@quickwork/core/model-pool";
import type { AgentRuntime, ModelPoolModel } from "@quickwork/core/types";
import { Button } from "@quickwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@quickwork/ui/components/ui/dialog";
import { Input } from "@quickwork/ui/components/ui/input";

function formatContext(value?: number) {
  if (!value) return "—";
  if (value >= 1_000_000) return `${Math.round((value / 1_000_000) * 10) / 10}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return String(value);
}

function mappedModelId(model: ModelPoolModel, provider: string) {
  if (provider === "opencode") {
    if (model.source === "nvidia") return `nvidia/${model.id}`;
    if (model.source === "openrouter") return `openrouter/${model.id}`;
  }
  return model.id;
}

/**
 * Catalog picker for the agent inspector. The model pool page only lists
 * models; binding is owned by the agent, which is what makes the runtime
 * provider (and its model-id dialect) available at the moment of the write.
 */
export function ModelPoolDialog({
  runtime,
  canEdit,
  currentModel,
  onBind,
}: {
  runtime: AgentRuntime | null;
  canEdit: boolean;
  currentModel: string;
  onBind: (modelId: string) => Promise<void> | void;
}) {
  const wsId = useWorkspaceId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [bindingId, setBindingId] = useState<string | null>(null);
  const provider = runtime?.provider ?? "";

  const catalog = useQuery({
    ...modelPoolCatalogOptions(wsId),
    enabled: open,
  });

  const models = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (catalog.data?.models ?? []).filter(
      (model) =>
        !needle ||
        model.name.toLowerCase().includes(needle) ||
        model.id.toLowerCase().includes(needle) ||
        model.source.toLowerCase().includes(needle),
    );
  }, [catalog.data, search]);

  const bind = async (model: ModelPoolModel) => {
    const mapped = mappedModelId(model, provider);
    setBindingId(model.id);
    try {
      await onBind(mapped);
      toast.success(`已绑定 ${model.name}`);
      setOpen(false);
      setSearch("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "绑定失败");
    } finally {
      setBindingId(null);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!canEdit || !runtime}
        onClick={() => setOpen(true)}
      >
        <Boxes className="mr-1.5 h-3.5 w-3.5" />
        从模型池选择
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>从模型池选择模型</DialogTitle>
            <DialogDescription>
              NVIDIA NIM / OpenRouter Free 的公开目录。绑定只写智能体的
              model；Key 与 Base URL 仍在运行时或智能体环境里配置。
            </DialogDescription>
          </DialogHeader>

          {provider === "claude" ? (
            <p className="rounded-md border border-dashed border-warning/50 bg-warning/10 px-3 py-2 text-caption leading-5 text-warning">
              Claude Code 只接受 Anthropic Messages。绑定 OpenAI 兼容模型前，需要先在本机配置 CCR / FCC 网关，否则任务会在运行时失败。
            </p>
          ) : null}

          <label className="flex h-9 items-center gap-2 rounded-md border border-input bg-transparent px-2.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索模型或来源"
              className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            />
          </label>

          <div className="max-h-[420px] overflow-y-auto rounded-md border border-surface-border">
            {catalog.isLoading ? (
              <div className="flex items-center gap-2 px-3 py-8 text-caption text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                正在拉取免费模型目录…
              </div>
            ) : catalog.isError ? (
              <div className="px-3 py-8 text-caption text-warning">
                目录拉取失败。检查网络后重试。
              </div>
            ) : models.length === 0 ? (
              <div className="px-3 py-8 text-caption text-muted-foreground">
                没有匹配的模型。
              </div>
            ) : (
              models.map((model) => {
                const mapped = mappedModelId(model, provider);
                const isCurrent =
                  currentModel === mapped ||
                  (currentModel !== "" && currentModel.endsWith(`/${model.id}`));
                const protocolCompatible =
                  provider !== "claude" || model.protocol === "anthropic";
                const supported =
                  model.supports_tools !== false && protocolCompatible;
                return (
                  <div
                    key={`${model.source}:${model.id}`}
                    className="flex items-center gap-3 border-b border-surface-border px-3 py-2.5 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-body font-medium">
                        {model.name || model.id}
                      </div>
                      <div className="truncate font-mono text-caption text-muted-foreground">
                        {mapped}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
                        <span>{model.source === "nvidia" ? "NVIDIA NIM" : "OpenRouter Free"}</span>
                        <span>·</span>
                        <span>{formatContext(model.context_length)}</span>
                        <span>·</span>
                        <span>{supported ? "支持工具" : "不支持工具"}</span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={isCurrent ? "secondary" : "outline"}
                      disabled={!supported || isCurrent || bindingId === model.id}
                      onClick={() => void bind(model)}
                    >
                      {isCurrent
                        ? "已绑定"
                        : bindingId === model.id
                          ? "绑定中…"
                          : !protocolCompatible
                            ? "需网关"
                            : supported
                              ? "绑定"
                              : "不可用"}
                    </Button>
                  </div>
                );
              })
            )}
          </div>

          <p className="text-caption leading-5 text-muted-foreground">
            OpenCode 写入 provider/模型ID；Codex 使用裸模型 ID 并依赖本地 provider 配置。
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
