import { describe, expect, it } from "vitest";
import type { WorkspaceLabelDefinition } from "@getpaseo/protocol/workspace-labels";
import type { PrHint } from "@/git/pr-hint";
import { DEFAULT_SIDEBAR_CHECKS_DISPLAY } from "@/components/sidebar/display-preferences/checks-display";
import { DEFAULT_SIDEBAR_ROW_ITEMS } from "@/components/sidebar/display-preferences/row-items";
import { isRuntimeBadgeHidden } from "@/workspace-runtimes/badge-visibility";
import { selectMetaRowItems } from "./meta-items";
import type { WorkspaceServiceSummary } from "./service-summary";

const PR_HINT: PrHint = {
  url: "https://github.com/acme/app/pull/7",
  number: 7,
  state: "open",
  forge: "github",
  checksStatus: "success",
};

const SERVICE: WorkspaceServiceSummary = { name: "web", health: null };

const LABELS: WorkspaceLabelDefinition[] = [{ name: "Urgent", color: "red" }];

function select(overrides: Partial<Parameters<typeof selectMetaRowItems>[0]> = {}) {
  return selectMetaRowItems({
    currentBranch: "feature/sidebar-badges",
    projectName: "Paseo",
    hasHostBadge: true,
    prHint: PR_HINT,
    serviceSummary: SERVICE,
    labels: LABELS,
    visible: DEFAULT_SIDEBAR_ROW_ITEMS,
    checksDisplay: DEFAULT_SIDEBAR_CHECKS_DISPLAY,
    ...overrides,
  });
}

const kinds = (items: ReturnType<typeof selectMetaRowItems>) => items.map((item) => item.kind);

describe("selectMetaRowItems", () => {
  it("puts the enabled branch and project badges first", () => {
    const visible = { ...DEFAULT_SIDEBAR_ROW_ITEMS, branch: true, project: true };
    expect(kinds(select({ visible }))).toEqual([
      "branch",
      "project",
      "host",
      "changeRequest",
      "checks",
      "services",
      "labels",
    ]);
  });

  it("reads identity, then the change, then its state, then what is running, then labels", () => {
    expect(kinds(select())).toEqual(["host", "changeRequest", "checks", "services", "labels"]);
  });

  it("omits what the workspace does not have", () => {
    expect(
      kinds(
        select({
          currentBranch: null,
          projectName: null,
          hasHostBadge: false,
          prHint: null,
          serviceSummary: null,
          labels: [],
        }),
      ),
    ).toEqual([]);
  });

  it("only draws identity badges when enabled and available", () => {
    const visible = { ...DEFAULT_SIDEBAR_ROW_ITEMS, branch: true, project: true };
    expect(kinds(select({ currentBranch: null, projectName: null, visible }))).toEqual([
      "host",
      "changeRequest",
      "checks",
      "services",
      "labels",
    ]);
  });

  it("carries every label as one item, so the line keeps one separator however many there are", () => {
    const labels: WorkspaceLabelDefinition[] = [
      { name: "Urgent", color: "red" },
      { name: "Backend", color: "sky" },
    ];
    expect(select({ labels }).at(-1)).toEqual({ kind: "labels", labels });
  });

  it.each([
    ["changeRequest", ["host", "checks", "services", "labels"]],
    ["services", ["host", "changeRequest", "checks", "labels"]],
    ["labels", ["host", "changeRequest", "checks", "services"]],
  ] as const)("drops %s and only %s when it is switched off", (item, expected) => {
    expect(kinds(select({ visible: { ...DEFAULT_SIDEBAR_ROW_ITEMS, [item]: false } }))).toEqual(
      expected,
    );
  });

  it("drops checks and only checks when they are hidden", () => {
    expect(kinds(select({ checksDisplay: "none" }))).toEqual([
      "host",
      "changeRequest",
      "services",
      "labels",
    ]);
  });

  it("keeps checks when the change request is hidden", () => {
    // Each control answers for itself. A checks setting that drew nothing because a different
    // switch was off would be lying about its own state.
    const items = select({ visible: { ...DEFAULT_SIDEBAR_ROW_ITEMS, changeRequest: false } });
    expect(kinds(items)).toEqual(["host", "checks", "services", "labels"]);
  });

  it("draws nothing for checks when both are off", () => {
    const items = select({
      visible: { ...DEFAULT_SIDEBAR_ROW_ITEMS, changeRequest: false },
      checksDisplay: "none",
    });
    expect(kinds(items)).toEqual(["host", "services", "labels"]);
  });

  it("carries the resolved check summary rather than the raw hint", () => {
    const checks = select().find((item) => item.kind === "checks");
    expect(checks).toEqual({
      kind: "checks",
      summary: { state: "passed", completed: 1, total: 1 },
      label: true,
    });
  });

  it("keeps the check summary but drops its word when only the icon is wanted", () => {
    const checks = select({ checksDisplay: "icon" }).find((item) => item.kind === "checks");
    expect(checks).toEqual({
      kind: "checks",
      summary: { state: "passed", completed: 1, total: 1 },
      label: false,
    });
  });

  it("keeps a change request whose forge reports no checks", () => {
    const items = select({ prHint: { ...PR_HINT, checksStatus: undefined } });
    expect(kinds(items)).toEqual(["host", "changeRequest", "services", "labels"]);
  });
});

describe("hidden runtime badge", () => {
  const bare = {
    currentBranch: null,
    projectName: null,
    prHint: null,
    serviceSummary: null,
    labels: [],
  };

  it("leaves no empty slot in first position", () => {
    const items = select({
      ...bare,
      hasHostBadge: false,
      runtimeId: "pod",
      runtimeBadgeHidden: true,
      hasAgentBadges: true,
    });
    expect(kinds(items)).toEqual(["agentBadges"]);
  });

  it("leaves no empty slot in the middle", () => {
    const items = select({
      ...bare,
      serviceSummary: SERVICE,
      hasHostBadge: false,
      runtimeId: "pod",
      runtimeBadgeHidden: true,
      hasAgentBadges: true,
    });
    expect(kinds(items)).toEqual(["agentBadges", "services"]);
  });

  it("leaves no empty slot in last position", () => {
    const items = select({
      ...bare,
      serviceSummary: SERVICE,
      hasHostBadge: false,
      runtimeId: "pod",
      runtimeBadgeHidden: true,
    });
    expect(kinds(items)).toEqual(["services"]);
  });
});

describe("selectMetaRowItems blank names", () => {
  it("takes no slot for a whitespace-only branch or project name", () => {
    const visible = { ...DEFAULT_SIDEBAR_ROW_ITEMS, branch: true, project: true };
    expect(kinds(select({ visible, currentBranch: "  ", projectName: "\t" }))).toEqual([
      "host",
      "changeRequest",
      "checks",
      "services",
      "labels",
    ]);
  });
});

describe("isRuntimeBadgeHidden", () => {
  it("hides only when the host icon is shown and the runtime has no visible label", () => {
    expect(isRuntimeBadgeHidden({ hostIcon: "<svg/>" }, true)).toBe(true);
    expect(isRuntimeBadgeHidden({ hostIcon: "<svg/>", label: "  " }, true)).toBe(true);
    expect(isRuntimeBadgeHidden({ hostIcon: "<svg/>", label: "pod" }, true)).toBe(false);
    expect(isRuntimeBadgeHidden({ hostIcon: "<svg/>" }, false)).toBe(false);
    expect(isRuntimeBadgeHidden(null, true)).toBe(false);
  });
});

describe("runtime item", () => {
  it("takes no slot when its badge would draw nothing, so no separator is left beside it", () => {
    expect(kinds(select({ runtimeId: "pod", runtimeBadgeHidden: true }))).not.toContain("runtime");
  });

  it("follows the host and shows even when no host badge does", () => {
    expect(kinds(select({ runtimeId: "pod" }))).toContain("runtime");
    const items = select({ runtimeId: "pod" });
    expect(items.findIndex((item) => item.kind === "runtime")).toBe(
      items.findIndex((item) => item.kind === "host") + 1,
    );
    expect(kinds(select({ runtimeId: "pod", hasHostBadge: false }))).toContain("runtime");
  });

  it("draws nothing for a workspace on the daemon host", () => {
    expect(kinds(select({ runtimeId: undefined }))).not.toContain("runtime");
    expect(kinds(select({ runtimeId: null }))).not.toContain("runtime");
  });
});
