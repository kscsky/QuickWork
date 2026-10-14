// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ApiError } from "@quickwork/core/api";
import { orchestrateFailure } from "./orchestrate-failure";

function rejection(body: unknown, status = 422): ApiError {
  return new ApiError("API error: 422 Unprocessable Entity", status, "Unprocessable Entity", body);
}

describe("orchestrateFailure", () => {
  it.each([
    ["runtime_offline", "agent_offline"],
    ["agent_runtime_required", "agent_no_runtime"],
    ["runtime_unusable", "agent_cli_unusable"],
    ["target_unavailable", "agent_archived"],
  ] as const)("maps agent_unavailable/%s to %s", (reasonCode, kind) => {
    expect(
      orchestrateFailure(rejection({ code: "agent_unavailable", reason_code: reasonCode })),
    ).toEqual({ kind });
  });

  it("falls back to the generic kind when reason_code is unknown or absent", () => {
    expect(
      orchestrateFailure(rejection({ code: "agent_unavailable", reason_code: "brand_new_reason" })),
    ).toEqual({ kind: "agent_unavailable" });
    expect(orchestrateFailure(rejection({ code: "agent_unavailable" }))).toEqual({
      kind: "agent_unavailable",
    });
  });

  it("carries the daemon version pair when the server reports one", () => {
    expect(
      orchestrateFailure(
        rejection({
          code: "daemon_version_unsupported",
          current_version: "0.2.18",
          min_version: "0.2.21",
        }),
      ),
    ).toEqual({ kind: "daemon_version", current: "0.2.18", min: "0.2.21" });
  });

  it("leaves missing daemon versions empty rather than inventing a value", () => {
    expect(orchestrateFailure(rejection({ code: "daemon_version_unsupported" }))).toEqual({
      kind: "daemon_version",
      current: "",
      min: "",
    });
  });

  it("returns null for anything that is not a quick-create structured rejection", () => {
    expect(orchestrateFailure(rejection({ code: "source_context_changed" }))).toBeNull();
    expect(orchestrateFailure(rejection({}))).toBeNull();
    expect(orchestrateFailure(new ApiError("boom", 500, "Server Error"))).toBeNull();
    expect(orchestrateFailure(new Error("Failed to fetch"))).toBeNull();
    expect(orchestrateFailure(null)).toBeNull();
  });
});
