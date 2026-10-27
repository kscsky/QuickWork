"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Copy,
  FileText,
  Loader2,
  Lock,
  Plus,
  RotateCw,
  Save,
  Trash2,
  UserPlus,
} from "lucide-react";
import type {
  Agent,
  AgentRuntime,
  MemberWithUser,
  Skill,
  SkillFile,
  UpdateSkillRequest,
} from "@quickwork/core/types";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@quickwork/core/api";
import { useAuthStore } from "@quickwork/core/auth";
import { useTimeAgo } from "../../i18n";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useWorkspacePaths } from "@quickwork/core/paths";
import {
  agentListOptions,
  memberListOptions,
  selectSkillAssignments,
  skillDetailOptions,
  workspaceKeys,
} from "@quickwork/core/workspace/queries";
import { useWorkspacePresenceMap } from "@quickwork/core/agents";
import {
  runtimeDisplayLabel,
  runtimeListOptions,
} from "@quickwork/core/runtimes";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@quickwork/ui/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quickwork/ui/components/ui/dialog";
import { Input } from "@quickwork/ui/components/ui/input";
import { Skeleton } from "@quickwork/ui/components/ui/skeleton";
import { AppLink, useNavigation } from "../../navigation";
import { ActorAvatar } from "../../common/actor-avatar";
import { useCanEditSkill } from "../hooks/use-can-edit-skill";
import { useSkillPermissions } from "@quickwork/core/permissions";
import { CapabilityBanner } from "@quickwork/ui/components/common/capability-banner";
import {
  isRefreshableOrigin,
  originSourceUrl,
  readOrigin,
  totalFileCount,
} from "../lib/origin";
import {
  AddToAgentDialog,
  type SkillActionsContext,
} from "./skill-list-actions";
import { RefreshSkillDialog } from "./refresh-skill-dialog";
import { useT } from "../../i18n";
import { SkillDoc } from "../lib/skill-doc";

const SKILL_MD = "SKILL.md";

type DraftFile = { id?: string; path: string; content: string };

/** The four editable fields, as one snapshot. */
type SkillDraft = {
  name: string;
  description: string;
  content: string;
  files: DraftFile[];
};

type FileMode = "preview" | "raw";

/**
 * Server skill -> editable draft. Name and description are trimmed at this
 * single seam so every later comparison can be plain equality.
 */
function toDraft(s: Skill): SkillDraft {
  return {
    name: s.name.trim(),
    description: s.description.trim(),
    content: s.content,
    files: (s.files ?? []).map((f: SkillFile) => ({
      id: f.id,
      path: f.path,
      content: f.content,
    })),
  };
}

function fileSignature(files: DraftFile[]): string {
  return JSON.stringify(
    files
      .map((f) => ({ path: f.path, content: f.content }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  );
}

function hasLocalEdits(draft: SkillDraft, baseline: SkillDraft | null): boolean {
  if (!baseline) return false;
  return (
    draft.name.trim() !== baseline.name ||
    draft.description.trim() !== baseline.description ||
    draft.content !== baseline.content ||
    fileSignature(draft.files) !== fileSignature(baseline.files)
  );
}

export function useValidateNewFilePath() {
  const { t } = useT("skills");
  return (path: string, existing: string[]): string => {
    const p = path.trim();
    if (!p) return t(($) => $.detail.add_file.errors.empty);
    if (p.startsWith("/")) return t(($) => $.detail.add_file.errors.absolute);
    if (p.split("/").includes("..")) return t(($) => $.detail.add_file.errors.double_dot);
    if (p === SKILL_MD) return t(($) => $.detail.add_file.errors.reserved);
    if (existing.includes(p)) return t(($) => $.detail.add_file.errors.exists);
    if (existing.some((other) => other.startsWith(`${p}/`))) {
      return t(($) => $.detail.add_file.errors.is_directory);
    }
    if (existing.some((other) => p.startsWith(`${other}/`))) {
      return t(($) => $.detail.add_file.errors.under_file);
    }
    return "";
  };
}

function AddFileInline({
  existingPaths,
  onAdd,
  onCancel,
}: {
  existingPaths: string[];
  onAdd: (path: string) => void;
  onCancel: () => void;
}) {
  const { t } = useT("skills");
  const validate = useValidateNewFilePath();
  const [path, setPath] = useState("");
  const [error, setError] = useState("");

  const submit = () => {
    const err = validate(path, existingPaths);
    if (err) {
      setError(err);
      return;
    }
    onAdd(path.trim());
  };

  return (
    <div className="qw-sk-addfile">
      <input
        autoFocus
        value={path}
        onChange={(event) => {
          setPath(event.target.value);
          setError("");
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit();
          if (event.key === "Escape") onCancel();
        }}
        placeholder={t(($) => $.detail.add_file.placeholder)}
        aria-label={t(($) => $.detail.add_file.placeholder)}
      />
      {error ? (
        <p role="alert" className="qw-sk-addfile-error">
          {error}
        </p>
      ) : null}
      <div className="qw-sk-addfile-actions">
        <button type="button" onClick={submit}>
          {t(($) => $.detail.add_file.add)}
        </button>
        <button type="button" onClick={onCancel}>
          {t(($) => $.detail.add_file.cancel)}
        </button>
      </div>
    </div>
  );
}

export function SkillDetailPage({ skillId }: { skillId: string }) {
  const { t } = useT("skills");
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const timeAgo = useTimeAgo();

  const {
    data: skill,
    isLoading,
    error,
  } = useQuery(skillDetailOptions(wsId, skillId));
  const { data: agents = [], error: agentsError } = useQuery(
    agentListOptions(wsId),
  );
  const { data: members = [], error: membersError } = useQuery(
    memberListOptions(wsId),
  );
  const { data: runtimes = [], error: runtimesError } = useQuery(
    runtimeListOptions(wsId),
  );
  const { byAgent: presence } = useWorkspacePresenceMap(wsId);

  const assignments = useMemo(() => selectSkillAssignments(agents), [agents]);

  const canEdit = useCanEditSkill(skill, wsId);
  const skillPermissions = useSkillPermissions(skill ?? null, wsId);

  const myRole = useMemo(
    () => members.find((m) => m.user_id === currentUserId)?.role ?? null,
    [members, currentUserId],
  );
  const actionsCtx: SkillActionsContext = {
    wsId,
    agents,
    currentUserId,
    isAdmin: myRole === "owner" || myRole === "admin",
  };

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<DraftFile[]>([]);
  const [selectedPath, setSelectedPath] = useState(SKILL_MD);
  const [fileMode, setFileMode] = useState<FileMode>("preview");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  const [showAddToAgents, setShowAddToAgents] = useState(false);
  const [addingFile, setAddingFile] = useState(false);
  const [conflictPending, setConflictPending] = useState(false);
  const [renamePath, setRenamePath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const draftRef = useRef({ name, description, content, files });
  draftRef.current = { name, description, content, files };

  const seededKeyRef = useRef<string | null>(null);
  const baselineRef = useRef<SkillDraft | null>(null);

  const seedFromSkill = useCallback((s: Skill) => {
    const seeded = toDraft(s);
    setName(seeded.name);
    setDescription(seeded.description);
    setContent(seeded.content);
    setFiles(seeded.files);
    baselineRef.current = seeded;
  }, []);

  const adoptServerVersion = useCallback(
    (s: Skill, resetSelection = false) => {
      seededKeyRef.current = `${wsId}:${s.id}@${s.updated_at}`;
      setConflictPending(false);
      seedFromSkill(s);
      if (resetSelection) setSelectedPath(SKILL_MD);
    },
    [wsId, seedFromSkill],
  );

  useEffect(() => {
    if (!skill) return;
    if (seededKeyRef.current === `${wsId}:${skill.id}@${skill.updated_at}`) {
      return;
    }

    const sameSkill =
      seededKeyRef.current !== null &&
      seededKeyRef.current.startsWith(`${wsId}:${skill.id}@`);

    if (sameSkill && hasLocalEdits(draftRef.current, baselineRef.current)) {
      setConflictPending(true);
      return;
    }

    adoptServerVersion(skill, !sameSkill);
  }, [skill, wsId, adoptServerVersion, name, description, content, files]);

  const creator = useMemo<MemberWithUser | null>(
    () =>
      skill?.created_by
        ? members.find((m) => m.user_id === skill.created_by) ?? null
        : null,
    [members, skill?.created_by],
  );

  const origin = useMemo(() => (skill ? readOrigin(skill) : null), [skill]);
  const sourcePath = useMemo(() => {
    const raw = skill?.config?.source_path;
    return typeof raw === "string" && raw.trim() ? raw.trim() : null;
  }, [skill?.config]);
  const originRuntime = useMemo<AgentRuntime | null>(() => {
    if (!origin || origin.type !== "runtime_local" || !origin.runtime_id)
      return null;
    return runtimes.find((r) => r.id === origin.runtime_id) ?? null;
  }, [origin, runtimes]);
  const sourceUrl = originSourceUrl(origin);
  const sourceLabel = useMemo(() => {
    if (!origin) return null;
    if (origin.type === "runtime_local") {
      return originRuntime
        ? t(($) => $.detail.subline.origin_runtime_named, {
            name: runtimeDisplayLabel(originRuntime),
          })
        : origin.provider
          ? t(($) => $.detail.subline.origin_runtime_provider, {
              provider: origin.provider,
            })
          : t(($) => $.detail.subline.origin_runtime_unknown);
    }
    if (origin.type === "clawhub") return t(($) => $.detail.subline.origin_clawhub);
    if (origin.type === "skills_sh") return t(($) => $.detail.subline.origin_skills_sh);
    if (origin.type === "github") return t(($) => $.detail.subline.origin_github);
    return t(($) => $.detail.subline.origin_workspace);
  }, [origin, originRuntime, t]);

  const skillAgents = useMemo(
    () => assignments.get(skillId) ?? [],
    [assignments, skillId],
  );

  const fileMap = useMemo(() => {
    const map = new Map<string, string>();
    map.set(SKILL_MD, content);
    for (const f of files) if (f.path.trim()) map.set(f.path, f.content);
    return map;
  }, [content, files]);
  const filePaths = useMemo(() => Array.from(fileMap.keys()), [fileMap]);
  const selectedContent = fileMap.get(selectedPath) ?? "";

  useEffect(() => {
    if (selectedPath !== SKILL_MD && !fileMap.has(selectedPath)) {
      setSelectedPath(SKILL_MD);
    }
  }, [fileMap, selectedPath]);

  const dirtySummary = useMemo(() => {
    const baseline = baselineRef.current;
    if (!baseline) {
      return { nameChanged: false, descChanged: false, changedFileCount: 0 };
    }
    const baselineById = new Map(
      baseline.files.flatMap((f) => (f.id ? [[f.id, f] as const] : [])),
    );
    let changedFileCount = content !== baseline.content ? 1 : 0;
    const draftIds = new Set<string>();
    for (const f of files) {
      if (f.id) draftIds.add(f.id);
      const base = f.id ? baselineById.get(f.id) : undefined;
      if (!base || base.path !== f.path || base.content !== f.content) {
        changedFileCount += 1;
      }
    }
    for (const f of baseline.files) {
      if (f.id && !draftIds.has(f.id)) changedFileCount += 1;
    }
    return {
      nameChanged: name.trim() !== baseline.name,
      descChanged: description.trim() !== baseline.description,
      changedFileCount,
    };
  }, [name, description, content, files]);

  const isDirty =
    dirtySummary.nameChanged ||
    dirtySummary.descChanged ||
    dirtySummary.changedFileCount > 0;

  const handleSave = async () => {
    if (!skill || !canEdit) return;
    const trimmedName = name.trim();
    const trimmedDesc = description.trim();
    setSaving(true);
    try {
      const payload: UpdateSkillRequest = {
        name: trimmedName,
        description: trimmedDesc,
        content,
        files: files.filter((f) => f.path.trim()),
      };
      const updated = await api.updateSkill(skill.id, payload);
      qc.setQueryData(skillDetailOptions(wsId, skill.id).queryKey, updated);
      adoptServerVersion(updated);
      qc.invalidateQueries({
        queryKey: workspaceKeys.skills(wsId),
        exact: true,
      });
      qc.invalidateQueries({ queryKey: workspaceKeys.agents(wsId) });
      toast.success(t(($) => $.detail.toast_saved));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t(($) => $.detail.toast_save_failed));
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (!skill) return;
    adoptServerVersion(skill);
  };

  const handleDelete = async () => {
    if (!skill) return;
    setDeleting(true);
    try {
      await api.deleteSkill(skill.id);
      navigation.replace(paths.skills());
      qc.removeQueries({
        queryKey: skillDetailOptions(wsId, skill.id).queryKey,
      });
      qc.invalidateQueries({ queryKey: workspaceKeys.skills(wsId) });
      qc.invalidateQueries({ queryKey: workspaceKeys.agents(wsId) });
      toast.success(t(($) => $.detail.toast_deleted));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t(($) => $.detail.toast_delete_failed),
      );
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const handleAddFile = (path: string) => {
    setFiles((prev) => [...prev, { path, content: "" }]);
    setSelectedPath(path);
    setFileMode("raw");
    setAddingFile(false);
  };

  const handleDeleteFile = (path: string) => {
    if (path === SKILL_MD) return;
    setFiles((prev) => prev.filter((f) => f.path !== path));
    if (path === selectedPath) setSelectedPath(SKILL_MD);
  };

  const handleRenameFile = (from: string, to: string) => {
    if (from === SKILL_MD) return;
    const next = to.trim();
    if (!next || next === from) return;
    setFiles((prev) =>
      prev.map((f) => (f.path === from ? { ...f, path: next } : f)),
    );
    if (from === selectedPath) setSelectedPath(next);
  };

  const handleFileContentChange = (newContent: string) => {
    if (!canEdit) return;
    if (selectedPath === SKILL_MD) {
      setContent(newContent);
    } else {
      setFiles((prev) =>
        prev.map((f) =>
          f.path === selectedPath ? { ...f, content: newContent } : f,
        ),
      );
    }
  };

  const handleCopyName = async () => {
    if (!skill) return;
    try {
      await navigator.clipboard.writeText(skill.name);
      toast.success(t(($) => $.console.copied));
    } catch {
      toast.error(t(($) => $.console.copy_failed));
    }
  };

  const supportingQueryDown = !!agentsError || !!membersError || !!runtimesError;

  if (isLoading) {
    return (
      <div className="qw-sk-page">
        <div className="qw-sk-topbar">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-3 w-40" />
        </div>
        <div className="qw-sk-body">
          <div className="qw-sk-files">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-4/5" />
          </div>
          <div className="qw-sk-editor-wrap">
            <div className="qw-sk-editor">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-3 h-8 w-2/3" />
              <Skeleton className="mt-3 h-4 w-full" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !skill) {
    return (
      <div className="qw-sk-page">
        <div className="qw-sk-topbar">
          <AppLink href={paths.skills()} className="qw-sk-back">
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {t(($) => $.detail.all_skills)}
          </AppLink>
        </div>
        <div className="qw-sk-statepage">
          <AlertCircle className="size-8" aria-hidden="true" />
          <h3>{t(($) => $.detail.not_found.title)}</h3>
          <p>
            {error instanceof Error
              ? error.message
              : t(($) => $.detail.not_found.fallback)}
          </p>
          <AppLink href={paths.skills()} className="qw-sk-btn">
            {t(($) => $.detail.not_found.back)}
          </AppLink>
        </div>
      </div>
    );
  }

  const changedParts = [
    dirtySummary.nameChanged ? t(($) => $.detail.overview.name) : null,
    dirtySummary.descChanged ? t(($) => $.detail.overview.description) : null,
    dirtySummary.changedFileCount > 0
      ? t(($) => $.detail.save_bar.changed_files, {
          count: dirtySummary.changedFileCount,
        })
      : null,
  ].filter((part): part is string => part !== null);

  const selectedFileName = selectedPath.split("/").pop() ?? selectedPath;
  const typeLabel =
    origin?.type === "manual"
      ? t(($) => $.console.type_manual)
      : origin?.type === "runtime_local"
        ? t(($) => $.console.type_runtime)
        : t(($) => $.console.type_imported);

  return (
    <div className="qw-sk-page">
      <div className="qw-sk-topbar">
        <AppLink href={paths.skills()} className="qw-sk-back">
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          {t(($) => $.page.title)}
        </AppLink>
        <span className="qw-sk-crumb">
          {t(($) => $.console.crumb_config)} / {t(($) => $.page.title)} /{" "}
          {skill.name}
        </span>
        {isDirty ? (
          <div className="qw-sk-savestate">
            <span className="qw-sk-dirty">
              {t(($) => $.detail.save_bar.changed_summary, {
                parts: changedParts.join(" · "),
              })}
            </span>
            <button
              type="button"
              className="qw-sk-textbtn"
              onClick={handleDiscard}
              disabled={saving}
            >
              {t(($) => $.detail.save_bar.discard)}
            </button>
            <button
              type="button"
              className="qw-sk-save-btn"
              onClick={handleSave}
              disabled={saving || !name.trim()}
            >
              {saving ? (
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-3" aria-hidden="true" />
              )}
              {saving
                ? t(($) => $.detail.save_bar.saving)
                : t(($) => $.detail.save_bar.save)}
            </button>
          </div>
        ) : (
          <span className="qw-sk-saved">
            {!canEdit ? (
              <Lock className="size-3" aria-hidden="true" />
            ) : null}
            {t(($) => $.console.saved, { when: timeAgo(skill.updated_at) })}
          </span>
        )}
      </div>

      {conflictPending && canEdit ? (
        <div role="status" aria-live="polite" className="qw-sk-banner">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          <div>
            <b>{t(($) => $.detail.conflict_banner.title)}</b>
            <span>{t(($) => $.detail.conflict_banner.body)}</span>
          </div>
        </div>
      ) : null}

      {supportingQueryDown ? (
        <div role="status" className="qw-sk-banner">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          <div>
            <span>{t(($) => $.detail.supporting_data_warning)}</span>
          </div>
        </div>
      ) : null}

      {!canEdit ? (
        <div className="qw-sk-cap">
          <CapabilityBanner
            reason={skillPermissions.canEdit.reason}
            resource="skill"
            ownerName={creator?.name}
          />
        </div>
      ) : null}

      <div className="qw-sk-body">
        <aside className="qw-sk-files">
          <div className="qw-sk-files-label">
            {t(($) => $.console.files_label)}
          </div>
          {filePaths.map((path) => (
            <button
              key={path}
              type="button"
              className="qw-sk-file"
              title={path}
              data-on={path === selectedPath ? "" : undefined}
              onClick={() => {
                setSelectedPath(path);
                setFileMode("preview");
              }}
            >
              <FileText className="size-3" aria-hidden="true" />
              <span>{path}</span>
            </button>
          ))}
          {canEdit ? (
            addingFile ? (
              <AddFileInline
                existingPaths={filePaths}
                onAdd={handleAddFile}
                onCancel={() => setAddingFile(false)}
              />
            ) : (
              <button
                type="button"
                className="qw-sk-file-add"
                onClick={() => setAddingFile(true)}
              >
                <Plus className="size-3" aria-hidden="true" />
                {t(($) => $.detail.files.add_file)}
              </button>
            )
          ) : null}
        </aside>

        <div className="qw-sk-editor-wrap">
          <div className="qw-sk-editor">
            <div className="qw-sk-pathbar">
              <span className="qw-sk-filepath">{selectedPath}</span>
              <span className="qw-sk-pathbar-actions">
                <button
                  type="button"
                  className="qw-sk-textbtn"
                  onClick={() =>
                    setFileMode((mode) => (mode === "raw" ? "preview" : "raw"))
                  }
                >
                  {fileMode === "raw"
                    ? t(($) => $.detail.files.mode_preview)
                    : canEdit
                      ? t(($) => $.detail.files.mode_edit)
                      : t(($) => $.detail.files.mode_raw)}
                </button>
                {canEdit && selectedPath !== SKILL_MD ? (
                  <>
                    <button
                      type="button"
                      className="qw-sk-textbtn"
                      onClick={() => {
                        setRenameValue(selectedPath);
                        setRenamePath(selectedPath);
                      }}
                    >
                      {t(($) => $.console.rename)}
                    </button>
                    <button
                      type="button"
                      className="qw-sk-textbtn danger"
                      onClick={() => handleDeleteFile(selectedPath)}
                    >
                      {t(($) => $.console.delete_file)}
                    </button>
                  </>
                ) : null}
              </span>
            </div>

            {fileMode === "preview" ? (
              <>
                {selectedPath === SKILL_MD ? (
                  <>
                    <h1>{name}</h1>
                    <p className="qw-sk-desc">{description}</p>
                    <div className="qw-sk-editor-meta">
                      <span>{sourceLabel ?? typeLabel}</span>
                      <span>
                        {t(($) => $.detail.header.updated, {
                          when: timeAgo(skill.updated_at),
                        })}
                      </span>
                      <span>
                        {t(($) => $.detail.header.used_by, {
                          count: skillAgents.length,
                        })}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <h1>{selectedFileName}</h1>
                    <p className="qw-sk-desc">
                      {t(($) => $.console.attachment_desc, { name: skill.name })}
                    </p>
                  </>
                )}
                <SkillDoc path={selectedPath} content={selectedContent} />
              </>
            ) : (
              <div className="qw-sk-edit">
                {selectedPath === SKILL_MD ? (
                  <>
                    <label className="qw-sk-field">
                      <span>{t(($) => $.detail.overview.name)}</span>
                      <input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        readOnly={!canEdit}
                        aria-label={t(($) => $.detail.overview.name)}
                      />
                    </label>
                    <label className="qw-sk-field">
                      <span>{t(($) => $.detail.overview.description)}</span>
                      <textarea
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        readOnly={!canEdit}
                        rows={4}
                        aria-label={t(($) => $.detail.overview.description)}
                      />
                    </label>
                  </>
                ) : null}
                <textarea
                  className="qw-sk-code-area"
                  value={selectedContent}
                  onChange={(event) =>
                    handleFileContentChange(event.target.value)
                  }
                  readOnly={!canEdit}
                  aria-label={selectedPath}
                  spellCheck={false}
                />
              </div>
            )}
          </div>
        </div>

        <aside className="qw-sk-meta">
          <section className="qw-sk-meta-sec">
            <div className="qw-sk-sec-head">{t(($) => $.console.source)}</div>
            <div className="qw-sk-fact">
              <span>{t(($) => $.console.type)}</span>
              <b>{typeLabel}</b>
            </div>
            <div className="qw-sk-fact">
              <span>{t(($) => $.console.creator)}</span>
              <b>{creator?.name ?? "—"}</b>
            </div>
            <div className="qw-sk-fact">
              <span>{t(($) => $.console.updated)}</span>
              <b>{timeAgo(skill.updated_at)}</b>
            </div>
            <div className="qw-sk-fact">
              <span>{t(($) => $.console.files)}</span>
              <b>{totalFileCount(skill)}</b>
            </div>
            {sourcePath ? (
              <div className="qw-sk-fact">
                <span>{t(($) => $.console.source_path)}</span>
                <b className="mono">{sourcePath}</b>
              </div>
            ) : null}
            {sourceUrl ? (
              <div className="qw-sk-fact">
                <span>{t(($) => $.console.origin)}</span>
                <b>
                  <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
                    {sourceLabel}
                  </a>
                </b>
              </div>
            ) : null}
          </section>

          <section className="qw-sk-meta-sec">
            <div className="qw-sk-sec-head">
              {t(($) => $.console.agents_in_use)}
              <em>{skillAgents.length}</em>
            </div>
            {skillAgents.length === 0 ? (
              <p className="qw-sk-meta-empty">{t(($) => $.console.no_agents)}</p>
            ) : (
              <div className="qw-sk-agents">
                {skillAgents.map((agent: Agent) => {
                  const state = presence.get(agent.id);
                  return (
                    <div key={agent.id} className="qw-sk-agent">
                      <span className="qw-sk-agent-ava">
                        <ActorAvatar actorType="agent" actorId={agent.id} size="md" />
                      </span>
                      <span className="qw-sk-agent-name">{agent.name}</span>
                      <span
                        className="qw-sk-agent-state"
                        data-on={
                          state?.workload === "working" ? "" : undefined
                        }
                      >
                        {state?.workload === "working"
                          ? t(($) => $.console.running)
                          : t(($) => $.console.idle)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="qw-sk-actions">
              <button
                type="button"
                className="qw-sk-action primary"
                onClick={() => setShowAddToAgents(true)}
              >
                <UserPlus className="size-3" aria-hidden="true" />
                {t(($) => $.console.add_to_agent)}
              </button>
              {canEdit && origin && isRefreshableOrigin(origin) ? (
                <button
                  type="button"
                  className="qw-sk-action"
                  onClick={() => setConfirmRefresh(true)}
                >
                  <RotateCw className="size-3" aria-hidden="true" />
                  {t(($) => $.console.refresh_source)}
                </button>
              ) : null}
              <button
                type="button"
                className="qw-sk-action"
                onClick={handleCopyName}
              >
                <Copy className="size-3" aria-hidden="true" />
                {t(($) => $.console.copy_name)}
              </button>
              {canEdit ? (
                <button
                  type="button"
                  className="qw-sk-action danger"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="size-3" aria-hidden="true" />
                  {t(($) => $.console.delete)}
                </button>
              ) : null}
            </div>
          </section>
        </aside>
      </div>

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(($) => $.detail.delete_dialog.title)}</AlertDialogTitle>
            <AlertDialogDescription>
              {skillAgents.length > 0
                ? t(($) => $.detail.delete_dialog.description_with_agents, {
                    name: skill.name,
                    count: skillAgents.length,
                  })
                : t(($) => $.detail.delete_dialog.description_no_agents, {
                    name: skill.name,
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="qw-sk-dialog-warning">
            {t(($) => $.detail.delete_dialog.warning)}
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t(($) => $.detail.delete_dialog.cancel)}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={handleDelete}
            >
              {deleting
                ? t(($) => $.detail.delete_dialog.deleting)
                : t(($) => $.detail.delete_dialog.confirm)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={renamePath !== null}
        onOpenChange={(open) => {
          if (!open) setRenamePath(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t(($) => $.console.rename_title)}</DialogTitle>
            <DialogDescription>{renamePath ?? ""}</DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            aria-label={t(($) => $.console.rename_label)}
            className="font-mono text-caption"
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !renamePath) return;
              handleRenameFile(renamePath, renameValue);
              setRenamePath(null);
            }}
          />
          <DialogFooter>
            <button
              type="button"
              className="qw-sk-btn"
              onClick={() => setRenamePath(null)}
            >
              {t(($) => $.console.cancel)}
            </button>
            <button
              type="button"
              className="qw-sk-btn primary"
              onClick={() => {
                if (!renamePath) return;
                handleRenameFile(renamePath, renameValue);
                setRenamePath(null);
              }}
            >
              {t(($) => $.console.rename_confirm)}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddToAgentDialog
        skills={[skill]}
        ctx={actionsCtx}
        open={showAddToAgents}
        onOpenChange={setShowAddToAgents}
      />

      <RefreshSkillDialog
        skill={skill}
        origin={origin}
        wsId={wsId}
        open={confirmRefresh}
        onOpenChange={setConfirmRefresh}
        onRefreshed={(updated) => adoptServerVersion(updated)}
      />
    </div>
  );
}
