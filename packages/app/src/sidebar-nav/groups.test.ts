import { describe, expect, it } from "vitest";
import type { PluginSidebarGroup } from "@/plugins/sidebar-groups";
import {
  createGroupEntry,
  deleteGroupEntry,
  moveEntry,
  moveItemToGroup,
  renameGroupEntry,
  resolveSidebarNavEntries,
  serializeSidebarNavEntries,
  setEntryItemVisible,
  setGroupCollapsedEntry,
  type SidebarNavEntry,
  type SidebarNavGroupPreference,
} from "./groups";
import { pluginSidebarNavKey, type SidebarNavPreference } from "./model";

function plugin(pluginId: string, contributionId: string, group?: string): PluginSidebarGroup {
  return {
    kind: "item",
    key: `${pluginId}/sidebar/${contributionId}`,
    pluginId,
    contributionId,
    title: contributionId,
    group,
    targets: [],
  };
}

const roles = plugin("roles", "roles", "Agents");
const inbox = plugin("inbox", "inbox", "agents");
const tickets = plugin("tickets", "dispatcher");
const rolesKey = pluginSidebarNavKey(roles);
const inboxKey = pluginSidebarNavKey(inbox);
const ticketsKey = pluginSidebarNavKey(tickets);

function shape(entries: readonly SidebarNavEntry[]): unknown[] {
  return entries.map((entry) =>
    entry.kind === "group" ? { [entry.id]: entry.items.map((item) => item.key) } : entry.key,
  );
}

function resolve(
  preferences: SidebarNavPreference[] = [],
  groups: SidebarNavGroupPreference[] = [],
  pluginGroups: PluginSidebarGroup[] = [tickets],
) {
  return resolveSidebarNavEntries({ pluginGroups, preferences, groups });
}

const DEFAULT_ORDER = ["new-workspace", "history", "search", "schedules"];

describe("resolveSidebarNavEntries", () => {
  it("is the flat default list when nothing is stored", () => {
    expect(shape(resolve())).toEqual([...DEFAULT_ORDER, ticketsKey]);
  });

  it("nests rows under the group they carry, at the group's marker position", () => {
    const entries = resolve(
      [
        { key: "new-workspace", visible: true },
        { key: "group:g1", visible: true },
        { key: "schedules", visible: true, group: "g1" },
        { key: ticketsKey, visible: false, group: "g1" },
        { key: "history", visible: true },
      ],
      [{ id: "g1", title: "Agents", collapsed: true }],
    );

    expect(shape(entries)).toEqual([
      "new-workspace",
      { g1: ["schedules", ticketsKey] },
      "history",
      "search",
    ]);
    expect(entries[1]).toMatchObject({ kind: "group", title: "Agents", collapsed: true });
    expect((entries[1] as { items: { visible: boolean }[] }).items[1]?.visible).toBe(false);
  });

  it("leaves rows at the top level when their group no longer exists", () => {
    const entries = resolve([
      { key: "schedules", visible: true, group: "gone" },
      { key: "group:gone", visible: true },
    ]);

    expect(shape(entries)).toEqual(["schedules", "new-workspace", "history", "search", ticketsKey]);
  });

  it("appends a defined group that has no marker", () => {
    const entries = resolve([], [{ id: "g1", title: "Empty", collapsed: false }]);

    expect(shape(entries)).toEqual([...DEFAULT_ORDER, ticketsKey, { g1: [] }]);
  });

  it("places an unplaced plugin row in the group its hint names, creating the group once", () => {
    const entries = resolve([], [], [roles, inbox, tickets]);

    expect(shape(entries)).toEqual([
      ...DEFAULT_ORDER,
      { "hint:agents": [rolesKey, inboxKey] },
      ticketsKey,
    ]);
    expect(entries[4]).toMatchObject({ title: "Agents", collapsed: false });
  });

  it("matches the hint to an existing group by title, ignoring case", () => {
    const entries = resolve(
      [{ key: "group:g1", visible: true }],
      [{ id: "g1", title: "AGENTS", collapsed: true }],
      [roles],
    );

    expect(shape(entries)).toEqual([{ g1: [rolesKey] }, ...DEFAULT_ORDER]);
  });

  it("ignores the hint once the user has placed the row", () => {
    const entries = resolve([{ key: rolesKey, visible: true }], [], [roles]);

    expect(shape(entries)).toEqual([rolesKey, ...DEFAULT_ORDER]);
  });
});

describe("serializeSidebarNavEntries", () => {
  it("round-trips groups, markers and per-row group ids", () => {
    const entries = resolve([], [], [roles, tickets]);
    const state = serializeSidebarNavEntries(entries, []);

    expect(state.groups).toEqual([{ id: "hint:agents", title: "Agents", collapsed: false }]);
    expect(state.preferences).toContainEqual({ key: "group:hint:agents", visible: true });
    expect(state.preferences).toContainEqual({
      key: rolesKey,
      visible: true,
      group: "hint:agents",
    });
    expect(shape(resolve(state.preferences, state.groups, [roles, tickets]))).toEqual(
      shape(entries),
    );
  });

  it("keeps unavailable rows with their group after the available ones", () => {
    const entries = resolve([], [{ id: "g1", title: "Agents", collapsed: false }], []);
    const state = serializeSidebarNavEntries(entries, [
      { key: "plugin:away:row", visible: false, group: "g1" },
      { key: "plugin:away:other", visible: true, group: "missing" },
    ]);

    expect(state.preferences.slice(-2)).toEqual([
      { key: "plugin:away:row", visible: false, group: "g1" },
      { key: "plugin:away:other", visible: true },
    ]);
  });
});

describe("group edits", () => {
  const base = () =>
    createGroupEntry(createGroupEntry(resolve(), { id: "g1", title: "  Agents " }), {
      id: "g2",
      title: "Other",
    });

  it("creates trimmed groups at the end and ignores empty names", () => {
    expect(shape(base())).toEqual([...DEFAULT_ORDER, ticketsKey, { g1: [] }, { g2: [] }]);
    expect(base()[5]).toMatchObject({ title: "Agents" });
    expect(createGroupEntry(base(), { id: "g3", title: "  " })).toHaveLength(7);
  });

  it("moves a row into a group, between groups, and back out after its group", () => {
    let entries = moveItemToGroup(base(), "schedules", "g1");
    expect(shape(entries)).toEqual([
      "new-workspace",
      "history",
      "search",
      ticketsKey,
      { g1: ["schedules"] },
      { g2: [] },
    ]);

    entries = moveItemToGroup(entries, ticketsKey, "g1");
    entries = moveItemToGroup(entries, "schedules", "g2");
    expect(shape(entries)).toEqual([
      "new-workspace",
      "history",
      "search",
      { g1: [ticketsKey] },
      { g2: ["schedules"] },
    ]);

    entries = moveItemToGroup(entries, "schedules", null);
    expect(shape(entries)).toEqual([
      "new-workspace",
      "history",
      "search",
      { g1: [ticketsKey] },
      { g2: [] },
      "schedules",
    ]);
  });

  it("moves top-level entries among siblings and grouped rows within their group", () => {
    let entries = moveItemToGroup(moveItemToGroup(base(), "schedules", "g1"), "search", "g1");
    entries = moveEntry(entries, "search", "up");
    expect(shape(entries).at(-2)).toEqual({ g1: ["search", "schedules"] });

    entries = moveEntry(entries, "group:g2", "up");
    expect(shape(entries).slice(-2)).toEqual([{ g2: [] }, { g1: ["search", "schedules"] }]);

    expect(shape(moveEntry(entries, "new-workspace", "up"))).toEqual(shape(entries));
  });

  it("renames, collapses and deletes a group, keeping its rows in place", () => {
    let entries = moveItemToGroup(base(), "schedules", "g1");
    entries = renameGroupEntry(entries, "g1", " Fleet ");
    entries = setGroupCollapsedEntry(entries, "g1", true);
    expect(entries.find((entry) => entry.key === "group:g1")).toMatchObject({
      title: "Fleet",
      collapsed: true,
    });
    expect(renameGroupEntry(entries, "g1", " ")).toEqual(entries);

    expect(shape(deleteGroupEntry(entries, "g1"))).toEqual([
      "new-workspace",
      "history",
      "search",
      ticketsKey,
      "schedules",
      { g2: [] },
    ]);
  });

  it("hides a row inside a group", () => {
    const entries = setEntryItemVisible(
      moveItemToGroup(base(), "schedules", "g1"),
      "schedules",
      false,
    );
    const group = entries.find((entry) => entry.key === "group:g1");

    expect(group?.kind === "group" && group.items[0]?.visible).toBe(false);
  });
});
