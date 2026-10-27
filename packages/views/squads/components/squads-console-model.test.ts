// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { Squad, SquadRoom } from "@quickwork/core/types";
import {
  formatSquadDate,
  squadAccent,
  squadInitial,
  squadLastMessage,
  squadLeaderPreview,
  squadMemberCount,
  squadStats,
} from "./squads-console-model";

function squad(overrides: Partial<Squad> = {}): Squad {
  return {
    id: "s1",
    workspace_id: "w1",
    name: "接力队",
    description: "",
    instructions: "",
    avatar_url: null,
    leader_id: "a1",
    creator_id: "u1",
    created_at: "2026-09-18T10:00:00+08:00",
    updated_at: "2026-10-01T10:00:00+08:00",
    archived_at: null,
    archived_by: null,
    member_count: 3,
    member_preview: [
      { member_type: "member", member_id: "u1", role: "leader" },
      { member_type: "agent", member_id: "a1", role: "executor" },
    ],
    ...overrides,
  };
}

describe("squadMemberCount / squadStats", () => {
  it("prefers the server count and falls back to the preview length", () => {
    expect(squadMemberCount(squad())).toBe(3);
    expect(squadMemberCount(squad({ member_count: undefined }))).toBe(2);
  });

  it("sums squads and members", () => {
    expect(
      squadStats([
        squad({ id: "a", member_count: 3 }),
        squad({ id: "b", member_count: 2 }),
      ]),
    ).toEqual({ squads: 2, members: 5 });
  });
});

describe("squadLastMessage", () => {
  it("returns the newest row, including system entries", () => {
    const room = {
      has_more: false,
      messages: [
        {
          id: "m1",
          squad_id: "s1",
          author_type: "system",
          body: "小队已创建",
          kind: "",
          metadata: {},
          created_at: "2026-10-01T10:00:00Z",
        },
        {
          id: "m2",
          squad_id: "s1",
          author_type: "member",
          author_id: "u1",
          body: "收到",
          kind: "",
          metadata: {},
          created_at: "2026-10-02T10:00:00Z",
        },
      ],
    } as SquadRoom;
    expect(squadLastMessage(room)?.id).toBe("m2");
    expect(squadLastMessage(undefined)).toBeNull();
    expect(squadLastMessage({ has_more: false, messages: [] })).toBeNull();
  });
});

describe("squadLeaderPreview", () => {
  it("finds the row marked leader, then falls back to the first member", () => {
    expect(squadLeaderPreview(squad())?.member_id).toBe("u1");
    expect(
      squadLeaderPreview(
        squad({
          member_preview: [
            { member_type: "agent", member_id: "a9", role: "executor" },
          ],
        }),
      )?.member_id,
    ).toBe("a9");
    expect(squadLeaderPreview(squad({ member_preview: [] }))).toBeNull();
  });
});

describe("presentation helpers", () => {
  it("keeps a squad's accent stable and derives a fallback initial", () => {
    expect(squadAccent("s1")).toBe(squadAccent("s1"));
    expect(squadAccent("s1")).toMatch(/^#[0-9a-f]{6}$/i);
    expect(squadInitial("接力队")).toBe("接");
    expect(squadInitial("   ")).toBe("S");
  });

  it("formats creation dates as a stable calendar day", () => {
    expect(formatSquadDate("2026-09-18T10:00:00+08:00")).toBe("2026-09-18");
    expect(formatSquadDate("not-a-date")).toBe("—");
  });
});
