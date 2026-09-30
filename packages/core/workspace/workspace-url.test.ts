import { describe, expect, it } from "vitest";
import { workspaceUrlHost } from "./workspace-url";

describe("workspaceUrlHost", () => {
  it("returns the host of a full app URL", () => {
    expect(workspaceUrlHost("https://quickwork.example.com")).toBe(
      "quickwork.example.com",
    );
  });

  it("ignores scheme, path, and trailing slash", () => {
    expect(workspaceUrlHost("https://quickwork.example.com/")).toBe(
      "quickwork.example.com",
    );
    expect(workspaceUrlHost("http://quickwork.example.com/app/onboarding")).toBe(
      "quickwork.example.com",
    );
  });

  it("preserves a non-default port", () => {
    expect(workspaceUrlHost("https://my.host:3000")).toBe("my.host:3000");
  });

  it("accepts a bare host without a scheme", () => {
    expect(workspaceUrlHost("quickwork.example.com")).toBe("quickwork.example.com");
    expect(workspaceUrlHost("quickwork.example.com/path")).toBe(
      "quickwork.example.com",
    );
  });

  it("falls back to the brand host when no app URL is configured", () => {
    expect(workspaceUrlHost("")).toBe("quickwork.ai");
    expect(workspaceUrlHost("   ")).toBe("quickwork.ai");
    expect(workspaceUrlHost(null)).toBe("quickwork.ai");
    expect(workspaceUrlHost(undefined)).toBe("quickwork.ai");
  });
});
