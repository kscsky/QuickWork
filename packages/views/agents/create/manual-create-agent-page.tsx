"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  applyDraftModelChange,
  applyDraftRuntimeChange,
  type AgentPermissionScope,
} from "@quickwork/core/agents";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useWorkspacePaths } from "@quickwork/core/paths";
import { runtimeDisplayLabel } from "@quickwork/core/runtimes";
import { agentListOptions } from "@quickwork/core/workspace/queries";
import { resolvePublicFileUrl } from "@quickwork/core/workspace/avatar-url";
import { ActorAvatar as ActorAvatarBase } from "@quickwork/ui/components/common/actor-avatar";
import { useBackOrReplace, useNavigation } from "../../navigation";
import { useT } from "../../i18n";
import { AvatarUploadControl } from "../../common/avatar-upload-control";
import { ModelDropdown } from "../components/model-dropdown";
import { RuntimePicker } from "../components/runtime-picker";
import { ThinkingSettingField } from "../components/inspector/thinking-prop-row";
import { ServiceTierSettingField } from "../components/inspector/service-tier-setting-field";
import { ConversationStartersEditor } from "../components/conversation-starters-editor";
import { useCreateAgentForm } from "./use-create-agent-form";
import { useCreateAgentSubmit } from "./use-create-agent-submit";
import { useDuplicateDraftSeed } from "./use-duplicate-draft-seed";
import {
  clearManualDraftForOwner,
  useManualDraftSync,
} from "./use-manual-draft-sync";

const PERMISSION_SCOPES: AgentPermissionScope[] = [
  "private",
  "workspace",
  "members",
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

/**
 * Manual agent creation in the refresh builder layout: the form on the left,
 * a live seat card on the right. Every field still writes through
 * `useCreateAgentForm`, so duplicate seeding, draft persistence and submit
 * semantics are unchanged.
 */
export function ManualCreateAgentPage() {
  const { t } = useT("agents");
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const backOrReplace = useBackOrReplace();
  const duplicateId = navigation.searchParams.get("duplicate");
  const squadId = navigation.searchParams.get("squad");

  const form = useCreateAgentForm();
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const duplicateAgent = duplicateId
    ? agents.find((agent) => agent.id === duplicateId) ?? null
    : null;

  const [duplicateRuntimeReset, setDuplicateRuntimeReset] = useState(false);
  const [duplicateSeeded, setDuplicateSeeded] = useState(false);
  const [capacity, setCapacity] = useState<number | null>(null);

  useDuplicateDraftSeed({
    source: duplicateAgent,
    runtimesSettled: form.runtimesSettled,
    runtimes: form.runtimes,
    currentUserId: form.currentUserId,
    fallbackRuntimeId: form.usableRuntimes[0]?.id ?? "",
    nameSuffix: t(($) => $.create_dialog.duplicate_copy_suffix),
    onSeed: (duplicated, runtimeReset) => {
      setDuplicateRuntimeReset(runtimeReset);
      form.setDraft(duplicated);
      setDuplicateSeeded(true);
    },
  });

  useManualDraftSync({
    duplicateId,
    draft: form.draft,
    setDraft: form.setDraft,
    ready: !duplicateId || duplicateSeeded,
  });

  const submit = useCreateAgentSubmit({
    draft: form.draft,
    runtimeId: form.selectedRuntime?.id ?? null,
    squadId,
    duplicateSource: duplicateAgent,
    maxConcurrentTasks: capacity ?? undefined,
    onCreated: () => clearManualDraftForOwner(duplicateId),
  });

  const canCreate =
    form.draft.name.trim().length > 0 && form.draftReady && !submit.creating;

  const { draft, setDraft } = form;
  const selectedRuntime = form.selectedRuntime;
  const runtimeOnline = selectedRuntime?.status === "online";
  const title = duplicateAgent
    ? t(($) => $.creation_studio.duplicate_title, {
        name: duplicateAgent.name,
      })
    : squadId
      ? t(($) => $.creation_studio.squad_title)
      : t(($) => $.creation_studio.title);

  const ownerName = useMemo(
    () =>
      form.members.find((member) => member.user_id === form.currentUserId)
        ?.name ?? "—",
    [form.members, form.currentUserId],
  );
  const otherMembers = form.members.filter(
    (member) => member.user_id !== form.currentUserId,
  );
  const selectedSkills = form.workspaceSkills.filter((skill) =>
    draft.skillIds.has(skill.id),
  );
  const accessInvalid =
    draft.permissionScope === "members" &&
    draft.memberIds.size === 0 &&
    draft.teamIds.size === 0;

  const handleBack = () =>
    backOrReplace(duplicateId ? paths.agents() : paths.newAgent());

  return (
    <div className="qw-ab-page">
      <div className="qw-ab-topbar">
        <button type="button" className="qw-ab-back" onClick={handleBack}>
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          {t(($) => $.builder.back)}
        </button>
        <span className="qw-ab-crumb">{t(($) => $.builder.crumb)}</span>
        <span className="qw-ab-draft">{t(($) => $.builder.draft)}</span>
      </div>

      <div className="qw-ab-body">
        <div className="qw-ab-scroll">
          <div className="qw-ab-wrap">
            <header className="qw-ab-head">
              <h1>{title}</h1>
              <p>{t(($) => $.builder.lede)}</p>
            </header>

            {duplicateAgent ? (
              <div className="qw-ab-notice">
                {t(($) => $.creation_studio.duplicate_env_notice)}
              </div>
            ) : null}
            {duplicateRuntimeReset ? (
              <div className="qw-ab-notice">
                {t(($) => $.creation_studio.duplicate_runtime_reset_notice)}
              </div>
            ) : null}

            <section className="qw-ab-section">
              <div className="qw-ab-sec-head">
                {t(($) => $.creation_studio.sections.identity)}
              </div>
              <div className="qw-ab-row">
                <div className="qw-ab-label">
                  {t(($) => $.builder.avatar)}
                </div>
                <AvatarUploadControl
                  variant="agent"
                  value={draft.avatarUrl}
                  name={draft.name}
                  size={44}
                  onUploaded={(url) => setDraft((d) => ({ ...d, avatarUrl: url }))}
                  onEmojiSelected={(url) =>
                    setDraft((d) => ({ ...d, avatarUrl: url }))
                  }
                  onClear={() => setDraft((d) => ({ ...d, avatarUrl: null }))}
                />
              </div>
              <div className="qw-ab-row align-start">
                <label className="qw-ab-label" htmlFor="qw-ab-name">
                  {t(($) => $.builder.name)}
                  <span>{t(($) => $.builder.name_hint)}</span>
                </label>
                <div className="qw-ab-control">
                  <input
                    id="qw-ab-name"
                    className="qw-ab-input"
                    value={draft.name}
                    onChange={(event) => {
                      submit.clearNameError();
                      setDraft((d) => ({ ...d, name: event.target.value }));
                    }}
                    placeholder={t(($) => $.create_dialog.name_placeholder)}
                    aria-label={t(($) => $.create_dialog.name_label)}
                    aria-invalid={!!submit.nameError}
                    autoComplete="off"
                  />
                  {submit.nameError ? (
                    <p className="qw-ab-error" role="alert">
                      {submit.nameError}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="qw-ab-row align-start">
                <label className="qw-ab-label" htmlFor="qw-ab-description">
                  {t(($) => $.builder.description)}
                  <span>{t(($) => $.builder.description_hint)}</span>
                </label>
                <textarea
                  id="qw-ab-description"
                  className="qw-ab-textarea short"
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((d) => ({
                      ...d,
                      description: event.target.value,
                    }))
                  }
                  placeholder={t(($) => $.create_dialog.description_placeholder)}
                  aria-label={t(($) => $.create_dialog.description_label)}
                  rows={3}
                  maxLength={255}
                />
              </div>
            </section>

            <section className="qw-ab-section">
              <div className="qw-ab-sec-head">
                {t(($) => $.creation_studio.sections.execution)}
              </div>
              <div className="qw-ab-row qw-ab-picker-row">
                <div className="qw-ab-picker">
                  <RuntimePicker
                    runtimes={form.runtimes}
                    runtimesLoading={form.runtimesLoading}
                    members={form.members}
                    currentUserId={form.currentUserId}
                    selectedRuntimeId={draft.runtimeId}
                    onSelect={(id) =>
                      setDraft((current) =>
                        applyDraftRuntimeChange(current, id),
                      )
                    }
                  />
                </div>
              </div>
              <div className="qw-ab-row qw-ab-picker-row qw-ab-model">
                <div className="qw-ab-picker">
                  <ModelDropdown
                    runtimeId={selectedRuntime?.id ?? null}
                    runtimeOnline={runtimeOnline === true}
                    value={draft.model}
                    onChange={(value) =>
                      setDraft((current) =>
                        applyDraftModelChange(current, value),
                      )
                    }
                    disabled={!selectedRuntime}
                  />
                </div>
              </div>
              <div className="qw-ab-row">
                <div className="qw-ab-label">
                  {t(($) => $.builder.capacity)}
                  <span>{t(($) => $.builder.capacity_hint)}</span>
                </div>
                <div className="qw-ab-capacity">
                  <div className="qw-ab-steps">
                    {[1, 2, 3].map((value) => (
                      <button
                        key={value}
                        type="button"
                        data-on={capacity === value ? "" : undefined}
                        onClick={() =>
                          setCapacity((current) =>
                            current === value ? null : value,
                          )
                        }
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                  <span className="qw-ab-steps-note">
                    {capacity === null
                      ? t(($) => $.builder.capacity_default)
                      : t(($) => $.builder.capacity_set, { count: capacity })}
                  </span>
                </div>
              </div>
              <div className="qw-ab-native">
                <ThinkingSettingField
                  label={t(($) => $.creation_studio.thinking_label)}
                  runtimeId={selectedRuntime?.id ?? null}
                  runtimeOnline={runtimeOnline === true}
                  provider={selectedRuntime?.provider ?? ""}
                  model={draft.model}
                  value={draft.thinkingLevel}
                  canEdit
                  onChange={(thinkingLevel) =>
                    setDraft((current) => ({ ...current, thinkingLevel }))
                  }
                />
                <ServiceTierSettingField
                  label={t(($) => $.creation_studio.speed_label)}
                  runtimeId={selectedRuntime?.id ?? null}
                  runtimeOnline={runtimeOnline === true}
                  provider={selectedRuntime?.provider ?? ""}
                  model={draft.model}
                  value={draft.serviceTier}
                  canEdit
                  onChange={(serviceTier) =>
                    setDraft((current) => ({ ...current, serviceTier }))
                  }
                />
              </div>
            </section>

            <section className="qw-ab-section">
              <div className="qw-ab-sec-head">
                {t(($) => $.builder.instructions)}
              </div>
              <textarea
                className="qw-ab-textarea"
                value={draft.instructions}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    instructions: event.target.value,
                  }))
                }
                placeholder={t(
                  ($) => $.create_dialog.instructions.editor_placeholder,
                )}
                aria-label={t(($) => $.create_dialog.instructions.label)}
                rows={7}
              />
              <details className="qw-ab-advanced">
                <summary>{t(($) => $.builder.starters)}</summary>
                <ConversationStartersEditor
                  value={draft.conversationStarters}
                  onChange={(conversationStarters) =>
                    setDraft((current) => ({
                      ...current,
                      conversationStarters,
                    }))
                  }
                />
              </details>
            </section>

            <section className="qw-ab-section">
              <div className="qw-ab-sec-head">{t(($) => $.builder.skills)}</div>
              <p className="qw-ab-hint">{t(($) => $.builder.skills_hint)}</p>
              {form.workspaceSkills.length === 0 ? (
                <p className="qw-ab-hint">{t(($) => $.builder.no_skills)}</p>
              ) : (
                <div className="qw-ab-skills">
                  {form.workspaceSkills.map((skill) => (
                    <button
                      key={skill.id}
                      type="button"
                      className="qw-ab-skill"
                      data-on={draft.skillIds.has(skill.id) ? "" : undefined}
                      onClick={() =>
                        setDraft((current) => {
                          const next = new Set(current.skillIds);
                          if (next.has(skill.id)) next.delete(skill.id);
                          else next.add(skill.id);
                          return { ...current, skillIds: next };
                        })
                      }
                    >
                      {skill.name}
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="qw-ab-section">
              <div className="qw-ab-sec-head">{t(($) => $.builder.access)}</div>
              <div className="qw-ab-row">
                <div className="qw-ab-label">
                  {t(($) => $.builder.visibility)}
                  <span>{t(($) => $.builder.visibility_hint)}</span>
                </div>
                <div className="qw-ab-seg" role="radiogroup" aria-label={t(($) => $.builder.visibility)}>
                  {PERMISSION_SCOPES.map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      role="radio"
                      aria-checked={draft.permissionScope === scope}
                      data-on={
                        draft.permissionScope === scope ? "" : undefined
                      }
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          permissionScope: scope,
                        }))
                      }
                    >
                      {t(($) => $.creation_studio.access[scope].title)}
                    </button>
                  ))}
                </div>
              </div>
              {draft.permissionScope === "members" ? (
                <div className="qw-ab-members">
                  {otherMembers.map((member) => {
                    const checked = draft.memberIds.has(member.user_id);
                    return (
                      <label key={member.user_id} className="qw-ab-member">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) =>
                            setDraft((current) => {
                              const next = new Set(current.memberIds);
                              if (event.target.checked) next.add(member.user_id);
                              else next.delete(member.user_id);
                              return { ...current, memberIds: next };
                            })
                          }
                        />
                        <ActorAvatarBase
                          name={member.name}
                          initials={initialsOf(member.name)}
                          avatarUrl={resolvePublicFileUrl(member.avatar_url)}
                          size="sm"
                        />
                        <span>{member.name}</span>
                      </label>
                    );
                  })}
                  {accessInvalid ? (
                    <p className="qw-ab-error" role="alert">
                      {t(($) => $.creation_studio.access.members.required)}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>

            <footer className="qw-ab-foot">
              {submit.formError ? (
                <p className="qw-ab-error" role="alert">
                  {submit.formError}
                </p>
              ) : null}
              <button
                type="button"
                className="qw-ab-cancel"
                onClick={handleBack}
                disabled={submit.creating}
              >
                {t(($) => $.builder.cancel)}
              </button>
              <button
                type="button"
                className="qw-ab-create"
                onClick={() => void submit.create()}
                disabled={!canCreate}
              >
                {submit.creating ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : null}
                {submit.creating
                  ? t(($) => $.builder.creating)
                  : squadId
                    ? t(($) => $.creation_studio.create_and_add)
                    : t(($) => $.builder.create)}
              </button>
            </footer>
          </div>
        </div>

        <aside className="qw-ab-preview">
          <div className="qw-ab-prev-head">{t(($) => $.builder.preview)}</div>
          <div className="qw-ab-seat">
            <div className="qw-ab-seat-top">
              <span className="qw-ab-seat-ava">
                <ActorAvatarBase
                  name={draft.name || t(($) => $.builder.unnamed)}
                  initials={initialsOf(draft.name || t(($) => $.builder.unnamed))}
                  avatarUrl={resolvePublicFileUrl(draft.avatarUrl)}
                  isAgent
                  size="2xl"
                />
              </span>
              <span className="qw-ab-seat-main">
                <b>{draft.name || t(($) => $.builder.unnamed)}</b>
                <span>{ownerName}</span>
              </span>
            </div>
            <div className="qw-ab-prev-facts">
              <div className="qw-ab-pfact">
                <span>{t(($) => $.builder.owner)}</span>
                <b>{ownerName}</b>
              </div>
              <div className="qw-ab-pfact">
                <span>{t(($) => $.builder.runtime_fact)}</span>
                <b>
                  {selectedRuntime
                    ? runtimeDisplayLabel(selectedRuntime)
                    : "—"}
                </b>
              </div>
              <div className="qw-ab-pfact">
                <span>{t(($) => $.builder.model_fact)}</span>
                <b>
                  {draft.model ||
                    t(($) => $.model_dropdown.default_provider)}
                </b>
              </div>
              <div className="qw-ab-pfact">
                <span>{t(($) => $.builder.capacity_fact)}</span>
                <b>
                  {capacity === null
                    ? t(($) => $.builder.capacity_default)
                    : capacity}
                </b>
              </div>
              <div className="qw-ab-pfact">
                <span>{t(($) => $.builder.visibility_fact)}</span>
                <b>{t(($) => $.creation_studio.access[draft.permissionScope].title)}</b>
              </div>
            </div>
          </div>
          <div className="qw-ab-prev-sec">
            <div className="qw-ab-prev-label">
              <span>{t(($) => $.builder.skills)}</span>
              <span>{selectedSkills.length}</span>
            </div>
            <div className="qw-ab-prev-list">
              {selectedSkills.length === 0 ? (
                <span className="qw-ab-hint">
                  {t(($) => $.builder.no_skills)}
                </span>
              ) : (
                selectedSkills.map((skill) => (
                  <span key={skill.id} className="chip">
                    {skill.name}
                  </span>
                ))
              )}
            </div>
          </div>
          <p className="qw-ab-consequence">
            {t(($) => $.builder.consequence)}
          </p>
        </aside>
      </div>
    </div>
  );
}
