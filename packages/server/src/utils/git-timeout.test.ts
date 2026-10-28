import { describe, expect, it } from "vitest";
import { DEFAULT_GIT_TIMEOUT_MS, resolveGitTimeoutMs } from "./git-timeout.js";

describe("resolveGitTimeoutMs", () => {
  it("defaults to 90s", () => {
    expect(resolveGitTimeoutMs({})).toBe(90_000);
    expect(DEFAULT_GIT_TIMEOUT_MS).toBe(90_000);
  });

  it("reads PASEO_GIT_TIMEOUT_MS", () => {
    expect(resolveGitTimeoutMs({ PASEO_GIT_TIMEOUT_MS: "120000" })).toBe(120_000);
  });

  it.each(["", "0", "-5", "1.5", "abc", "10s", "99999999999999999999"])(
    "falls back to the default for %j",
    (value) => {
      expect(resolveGitTimeoutMs({ PASEO_GIT_TIMEOUT_MS: value })).toBe(90_000);
    },
  );
});
