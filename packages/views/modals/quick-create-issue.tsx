"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  FolderKanban,
  MoreHorizontal,
  Settings2,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@quickwork/ui/components/ui/dropdown-menu";
import { Switch } from "@quickwork/ui/components/ui/switch";
import { api, ApiError } from "@quickwork/core/api";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useCurrentWorkspace, useWorkspacePaths } from "@quickwork/core/paths";
import { AppLink, resolveClickIntent } from "../navigation";
import { agentListOptions } from "@quickwork/core/workspace/queries";
import { projectListOptions } from "@quickwork/core/projects/queries";
import {
  useQuickCreateStore,
  type QuickCreateActorType,
} from "@quickwork/core/issues/stores/quick-create-store";
import {
  useIssueCreateSettingsStore,
  type QuickCreateField,
} from "@quickwork/core/issues/stores/issue-create-settings-store";
import { useIssueDraftStore, type IssueCreateDraft } from "@quickwork/core/issues/stores/draft-store";
import {
  runtimeListOptions,
  checkQuickCreateCliVersion,
  checkQuickCreateFieldsCliVersion,
  readRuntimeCliVersion,
  runtimeDisplayLabel,
} from "@quickwork/core/runtimes";
import { useShortcut } from "@quickwork/core/shortcuts";
import { ShortcutKeycaps } from "../common/shortcut-keycaps";
import {
  contentReferencesAttachment,
  type Agent,
  type IssuePriority,
  type SourceContextPreview,
} from "@quickwork/core/types";
import { ActorAvatar } from "../common/actor-avatar";
import { ProjectPicker } from "../projects/components/project-picker";
import { DueDatePicker, PriorityIcon } from "../issues/components";
import { isAgentRuntimeBound } from "@quickwork/core/agents";
import { useAuthStore } from "@quickwork/core/auth";
import {
  ContentEditor,
  type ContentEditorRef,
  useFileDropZone,
  FileDropOverlay,
  useUploadGate,
  useComposerSubmit,
} from "../editor";
import { useIssueCreateUploads } from "./use-issue-create-uploads";
import { FileUploadButton } from "@quickwork/ui/components/common/file-upload-button";
import { useT } from "../i18n";
import { SourceContextPreviewCard, useSourceContextFailureMessage } from "./source-context-preview";
import { CreateTaskChrome, DispatchPriority } from "./create-task-chrome";
import { cn } from "@quickwork/ui/lib/utils";

// Solo-task dialog: the actor is always one of the caller's own agents.
type ActorSelection = { type: "agent"; id: string };

// AgentCreatePanel — the create dialog's body (a solo task is always agent
// work; the manual form is only reachable from surfaces that open its own
// modal directly). Renders only the inner content; the surrounding `<Dialog>`
// AND `<DialogContent>` (Portal + Overlay + Popup) are owned by
// CreateIssueDialog.
export function AgentCreatePanel({
  onClose,
  data,
  typeSwitch,
}: {
  onClose: () => void;
  data?: Record<string, unknown> | null;
  /** Kept for the source-context create call site; the refresh dialog has no expand state. */
  isExpanded?: boolean;
  setIsExpanded?: (v: boolean) => void;
  /** The 单人/小队 switch, owned by the shell; rendered into the top strip. */
  typeSwitch?: ReactNode;
}) {
  const { t } = useT("modals");
  const { t: tIssues } = useT("issues");
  const sendShortcut = useShortcut("send");
  const workspaceName = useCurrentWorkspace()?.name;
  const workspacePaths = useWorkspacePaths();
  const wsId = useWorkspaceId();
  const anchorCommentId = typeof data?.anchor_comment_id === "string" ? data.anchor_comment_id : null;
  const sourcePreview = data?.source_context_preview as SourceContextPreview | undefined;
  const sourceContextLoading = data?.source_context_loading === true;
  const sourceContextFailed = data?.source_context_failed === true;
  const sourceContextError = data?.source_context_error;
  const refetchSourceContext = data?.source_context_refetch as (() => Promise<unknown>) | undefined;
  const sourceContextExpanded = typeof data?.source_context_expanded === "boolean"
    ? data.source_context_expanded
    : undefined;
  const onSourceContextExpandedChange = data?.source_context_on_expanded_change as ((expanded: boolean) => void) | undefined;
  const sourceContextFailureMessage = useSourceContextFailureMessage();
  const userId = useAuthStore((s) => s.user?.id);
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  // Pull `isSuccess` so the stale-id sweep below can distinguish "still
  // loading" from "loaded as empty". Reading length alone treats both as
  // empty and incorrectly clears a valid persisted preference on every open.
  const { data: projects = [], isSuccess: projectsLoaded } = useQuery(
    projectListOptions(wsId),
  );

  // Solo tasks run on the caller's OWN agents — this dialog lists nobody
  // else's agents and no squads (squad relays are created on the squad-tasks
  // page). Own agents are assignable by definition, so the older
  // canAssignAgent permission gate collapses into the ownership check.
  const visibleAgents = useMemo(
    () =>
      agents.filter(
        (a) =>
          a.owner_id === userId &&
          !a.archived_at &&
          isAgentRuntimeBound(a),
      ),
    [agents, userId],
  );
  const visibleAgentIds = useMemo(
    () => new Set(visibleAgents.map((a) => a.id)),
    [visibleAgents],
  );

  const lastActorType = useQuickCreateStore((s) => s.lastActorType);
  const lastActorId = useQuickCreateStore((s) => s.lastActorId);
  const setLastActor = useQuickCreateStore((s) => s.setLastActor);
  const visibleFields = useIssueCreateSettingsStore((s) => s.quickCreateFields);
  const keepOpen = useQuickCreateStore((s) => s.keepOpen);
  const setKeepOpen = useQuickCreateStore((s) => s.setKeepOpen);
  // The agent draft (prompt + actor) and the shared fields (project, priority,
  // due date, attachments) live in the unified issue-create draft, so
  // reopening the dialog restores them.
  const draft = useIssueDraftStore((s) => s.draft);
  const setShared = useIssueDraftStore((s) => s.setShared);
  const setAgent = useIssueDraftStore((s) => s.setAgent);
  const setActiveMode = useIssueDraftStore((s) => s.setActiveMode);
  const clearDraft = useIssueDraftStore((s) => s.clearDraft);

  // Resolve a candidate actor against the currently-visible agents. Returns
  // null when the candidate isn't one of the caller's own agents right now
  // (deleted, archived, unbound, someone else's, a legacy squad draft, etc.)
  // so callers can fall through to the next seed in the chain.
  const resolveActor = useCallback(
    (
      type: QuickCreateActorType | "agent" | "squad" | null | undefined,
      id: string | null | undefined,
    ): ActorSelection | null => {
      if (!type || !id) return null;
      if (type === "agent" && visibleAgentIds.has(id)) {
        return { type: "agent", id };
      }
      return null;
    },
    [visibleAgentIds],
  );

  const seedActor = useCallback((): ActorSelection | null => {
    // Caller-provided seed wins (e.g. shell pre-seeds with `agent_id`), then
    // the persisted agent draft, the last successful pick, and finally the
    // first visible agent. Squad seeds and squad drafts no longer resolve —
    // squad picks went away with the squad-tasks split.
    const dataAgent = data?.agent_id as string | undefined;
    return (
      resolveActor("agent", dataAgent) ||
      resolveActor(draft.agent.actorType, draft.agent.actorId) ||
      resolveActor(lastActorType, lastActorId) ||
      (visibleAgents[0]
        ? ({ type: "agent", id: visibleAgents[0].id } as const)
        : null)
    );
  }, [
    resolveActor,
    data?.agent_id,
    draft.agent.actorType,
    draft.agent.actorId,
    lastActorType,
    lastActorId,
    visibleAgents,
  ]);

  const [actor, setActor] = useState<ActorSelection | null>(() => seedActor());

  // Re-seed once visible lists resolve (queries may be empty on first render).
  useEffect(() => {
    if (actor && resolveActor(actor.type, actor.id)) return;
    setActor(seedActor());
  }, [actor, resolveActor, seedActor]);

  const selectedAgent = useMemo<Agent | undefined>(() => {
    if (!actor || actor.type !== "agent") return undefined;
    return visibleAgents.find((a) => a.id === actor.id);
  }, [actor, visibleAgents]);

  // Unfinished selections live in the shared issue-create draft. The
  // last-successful actor remains a separate fallback, so closing a draft
  // never overwrites the default established by an actual create.
  //
  // Project has exactly two seeds, both carrying explicit user intent: the
  // project page (or manual panel) the modal was opened from, and the user's
  // own unfinished draft. It is deliberately NOT seeded from the last create
  // — see quick-create-store (MUL-5862).
  const [projectId, setProjectId] = useState<string | null>(() => {
    const seed = (data?.project_id as string | undefined) ?? draft.shared.projectId;
    return seed ?? null;
  });
  const [priority, setPriority] = useState<IssuePriority>(
    (data?.priority as IssuePriority | undefined) ?? draft.shared.priority,
  );
  const [dueDate, setDueDate] = useState<string | null>(
    (data?.due_date as string | undefined) ?? draft.shared.dueDate,
  );
  const [fieldPickerOpen, setFieldPickerOpen] = useState<QuickCreateField | null>(null);
  // Local state + shared draft always move together, so both the picker rows
  // and the pill's quick-clear go through here.
  const commitProject = (next: string | null) => {
    setProjectId(next);
    setShared({ projectId: next ?? undefined });
  };

  // Parent-issue context — seeded by `openCreateSubIssue` when the modal is
  // opened from the "Add sub issue" entry on an existing issue. We carry it
  // through (not as an editable form field) so a manual→agent flip preserves
  // the sub-issue intent; the agent panel never exposes this as a picker.
  // Identifier is best-effort display context only — the UUID is the
  // authoritative reference the backend/agent uses for `--parent <uuid>`.
  const parentIssueId = (data?.parent_issue_id as string | undefined) ?? undefined;
  const parentIssueIdentifier =
    (data?.parent_issue_identifier as string | undefined) ?? undefined;

  // Stale-id sweep. Once the project list query has actually resolved
  // (`isSuccess` — distinct from "data is the empty default during loading"),
  // a `projectId` that isn't in the list means the project was deleted in
  // another session. Clear local state AND the unfinished draft — the draft
  // is the only persisted copy left, and leaving it would make the next open
  // re-seed and submit the same dead value.
  useEffect(() => {
    if (!projectsLoaded || projectId === null) return;
    if (projects.some((p) => p.id === projectId)) return;
    setProjectId(null);
    if (draft.shared.projectId === projectId) {
      setShared({ projectId: undefined });
    }
  }, [projectsLoaded, projects, projectId, draft.shared.projectId, setShared]);

  // Mark the persisted draft's active mode so a later reopen and any reader of
  // the unified draft know which form is being edited.
  useEffect(() => {
    setActiveMode("agent");
  }, [setActiveMode]);

  // Daemon CLI version gate. The agent-create flow needs the runtime's
  // bundled quickwork CLI to be ≥ MIN_QUICK_CREATE_CLI_VERSION; older
  // daemons handle attachments and partial-failure retries incorrectly
  // (see PR #1851 / MUL-1496). Pre-check on the picker so the user gets
  // immediate feedback instead of waiting for the inbox failure; the
  // server re-validates as the trust boundary. Dev-built daemons
  // (git-describe shape) are exempted inside checkQuickCreateCliVersion
  // — frontend and server share the same signal there, so they agree by
  // construction across web/desktop/staging without comparing env flags.
  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));
  const selectedRuntime = useMemo(
    () =>
      selectedAgent?.runtime_id
        ? runtimes.find((r) => r.id === selectedAgent.runtime_id)
        : undefined,
    [runtimes, selectedAgent?.runtime_id],
  );
  const runtimeById = useMemo(
    () => new Map(runtimes.map((runtime) => [runtime.id, runtime])),
    [runtimes],
  );
  const runtimeCliVersion = readRuntimeCliVersion(selectedRuntime?.metadata);
  const baseVersionCheck = useMemo(
    () => checkQuickCreateCliVersion(runtimeCliVersion),
    [runtimeCliVersion],
  );
  const fieldVersionCheck = useMemo(
    () => checkQuickCreateFieldsCliVersion(runtimeCliVersion),
    [runtimeCliVersion],
  );
  const usesExplicitFields = priority !== "none" || dueDate !== null;
  const versionCheck = usesExplicitFields ? fieldVersionCheck : baseVersionCheck;
  const versionBlocked =
    baseVersionCheck.state !== "ok" ||
    (usesExplicitFields && fieldVersionCheck.state !== "ok");

  const initialPrompt = draft.agent.prompt || (data?.prompt as string) || "";
  const title = draft.agent.title ?? "";
  // The editor is uncontrolled — we read the latest markdown via the ref at
  // submit/switch time. The headline names the action; the brief is optional.
  const editorRef = useRef<ContentEditorRef>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const hasContent = title.trim().length > 0;
  const composePrompt = (body: string) => {
    const headline = title.trim();
    if (!headline) return body;
    if (!body.trim()) return headline;
    return `# ${headline}

${body}`;
  };
  const [justSent, setJustSent] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const [stamped, setStamped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );
  const uploadGate = useUploadGate(editorRef);
  // Coordinator-owned uploads in the shared draft pool (MUL-5181, L2): a file
  // pasted into the prompt survives dialog close and mode switches, aborts on
  // logout, and is dropped after a reload. `gate` widens the editor gate with
  // the pool's placeholders.
  const {
    attachments: pendingAttachments,
    handleUpload: handleUploadFile,
    gate,
  } = useIssueCreateUploads("agent", uploadGate, editorRef);
  const { isDragOver, dropZoneProps } = useFileDropZone({
    onDrop: (files) => files.forEach((f) => editorRef.current?.uploadFile(f)),
  });

  useEffect(() => {
    // Defer focus so it lands after the dialog's focus trap has settled, but
    // never steal it back from a field the user already reached.
    const focusTitle = () => {
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.isContentEditable || /^(INPUT|TEXTAREA)$/.test(active.tagName))) {
        return;
      }
      titleRef.current?.focus();
    };
    const id = requestAnimationFrame(focusTitle);
    const timer = window.setTimeout(focusTitle, 90);
    return () => {
      cancelAnimationFrame(id);
      window.clearTimeout(timer);
    };
  }, []);

  // Agent create runs through the shared await-then-render composer contract
  // (single-flight ref, submit-time upload re-check, lock+spin, await→boolean,
  // clear only on acceptance). The prompt IS the editor content, so this maps
  // onto the hook directly.
  // Stale-submit guard (MUL-5181 P0): the issue draft is a SINGLETON store.
  // A late success from a dialog the user closed mid-submit must not clear a
  // newer draft typed after reopening — see ManualCreatePanel for the rule.
  const mountedRef = useRef(true);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const submittedDraftRef = useRef<IssueCreateDraft | null>(null);
  // Set by `onAccepted` only on the branch that keeps the panel open and wipes
  // the editor; read back by `afterAccepted`. The closing branch must not
  // refocus an editor that is about to unmount with the dialog.
  const refocusAfterAcceptRef = useRef(false);

  const composer = useComposerSubmit({
    editorRef,
    uploadGate: gate,
    allowEmpty: () => (draft.agent.title ?? "").trim().length > 0,
    onSubmit: async (md): Promise<boolean> => {
      // The button already disables on !actor / versionBlocked, but the
      // ⌘+Enter path bypasses it — re-guard here and keep the draft in place.
      if (!actor || versionBlocked || (anchorCommentId && !sourcePreview)) return false;
      // Flush the prompt editor's pending debounce before snapshotting — see
      // ManualCreatePanel.
      const pendingPrompt = editorRef.current?.flushPendingUpdate?.();
      if (pendingPrompt != null) setAgent({ prompt: pendingPrompt });
      submittedDraftRef.current = useIssueDraftStore.getState().draft;
      const prompt = composePrompt(md);
      const activeAttachmentIds = pendingAttachments
        .filter((a) => contentReferencesAttachment(prompt, a))
        .map((a) => a.id);
      setError(null);
      try {
        if (anchorCommentId && sourcePreview) {
          await api.createCommentSubIssue(anchorCommentId, {
            mode: "agent",
            capture_token: sourcePreview.capture_token,
            quick_create: {
              agent_id: actor.id,
              prompt,
              project_id: projectId ?? undefined,
              ...(priority !== "none" ? { priority } : {}),
              ...(dueDate ? { due_date: dueDate } : {}),
              ...(activeAttachmentIds.length > 0 ? { attachment_ids: activeAttachmentIds } : {}),
            },
          });
        } else {
          await api.quickCreateIssue({
            agent_id: actor.id,
            prompt,
            project_id: projectId ?? undefined,
            ...(priority !== "none" ? { priority } : {}),
            ...(dueDate ? { due_date: dueDate } : {}),
            parent_issue_id: parentIssueId,
            ...(activeAttachmentIds.length > 0 ? { attachment_ids: activeAttachmentIds } : {}),
          });
        }
        setLastActor(actor.type, actor.id);
        toast.success(t(($) => $.create_issue.agent.toast_sent), {
          duration: 4000,
        });
        return true;
      } catch (e) {
        // Server returns 422 with { code, ... } for the structured rejection
        // paths the modal cares about. Surface the reason in-modal so the
        // user can switch to a live agent / upgrade their daemon without
        // leaving the flow.
        if (e instanceof ApiError && e.body && typeof e.body === "object") {
          const body = e.body as {
            code?: string;
            reason_code?: string;
            current_version?: string;
            min_version?: string;
          };
          if (body.code === "agent_unavailable") {
            // Localize from the stable reason_code; the server's `reason` is
            // English developer detail. Codes this client predates fall back
            // to the generic sentence.
            switch (body.reason_code) {
              case "runtime_offline":
                setError(t(($) => $.create_issue.agent.error_agent_offline));
                break;
              case "agent_runtime_required":
                setError(t(($) => $.create_issue.agent.error_agent_no_runtime));
                break;
              case "runtime_unusable":
                setError(t(($) => $.create_issue.agent.error_agent_cli_unusable));
                break;
              case "target_unavailable":
                setError(t(($) => $.create_issue.agent.error_agent_archived));
                break;
              default:
                setError(t(($) => $.create_issue.agent.error_agent_unavailable_fallback));
            }
            return false;
          }
          if (body.code === "daemon_version_unsupported") {
            // Race fallback: the picker pre-check should normally catch this,
            // but a runtime can silently re-register with an older CLI between
            // pre-check and submit. Same wording as the inline notice for
            // consistency.
            const cur = body.current_version || "unknown";
            setError(
              t(($) => $.create_issue.agent.error_daemon_version, {
                current: cur,
                min: body.min_version || versionCheck.min,
              }),
            );
            return false;
          }
          if (anchorCommentId && (
            body.code === "source_context_changed"
            || body.code === "anchor_comment_deleted"
            || body.code === "source_issue_deleted"
          )) {
            await refetchSourceContext?.();
            setError(sourceContextFailureMessage(e) ?? tIssues(($) => $.source_context.error_source_changed));
            return false;
          }
          if (anchorCommentId && body.code === "source_context_quick_create_unsupported") {
            setError(tIssues(($) => $.source_context.error_agent_unsupported));
            return false;
          }
          if (anchorCommentId && body.code === "source_context_server_unsupported") {
            setError(tIssues(($) => $.source_context.error_server_unsupported));
            return false;
          }
          if (anchorCommentId && body.code === "source_context_too_large") {
            setError(sourceContextFailureMessage(e) ?? tIssues(($) => $.source_context.error_too_large));
            return false;
          }
        }
        setError(
          e instanceof Error && e.message
            ? e.message
            : t(($) => $.create_issue.agent.error_unknown),
        );
        return false;
      }
    },
    // Continuous-creation mode puts the caret back so the next prompt can be
    // typed immediately. Deliberately no `containerRef`: this is a dialog whose
    // own focus trap already bounds where focus can be, and reclaiming it is the
    // point of keep-open mode.
    afterAccepted: () => (refocusAfterAcceptRef.current ? "refocus" : "none"),
    onAccepted: () => {
      refocusAfterAcceptRef.current = false;
      // A successful create ends this whole draft (shared + manual + agent);
      // last-successful actor/project preferences were saved in onSubmit.
      // Success may only consume the draft it submitted: flush the editor's
      // pending debounce first, then clear only an untouched draft — edits
      // made mid-flight or by a reopened dialog survive.
      const latePrompt = editorRef.current?.flushPendingUpdate?.();
      if (latePrompt != null) setAgent({ prompt: latePrompt });
      const untouched =
        useIssueDraftStore.getState().draft === submittedDraftRef.current;
      if (untouched) clearDraft();
      // An edit made during the request survives; the panel stays open on it.
      if (!mountedRef.current || !untouched) return;
      if (keepOpen) {
        // Stay open for continuous creation — clear the editor so the user can
        // immediately type the next prompt.
        editorRef.current?.clearContent();
        setAgent({ title: "" });
        setSentCount((c) => c + 1);
        setJustSent(true);
        setTimeout(() => setJustSent(false), 1500);
        refocusAfterAcceptRef.current = true;
      } else {
        setStamped(true);
        closeTimer.current = setTimeout(onClose, 560);
      }
    },
  });
  const submit = () => {
    if (stamped) return;
    if (!title.trim()) {
      setError(t(($) => $.create_issue.title_required_solo));
      titleRef.current?.focus();
      return;
    }
    void composer.submit();
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        submitRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  const submitting = composer.submitting;

  // Field visibility lives in Settings → Issue. Persist the prompt draft
  // before leaving so what the user typed survives the round-trip, then
  // close — the dialog would otherwise linger over the settings page.
  const openFieldSettings = (e: React.MouseEvent) => {
    // Persist the draft either way, but only an in-place navigation closes
    // the dialog — a modifier click opens Settings in another tab and the
    // modal stays put.
    setAgent({ prompt: editorRef.current?.getMarkdown() ?? "" });
    if (resolveClickIntent(e) !== "push") return;
    onClose();
  };

  return (
    <CreateTaskChrome onClose={onClose} typeSwitch={typeSwitch}>
          <div className={cn("qk-create-paper", stamped && "is-stamping")}>
            <div className="qk-paper-head">
              <span className="qk-paper-label">{t(($) => $.create_issue.paper_dispatch)}</span>
              <span className="qk-paper-kind">{t(($) => $.create_issue.kind_solo)}</span>
              <span className="qk-paper-meta">{(workspaceName ?? "").toUpperCase()}</span>
            </div>

            <label className="qk-title-field" htmlFor="qk-create-title">
              <span className="qk-title-label">{t(($) => $.create_issue.title_label_solo)}</span>
              <input
                ref={titleRef}
                id="qk-create-title"
                value={title}
                onChange={(e) => {
                  setAgent({ title: e.target.value });
                  setError(null);
                }}
                placeholder={t(($) => $.create_issue.title_placeholder_solo)}
                autoComplete="off"
                className="qk-title-input"
              />
            </label>

            <div className="qk-form-error" role="status">{error ?? ""}</div>

            <div className="qk-brief-field">
              <span className="qk-field-label">{t(($) => $.create_issue.brief_label)}</span>
              <div {...dropZoneProps} className="qk-brief-editor">
                <ContentEditor
                  ref={editorRef}
                  defaultValue={initialPrompt}
                  placeholder={anchorCommentId
                    ? t(($) => $.create_issue.agent.source_context_prompt_placeholder)
                    : t(($) => $.create_issue.agent.prompt_placeholder)}
                  onUpdate={(md) => {
                    setAgent({ prompt: md });
                  }}
                  onUploadFile={handleUploadFile}
                  onUploadingChange={uploadGate.onUploadingChange}
                  attachments={pendingAttachments}
                  onSubmit={submit}
                  debounceMs={150}
                />
                {isDragOver && <FileDropOverlay />}
              </div>
            </div>

            {anchorCommentId && (
              <div className="qk-source-card">
                <SourceContextPreviewCard
                  preview={sourcePreview}
                  loading={sourceContextLoading}
                  failed={sourceContextFailed}
                  error={sourceContextError}
                  onRetry={refetchSourceContext ? () => { void refetchSourceContext(); } : undefined}
                  constrainToParent
                  expanded={sourceContextExpanded}
                  onExpandedChange={onSourceContextExpandedChange}
                />
              </div>
            )}

            <div className="qk-files">
              <span className="qk-field-label">{t(($) => $.create_issue.files_label)}</span>
              <FileUploadButton
                size="sm"
                multiple
                showLabel
                className="qk-file-button"
                onSelect={(file) => editorRef.current?.uploadFile(file)}
              />
              <span className="qk-files-note">
                {pendingAttachments.length > 0
                  ? t(($) => $.create_issue.files_count, { count: pendingAttachments.length })
                  : t(($) => $.create_issue.files_hint)}
              </span>
            </div>

            <div className="qk-paper-foot">
              <label className="qk-keep-open">
                <Switch size="sm" checked={keepOpen} onCheckedChange={setKeepOpen} />
                {t(($) => $.create_issue.create_another)}
                {keepOpen && sentCount > 0 && (
                  <span>· {t(($) => $.create_issue.agent.sent_count, { count: sentCount })}</span>
                )}
              </label>
              {parentIssueId && (
                <span
                  data-testid="agent-sub-issue-chip"
                  title={t(($) => $.create_issue.agent.sub_issue_of, {
                    identifier: parentIssueIdentifier ?? "",
                  })}
                >
                  {t(($) => $.create_issue.agent.sub_issue_of, {
                    identifier: parentIssueIdentifier ?? "",
                  })}
                </span>
              )}
              <span>{t(($) => $.create_issue.paper_foot_solo)}</span>
            </div>

            <span className="qk-dispatch-stamp" aria-hidden="true">
              {t(($) => $.create_issue.stamp_solo)}
            </span>
          </div>

          <aside className="qk-create-panel">
            <div className="qk-panel-scroll">
            <div className="qk-panel-head">
              <span>{t(($) => $.create_issue.executor_label)}</span>
              <span className="qk-panel-hint">
                {t(($) => $.create_issue.available_agents, { count: visibleAgents.length })}
              </span>
            </div>

            {visibleAgents.length === 0 ? (
              <div className="qk-panel-warning">
                {t(($) => $.create_issue.no_own_agents)}{" "}
                <AppLink href={workspacePaths.agents()} className="underline underline-offset-2">
                  {t(($) => $.create_issue.create_agent)}
                </AppLink>
              </div>
            ) : (
              <div className="qk-seats">
                {visibleAgents.map((agent) => {
                  const runtime = runtimeById.get(agent.runtime_id);
                  const selected = selectedAgent?.id === agent.id;
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      data-active={selected ? "" : undefined}
                      onClick={() => {
                        setActor({ type: "agent", id: agent.id });
                        setAgent({ actorType: "agent", actorId: agent.id });
                        setError(null);
                      }}
                      className="qk-seat"
                    >
                      <ActorAvatar
                        actorType="agent"
                        actorId={agent.id}
                        size="md"
                        profileLink={false}
                        className="qk-seat-ava"
                      />
                      <span className="qk-seat-main">
                        <b>{agent.name}</b>
                        <span>
                          {runtime ? runtimeDisplayLabel(runtime) : t(($) => $.create_issue.status_offline)}
                        </span>
                      </span>
                      <span
                        className="qk-seat-state"
                        data-live={agent.status === "working" ? "" : undefined}
                      >
                        {agentStatusLabel(agent.status, t)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="qk-panel-section">
              <div className="flex items-center justify-between gap-2">
                <span className="qk-panel-label">{t(($) => $.create_issue.section_details)}</span>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button
                        type="button"
                        className="qk-leg-action"
                        aria-label={t(($) => $.create_issue.agent.more_fields_aria)}
                        title={t(($) => $.create_issue.agent.more_fields_aria)}
                      >
                        <MoreHorizontal className="size-3.5" />
                      </button>
                    }
                  />
                  <DropdownMenuContent align="end" className="w-52">
                    {!visibleFields.includes("project") && projectId === null && (
                      <DropdownMenuItem onClick={() => setFieldPickerOpen("project")}>
                        <FolderKanban className="size-3.5 text-muted-foreground" />
                        {t(($) => $.create_issue.agent.set_project)}
                      </DropdownMenuItem>
                    )}
                    {!visibleFields.includes("priority") && priority === "none" && (
                      <DropdownMenuItem onClick={() => setFieldPickerOpen("priority")}>
                        <PriorityIcon priority="none" className="size-3.5" />
                        {t(($) => $.create_issue.agent.set_priority)}
                      </DropdownMenuItem>
                    )}
                    {!visibleFields.includes("due_date") && dueDate === null && (
                      <DropdownMenuItem onClick={() => setFieldPickerOpen("due_date")}>
                        <CalendarDays className="size-3.5 text-muted-foreground" />
                        {t(($) => $.create_issue.agent.set_due_date)}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      render={
                        <AppLink
                          href={`${workspacePaths.settings()}?tab=issue`}
                          onClick={openFieldSettings}
                        />
                      }
                    >
                      <Settings2 className="size-3.5 text-muted-foreground" />
                      {t(($) => $.create_issue.agent.customize_fields)}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="qk-panel-rows">
                <div className="qk-panel-row">
                  <span className="qk-row-label">{t(($) => $.create_issue.field_project)}</span>
                  <div className="min-w-0 flex-1">
                    <ProjectPicker
                      projectId={projectId}
                      onUpdate={(u) => commitProject(u.project_id ?? null)}
                      triggerRender={<button type="button" className="qk-dark-control" />}
                      align="start"
                      open={fieldPickerOpen === "project" ? true : undefined}
                      onOpenChange={(open) => setFieldPickerOpen(open ? "project" : null)}
                    />
                  </div>
                </div>
                <div className="qk-panel-row">
                  <span className="qk-row-label">{t(($) => $.create_issue.field_priority)}</span>
                  <div className="min-w-0 flex-1">
                    <DispatchPriority
                      value={priority}
                      disabled={submitting}
                      onChange={(next) => {
                        setPriority(next);
                        setShared({ priority: next });
                      }}
                    />
                  </div>
                </div>
                <div className="qk-panel-row">
                  <span className="qk-row-label">{t(($) => $.create_issue.field_due)}</span>
                  <div className="min-w-0 flex-1">
                    <DueDatePicker
                      dueDate={dueDate}
                      onUpdate={(updates) => {
                        const next = updates.due_date ?? null;
                        setDueDate(next);
                        setShared({ dueDate: next });
                      }}
                      triggerRender={<button type="button" className="qk-dark-control" />}
                      align="start"
                      open={fieldPickerOpen === "due_date" ? true : undefined}
                      onOpenChange={(open) => setFieldPickerOpen(open ? "due_date" : null)}
                    />
                  </div>
                </div>
              </div>
            </div>

            {selectedAgent && versionBlocked && (
              <div className="qk-panel-warning">
                {versionCheck.state === "missing"
                  ? t(($) => $.create_issue.agent.version_missing, { min: versionCheck.min })
                  : t(($) => $.create_issue.agent.version_below, {
                      current: versionCheck.current,
                      min: versionCheck.min,
                    })}
              </div>
            )}

            <div className="qk-panel-note">
              <span
                aria-hidden="true"
                className="mt-[5px] size-[5px] shrink-0 rounded-[1px] bg-[var(--qk-panel-accent)]"
              />
              <span>
                {selectedAgent
                  ? t(($) => $.run_confirm.create_will_start, { name: selectedAgent.name })
                  : t(($) => $.create_issue.agent.pick_an_agent)}
              </span>
            </div>

            </div>

            <div className="qk-panel-foot">
              <button type="button" className="qk-panel-cancel" onClick={onClose}>
                {t(($) => $.common.cancel)}
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!hasContent || !actor || submitting || stamped || versionBlocked || gate.uploading || (!!anchorCommentId && !sourcePreview)}
                aria-disabled={gate.uploading || undefined}
                aria-busy={gate.uploading || submitting || undefined}
                title={
                  versionBlocked
                    ? t(($) => $.create_issue.agent.version_blocked_tooltip, { min: versionCheck.min })
                    : undefined
                }
                className="qk-panel-submit"
              >
                {submitting
                  ? t(($) => $.create_issue.agent.sending)
                  : gate.uploading
                    ? t(($) => $.create_issue.agent.uploading)
                    : justSent
                      ? <span className="inline-flex items-center gap-1"><Check className="size-3.5" />{t(($) => $.create_issue.agent.sent_label)}</span>
                      : (
                        <>
                          {t(($) => $.create_issue.dispatch)}
                          {sendShortcut ? (
                            <ShortcutKeycaps
                              shortcut={sendShortcut}
                              decorative
                              className="ml-1 max-sm:hidden"
                              keyClassName="border-black/20 bg-black/10 text-black/55 shadow-none"
                            />
                          ) : null}
                          <ArrowUpRight className="size-3" aria-hidden="true" />
                        </>
                      )}
              </button>
            </div>
          </aside>
    </CreateTaskChrome>
  );
}

// One label per AgentStatus tier — the seat shows whether Create will start
// work immediately (idle/working runtime) or queue behind an offline machine.
function agentStatusLabel(
  status: Agent["status"],
  t: ReturnType<typeof useT<"modals">>["t"],
): string {
  if (status === "idle") return t(($) => $.create_issue.status_idle);
  if (status === "working") return t(($) => $.create_issue.status_working);
  return t(($) => $.create_issue.status_offline);
}
