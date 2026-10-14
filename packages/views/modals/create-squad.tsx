"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Check, ChevronLeft, X } from "lucide-react";
import { api } from "@quickwork/core/api";
import { useAuthStore } from "@quickwork/core/auth";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useWorkspacePaths } from "@quickwork/core/paths";
import {
  agentListOptions,
  memberListOptions,
  workspaceKeys,
} from "@quickwork/core/workspace/queries";
import { AGENT_DESCRIPTION_MAX_LENGTH } from "@quickwork/core/agents";
import { isImeComposing } from "@quickwork/core/utils";
import type { Agent, MemberWithUser } from "@quickwork/core/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@quickwork/ui/components/ui/dialog";
import { Button } from "@quickwork/ui/components/ui/button";
import { Input } from "@quickwork/ui/components/ui/input";
import { Label } from "@quickwork/ui/components/ui/label";
import { cn } from "@quickwork/ui/lib/utils";
import { toast } from "sonner";

import { useNavigation } from "../navigation";
import { ActorAvatar } from "../common/actor-avatar";
import { AvatarUploadControl } from "../common/avatar-upload-control";
import { CharCounter } from "../agents/components/char-counter";
import {
  PickerEmpty,
  PickerItem,
} from "../issues/components/pickers/property-picker";
import { matchesPinyin } from "../editor/extensions/pinyin-match";
import { useT } from "../i18n";
import { isSquadRoomRole, SQUAD_ROOM_ROLES, type SquadRoomRole } from "../squads/components/squad-room-tab";

type Step = 1 | 2 | 3 | 4;

/**
 * A person in the room, and what they do once they are in.
 *
 * Deliberately not a (kind, id) pair: a squad holds ACCOUNTS, and an agent
 * comes along with whoever owns it. Modelling the pick as a person is what
 * makes "you can only add people here" a fact about the type rather than a
 * rule every call site has to remember.
 */
type Picked = {
  userId: string;
  name: string;
  role: SquadRoomRole;
  canReceiveWork: boolean;
  /**
   * The one agent this person lends, chosen from the agents they own. Empty is
   * a normal state — a member with nothing to lend is still a member.
   */
  agentId: string;
};

/** Identities a person may declare. Same vocabulary onboarding collects. */
const IDENTITIES = [
  "engineer",
  "product",
  "designer",
  "founder",
  "marketing",
  "writer",
  "research",
  "ops",
  "student",
  "other",
] as const;

/**
 * Four steps, in the order the decisions actually depend on each other:
 *
 *   1. who YOU are — the identity shown to the room, and the one that decides
 *      which work is yours by default;
 *   2. who else joins;
 *   3. what each of them does, and whether their agents may take work;
 *   4. the room's own name and face.
 *
 * Steps 1 and 3 are the two the product turns on. Identity is first because
 * nothing else can be decided without it; the role/work split in step 3 is
 * separate because role says what someone decides while the work switch says
 * whether their machine is available — an observer may lend an agent, and an
 * executor may switch theirs off while away.
 */
export function CreateSquadModal({ onClose }: { onClose: () => void }) {
  const { t } = useT("modals");
  const { t: tOnboarding } = useT("onboarding");
  const { t: tSquads } = useT("squads");
  const router = useNavigation();
  const wsPaths = useWorkspacePaths();
  const wsId = useWorkspaceId();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const currentUserId = currentUser?.id ?? null;

  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: wsMembers = [] } = useQuery(memberListOptions(wsId));

  const activeAgents = useMemo(
    () => agents.filter((a: Agent) => !a.archived_at && a.runtime_id),
    [agents],
  );
  const myMemberRow = useMemo(
    () => wsMembers.find((m) => m.user_id === currentUserId),
    [wsMembers, currentUserId],
  );

  // An agent belongs to whoever owns it. That is the only link between a person
  // and the agents they bring into a room — nothing adds an agent directly.
  const agentsByOwner = useMemo(() => {
    const map = new Map<string, Agent[]>();
    for (const agent of activeAgents) {
      const owner = agent.owner_id ?? "";
      if (!owner) continue;
      const list = map.get(owner) ?? [];
      list.push(agent);
      map.set(owner, list);
    }
    return map;
  }, [activeAgents]);

  const [step, setStep] = useState<Step>(1);
  // Pre-selects the registered identity; a person who never declared one picks
  // here instead of being sent away to onboarding.
  const [identity, setIdentity] = useState<string>(() => myMemberRow?.identity ?? "");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  // The caller is a member of their own room, so they sit in this list with
  // everyone else rather than in a synthetic row beside it — a row outside the
  // list renders controls that write nowhere.
  const [picked, setPicked] = useState<Picked[]>(() =>
    currentUserId
      ? [
          {
            userId: currentUserId,
            name: currentUser?.name ?? "",
            role: "leader",
            canReceiveWork: true,
            // Defaults to their first agent so the common case needs no
            // decision; step 3 is where it becomes visible and changeable.
            agentId: "",
          },
        ]
      : [],
  );
  const [creating, setCreating] = useState(false);

  const identityLabelFor = (value: string) => {
    const known = value as (typeof IDENTITIES)[number];
    if (!IDENTITIES.includes(known)) return value;
    const labels: Record<(typeof IDENTITIES)[number], string> = {
      engineer: tOnboarding(($) => $.questions.role.engineer),
      product: tOnboarding(($) => $.questions.role.product),
      designer: tOnboarding(($) => $.questions.role.designer),
      founder: tOnboarding(($) => $.questions.role.founder),
      marketing: tOnboarding(($) => $.questions.role.marketing),
      writer: tOnboarding(($) => $.questions.role.writer),
      research: tOnboarding(($) => $.questions.role.research),
      ops: tOnboarding(($) => $.questions.role.ops),
      student: tOnboarding(($) => $.questions.role.student),
      other: tOnboarding(($) => $.questions.role.other),
    };
    return labels[known];
  };

  // The backend still requires the squad to name an agent to route its work to.
  // That agent belongs to whoever leads, so the choice is scoped to that
  // person's agents rather than picked from the whole workspace — but it IS a
  // choice: silently taking the first one is how a fixture agent ends up
  // leading a room nobody meant to give it to.
  const leaderPerson = picked.find((m) => m.role === "leader");
  const leaderAgents = leaderPerson
    ? (agentsByOwner.get(leaderPerson.userId) ?? [])
    : [];
  // The leader's lent agent IS the squad's routing agent — one decision, not
  // two — so it is read from their row rather than tracked separately.
  const routingAgentId = leaderPerson?.agentId || leaderAgents[0]?.id || "";

  const canAdvance =
    step === 1
      ? !!identity
      : step === 2
        ? true
        : step === 3
          ? !!routingAgentId
          : !!name.trim();

  const handleSubmit = async () => {
    if (!name.trim() || !routingAgentId || creating) return;
    setCreating(true);
    try {
      // The identity is a property of the ACCOUNT, not of this squad: declaring
      // it here writes it once and every room from then on already knows it.
      if (identity && identity !== (myMemberRow?.identity ?? "")) {
        await api.updateMe({ identity });
      }

      const squad = await api.createSquad({
        name: name.trim(),
        description: description.trim() || undefined,
        // The person marked as leader brings this agent; the squad's work
        // routes to it because it is theirs, not because it was picked out.
        leader_id: routingAgentId,
        avatar_url: avatarUrl ?? undefined,
      });
      queryClient.invalidateQueries({ queryKey: workspaceKeys.squads(wsId) });

      // People only. An agent reaches the room through its owner, never as a
      // membership row of its own.
      const results = await Promise.allSettled(
        picked.map((m) =>
          api.addSquadMember(squad.id, {
            member_type: "member",
            member_id: m.userId,
            role: m.role,
            can_receive_work: m.canReceiveWork,
            agent_id: m.userId === leaderPerson?.userId
              ? routingAgentId
              : m.agentId,
          }),
        ),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) {
        toast.warning(t(($) => $.create_squad.toast_members_partial, { count: failed }));
      }

      queryClient.invalidateQueries({
        queryKey: [...workspaceKeys.squads(wsId), squad.id, "members"],
      });
      onClose();
      toast.success(t(($) => $.create_squad.toast_created));
      router.push(wsPaths.squadDetail(squad.id));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t(($) => $.create_squad.toast_failed),
      );
      setCreating(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="p-0 gap-0 flex flex-col overflow-hidden !top-1/2 !left-1/2 !-translate-x-1/2 !-translate-y-1/2 !w-full !max-w-2xl !h-[85vh]">
        <DialogHeader className="border-b px-5 py-3 space-y-0">
          <DialogTitle className="text-title-sm font-semibold">
            {t(($) => $.create_squad.title)}
          </DialogTitle>
          <DialogDescription className="mt-1 text-caption">
            {t(($) => $.create_squad.description)}
          </DialogDescription>
        </DialogHeader>

        <StepBar step={step} onJump={setStep} />

        <div className="flex-1 overflow-y-auto p-5">
          {step === 1 && (
            <StepIdentity
              identity={identity}
              onChange={setIdentity}
              labelFor={identityLabelFor}
              registered={myMemberRow?.identity ?? ""}
            />
          )}

          {step === 2 && (
            <StepPeople
              members={wsMembers}
              currentUserId={currentUserId}
              agentsByOwner={agentsByOwner}
              value={picked}
              onChange={setPicked}
            />
          )}

          {step === 3 && (
            <StepRoles
              members={wsMembers}
              currentUserId={currentUserId}
              agentsByOwner={agentsByOwner}
              value={picked}
              onChange={setPicked}
              identityLabel={identityLabelFor}
            />
          )}

          {step === 4 && (
            <StepRoom
              name={name}
              onName={setName}
              description={description}
              onDescription={setDescription}
              avatarUrl={avatarUrl}
              onAvatar={setAvatarUrl}
              memberCount={picked.length}
              identityLabel={identity ? identityLabelFor(identity) : ""}
            />
          )}
        </div>

        <div className="flex items-center gap-2 border-t bg-background px-5 py-3">
          <span className="text-micro text-faint-foreground">
            {tSquads(($) => $.room.step_of, { step, total: 4 })}
          </span>
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            {t(($) => $.create_squad.cancel)}
          </Button>
          {step > 1 ? (
            <Button variant="ghost" onClick={() => setStep((s) => (s - 1) as Step)}>
              <ChevronLeft aria-hidden="true" className="size-3.5" />
              {t(($) => $.create_squad.back)}
            </Button>
          ) : null}
          {step < 4 ? (
            <Button disabled={!canAdvance} onClick={() => setStep((s) => (s + 1) as Step)}>
              {t(($) => $.create_squad.next)}
            </Button>
          ) : (
            <Button onClick={() => void handleSubmit()} disabled={!canAdvance || creating}>
              {creating
                ? t(($) => $.create_squad.submitting)
                : t(($) => $.create_squad.submit)}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StepBar({ step, onJump }: { step: Step; onJump: (s: Step) => void }) {
  const { t } = useT("modals");
  const steps: { id: Step; label: string }[] = [
    { id: 1, label: t(($) => $.create_squad.step_identity) },
    { id: 2, label: t(($) => $.create_squad.step_people) },
    { id: 3, label: t(($) => $.create_squad.step_roles) },
    { id: 4, label: t(($) => $.create_squad.step_room) },
  ];
  return (
    <div className="flex shrink-0 items-center gap-2 border-b px-5 py-2.5">
      {steps.map((s, i) => (
        <span key={s.id} className="flex items-center gap-2">
          <button
            type="button"
            // Only backwards: a later step depends on the ones before it, and
            // skipping ahead would let someone create a room with no identity.
            disabled={s.id >= step}
            onClick={() => onJump(s.id)}
            className={cn(
              "flex items-center gap-1.5 text-caption",
              s.id < step
                ? "cursor-pointer text-muted-foreground hover:text-foreground"
                : s.id === step
                  ? "font-semibold text-foreground"
                  : "text-faint-foreground",
            )}
          >
            <span
              className={cn(
                "grid size-5 place-items-center rounded-full text-micro font-bold",
                s.id < step
                  ? "bg-success text-white"
                  : s.id === step
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {s.id < step ? <Check className="size-3" /> : s.id}
            </span>
            {s.label}
          </button>
          {i < steps.length - 1 ? <span className="h-px w-6 bg-border" /> : null}
        </span>
      ))}
    </div>
  );
}

function StepIdentity({
  identity,
  onChange,
  labelFor,
  registered,
}: {
  identity: string;
  onChange: (v: string) => void;
  labelFor: (v: string) => string;
  registered: string;
}) {
  const { t } = useT("modals");
  return (
    <div>
      <div className="text-label font-medium">{t(($) => $.create_squad.identity_heading)}</div>
      <p className="mt-1 text-caption text-muted-foreground">
        {t(($) => $.create_squad.identity_hint)}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {IDENTITIES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-label transition-colors hover:border-input",
              identity === value && "border-brand ring-2 ring-brand/15",
            )}
          >
            <span className="min-w-0 flex-1 truncate">{labelFor(value)}</span>
            {identity === value ? <Check className="size-3.5 shrink-0 text-brand" /> : null}
          </button>
        ))}
      </div>

      {registered ? (
        <p className="mt-4 rounded-md bg-muted px-3 py-2 text-caption leading-5 text-muted-foreground">
          {t(($) => $.create_squad.identity_registered, { identity: labelFor(registered) })}
        </p>
      ) : (
        <p className="mt-4 rounded-md bg-muted px-3 py-2 text-caption leading-5 text-muted-foreground">
          {t(($) => $.create_squad.identity_unregistered)}
        </p>
      )}
    </div>
  );
}

function StepPeople({
  members,
  currentUserId,
  agentsByOwner,
  value,
  onChange,
}: {
  members: MemberWithUser[];
  currentUserId: string | null;
  agentsByOwner: Map<string, Agent[]>;
  value: Picked[];
  onChange: (next: Picked[]) => void;
}) {
  const { t } = useT("modals");
  const [filter, setFilter] = useState("");

  const q = filter.trim().toLowerCase();
  const match = (s: string) => !q || s.toLowerCase().includes(q) || matchesPinyin(s, q);

  // People only. An agent is not something you invite — it arrives with whoever
  // owns it, which is why this list has no agent section at all.
  const people = members.filter(
    (m) => m.user_id !== currentUserId && match(m.name),
  );

  const isPicked = (userId: string) => value.some((m) => m.userId === userId);

  const toggle = (m: MemberWithUser) => {
    if (isPicked(m.user_id)) {
      onChange(value.filter((x) => x.userId !== m.user_id));
      return;
    }
    onChange([
      ...value,
      {
        userId: m.user_id,
        name: m.name,
        role: "executor",
        canReceiveWork: true,
        // Defaults to the agent they already have, so adding someone who
        // brings exactly one needs no second decision.
        agentId: agentsByOwner.get(m.user_id)?.[0]?.id ?? "",
      },
    ]);
  };

  return (
    <div>
      <div className="text-label font-medium">{t(($) => $.create_squad.people_heading)}</div>
      <p className="mt-1 text-caption text-muted-foreground">
        {t(($) => $.create_squad.people_hint)}
      </p>

      <div className="mt-3 rounded-lg border">
        <div className="border-b px-3 py-2">
          <input
            autoFocus
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t(($) => $.create_squad.people_search)}
            className="w-full bg-transparent text-body outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {people.length > 0 ? (
            people.map((m) => {
              const own = agentsByOwner.get(m.user_id) ?? [];
              return (
                <PickerItem
                  key={m.user_id}
                  selected={isPicked(m.user_id)}
                  onClick={() => toggle(m)}
                >
                  <ActorAvatar actorType="member" actorId={m.user_id} size="sm" />
                  <span className="truncate">{m.name}</span>
                  <span className="ml-auto shrink-0 text-micro text-muted-foreground">
                    {own.length > 0
                      ? t(($) => $.create_squad.brings_agents, { count: own.length })
                      : t(($) => $.create_squad.brings_no_agents)}
                  </span>
                </PickerItem>
              );
            })
          ) : (
            <PickerEmpty />
          )}
        </div>
      </div>

      {value.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {value.map((m) => (
            <span
              key={m.userId}
              className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2 py-1 text-caption"
            >
              <ActorAvatar actorType="member" actorId={m.userId} size="xs" />
              <span className="max-w-[140px] truncate">{m.name}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x.userId !== m.userId))}
                aria-label={t(($) => $.create_squad.members_remove_aria, { name: m.name })}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <p className="mt-4 rounded-md bg-muted px-3 py-2 text-caption leading-5 text-muted-foreground">
        {t(($) => $.create_squad.agents_come_with_owner)}
      </p>
    </div>
  );
}

function StepRoles({
  members,
  currentUserId,
  agentsByOwner,
  value,
  onChange,
  identityLabel,
}: {
  members: MemberWithUser[];
  currentUserId: string | null;
  agentsByOwner: Map<string, Agent[]>;
  value: Picked[];
  onChange: (next: Picked[]) => void;
  identityLabel: (v: string) => string;
}) {
  const { t } = useT("modals");
  // Room roles are labelled from the squads bundle — the same strings the room
  // renders them with, so the wizard and the room can never disagree.
  const { t: tSquads } = useT("squads");
  const roleLabel = (role: SquadRoomRole) => tSquads(($) => $.room.role[role]);

  const update = (userId: string, patch: Partial<Picked>) =>
    onChange(value.map((m) => (m.userId === userId ? { ...m, ...patch } : m)));

  // Exactly one leader. The squad routes its work to the leader's agents, so a
  // second one would make the destination ambiguous — promoting demotes.
  const setLeader = (userId: string) =>
    onChange(
      value.map((m) => ({
        ...m,
        role:
          m.userId === userId ? "leader" : m.role === "leader" ? "executor" : m.role,
      })),
    );

  return (
    <div>
      <div className="text-label font-medium">{t(($) => $.create_squad.roles_heading)}</div>
      <p className="mt-1 text-caption text-muted-foreground">
        {t(($) => $.create_squad.roles_hint)}
      </p>

      <div className="mt-3 rounded-lg border">
        {value.map((m) => {
          const isSelf = m.userId === currentUserId;
          const profile = members.find((x) => x.user_id === m.userId);
          const shown = isSelf ? t(($) => $.create_squad.you) : m.name;
          const identity = profile?.identity ? identityLabel(profile.identity) : "";
          const own = agentsByOwner.get(m.userId) ?? [];
          const isLeader = m.role === "leader";

          return (
            <div key={m.userId} className="border-b px-3 py-2.5 last:border-b-0">
              <div className="flex items-center gap-3">
                <ActorAvatar
                  actorType="member"
                  actorId={m.userId}
                  size="md"
                  className="shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-label font-medium">{shown}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-micro text-muted-foreground">
                    {identity ? (
                      <span className="rounded-full bg-muted px-1.5">{identity}</span>
                    ) : null}
                    {isLeader ? (
                      <span className="rounded-full bg-inflight-surface px-1.5 text-inflight">
                        {t(($) => $.create_squad.leads_the_room)}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setLeader(m.userId)}
                        className="underline-offset-2 hover:text-foreground hover:underline"
                      >
                        {t(($) => $.create_squad.make_leader)}
                      </button>
                    )}
                  </div>
                </div>

                <select
                  value={m.role}
                  onChange={(e) => {
                    const role = e.target.value;
                    if (!isSquadRoomRole(role)) return;
                    // Choosing "leader" here runs the same demotion the button
                    // does, so the two ways in cannot disagree.
                    if (role === "leader") setLeader(m.userId);
                    else update(m.userId, { role });
                  }}
                  aria-label={t(($) => $.create_squad.role_aria, { name: shown })}
                  className="shrink-0 rounded-md border bg-background px-2 py-1 text-caption"
                >
                  {SQUAD_ROOM_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {roleLabel(role)}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => update(m.userId, { canReceiveWork: !m.canReceiveWork })}
                  aria-pressed={m.canReceiveWork}
                  // Named per member: the switch shows the same two words on
                  // every row, so without this the control is indistinguishable
                  // both to a screen reader and to anything querying it.
                  aria-label={t(($) => $.create_squad.take_work_aria, { name: shown })}
                  className="flex shrink-0 items-center gap-1.5 text-caption"
                >
                  <span
                    className={cn(
                      "relative h-3.5 w-7 rounded-full transition-colors",
                      m.canReceiveWork ? "bg-brand" : "bg-input",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 size-2.5 rounded-full bg-white transition-[left]",
                        m.canReceiveWork ? "left-[0.9rem]" : "left-0.5",
                      )}
                    />
                  </span>
                  <span
                    className={m.canReceiveWork ? "text-foreground" : "text-muted-foreground"}
                  >
                    {t(($) => $.create_squad.take_work)}
                  </span>
                </button>
              </div>

              {/* Which of their own agents this person lends. A picker over
                  what they already own, never a way to make one — a person's
                  agent is bound on their own account, and the leader's choice
                  here is also what the squad's work routes to. */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-9">
                <Bot className="size-3.5 shrink-0 text-faint-foreground" />
                {own.length === 0 ? (
                  <span className="text-micro text-faint-foreground">
                    {isLeader
                      ? t(($) => $.create_squad.leader_needs_agent)
                      : t(($) => $.create_squad.brings_no_agents)}
                  </span>
                ) : (
                  <>
                    <select
                      value={own.some((a) => a.id === m.agentId) ? m.agentId : ""}
                      onChange={(e) => update(m.userId, { agentId: e.target.value })}
                      aria-label={t(($) => $.create_squad.lends_aria, { name: shown })}
                      className="max-w-[220px] truncate rounded-md border bg-background px-1.5 py-0.5 text-micro"
                    >
                      <option value="">{t(($) => $.create_squad.lends_none)}</option>
                      {own.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                    {isLeader ? (
                      <span className="text-micro text-inflight">
                        {t(($) => $.create_squad.leads_with_agent)}
                      </span>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepRoom({
  name,
  onName,
  description,
  onDescription,
  avatarUrl,
  onAvatar,
  memberCount,
  identityLabel,
}: {
  name: string;
  onName: (v: string) => void;
  description: string;
  onDescription: (v: string) => void;
  avatarUrl: string | null;
  onAvatar: (v: string | null) => void;
  memberCount: number;
  identityLabel: string;
}) {
  const { t } = useT("modals");
  return (
    <div>
      <div className="text-label font-medium">{t(($) => $.create_squad.room_heading)}</div>
      <p className="mt-1 text-caption text-muted-foreground">
        {t(($) => $.create_squad.room_hint)}
      </p>

      <div className="mt-4 flex items-start gap-4">
        <AvatarUploadControl
          variant="squad"
          value={avatarUrl}
          name={name}
          size={64}
          onUploaded={onAvatar}
          onClear={() => onAvatar(null)}
        />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <Label className="text-caption text-muted-foreground">
              {t(($) => $.create_squad.name_label)}
            </Label>
            <Input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => onName(e.target.value)}
              placeholder={t(($) => $.create_squad.name_placeholder)}
              className="mt-1"
              onKeyDown={(e) => {
                if (isImeComposing(e)) return;
              }}
            />
          </div>
          <div>
            <Label className="text-caption text-muted-foreground">
              {t(($) => $.create_squad.description_label)}
            </Label>
            <Input
              type="text"
              value={description}
              onChange={(e) => onDescription(e.target.value)}
              placeholder={t(($) => $.create_squad.description_placeholder)}
              maxLength={AGENT_DESCRIPTION_MAX_LENGTH}
              className="mt-1"
            />
            <div className="mt-1">
              <CharCounter
                length={[...description].length}
                max={AGENT_DESCRIPTION_MAX_LENGTH}
              />
            </div>
          </div>
        </div>
      </div>

      <p className="mt-4 rounded-md bg-muted px-3 py-2 text-caption leading-5 text-muted-foreground">
        {identityLabel
          ? t(($) => $.create_squad.room_summary, {
              count: memberCount,
              identity: identityLabel,
            })
          : t(($) => $.create_squad.room_summary_no_identity, { count: memberCount })}
      </p>
    </div>
  );
}
