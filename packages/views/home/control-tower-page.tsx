"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Gauge, Plus, Trash2 } from "lucide-react";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useModalStore } from "@quickwork/core/modals";
import { api } from "@quickwork/core/api";
import { useActorName } from "@quickwork/core/workspace/hooks";
import {
  agentListOptions,
  squadListOptions,
  squadMemberListOptions,
  squadPlaybooksOptions,
  workspaceKeys,
} from "@quickwork/core/workspace/queries";
import { isImeComposing } from "@quickwork/core/utils";
import type { DispatchStep, SquadMember } from "@quickwork/core/types";
import { Button } from "@quickwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@quickwork/ui/components/ui/dropdown-menu";
import { cn } from "@quickwork/ui/lib/utils";
import { toast } from "sonner";

import { ActorAvatar } from "../common/actor-avatar";
import { CollectionPageState } from "../layout/collection-page";
import { useT } from "../i18n";
import { useOrchestrate, type OrchestrateRoute } from "./use-orchestrate";

/** The "no saved route" option in the source picker. */
const BLANK_ROUTE = "__blank__";

interface Person {
  userId: string;
  name: string;
  role: string;
  /** Empty when they lend the room no agent — which is what parks a step. */
  agentId: string;
  agentName: string;
}

/**
 * The compose canvas.
 *
 * The page is a task-creation surface, not a monitor: the unassigned queue it
 * used to list lives on the issues page, and the three columns that duplicated
 * it are gone. What is left is the one thing this page can do that nothing else
 * can — arrange a relay by dragging people into an order, and see the parked
 * step before anything is dispatched.
 *
 * The route is seeded from a saved playbook (or left blank for the squad's own
 * order), edited in place, and handed to the server with the dispatch. It is
 * only ever persisted when the user asks for it: dragging a person in is a
 * decision about THIS task, not a new saved route.
 */
export function ControlTowerPage() {
  const { t } = useT("home");
  const wsId = useWorkspaceId();
  const queryClient = useQueryClient();
  const { getActorName } = useActorName();

  const { data: squads = [], isPending: squadsPending } = useQuery(
    squadListOptions(wsId),
  );
  const { data: agents = [] } = useQuery(agentListOptions(wsId));

  const [squadChoice, setSquadChoice] = useState("");
  const activeSquadId = squadChoice || squads[0]?.id || "";
  const activeSquad = squads.find((s) => s.id === activeSquadId);

  const { data: members = [] } = useQuery(
    squadMemberListOptions(wsId, activeSquadId),
  );
  const { data: playbooks = [] } = useQuery(
    squadPlaybooksOptions(wsId, activeSquadId),
  );

  const agentsById = useMemo(
    () => new Map(agents.map((a) => [a.id, a])),
    [agents],
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
            agentName: agentId ? (agentsById.get(agentId)?.name ?? "") : "",
          };
        }),
    [members, agentsById, getActorName],
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
  // saved route is what the canvas opens on — the page is for reusing a relay,
  // and starting every visit from a blank canvas hides the thing it is for.
  const [sourceTouched, setSourceTouched] = useState(false);
  useEffect(() => {
    if (sourceTouched || sourceId !== BLANK_ROUTE || playbooks.length === 0) {
      return;
    }
    setSourceId(playbooks[0]!.id);
  }, [sourceTouched, sourceId, playbooks]);

  const [route, setRoute] = useState<DispatchStep[]>([]);
  const [prompt, setPrompt] = useState("");
  const [savingName, setSavingName] = useState("");

  const sourceSteps = useMemo<DispatchStep[]>(() => {
    // "Blank" is not an empty relay — it is the squad's own order, which is
    // what the server falls back to. Seeding it here rather than showing
    // nothing keeps the read-only line equal to what will actually run; a
    // consequence line that under-reports is worse than none.
    if (sourceId === BLANK_ROUTE) {
      return people
        .filter((p) => p.userId !== leader?.userId)
        .map((p) => ({ holder_user_id: p.userId, title: "" }));
    }
    const pb = playbooks.find((p) => p.id === sourceId);
    // The server drops a step naming the leader rather than running them
    // twice; filtering here keeps the canvas showing what will be written.
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
      if (
        route[i]!.holder_user_id !== sourceSteps[i]!.holder_user_id ||
        route[i]!.title !== sourceSteps[i]!.title
      ) {
        changed++;
      }
    }
    return changed;
  }, [route, sourceSteps]);

  const parkedSteps = route.filter(
    (s) => !peopleById.get(s.holder_user_id)?.agentId,
  );

  const { orchestrate, isSubmitting, isBusy } = useOrchestrate(wsId);

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
      setSavingName("");
    },
    onError: () => toast.error(t(($) => $.compose.playbook_save_failed)),
  });

  const dispatchRoute = (): OrchestrateRoute =>
    // Name the playbook only while the canvas still agrees with it: the server
    // makes a named playbook win, so sending one after an edit would quietly
    // discard the edit.
    sourceId !== BLANK_ROUTE && editedCount === 0
      ? { playbookId: sourceId }
      : { steps: route };

  if (squadsPending) {
    return <div className="flex flex-1 min-h-0 flex-col" />;
  }

  if (squads.length === 0) {
    return (
      <div className="flex flex-1 min-h-0 flex-col">
        <div className="flex flex-1 items-center justify-center px-6 py-10">
          <CollectionPageState
            icon={Gauge}
            title={t(($) => $.empty.title)}
            description={t(($) => $.empty.description)}
            actions={
              <Button onClick={() => useModalStore.getState().open("create-squad")}>
                <Plus aria-hidden="true" className="size-3.5" />
                {t(($) => $.empty.cta)}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const send = () => {
    if (!prompt.trim() || isBusy) return;
    orchestrate(activeSquadId, prompt, dispatchRoute());
  };

  const agentsOf = (userId: string) =>
    agents.filter((a) => a.owner_id === userId);

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

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[660px] px-6 pb-10 pt-12">
        <h1 className="text-title-lg font-semibold tracking-tight">
          {t(($) => $.compose.ask)}
        </h1>
        <p className="mt-1.5 text-caption text-muted-foreground">
          {t(($) => $.compose.ask_sub)}
        </p>

        <div className="mt-3.5">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border bg-surface px-2.5 text-caption hover:border-input"
                >
                  <span className="grid size-[18px] place-items-center rounded-md bg-zone-1 text-micro font-bold text-white">
                    {activeSquad?.name.slice(0, 1) ?? "?"}
                  </span>
                  {activeSquad?.name ?? t(($) => $.compose.pick_squad)}
                  <ChevronDown className="size-3 text-faint-foreground" />
                </button>
              }
            />
            <DropdownMenuContent align="start" className="w-auto">
              <DropdownMenuRadioGroup value={activeSquadId} onValueChange={setSquadChoice}>
                {squads.map((squad) => (
                  <DropdownMenuRadioItem key={squad.id} value={squad.id}>
                    {squad.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-4 rounded-lg border bg-surface px-4 py-3.5 shadow-sm">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !isImeComposing(e)) {
                e.preventDefault();
                send();
              }
            }}
            rows={4}
            autoFocus
            placeholder={t(($) => $.composer.prompt_placeholder)}
            className="w-full resize-none bg-transparent text-body-lg leading-6 outline-none placeholder:text-faint-foreground"
          />
        </div>

        {/* The route, laid out the way it will actually run, and editable in
            place. A per-dispatch agent is a decision about THIS task, so it
            belongs on the page rather than behind a disclosure — hiding it
            made the page look empty and the choice unreachable. */}
        <div className="mt-6 flex items-center gap-2">
          <span className="text-caption font-medium">
            {t(($) => $.compose.route_label)}
          </span>
          <span className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button type="button" className="text-caption text-brand">
                  {sourceId === BLANK_ROUTE
                    ? t(($) => $.compose.from_blank)
                    : (playbooks.find((p) => p.id === sourceId)?.name ??
                      t(($) => $.compose.from_blank))}
                </button>
              }
            />
            <DropdownMenuContent align="end" className="w-auto">
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
        </div>

        <div className="mt-2 overflow-hidden rounded-lg border bg-surface">
          {leader ? (
            <div className="flex items-center gap-2.5 border-b px-3 py-2.5">
              <StepIndex index={1} />
              <ActorAvatar actorType="member" actorId={leader.userId} size="sm" />
              <span className="min-w-0 flex-1 truncate text-caption">
                {leader.name}
              </span>
              <span className="truncate text-micro text-muted-foreground">
                {leader.agentName || t(($) => $.compose.no_agent)}
              </span>
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-micro text-muted-foreground">
                {t(($) => $.compose.leader_tag)}
              </span>
            </div>
          ) : null}

          {route.map((step, i) => {
            const person = peopleById.get(step.holder_user_id);
            const owned = agentsOf(step.holder_user_id);
            const parked = !person?.agentId && !step.agent_id;
            return (
              <div
                key={`${i}-${step.holder_user_id}`}
                className={cn(
                  "flex items-center gap-2.5 border-b px-3 py-2.5",
                  parked && "bg-warning/5",
                )}
              >
                <StepIndex index={i + 2} parked={parked} />
                <ActorAvatar
                  actorType="member"
                  actorId={step.holder_user_id}
                  size="sm"
                />
                <span className="min-w-0 flex-1 truncate text-caption">
                  {person?.name ?? t(($) => $.compose.unknown_holder)}
                </span>

                {/* Which of this person's agents runs THIS step. Only their own
                    are offered: a step runs on the holder's machine, so
                    somebody else's agent is not a choice. */}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button
                        type="button"
                        className={cn(
                          "inline-flex max-w-[190px] shrink-0 items-center gap-1 truncate rounded-md border px-2 py-1 text-micro",
                          parked && "border-warning/60 text-warning",
                        )}
                      >
                        <span className="truncate">
                          {step.agent_id
                            ? (agentsById.get(step.agent_id)?.name ?? "—")
                            : (person?.agentName || t(($) => $.compose.no_agent))}
                        </span>
                        <ChevronDown className="size-3 shrink-0 opacity-60" />
                      </button>
                    }
                  />
                  <DropdownMenuContent align="end" className="w-auto">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="max-w-[220px] text-micro font-normal text-muted-foreground">
                        {t(($) => $.compose.agent_rule)}
                      </DropdownMenuLabel>
                    </DropdownMenuGroup>
                    <DropdownMenuRadioGroup
                      value={step.agent_id ?? ""}
                      onValueChange={(v) =>
                        setRoute((cur) =>
                          cur.map((s, k) =>
                            k === i ? { ...s, agent_id: v || undefined } : s,
                          ),
                        )
                      }
                    >
                      <DropdownMenuRadioItem value="">
                        {person?.agentName
                          ? t(($) => $.compose.squad_default, {
                              agent: person.agentName,
                            })
                          : t(($) => $.compose.squad_default_none)}
                      </DropdownMenuRadioItem>
                      {owned.map((a) => (
                        <DropdownMenuRadioItem key={a.id} value={a.id}>
                          {a.name}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>

                <button
                  type="button"
                  onClick={() =>
                    setRoute((cur) => cur.filter((_, k) => k !== i))
                  }
                  title={t(($) => $.compose.remove_step)}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })}

          <button
            type="button"
            onClick={addStep}
            disabled={people.length <= (leader ? 1 : 0) + route.length}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-caption text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Plus aria-hidden="true" className="size-3.5" />
            {t(($) => $.compose.add_step)}
          </button>
        </div>

        {parkedSteps.length > 0 ? (
          <p className="mt-2.5 rounded-md bg-warning/10 px-3 py-2 text-caption leading-relaxed text-warning">
            {t(($) => $.compose.parked_notice, {
              name: peopleById.get(parkedSteps[0]!.holder_user_id)?.name ?? "",
            })}
          </p>
        ) : null}

        <div className="mt-3 flex items-center gap-2">
          <input
            value={savingName}
            onChange={(e) => setSavingName(e.target.value)}
            placeholder={t(($) => $.compose.playbook_name_placeholder)}
            className="h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-caption outline-none placeholder:text-faint-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={
              !savingName.trim() || route.length === 0 || savePlaybook.isPending
            }
            onClick={() => savePlaybook.mutate(savingName.trim())}
          >
            {t(($) => $.compose.save)}
          </Button>
        </div>

        {/* The terminus. Creating is the end of this flow, so the button closes
            the block rather than floating in a toolbar. */}
        <div className="mt-6 flex items-center gap-3 border-t pt-4">
          <span className="text-micro text-faint-foreground">
            {t(($) => $.composer.hint)}
          </span>
          <span className="flex-1" />
          <Button size="lg" disabled={!prompt.trim() || isBusy} onClick={send}>
            {isSubmitting
              ? t(($) => $.compose.starting)
              : t(($) => $.compose.start)}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StepIndex({ index, parked }: { index: number; parked?: boolean }) {
  return (
    <span
      className={cn(
        "grid size-[18px] shrink-0 place-items-center rounded-full text-micro font-bold",
        parked
          ? "bg-warning/25 text-warning"
          : "bg-muted text-muted-foreground",
      )}
    >
      {index}
    </span>
  );
}
