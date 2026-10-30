"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";
import type { EmbeddingProfile, KnowledgeCorpus, KnowledgeEntry } from "@quickwork/core/types";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useWorkspacePaths } from "@quickwork/core/paths";
import { useCurrentMember } from "@quickwork/core/permissions";
import {
  knowledgeListOptions,
  knowledgeProfilesOptions,
  knowledgeSearchOptions,
} from "@quickwork/core/knowledge/queries";
import {
  useArchiveKnowledgeEntry,
  usePublishKnowledgeEntry,
  useReindexKnowledge,
} from "@quickwork/core/knowledge/mutations";

import { AppLink } from "../../navigation";
import { useT } from "../../i18n";
import { EmbeddingProfileDialog } from "./embedding-profile-dialog";

type Filter = "all" | "published" | "draft" | "archived";
/** A corpus is an embedding profile, not a bare dimension: two models can
 *  produce the same width and their vectors are still incomparable. */
type Corpus = string | "unindexed" | null;

const FILTERS: Filter[] = ["all", "published", "draft", "archived"];

function plainPreview(body: string, limit = 240): string {
  return body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function providerMark(provider: string): string {
  return provider === "openai" ? "O" : provider === "bailian" ? "百" : "⌁";
}

/**
 * The workspace knowledge base. A finished relay deposits one summary
 * document plus FAQ drafts. Every published entry is stamped with the
 * embedding profile it was deposited under, so the list, search and the
 * agent all operate on one dimension's corpus at a time.
 */
export function KnowledgePage() {
  const { t } = useT("knowledge");
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const { role } = useCurrentMember(wsId);
  const canAdminister = role === "owner" || role === "admin";
  const [filter, setFilter] = useState<Filter>("all");
  const [corpus, setCorpus] = useState<Corpus>(null);
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);

  const { data: profileData = [] } = useQuery(knowledgeProfilesOptions(wsId));
  const activeProfile = profileData.find((profile) => profile.is_active) ?? null;
  const effectiveCorpus: Corpus = corpus ?? activeProfile?.id ?? null;
  const { data, isPending } = useQuery(
    knowledgeListOptions(wsId, effectiveCorpus),
  );
  const profiles = data?.profiles?.length ? data.profiles : profileData;
  const corpora = useMemo(() => data?.corpora ?? [], [data?.corpora]);
  const unindexed = data?.unindexed ?? 0;
  const selectedProfile =
    typeof effectiveCorpus === "string"
      ? profiles.find((profile) => profile.id === effectiveCorpus) ?? null
      : null;
  const searchProfileId = selectedProfile?.id ?? activeProfile?.id;
  const { data: search, isFetching: searching } = useQuery(
    knowledgeSearchOptions(wsId, query, 5, searchProfileId),
  );
  const publishEntry = usePublishKnowledgeEntry(wsId);
  const archiveEntry = useArchiveKnowledgeEntry(wsId);
  const reindex = useReindexKnowledge(wsId);

  const entries = useMemo(() => data?.entries ?? [], [data?.entries]);
  const stats = useMemo(() => data?.stats ?? {}, [data?.stats]);
  const visible = useMemo(
    () => (filter === "all" ? entries : entries.filter((entry) => entry.status === filter)),
    [entries, filter],
  );
  const searchingNow = query.trim().length > 0;
  const publishedTotal = useMemo(
    () =>
      Object.entries(stats)
        .filter(([key]) => key.endsWith(":published"))
        .reduce((sum, [, count]) => sum + count, 0),
    [stats],
  );
  const dimsMultiplicity = useMemo(() => {
    const counts = new Map<number, number>();
    for (const group of corpora) {
      counts.set(group.dims, (counts.get(group.dims) ?? 0) + 1);
    }
    return counts;
  }, [corpora]);
  const drafts = useMemo(
    () => (stats["faq:draft"] ?? 0) + (stats["summary:draft"] ?? 0),
    [stats],
  );
  const statusLabel = (status: string) =>
    status === "published"
      ? t(($) => $.status_published)
      : status === "draft"
        ? t(($) => $.status_draft)
        : status === "archived"
          ? t(($) => $.status_archived)
          : status;

  const providerLabel = (provider: string) =>
    provider === "bailian"
      ? t(($) => $.provider_bailian)
      : provider === "openai"
        ? t(($) => $.provider_openai)
        : provider === "env"
          ? t(($) => $.provider_env)
          : t(($) => $.provider_custom);

  const submitSearch = () => {
    setQuery(draftQuery.trim());
  };

  const handlePublish = (entry: KnowledgeEntry) => {
    publishEntry.mutate(entry.id, {
      onSuccess: () => toast.success(t(($) => $.status_published)),
      onError: () => toast.error(t(($) => $.deposit_failed)),
    });
  };

  const handleArchive = (entry: KnowledgeEntry) => {
    archiveEntry.mutate(entry.id, {
      onSuccess: () => toast.success(t(($) => $.status_archived)),
      onError: () => toast.error(t(($) => $.deposit_failed)),
    });
  };

  const handleReindex = () => {
    reindex.mutate(selectedProfile?.id ?? activeProfile?.id, {
      onSuccess: (result) =>
        toast.success(t(($) => $.reindex_done, { count: result.embedded })),
      onError: () => toast.error(t(($) => $.deposit_failed)),
    });
  };

  const entryRow = (entry: KnowledgeEntry, score?: number) => (
    <article key={entry.id} className="kb-result">
      <div className="kb-result-head">
        <span className={entry.kind === "summary" ? "kb-tag faq" : "kb-tag"}>
          {entry.kind === "summary" ? t(($) => $.kind_summary) : t(($) => $.kind_faq)}
        </span>
        <span className="kb-tag">{statusLabel(entry.status)}</span>
        <span className="kb-tag dim">
          {entry.embedding_dims
            ? t(($) => $.dimension_badge, { dims: entry.embedding_dims })
            : t(($) => $.unindexed_badge)}
        </span>
        {typeof score === "number" && search?.mode === "vector" ? (
          <span className="kb-score">
            {t(($) => $.similarity, { score: score.toFixed(2) })}
          </span>
        ) : null}
        {canAdminister ? (
          <span className="kb-actions">
            {entry.status === "draft" ? (
              <button type="button" className="kb-action" onClick={() => handlePublish(entry)}>
                {t(($) => $.publish)}
              </button>
            ) : null}
            {entry.status === "published" ? (
              <button type="button" className="kb-action" onClick={() => handleArchive(entry)}>
                {t(($) => $.archive)}
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      <p className="kb-q">{entry.title}</p>
      <p className="kb-a">{plainPreview(entry.body)}</p>
      <div className="kb-meta">
        {entry.source_issue_id ? (
          <AppLink href={paths.issueDetail(entry.source_issue_id)}>
            {t(($) => $.source)}
            {entry.source_leg ? ` · ${t(($) => $.source_leg, { leg: entry.source_leg + 1 })}` : ""}
          </AppLink>
        ) : null}
        {entry.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="kb-tag">
            {tag}
          </span>
        ))}
      </div>
    </article>
  );

  const selectCorpus = (next: Corpus) => {
    setCorpus(next);
    if (filter === "draft") setFilter("all");
  };

  const corpusButton = (group: KnowledgeCorpus) => (
    <button
      key={group.profile_id}
      type="button"
      title={`${group.model} · ${group.entries}`}
      className={effectiveCorpus === group.profile_id ? "on" : undefined}
      onClick={() => selectCorpus(group.profile_id)}
    >
      {t(($) => $.corpus_dims, { dims: group.dims })}
      {(dimsMultiplicity.get(group.dims) ?? 0) > 1 ? ` · ${group.model}` : ""}
      <em>{group.entries}</em>
    </button>
  );

  const modelProfile: EmbeddingProfile | null = selectedProfile ?? activeProfile;
  const activeCorpusEntries = modelProfile
    ? corpora.find((group) => group.profile_id === modelProfile.id)?.entries ?? 0
    : 0;
  const coverage = publishedTotal > 0 ? publishedTotal : Math.max(activeCorpusEntries + unindexed, 1);

  return (
    <div className="kb-main">
      <div className="kb-wrap">
        <header className="kb-head">
          <p className="kb-kicker">{t(($) => $.kicker)}</p>
          <h1 className="kb-title">
            {t(($) => $.title)}
            <span className="kb-sub">{t(($) => $.sub)}</span>
          </h1>
        </header>

        <div className="kb-search">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            className="q"
            value={draftQuery}
            placeholder={t(($) => $.search_placeholder)}
            onChange={(event) => setDraftQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitSearch();
            }}
            aria-label={t(($) => $.search_placeholder)}
          />
          {searchingNow ? (
            <button
              type="button"
              className="kb-clear"
              onClick={() => {
                setQuery("");
                setDraftQuery("");
              }}
            >
              ×
            </button>
          ) : null}
          <button type="button" className="go" onClick={submitSearch}>
            {t(($) => $.search_action)}
          </button>
        </div>

        <div className="kb-mode-line">
          <span className="tag">
            {searchingNow ? (search?.mode === "vector" ? "VECTOR" : "KEYWORD") : "CORPUS"}
          </span>
          <span>
            {searchingNow
              ? search?.mode === "vector" && search.profile
                ? t(($) => $.mode_profile, {
                    provider: providerLabel(search.profile.provider),
                    model: search.profile.model,
                    dims: search.profile.dims,
                  })
                : t(($) => $.mode_keyword)
              : modelProfile
                ? t(($) => $.mode_profile, {
                    provider: providerLabel(modelProfile.provider),
                    model: modelProfile.model,
                    dims: modelProfile.dims,
                  })
                : t(($) => $.model_unconfigured)}
          </span>
          <em>
            {searchingNow
              ? t(($) => $.results, { count: search?.hits.length ?? 0 })
              : t(($) => $.list_count, { count: visible.length })}
          </em>
        </div>

        <div className="kb-body">
          <div>
            {searchingNow ? (
              <>
                <div className="kb-list-head">
                  <span>{t(($) => $.results, { count: search?.hits.length ?? 0 })}</span>
                  <em>{t(($) => $.results_hint)}</em>
                </div>
                {searching ? (
                  <p className="kb-empty">
                    <Loader2 className="size-3.5 animate-spin" />
                  </p>
                ) : search && search.hits.length > 0 ? (
                  search.hits.map((hit) => entryRow(hit.entry, hit.score))
                ) : (
                  <p className="kb-empty">{t(($) => $.no_results)}</p>
                )}
              </>
            ) : (
              <>
                <div className="kb-filters">
                  {FILTERS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={filter === value ? "kb-filter on" : "kb-filter"}
                      onClick={() => {
                        setFilter(value);
                        if (value === "draft") setCorpus("unindexed");
                      }}
                    >
                      {value === "all"
                        ? t(($) => $.filter_all)
                        : value === "published"
                          ? t(($) => $.filter_published)
                          : value === "draft"
                            ? t(($) => $.filter_draft)
                            : t(($) => $.filter_archived)}
                      {value === "draft" && drafts > 0 ? <em>{drafts}</em> : null}
                    </button>
                  ))}
                </div>
                {isPending ? (
                  <p className="kb-empty">
                    <Loader2 className="size-3.5 animate-spin" />
                  </p>
                ) : visible.length === 0 ? (
                  <p className="kb-empty">{t(($) => $.empty)}</p>
                ) : (
                  visible.map((entry) => entryRow(entry))
                )}
              </>
            )}
          </div>

          <aside className="kb-side">
            <section className="kb-card">
              <div className="kb-label">{t(($) => $.model_title)}</div>
              {modelProfile ? (
                <>
                  <div className="kb-em-top">
                    <span className="kb-em-mark">{providerMark(modelProfile.provider)}</span>
                    <span className="kb-em-name">
                      <b>{modelProfile.model}</b>
                      <em>
                        {providerLabel(modelProfile.provider)} · {modelProfile.dims}{" "}
                        {t(($) => $.dims_short)}
                      </em>
                    </span>
                    <i className="kb-em-dot" />
                  </div>
                  <div className="kb-em-key">
                    <span>{t(($) => $.model_key)}</span>
                    <code>••••{modelProfile.key_hint}</code>
                    <span className="ok">{t(($) => $.model_verified)}</span>
                  </div>
                </>
              ) : (
                <p className="kb-corpus-hint">{t(($) => $.model_unconfigured)}</p>
              )}

              <div className="kb-em-corpus">
                {corpora.map((group) => corpusButton(group))}
                <button
                  type="button"
                  className={effectiveCorpus === "unindexed" ? "on" : undefined}
                  onClick={() => selectCorpus("unindexed")}
                >
                  {t(($) => $.unindexed_badge)}
                  <em>{unindexed}</em>
                </button>
              </div>

              {modelProfile ? (
                <div className="kb-em-cover">
                  <div className="row">
                    <span>{t(($) => $.model_coverage, { dims: modelProfile.dims })}</span>
                    <b>
                      {activeCorpusEntries} / {coverage}
                    </b>
                  </div>
                  <span className="bar">
                    <i style={{ width: `${Math.min(100, (activeCorpusEntries / coverage) * 100)}%` }} />
                  </span>
                </div>
              ) : null}

              {canAdminister ? (
                <div className="kb-em-actions">
                  <button
                    type="button"
                    className="kb-rebuild"
                    onClick={() => setProfileDialogOpen(true)}
                  >
                    {modelProfile ? t(($) => $.model_change) : t(($) => $.model_configure)}
                  </button>
                  {modelProfile ? (
                    <button
                      type="button"
                      className="kb-rebuild"
                      disabled={reindex.isPending}
                      onClick={handleReindex}
                    >
                      {reindex.isPending
                        ? t(($) => $.model_reindexing)
                        : t(($) => $.model_reindex)}
                    </button>
                  ) : null}
                </div>
              ) : null}
              <p className="kb-corpus-hint">{t(($) => $.corpus_hint)}</p>
            </section>

            <section className="kb-card">
              <div className="kb-label">{t(($) => $.corpus)}</div>
              <div className="kb-stat">
                <span>{t(($) => $.corpus_summary)}</span>
                <b>{stats["summary:published"] ?? 0}</b>
              </div>
              <div className="kb-stat">
                <span>{t(($) => $.corpus_faq)}</span>
                <b>{stats["faq:published"] ?? 0}</b>
              </div>
              <div className="kb-stat">
                <span>{t(($) => $.filter_draft)}</span>
                <b>{drafts}</b>
              </div>
              <div className="kb-stat">
                <span>{t(($) => $.unindexed_badge)}</span>
                <b>{unindexed}</b>
              </div>
            </section>

            <section className="kb-card">
              <div className="kb-label">{t(($) => $.ingest)}</div>
              <div className="kb-rule"><span className="n">01</span><span>{t(($) => $.ingest_1)}</span></div>
              <div className="kb-rule"><span className="n">02</span><span>{t(($) => $.ingest_2)}</span></div>
              <div className="kb-rule"><span className="n">03</span><span>{t(($) => $.ingest_3)}</span></div>
            </section>
            <section className="kb-card">
              <div className="kb-label">{t(($) => $.retrieve)}</div>
              <div className="kb-rule"><span className="n">01</span><span>{t(($) => $.retrieve_1)}</span></div>
              <div className="kb-rule"><span className="n">02</span><span>{t(($) => $.retrieve_2)}</span></div>
            </section>
            <p className="kb-note">{t(($) => $.note)}</p>
          </aside>
        </div>
      </div>

      <EmbeddingProfileDialog
        wsId={wsId}
        open={profileDialogOpen}
        onOpenChange={setProfileDialogOpen}
        canAdminister={canAdminister}
      />
    </div>
  );
}
