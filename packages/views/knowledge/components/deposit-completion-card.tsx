"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspacePaths } from "@quickwork/core/paths";
import { issueKnowledgeStatusOptions } from "@quickwork/core/knowledge/queries";

import { AppLink } from "../../navigation";
import { useT } from "../../i18n";
import { DepositKnowledgeDialog } from "./deposit-knowledge-dialog";

/**
 * The completion-time door into the knowledge base. It sits at the bottom of a
 * finished task — relay or solo — and disappears once this task has deposited
 * entries, so the memory is not silently duplicated.
 */
export function DepositCompletionCard({
  issueId,
  source,
}: {
  issueId: string;
  source: "relay" | "solo";
}) {
  const { t } = useT("knowledge");
  const paths = useWorkspacePaths();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const { data: status, isPending } = useQuery(
    issueKnowledgeStatusOptions(issueId, !dismissed),
  );

  if (dismissed || isPending) return null;
  const relay = source === "relay";
  const deposited = status?.deposited === true;

  return (
    <>
      <section className="task-deposit">
        <div className="task-deposit-main">
          <div className="task-deposit-label">
            <i />
            {relay ? t(($) => $.completion_relay_label) : t(($) => $.completion_solo_label)}
          </div>
          <h2 className="task-deposit-title">
            {relay ? t(($) => $.completion_relay_title) : t(($) => $.completion_solo_title)}
          </h2>
          <p className="task-deposit-desc">
            {relay ? t(($) => $.completion_relay_desc) : t(($) => $.completion_solo_desc)}
          </p>
          <div className="task-deposit-meta">
            <span className="task-deposit-pill">
              {relay ? t(($) => $.completion_source_relay) : t(($) => $.completion_source_solo)}
            </span>
            <span>{t(($) => $.completion_scope)}</span>
            {deposited && status ? (
              <span>{t(($) => $.completion_entry_count, { count: status.entries })}</span>
            ) : null}
          </div>
        </div>
        <div className="task-deposit-actions">
          <div className="task-deposit-decide">{t(($) => $.completion_decide)}</div>
          {deposited ? (
            <AppLink href={paths.knowledge()} className="task-deposit-link">
              {t(($) => $.completion_deposited)}
            </AppLink>
          ) : (
            <>
              <button
                type="button"
                className="task-deposit-primary"
                onClick={() => setOpen(true)}
              >
                {t(($) => $.completion_deposit)}
              </button>
              <button
                type="button"
                className="task-deposit-ghost"
                onClick={() => setDismissed(true)}
              >
                {t(($) => $.completion_dismiss)}
              </button>
            </>
          )}
        </div>
      </section>
      <DepositKnowledgeDialog issueId={issueId} open={open} onOpenChange={setOpen} />
    </>
  );
}
