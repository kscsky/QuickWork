"use client";

import { useState } from "react";
import {
  ArrowLeft,
  Check,
  Download,
  FolderOpen,
  HardDrive,
  Loader2,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@quickwork/core/api";
import type { Skill } from "@quickwork/core/types";
import { useAuthStore } from "@quickwork/core/auth";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useWorkspacePaths } from "@quickwork/core/paths";
import {
  agentListOptions,
  memberListOptions,
  workspaceKeys,
} from "@quickwork/core/workspace/queries";
import { useNavigation } from "../../navigation";
import { useT } from "../../i18n";
import { isNameConflictError } from "../lib/utils";
import { SkillDoc } from "../lib/skill-doc";
import {
  CreateSkillDialog,
  seedAfterCreate,
  type CreateSkillMethod,
} from "./create-skill-dialog";

const SOURCE_ICONS = {
  manual: Plus,
  local: FolderOpen,
  url: Download,
  runtime: HardDrive,
} as const;

const SOURCES: CreateSkillMethod[] = ["manual", "local", "url", "runtime"];

export function CreateSkillPage() {
  const { t } = useT("skills");
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const qc = useQueryClient();
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [importMethod, setImportMethod] = useState<CreateSkillMethod | null>(
    null,
  );
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(
    new Set(),
  );

  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const myRole =
    members.find((member) => member.user_id === currentUserId)?.role ?? null;
  const assignableAgents = agents.filter(
    (agent) =>
      !agent.archived_at &&
      (agent.owner_id === currentUserId ||
        myRole === "owner" ||
        myRole === "admin"),
  );

  const canSubmit = name.trim().length > 0 && !loading;
  const lineCount = content.split("\n").length;
  const checks = [
    {
      key: "name",
      ok: name.trim().length > 0,
      label: t(($) => $.create.builder.check_name),
    },
    {
      key: "description",
      ok: description.trim().length > 0,
      label: t(($) => $.create.builder.check_desc),
    },
    {
      key: "content",
      ok: content.trim().length > 0,
      label: t(($) => $.create.builder.check_content),
    },
  ] as const;

  const back = () => navigation.push(paths.skills());

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError("");
    try {
      const skill = await api.createSkill({
        name: trimmed,
        description: description.trim(),
        content: content.trim() || undefined,
      });
      seedAfterCreate(qc, wsId, skill);
      const agentIds = [...selectedAgentIds];
      if (agentIds.length > 0) {
        const results = await Promise.allSettled(
          agentIds.map((agentId) =>
            api.addAgentSkills(agentId, { skill_ids: [skill.id] }),
          ),
        );
        if (results.some((result) => result.status === "rejected")) {
          toast.warning(t(($) => $.create.builder.add_agents_failed));
        }
        qc.invalidateQueries({ queryKey: workspaceKeys.agents(wsId) });
      }
      toast.success(t(($) => $.create.manual.toast_created));
      navigation.push(paths.skillDetail(skill.id));
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : t(($) => $.create.manual.fallback_error),
      );
      setLoading(false);
    }
  };

  return (
    <div className="qw-ab-page qw-sb-page">
      <div className="qw-ab-topbar">
        <button type="button" className="qw-ab-back" onClick={back}>
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          {t(($) => $.create.page_back)}
        </button>
        <span className="qw-ab-crumb">{t(($) => $.create.builder.crumb)}</span>
        <span className="qw-ab-draft">{t(($) => $.create.builder.draft)}</span>
      </div>

      <div className="qw-ab-body">
        <div className="qw-ab-scroll">
          <div className="qw-ab-wrap">
            <header className="qw-ab-head">
              <h1>{t(($) => $.create.page_title)}</h1>
              <p>{t(($) => $.create.builder.lede)}</p>
            </header>

            <section className="qw-ab-section">
              <div className="qw-ab-sec-head">
                {t(($) => $.create.builder.source)}
              </div>
              <div className="qw-sb-source">
                {SOURCES.map((source) => {
                  const Icon = SOURCE_ICONS[source];
                  return (
                    <button
                      key={source}
                      type="button"
                      data-on={source === "manual" ? "" : undefined}
                      onClick={() => {
                        if (source !== "manual") setImportMethod(source);
                      }}
                    >
                      <Icon aria-hidden="true" />
                      <b>{t(($) => $.create.method[source].title)}</b>
                      <span>{t(($) => $.create.method[source].desc)}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="qw-ab-section">
              <div className="qw-ab-sec-head">
                {t(($) => $.create.builder.identity)}
              </div>
              <div className="qw-ab-row">
                <label className="qw-ab-label" htmlFor="qw-sb-name">
                  {t(($) => $.create.manual.name_label)}
                  <span>{t(($) => $.create.manual.name_hint)}</span>
                </label>
                <input
                  id="qw-sb-name"
                  className="qw-ab-input"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setError("");
                  }}
                  placeholder={t(($) => $.create.manual.name_placeholder)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="qw-ab-row align-start">
                <label className="qw-ab-label" htmlFor="qw-sb-description">
                  {t(($) => $.create.manual.description_label)}
                  <span>{t(($) => $.create.page_description_hint)}</span>
                </label>
                <div className="qw-ab-control">
                  <input
                    id="qw-sb-description"
                    className="qw-ab-input"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder={t(
                      ($) => $.create.manual.description_placeholder,
                    )}
                    maxLength={255}
                    autoComplete="off"
                  />
                  {error ? (
                    <p className="qw-ab-error" role="alert">
                      {error}
                      {isNameConflictError(error) &&
                        t(($) => $.create.manual.name_conflict_hint)}
                    </p>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="qw-ab-section">
              <div className="qw-ab-sec-head">
                {t(($) => $.create.builder.instructions)}
              </div>
              <textarea
                className="qw-ab-textarea qw-sb-editor"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder={t(($) => $.create.page_content_placeholder)}
                spellCheck={false}
                rows={12}
                aria-label={t(($) => $.create.page_content_label)}
              />
              <div className="qw-sb-editor-foot">
                <span>{t(($) => $.create.builder.editor_foot)}</span>
                <span>
                  {t(($) => $.create.builder.line_count, {
                    count: lineCount,
                  })}
                </span>
              </div>
            </section>

            <section className="qw-ab-section">
              <div className="qw-ab-sec-head">
                {t(($) => $.create.builder.agents)}
              </div>
              <p className="qw-ab-hint">{t(($) => $.create.builder.agents_hint)}</p>
              {assignableAgents.length === 0 ? (
                <p className="qw-ab-hint">
                  {t(($) => $.create.builder.no_agents)}
                </p>
              ) : (
                <div className="qw-ab-skills">
                  {assignableAgents.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      className="qw-sb-agent"
                      data-on={
                        selectedAgentIds.has(agent.id) ? "" : undefined
                      }
                      onClick={() =>
                        setSelectedAgentIds((current) => {
                          const next = new Set(current);
                          if (next.has(agent.id)) next.delete(agent.id);
                          else next.add(agent.id);
                          return next;
                        })
                      }
                    >
                      <i aria-hidden="true">
                        {agent.name.slice(0, 1).toUpperCase()}
                      </i>
                      {agent.name}
                    </button>
                  ))}
                </div>
              )}
            </section>

            <footer className="qw-ab-foot">
              <button
                type="button"
                className="qw-ab-cancel"
                onClick={back}
                disabled={loading}
              >
                {t(($) => $.create.manual.cancel)}
              </button>
              <button
                type="button"
                className="qw-ab-create"
                onClick={() => void submit()}
                disabled={!canSubmit}
              >
                {loading ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : null}
                {loading
                  ? t(($) => $.create.manual.submitting)
                  : t(($) => $.create.manual.submit)}
              </button>
            </footer>
          </div>
        </div>

        <aside className="qw-ab-preview qw-sb-preview">
          <div className="qw-ab-prev-head">{t(($) => $.create.builder.preview)}</div>
          <div className="qw-sb-sheet">
            <div className="qw-sb-sheet-top">
              <span className="qw-sb-sheet-file">{t(($) => $.create.page_content_label)}</span>
              <span className="qw-sb-sheet-tag">
                {t(($) => $.create.builder.sheet_tag)}
              </span>
            </div>
            <h2>{name.trim() || t(($) => $.create.builder.untitled)}</h2>
            <p className="qw-sb-sheet-desc">
              {description.trim() || t(($) => $.create.builder.empty_desc)}
            </p>
            {content.trim() ? (
              <SkillDoc
                path="SKILL.md"
                content={content}
                className="qw-sk-doc qw-sb-doc"
              />
            ) : (
              <p className="qw-sb-sheet-empty">
                {t(($) => $.create.builder.empty_doc)}
              </p>
            )}
          </div>

          <div className="qw-sb-checks">
            {checks.map((check) => (
              <div
                key={check.key}
                className="qw-sb-check"
                data-on={check.ok ? "" : undefined}
              >
                <span className="dot" aria-hidden="true">
                  <Check className="size-2" />
                </span>
                {check.label}
              </div>
            ))}
          </div>

          <p className="qw-sb-consequence">
            {t(($) => $.create.builder.consequence)}
          </p>
        </aside>
      </div>

      {importMethod ? (
        <CreateSkillDialog
          initialMethod={importMethod}
          onClose={() => setImportMethod(null)}
          onCreated={(skill: Skill) => {
            setImportMethod(null);
            navigation.push(paths.skillDetail(skill.id));
          }}
        />
      ) : null}
    </div>
  );
}
