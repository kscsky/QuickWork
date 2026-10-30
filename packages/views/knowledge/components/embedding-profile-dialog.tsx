"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { EmbeddingProfile, EmbeddingProvider } from "@quickwork/core/types";
import {
  embeddingProvidersOptions,
  knowledgeProfilesOptions,
} from "@quickwork/core/knowledge/queries";
import {
  useActivateEmbeddingProfile,
  useCreateEmbeddingProfile,
  useDeleteEmbeddingProfile,
  useMatchEmbeddingModels,
} from "@quickwork/core/knowledge/mutations";

import { Button } from "@quickwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quickwork/ui/components/ui/dialog";
import { Input } from "@quickwork/ui/components/ui/input";
import { cn } from "@quickwork/ui/lib/utils";
import { useT } from "../../i18n";

/**
 * Embedding profiles are workspace-level. The dialog verifies a provider key,
 * lets the user pick one of the matched embedding models and its dimension,
 * then stores the key encrypted on the server. An entry deposited afterwards
 * is stamped with that model + dimension and never mixes with another corpus.
 */
export function EmbeddingProfileDialog({
  wsId,
  open,
  onOpenChange,
  canAdminister,
  onSaved,
}: {
  wsId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canAdminister: boolean;
  onSaved?: (profile: EmbeddingProfile) => void;
}) {
  const { t } = useT("knowledge");
  const { data: providers = [] } = useQuery({
    ...embeddingProvidersOptions(wsId),
    enabled: open && !!wsId,
  });
  const { data: profiles = [] } = useQuery({
    ...knowledgeProfilesOptions(wsId),
    enabled: open && !!wsId,
  });
  const match = useMatchEmbeddingModels();
  const create = useCreateEmbeddingProfile(wsId);
  const activate = useActivateEmbeddingProfile(wsId);
  const remove = useDeleteEmbeddingProfile(wsId);

  const [providerKey, setProviderKey] = useState("bailian");
  const [apiKey, setApiKey] = useState("");
  const [customBaseURL, setCustomBaseURL] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [customDims, setCustomDims] = useState("1024");
  const [matched, setMatched] = useState<{
    provider: string;
    base_url: string;
    models: Array<{ name: string; dims: number[]; recommended?: boolean }>;
    manual: boolean;
  } | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedDims, setSelectedDims] = useState<number | null>(null);
  const [error, setError] = useState("");

  const provider: EmbeddingProvider | undefined = useMemo(
    () => providers.find((candidate) => candidate.key === providerKey) ?? providers[0],
    [providers, providerKey],
  );

  useEffect(() => {
    if (open) {
      setMatched(null);
      setSelectedModel("");
      setSelectedDims(null);
      setError("");
    }
  }, [open]);

  useEffect(() => {
    if (!provider) return;
    if (!providers.some((candidate) => candidate.key === providerKey)) {
      setProviderKey(provider.key);
    }
  }, [provider, providerKey, providers]);

  useEffect(() => {
    setMatched(null);
    setSelectedModel("");
    setSelectedDims(null);
    setError("");
  }, [providerKey]);

  const activateByDefault = profiles.length === 0 || !profiles.some((p) => p.is_active);

  const runMatch = () => {
    if (!provider) return;
    setError("");
    match.mutate(
      {
        provider: provider.key,
        api_key: apiKey,
        base_url: provider.manual ? customBaseURL : undefined,
        model: provider.manual ? customModel : undefined,
        dims: provider.manual ? Number(customDims) : undefined,
      },
      {
        onSuccess: (result) => {
          setMatched(result);
          const first =
            result.models.find((model) => model.recommended) ?? result.models[0];
          if (first) {
            setSelectedModel(first.name);
            setSelectedDims(first.dims[0] ?? null);
          }
        },
        onError: (err) => setError(err.message || t(($) => $.embedding_error)),
      },
    );
  };

  const save = () => {
    if (!provider || !matched || !selectedModel || !selectedDims) return;
    setError("");
    create.mutate(
      {
        provider: provider.key,
        base_url: provider.manual ? customBaseURL : matched.base_url,
        model: selectedModel,
        dims: selectedDims,
        api_key: apiKey,
        activate: activateByDefault || profiles.length > 0,
      },
      {
        onSuccess: (created) => {
          toast.success(t(($) => $.embedding_saved_toast));
          onSaved?.(created);
          onOpenChange(false);
        },
        onError: (err) => setError(err.message || t(($) => $.embedding_save_failed)),
      },
    );
  };

  const enable = (profile: EmbeddingProfile) => {
    activate.mutate(profile.id, {
      onError: () => toast.error(t(($) => $.embedding_activate_failed)),
    });
  };

  const removeProfile = (profile: EmbeddingProfile) => {
    remove.mutate(profile.id, {
      onError: (err) => toast.error(err.message || t(($) => $.embedding_delete_failed)),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-title">
            {t(($) => $.embedding_dialog_title)}
          </DialogTitle>
          <DialogDescription className="text-caption">
            {t(($) => $.embedding_dialog_sub)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[68vh] flex-col gap-5 overflow-y-auto pr-1">
          {canAdminister ? (
            <>
              <section className="flex flex-col gap-2.5">
                <h4 className="text-caption font-semibold text-foreground">
                  {t(($) => $.embedding_provider)}
                </h4>
                <div className="grid grid-cols-3 gap-2">
                  {providers.map((candidate) => (
                    <button
                      key={candidate.key}
                      type="button"
                      onClick={() => setProviderKey(candidate.key)}
                      className={cn(
                        "flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                        providerKey === candidate.key
                          ? "border-brand bg-brand/5"
                          : "border-surface-border hover:border-brand/40",
                      )}
                    >
                      <span className="grid size-6 shrink-0 place-items-center rounded bg-foreground text-micro font-semibold text-background">
                        {candidate.manual ? "⌁" : candidate.label.slice(0, 1)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-caption font-medium text-foreground">
                          {candidate.label}
                        </span>
                        <span className="block truncate font-mono text-micro text-muted-foreground">
                          {candidate.manual
                            ? t(($) => $.embedding_compatible)
                            : candidate.base_url.replace(/^https?:\/\//, "")}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="flex flex-col gap-2.5">
                <h4 className="text-caption font-semibold text-foreground">
                  {t(($) => $.embedding_key)}
                </h4>
                {provider?.manual ? (
                  <div className="grid grid-cols-[1fr_180px_100px] gap-2">
                    <Input
                      value={customBaseURL}
                      onChange={(event) => setCustomBaseURL(event.target.value)}
                      placeholder={t(($) => $.embedding_custom_base)}
                      className="h-9 text-caption"
                      aria-label={t(($) => $.embedding_custom_base)}
                    />
                    <Input
                      value={customModel}
                      onChange={(event) => setCustomModel(event.target.value)}
                      placeholder={t(($) => $.embedding_custom_model)}
                      className="h-9 text-caption"
                      aria-label={t(($) => $.embedding_custom_model)}
                    />
                    <Input
                      value={customDims}
                      onChange={(event) => setCustomDims(event.target.value.replace(/[^0-9]/g, ""))}
                      inputMode="numeric"
                      placeholder={t(($) => $.embedding_custom_dims)}
                      className="h-9 text-caption"
                      aria-label={t(($) => $.embedding_custom_dims)}
                    />
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={t(($) => $.embedding_key_placeholder)}
                    autoComplete="off"
                    className="h-9 flex-1 font-mono text-caption"
                    aria-label={t(($) => $.embedding_key)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!apiKey.trim() || match.isPending || (provider?.manual === true && (!customBaseURL.trim() || !customModel.trim()))}
                    onClick={runMatch}
                  >
                    {match.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    {match.isPending ? t(($) => $.embedding_matching) : t(($) => $.embedding_match)}
                  </Button>
                </div>
                <p className="text-micro leading-relaxed text-muted-foreground">
                  {t(($) => $.embedding_key_hint)}
                </p>
                {matched ? (
                  <p className="text-micro text-done">
                    {t(($) => $.embedding_matched, { count: matched.models.length })}
                  </p>
                ) : null}
                {error ? <p className="text-micro text-destructive">{error}</p> : null}
              </section>

              {matched ? (
                <section className="flex flex-col gap-2.5">
                  <h4 className="text-caption font-semibold text-foreground">
                    {t(($) => $.embedding_models)}
                  </h4>
                  <div className="flex flex-col gap-2">
                    {matched.models.map((model) => {
                      const selected = selectedModel === model.name;
                      return (
                        <div
                          key={model.name}
                          className={cn(
                            "flex flex-wrap items-center gap-2.5 rounded-md border px-3 py-2.5",
                            selected ? "border-brand bg-brand/5" : "border-surface-border",
                          )}
                        >
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            onClick={() => {
                              setSelectedModel(model.name);
                              setSelectedDims(model.dims[0] ?? null);
                            }}
                          >
                            <span className="block truncate font-mono text-caption font-semibold text-foreground">
                              {model.name}
                            </span>
                            <span className="mt-0.5 block text-micro text-muted-foreground">
                              {t(($) => $.embedding_model_hint)}
                            </span>
                          </button>
                          <div className="flex gap-1">
                            {model.dims.map((dims) => (
                              <button
                                key={dims}
                                type="button"
                                onClick={() => {
                                  setSelectedModel(model.name);
                                  setSelectedDims(dims);
                                }}
                                className={cn(
                                  "h-6 rounded border px-2 font-mono text-micro",
                                  selected && selectedDims === dims
                                    ? "border-foreground bg-foreground text-background"
                                    : "border-surface-border text-muted-foreground",
                                )}
                              >
                                {dims}
                              </button>
                            ))}
                          </div>
                          {model.recommended ? (
                            <span className="rounded bg-brand px-1.5 py-0.5 font-mono text-micro text-brand-foreground">
                              {t(($) => $.embedding_recommended)}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-micro leading-relaxed text-muted-foreground">
                    {t(($) => $.embedding_dimension_hint)}
                  </p>
                </section>
              ) : null}
            </>
          ) : null}

          <section className="flex flex-col gap-2.5">
            <h4 className="text-caption font-semibold text-foreground">
              {t(($) => $.embedding_saved)}
            </h4>
            {profiles.length === 0 ? (
              <p className="text-micro text-muted-foreground">
                {t(($) => $.embedding_no_profiles)}
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {profiles.map((profile) => (
                  <div
                    key={profile.id}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md border px-3 py-2",
                      profile.is_active ? "border-brand bg-brand/5" : "border-surface-border",
                    )}
                  >
                    <span className="grid size-5 shrink-0 place-items-center rounded bg-foreground text-micro font-semibold text-background">
                      {profile.provider === "openai" ? "O" : profile.provider === "bailian" ? "百" : "⌁"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-caption font-medium text-foreground">
                        {profile.model}
                      </span>
                      <span className="block font-mono text-micro text-muted-foreground">
                        {t(($) => $.embedding_key_line, {
                          dims: profile.dims,
                          hint: profile.key_hint,
                        })}
                      </span>
                    </span>
                    {profile.is_active ? (
                      <span className="rounded bg-brand px-1.5 py-0.5 font-mono text-micro text-brand-foreground">
                        {t(($) => $.embedding_active)}
                      </span>
                    ) : canAdminister ? (
                      <button
                        type="button"
                        onClick={() => enable(profile)}
                        disabled={activate.isPending}
                        className="rounded border border-surface-border px-2 py-1 text-micro text-muted-foreground hover:text-foreground"
                      >
                        {t(($) => $.embedding_activate)}
                      </button>
                    ) : null}
                    {canAdminister && !profile.is_active ? (
                      <button
                        type="button"
                        onClick={() => removeProfile(profile)}
                        disabled={remove.isPending}
                        className="rounded border border-surface-border px-2 py-1 text-micro text-muted-foreground hover:text-destructive"
                      >
                        {t(($) => $.embedding_delete)}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            <p className="text-micro leading-relaxed text-muted-foreground">
              {t(($) => $.embedding_saved_hint)}
            </p>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t(($) => $.cancel)}
          </Button>
          {canAdminister ? (
            <Button
              size="sm"
              disabled={!matched || !selectedModel || selectedDims === null || create.isPending}
              onClick={save}
            >
              {create.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {create.isPending ? t(($) => $.embedding_saving) : t(($) => $.embedding_save)}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
