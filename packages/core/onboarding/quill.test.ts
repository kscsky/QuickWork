import { describe, expect, it } from "vitest";
import { isQuillAgent, memberNeedsQuillSetup, workspaceNeedsQuill } from "./quill";

const quill = { id: "agent-quill", system_key: "quill" };
const other = { id: "agent-other", system_key: undefined };
const kicked = {
  agent_id: "agent-quill",
  last_message: { content: "…", role: "user" as const, created_at: "2026-01-01" },
};

describe("workspaceNeedsQuill", () => {
  it("is true for an empty workspace", () => {
    expect(workspaceNeedsQuill([])).toBe(true);
  });

  // The regression this guards: the Runtimes recovery card gated on
  // `agents.length === 0`, so creating any ordinary agent first hid the only
  // surface that can mint a Quill. The generic agent endpoint accepts neither
  // `kind` nor `system_key`, so there was no other way back.
  it("stays true when the workspace has ordinary agents but no Quill", () => {
    expect(
      workspaceNeedsQuill([{ system_key: undefined }, { system_key: "" }]),
    ).toBe(true);
  });

  it("is false once a Quill exists", () => {
    expect(workspaceNeedsQuill([{ system_key: "quill" }])).toBe(false);
    expect(
      workspaceNeedsQuill([{ system_key: undefined }, { system_key: "quill" }]),
    ).toBe(false);
  });

  // Identity is the system key, never the display name — Quill is renameable.
  it("does not treat a renamed-to-Quill ordinary agent as Quill", () => {
    expect(isQuillAgent({ system_key: undefined })).toBe(false);
    expect(isQuillAgent({ system_key: "agent_builder" })).toBe(false);
  });
});

// Bootstrapping is three server steps and the last two can fail after the
// agent commits. Gating the entrypoint on the agent alone meant the agent's
// own `agent:created` broadcast tore the card down the moment step one
// succeeded — and it never returned, because the agent is durable and the rest
// was not. These cases are exactly the partial states that produced.
describe("memberNeedsQuillSetup", () => {
  it("is true when the workspace has no Quill at all", () => {
    expect(memberNeedsQuillSetup([other], [])).toBe(true);
  });

  it("stays true when the agent exists but the member has no session", () => {
    expect(memberNeedsQuillSetup([quill], [])).toBe(true);
  });

  it("stays true when the session exists but the kickoff never landed", () => {
    expect(
      memberNeedsQuillSetup([quill], [{ agent_id: "agent-quill", last_message: null }]),
    ).toBe(true);
  });

  // Sessions are per member, so another agent's conversation is not this one.
  it("ignores sessions belonging to other agents", () => {
    expect(
      memberNeedsQuillSetup([quill], [{ ...kicked, agent_id: "agent-other" }]),
    ).toBe(true);
  });

  it("is false once the member has a kicked-off Quill conversation", () => {
    expect(memberNeedsQuillSetup([other, quill], [kicked])).toBe(false);
  });
});
