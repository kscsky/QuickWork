"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, BookmarkPlus, ChevronDown, GripVertical, Plus, Trash2 } from "lucide-react";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useModalStore } from "@quickwork/core/modals";
import { api } from "@quickwork/core/api";
import { useShortcut } from "@quickwork/core/shortcuts";
import { useActorName } from "@quickwork/core/workspace/hooks";
import {
  squadListOptions,
  squadMemberListOptions,
  squadPlaybooksOptions,
  workspaceKeys,
} from "@quickwork/core/workspace/queries";
import type { DispatchStep, SquadMember } from "@quickwork/core/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@quickwork/ui/components/ui/dropdown-menu";
import { cn } from "@quickwork/ui/lib/utils";
import { toast } from "sonner";

import { ActorAvatar } from "../common/actor-avatar";
import { ShortcutKeycaps } from "../common/shortcut-keycaps";
import { useT } from "../i18n";
import { CreateTaskChrome, DispatchPriority } from "./create-task-chrome";
import { useIssueDraftStore } from "@quickwork/core/issues/stores/draft-store";
import { ProjectPicker } from "../projects/components/project-picker";
import { DueDatePicker } from "../issues/components";
import { useCurrentWorkspace } from "@quickwork/core/paths";
import { useOrchestrate, type OrchestrateRoute } from "../home/use-orchestrate";

/** The "no saved route" option in the source picker. */
const BLANK_ROUTE = "__blank__";

interface Person {
  userId: string;
  name: string;
  role: string;
  /** Empty when they lend the room no agent — which is what parks a step. */
  agentId: string;
}

/**
 * The squad half of the merged create dialog.
 *
 * Creating is three fields' worth of thinking: one sentence, a squad, an
 * order. The merged "新建任务" dialog switches between this body and the solo
 * one from its top strip; this component owns everything below that strip.
 *
 * The route is seeded from a saved playbook (or the squad's own order), edited
 * in place, and handed to the server with the dispatch. It is only ever
 * persisted when the user asks: dragging a person in is a decision about THIS
 * task, not a new saved route.
 *
 * A submitted dispatch must keep its host mounted: the issue link arrives
 * asynchronously (the relay's leader agent creates it), the navigation happens
 * from the hook, and unmounting early would strand the chain unwritten. The
 * body reports that window through `onBusyChange` so the shell can refuse to
 * close.
 */
export function SquadTaskBody({
  onClose,
  onBusyChange,
  typeSwitch,
}: {
  onClose: () => void;
  /** True while a dispatch is in flight; the shell must not close then. */
  onBusyChange?: (busy: boolean) => void;
  /** The 单人/小队 switch, owned by the shell; rendered into the top strip. */
  typeSwitch?: ReactNode;
}) {
  const { t } = useT("home");
  const { t: tModals } = useT("modals");
  const sendShortcut = useShortcut("send");
  const wsId = useWorkspaceId();
  const draft = useIssueDraftStore((state) => state.draft);
  const setAgent = useIssueDraftStore((state) => state.setAgent);
  const setShared = useIssueDraftStore((state) => state.setShared);
  const title = draft.agent.title ?? "";
  const prompt = draft.agent.prompt;
  const projectId = draft.shared.projectId ?? null;
  const priority = draft.shared.priority;
  const dueDate = draft.shared.dueDate;
  const setTitle = (value: string) => setAgent({ title: value });
  const setPrompt = (value: string) => setAgent({ prompt: value });
  const commitProject = (value: string | null) => setShared({ projectId: value ?? undefined });
  const commitPriority = (value: typeof priority) => setShared({ priority: value });
  const commitDueDate = (value: string | null) => setShared({ dueDate: value });
  const workspaceName = useCurrentWorkspace()?.name ?? "";
  const queryClient = useQueryClient();
  const { getActorName } = useActorName();

  const { data: squads = [], isPending: squadsPending } = useQuery(
    squadListOptions(wsId),
  );

  const [squadChoice, setSquadChoice] = useState("");
  const activeSquadId = squadChoice || squads[0]?.id || "";

  const { data: members = [] } = useQuery(
    squadMemberListOptions(wsId, activeSquadId),
  );
  const { data: playbooks = [] } = useQuery(
    squadPlaybooksOptions(wsId, activeSquadId),
  );

  const people = useMemo<Person[]>(
    () =>
      members
        .filter((m: SquadMember) => m.member_type === "member")
        .map((m) => {
          const agentId = m.agent_id ?? "";
          return {
            userId: m.member_id,
            name: getActorName("member", m.member_id),
            role: m.role,
            agentId,
          };
        }),
    [members, getActorName],
  );
  const peopleById = useMemo(
    () => new Map(people.map((p) => [p.userId, p])),
    [people],
  );
  // The relay's step 0 is whoever leads the squad, and the server writes it
  // itself. Showing it locked is the honest picture: adding them to the route
  // would be dropped on the way in.
  const leader = people.find((p) => p.role === "leader") ?? people[0];

  const [sourceId, setSourceId] = useState(BLANK_ROUTE);
  // Whether the user has chosen a source themselves. Until they do, the first
  // saved route is what the dialog opens on — starting every visit from a
  // blank canvas hides the thing the saved routes are for.
  const [sourceTouched, setSourceTouched] = useState(false);
  useEffect(() => {
    if (sourceTouched || sourceId !== BLANK_ROUTE || playbooks.length === 0) {
      return;
    }
    setSourceId(playbooks[0]!.id);
  }, [sourceTouched, sourceId, playbooks]);

  const [route, setRoute] = useState<DispatchStep[]>([]);
  const [savingName, setSavingName] = useState("");
  const [naming, setNaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stamped, setStamped] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const dispatchRef = useRef(false);
  const stampTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (stampTimer.current) clearTimeout(stampTimer.current);
    },
    [],
  );

  useEffect(() => {
    const focusTitle = () => {
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.isContentEditable || /^(INPUT|TEXTAREA)$/.test(active.tagName))) {
        return;
      }
      titleRef.current?.focus();
    };
    const id = requestAnimationFrame(focusTitle);
    const timer = window.setTimeout(focusTitle, 90);
    return () => {
      cancelAnimationFrame(id);
      window.clearTimeout(timer);
    };
  }, []);

  const sourceSteps = useMemo<DispatchStep[]>(() => {
    // "Blank" is not an empty relay — it is the squad's own order, which is
    // what the server falls back to. Seeding it here rather than showing
    // nothing keeps the read-only line equal to what will actually run.
    if (sourceId === BLANK_ROUTE) {
      return people
        .filter((p) => p.userId !== leader?.userId)
        .map((p) => ({ holder_user_id: p.userId, title: "" }));
    }
    const pb = playbooks.find((p) => p.id === sourceId);
    // The server drops a step naming the leader rather than running them
    // twice; filtering here keeps the dialog showing what will be written.
    return (pb?.steps ?? []).filter(
      (s) => s.holder_user_id !== leader?.userId,
    );
  }, [sourceId, playbooks, leader, people]);

  // Reseed only when the subject changes — squad or chosen playbook, not on
  // every render. Keying on a ref rather than an effect dependency list keeps
  // an edit from being clobbered by an unrelated re-render.
  const seedKey = `${activeSquadId}|${sourceId}|${people.length}`;
  const seededFor = useRef("");
  useEffect(() => {
    if (seededFor.current === seedKey) return;
    seededFor.current = seedKey;
    setRoute(sourceSteps);
  }, [seedKey, sourceSteps]);

  const editedCount = useMemo(() => {
    if (route.length !== sourceSteps.length) {
      return Math.max(route.length, sourceSteps.length);
    }
    let changed = 0;
    for (let i = 0; i < route.length; i++) {
      const step = route[i]!;
      const source = sourceSteps[i]!;
      if (
        step.holder_user_id !== source.holder_user_id ||
        (step.title ?? "") !== (source.title ?? "")
      ) {
        changed++;
      }
    }
    return changed;
  }, [route, sourceSteps]);

  const parkedSteps = route.filter(
    (s) => !peopleById.get(s.holder_user_id)?.agentId,
  );

  const { orchestrate, isSubmitting, isBusy, isWaitingOnIssue } =
    useOrchestrate(wsId);

  const savePlaybook = useMutation({
    mutationFn: (name: string) =>
      api.saveSquadPlaybook(activeSquadId, {
        name,
        steps: route.map((s) => ({
          holder_user_id: s.holder_user_id,
          title: s.title,
        })),
      }),
    onSuccess: async (saved) => {
      toast.success(t(($) => $.compose.playbook_saved));
      await queryClient.invalidateQueries({
        queryKey: workspaceKeys.squadPlaybooks(wsId, activeSquadId),
      });
      setSourceId(saved.id);
      setNaming(false);
      setSavingName("");
    },
    onError: () => toast.error(t(($) => $.compose.playbook_save_failed)),
  });

  const composePrompt = () => {
    const headline = title.trim();
    const body = prompt.trim();
    if (!headline) return body;
    if (!body) return headline;
    return `${headline}

${body}`;
  };

  const dispatchRoute = (): OrchestrateRoute =>
    // Name the playbook only while the canvas still agrees with it: the server
    // makes a named playbook win, so sending one after an edit would quietly
    // discard the edit.
    sourceId !== BLANK_ROUTE && editedCount === 0
      ? { playbookId: sourceId }
      : { steps: route };

  useEffect(() => {
    if (!isBusy) dispatchRef.current = false;
  }, [isBusy]);

  const send = () => {
    if (isBusy || dispatchRef.current) return;
    if (!title.trim()) {
      setError(tModals(($) => $.create_issue.title_required_squad));
      titleRef.current?.focus();
      return;
    }
    if (!activeSquadId) return;
    dispatchRef.current = true;
    setError(null);
    setStamped(true);
    if (stampTimer.current) clearTimeout(stampTimer.current);
    stampTimer.current = setTimeout(() => setStamped(false), 1800);
    const text = composePrompt();
    const fields = projectId || priority !== "none" || dueDate
      ? { projectId, priority, dueDate }
      : undefined;
    if (fields) orchestrate(activeSquadId, text, dispatchRoute(), fields);
    else orchestrate(activeSquadId, text, dispatchRoute());
  };
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        sendRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const addStep = () => {
    const spare = people.find(
      (p) =>
        p.userId !== leader?.userId &&
        !route.some((s) => s.holder_user_id === p.userId),
    );
    if (!spare) return;
    setRoute((cur) => [
      ...cur,
      { holder_user_id: spare.userId, title: "" },
    ]);
  };

  const moveStep = (from: number, to: number) => {
    if (from === to || to < 0 || to >= route.length) return;
    setRoute((cur) => {
      const next = [...cur];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  };

  // Drag state for reordering the relay.
  const [dragging, setDragging] = useState<number | null>(null);

  // While a dispatch is in flight the host dialog must stay put: the issue
  // link and the chain write happen from effects owned here.
  useEffect(() => {
    onBusyChange?.(isBusy);
  }, [isBusy, onBusyChange]);

  const today = new Date().toISOString().slice(0, 10);
  const legCount = route.length + (leader ? 1 : 0);

  return (
    <CreateTaskChrome onClose={onClose} typeSwitch={typeSwitch} busy={isBusy}>
      <div className={cn("qk-create-paper", stamped && "is-stamping")}>
        <div className="qk-paper-head">
          <span className="qk-paper-label">
            {tModals(($) => $.create_issue.paper_relay)}
          </span>
          <span className="qk-paper-kind">
            {tModals(($) => $.create_issue.kind_squad)}
          </span>
          <span className="qk-paper-meta">
            {today} · {workspaceName.toUpperCase()}
          </span>
        </div>

        <label className="qk-title-field" htmlFor="qk-squad-title">
          <span className="qk-title-label">
            {tModals(($) => $.create_issue.title_label_squad)}
          </span>
          <input
            ref={titleRef}
            id="qk-squad-title"
            value={title}
            disabled={isBusy}
            onChange={(e) => {
              setTitle(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                send();
              }
            }}
            placeholder={tModals(($) => $.create_issue.title_placeholder_squad)}
            autoComplete="off"
            className="qk-title-input"
          />
        </label>

        <div className="qk-form-error" role="status">{error ?? ""}</div>

        <label className="qk-brief-field" htmlFor="qk-squad-brief">
          <span className="qk-field-label">
            {tModals(($) => $.create_issue.brief_label)}
          </span>
          <textarea
            id="qk-squad-brief"
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                send();
              }
            }}
            rows={6}
            disabled={isBusy}
            placeholder={tModals(($) => $.create_issue.brief_placeholder_squad)}
            className="qk-brief-textarea"
          />
        </label>

        <div className="qk-files">
          <span className="qk-field-label">
            {tModals(($) => $.create_issue.files_label)}
          </span>
          <span className="qk-files-note">
            {tModals(($) => $.create_issue.files_squad_note)}
          </span>
        </div>

        <div className="qk-paper-foot">
          <span>{tModals(($) => $.create_issue.paper_foot_squad)}</span>
          <span>
            {tModals(($) => $.create_issue.route_legs, { count: legCount })}
          </span>
        </div>

        <span className="qk-dispatch-stamp" aria-hidden="true">
          {tModals(($) => $.create_issue.stamp_squad)}
        </span>
      </div>

      <aside className="qk-create-panel">
        <div className="qk-panel-scroll">
        <div className="qk-panel-head">
          <span>{tModals(($) => $.create_issue.route_label_panel)}</span>
          <span className="qk-panel-hint">
            {tModals(($) => $.create_issue.route_legs, { count: legCount })}
          </span>
        </div>

        {squads.length === 0 && !squadsPending ? (
          <div className="qk-squad-empty">
            <p className="qk-squad-empty-title">{t(($) => $.empty.title)}</p>
            <p className="qk-squad-empty-copy">{t(($) => $.empty.description)}</p>
            <button
              type="button"
              className="qk-route-add"
              onClick={() => useModalStore.getState().open("create-squad")}
            >
              <Plus aria-hidden="true" className="size-3" />
              {t(($) => $.empty.cta)}
            </button>
          </div>
        ) : (
          <>
            <div className="qk-squad-picker">
              <span>{tModals(($) => $.create_issue.squad_label)}</span>
              <select
                aria-label={tModals(($) => $.create_issue.squad_label)}
                value={activeSquadId}
                disabled={isBusy || squadsPending}
                onChange={(e) => {
                  setSquadChoice(e.target.value);
                  setSourceTouched(false);
                  setSourceId(BLANK_ROUTE);
                }}
              >
                {squads.map((squad) => (
                  <option key={squad.id} value={squad.id}>
                    {squad.name}
                  </option>
                ))}
              </select>
              <span>
                {tModals(($) => $.create_issue.squad_meta, {
                  legs: legCount,
                  people: people.length,
                })}
              </span>
            </div>

            <div className="qk-route">
              {leader ? (
                <div
                  className="qk-leg"
                  data-first
                  title={t(($) => $.compose.leader_tag)}
                >
                  <span className="qk-leg-no">01</span>
                  <ActorAvatar
                    actorType="member"
                    actorId={leader.userId}
                    size="sm"
                    className="qk-leg-ava"
                  />
                  <span className="qk-leg-main">
                    <b>{leader.name}</b>
                  </span>
                  <span className="sr-only">{t(($) => $.compose.leader_tag)}</span>
                </div>
              ) : (
                <p className="qk-route-empty">{t(($) => $.compose.empty_route)}</p>
              )}

              {route.map((step, i) => {
                const person = peopleById.get(step.holder_user_id);
                const parked = !person?.agentId;
                return (
                  <div
                    key={`${i}-${step.holder_user_id}`}
                    data-parked={parked ? "" : undefined}
                    data-dragging={dragging === i ? "" : undefined}
                    onDragOver={(e) => {
                      if (dragging === null || dragging === i) return;
                      e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragging !== null) moveStep(dragging, i);
                      setDragging(null);
                    }}
                    className="qk-leg"
                  >
                    <span className="qk-leg-no">
                      {String(i + 2).padStart(2, "0")}
                    </span>
                    <ActorAvatar
                      actorType="member"
                      actorId={step.holder_user_id}
                      size="sm"
                      className="qk-leg-ava"
                    />
                    <span className="qk-leg-main">
                      <b>{person?.name ?? t(($) => $.compose.unknown_holder)}</b>
                    </span>
                    <span className="qk-leg-tools">
                      <span
                        draggable={!isBusy}
                        onDragStart={() => setDragging(i)}
                        onDragEnd={() => setDragging(null)}
                        className="qk-leg-grip"
                      >
                        <GripVertical aria-hidden="true" className="size-3" />
                      </span>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          setRoute((cur) => cur.filter((_, k) => k !== i))
                        }
                        title={t(($) => $.compose.remove_step)}
                        aria-label={t(($) => $.compose.remove_step)}
                        className="qk-leg-remove"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </span>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={addStep}
                disabled={
                  isBusy ||
                  people.length <= (leader ? 1 : 0) + route.length
                }
                className="qk-route-add"
              >
                <Plus aria-hidden="true" className="size-3" />
                {t(($) => $.compose.add_step)}
              </button>
            </div>

            {parkedSteps.length > 0 ? (
              <p className="qk-parked-notice">
                {tModals(($) => $.create_issue.parked_notice_short, {
                  name:
                    peopleById.get(parkedSteps[0]!.holder_user_id)?.name ?? "",
                })}
              </p>
            ) : null}

            <div className="qk-route-source">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      disabled={isBusy}
                      aria-label={tModals(($) => $.create_issue.route_source)}
                    >
                      <span>
                        {sourceId === BLANK_ROUTE
                          ? t(($) => $.compose.from_blank)
                          : (playbooks.find((p) => p.id === sourceId)?.name ??
                            t(($) => $.compose.from_blank))}
                      </span>
                      <ChevronDown className="size-2.5" />
                    </button>
                  }
                />
                <DropdownMenuContent align="start" className="w-auto">
                  <DropdownMenuRadioGroup
                    value={sourceId}
                    onValueChange={(v) => {
                      setSourceTouched(true);
                      setSourceId(v);
                    }}
                  >
                    <DropdownMenuRadioItem value={BLANK_ROUTE}>
                      {t(($) => $.compose.from_squad_order)}
                    </DropdownMenuRadioItem>
                    {playbooks.map((pb) => (
                      <DropdownMenuRadioItem key={pb.id} value={pb.id}>
                        {pb.name}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                type="button"
                disabled={isBusy || route.length === 0}
                onClick={() => setNaming(true)}
              >
                <BookmarkPlus className="size-2.5" />
                {t(($) => $.compose.save_draft)}
              </button>
            </div>

            {naming ? (
              <div className="qk-naming">
                <input
                  autoFocus
                  value={savingName}
                  onChange={(e) => setSavingName(e.target.value)}
                  placeholder={t(($) => $.compose.playbook_name_placeholder)}
                />
                <button
                  type="button"
                  onClick={() => {
                    setNaming(false);
                    setSavingName("");
                  }}
                >
                  {t(($) => $.compose.cancel)}
                </button>
                <button
                  type="button"
                  disabled={
                    !savingName.trim() ||
                    route.length === 0 ||
                    savePlaybook.isPending
                  }
                  onClick={() => savePlaybook.mutate(savingName.trim())}
                >
                  {t(($) => $.compose.save)}
                </button>
              </div>
            ) : null}
          </>
        )}

        <div className="qk-panel-section">
          <div className="qk-panel-label">
            {tModals(($) => $.create_issue.section_details)}
          </div>
          <div className="qk-panel-rows">
            <div className="qk-panel-row">
              <span className="qk-row-label">
                {tModals(($) => $.create_issue.field_project)}
              </span>
              <div className="min-w-0 flex-1">
                <ProjectPicker
                  projectId={projectId}
                  onUpdate={(u) => commitProject(u.project_id ?? null)}
                  triggerRender={<button type="button" className="qk-dark-control" />}
                  align="start"
                />
              </div>
            </div>
            <div className="qk-panel-row">
              <span className="qk-row-label">
                {tModals(($) => $.create_issue.field_priority)}
              </span>
              <div className="min-w-0 flex-1">
                <DispatchPriority
                  value={priority}
                  disabled={isBusy}
                  onChange={commitPriority}
                />
              </div>
            </div>
            <div className="qk-panel-row">
              <span className="qk-row-label">
                {tModals(($) => $.create_issue.field_due)}
              </span>
              <div className="min-w-0 flex-1">
                <DueDatePicker
                  dueDate={dueDate}
                  onUpdate={(updates) => commitDueDate(updates.due_date ?? null)}
                  triggerRender={<button type="button" className="qk-dark-control" />}
                  align="start"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="qk-panel-note">
          <span aria-hidden="true" className="qk-panel-lamp" />
          <span>
            {leader
              ? tModals(($) => $.create_issue.note_squad, { name: leader.name })
              : tModals(($) => $.create_issue.note_squad_unassigned)}
          </span>
        </div>

        </div>

        <div className="qk-panel-foot">
          <button type="button" className="qk-panel-cancel" onClick={onClose}>
            {tModals(($) => $.common.cancel)}
          </button>
          <button
            type="button"
            onClick={send}
            disabled={!title.trim() || isBusy || !activeSquadId}
            aria-busy={isBusy || undefined}
            className="qk-panel-submit"
          >
            {isWaitingOnIssue
              ? t(($) => $.composer.linking)
              : isSubmitting
                ? t(($) => $.compose.starting)
                : tModals(($) => $.create_issue.start_relay)}
            {!isBusy && sendShortcut ? (
              <ShortcutKeycaps
                shortcut={sendShortcut}
                decorative
                className="max-sm:hidden"
                keyClassName="border-black/20 bg-black/10 text-black/55 shadow-none"
              />
            ) : null}
            <ArrowUpRight className="size-3" aria-hidden="true" />
          </button>
        </div>
      </aside>
    </CreateTaskChrome>
  );
}
