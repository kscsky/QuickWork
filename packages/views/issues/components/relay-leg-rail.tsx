"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Download, FileText, FolderOpen, GitBranch, Lock, Package } from "lucide-react";
import { projectResourcesOptions } from "@quickwork/core/projects";
import { useWorkspaceId } from "@quickwork/core/hooks";
import type {
  Attachment,
  IssueChainHandoffAcceptance,
  IssueChainHandoffFile,
  IssueChainStep,
  LocalDirectoryResourceRef,
  ProjectResource,
} from "@quickwork/core/types";
import { Button } from "@quickwork/ui/components/ui/button";
import { Textarea } from "@quickwork/ui/components/ui/textarea";
import { cn } from "@quickwork/ui/lib/utils";

import { useAttachmentPreview, useDownloadAttachment } from "../../editor";
import { useT } from "../../i18n";
import { useLocalDaemonStatus } from "../../platform";
import { localDirectoryLabel } from "../../projects/components/local-directory-label";
import { chainStateKey, type RelayView } from "./chain-run-state";

/**
 * The pieces the task detail page's relay chapters are built from.
 *
 * The page reads top-to-bottom as the relay itself: each leg is a chapter,
 * the reader's own leg carries the workbench (plan → chat → resources →
 * 通过), and nothing else speaks for the leg's private work. These are the
 * sections inside those chapters — the chapter chrome (seat, name, state)
 * belongs to the chapter, not here, so the same section can sit in a leg
 * that is running or one waiting on review.
 */

/** Compact size for a handoff file row ("4 KB", "1.2 MB"). */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const LABEL_CLASS =
  "font-mono text-micro uppercase tracking-wider text-faint-foreground";

function CardChip({ tone, children }: { tone: "ok" | "brand" | "warn" | "mute"; children: React.ReactNode }) {
  const toneClass: Record<string, string> = {
    ok: "bg-success/15 text-success",
    brand: "bg-brand/10 text-brand",
    warn: "bg-warning/20 text-warning",
    mute: "bg-muted text-faint-foreground",
  };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-[3px] px-1.5 py-px text-micro whitespace-nowrap",
        toneClass[tone],
      )}
    >
      {children}
    </span>
  );
}

/**
 * The resources THIS leg runs on.
 *
 * Agents run on their owner's machine, against the directories that machine
 * has bound to the project — so "my leg's resources" is the reader's own
 * daemon's directories here, and the others are named as belonging to other
 * members rather than hidden. Working files never enter the shared context;
 * the room only carries what an agent reports.
 */
export function LegResourcesSection({
  view,
  agentNameOf,
  projectId,
}: {
  view: RelayView;
  agentNameOf: (agentId: string) => string;
  projectId?: string | null;
}) {
  const { t } = useT("issues");
  const wsId = useWorkspaceId();
  const daemon = useLocalDaemonStatus();
  const { data: resources = [] } = useQuery({
    ...projectResourcesOptions(wsId, projectId ?? ""),
    enabled: Boolean(projectId),
  });
  const step = view.myStep;
  const agentName = step?.agent_id ? agentNameOf(step.agent_id) : null;
  const dirs: Array<ProjectResource & { resource_ref: LocalDirectoryResourceRef }> =
    resources.filter(
      (r): r is ProjectResource & { resource_ref: LocalDirectoryResourceRef } =>
        r.resource_type === "local_directory",
    );
  // Only split mine/others when this client knows its own daemon (desktop).
  // On web an unqualified list beats a split that would call every directory
  // "someone else's".
  const mine = daemon.daemonId
    ? dirs.filter((r) => r.resource_ref.daemon_id === daemon.daemonId)
    : null;
  const shown = mine ?? dirs;
  const others = mine ? dirs.length - mine.length : 0;

  return (
    <>
      {agentName ? (
        <div className="flex items-center gap-2 text-caption">
          <Check className="size-3.5 shrink-0 text-success" />
          <span className="min-w-0 truncate">
            {t(($) => $.room.res_agent, { agent: agentName })}
          </span>
        </div>
      ) : view.myDeliveredStep ? (
        <p className="text-caption text-muted-foreground">
          {t(($) => $.room.res_delivered_note)}
        </p>
      ) : (
        <p className="text-caption text-muted-foreground">
          {t(($) => $.room.res_no_agent)}
        </p>
      )}
      {dirs.length === 0 ? (
        <p className="mt-2 text-caption text-faint-foreground">
          {t(($) => $.room.res_none)}
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-1">
          {shown.map((resource) => {
            const ref = resource.resource_ref;
            const isWorktree = ref.execution_mode === "worktree";
            return (
              <div
                key={resource.id}
                className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1"
              >
                {isWorktree ? (
                  <GitBranch className="size-3 shrink-0 text-muted-foreground" />
                ) : (
                  <FolderOpen className="size-3 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 truncate font-mono text-micro text-muted-foreground">
                  {localDirectoryLabel(resource)}
                </span>
              </div>
            );
          })}
          {others > 0 ? (
            <p className="text-micro text-faint-foreground">
              {t(($) => $.room.res_others, { count: others })}
            </p>
          ) : null}
        </div>
      )}
      <div className="mt-2.5 flex items-start gap-2 rounded-md bg-foreground/5 px-2.5 py-2 text-micro leading-relaxed text-muted-foreground">
        <Lock className="mt-0.5 size-3 shrink-0" />
        <span>{t(($) => $.room.res_note)}</span>
      </div>
    </>
  );
}

/** One collectable entry shown in the review sheet. */
export interface HandoffCandidate {
  /** Stable pick key ("att:<uuid>" | "branch:<task>"): unique across kinds. */
  id: string;
  name: string;
  size?: number;
  kind: "attachment" | "branch";
  /** Set when this candidate is an uploaded attachment. */
  attachment_id?: string;
}

/** The handoff editor's state, owned by the page (the approve button reads it). */
export interface HandoffDraft {
  candidates: HandoffCandidate[];
  picked: ReadonlySet<string>;
  onToggle: (id: string) => void;
  summary: string;
  onSummaryChange: (value: string) => void;
  acceptance: IssueChainHandoffAcceptance[];
  onAcceptanceChange: (rows: IssueChainHandoffAcceptance[]) => void;
  openQuestions: string;
  onOpenQuestionsChange: (value: string) => void;
  nextBrief: string;
  onNextBriefChange: (value: string) => void;
}

/**
 * The reader's own plan for this leg — the holder's own words, editable only
 * while the leg is unfinished, because nobody writes another person's brief.
 *
 * While the leg waits on review the same section becomes the handoff sheet:
 * the run's candidates arrive already ticked ("自动收集"), the holder
 * un-tickes what should not cross the leg boundary, and writes the summary.
 * 审核通过 is the publish.
 */
export function LegPlanSection({
  view,
  onSavePlan,
  planPending,
  handoff,
}: {
  view: RelayView;
  onSavePlan: (plan: string) => void;
  planPending: boolean;
  handoff?: HandoffDraft;
}) {
  const { t } = useT("issues");
  const step = view.myStep;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Re-seed when the server's copy of this leg changes (first load, a save
  // coming back, or the relay moving to a different leg of mine).
  useEffect(() => {
    setEditing(false);
    setDraft(step?.plan ?? "");
  }, [step?.id, step?.plan]);

  const stateKey = step ? chainStateKey(step.state) : null;
  if (!step) {
    return (
      <p className="text-caption text-muted-foreground">
        {view.done
          ? t(($) => $.room.leg_done_note)
          : view.myDeliveredStep
            ? t(($) => $.room.leg_delivered_note)
            : t(($) => $.room.leg_waiting)}
      </p>
    );
  }
  return (
    <>
      {editing ? (
        <div className="mt-1.5">
          <Textarea
            autoFocus
            rows={4}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t(($) => $.room.leg_plan_placeholder)}
            className="text-caption"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setDraft(step.plan ?? "");
              }}
              disabled={planPending}
            >
              {t(($) => $.room.leg_plan_cancel)}
            </Button>
            <Button size="sm" onClick={() => onSavePlan(draft)} disabled={planPending}>
              {t(($) => $.room.leg_plan_save)}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-1.5 block w-full text-left"
        >
          {step.plan ? (
            <div className="whitespace-pre-wrap border-l-2 border-brand bg-brand/5 px-2.5 py-1.5 text-body leading-relaxed">
              {step.plan}
            </div>
          ) : (
            <div className="rounded-md border border-dashed px-2.5 py-1.5 text-caption text-faint-foreground">
              {t(($) => $.room.leg_plan_empty)}
            </div>
          )}
        </button>
      )}
      {stateKey === "reviewing" && handoff ? (
        <>
          <div className={cn(LABEL_CLASS, "mt-3.5")}>
            {t(($) => $.room.leg_outputs_label)}
          </div>
          {handoff.candidates.length === 0 ? (
            <p className="mt-1 text-caption text-faint-foreground">
              {t(($) => $.room.leg_outputs_empty)}
            </p>
          ) : (
            <div className="mt-1 flex flex-col">
              {handoff.candidates.map((file) => {
                const on = handoff.picked.has(file.id);
                return (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => handoff.onToggle(file.id)}
                    className="flex items-center gap-2.5 border-b border-dashed py-1.5 text-left last:border-b-0"
                  >
                    <span
                      className={cn(
                        "grid size-[15px] shrink-0 place-items-center rounded-[3px] border text-micro",
                        on
                          ? "border-success bg-success text-white"
                          : "border-surface-border text-transparent",
                      )}
                    >
                      <Check className="size-2.5" />
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate font-mono text-caption",
                        !on && "text-faint-foreground",
                      )}
                    >
                      {file.name}
                    </span>
                    {typeof file.size === "number" ? (
                      <span className="shrink-0 font-mono text-micro text-faint-foreground">
                        {formatFileSize(file.size)}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
          <div className={cn(LABEL_CLASS, "mt-3.5")}>
            {t(($) => $.room.leg_summary_label)}
          </div>
          <textarea
            value={handoff.summary}
            onChange={(event) => handoff.onSummaryChange(event.target.value)}
            rows={3}
            maxLength={50000}
            placeholder={t(($) => $.room.leg_summary_placeholder)}
            className="mt-1 w-full resize-none rounded-md border border-border bg-brand/5 px-2.5 py-1.5 text-caption leading-relaxed outline-none placeholder:text-faint-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
        </>
      ) : (
        <>
          <div className={cn(LABEL_CLASS, "mt-3.5")}>
            {t(($) => $.room.leg_output_label)}
          </div>
          <p className="mt-1 text-caption text-muted-foreground">
            {t(($) => $.room.leg_output_hint)}
          </p>
        </>
      )}
    </>
  );
}

/**
 * One file of a handoff package, as an actionable chip.
 *
 * A delivered document is meant to be worked from: clicking opens the shared
 * preview (markdown renders; text kinds additionally offer in-place editing —
 * the server writes back under the same attachment id), and the trailing
 * button downloads. A file whose attachment record is not resolvable — an old
 * package, or a branch entry that never was an upload — falls back to the
 * plain name, which is still honest about what crossed the boundary.
 */
export function HandoffFileChip({
  file,
  attachment,
}: {
  file: IssueChainHandoffFile;
  attachment?: Attachment;
}) {
  const { t } = useT("issues");
  const preview = useAttachmentPreview();
  const download = useDownloadAttachment();
  const isBranch = file.kind === "branch";
  const chipClass =
    "inline-flex items-center gap-1 rounded-[3px] border border-border bg-surface px-1.5 py-px font-mono text-micro text-muted-foreground";

  if (!attachment) {
    return (
      <span className={chipClass}>
        {isBranch ? (
          <GitBranch className="size-2.5" />
        ) : (
          <FileText className="size-2.5" />
        )}
        {file.name}
      </span>
    );
  }

  const openPreview = () => {
    const opened = preview.tryOpen(
      { kind: "full", attachment },
      { editable: true },
    );
    // Kinds the modal cannot render (zip, binary, ...) download instead —
    // the chip keeps its meaning as "get this file".
    if (!opened) void download(attachment.id);
  };

  return (
    <span className={cn(chipClass, "pr-0.5")}>
      <button
        type="button"
        onClick={openPreview}
        title={t(($) => $.room.file_with_name, { name: file.name })}
        className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
      >
        <FileText className="size-2.5" />
        {file.name}
      </button>
      <button
        type="button"
        onClick={() => void download(attachment.id)}
        title={t(($) => $.room.file_download)}
        aria-label={t(($) => $.room.file_download)}
        className="rounded-[2px] p-0.5 transition-colors hover:bg-muted hover:text-foreground"
      >
        <Download className="size-2.5" />
      </button>
      {preview.modal}
    </span>
  );
}

/**
 * A finished leg's handoff package. This card is the boundary made visible:
 * everything inside the leg stayed private, and this is exactly what crossed
 * over.
 */
export function HandoffCard({
  step,
  nameOf,
  attachmentOf,
}: {
  step: IssueChainStep;
  nameOf: (userId: string) => string;
  /** Resolves a handoff file's attachment record by id — the page owns the
   *  attachment list; the card only knows names and ids. */
  attachmentOf?: (id: string) => Attachment | undefined;
}) {
  const { t } = useT("issues");
  const handoff = step.handoff;
  if (!handoff) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-success/35 bg-surface shadow-[2px_2px_0_oklch(0.9_0.014_244)]">
      <header className="flex items-center gap-2 border-b border-border bg-success/10 px-3.5 py-2 text-caption font-semibold">
        <Package className="size-3.5 text-success" />
        <span>
          {t(($) => $.room.handoff_card_title, {
            seq: step.position + 1,
            name: nameOf(step.holder_user_id),
          })}
        </span>
        <span className="grow" />
        <CardChip tone="ok">{t(($) => $.room.handoff_delivered)}</CardChip>
        <CardChip tone="mute">{t(($) => $.room.handoff_public)}</CardChip>
      </header>
      <div className="px-3.5 py-3">
        {handoff.summary ? (
          <p className="text-body leading-relaxed">{handoff.summary}</p>
        ) : (
          <p className="text-caption text-faint-foreground">
            {t(($) => $.room.handoff_no_summary)}
          </p>
        )}
        {handoff.files.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {handoff.files.map((file, i) => (
              <HandoffFileChip
                key={`${file.name}-${i}`}
                file={file}
                attachment={
                  file.attachment_id
                    ? attachmentOf?.(file.attachment_id)
                    : undefined
                }
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
