"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useCurrentMember } from "@quickwork/core/permissions";
import { knowledgePreviewOptions } from "@quickwork/core/knowledge/queries";
import { useDepositIssueKnowledge } from "@quickwork/core/knowledge/mutations";

import { Button } from "@quickwork/ui/components/ui/button";
import { Checkbox } from "@quickwork/ui/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quickwork/ui/components/ui/dialog";
import { cn } from "@quickwork/ui/lib/utils";
import { useT } from "../../i18n";

/**
 * "Save to knowledge": the completion-time gate that turns a finished relay's
 * handoff packages into one summary document plus FAQ drafts. The preview is
 * composed server-side from what the holders actually approved; the user picks
 * which parts to keep, and an owner/admin can publish them in the same step.
 */
export function DepositKnowledgeDialog({
  issueId,
  open,
  onOpenChange,
}: {
  issueId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT("knowledge");
  const wsId = useWorkspaceId();
  const { role } = useCurrentMember(wsId);
  const canPublish = role === "owner" || role === "admin";
  const { data: preview, isPending, isError } = useQuery(
    knowledgePreviewOptions(issueId, open),
  );
  const deposit = useDepositIssueKnowledge(wsId, issueId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [publish, setPublish] = useState(canPublish);

  useEffect(() => {
    if (!open || !preview) return;
    setSelected(new Set(preview.entries.map((entry) => entry.key)));
    setPublish(canPublish);
  }, [open, preview, canPublish]);

  const toggle = (key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const submit = () => {
    deposit.mutate(
      { keys: [...selected], publish },
      {
        onSuccess: () => {
          toast.success(t(($) => $.deposit_success));
          onOpenChange(false);
        },
        onError: () => toast.error(t(($) => $.deposit_failed)),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-body">{t(($) => $.deposit_title)}</DialogTitle>
          <DialogDescription className="text-caption">
            {t(($) => $.deposit_sub)}
          </DialogDescription>
        </DialogHeader>

        {isPending ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : isError || !preview ? (
          <p className="py-6 text-caption text-muted-foreground">
            {t(($) => $.deposit_preview_failed)}
          </p>
        ) : (
          <div className="flex max-h-[52vh] flex-col gap-4 overflow-y-auto pr-1">
            <section className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <h4 className="text-caption font-semibold text-foreground">
                  {t(($) => $.deposit_summary)}
                </h4>
                <span className="rounded-full bg-muted px-1.5 text-micro text-muted-foreground">
                  {preview.entries.length > 0 ? preview.entries[0]?.title : ""}
                </span>
              </div>
              <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-surface-border bg-muted/30 p-3 font-sans text-caption leading-relaxed text-muted-foreground">
                {preview.summary}
              </pre>
            </section>

            <section className="flex flex-col gap-1.5">
              <h4 className="text-caption font-semibold text-foreground">
                {t(($) => $.deposit_entries)}
              </h4>
              {preview.entries.map((entry) => {
                const checked = selected.has(entry.key);
                return (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => toggle(entry.key)}
                    aria-pressed={checked}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left transition-colors",
                      checked ? "bg-accent" : "hover:bg-accent/50",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      tabIndex={-1}
                      className="pointer-events-none mt-0.5"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-caption font-medium text-foreground">
                        {entry.title}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block whitespace-pre-wrap text-micro leading-relaxed text-muted-foreground">
                        {entry.body}
                      </span>
                    </span>
                  </button>
                );
              })}
            </section>

            {canPublish ? (
              <label className="flex w-fit items-center gap-2 text-caption text-muted-foreground">
                <Checkbox
                  checked={publish}
                  onCheckedChange={(value) => setPublish(value === true)}
                />
                {t(($) => $.deposit_publish)}
              </label>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t(($) => $.cancel)}
          </Button>
          <Button
            size="sm"
            disabled={deposit.isPending || selected.size === 0 || !preview}
            onClick={submit}
          >
            {deposit.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : null}
            {deposit.isPending
              ? t(($) => $.deposit_saving)
              : publish
                ? t(($) => $.deposit_save_publish)
                : t(($) => $.deposit_save_draft)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
