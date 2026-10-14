// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { AgentListRow } from "./agents-page";
import {
  groupRowsByMachine,
  machineIdOf,
  machineKeyOf,
  machineShortLabel,
  UNBOUND_MACHINE,
} from "./machine-rail";

function row(id: string, runtimeId: string | null): AgentListRow {
  return {
    agent: { id, runtime_id: runtimeId },
  } as unknown as AgentListRow;
}

describe("groupRowsByMachine", () => {
  it("groups by runtime id and keeps first-appearance order", () => {
    const slots = groupRowsByMachine([
      row("a1", "rt-1"),
      row("a2", "rt-2"),
      row("a3", "rt-1"),
    ]);

    expect(slots.map((s) => s.key)).toEqual(["rt-1", "rt-2"]);
    expect(slots[0]?.rows.map((r) => r.agent.id)).toEqual(["a1", "a3"]);
  });

  it("normalizes a blank runtime id to the unbound key, not an unknown machine", () => {
    // Unbound agents carry "" (the API type keeps runtime_id non-nullable) —
    // that must land in the unbound slot, never in the unknown-machine bucket.
    expect(machineKeyOf("")).toBe(UNBOUND_MACHINE);
    expect(machineKeyOf("   ")).toBe(UNBOUND_MACHINE);
    expect(machineKeyOf(null)).toBe(UNBOUND_MACHINE);
    expect(machineKeyOf("rt-1")).toBe("rt-1");
    expect(groupRowsByMachine([row("a1", "")]).map((s) => s.key)).toEqual([
      UNBOUND_MACHINE,
    ]);
  });

  it("buckets agents with no runtime under the unbound key", () => {
    const slots = groupRowsByMachine([row("a1", null), row("a2", "rt-1")]);

    expect(slots.map((s) => s.key)).toEqual([UNBOUND_MACHINE, "rt-1"]);
    expect(slots[0]?.runtimeId).toBeNull();
  });
});

describe("machine identity parsing", () => {
  const daemonComposed = {
    name: "Claude (XLB-20250625VTK)",
    custom_name: null,
    device_info: "XLB-20250625VTK · 2.1.116 (Claude Code)",
  };

  it("reads the host from device_info and the short label from the daemon name", () => {
    expect(machineIdOf(daemonComposed)).toBe("XLB-20250625VTK");
    expect(machineShortLabel(daemonComposed)).toBe("Claude");
  });

  it("falls back to the parenthesised host in `name` when device_info is empty", () => {
    expect(
      machineIdOf({ name: "Codex (host-2)", device_info: "" }),
    ).toBe("host-2");
    expect(machineIdOf({ name: "Codex", device_info: "" })).toBe("");
  });

  it("keeps a user alias verbatim (never strips it as if it were a host suffix)", () => {
    expect(
      machineShortLabel({
        name: "Claude (XLB-20250625VTK)",
        custom_name: "  我的 Mac  ",
      }),
    ).toBe("我的 Mac");
  });
});
