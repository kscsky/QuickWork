import type { Squad, SquadMessage, SquadRoom } from "@quickwork/core/types";

export function squadMemberCount(squad: Squad): number {
  return squad.member_count ?? squad.member_preview?.length ?? 0;
}

/** The preview row marked as the room's leader, when the server sends one. */
export function squadLeaderPreview(squad: Squad) {
  return (
    squad.member_preview?.find((member) => member.role === "leader") ??
    squad.member_preview?.[0] ??
    null
  );
}

export function squadStats(squads: readonly Squad[]) {
  return {
    squads: squads.length,
    members: squads.reduce((total, squad) => total + squadMemberCount(squad), 0),
  };
}

export function squadLastMessage(room: SquadRoom | undefined): SquadMessage | null {
  const messages = room?.messages ?? [];
  return messages.length > 0 ? (messages[messages.length - 1] ?? null) : null;
}

/** ISO-like pill date; a squad's creation date has no time-of-day meaning. */
export function formatSquadDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Same stable disc idea as the agents ledger: identity keeps its colour as
// the directory reorders.
const SQUAD_COLORS = [
  "#3b4350",
  "#c7745a",
  "#4a6fa8",
  "#8a5a2a",
  "#4f7d63",
  "#7a5aa6",
  "#3f6b58",
  "#6a4a9e",
];

export function squadAccent(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return SQUAD_COLORS[hash % SQUAD_COLORS.length] ?? "#3b4350";
}

export function squadInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "S";
}
