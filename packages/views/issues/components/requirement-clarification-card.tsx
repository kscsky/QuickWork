"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Lock, Pencil, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "@quickwork/core/api";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { issueDetailOptions } from "@quickwork/core/issues/queries";
import type { Issue } from "@quickwork/core/types";
import { Button } from "@quickwork/ui/components/ui/button";

import { useT } from "../../i18n";

const CLARIFICATION_KEY = "requirement_clarification";

function ClarificationBody({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n+/).map((raw, index) => {
        const line = raw.trim();
        if (!line) return null;
        const colon = line.indexOf("：");
        if (colon > 0 && colon < 16) {
          return (
            <p key={index}>
              <b>{line.slice(0, colon + 1)}</b>
              {line.slice(colon + 1)}
            </p>
          );
        }
        return <p key={index}>{line}</p>;
      })}
    </>
  );
}

/**
 * The solo task's requirement clarification.
 *
 * This used to be a rail card. It is part of the task brief's context, not a
 * property: a solo page reads brief → clarification → delivery in one column,
 * and the next agent run reads the same text back through issue metadata.
 */
export function RequirementClarificationCard({ issue }: { issue: Issue }) {
  const { t } = useT("issues");
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const storedRaw = issue.metadata?.[CLARIFICATION_KEY];
  const stored = typeof storedRaw === "string" ? storedRaw.trim() : "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(stored);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEditing(false);
    setDraft(stored);
  }, [issue.id, stored]);

  const save = async () => {
    setSaving(true);
    try {
      await api.setIssueMetadata(issue.id, CLARIFICATION_KEY, draft.trim());
      await qc.invalidateQueries({
        queryKey: issueDetailOptions(wsId, issue.id).queryKey,
      });
      setEditing(false);
      toast.success(t(($) => $.detail.clarification_saved));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t(($) => $.detail.clarification_save_failed),
      );
    } finally {
      setSaving(false);
    }
  };

  const openEditor = () => {
    setDraft(stored);
    setEditing(true);
  };

  return (
    <section className="qw-solo-clarify" aria-label={t(($) => $.room.leg_plan_label)}>
      <div className="qw-solo-clarify-head">
        <span className="qw-solo-clarify-ico" aria-hidden="true">
          <Sparkles className="size-[15px]" />
        </span>
        <div className="min-w-0">
          <div className="qw-solo-clarify-title">
            {t(($) => $.room.leg_plan_label)}
          </div>
          <div className="qw-solo-clarify-sub">
            {t(($) => $.detail.clarification_sub)}
          </div>
        </div>
        <span className="qw-solo-spacer" />
        <span className="qw-solo-clarify-state">
          {stored
            ? t(($) => $.detail.clarification_state_saved)
            : t(($) => $.detail.clarification_state_empty)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label={t(($) => $.detail.clarification_edit_aria)}
          onClick={openEditor}
        >
          <Pencil />
        </Button>
      </div>

      <div className="qw-solo-clarify-body">
        {editing ? (
          <div>
            <textarea
              autoFocus
              value={draft}
              rows={4}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t(($) => $.detail.clarification_placeholder)}
              aria-label={t(($) => $.detail.clarification_placeholder)}
            />
            <div className="qw-solo-clarify-actions">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setDraft(stored);
                }}
                disabled={saving}
              >
                {t(($) => $.room.leg_plan_cancel)}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void save()}
                disabled={saving}
              >
                <Check />
                {t(($) => $.detail.clarification_save_action)}
              </Button>
            </div>
            <div className="qw-solo-clarify-hint">
              <Lock className="size-[11px]" />
              {t(($) => $.detail.clarification_hint)}
            </div>
          </div>
        ) : stored ? (
          <div className="qw-solo-clarify-filled">
            <ClarificationBody text={stored} />
          </div>
        ) : (
          <div className="qw-solo-clarify-empty">
            <p>{t(($) => $.detail.clarification_empty)}</p>
            <Button type="button" size="sm" variant="outline" onClick={openEditor}>
              {t(($) => $.detail.clarification_cta)}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
