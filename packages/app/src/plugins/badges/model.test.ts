import { describe, expect, it } from "vitest";
import {
  agentMatchesLabels,
  dropEmptyBadges,
  resolveAgentBadges,
  validateAgentBadge,
  type RegisteredAgentBadge,
} from "./model";

const agent = (id: string, labels: Record<string, string>) => ({ id, title: id, labels });

function badge(overrides: Partial<RegisteredAgentBadge> = {}): RegisteredAgentBadge {
  return {
    key: 1,
    pluginId: "factory",
    id: "factory",
    scope: "agent",
    labels: { factory: "*" },
    icon: "Factory",
    ...overrides,
  };
}

describe("agent badge matching", () => {
  it("needs every label, and * accepts any value", () => {
    expect(agentMatchesLabels(agent("a", { factory: "x" }), { factory: "*" })).toBe(true);
    expect(agentMatchesLabels(agent("a", { factory: "x" }), { factory: "y" })).toBe(false);
    expect(agentMatchesLabels(agent("a", {}), { factory: "*" })).toBe(false);
    expect(
      agentMatchesLabels(agent("a", { factory: "x", team: "t" }), { factory: "x", team: "t" }),
    ).toBe(true);
    expect(agentMatchesLabels(agent("a", { factory: "x" }), { factory: "x", team: "t" })).toBe(
      false,
    );
  });
});

describe("resolving badges", () => {
  it("shows an agent badge on agent surfaces only", () => {
    const agents = [agent("a", { factory: "yes" })];
    expect(resolveAgentBadges([badge()], agents, "agent")).toHaveLength(1);
    expect(resolveAgentBadges([badge()], agents, "workspace-row")).toEqual([]);
  });

  it("shows a workspace-scoped badge once on a workspace row, however many agents match", () => {
    const agents = [agent("a", { factory: "1" }), agent("b", { factory: "2" })];
    const resolved = resolveAgentBadges(
      [badge({ scope: "workspace", text: (a) => `#${a.id}` })],
      agents,
      "workspace-row",
    );
    expect(resolved).toEqual([
      { key: "factory/factory", icon: "Factory", text: "#a", tooltip: null },
    ]);
  });

  it("stacks several badges and survives a throwing text function", () => {
    const resolved = resolveAgentBadges(
      [
        badge({ key: 1, id: "one" }),
        badge({
          key: 2,
          id: "two",
          text: () => {
            throw new Error("boom");
          },
          tooltip: () => " Factory agent ",
        }),
      ],
      [agent("a", { factory: "x" })],
      "agent",
    );
    expect(resolved.map((entry) => entry.key)).toEqual(["factory/one", "factory/two"]);
    expect(resolved[1]).toMatchObject({ text: null, tooltip: "Factory agent" });
  });

  it("draws nothing for agents without the labels", () => {
    expect(resolveAgentBadges([badge()], [agent("a", { other: "x" })], "agent")).toEqual([]);
  });
});

describe("badge validation", () => {
  const valid = { id: "factory", match: { labels: { factory: "*" } }, render: { icon: "Factory" } };

  it("accepts a contribution and defaults the scope to agent", () => {
    expect(validateAgentBadge(valid)).toMatchObject({ id: "factory", scope: "agent" });
  });

  it("rejects a bad id, an empty match and a non-function text", () => {
    expect(() => validateAgentBadge({ ...valid, id: "Bad Id" })).toThrow(
      "Invalid plugin agent badge id",
    );
    expect(() => validateAgentBadge({ ...valid, match: { labels: {} } })).toThrow(
      "at least one label",
    );
    expect(() =>
      validateAgentBadge({ ...valid, render: { icon: "Factory", text: "x" as never } }),
    ).toThrow("text must be a function");
  });
});

describe("dropEmptyBadges", () => {
  const resolved = (key: string, text: string | null) => ({
    key,
    icon: key,
    text,
    tooltip: null,
  });

  it("keeps a badge with text or a renderable icon and drops one that draws nothing", () => {
    const badges = [resolved("a", null), resolved("b", "label"), resolved("c", null)];
    expect(dropEmptyBadges(badges, (icon) => icon === "c").map((entry) => entry.key)).toEqual([
      "b",
      "c",
    ]);
  });
});
