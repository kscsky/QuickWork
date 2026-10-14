import { beforeEach, describe, expect, it } from "vitest";
import { openCreateIssue } from "./create-mode-store";
import { useModalStore } from "../../modals";

describe("openCreateIssue", () => {
  beforeEach(() => {
    useModalStore.getState().close();
  });

  it("always opens the agent create dialog", () => {
    openCreateIssue();
    expect(useModalStore.getState().modal).toBe("quick-create-issue");
    expect(useModalStore.getState().data).toBeNull();
  });

  it("forwards seed data to the dialog", () => {
    openCreateIssue({ project_id: "p1" });
    expect(useModalStore.getState().modal).toBe("quick-create-issue");
    expect(useModalStore.getState().data).toEqual({ project_id: "p1" });
  });
});
