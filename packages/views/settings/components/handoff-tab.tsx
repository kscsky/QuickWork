"use client";

// Settings → 跨区交接 (fork). Manages handoff_rule rows: "when a card in MY
// workspace enters <trigger>, wake <agent> in <another workspace>". The
// receipt leg (target card done → report back) is derived server-side from
// receipt_status, so the UI never asks for it twice.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { api } from "@quickwork/core/api";
import {
  handoffRulesOptions,
  handoffTargetsOptions,
  type HandoffRule,
  type HandoffRuleInput,
} from "@quickwork/core/handoff/queries";
import {
  useCreateHandoffRule,
  useDeleteHandoffRule,
  useToggleHandoffRule,
  useUpdateHandoffRule,
} from "@quickwork/core/handoff/mutations";
import { Button } from "@quickwork/ui/components/ui/button";
import { Input } from "@quickwork/ui/components/ui/input";
import { Textarea } from "@quickwork/ui/components/ui/textarea";
import { Badge } from "@quickwork/ui/components/ui/badge";
import { Skeleton } from "@quickwork/ui/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@quickwork/ui/components/ui/dialog";
import { toast } from "sonner";
import { ArrowRight, Trash2 } from "lucide-react";
import { useT } from "../../i18n";
import { SettingsSection } from "./settings-layout";

interface HandoffForm {
  name: string;
  triggerStatus: string;
  targetWorkspaceId: string;
  targetAgentId: string;
  taskTemplate: string;
  note: string;
  watchedIssueIds: string[];
}

const EMPTY_FORM: HandoffForm = {
  name: "",
  triggerStatus: "in_review",
  targetWorkspaceId: "",
  targetAgentId: "",
  taskTemplate: "",
  note: "",
  watchedIssueIds: [],
};

export function HandoffTab() {
  const { t } = useT("settings");
  const wsId = useWorkspaceId();
  const rules = useQuery(handoffRulesOptions(wsId));
  const toggle = useToggleHandoffRule();
  const del = useDeleteHandoffRule();

  const [editing, setEditing] = useState<HandoffRule | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <SettingsSection
      title={t(($) => $.handoff.title)}
      description={t(($) => $.handoff.description)}
    >
      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={() => setCreating(true)}>
          {t(($) => $.handoff.create)}
        </Button>
      </div>

      {rules.isLoading && <Skeleton className="h-20 w-full rounded-lg" />}
      {!rules.isLoading && (rules.data?.length ?? 0) === 0 && (
        <p className="py-10 text-center text-body text-muted-foreground">
          {t(($) => $.handoff.empty)}
        </p>
      )}
      <div className="space-y-2">
        {rules.data?.map((rule) => (
          <div key={rule.id} className="flex items-center gap-3 rounded-lg border p-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{rule.name}</span>
                <Badge variant={rule.enabled ? "secondary" : "outline"} className="shrink-0">
                  {rule.enabled ? t(($) => $.handoff.enabled) : t(($) => $.handoff.disabled)}
                </Badge>
              </div>
              <div className="flex items-center gap-1.5 text-caption text-muted-foreground">
                <span>{t(($) => $.handoff.trigger)}: {rule.trigger_status}</span>
                <ArrowRight className="size-3 shrink-0" aria-hidden />
                <span className="truncate">
                  {rule.target_workspace_slug} / {rule.target_agent_name}
                </span>
              </div>
              <span className="text-caption text-faint-foreground">
                {(rule.watched_issue_ids?.length ?? 0) > 0
                  ? t(($) => $.handoff.watched_count, { count: rule.watched_issue_ids.length })
                  : t(($) => $.handoff.watched_none)}
                {rule.receipt_status ? " · " + t(($) => $.handoff.receipt_hint, { status: rule.receipt_status }) : ""}
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(rule)}
            >
              {t(($) => $.handoff.edit)}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={toggle.isPending}
              onClick={() =>
                toggle.mutate(
                  { id: rule.id, enabled: !rule.enabled },
                  { onSuccess: () => toast.success(t(($) => $.handoff.toggled)) },
                )
              }
            >
              {rule.enabled ? t(($) => $.handoff.disable) : t(($) => $.handoff.enable)}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={del.isPending}
              onClick={() => {
                if (!window.confirm(t(($) => $.handoff.delete_confirm, { name: rule.name }))) return;
                del.mutate(rule.id, {
                  onSuccess: () => toast.success(t(($) => $.handoff.deleted)),
                });
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <HandoffDialog
        open={creating || editing !== null}
        rule={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </SettingsSection>
  );
}

function HandoffDialog({
  open,
  rule,
  onClose,
}: {
  open: boolean;
  rule: HandoffRule | null;
  onClose: () => void;
}) {
  const { t } = useT("settings");
  const wsId = useWorkspaceId();
  // Targets come from the RELAY TOKEN's visibility, not the viewer's: the
  // token performs the delivery, and it usually belongs to an automation
  // account that is a member of more workspaces than the person configuring.
  const targets = useQuery(handoffTargetsOptions(wsId));
  const create = useCreateHandoffRule();
  const update = useUpdateHandoffRule();

  const [form, setForm] = useState<HandoffForm>(EMPTY_FORM);
  const [initializedFor, setInitializedFor] = useState<string | null>(null);
  const formKey = rule?.id ?? "new";
  if (open && initializedFor !== formKey) {
    setInitializedFor(formKey);
    setForm(
      rule
        ? {
            name: rule.name,
            triggerStatus: rule.trigger_status,
            targetWorkspaceId: rule.target_workspace_id,
            targetAgentId: rule.target_agent_id,
            taskTemplate: rule.task_template,
            note: rule.note,
            watchedIssueIds: rule.watched_issue_ids ?? [],
          }
        : EMPTY_FORM,
    );
  }

  const targetAgents =
    targets.data?.find((w) => w.workspace_id === form.targetWorkspaceId)?.agents ?? [];

  const submit = () => {
    const input: HandoffRuleInput = {
      name: form.name.trim(),
      trigger_status: form.triggerStatus.trim(),
      target_workspace_id: form.targetWorkspaceId,
      target_agent_id: form.targetAgentId,
      task_template: form.taskTemplate.trim(),
      note: form.note.trim(),
      watched_issue_ids: form.watchedIssueIds,
    };
    const done = () => {
      toast.success(t(($) => $.handoff.saved));
      onClose();
    };
    const fail = (e: unknown) => {
      toast.error(e instanceof Error ? e.message : t(($) => $.handoff.save_failed));
    };
    if (rule) {
      update.mutate({ id: rule.id, ...input }, { onSuccess: done, onError: fail });
    } else {
      create.mutate(input, { onSuccess: done, onError: fail });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule ? t(($) => $.handoff.edit) : t(($) => $.handoff.create)}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-caption">
            <span className="text-muted-foreground">{t(($) => $.handoff.name)}</span>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t(($) => $.handoff.name_placeholder)}
            />
          </label>
          <label className="flex flex-col gap-1 text-caption">
            <span className="text-muted-foreground">{t(($) => $.handoff.trigger_status)}</span>
            <Input
              value={form.triggerStatus}
              onChange={(e) => setForm({ ...form, triggerStatus: e.target.value })}
              placeholder="in_review"
            />
          </label>
          <label className="flex flex-col gap-1 text-caption">
            <span className="text-muted-foreground">{t(($) => $.handoff.target_workspace)}</span>
            <select
              className="h-9 rounded-md border bg-transparent px-2 text-body"
              value={form.targetWorkspaceId}
              onChange={(e) => setForm({ ...form, targetWorkspaceId: e.target.value, targetAgentId: "" })}
            >
              <option value="">{t(($) => $.handoff.pick_workspace)}</option>
              {(targets.data ?? []).map((w) => (
                <option key={w.workspace_id} value={w.workspace_id}>
                  {w.workspace_name}（{w.workspace_slug}）
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-caption">
            <span className="text-muted-foreground">{t(($) => $.handoff.target_agent)}</span>
            <select
              className="h-9 rounded-md border bg-transparent px-2 text-body"
              value={form.targetAgentId}
              disabled={!form.targetWorkspaceId}
              onChange={(e) => setForm({ ...form, targetAgentId: e.target.value })}
            >
              <option value="">{t(($) => $.handoff.pick_agent)}</option>
              {targetAgents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1 text-caption">
            <span className="text-muted-foreground">{t(($) => $.handoff.watched)}</span>
            <WatchedIssuePicker
              selected={form.watchedIssueIds}
              onChange={(ids) => setForm({ ...form, watchedIssueIds: ids })}
            />
            <span className="text-faint-foreground">{t(($) => $.handoff.watched_hint)}</span>
          </div>
          <label className="flex flex-col gap-1 text-caption">
            <span className="text-muted-foreground">{t(($) => $.handoff.note)}</span>
            <Textarea
              rows={3}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder={t(($) => $.handoff.note_placeholder)}
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t(($) => $.handoff.cancel)}</Button>
          <Button
            disabled={
              create.isPending || update.isPending ||
              !form.name.trim() || !form.triggerStatus.trim() ||
              !form.targetWorkspaceId || !form.targetAgentId
            }
            onClick={submit}
          >
            {t(($) => $.handoff.save)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// WatchedIssuePicker: multi-select over the source workspace's backlog/todo
// cards. The list is deliberately narrow — a hand-off is configured while a
// card is still being planned, not after it is done.
function WatchedIssuePicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useT("settings");
  const [open, setOpen] = useState(false);
  const issues = useQuery({
    queryKey: ["handoff", "candidate-issues"],
    queryFn: () => api.listHandoffCandidateIssues(["backlog", "todo"]),
    enabled: open,
    staleTime: 60_000,
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t(($) => $.handoff.watched_pick)}
      </Button>
      <span className="text-muted-foreground">
        {selected.length > 0
          ? t(($) => $.handoff.watched_selected, { count: selected.length })
          : t(($) => $.handoff.watched_none)}
      </span>
      {selected.length > 0 && (
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange([])}>
          {t(($) => $.handoff.watched_clear)}
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t(($) => $.handoff.watched)}</DialogTitle>
          </DialogHeader>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {issues.isLoading && <Skeleton className="h-10 w-full rounded" />}
            {!issues.isLoading && (issues.data?.length ?? 0) === 0 && (
              <p className="py-6 text-center text-caption text-muted-foreground">
                {t(($) => $.handoff.watched_empty)}
              </p>
            )}
            {(issues.data ?? []).map((i) => {
              const checked = selected.includes(i.id);
              return (
                <label
                  key={i.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-caption hover:bg-accent/40"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      onChange(
                        e.target.checked
                          ? [...selected, i.id]
                          : selected.filter((id) => id !== i.id),
                      )
                    }
                  />
                  <span className="shrink-0 font-medium">{i.identifier}</span>
                  <span className="truncate text-muted-foreground">{i.title}</span>
                  <Badge variant="outline" className="ml-auto shrink-0">{i.status}</Badge>
                </label>
              );
            })}
          </div>
          <DialogFooter>
            <Button size="sm" onClick={() => setOpen(false)}>
              {t(($) => $.handoff.watched_done)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
