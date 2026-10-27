"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiError, api } from "@quickwork/core/api";
import { orchestrateFailure } from "./orchestrate-failure";
import { useWorkspacePaths } from "@quickwork/core/paths";
import type { DispatchStep, IssuePriority } from "@quickwork/core/types";
import {
  taskIssueOptions,
  TASK_ISSUE_WINDOW_MS,
} from "@quickwork/core/workspace/queries";
import { toast } from "sonner";

import { useNavigation } from "../navigation";
import { useT } from "../i18n";

/**
 * The compose canvas's state machine: describe an outcome, arrange a relay,
 * hand it to a squad, then follow the run until it produces an issue to open.
 *
 * Extracted from the workspace home page so the canvas can move around the
 * layout without the polling and navigation rules moving with it. The rules are
 * subtle enough that they should not be re-derived at a second call site:
 *
 * - A submitted run does not return an issue. The client polls
 *   `taskIssueOptions` for a bounded window because a run that fails never
 *   links one, so "waiting" has to end somewhere.
 * - The relay is written AFTER the issue exists, not with the dispatch. Quick
 *   create's job is to produce the issue; a chain needs one to hang off. The
 *   order is dispatch → issue → chain → navigate, and the route is held in a
 *   ref across that gap because the effect that writes it runs on a later
 *   render than the one that captured it.
 * - The composer latches while waiting. A second submit would race two polls
 *   onto one screen.
 * - Navigation fires once per destination. `useWorkspacePaths()` allocates a
 *   fresh object every render, so a naive dependency list would push the same
 *   URL on every render; the ref makes it once per destination instead.
 */

/** What the canvas decided to dispatch: a saved route or one arranged inline. */
export interface OrchestrateRoute {
  playbookId?: string;
  steps?: DispatchStep[];
}

/** Quick-create fields the squad dispatch can carry to the new issue. */
export interface OrchestrateFields {
  projectId?: string | null;
  priority?: IssuePriority;
  dueDate?: string | null;
}

export function useOrchestrate(wsId: string) {
  const { t } = useT("home");
  const wsPaths = useWorkspacePaths();
  const navigation = useNavigation();

  // The dispatch task whose issue link we are waiting on. Non-null latches the
  // composer.
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  // The window is the client's, not the query's: once this flips, the task id
  // stops being passed down and the poll stops on its own.
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (!pendingTaskId || gaveUp) return;
    const timer = setTimeout(() => setGaveUp(true), TASK_ISSUE_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [pendingTaskId, gaveUp]);

  // The route that came with the current dispatch. Held in a ref rather than
  // state because it is not rendered: the chain effect below reads it on a
  // later render, after the issue id arrives.
  const pendingRoute = useRef<OrchestrateRoute>({});

  const start = useMutation({
    mutationFn: (input: { squadId: string; prompt: string; fields?: OrchestrateFields }) =>
      api.quickCreateIssue({
        squad_id: input.squadId,
        prompt: input.prompt,
        ...(input.fields?.projectId ? { project_id: input.fields.projectId } : {}),
        ...(input.fields?.priority && input.fields.priority !== "none"
          ? { priority: input.fields.priority }
          : {}),
        ...(input.fields?.dueDate ? { due_date: input.fields.dueDate } : {}),
      }),
    onSuccess: (response) => {
      toast.success(t(($) => $.toasts.started));
      // A submission after a give-up starts a new window; leaving the flag set
      // would hand the new task straight to a query that is already disabled.
      setGaveUp(false);
      setPendingTaskId(response.task_id);
    },
    onError: (error) => {
      // The server refuses a dispatch it cannot run with a structured 422
      // (code / reason_code); the raw `error.message` for those bodies is
      // just "API error: 422 Unprocessable Entity". Localize from the code
      // so the toast says what to fix.
      const failure = orchestrateFailure(error);
      switch (failure?.kind) {
        case "agent_offline":
          toast.error(t(($) => $.toasts.agent_offline));
          return;
        case "agent_no_runtime":
          toast.error(t(($) => $.toasts.agent_no_runtime));
          return;
        case "agent_cli_unusable":
          toast.error(t(($) => $.toasts.agent_cli_unusable));
          return;
        case "agent_archived":
          toast.error(t(($) => $.toasts.agent_archived));
          return;
        case "agent_unavailable":
          toast.error(t(($) => $.toasts.agent_unavailable));
          return;
        case "daemon_version":
          toast.error(
            t(($) => $.toasts.daemon_version, {
              current: failure.current || t(($) => $.toasts.version_unknown),
              min: failure.min,
            }),
          );
          return;
      }
      // Unclassified ApiErrors keep the generic sentence too — their message
      // is client-fallback jargon, not copy. Transport errors are the only
      // case where the platform's own message is the best we have.
      toast.error(
        error instanceof Error && !(error instanceof ApiError)
          ? error.message
          : t(($) => $.toasts.failed),
      );
    },
  });

  const link = useQuery(taskIssueOptions(wsId, gaveUp ? null : pendingTaskId));
  const linkedIssueId = link.data?.issue_id ?? "";

  // Write the relay once the issue exists, then let the effect below navigate.
  // A failure is not fatal to the dispatch — the task and its issue are real,
  // the squad just has no relay — so it reports and releases rather than
  // trapping the user on a canvas that will never finish.
  const chain = useMutation({
    mutationFn: (issueId: string) =>
      api.createIssueChain(issueId, {
        playbook_id: pendingRoute.current.playbookId,
        steps: pendingRoute.current.steps,
      }),
    onError: () => toast.error(t(($) => $.toasts.chain_failed)),
  });
  const chainWrite = chain.mutate;
  const chainSettled = chain.isSuccess || chain.isError;
  const writtenForIssue = useRef("");
  useEffect(() => {
    if (!linkedIssueId || writtenForIssue.current === linkedIssueId) return;
    writtenForIssue.current = linkedIssueId;
    chainWrite(linkedIssueId);
  }, [linkedIssueId, chainWrite]);

  // Navigate off a destination string rather than off `navigation` / `wsPaths`.
  // See the header comment: a fresh task id yields a fresh destination, so a
  // second orchestration after a give-up still navigates.
  //
  // Waiting on `chainSettled` keeps the room's relay strip from rendering an
  // empty chain for the beat between landing and the chain being written.
  const navigatedTo = useRef("");
  useEffect(() => {
    const destination = linkedIssueId
      ? chainSettled
        ? wsPaths.issueDetail(linkedIssueId)
        : ""
      : gaveUp
        ? wsPaths.tasks()
        : "";
    const key = destination && `${pendingTaskId ?? ""}|${destination}`;
    if (!key || navigatedTo.current === key) return;
    navigatedTo.current = key;
    if (gaveUp) toast.info(t(($) => $.toasts.pending));
    navigation.push(destination);
  });

  // Derived rather than cleared: unlocking the composer by resetting the task
  // id would change the navigation key above and re-enter that effect a second
  // time. `gaveUp` already means "stop waiting", so it can also mean "stop
  // holding the composer".
  const isWaitingOnIssue = pendingTaskId !== null && !gaveUp;

  return {
    /** Fire the described work at a squad, with the route it should run as. */
    orchestrate: (
      squadId: string,
      prompt: string,
      route: OrchestrateRoute = {},
      fields?: OrchestrateFields,
    ) => {
      if (!squadId || !prompt.trim() || start.isPending || isWaitingOnIssue) {
        return;
      }
      pendingRoute.current = route;
      start.mutate({ squadId, prompt: prompt.trim(), fields });
    },
    /** A run is in flight — either being submitted or being followed. */
    isBusy: start.isPending || isWaitingOnIssue,
    isSubmitting: start.isPending,
    isWaitingOnIssue,
  };
}
