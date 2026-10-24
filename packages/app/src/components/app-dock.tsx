import { Maximize2, Minimize2, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { scheduleOnRN } from "react-native-worklets";
import { SidebarResizeHandle } from "@/components/sidebar-resize-handle";
import {
  SIDEBAR_RESIZE_ACTIVATION_OFFSET,
  SIDEBAR_RESIZE_FAIL_OFFSET,
} from "@/components/sidebar-resize-handle-layout";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { Button } from "@/components/ui/button";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { AppPluginPanel } from "@/plugins/app-panels/panel";
import { useInstalledPlugins } from "@/plugins/registry";
import type { Theme } from "@/styles/theme";
import { WindowChromeRegion, WindowChromeSafeArea } from "@/utils/desktop-window";
import {
  APP_DOCK_MIN_WIDTH,
  isSameAppDockPanel,
  useAppDockStore,
  type AppDockPanel,
} from "@/stores/app-dock-store";

/** The dock never takes the last of the room: the content beside it keeps this much. */
const MIN_CONTENT_WIDTH = 360;

function resolveAppDockWidth(input: { requestedWidth: number; viewportWidth: number }) {
  "worklet";
  const room = Math.max(APP_DOCK_MIN_WIDTH, input.viewportWidth - MIN_CONTENT_WIDTH);
  return Math.max(APP_DOCK_MIN_WIDTH, Math.min(room, input.requestedWidth));
}

const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedX = withUnistyles(X, mutedIcon);
const ThemedMaximize = withUnistyles(Maximize2, mutedIcon);
const ThemedMinimize = withUnistyles(Minimize2, mutedIcon);

/**
 * The app dock: a plugin panel docked to the far right that belongs to the app, not a workspace.
 * Wide layouts reserve its width beside the content; compact layouts cover the content.
 */
export function AppDock({ placement }: { placement: "beside-content" | "over-content" }) {
  const open = useAppDockStore((state) => state.open);
  const panel = useAppDockStore((state) => state.panel);
  const compact = useIsCompactFormFactor();
  if (!open || !panel || compact !== (placement === "over-content")) return null;
  return compact ? <CompactAppDock panel={panel} /> : <WideAppDock panel={panel} />;
}

type DockPanel = AppDockPanel;

interface DockTab extends AppDockPanel {
  title: string;
}

/** Every app panel of every installed plugin is a tab, in installation order. */
function useDockTabs(): DockTab[] {
  const plugins = useInstalledPlugins();
  return useMemo(
    () =>
      plugins.flatMap((plugin) =>
        plugin.appPanels.map((panel) => ({
          serverId: plugin.serverId,
          pluginId: plugin.id,
          panelId: panel.id,
          title: plugin.i18n.resolve(panel.title, plugin.locale),
        })),
      ),
    [plugins],
  );
}

function DockTabButton({ tab, selected }: { tab: DockTab; selected: boolean }) {
  const show = useAppDockStore((state) => state.show);
  const handlePress = useCallback(() => show(tab), [show, tab]);
  const state = useMemo(() => ({ selected }), [selected]);
  return (
    <Button
      variant={selected ? "secondary" : "ghost"}
      size="sm"
      accessibilityRole="tab"
      accessibilityState={state}
      onPress={handlePress}
      testID={`app-dock-tab-${tab.pluginId}-${tab.panelId}`}
    >
      {tab.title}
    </Button>
  );
}

function DockHeader({ panel, compact }: { panel: DockPanel; compact: boolean }) {
  const tabs = useDockTabs();
  const close = useAppDockStore((state) => state.close);
  const maximized = useAppDockStore((state) => state.maximized);
  const toggleMaximized = useAppDockStore((state) => state.toggleMaximized);
  const MaximizeIcon = maximized ? ThemedMinimize : ThemedMaximize;
  return (
    <WindowChromeSafeArea placement="inline" style={styles.headerFrame}>
      <TitlebarDragRegion />
      <View style={styles.header}>
        <View style={styles.tabs} accessibilityRole="tablist">
          {tabs.map((tab) => (
            <DockTabButton
              key={`${tab.serverId}/${tab.pluginId}/${tab.panelId}`}
              tab={tab}
              selected={isSameAppDockPanel(panel, tab)}
            />
          ))}
        </View>
        {compact ? null : (
          <ToolbarButton
            label={maximized ? "Restore" : "Maximize"}
            onPress={toggleMaximized}
            testID="app-dock-maximize"
          >
            <MaximizeIcon size={16} />
          </ToolbarButton>
        )}
        <ToolbarButton label="Close" onPress={close} testID="app-dock-close">
          <ThemedX size={16} />
        </ToolbarButton>
      </View>
    </WindowChromeSafeArea>
  );
}

function DockBody({ panel }: { panel: DockPanel }) {
  return (
    <View style={styles.body}>
      <AppPluginPanel serverId={panel.serverId} pluginId={panel.pluginId} panelId={panel.panelId} />
    </View>
  );
}

function CompactAppDock({ panel }: { panel: DockPanel }) {
  const insets = useSafeAreaInsets();
  const style = useMemo(
    () => [styles.compactOverlay, { paddingTop: insets.top, paddingBottom: insets.bottom }],
    [insets.bottom, insets.top],
  );
  return (
    // The overlay covers the whole window, so the dock owns both corners of the title bar.
    <WindowChromeRegion corners="both">
      <View style={style} testID="app-dock-compact">
        <DockHeader panel={panel} compact />
        <DockBody panel={panel} />
      </View>
    </WindowChromeRegion>
  );
}

function WideAppDock({ panel }: { panel: DockPanel }) {
  const requestedWidth = useAppDockStore((state) => state.width);
  const resize = useAppDockStore((state) => state.resize);
  const { width: viewportWidth } = useWindowDimensions();
  const visibleWidth = resolveAppDockWidth({ requestedWidth, viewportWidth });

  const startWidthRef = useRef(visibleWidth);
  const dragWidth = useSharedValue(visibleWidth);
  const [pressed, setPressed] = useState(false);
  const showGrip = useCallback(() => setPressed(true), []);
  const hideGrip = useCallback(() => setPressed(false), []);

  useEffect(() => {
    dragWidth.value = visibleWidth;
  }, [dragWidth, visibleWidth]);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .hitSlop({ left: 8, right: 8, top: 0, bottom: 0 })
        .onBegin(() => {
          scheduleOnRN(showGrip);
        })
        .activeOffsetX([-SIDEBAR_RESIZE_ACTIVATION_OFFSET, SIDEBAR_RESIZE_ACTIVATION_OFFSET])
        .failOffsetY([-SIDEBAR_RESIZE_FAIL_OFFSET, SIDEBAR_RESIZE_FAIL_OFFSET])
        .onStart((event) => {
          startWidthRef.current = visibleWidth + event.translationX;
          dragWidth.value = visibleWidth;
        })
        .onUpdate((event) => {
          // The handle is the left edge: dragging left (negative translationX) widens the dock.
          dragWidth.value = resolveAppDockWidth({
            requestedWidth: startWidthRef.current - event.translationX,
            viewportWidth,
          });
        })
        .onEnd(() => {
          runOnJS(resize)(dragWidth.value);
        })
        .onFinalize(() => {
          scheduleOnRN(hideGrip);
        }),
    [dragWidth, hideGrip, resize, showGrip, viewportWidth, visibleWidth],
  );
  const maximized = useAppDockStore((state) => state.maximized);
  const animatedStyle = useAnimatedStyle(() => ({ width: dragWidth.value }));
  const style = useMemo(
    () => (maximized ? staticStyles.dockMaximized : [staticStyles.dock, animatedStyle]),
    [animatedStyle, maximized],
  );

  return (
    <Animated.View style={style} testID="app-dock">
      <View style={styles.dockFrame}>
        {/* The dock is the rightmost surface, so the window's right-hand controls are over it. */}
        <WindowChromeRegion corners="top-right">
          <DockHeader panel={panel} compact={false} />
        </WindowChromeRegion>
        <DockBody panel={panel} />
        <SidebarResizeHandle
          edge="left"
          gesture={gesture}
          pressed={pressed}
          testID="app-dock-resize-handle"
        />
      </View>
    </Animated.View>
  );
}

// Animated.Views take static styles: Unistyles dynamic themes crash against Reanimated nodes.
const staticStyles = {
  dock: { flexShrink: 0 },
  // Beats the content's flex: 1 by orders of magnitude, so the content keeps a sliver.
  dockMaximized: { flexGrow: 1000, flexShrink: 1, flexBasis: 0 },
} as const;

const styles = StyleSheet.create((theme) => ({
  dockFrame: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
  },
  compactOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: theme.colors.surface0,
  },
  headerFrame: {
    position: "relative",
    flexShrink: 0,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  tabs: { flex: 1, flexDirection: "row", gap: theme.spacing[1], minWidth: 0 },
  body: { flex: 1 },
}));
