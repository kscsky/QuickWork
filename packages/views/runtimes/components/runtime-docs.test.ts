// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  customRuntimeDocsHref,
  daemonRuntimesDocsHref,
} from "./runtime-docs";

describe("runtime docs links", () => {
  it.each([
    ["en", "https://quickwork.ai/docs/daemon-runtimes"],
    ["zh-Hans", "https://quickwork.ai/docs/zh/daemon-runtimes"],
    ["ja", "https://quickwork.ai/docs/ja/daemon-runtimes"],
    ["ko", "https://quickwork.ai/docs/ko/daemon-runtimes"],
  ])("localizes the daemon guide for %s", (language, expected) => {
    expect(daemonRuntimesDocsHref(language)).toBe(expected);
  });

  it("adds the localized custom runtime section", () => {
    expect(customRuntimeDocsHref("zh-Hans")).toBe(
      `https://quickwork.ai/docs/zh/daemon-runtimes#${encodeURIComponent("自定义运行时配置")}`,
    );
  });
});
