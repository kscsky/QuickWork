// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  LEG_STALL_AFTER_MS,
  legRunActivity,
  silentMinutes,
} from "./leg-run-activity";

const now = Date.parse("2026-10-28T12:00:00Z");

describe("legRunActivity", () => {
  it("counts silence from the last event, not from the run start", () => {
    const activity = legRunActivity({
      live: true,
      lastEventAt: "2026-10-28T11:59:00Z",
      startedAt: "2026-10-28T10:00:00Z",
      now,
    });
    expect(activity.silentMs).toBe(60_000);
    expect(activity.stalled).toBe(false);
  });

  it("flags a run silent past the stall window", () => {
    const activity = legRunActivity({
      live: true,
      lastEventAt: "2026-10-28T11:49:59Z",
      startedAt: "2026-10-28T10:00:00Z",
      now,
    });
    expect(activity.silentMs).toBe(10 * 60_000 + 1_000);
    expect(activity.stalled).toBe(true);
  });

  it("uses the start when the run has not reported anything yet", () => {
    const activity = legRunActivity({
      live: true,
      lastEventAt: null,
      startedAt: "2026-10-28T11:55:00Z",
      now,
    });
    expect(activity.silentMs).toBe(5 * 60_000);
    expect(activity.stalled).toBe(false);
  });

  it("never flags a terminal run, however old its last event is", () => {
    const activity = legRunActivity({
      live: false,
      lastEventAt: "2026-10-28T09:00:00Z",
      startedAt: "2026-10-28T08:00:00Z",
      now,
    });
    expect(activity.silentMs).toBe(0);
    expect(activity.stalled).toBe(false);
  });

  it("treats an unparsable timestamp as unknown silence", () => {
    const activity = legRunActivity({
      live: true,
      lastEventAt: "not-a-date",
      startedAt: null,
      now,
    });
    expect(activity.lastActivityAt).toBeNull();
    expect(activity.stalled).toBe(false);
  });

  it("reports at least one minute for any positive silence", () => {
    expect(silentMinutes(LEG_STALL_AFTER_MS)).toBe(10);
    expect(silentMinutes(20_000)).toBe(1);
  });
});
