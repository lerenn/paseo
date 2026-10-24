import type { PluginSidebarGroup } from "@/plugins/sidebar-groups";
import {
  isBuiltinSidebarItemId,
  BUILTIN_SIDEBAR_ITEM_IDS,
  pluginSidebarNavKey,
  type SidebarNavItem,
  type SidebarNavPreference,
  type SidebarSection,
} from "./model";

/**
 * User-defined groups of the header rows. The group definitions are stored apart from the row
 * order: a group's place in `sidebarNavItems` is a `group:<id>` marker entry, and each row that
 * sits in a group carries that group's id. Stored preferences without groups resolve to a flat
 * list, and a group id that no longer exists leaves its rows at the top level.
 */
export interface SidebarNavGroupPreference {
  id: string;
  title: string;
  collapsed: boolean;
}

export interface SidebarNavGroup<Section extends SidebarSection = SidebarSection> {
  kind: "group";
  /** `group:<id>`, the marker key in the stored order. */
  key: string;
  id: string;
  title: string;
  collapsed: boolean;
  items: SidebarNavItem<Section>[];
}

export type SidebarNavEntry<Section extends SidebarSection = SidebarSection> =
  | SidebarNavItem<Section>
  | SidebarNavGroup<Section>;

export interface SidebarNavState {
  preferences: SidebarNavPreference[];
  groups: SidebarNavGroupPreference[];
}

const GROUP_KEY_PREFIX = "group:";

export function sidebarNavGroupKey(id: string): string {
  return `${GROUP_KEY_PREFIX}${id}`;
}

function groupIdFromKey(key: string): string | null {
  return key.startsWith(GROUP_KEY_PREFIX) ? key.slice(GROUP_KEY_PREFIX.length) : null;
}

type Slot =
  | { type: "item"; item: SidebarNavItem; groupId: string | undefined }
  | { type: "group"; id: string };

/**
 * The header rows as the sidebar and Settings show them: top-level rows and groups in order,
 * each group holding its rows. A plugin row the user has not placed yet lands at the top level.
 */
export function resolveSidebarNavEntries(input: {
  pluginGroups: readonly PluginSidebarGroup[];
  preferences: readonly SidebarNavPreference[];
  groups: readonly SidebarNavGroupPreference[];
}): SidebarNavEntry<"header">[] {
  const section = "header";
  const definitions = new Map<string, SidebarNavGroupPreference>();
  for (const group of input.groups) {
    if (!definitions.has(group.id)) definitions.set(group.id, group);
  }
  const pluginByKey = new Map(
    input.pluginGroups.map((group) => [pluginSidebarNavKey(group), group] as const),
  );
  const slots: Slot[] = [];
  const placed = new Set<string>();
  const markers = new Set<string>();

  for (const preference of input.preferences) {
    const markerId = groupIdFromKey(preference.key);
    if (markerId !== null) {
      if (definitions.has(markerId) && !markers.has(markerId)) {
        markers.add(markerId);
        slots.push({ type: "group", id: markerId });
      }
      continue;
    }
    if (placed.has(preference.key)) continue;
    const groupId =
      preference.group !== undefined && definitions.has(preference.group)
        ? preference.group
        : undefined;
    const plugin = pluginByKey.get(preference.key);
    if (plugin) {
      placed.add(preference.key);
      slots.push({
        type: "item",
        groupId,
        item: { kind: "plugin", key: preference.key, group: plugin, visible: preference.visible },
      });
    } else if (isBuiltinSidebarItemId(section, preference.key)) {
      placed.add(preference.key);
      slots.push({
        type: "item",
        groupId,
        item: {
          kind: "builtin",
          key: preference.key,
          id: preference.key,
          visible: preference.visible,
        },
      });
    }
  }

  for (const id of BUILTIN_SIDEBAR_ITEM_IDS[section]) {
    if (placed.has(id)) continue;
    slots.push({
      type: "item",
      groupId: undefined,
      item: { kind: "builtin", key: id, id, visible: true },
    });
  }

  for (const [key, plugin] of pluginByKey) {
    if (placed.has(key)) continue;
    slots.push({
      type: "item",
      groupId: undefined,
      item: { kind: "plugin", key, group: plugin, visible: true },
    });
  }

  return assembleEntries(slots, definitions);
}

function assembleEntries(
  slots: readonly Slot[],
  definitions: ReadonlyMap<string, SidebarNavGroupPreference>,
): SidebarNavEntry<"header">[] {
  const byGroup = new Map<string, SidebarNavGroup<"header">>();
  for (const slot of slots) {
    if (slot.type !== "group") continue;
    const definition = definitions.get(slot.id)!;
    const group: SidebarNavGroup<"header"> = {
      kind: "group",
      key: sidebarNavGroupKey(slot.id),
      id: slot.id,
      title: definition.title,
      collapsed: definition.collapsed,
      items: [],
    };
    byGroup.set(slot.id, group);
  }
  // Groups sit where their marker is, rows at their own position or inside their group.
  const ordered: SidebarNavEntry<"header">[] = [];
  for (const slot of slots) {
    if (slot.type === "group") {
      ordered.push(byGroup.get(slot.id)!);
    } else if (slot.groupId !== undefined) {
      byGroup.get(slot.groupId)?.items.push(slot.item as SidebarNavItem<"header">);
    } else {
      ordered.push(slot.item as SidebarNavItem<"header">);
    }
  }
  // Defined groups with no marker (an edited store) trail the list.
  for (const definition of definitions.values()) {
    if (byGroup.has(definition.id)) continue;
    ordered.push({
      kind: "group",
      key: sidebarNavGroupKey(definition.id),
      id: definition.id,
      title: definition.title,
      collapsed: definition.collapsed,
      items: [],
    });
  }
  return ordered;
}

/**
 * Entries back to storable state. Rows that are not available right now (a disconnected plugin)
 * follow, so an unrelated edit does not erase their place or group.
 */
export function serializeSidebarNavEntries(
  entries: readonly SidebarNavEntry[],
  previous: readonly SidebarNavPreference[],
): SidebarNavState {
  const preferences: SidebarNavPreference[] = [];
  const groups: SidebarNavGroupPreference[] = [];
  const available = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === "group") {
      groups.push({ id: entry.id, title: entry.title, collapsed: entry.collapsed });
      preferences.push({ key: entry.key, visible: true });
      for (const item of entry.items) {
        available.add(item.key);
        preferences.push({ key: item.key, visible: item.visible, group: entry.id });
      }
    } else {
      available.add(entry.key);
      preferences.push({ key: entry.key, visible: entry.visible });
    }
  }
  const groupIds = new Set(groups.map((group) => group.id));
  for (const preference of previous) {
    if (groupIdFromKey(preference.key) !== null || available.has(preference.key)) continue;
    available.add(preference.key);
    const group =
      preference.group !== undefined && groupIds.has(preference.group)
        ? preference.group
        : undefined;
    preferences.push({
      key: preference.key,
      visible: preference.visible,
      ...(group ? { group } : {}),
    });
  }
  return { preferences, groups };
}

function mapItems(
  entries: readonly SidebarNavEntry[],
  fn: (item: SidebarNavItem) => SidebarNavItem,
): SidebarNavEntry[] {
  return entries.map((entry) =>
    entry.kind === "group" ? { ...entry, items: entry.items.map(fn) } : fn(entry),
  );
}

export function setEntryItemVisible(
  entries: readonly SidebarNavEntry[],
  key: string,
  visible: boolean,
): SidebarNavEntry[] {
  return mapItems(entries, (item) => (item.key === key ? { ...item, visible } : item));
}

function swap<T>(list: readonly T[], from: number, direction: "up" | "down"): T[] {
  const to = direction === "up" ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Moves a top-level row or group among its siblings, or a grouped row within its group. */
export function moveEntry(
  entries: readonly SidebarNavEntry[],
  key: string,
  direction: "up" | "down",
): SidebarNavEntry[] {
  const topIndex = entries.findIndex((entry) => entry.key === key);
  if (topIndex !== -1) return swap(entries, topIndex, direction);
  return entries.map((entry) => {
    if (entry.kind !== "group") return entry;
    const index = entry.items.findIndex((item) => item.key === key);
    return index === -1 ? entry : { ...entry, items: swap(entry.items, index, direction) };
  });
}

/** Puts a row at the end of a group, or at the top level right after the group it leaves. */
export function moveItemToGroup(
  entries: readonly SidebarNavEntry[],
  key: string,
  groupId: string | null,
): SidebarNavEntry[] {
  let moved: SidebarNavItem | undefined;
  let insertAfter = -1;
  const without: SidebarNavEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === "group") {
      const item = entry.items.find((candidate) => candidate.key === key);
      if (item) {
        moved = item;
        insertAfter = without.length;
        without.push({ ...entry, items: entry.items.filter((candidate) => candidate !== item) });
        continue;
      }
    } else if (entry.key === key) {
      moved = entry;
      continue;
    }
    without.push(entry);
  }
  if (!moved) return [...entries];
  const item = moved;
  if (groupId === null) {
    const at = insertAfter === -1 ? without.length : insertAfter + 1;
    return [...without.slice(0, at), item, ...without.slice(at)];
  }
  const result: SidebarNavEntry[] = [];
  for (const entry of without) {
    const target = entry.kind === "group" && entry.id === groupId;
    result.push(target ? { ...entry, items: [...entry.items, item] } : entry);
  }
  return result;
}

export function createGroupEntry(
  entries: readonly SidebarNavEntry[],
  input: { id: string; title: string },
): SidebarNavEntry[] {
  const title = input.title.trim();
  if (!title) return [...entries];
  return [
    ...entries,
    {
      kind: "group",
      key: sidebarNavGroupKey(input.id),
      id: input.id,
      title,
      collapsed: false,
      items: [],
    },
  ];
}

export function renameGroupEntry(
  entries: readonly SidebarNavEntry[],
  id: string,
  title: string,
): SidebarNavEntry[] {
  const next = title.trim();
  if (!next) return [...entries];
  return entries.map((entry) =>
    entry.kind === "group" && entry.id === id ? { ...entry, title: next } : entry,
  );
}

export function setGroupCollapsedEntry(
  entries: readonly SidebarNavEntry[],
  id: string,
  collapsed: boolean,
): SidebarNavEntry[] {
  return entries.map((entry) =>
    entry.kind === "group" && entry.id === id ? { ...entry, collapsed } : entry,
  );
}

/** Deleting a group keeps its rows, in place at the top level. */
export function deleteGroupEntry(
  entries: readonly SidebarNavEntry[],
  id: string,
): SidebarNavEntry[] {
  return entries.flatMap((entry) =>
    entry.kind === "group" && entry.id === id ? entry.items : [entry],
  );
}
