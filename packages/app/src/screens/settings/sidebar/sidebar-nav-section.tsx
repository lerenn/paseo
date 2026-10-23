import { useCallback, useMemo, useState, type ComponentType, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  ArrowDown,
  ArrowUp,
  Blocks,
  CalendarClock,
  FolderMinus,
  Gauge,
  History,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  type LucideIcon,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FormTextInput } from "@/components/ui/form-field";
import { Shortcut } from "@/components/ui/shortcut";
import { Switch } from "@/components/ui/switch";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import {
  builtinSidebarNavLabelKey,
  builtinSidebarNavShortcutAction,
  type BuiltinSidebarItemId,
  type SidebarNavItem,
  type SidebarSection,
} from "@/sidebar-nav/model";
import { pluginIconComponent } from "@/plugins/icons";
import type { SidebarNavGroup } from "@/sidebar-nav/groups";
import { useSidebarNavEntries, useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedArrowDown = withUnistyles(ArrowDown);

const ThemedMoreHorizontal = withUnistyles(MoreHorizontal);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedFolderMinus = withUnistyles(FolderMinus);

const deleteIcon = <ThemedTrash2 size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;
const ungroupIcon = <ThemedFolderMinus size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;
const moveUpIcon = <ThemedArrowUp size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;
const moveDownIcon = <ThemedArrowDown size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;

const BUILTIN_ICONS: Record<BuiltinSidebarItemId, LucideIcon> = {
  "new-workspace": Plus,
  history: History,
  search: Search,
  schedules: CalendarClock,
  usage: Gauge,
};

/** Plugin items register no icon, so they share this one; a legacy `addSidebarItem` keeps its own. */
const PLUGIN_ICON = Blocks;

type NavIconComponent = ComponentType<{ size: number; color: string }>;

function NavIcon({ Icon, color = "" }: { Icon: NavIconComponent; color?: string }) {
  return <Icon size={ICON_SIZE.md} color={color} />;
}

const ThemedNavIcon = withUnistyles(NavIcon);

function navItemIcon(item: SidebarNavItem): NavIconComponent {
  if (item.kind === "builtin") return BUILTIN_ICONS[item.id];
  return item.group.kind === "legacy" ? pluginIconComponent(item.group.icon) : PLUGIN_ICON;
}

function navItemLabel(t: TFunction, item: SidebarNavItem): string {
  return item.kind === "builtin" ? t(builtinSidebarNavLabelKey(item.id)) : item.group.title;
}

/** Own component so the row can stay hook-free about which items have a shortcut. */
function NavItemShortcut({ item }: { item: SidebarNavItem }): ReactElement | null {
  const chord = useShortcutKeys(
    item.kind === "builtin" ? builtinSidebarNavShortcutAction(item.id) : null,
  );
  return chord ? <Shortcut chord={chord} /> : null;
}

interface SidebarNavRowProps {
  item: SidebarNavItem;
  isFirst: boolean;
  isLast: boolean;
  onMove: (key: string, direction: "up" | "down") => void;
  onSetVisible: (key: string, visible: boolean) => void;
  /** Header rows can sit in user groups; the footer passes nothing and gets no menu. */
  groups?: readonly SidebarNavGroup<"header">[];
  currentGroupId?: string | null;
  onMoveToGroup?: (key: string, groupId: string | null) => void;
}

function SidebarNavRow({
  item,
  isFirst,
  isLast,
  onMove,
  onSetVisible,
  groups,
  currentGroupId = null,
  onMoveToGroup,
}: SidebarNavRowProps): ReactElement {
  const { t } = useTranslation();
  const label = navItemLabel(t, item);

  const handleMoveUp = useCallback(() => onMove(item.key, "up"), [item.key, onMove]);
  const handleMoveDown = useCallback(() => onMove(item.key, "down"), [item.key, onMove]);
  const handleVisibleChange = useCallback(
    (visible: boolean) => onSetVisible(item.key, visible),
    [item.key, onSetVisible],
  );

  const rowStyle = useMemo(
    () => [
      settingsStyles.row,
      isFirst ? null : settingsStyles.rowBorder,
      styles.row,
      currentGroupId ? styles.groupedRow : null,
    ],
    [currentGroupId, isFirst],
  );

  return (
    <View style={rowStyle} testID={`sidebar-nav-item-${item.key}`}>
      <View style={styles.rowMain}>
        <ThemedNavIcon Icon={navItemIcon(item)} uniProps={mutedColorMapping} />
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {label}
        </Text>
        <NavItemShortcut item={item} />
      </View>
      <View style={styles.rowActions}>
        {groups && onMoveToGroup ? (
          <MoveToGroupMenu
            itemKey={item.key}
            label={label}
            groups={groups}
            currentGroupId={currentGroupId}
            onMoveToGroup={onMoveToGroup}
          />
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          leftIcon={moveUpIcon}
          onPress={handleMoveUp}
          disabled={isFirst}
          accessibilityLabel={t("settings.appearance.sidebar.moveUp")}
          testID={`sidebar-nav-move-up-${item.key}`}
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={moveDownIcon}
          onPress={handleMoveDown}
          disabled={isLast}
          accessibilityLabel={t("settings.appearance.sidebar.moveDown")}
          testID={`sidebar-nav-move-down-${item.key}`}
        />
        <Switch
          value={item.visible}
          onValueChange={handleVisibleChange}
          accessibilityLabel={label}
          testID={`sidebar-nav-toggle-${item.key}`}
        />
      </View>
    </View>
  );
}

const SECTION_COPY = {
  header: {
    title: "settings.appearance.sidebar.header.title",
    info: "settings.appearance.sidebar.header.description",
  },
  footer: {
    title: "settings.appearance.sidebar.footer.title",
    info: "settings.appearance.sidebar.footer.description",
  },
} as const satisfies Record<SidebarSection, { title: string; info: string }>;

const moreIcon = <ThemedMoreHorizontal size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;

interface MoveToGroupMenuProps {
  itemKey: string;
  label: string;
  groups: readonly SidebarNavGroup<"header">[];
  currentGroupId: string | null;
  onMoveToGroup: (key: string, groupId: string | null) => void;
}

function MoveToItem({
  itemKey,
  groupId,
  title,
  onMoveToGroup,
}: {
  itemKey: string;
  groupId: string | null;
  title: string | null;
  onMoveToGroup: MoveToGroupMenuProps["onMoveToGroup"];
}): ReactElement {
  const { t } = useTranslation();
  const handleSelect = useCallback(
    () => onMoveToGroup(itemKey, groupId),
    [groupId, itemKey, onMoveToGroup],
  );
  return (
    <DropdownMenuItem
      leading={groupId === null ? ungroupIcon : undefined}
      onSelect={handleSelect}
      testID={
        groupId === null
          ? `sidebar-nav-ungroup-${itemKey}`
          : `sidebar-nav-move-to-${groupId}-${itemKey}`
      }
    >
      {title === null
        ? t("settings.appearance.sidebar.groups.removeFromGroup")
        : t("settings.appearance.sidebar.groups.moveTo", { name: title })}
    </DropdownMenuItem>
  );
}

function MoveToGroupMenu({
  itemKey,
  label,
  groups,
  currentGroupId,
  onMoveToGroup,
}: MoveToGroupMenuProps): ReactElement | null {
  const { t } = useTranslation();
  const targets = groups.filter((group) => group.id !== currentGroupId);
  if (targets.length === 0 && currentGroupId === null) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel={t("settings.appearance.sidebar.groups.moveToGroup", { name: label })}
        testID={`sidebar-nav-group-menu-${itemKey}`}
      >
        {moreIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={220}>
        {currentGroupId !== null ? (
          <MoveToItem itemKey={itemKey} groupId={null} title={null} onMoveToGroup={onMoveToGroup} />
        ) : null}
        {targets.map((group) => (
          <MoveToItem
            key={group.id}
            itemKey={itemKey}
            groupId={group.id}
            title={group.title}
            onMoveToGroup={onMoveToGroup}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface SidebarNavGroupRowProps {
  group: SidebarNavGroup<"header">;
  isFirst: boolean;
  isLast: boolean;
  onMove: (key: string, direction: "up" | "down") => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

function SidebarNavGroupRow({
  group,
  isFirst,
  isLast,
  onMove,
  onRename,
  onDelete,
}: SidebarNavGroupRowProps): ReactElement {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(group.title);
  const commit = useCallback(() => {
    const title = draft.trim();
    if (title && title !== group.title) onRename(group.id, title);
    else setDraft(group.title);
  }, [draft, group.id, group.title, onRename]);
  const handleMoveUp = useCallback(() => onMove(group.key, "up"), [group.key, onMove]);
  const handleMoveDown = useCallback(() => onMove(group.key, "down"), [group.key, onMove]);
  const handleDelete = useCallback(() => onDelete(group.id), [group.id, onDelete]);
  const rowStyle = useMemo(
    () => [settingsStyles.row, isFirst ? null : settingsStyles.rowBorder, styles.row],
    [isFirst],
  );

  return (
    <View style={rowStyle} testID={`sidebar-nav-group-${group.id}`}>
      <View style={styles.rowMain}>
        <FormTextInput
          size="sm"
          initialValue={group.title}
          resetKey={group.title}
          onChangeText={setDraft}
          onBlur={commit}
          onSubmitEditing={commit}
          accessibilityLabel={t("settings.appearance.sidebar.groups.name")}
          testID={`sidebar-nav-group-name-${group.id}`}
          style={styles.groupName}
        />
      </View>
      <View style={styles.rowActions}>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={moveUpIcon}
          onPress={handleMoveUp}
          disabled={isFirst}
          accessibilityLabel={t("settings.appearance.sidebar.moveUp")}
          testID={`sidebar-nav-move-up-${group.key}`}
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={moveDownIcon}
          onPress={handleMoveDown}
          disabled={isLast}
          accessibilityLabel={t("settings.appearance.sidebar.moveDown")}
          testID={`sidebar-nav-move-down-${group.key}`}
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={deleteIcon}
          onPress={handleDelete}
          accessibilityLabel={t("settings.appearance.sidebar.groups.delete", { name: group.title })}
          testID={`sidebar-nav-group-delete-${group.id}`}
        />
      </View>
    </View>
  );
}

function NewGroupRow({ onCreate }: { onCreate: (title: string) => void }): ReactElement {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const handleCreate = useCallback(() => {
    if (!title.trim()) return;
    onCreate(title);
    setTitle("");
    setResetKey((key) => key + 1);
  }, [onCreate, title]);
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder, styles.row]}>
      <View style={styles.rowMain}>
        <FormTextInput
          size="sm"
          initialValue=""
          resetKey={resetKey}
          onChangeText={setTitle}
          onSubmitEditing={handleCreate}
          placeholder={t("settings.appearance.sidebar.groups.newPlaceholder")}
          accessibilityLabel={t("settings.appearance.sidebar.groups.newPlaceholder")}
          testID="sidebar-nav-new-group-name"
          style={styles.groupName}
        />
      </View>
      <Button
        variant="secondary"
        size="sm"
        onPress={handleCreate}
        disabled={!title.trim()}
        testID="sidebar-nav-new-group"
      >
        {t("settings.appearance.sidebar.groups.add")}
      </Button>
    </View>
  );
}

function HeaderItemsCard(): ReactElement {
  const { t } = useTranslation();
  const { entries, setVisible, move, moveToGroup, createGroup, renameGroup, deleteGroup } =
    useSidebarNavEntries();
  const groups = useMemo(
    () => entries.filter((entry): entry is SidebarNavGroup<"header"> => entry.kind === "group"),
    [entries],
  );

  return (
    <SettingsSection
      title={t(SECTION_COPY.header.title)}
      info={t(SECTION_COPY.header.info)}
      testID="sidebar-nav-section-header"
    >
      <View style={settingsStyles.card}>
        {entries.map((entry, index) => {
          if (entry.kind === "group") {
            return (
              <View key={entry.key}>
                <SidebarNavGroupRow
                  group={entry}
                  isFirst={index === 0}
                  isLast={index === entries.length - 1}
                  onMove={move}
                  onRename={renameGroup}
                  onDelete={deleteGroup}
                />
                {entry.items.map((item, itemIndex) => (
                  <SidebarNavRow
                    key={item.key}
                    item={item}
                    isFirst={false}
                    isLast={itemIndex === entry.items.length - 1}
                    onMove={move}
                    onSetVisible={setVisible}
                    groups={groups}
                    currentGroupId={entry.id}
                    onMoveToGroup={moveToGroup}
                  />
                ))}
              </View>
            );
          }
          return (
            <SidebarNavRow
              key={entry.key}
              item={entry}
              isFirst={index === 0}
              isLast={index === entries.length - 1}
              onMove={move}
              onSetVisible={setVisible}
              groups={groups}
              currentGroupId={null}
              onMoveToGroup={moveToGroup}
            />
          );
        })}
        <NewGroupRow onCreate={createGroup} />
      </View>
    </SettingsSection>
  );
}

function SidebarItemsCard({ section }: { section: SidebarSection }): ReactElement {
  const { t } = useTranslation();
  const { items, setVisible, move } = useSidebarNavItems(section);

  return (
    <SettingsSection
      title={t(SECTION_COPY[section].title)}
      info={t(SECTION_COPY[section].info)}
      testID={`sidebar-nav-section-${section}`}
    >
      <View style={settingsStyles.card}>
        {items.map((item, index) => (
          <SidebarNavRow
            key={item.key}
            item={item}
            isFirst={index === 0}
            isLast={index === items.length - 1}
            onMove={move}
            onSetVisible={setVisible}
          />
        ))}
      </View>
    </SettingsSection>
  );
}

/** Settings > Sidebar: one card per section. The footer's bottom line is fixed and not listed. */
export function SidebarNavSection(): ReactElement {
  return (
    <>
      <HeaderItemsCard />
      <SidebarItemsCard section="footer" />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    gap: theme.spacing[2],
  },
  groupedRow: {
    paddingLeft: theme.spacing[6],
  },
  groupName: {
    flex: 1,
    minWidth: 0,
  },
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));
