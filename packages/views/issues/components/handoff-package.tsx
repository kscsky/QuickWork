"use client";

import { useEffect, useMemo, useState, type Ref } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Download,
  FileText,
  GitBranch,
  Plus,
  X,
} from "lucide-react";
import type {
  Attachment,
  IssueChainHandoffAcceptance,
  IssueChainHandoffFile,
  IssueChainStep,
} from "@quickwork/core/types";
import { Button } from "@quickwork/ui/components/ui/button";
import { Textarea } from "@quickwork/ui/components/ui/textarea";
import { cn } from "@quickwork/ui/lib/utils";

import { ActorAvatar } from "../../common/actor-avatar";
import { useAttachmentPreview, useDownloadAttachment } from "../../editor";
import { useT } from "../../i18n";
import type { HandoffDraft } from "./relay-leg-rail";

/**
 * The squad task's handoff package, as the review artifact the relay is built
 * around: what this leg promised, what it actually delivered, what the next
 * leg must do, and the gaps that travel with it. The holder edits the package
 * in place while reviewing; after approval it is a read-only record.
 *
 * This is the refresh layout's card. The compact chip/card components in
 * relay-leg-rail stay for the legacy room layout.
 */

function parseLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileExt(name: string): string {
  const parts = name.split(".");
  const ext = parts.length > 1 ? parts[parts.length - 1] : "";
  return (ext || "FILE").slice(0, 4).toUpperCase();
}

/**
 * The holder's brief for a leg. The plan belongs to the person whose turn it
 * is; the card turns into an editor for them and stays read-only for everyone
 * else.
 */
export function LegBriefCard({
  plan,
  editable,
  pending,
  facts,
  onSave,
}: {
  plan: string;
  editable: boolean;
  pending: boolean;
  facts: Array<{ label: string; value: string }>;
  onSave: (plan: string) => void;
}) {
  const { t } = useT("issues");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(plan);
  useEffect(() => {
    setDraft(plan);
    setEditing(false);
  }, [plan]);

  return (
    <div className="rd-brief">
      {editable ? (
        <div className="rd-ho-brief-badge-row">
          <span className="rd-ho-brief-badge">
            {t(($) => $.room.leg_plan_only_you)}
          </span>
        </div>
      ) : null}
      {editing ? (
        <div className="rd-ho-brief-edit">
          <Textarea
            autoFocus
            rows={4}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t(($) => $.room.leg_plan_placeholder)}
            className="text-body"
          />
          <div className="rd-ho-brief-actions">
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setDraft(plan);
                setEditing(false);
              }}
            >
              {t(($) => $.room.leg_plan_cancel)}
            </Button>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => onSave(draft.trim())}
            >
              {t(($) => $.room.leg_plan_save)}
            </Button>
          </div>
        </div>
      ) : plan ? (
        <button
          type="button"
          className="rd-ho-brief-plan"
          disabled={!editable}
          onClick={() => editable && setEditing(true)}
        >
          <span>{plan}</span>
          {editable ? (
            <span className="rd-ho-brief-edit-hint">
              {t(($) => $.room.leg_plan_label)}
            </span>
          ) : null}
        </button>
      ) : (
        <button
          type="button"
          className="rd-ho-brief-empty"
          disabled={!editable}
          onClick={() => editable && setEditing(true)}
        >
          {editable
            ? t(($) => $.room.leg_plan_empty)
            : t(($) => $.room.handoff_brief_empty)}
        </button>
      )}
      <div className="rd-brief-facts">
        {facts.map((fact) => (
          <span key={fact.label}>
            <b>{fact.label}</b>
            {fact.value}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * What the previous leg actually handed over, on the page of the leg that has
 * to receive it. The current leg's own package lives further down; this card
 * is the other half of the comparison — the next holder sees the delivery,
 * the gaps, and the tasks written for them before writing their own plan.
 */
export function PreviousHandoffCard({
  step,
  seq,
  nameOf,
  attachmentOf,
  onOpen,
}: {
  step: IssueChainStep;
  seq: number;
  nameOf: (userId: string) => string;
  attachmentOf?: (id: string) => Attachment | undefined;
  onOpen: () => void;
}) {
  const { t } = useT("issues");
  const preview = useAttachmentPreview();
  const download = useDownloadAttachment();
  const handoff = step.handoff;
  if (!handoff) return null;
  const openFile = (file: IssueChainHandoffFile) => {
    const attachment = file.attachment_id
      ? attachmentOf?.(file.attachment_id)
      : undefined;
    if (!attachment) return;
    const opened = preview.tryOpen(
      { kind: "full", attachment },
      { editable: true },
    );
    if (!opened) void download(attachment.id);
  };
  return (
    <section className="rd-section" id="previous-handoff">
      <div className="rd-section-head">
        <span>
          {t(($) => $.room.handoff_prev_section, { seq })}
        </span>
        <i />
        <button type="button" className="rd-ho-prev-open" onClick={onOpen}>
          {t(($) => $.room.handoff_prev_view)} →
        </button>
      </div>
      <div className="rd-ho-prev">
        <div className="rd-ho-prev-head">
          <ActorAvatar
            actorType="member"
            actorId={step.holder_user_id}
            size="xs"
            profileLink={false}
            className="rd-ho-ava"
          />
          <span className="who">
            <b>{nameOf(step.holder_user_id)}</b>
            <em>{t(($) => $.room.handoff_prev_by)}</em>
          </span>
        </div>
        {handoff.summary ? (
          <p className="rd-ho-prev-summary">{handoff.summary}</p>
        ) : (
          <p className="rd-ho-prev-summary rd-ho-muted">
            {t(($) => $.room.handoff_summary_empty)}
          </p>
        )}
        {handoff.files.length > 0 ? (
          <div className="rd-ho-prev-files">
            {handoff.files.map((file, index) => {
              const attachment = file.attachment_id
                ? attachmentOf?.(file.attachment_id)
                : undefined;
              return (
                <FileRow
                  key={`${file.name}-${index}`}
                  file={file}
                  attachment={attachment}
                  onOpen={attachment ? () => openFile(file) : undefined}
                  onDownload={
                    attachment ? () => void download(attachment.id) : undefined
                  }
                />
              );
            })}
          </div>
        ) : null}
        {handoff.open_questions.length > 0 ? (
          <div className="rd-ho-prev-block">
            <div className="rd-ho-label">
              <span>{t(($) => $.room.handoff_prev_open)}</span>
              <span className="rd-ho-rule" />
              <span className="rd-ho-count">{handoff.open_questions.length}</span>
            </div>
            <div className="rd-ho-open-list">
              {handoff.open_questions.slice(0, 3).map((question, index) => (
                <div key={`${question}-${index}`} className="rd-ho-open-item">
                  <span className="q">Q{index + 1}</span>
                  <span>{question}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {handoff.next_brief.length > 0 ? (
          <div className="rd-ho-prev-block">
            <div className="rd-ho-label">
              <span>{t(($) => $.room.handoff_prev_task)}</span>
              <span className="rd-ho-rule" />
            </div>
            <ol className="rd-ho-next-list">
              {handoff.next_brief.map((item, index) => (
                <li key={`${item}-${index}`}>
                  <span className="n">{String(index + 1).padStart(2, "0")}</span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
      {preview.modal}
    </section>
  );
}

function FileRow({
  file,
  attachment,
  checked,
  onToggle,
  onOpen,
  onDownload,
}: {
  file: IssueChainHandoffFile;
  attachment?: Attachment;
  checked?: boolean;
  onToggle?: () => void;
  onOpen?: () => void;
  onDownload?: () => void;
}) {
  const { t } = useT("issues");
  const isBranch = file.kind === "branch";
  const size = typeof file.size === "number" && file.size > 0
    ? formatFileSize(file.size)
    : null;
  return (
    <div className="rd-ho-file" data-checked={checked ? "" : undefined}>
      {onToggle ? (
        <button
          type="button"
          className="rd-ho-file-check"
          aria-pressed={checked}
          aria-label={t(($) => $.room.handoff_toggle_file, { name: file.name })}
          onClick={onToggle}
        >
          <Check className="size-2.5" />
        </button>
      ) : (
        <span className="rd-ho-file-ico">{isBranch ? <GitBranch className="size-3" /> : fileExt(file.name)}</span>
      )}
      <span className="rd-ho-file-main">
        <span className="rd-ho-file-name">{file.name}</span>
        <span className="rd-ho-file-meta">
          {isBranch
            ? t(($) => $.room.handoff_branch)
            : size ?? t(($) => $.room.handoff_file_attachment)}
          {attachment ? ` · ${attachment.content_type}` : null}
        </span>
      </span>
      {attachment && onOpen ? (
        <button
          type="button"
          className="rd-ho-file-action"
          title={t(($) => $.room.handoff_file_open)}
          onClick={onOpen}
        >
          <FileText className="size-3" />
          {t(($) => $.room.handoff_file_open)}
        </button>
      ) : null}
      {attachment && onDownload ? (
        <button
          type="button"
          className="rd-ho-file-icon"
          title={t(($) => $.room.file_download)}
          aria-label={t(($) => $.room.file_download)}
          onClick={onDownload}
        >
          <Download className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

export interface HandoffPackageCardProps {
  step: IssueChainStep;
  nextStep: IssueChainStep | null;
  identifier: string;
  seq: number;
  timeLabel: string;
  agentName?: string;
  nameOf: (userId: string) => string;
  attachmentOf?: (id: string) => Attachment | undefined;
  draft?: HandoffDraft;
  canApprove: boolean;
  approvePending: boolean;
  returnPending: boolean;
  /** The leg's agent is writing the summary — server-backed, survives reloads. */
  outputRunning?: boolean;
  onApprove: () => void;
  onReturn: (reason: string) => void;
  onOpenNext?: () => void;
  returnOpen: boolean;
  onReturnOpenChange: (open: boolean) => void;
  sectionRef?: Ref<HTMLElement>;
}

const RETURN_REASONS = ["evidence", "requirement", "source", "scope"] as const;

export function HandoffPackageCard({
  step,
  nextStep,
  identifier,
  seq,
  timeLabel,
  agentName,
  nameOf,
  attachmentOf,
  draft,
  canApprove,
  approvePending,
  returnPending,
  outputRunning = false,
  onApprove,
  onReturn,
  onOpenNext,
  returnOpen,
  onReturnOpenChange,
  sectionRef,
}: HandoffPackageCardProps) {
  const { t } = useT("issues");
  const preview = useAttachmentPreview();
  const download = useDownloadAttachment();
  const [returnReasons, setReturnReasons] = useState<string[]>([]);
  const [returnText, setReturnText] = useState("");

  const editing = canApprove && !!draft;
  const handoff = step.handoff;
  const acceptance = editing ? draft.acceptance : handoff?.acceptance ?? [];
  const openQuestions = editing
    ? parseLines(draft.openQuestions)
    : handoff?.open_questions ?? [];
  const nextBrief = editing
    ? parseLines(draft.nextBrief)
    : handoff?.next_brief ?? [];
  const summary = editing ? draft.summary : handoff?.summary ?? "";
  const files = useMemo<IssueChainHandoffFile[]>(() => {
    if (!editing) return handoff?.files ?? [];
    return draft.candidates
      .filter((candidate) => draft.picked.has(candidate.id))
      .map((candidate) => ({
        name: candidate.name,
        size: candidate.size,
        kind: candidate.kind,
        attachment_id: candidate.attachment_id,
      }));
  }, [editing, draft, handoff?.files]);
  const unselected = editing
    ? draft.candidates.filter((candidate) => !draft.picked.has(candidate.id))
    : [];
  const returned = handoff?.returned;
  const done = step.state === "done" || step.state === "skipped";
  const returnedActive = !!returned && step.state === "doing";
  const stamp = done
    ? { label: t(($) => $.room.handoff_stamp_handed), sub: t(($) => $.room.handoff_stamp_handed_sub) }
    : returnedActive
      ? { label: t(($) => $.room.handoff_stamp_returned), sub: t(($) => $.room.handoff_stamp_returned_sub) }
      : { label: t(($) => $.room.handoff_stamp_review), sub: t(($) => $.room.handoff_stamp_review_sub) };
  const state = done ? "handed" : returnedActive ? "returned" : "review";
  const passCount = acceptance.filter((row) => row.state !== "warn").length;
  const warnCount = acceptance.length - passCount;
  const nextName = nextStep ? nameOf(nextStep.holder_user_id) : null;
  const nextSeq = nextStep ? nextStep.position + 1 : null;
  const nextStateLabel = !nextStep
    ? t(($) => $.room.handoff_flow_end)
    : nextStep.state === "done" || nextStep.state === "skipped"
      ? t(($) => $.room.state_done)
      : nextStep.state === "reviewing"
        ? t(($) => $.room.state_reviewing)
        : nextStep.state === "doing"
          ? t(($) => $.room.state_doing)
          : nextStep.state === "parked"
            ? t(($) => $.room.state_parked)
            : t(($) => $.room.handoff_next_waiting);
  const ownerName = nameOf(step.holder_user_id);
  const packageId = `HO-${identifier}-${seq}`;

  const openFile = (file: IssueChainHandoffFile) => {
    const attachment = file.attachment_id
      ? attachmentOf?.(file.attachment_id)
      : undefined;
    if (!attachment) return;
    const opened = preview.tryOpen(
      { kind: "full", attachment },
      { editable: true },
    );
    if (!opened) void download(attachment.id);
  };

  const changeAcceptance = (rows: IssueChainHandoffAcceptance[]) => {
    draft?.onAcceptanceChange(rows);
  };
  const updateAcceptance = (
    index: number,
    patch: Partial<IssueChainHandoffAcceptance>,
  ) => {
    if (!draft) return;
    changeAcceptance(
      draft.acceptance.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };
  const removeAcceptance = (index: number) => {
    if (!draft) return;
    changeAcceptance(draft.acceptance.filter((_, i) => i !== index));
  };
  const addAcceptance = () => {
    if (!draft) return;
    changeAcceptance([
      ...draft.acceptance,
      { label: "", requirement: "", delivered: "", state: "pass" },
    ]);
  };

  const returnReason = useMemo(() => {
    const labels = returnReasons.map((key) => {
      switch (key) {
        case "evidence":
          return t(($) => $.room.handoff_return_reason_evidence);
        case "requirement":
          return t(($) => $.room.handoff_return_reason_requirement);
        case "source":
          return t(($) => $.room.handoff_return_reason_source);
        default:
          return t(($) => $.room.handoff_return_reason_scope);
      }
    });
    const text = returnText.trim();
    return [...labels, text].filter(Boolean).join(" · ");
  }, [returnReasons, returnText, t]);

  const submitReturn = () => {
    if (!returnReason || returnPending) return;
    onReturn(returnReason);
  };

  const toggleReason = (key: string) => {
    setReturnReasons((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
    );
  };

  return (
    <section className="rd-section" ref={sectionRef} id="handoff-package">
      <div className="rd-section-head">
        <span>{t(($) => $.room.handoff_section)}</span>
        <i />
        <em>
          {acceptance.length > 0
            ? t(($) => $.room.handoff_acceptance_count, {
                pass: passCount,
                total: acceptance.length,
              })
            : t(($) => $.room.handoff_acceptance_empty_short)}
        </em>
      </div>
      <article className="rd-ho" data-ho={state}>
        <header className="rd-ho-head">
          <div className="rd-ho-head-main">
            <div className="rd-ho-kicker">
              {packageId} · {t(($) => $.room.handoff_package_kicker)}
            </div>
            <div className="rd-ho-route">
              <span className="rd-ho-party">
                <ActorAvatar
                  actorType="member"
                  actorId={step.holder_user_id}
                  size="xs"
                  profileLink={false}
                  className="rd-ho-ava"
                />
                <span>
                  <b>{ownerName}</b>
                  <em>{t(($) => $.room.handoff_from)}</em>
                </span>
              </span>
              <span className="rd-ho-arrow" aria-hidden="true">
                <i />
                <span>→</span>
              </span>
              <span className="rd-ho-party">
                {nextStep ? (
                  <ActorAvatar
                    actorType="member"
                    actorId={nextStep.holder_user_id}
                    size="xs"
                    profileLink={false}
                    className="rd-ho-ava"
                  />
                ) : (
                  <span className="rd-ho-ava rd-ho-ava-end">
                    <Check className="size-3" />
                  </span>
                )}
                <span>
                  <b>{nextName ?? t(($) => $.room.handoff_flow_end)}</b>
                  <em>
                    {nextStep
                      ? t(($) => $.room.handoff_to)
                      : t(($) => $.room.handoff_to_end)}
                  </em>
                </span>
              </span>
            </div>
            <div className="rd-ho-sub">
              {nextStep
                ? t(($) => $.room.handoff_leg_route, { from: seq, to: nextSeq })
                : t(($) => $.room.handoff_leg_route_end, { from: seq })}
              <span className="rd-ho-dot" />
              {t(($) => $.room.handoff_delivered_at, { when: timeLabel })}
              {agentName ? (
                <>
                  <span className="rd-ho-dot" />
                  {t(($) => $.room.handoff_agent_run, { agent: agentName })}
                </>
              ) : null}
            </div>
          </div>
          <div className="rd-ho-stamp" data-stamp={state}>
            <span>{stamp.label}</span>
            <em>{stamp.sub}</em>
          </div>
        </header>
        <div className="rd-ho-perf" aria-hidden="true" />
        <div className="rd-ho-summary">
          <div className="rd-ho-label">
            <span>{t(($) => $.room.handoff_summary)}</span>
            <span className="rd-ho-rule" />
          </div>
          {outputRunning ? (
            <div className="rd-ho-running">
              <span className="dot" aria-hidden="true" />
              {t(($) => $.room.handoff_summary_running)}
            </div>
          ) : null}
          {editing ? (
            <Textarea
              value={draft.summary}
              maxLength={50000}
              rows={3}
              onChange={(event) => draft.onSummaryChange(event.target.value)}
              placeholder={t(($) => $.room.leg_summary_placeholder)}
              className="rd-ho-summary-input"
            />
          ) : summary ? (
            <p>{summary}</p>
          ) : (
            <p className="rd-ho-muted">{t(($) => $.room.handoff_summary_empty)}</p>
          )}
          <div className="rd-ho-metrics">
            <div className="rd-ho-metric">
              <span className="k">{t(($) => $.room.handoff_metric_files)}</span>
              <span className="v">
                {files.length}
                <small>{t(($) => $.room.handoff_metric_files_note)}</small>
              </span>
            </div>
            <div className="rd-ho-metric">
              <span className="k">{t(($) => $.room.handoff_metric_acceptance)}</span>
              <span className="v">
                {acceptance.length > 0 ? `${passCount} / ${acceptance.length}` : "—"}
                <small>
                  {warnCount > 0
                    ? t(($) => $.room.handoff_metric_warn, { count: warnCount })
                    : t(($) => $.room.handoff_metric_pass)}
                </small>
              </span>
            </div>
            <div className="rd-ho-metric">
              <span className="k">{t(($) => $.room.handoff_metric_open)}</span>
              <span className="v">
                {openQuestions.length}
                <small>{t(($) => $.room.handoff_metric_open_note)}</small>
              </span>
            </div>
            <div className="rd-ho-metric">
              <span className="k">{t(($) => $.room.handoff_metric_next)}</span>
              <span className="v">
                {nextName ?? t(($) => $.room.handoff_flow_end)}
                <small>{t(($) => $.room.handoff_metric_next_note)}</small>
              </span>
            </div>
          </div>
        </div>

        <div className="rd-ho-body">
          <div className="rd-ho-block">
            <div className="rd-ho-label">
              <span>{t(($) => $.room.handoff_acceptance)}</span>
              <span className="rd-ho-rule" />
              <span className="rd-ho-count">
                {acceptance.length > 0
                  ? t(($) => $.room.handoff_acceptance_count, {
                      pass: passCount,
                      total: acceptance.length,
                    })
                  : t(($) => $.room.handoff_acceptance_empty_short)}
              </span>
            </div>
            <div className="rd-ho-table-scroll">
            <table className={cn("rd-ho-table", editing && "rd-ho-table-edit")}>
              <thead>
                <tr>
                  <th className="rd-ho-col-label">{t(($) => $.room.handoff_col_item)}</th>
                  <th>{t(($) => $.room.handoff_col_requirement)}</th>
                  <th>{t(($) => $.room.handoff_col_delivered)}</th>
                  <th className="rd-ho-col-result">{t(($) => $.room.handoff_col_result)}</th>
                  {editing ? <th className="rd-ho-col-remove" aria-hidden="true" /> : null}
                </tr>
              </thead>
              <tbody>
                {acceptance.length === 0 ? (
                  <tr>
                    <td colSpan={editing ? 5 : 4} className="rd-ho-table-empty">
                      {editing
                        ? t(($) => $.room.handoff_acceptance_empty)
                        : t(($) => $.room.handoff_acceptance_empty)}
                    </td>
                  </tr>
                ) : (
                  acceptance.map((row, index) => (
                    <tr key={`${row.label}-${index}`} className={cn(row.state === "warn" && "warn")}>
                      <td>
                        {editing ? (
                          <input
                            className="rd-ho-input rd-ho-input-label"
                            value={row.label}
                            aria-label={t(($) => $.room.handoff_col_item)}
                            placeholder={t(($) => $.room.handoff_label_placeholder)}
                            onChange={(event) =>
                              updateAcceptance(index, { label: event.target.value })
                            }
                          />
                        ) : (
                          <span className="rd-ho-key">{row.label}</span>
                        )}
                      </td>
                      <td>
                        {editing ? (
                          <input
                            className="rd-ho-input"
                            value={row.requirement}
                            aria-label={t(($) => $.room.handoff_col_requirement)}
                            placeholder={t(($) => $.room.handoff_requirement_placeholder)}
                            onChange={(event) =>
                              updateAcceptance(index, { requirement: event.target.value })
                            }
                          />
                        ) : (
                          <span className="rd-ho-req">{row.requirement}</span>
                        )}
                      </td>
                      <td>
                        {editing ? (
                          <input
                            className="rd-ho-input"
                            value={row.delivered}
                            aria-label={t(($) => $.room.handoff_col_delivered)}
                            placeholder={t(($) => $.room.handoff_delivered_placeholder)}
                            onChange={(event) =>
                              updateAcceptance(index, { delivered: event.target.value })
                            }
                          />
                        ) : (
                          <span className="rd-ho-got">{row.delivered}</span>
                        )}
                      </td>
                      <td className="rd-ho-col-result">
                        <button
                          type="button"
                          className={cn("rd-ho-verdict", row.state === "warn" && "warn")}
                          disabled={!editing}
                          onClick={() =>
                            updateAcceptance(index, {
                              state: row.state === "warn" ? "pass" : "warn",
                            })
                          }
                        >
                          {row.state === "warn" ? (
                            <AlertTriangle className="size-2.5" />
                          ) : (
                            <Check className="size-2.5" />
                          )}
                          {row.state === "warn"
                            ? t(($) => $.room.handoff_warn)
                            : t(($) => $.room.handoff_pass)}
                        </button>
                      </td>
                      {editing ? (
                        <td className="rd-ho-col-remove">
                          <button
                            type="button"
                            className="rd-ho-remove"
                            title={t(($) => $.room.handoff_remove_acceptance)}
                            aria-label={t(($) => $.room.handoff_remove_acceptance)}
                            onClick={() => removeAcceptance(index)}
                          >
                            <X className="size-3" />
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>
            {editing ? (
              <button type="button" className="rd-ho-add" onClick={addAcceptance}>
                <Plus className="size-3" />
                {t(($) => $.room.handoff_add_acceptance)}
              </button>
            ) : null}
          </div>

          <div className="rd-ho-split">
            <div className="rd-ho-col">
              <div className="rd-ho-label">
                <span>{t(($) => $.room.handoff_delivered_section)}</span>
                <span className="rd-ho-rule" />
                <span className="rd-ho-count">
                  {t(($) => $.room.handoff_files_count, { count: files.length })}
                </span>
              </div>
              {files.length === 0 ? (
                <p className="rd-ho-empty-line">{t(($) => $.room.handoff_no_files)}</p>
              ) : (
                <div className="rd-ho-files">
                  {files.map((file, index) => {
                    const attachment = file.attachment_id
                      ? attachmentOf?.(file.attachment_id)
                      : undefined;
                    return (
                      <FileRow
                        key={`${file.name}-${index}`}
                        file={file}
                        attachment={attachment}
                        checked={editing ? draft.picked.has(
                          file.attachment_id
                            ? `att:${file.attachment_id}`
                            : draft.candidates.find((candidate) =>
                                candidate.kind === "branch" && candidate.name === file.name,
                              )?.id ?? "",
                        ) : undefined}
                        onToggle={editing ? () => {
                          const id = file.attachment_id
                            ? `att:${file.attachment_id}`
                            : draft.candidates.find((candidate) =>
                                candidate.kind === "branch" && candidate.name === file.name,
                              )?.id;
                          if (id) draft.onToggle(id);
                        } : undefined}
                        onOpen={attachment ? () => openFile(file) : undefined}
                        onDownload={attachment ? () => void download(attachment.id) : undefined}
                      />
                    );
                  })}
                </div>
              )}
              {editing && unselected.length > 0 ? (
                <details className="rd-ho-picker">
                  <summary>
                    <ChevronDown className="size-3" />
                    {t(($) => $.room.handoff_pick_files)}
                    <span>{t(($) => $.room.handoff_files_count, { count: unselected.length })}</span>
                  </summary>
                  <div>
                    {unselected.map((candidate) => {
                      const attachment = candidate.attachment_id
                        ? attachmentOf?.(candidate.attachment_id)
                        : undefined;
                      return (
                        <FileRow
                          key={candidate.id}
                          file={{
                            name: candidate.name,
                            size: candidate.size,
                            kind: candidate.kind,
                            attachment_id: candidate.attachment_id,
                          }}
                          attachment={attachment}
                          checked={false}
                          onToggle={() => draft.onToggle(candidate.id)}
                        />
                      );
                    })}
                  </div>
                </details>
              ) : editing ? (
                <p className="rd-ho-hint">
                  {draft.candidates.length === 0
                    ? t(($) => $.room.leg_outputs_empty)
                    : t(($) => $.room.handoff_pick_none)}
                </p>
              ) : null}
            </div>

            <div className="rd-ho-col">
              <div className="rd-ho-label">
                <span>{t(($) => $.room.handoff_next_section)}</span>
                <span className="rd-ho-rule" />
                <span className="rd-ho-count">
                  {nextName ?? t(($) => $.room.handoff_flow_end)}
                </span>
              </div>
              <div className="rd-ho-next-who">
                {nextStep ? (
                  <ActorAvatar
                    actorType="member"
                    actorId={nextStep.holder_user_id}
                    size="xs"
                    profileLink={false}
                    className="rd-ho-ava"
                  />
                ) : (
                  <span className="rd-ho-ava rd-ho-ava-end">
                    <Check className="size-3" />
                  </span>
                )}
                <span className="rd-ho-next-name">
                  <b>{nextName ?? t(($) => $.room.handoff_flow_end)}</b>
                  <em>
                    {nextStep
                      ? t(($) => $.room.handoff_next_holder, {
                          name: nextName,
                          seq: nextSeq,
                        })
                      : t(($) => $.room.handoff_last_leg)}
                  </em>
                </span>
                <span className="rd-ho-next-state">{nextStateLabel}</span>
              </div>
              {editing ? (
                <Textarea
                  value={draft.nextBrief}
                  rows={4}
                  onChange={(event) => draft.onNextBriefChange(event.target.value)}
                  placeholder={t(($) => $.room.handoff_next_brief_placeholder)}
                  className="rd-ho-list-input"
                />
              ) : nextBrief.length > 0 ? (
                <ol className="rd-ho-next-list">
                  {nextBrief.map((item, index) => (
                    <li key={`${item}-${index}`}>
                      <span className="n">{String(index + 1).padStart(2, "0")}</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="rd-ho-empty-line">
                  {t(($) => $.room.handoff_next_brief_empty)}
                </p>
              )}
              <div className="rd-ho-gate">
                <span aria-hidden="true">↗</span>
                <span>
                  {nextStep
                    ? t(($) => $.room.handoff_next_condition, { name: nextName })
                    : t(($) => $.room.handoff_next_condition_last)}
                </span>
              </div>
            </div>
          </div>

          <div className="rd-ho-open">
            <div className="rd-ho-label">
              <span>{t(($) => $.room.handoff_open_section)}</span>
              <span className="rd-ho-rule" />
              <span className="rd-ho-count">
                {openQuestions.length > 0
                  ? t(($) => $.room.handoff_items_count, { count: openQuestions.length })
                  : "0"}
              </span>
            </div>
            {editing ? (
              <Textarea
                value={draft.openQuestions}
                rows={3}
                onChange={(event) => draft.onOpenQuestionsChange(event.target.value)}
                placeholder={t(($) => $.room.handoff_open_placeholder)}
                className="rd-ho-list-input"
              />
            ) : openQuestions.length > 0 ? (
              <div className="rd-ho-open-list">
                {openQuestions.map((question, index) => (
                  <div key={`${question}-${index}`} className="rd-ho-open-item">
                    <span className="q">Q{index + 1}</span>
                    <span>{question}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rd-ho-empty-line">{t(($) => $.room.handoff_open_empty)}</p>
            )}
          </div>
        </div>

        {returned && !done ? (
          <div className="rd-ho-returned" data-running={step.state === "doing" ? "" : undefined}>
            <AlertTriangle className="size-3.5" />
            <span>
              {step.state === "doing"
                ? t(($) => $.room.handoff_returned_note)
                : t(($) => $.room.handoff_returned_review_note)}
            </span>
            <span className="reason">
              {t(($) => $.room.handoff_returned_reason)}: {returned.reason}
            </span>
          </div>
        ) : null}

        {canApprove ? (
          <footer className="rd-ho-foot">
            <div className="rd-ho-foot-note">
              {outputRunning
                ? t(($) => $.room.handoff_summary_running)
                : !summary.trim()
                  ? t(($) => $.room.handoff_need_summary)
                  : nextStep
                    ? t(($) => $.room.handoff_footer_pass, { name: nextName })
                    : t(($) => $.room.handoff_footer_finish)}
            </div>
            <div className="rd-ho-actions">
              <button
                type="button"
                className="rd-ho-btn"
                disabled={returnPending || outputRunning}
                onClick={() => onReturnOpenChange(true)}
              >
                {t(($) => $.room.handoff_return)}
              </button>
              <button
                type="button"
                className="rd-ho-btn primary"
                disabled={
                  approvePending || outputRunning || !summary.trim()
                }
                onClick={onApprove}
              >
                {outputRunning
                  ? t(($) => $.room.output_producing)
                  : nextStep
                    ? t(($) => $.detail.refresh_pass)
                    : t(($) => $.detail.refresh_pass_finish)}
              </button>
            </div>
          </footer>
        ) : done ? (
          <div className="rd-ho-statebar done">
            <Check className="size-3" />
            <span>
              {nextName
                ? t(($) => $.room.handoff_done_note, { name: nextName })
                : t(($) => $.room.handoff_done_last)}
            </span>
            {nextStep && nextSeq && onOpenNext ? (
              <button type="button" className="rd-ho-link" onClick={onOpenNext}>
                {t(($) => $.room.handoff_view_next, { seq: nextSeq })}
              </button>
            ) : null}
          </div>
        ) : step.state === "reviewing" ? (
          <div className="rd-ho-statebar waiting">
            <span className="dot" aria-hidden="true" />
            <span>
              {t(($) => $.room.handoff_waiting_holder, { name: ownerName })}
            </span>
          </div>
        ) : null}

        {canApprove && returnOpen ? (
          <div className="rd-ho-return-panel">
            <div className="rd-ho-return-head">
              <b>{t(($) => $.room.handoff_return_title, { name: ownerName })}</b>
              <span>{t(($) => $.room.handoff_return_note)}</span>
            </div>
            <div className="rd-ho-chips">
              {RETURN_REASONS.map((key) => {
                const label =
                  key === "evidence"
                    ? t(($) => $.room.handoff_return_reason_evidence)
                    : key === "requirement"
                      ? t(($) => $.room.handoff_return_reason_requirement)
                      : key === "source"
                        ? t(($) => $.room.handoff_return_reason_source)
                        : t(($) => $.room.handoff_return_reason_scope);
                return (
                  <button
                    key={key}
                    type="button"
                    className="rd-ho-chip"
                    aria-pressed={returnReasons.includes(key)}
                    data-on={returnReasons.includes(key) ? "" : undefined}
                    onClick={() => toggleReason(key)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <Textarea
              value={returnText}
              rows={3}
              onChange={(event) => setReturnText(event.target.value)}
              placeholder={t(($) => $.room.handoff_return_placeholder)}
              className="rd-ho-return-input"
            />
            <div className="rd-ho-return-foot">
              <span>{t(($) => $.room.handoff_return_hint)}</span>
              <div>
                <button
                  type="button"
                  className="rd-ho-btn"
                  onClick={() => onReturnOpenChange(false)}
                >
                  {t(($) => $.room.handoff_return_cancel)}
                </button>
                <button
                  type="button"
                  className="rd-ho-btn warn"
                  disabled={!returnReason || returnPending}
                  onClick={submitReturn}
                >
                  {t(($) => $.room.handoff_return_submit)}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </article>
      {preview.modal}
    </section>
  );
}
