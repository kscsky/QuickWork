"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Code,
  Loader2,
  Plus,
  Webhook,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import type {
  Agent,
  Autopilot,
  AutopilotRun,
  AutopilotStatus,
  MemberWithUser,
  Project,
  Squad,
} from "@quickwork/core/types";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useWorkspacePaths } from "@quickwork/core/paths";
import {
  autopilotDetailOptions,
  autopilotListOptions,
  autopilotRunsOptions,
} from "@quickwork/core/autopilots/queries";
import {
  useDeleteAutopilot,
  useTriggerAutopilot,
  useUpdateAutopilot,
} from "@quickwork/core/autopilots/mutations";
import { useWorkspacePresenceMap } from "@quickwork/core/agents";
import { projectListOptions } from "@quickwork/core/projects/queries";
import {
  agentListOptions,
  memberListOptions,
  squadListOptions,
} from "@quickwork/core/workspace/queries";
import { Skeleton } from "@quickwork/ui/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@quickwork/ui/components/ui/alert-dialog";
import { AppLink } from "../../navigation";
import { ActorAvatar } from "../../common/actor-avatar";
import { useLocale, useT } from "../../i18n";
import { useTimeAgo } from "../../i18n/use-time-ago";
import { AutopilotDialog } from "./autopilot-dialog";
import { parseCron } from "./schedule-editor/cron-mapping";
import { describeSchedule } from "./schedule-editor/describe";

type ApFilter = "all" | "active" | "paused";

const FILTERS: ApFilter[] = ["all", "active", "paused"];

function dotClass(status: string): string {
  switch (status) {
    case "issue_created":
    case "completed":
      return "done";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
    case "running":
      return "running";
    default:
      return "";
  }
}

export function AutopilotsPage() {
  const { t } = useT("autopilots");
  const locale = useLocale();
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const timeAgo = useTimeAgo();

  const {
    data: autopilots = [],
    isLoading,
    error,
    refetch,
  } = useQuery(autopilotListOptions(wsId));
  const { data: projects = [] } = useQuery(projectListOptions(wsId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: squads = [] } = useQuery(squadListOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { byAgent: presence } = useWorkspacePresenceMap(wsId);

  const [filter, setFilter] = useState<ApFilter>("all");
  const [selectedId, setSelectedId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Autopilot | null>(null);

  const triggerMutation = useTriggerAutopilot();
  const updateMutation = useUpdateAutopilot();
  const deleteMutation = useDeleteAutopilot();

  const projectsById = useMemo(() => {
    const map = new Map<string, Project>();
    for (const project of projects) map.set(project.id, project);
    return map;
  }, [projects]);
  const agentsById = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of agents) map.set(agent.id, agent);
    return map;
  }, [agents]);
  const squadsById = useMemo(() => {
    const map = new Map<string, Squad>();
    for (const squad of squads) map.set(squad.id, squad);
    return map;
  }, [squads]);
  const membersById = useMemo(() => {
    const map = new Map<string, MemberWithUser>();
    for (const member of members) map.set(member.user_id, member);
    return map;
  }, [members]);

  const active = useMemo(
    () => autopilots.filter((ap) => ap.status !== "archived"),
    [autopilots],
  );

  const counts = useMemo(() => {
    let enabled = 0;
    let paused = 0;
    for (const ap of active) {
      if (ap.status === "paused") paused++;
      else enabled++;
    }
    return { all: active.length, active: enabled, paused };
  }, [active]);

  const filtered = useMemo(() => {
    const list =
      filter === "all"
        ? active
        : active.filter((ap) => ap.status === (filter as AutopilotStatus));
    return [...list].sort((a, b) => {
      if (a.status === "paused" && b.status !== "paused") return 1;
      if (b.status === "paused" && a.status !== "paused") return -1;
      const at = a.next_run_at ? Date.parse(a.next_run_at) : Number.MAX_SAFE_INTEGER;
      const bt = b.next_run_at ? Date.parse(b.next_run_at) : Number.MAX_SAFE_INTEGER;
      return (at || Number.MAX_SAFE_INTEGER) - (bt || Number.MAX_SAFE_INTEGER);
    });
  }, [active, filter]);

  useEffect(() => {
    if (selectedId && filtered.some((ap) => ap.id === selectedId)) return;
    setSelectedId(filtered[0]?.id ?? "");
  }, [filtered, selectedId]);

  const selected = filtered.find((ap) => ap.id === selectedId) ?? null;
  const detailQuery = useQuery({
    ...autopilotDetailOptions(wsId, selectedId),
    enabled: !!selectedId,
  });
  const runsQuery = useQuery({
    ...autopilotRunsOptions(wsId, selectedId),
    enabled: !!selectedId,
  });

  const detailAutopilot = detailQuery.data?.autopilot ?? selected;
  const runs = runsQuery.data ?? [];

  const scheduleLabel = (ap: Autopilot) => {
    const cron = ap.schedule_cron ?? null;
    if (cron) {
      const described = describeSchedule(
        t,
        parseCron(cron, ap.schedule_timezone ?? "UTC"),
      );
      return described ?? cron;
    }
    const kind = ap.trigger_kinds?.[0];
    if (kind === "webhook") return t(($) => $.trigger_kind.webhook);
    if (kind === "api") return t(($) => $.trigger_kind.api);
    return t(($) => $.page.empty_schedule);
  };

  const triggerLabel = (ap: Autopilot) => {
    const kind = ap.trigger_kinds?.[0];
    if (kind) {
      return (
        t(($) => $.trigger_kind[kind as "schedule" | "webhook" | "api"]) ??
        kind
      );
    }
    return t(($) => $.trigger_kind.schedule);
  };

  const formatNext = (ap: Autopilot, withLabel = true) => {
    if (ap.status === "paused") {
      return { label: t(($) => $.status.paused), time: "—", paused: true };
    }
    const iso = ap.next_run_at;
    if (!iso) {
      return {
        label: t(($) => $.console.event_label),
        time: t(($) => $.console.event_time),
        paused: false,
      };
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return { label: "", time: "—", paused: false };
    }
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diff = Math.round((day.getTime() - today.getTime()) / 86400000);
    let label: string;
    if (diff === 0) label = t(($) => $.relative_date.today);
    else if (diff === 1) label = t(($) => $.console.tomorrow);
    else if (diff > 1 && diff < 7)
      label = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
    else
      label = new Intl.DateTimeFormat(locale, {
        month: "numeric",
        day: "numeric",
      }).format(date);
    const time = new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
    return { label: withLabel ? label : "", time, paused: false };
  };

  const assigneeName = (ap: Autopilot) =>
    ap.assignee_type === "squad"
      ? (squadsById.get(ap.assignee_id)?.name ?? ap.assignee_id.slice(0, 8))
      : (agentsById.get(ap.assignee_id)?.name ?? ap.assignee_id.slice(0, 8));

  const creatorName = (ap: Autopilot) =>
    ap.created_by_type === "member"
      ? (membersById.get(ap.created_by_id)?.name ?? ap.created_by_id.slice(0, 8))
      : (agentsById.get(ap.created_by_id)?.name ?? ap.created_by_id.slice(0, 8));

  const run = (ap: Autopilot) => {
    triggerMutation.mutate(ap.id, {
      onSuccess: () => toast.success(t(($) => $.detail.toast_triggered)),
      onError: (err) =>
        toast.error(
          err instanceof Error && err.message
            ? err.message
            : t(($) => $.detail.toast_trigger_failed),
        ),
    });
  };

  const toggle = (ap: Autopilot) => {
    const status = ap.status === "paused" ? "active" : "paused";
    updateMutation.mutate(
      { id: ap.id, status },
      {
        onSuccess: () =>
          toast.success(
            status === "active"
              ? t(($) => $.status.active)
              : t(($) => $.status.paused),
          ),
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : String(err)),
      },
    );
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await deleteMutation.mutateAsync(target.id);
      if (selectedId === target.id) setSelectedId("");
      toast.success(t(($) => $.detail.toast_deleted));
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : t(($) => $.detail.toast_delete_failed),
      );
    }
  };

  const groups: { key: "active" | "paused"; rows: Autopilot[] }[] = [
    { key: "active", rows: filtered.filter((ap) => ap.status !== "paused") },
    { key: "paused", rows: filtered.filter((ap) => ap.status === "paused") },
  ].filter((group) => group.rows.length > 0) as {
    key: "active" | "paused";
    rows: Autopilot[];
  }[];

  const nextUp = active
    .filter((ap) => ap.status !== "paused" && ap.next_run_at)
    .sort(
      (a, b) =>
        Date.parse(a.next_run_at ?? "") - Date.parse(b.next_run_at ?? ""),
    )[0];
  const nextUpParts = nextUp ? formatNext(nextUp) : null;

  const clock = (() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes(),
    ).padStart(2, "0")}`;
  })();

  const runStatusLabel = (run: AutopilotRun) =>
    t(($) => $.run_status[run.status]) ?? run.status;
  const runSourceLabel = (run: AutopilotRun) =>
    t(($) => $.run_source[run.source]) ?? run.source;

  const triggerIcon = (ap: Autopilot) => {
    const kind = ap.trigger_kinds?.[0];
    if (kind === "webhook") return <Webhook className="size-2.5" aria-hidden="true" />;
    if (kind === "api") return <Code className="size-2.5" aria-hidden="true" />;
    return <Zap className="size-2.5" aria-hidden="true" />;
  };

  return (
    <div className="qw-ap-page">
      <header className="qw-ap-masthead">
        <div className="qw-ap-mast-main">
          <div className="qw-ap-mast-line">
            <h1>{t(($) => $.page.title)}</h1>
            <span className="qw-ap-count">
              <b>{counts.all}</b>
              <span>AUTOMATIONS</span>
            </span>
            <button
              type="button"
              className="qw-ap-create"
              onClick={() => setCreateOpen(true)}
            >
              <span className="plus">
                <Plus className="size-3" aria-hidden="true" />
              </span>
              {t(($) => $.page.new_autopilot)}
              <span className="kbd">A</span>
            </button>
          </div>
          <p className="qw-ap-live">
            <span className="lamp live" aria-hidden="true" />
            <b>{counts.active}</b> {t(($) => $.status.active)}
            <span className="sep">·</span>
            <b>{counts.paused}</b> {t(($) => $.status.paused)}
            <span className="sep">·</span>
            <span className="quiet">
              {t(($) => $.console.next)}{" "}
              <b>
                {nextUpParts
                  ? `${nextUpParts.label} ${nextUpParts.time}`
                  : "—"}
              </b>
            </span>
          </p>
        </div>
        <div className="qw-ap-sync">
          <span className="sync">
            <i aria-hidden="true" />
            SYNCED
          </span>
          <span className="time">{clock}</span>
          <span className="hint">{t(($) => $.console.sync_hint)}</span>
        </div>
      </header>

      <div className="qw-ap-toolbar">
        <div className="qw-ap-tabs" role="tablist">
          {FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              data-active={filter === key ? "" : undefined}
              className="qw-ap-tab"
              onClick={() => setFilter(key)}
            >
              {key === "all"
                ? t(($) => $.page.scope_all)
                : key === "active"
                  ? t(($) => $.status.active)
                  : t(($) => $.status.paused)}
              <em>{counts[key]}</em>
            </button>
          ))}
        </div>
        <span className="qw-ap-sort">{t(($) => $.console.sort_next)}</span>
      </div>

      <div className="qw-ap-body">
        <div className="qw-ap-list">
          <div className="qw-ap-head">
            <span>{t(($) => $.console.col_next)}</span>
            <span>{t(($) => $.console.col_autopilot)}</span>
            <span className="ap-col-agent">{t(($) => $.console.col_executor)}</span>
            <span>{t(($) => $.console.col_recent)}</span>
          </div>
          {isLoading ? (
            <div className="qw-ap-loading">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-[72px] w-full rounded-none" />
              ))}
            </div>
          ) : error ? (
            <div className="qw-ap-empty">
              <h3>{t(($) => $.console.load_failed)}</h3>
              <button type="button" className="qw-ap-primary" onClick={() => refetch()}>
                {t(($) => $.console.try_again)}
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="qw-ap-empty">{t(($) => $.console.empty)}</div>
          ) : (
            groups.map((group) => (
              <section key={group.key}>
                <div className="qw-ap-group-head">
                  {group.key === "active"
                    ? t(($) => $.console.group_active)
                    : t(($) => $.console.group_paused)}
                  <em>{group.rows.length}</em>
                </div>
                {group.rows.map((ap) => {
                  const next = formatNext(ap);
                  return (
                    <button
                      key={ap.id}
                      type="button"
                      className="qw-ap-row"
                      data-active={selectedId === ap.id ? "" : undefined}
                      onClick={() => setSelectedId(ap.id)}
                    >
                      <span className="qw-ap-next" data-paused={next.paused ? "" : undefined}>
                        <em>{next.label}</em>
                        <b>{next.time}</b>
                      </span>
                      <span className="qw-ap-main">
                        <span className="qw-ap-name">
                          <i className="qw-ap-lamp" data-on={ap.status === "paused" ? undefined : ""} aria-hidden="true" />
                          {ap.title}
                        </span>
                        <span className="qw-ap-sub">
                          {triggerIcon(ap)}
                          {scheduleLabel(ap)} · {t(($) => $.execution_mode[ap.execution_mode])}
                        </span>
                      </span>
                      <span className="qw-ap-agent ap-col-agent">
                        <ActorAvatar
                          actorType={ap.assignee_type}
                          actorId={ap.assignee_id}
                          size="sm"
                        />
                        <span className="name">{assigneeName(ap)}</span>
                      </span>
                      <span className="qw-ap-runs">
                        <span className="qw-ap-dots">
                          {(ap.recent_run_statuses ?? []).slice(0, 5).map((status, index) => (
                            <i key={index} className="qw-ap-dot" data-state={dotClass(status)} />
                          ))}
                        </span>
                        <span className="qw-ap-last">
                          {ap.last_run_at ? timeAgo(ap.last_run_at) : "—"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </section>
            ))
          )}
        </div>

        <aside className="qw-ap-detail">
          {!detailAutopilot ? (
            <div className="qw-ap-empty">{t(($) => $.console.select)}</div>
          ) : (
            <>
              <header className="qw-ap-detail-head">
                <div className="qw-ap-detail-status">
                  <i
                    className="qw-ap-dot"
                    data-state={detailAutopilot.status === "paused" ? "skipped" : "done"}
                    aria-hidden="true"
                  />
                  {detailAutopilot.status === "paused"
                    ? t(($) => $.status.paused)
                    : t(($) => $.status.active)}
                  {" · "}
                  {triggerLabel(detailAutopilot)}
                </div>
                <h2>{detailAutopilot.title}</h2>
                <div className="qw-ap-detail-sub">
                  {scheduleLabel(detailAutopilot)} ·{" "}
                  {t(($) => $.execution_mode[detailAutopilot.execution_mode])}
                </div>
                <div className="qw-ap-actions">
                  <button
                    type="button"
                    className="qw-ap-btn primary"
                    disabled={
                      detailAutopilot.can_write === false ||
                      triggerMutation.isPending
                    }
                    onClick={() => run(detailAutopilot)}
                  >
                    {triggerMutation.isPending ? (
                      <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                    ) : (
                      <Zap className="size-3" aria-hidden="true" />
                    )}
                    {t(($) => $.detail.run_now)}
                  </button>
                  <button
                    type="button"
                    className="qw-ap-btn"
                    disabled={
                      detailAutopilot.can_write === false ||
                      updateMutation.isPending
                    }
                    onClick={() => toggle(detailAutopilot)}
                  >
                    {detailAutopilot.status === "paused"
                      ? t(($) => $.actions.resume)
                      : t(($) => $.actions.pause)}
                  </button>
                  <AppLink
                    href={paths.autopilotDetail(detailAutopilot.id)}
                    className="qw-ap-btn"
                  >
                    {t(($) => $.detail.edit)}
                  </AppLink>
                </div>
              </header>

              {detailAutopilot.pause_reason ? (
                <div className="qw-ap-note">
                  <AlertCircle className="size-3" aria-hidden="true" />
                  {detailAutopilot.pause_reason === "runtime_required"
                    ? t(($) => $.detail.paused_runtime_required)
                    : detailAutopilot.pause_reason}
                </div>
              ) : null}

              <section className="qw-ap-section">
                <div className="qw-ap-sec-head">{t(($) => $.console.schedule)}</div>
                <div className="qw-ap-fact">
                  <span>{t(($) => $.console.next)}</span>
                  <b>
                    {detailAutopilot.status === "paused"
                      ? "—"
                      : nextUpLabel(detailAutopilot, formatNext)}
                  </b>
                </div>
                <div className="qw-ap-fact">
                  <span>{t(($) => $.console.repeat)}</span>
                  <b>{scheduleLabel(detailAutopilot)}</b>
                </div>
                <div className="qw-ap-fact">
                  <span>{t(($) => $.console.trigger)}</span>
                  <b>{triggerLabel(detailAutopilot)}</b>
                </div>
                <div className="qw-ap-fact">
                  <span>{t(($) => $.console.output)}</span>
                  <b>{t(($) => $.execution_mode[detailAutopilot.execution_mode])}</b>
                </div>
              </section>

              <section className="qw-ap-section">
                <div className="qw-ap-sec-head">{t(($) => $.console.executor)}</div>
                <div className="qw-ap-agent-card">
                  <ActorAvatar
                    actorType={detailAutopilot.assignee_type}
                    actorId={detailAutopilot.assignee_id}
                    size="md"
                  />
                  <div className="min-w-0 flex-1">
                    <b>{assigneeName(detailAutopilot)}</b>
                    <span className="s">
                      {detailAutopilot.assignee_type === "agent"
                        ? (() => {
                            const presenceState = presence.get(detailAutopilot.assignee_id);
                            const model = agentsById.get(detailAutopilot.assignee_id)?.model;
                            const state = presenceState?.workload === "working" ? t(($) => $.console.working) : t(($) => $.console.idle);
                            return model ? `${state} · ${model}` : state;
                          })()
                        : t(($) => $.console.col_executor)}
                    </span>
                  </div>
                  {detailAutopilot.assignee_type === "agent" ? (
                    <span
                      className="qw-ap-agent-state"
                      data-on={
                        presence.get(detailAutopilot.assignee_id)?.availability ===
                        "online"
                          ? ""
                          : undefined
                      }
                    >
                      {presence.get(detailAutopilot.assignee_id)?.availability ===
                      "online"
                        ? t(($) => $.console.online)
                        : t(($) => $.console.offline)}
                    </span>
                  ) : null}
                </div>
                <div className="qw-ap-fact">
                  <span>{t(($) => $.detail.field_project)}</span>
                  <b>
                    {detailAutopilot.project_id
                      ? (projectsById.get(detailAutopilot.project_id)?.title ??
                        t(($) => $.detail.project_unavailable))
                      : t(($) => $.detail.no_project)}
                  </b>
                </div>
                <div className="qw-ap-fact">
                  <span>{t(($) => $.detail.field_created_by)}</span>
                  <b>{creatorName(detailAutopilot)}</b>
                </div>
                <div className="qw-ap-fact">
                  <span>{t(($) => $.detail.field_subscribers)}</span>
                  <b>
                    {t(($) => $.console.subscribers_count, {
                      count: detailAutopilot.subscribers?.length ?? 0,
                    })}
                  </b>
                </div>
              </section>

              {detailAutopilot.description ? (
                <section className="qw-ap-section">
                  <div className="qw-ap-sec-head">{t(($) => $.detail.field_prompt)}</div>
                  <p className="qw-ap-prompt">{detailAutopilot.description}</p>
                </section>
              ) : null}

              <section className="qw-ap-section">
                <div className="qw-ap-sec-head">{t(($) => $.console.runs)}</div>
                {runs.length === 0 ? (
                  <p className="qw-ap-runs-empty">{t(($) => $.detail.no_runs)}</p>
                ) : (
                  runs.slice(0, 5).map((runItem) => (
                    <div key={runItem.id} className="qw-ap-run">
                      <i className="qw-ap-dot" data-state={dotClass(runItem.status)} />
                      <span className="text">
                        {runStatusLabel(runItem)}
                        <span className="src"> · {runSourceLabel(runItem)}</span>
                      </span>
                      <em>{timeAgo(runItem.triggered_at)}</em>
                    </div>
                  ))
                )}
              </section>

              {detailAutopilot.can_write !== false ? (
                <div className="qw-ap-danger">
                  <button type="button" onClick={() => setDeleteTarget(detailAutopilot)}>
                    {t(($) => $.detail.delete_button)}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </aside>
      </div>

      <AutopilotDialog
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $.detail.delete_dialog.title)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? t(($) => $.detail.delete_dialog.description, {
                    title: deleteTarget.title,
                  })
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t(($) => $.detail.delete_dialog.cancel)}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void confirmDelete()}
            >
              {t(($) => $.detail.delete_dialog.confirm)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function nextUpLabel(
  ap: Autopilot,
  formatNext: (ap: Autopilot) => { label: string; time: string },
): string {
  const parts = formatNext(ap);
  return parts.time === "—" ? "—" : `${parts.label} ${parts.time}`.trim();
}
