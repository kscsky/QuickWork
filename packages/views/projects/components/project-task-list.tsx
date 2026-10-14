"use client";

import { useQuery } from "@tanstack/react-query";
import { projectTaskListOptions } from "@quickwork/core/issues/queries";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useWorkspacePaths } from "@quickwork/core/paths";
import { useActorName } from "@quickwork/core/workspace/hooks";
import { Skeleton } from "@quickwork/ui/components/ui/skeleton";
import { AppLink } from "../../navigation";
import { ActorAvatar } from "../../common/actor-avatar";
import { StatusIcon } from "../../issues/components/status-icon";
import { useStatusLabel } from "../../issues/utils/status-label";
import { useT } from "../../i18n";

/**
 * The project's tasks, flat.
 *
 * Not an issue surface: that machinery groups by status and renders every empty
 * group, which turns a four-task project into six "no issues" rows and hides
 * the answer to "what is on this project". Rows link into the task; changing
 * status, filtering and creating stay on the issues page.
 */
export function ProjectTaskList({ projectId }: { projectId: string }) {
  const { t } = useT("projects");
  const wsId = useWorkspaceId();
  const wsPaths = useWorkspacePaths();
  const statusLabel = useStatusLabel(wsId);
  const { getActorName } = useActorName();
  const { data: issues = [], isLoading } = useQuery(
    projectTaskListOptions(wsId, projectId),
  );

  if (isLoading) {
    return (
      <div className="space-y-1 px-2 py-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (issues.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-caption text-muted-foreground">
        {t(($) => $.detail.empty_issues_title)}
      </p>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
      {issues.map((issue) => (
        <AppLink
          key={issue.id}
          href={wsPaths.issueDetail(issue.id)}
          className="flex min-w-0 items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-accent/60"
        >
          <StatusIcon status={issue.status} className="size-3.5 shrink-0" />
          <span className="shrink-0 font-mono text-micro text-muted-foreground">
            {issue.identifier}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-caption font-medium">
              {issue.title}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-micro text-muted-foreground">
              {issue.assignee_id && issue.assignee_type ? (
                <>
                  <ActorAvatar
                    actorType={issue.assignee_type}
                    actorId={issue.assignee_id}
                    size="sm"
                  />
                  <span className="truncate">
                    {getActorName(issue.assignee_type, issue.assignee_id)}
                  </span>
                </>
              ) : (
                // Same "—" the projects table uses for an absent assignee.
                <span className="truncate">—</span>
              )}
              <span aria-hidden="true">·</span>
              <span className="shrink-0">{statusLabel(issue.status)}</span>
            </span>
          </span>
        </AppLink>
      ))}
    </div>
  );
}
