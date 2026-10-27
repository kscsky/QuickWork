"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Plus } from "lucide-react";
import type { Issue, UpdateIssueRequest } from "@quickwork/core/types";
import { useIssueStatuses } from "@quickwork/core/issue-statuses/hooks";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { propertyListOptions } from "@quickwork/core/properties";
import { useActorName } from "@quickwork/core/workspace/hooks";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@quickwork/ui/components/ui/popover";

import { ActorAvatar } from "../../../common/actor-avatar";
import { useT } from "../../../i18n";
import { useStatusLabel } from "../../utils/status-label";
import {
  AssigneePicker,
  PriorityPicker,
  StatusPicker,
} from "../pickers";
import { CustomPropertyValueDisplay } from "../pickers/custom-property-picker";
import { StatusIcon } from "../status-icon";

interface SoloPropertyStripProps {
  issue: Issue;
  onUpdate: (updates: Partial<UpdateIssueRequest>) => void;
}

/**
 * Editable properties for a solo task, inline under the title (the mockup's
 * S3 layout has no right rail to hold them).
 */
export function SoloPropertyStrip({ issue, onUpdate }: SoloPropertyStripProps) {
  const { t } = useT("issues");
  const wsId = useWorkspaceId();
  const { getActorName } = useActorName();
  const labelOf = useStatusLabel(wsId);
  const { categoryOf, colorOf } = useIssueStatuses(wsId);
  const { data: properties = [] } = useQuery(propertyListOptions(wsId));

  const assigneeName =
    issue.assignee_type && issue.assignee_id
      ? getActorName(issue.assignee_type, issue.assignee_id)
      : null;

  return (
    <div className="qw-solo-props">
      <StatusPicker
        status={issue.status}
        onUpdate={onUpdate}
        triggerRender={
          <button type="button" className="qw-solo-chip">
            <span className="qw-solo-chip-k">
              {t(($) => $.detail.prop_status)}
            </span>
            <span className="qw-solo-chip-v">
              <StatusIcon
                status={issue.status}
                category={categoryOf(issue.status)}
                color={colorOf(issue.status)}
                className="size-3.5 shrink-0"
              />
              <span className="truncate">{labelOf(issue.status)}</span>
            </span>
            <ChevronDown className="chev" />
          </button>
        }
      />

      <AssigneePicker
        assigneeType={issue.assignee_type}
        assigneeId={issue.assignee_id}
        onUpdate={onUpdate}
        triggerRender={
          <button type="button" className="qw-solo-chip">
            <span className="qw-solo-chip-k">
              {t(($) => $.detail.prop_assignee)}
            </span>
            <span className="qw-solo-chip-v">
              {issue.assignee_type && issue.assignee_id ? (
                <>
                  <ActorAvatar
                    actorType={issue.assignee_type}
                    actorId={issue.assignee_id}
                    size="xs"
                    profileLink={false}
                  />
                  <span className="max-w-48 truncate">{assigneeName}</span>
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </span>
            <ChevronDown className="chev" />
          </button>
        }
      />

      <PriorityPicker
        priority={issue.priority}
        onUpdate={onUpdate}
        triggerRender={
          <button type="button" className="qw-solo-chip">
            <span className="qw-solo-chip-k">
              {t(($) => $.detail.prop_priority)}
            </span>
            <span className="qw-solo-chip-v">
              <span className="truncate">{t(($) => $.priority[issue.priority])}</span>
            </span>
            <ChevronDown className="chev" />
          </button>
        }
      />

      <Popover>
        <PopoverTrigger
          render={
            <button type="button" className="qw-solo-chip add">
              <Plus className="size-3.5" />
              {t(($) => $.detail.add_property_action)}
            </button>
          }
        />
        <PopoverContent align="start" className="qw-solo-addfield-pop">
          {properties.length > 0 ? (
            properties.map((property) => (
              <div className="qw-solo-prop-row" key={property.id}>
                <span className="min-w-0 flex-1 truncate">{property.name}</span>
                <CustomPropertyValueDisplay
                  property={property}
                  value={issue.properties[property.id]}
                />
              </div>
            ))
          ) : (
            <p className="qw-solo-addfield-empty">
              {t(($) => $.detail.no_custom_fields)}
            </p>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
