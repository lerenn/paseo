import { describe, expect, it } from "vitest";
import { resolveRuntimeBadge } from "./use-workspace-runtime";

describe("resolveRuntimeBadge", () => {
  const runtimes = [{ id: "pod", label: "Kubernetes pod", icon: "<svg />" }];

  it("is nothing for a host workspace", () => {
    expect(resolveRuntimeBadge(undefined, runtimes)).toBeNull();
    expect(resolveRuntimeBadge(null, runtimes)).toBeNull();
  });

  it("uses the label and icon the runtime declared", () => {
    expect(resolveRuntimeBadge("pod", runtimes)).toEqual({
      id: "pod",
      label: "Kubernetes pod",
      icon: "<svg />",
    });
  });

  it("still shows a runtime whose plugin is not loaded, under its id", () => {
    expect(resolveRuntimeBadge("pod", [])).toEqual({ id: "pod", label: "pod", icon: null });
    expect(resolveRuntimeBadge("pod", undefined)).toEqual({ id: "pod", label: "pod", icon: null });
  });
});
