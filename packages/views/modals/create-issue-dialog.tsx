"use client";

import { useLayoutEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@quickwork/ui/lib/utils";
import { Dialog, DialogContent } from "@quickwork/ui/components/ui/dialog";
import type { CreateMode } from "@quickwork/core/issues/stores/create-mode-store";
import { AgentCreatePanel } from "./quick-create-issue";
import { ManualCreatePanel, manualDialogContentClass } from "./create-issue";
import { sourceContextPreviewOptions } from "@quickwork/core/issues/queries";
import { useIssueDraftStore } from "@quickwork/core/issues/stores/draft-store";
import { useWorkspaceId } from "@quickwork/core/hooks";

/**
 * Shell that owns the single `<Dialog>` AND `<DialogContent>` for the
 * create-issue flow. `initialMode` comes from the modal registry
 * (`quick-create-issue` → agent, `create-issue` → manual) and is fixed for
 * the dialog's lifetime — the 单人任务 entry is agent-only, so there is no
 * in-dialog mode switch any more.
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
  const effectiveData = sourceContextData
    ? { ...(data ?? {}), ...sourceContextData }
    : data;

  const className =
    initialMode === "agent"
      ? cn(
          "p-0 gap-0 flex flex-col overflow-hidden",
          "!top-1/2 !left-1/2 !-translate-x-1/2 !-translate-y-1/2",
          // Phone gutter. The widths below are `!important` so they beat
          // DialogContent's own sizing — which also made them beat its
          // `max-w-[calc(100%-2rem)]` safety margin, leaving the card flush
          // against both screen edges on a 430px viewport (MUL-6236). Restore
          // the margin here and let the `sm:` widths take over above 640px.
          "!w-full !max-w-[calc(100vw-1.5rem)]",
          // Source-context create needs numeric collapsed/expanded endpoints
          // so its preview transition can interpolate the height. Ordinary
          // quick create has no expanding preview and keeps its original
          // content-driven height, capped for mobile browser chrome.
          isExpanded
            ? "!h-5/6 sm:!max-w-4xl"
            : sourceContextData
              ? sourceContextExpanded
                ? "!h-5/6 sm:!max-w-2xl"
                : "!h-96 sm:!max-w-xl"
              : "!max-h-[80dvh] sm:!max-w-2xl",
        )
      : cn(
          manualDialogContentClass(isExpanded),
          sourceContextExpanded && "!h-5/6",
        );

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        finalFocus={false}
        showCloseButton={false}
        className={className}
      >
        {initialMode === "agent" ? (
          <AgentCreatePanel
            onClose={onClose}
            data={effectiveData}
            isExpanded={isExpanded}
            setIsExpanded={setIsExpanded}
          />
        ) : (
          <ManualCreatePanel
            onClose={onClose}
            data={effectiveData}
            isExpanded={isExpanded}
            setIsExpanded={setIsExpanded}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
