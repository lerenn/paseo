import { useCallback, useMemo } from "react";
import { useAppSettings } from "@/hooks/use-settings";
import type { AppSettings } from "@/hooks/use-settings/storage";
import { useInstalledPlugins } from "@/plugins/registry";
import { groupPluginSidebarItems } from "@/plugins/sidebar-groups";
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
} from "./groups";
import {
  moveSidebarNavItem,
  resolveSidebarNavItems,
  setSidebarNavItemVisible,
  type SidebarNavItem,
  type SidebarSection,
} from "./model";

const PREFERENCE_FIELDS = {
  header: "sidebarNavItems",
  footer: "sidebarFooterItems",
} as const satisfies Record<SidebarSection, keyof AppSettings>;

export interface UseSidebarNavItemsReturn<Section extends SidebarSection> {
  /** Every item in the section in display order, hidden ones included. */
  items: SidebarNavItem<Section>[];
  setVisible: (key: string, visible: boolean) => void;
  move: (key: string, direction: "up" | "down") => void;
}

export function useSidebarNavItems<Section extends SidebarSection>(
  section: Section,
): UseSidebarNavItemsReturn<Section> {
  const plugins = useInstalledPlugins();
  const { settings, updateSettings } = useAppSettings();
  const field = PREFERENCE_FIELDS[section];
  const preferences = settings[field];
  const pluginGroups = useMemo(() => groupPluginSidebarItems(plugins, section), [plugins, section]);

  const items = useMemo(
    () => resolveSidebarNavItems({ section, pluginGroups, preferences }),
    [pluginGroups, preferences, section],
  );

  const setVisible = useCallback(
    (key: string, visible: boolean) => {
      void updateSettings((current) => {
        const previous = current[field];
        const currentItems = resolveSidebarNavItems({
          section,
          pluginGroups,
          preferences: previous,
        });
        return {
          [field]: setSidebarNavItemVisible({ items: currentItems, key, visible, previous }),
        };
      });
    },
    [field, pluginGroups, section, updateSettings],
  );

  const move = useCallback(
    (key: string, direction: "up" | "down") => {
      void updateSettings((current) => {
        const previous = current[field];
        const currentItems = resolveSidebarNavItems({
          section,
          pluginGroups,
          preferences: previous,
        });
        return {
          [field]: moveSidebarNavItem({ items: currentItems, key, direction, previous }),
        };
      });
    },
    [field, pluginGroups, section, updateSettings],
  );

  return { items, setVisible, move };
}

export interface UseSidebarNavEntriesReturn {
  /** The header's top-level rows and groups in display order, hidden rows included. */
  entries: SidebarNavEntry<"header">[];
  setVisible: (key: string, visible: boolean) => void;
  /** Moves a top-level row or group, or a row inside its group. */
  move: (key: string, direction: "up" | "down") => void;
  /** Puts a row at the end of a group, or back at the top level when `groupId` is null. */
  moveToGroup: (key: string, groupId: string | null) => void;
  createGroup: (title: string) => void;
  renameGroup: (id: string, title: string) => void;
  deleteGroup: (id: string) => void;
  setGroupCollapsed: (id: string, collapsed: boolean) => void;
}

function newGroupId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** The header section with user groups. The footer has none and uses `useSidebarNavItems`. */
export function useSidebarNavEntries(): UseSidebarNavEntriesReturn {
  const plugins = useInstalledPlugins();
  const { settings, updateSettings } = useAppSettings();
  const preferences = settings.sidebarNavItems;
  const groups = settings.sidebarNavGroups;
  const pluginGroups = useMemo(() => groupPluginSidebarItems(plugins, "header"), [plugins]);

  const entries = useMemo(
    () => resolveSidebarNavEntries({ pluginGroups, preferences, groups }),
    [groups, pluginGroups, preferences],
  );

  const edit = useCallback(
    (change: (entries: readonly SidebarNavEntry[]) => SidebarNavEntry[]) => {
      void updateSettings((current) => {
        const resolved = resolveSidebarNavEntries({
          pluginGroups,
          preferences: current.sidebarNavItems,
          groups: current.sidebarNavGroups,
        });
        const next = serializeSidebarNavEntries(change(resolved), current.sidebarNavItems);
        return { sidebarNavItems: next.preferences, sidebarNavGroups: next.groups };
      });
    },
    [pluginGroups, updateSettings],
  );

  const setVisible = useCallback(
    (key: string, visible: boolean) =>
      edit((current) => setEntryItemVisible(current, key, visible)),
    [edit],
  );
  const move = useCallback(
    (key: string, direction: "up" | "down") =>
      edit((current) => moveEntry(current, key, direction)),
    [edit],
  );
  const moveToGroup = useCallback(
    (key: string, groupId: string | null) =>
      edit((current) => moveItemToGroup(current, key, groupId)),
    [edit],
  );
  const createGroup = useCallback(
    (title: string) => edit((current) => createGroupEntry(current, { id: newGroupId(), title })),
    [edit],
  );
  const renameGroup = useCallback(
    (id: string, title: string) => edit((current) => renameGroupEntry(current, id, title)),
    [edit],
  );
  const deleteGroup = useCallback(
    (id: string) => edit((current) => deleteGroupEntry(current, id)),
    [edit],
  );
  const setGroupCollapsed = useCallback(
    (id: string, collapsed: boolean) =>
      edit((current) => setGroupCollapsedEntry(current, id, collapsed)),
    [edit],
  );

  return {
    entries,
    setVisible,
    move,
    moveToGroup,
    createGroup,
    renameGroup,
    deleteGroup,
    setGroupCollapsed,
  };
}
