"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";
import type { KnowledgeEntry } from "@quickwork/core/types";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useWorkspacePaths } from "@quickwork/core/paths";
import { useCurrentMember } from "@quickwork/core/permissions";
import {
  knowledgeListOptions,
  knowledgeSearchOptions,
} from "@quickwork/core/knowledge/queries";
import {
  useArchiveKnowledgeEntry,
  usePublishKnowledgeEntry,
  useReindexKnowledge,
} from "@quickwork/core/knowledge/mutations";

import { AppLink } from "../../navigation";
import { useT } from "../../i18n";

type Filter = "all" | "published" | "draft" | "archived";

const FILTERS: Filter[] = ["all", "published", "draft", "archived"];

function plainPreview(body: string, limit = 240): string {
  return body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

/**
 * The workspace knowledge base. A finished relay deposits one summary
 * document plus FAQ drafts; this page lists them, searches them (vector when
 * an embedding provider is configured, trigram otherwise), and lets an owner
 * publish or archive entries. Drafts never surface in retrieval.
 */
export function KnowledgePage() {
  const { t } = useT("knowledge");
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const { role } = useCurrentMember(wsId);
  const canAdminister = role === "owner" || role === "admin";
  const [filter, setFilter] = useState<Filter>("all");
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");

  const { data, isPending } = useQuery(knowledgeListOptions(wsId));
  const { data: search, isFetching: searching } = useQuery(
    knowledgeSearchOptions(wsId, query),
  );
  const publishEntry = usePublishKnowledgeEntry(wsId);
  const archiveEntry = useArchiveKnowledgeEntry(wsId);
  const reindex = useReindexKnowledge(wsId);

  const entries = data?.entries ?? [];
  const stats = data?.stats ?? {};
  const embedding = data?.embedding ?? { enabled: false, model: "", dims: 0 };
  const visible = useMemo(
    () => (filter === "all" ? entries : entries.filter((entry) => entry.status === filter)),
    [entries, filter],
  );
  const searchingNow = query.trim().length > 0;

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
    reindex.mutate(undefined, {
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

        {searchingNow ? (
          <p className="kb-mode">
            {search?.mode === "vector"
              ? t(($) => $.mode_vector, { model: embedding.model })
              : t(($) => $.mode_keyword)}
          </p>
        ) : null}

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
                      onClick={() => setFilter(value)}
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
            <section className="kb-card">
              <div className="kb-label">{t(($) => $.index)}</div>
              <div className="kb-index">
                <i className={embedding.enabled ? "" : "off"} />
                <span>
                  {embedding.enabled
                    ? t(($) => $.index_on, { model: embedding.model, dims: embedding.dims })
                    : t(($) => $.index_off)}
                </span>
                {canAdminister && embedding.enabled ? (
                  <button
                    type="button"
                    className="kb-rebuild"
                    disabled={reindex.isPending}
                    onClick={handleReindex}
                  >
                    {reindex.isPending ? t(($) => $.reindex_pending) : t(($) => $.reindex)}
                  </button>
                ) : null}
              </div>
            </section>
            <p className="kb-note">{t(($) => $.note)}</p>
          </aside>
        </div>
      </div>
    </div>
  );
}
