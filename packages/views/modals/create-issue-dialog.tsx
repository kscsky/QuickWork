"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@quickwork/ui/lib/utils";
import { Dialog, DialogContent } from "@quickwork/ui/components/ui/dialog";
import type { CreateMode } from "@quickwork/core/issues/stores/create-mode-store";
import { AgentCreatePanel } from "./quick-create-issue";
import { ManualCreatePanel, manualDialogContentClass } from "./create-issue";
import { SquadTaskBody } from "./squad-task-body";
import { TaskTypeSwitch } from "./create-task-chrome";
import { sourceContextPreviewOptions } from "@quickwork/core/issues/queries";
import { useIssueDraftStore } from "@quickwork/core/issues/stores/draft-store";
import { useWorkspaceId } from "@quickwork/core/hooks";

/**
 * Shell that owns the single `<Dialog>` AND `<DialogContent>` for the
 * create-issue flow. `initialMode` comes from the modal registry
 * (`quick-create-issue` → agent, `create-issue` → manual) and is fixed for
 * the dialog's lifetime.
 *
 * One dialog creates both kinds of work: the strip's 单人任务 / 小队任务
 * switch swaps the body between the solo panel and the squad relay composer.
 * The task list's create button, the sidebar button and the palette all open
 * this same dialog — the type is chosen inside, not by which entry point was
 * used.
 *
 * `isExpanded` is lifted up because it drives `DialogContent`'s className —
 * the className lives here in the shell since the Popup is here, but the
 * toggle for that state lives in the panel body.
 */
export function CreateIssueDialog({
  onClose,
  initialMode,
  data,
}: {
  onClose: () => void;
  initialMode: CreateMode;
  data?: Record<string, unknown> | null;
}) {
  const anchorCommentId = typeof data?.anchor_comment_id === "string"
    ? data.anchor_comment_id
    : null;
  if (anchorCommentId) {
    return (
      <SourceContextCreateIssueDialog
        onClose={onClose}
        initialMode={initialMode}
        data={data}
        anchorCommentId={anchorCommentId}
      />
    );
  }
  return <CreateIssueDialogBody onClose={onClose} initialMode={initialMode} data={data} />;
}

function SourceContextCreateIssueDialog({
  onClose,
  initialMode,
  data,
  anchorCommentId,
}: {
  onClose: () => void;
  initialMode: CreateMode;
  data?: Record<string, unknown> | null;
  anchorCommentId: string;
}) {
  const wsId = useWorkspaceId();
  const [draftReady, setDraftReady] = useState(false);
  const [sourceContextExpanded, setSourceContextExpanded] = useState(false);
  const sourceQuery = useQuery(sourceContextPreviewOptions(wsId, anchorCommentId));

  useLayoutEffect(() => {
    useIssueDraftStore.getState().beginIsolatedDraft();
    setDraftReady(true);
    return () => useIssueDraftStore.getState().endIsolatedDraft();
  }, []);

  if (!draftReady) return null;

  return (
    <CreateIssueDialogBody
      onClose={onClose}
      initialMode={initialMode}
      data={data}
      sourceContextExpanded={sourceContextExpanded}
      sourceContextData={{
        anchor_comment_id: anchorCommentId,
        source_context_preview: sourceQuery.isError || sourceQuery.isFetching
          ? undefined
          : sourceQuery.data,
        source_context_loading: sourceQuery.isLoading || sourceQuery.isFetching,
        source_context_failed: sourceQuery.isError,
        source_context_error: sourceQuery.error,
        source_context_refetch: sourceQuery.refetch,
        source_context_expanded: sourceContextExpanded,
        source_context_on_expanded_change: setSourceContextExpanded,
      }}
    />
  );
}

function CreateIssueDialogBody({
  onClose,
  initialMode,
  data,
  sourceContextData,
  sourceContextExpanded = false,
}: {
  onClose: () => void;
  initialMode: CreateMode;
  data?: Record<string, unknown> | null;
  sourceContextData?: Record<string, unknown>;
  sourceContextExpanded?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [createType, setCreateType] = useState<"single" | "squad">("single");
  // A squad create owns the dialog only while the issue + route writes are in
  // flight; both are direct requests, not an agent-created issue to poll for.
  const [squadBusy, setSquadBusy] = useState(false);
  const effectiveData = sourceContextData
    ? { ...(data ?? {}), ...sourceContextData }
    : data;

  // The source-context create is single-purpose (it hangs off one comment);
  // it has no second body to switch to, so it keeps the static label.
  const typeSwitch: ReactNode = sourceContextData ? undefined : (
    <TaskTypeSwitch
      value={createType}
      onChange={setCreateType}
      disabled={createType === "squad" && squadBusy}
    />
  );

  const className =
    createType === "squad" || initialMode === "agent"
      ? cn(
          "qk-create-dialog",
          "!top-1/2 !left-1/2 !-translate-x-1/2 !-translate-y-1/2",
        )
      : cn(
          manualDialogContentClass(isExpanded),
          sourceContextExpanded && "!h-5/6",
        );

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && squadBusy) return;
        if (!v) onClose();
      }}
    >
      <DialogContent
        finalFocus={false}
        showCloseButton={false}
        data-mode={createType === "squad" ? "squad" : "single"}
        className={className}
      >
        {createType === "squad" ? (
          <SquadTaskBody
            onClose={onClose}
            onBusyChange={setSquadBusy}
            typeSwitch={typeSwitch}
          />
        ) : initialMode === "agent" ? (
          <AgentCreatePanel
            onClose={onClose}
            data={effectiveData}
            isExpanded={isExpanded}
            setIsExpanded={setIsExpanded}
            typeSwitch={typeSwitch}
          />
        ) : (
          <ManualCreatePanel
            onClose={onClose}
            data={effectiveData}
            isExpanded={isExpanded}
            setIsExpanded={setIsExpanded}
            typeSwitch={typeSwitch}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
