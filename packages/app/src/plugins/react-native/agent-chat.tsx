import type { AgentChatProps } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { WorkspaceComposerEditingSessionsProvider } from "@/composer/editing-session";
import { AgentConversationPanel } from "@/panels/agent-panel";
import {
  createPaneFocusContextValue,
  PaneFocusProvider,
  PaneProvider,
  type PaneContextValue,
} from "@/panels/pane-context";
import { useSessionStore } from "@/stores/session-store";
import { usePluginServerId } from "../installation-provider";

const noop = () => undefined;
const FOCUSED = createPaneFocusContextValue({ isWorkspaceFocused: true, isPaneFocused: true });

/**
 * The host's agent conversation for any agent, outside a workspace's tab layout.
 * It stands in for a pane: tabs and splits do not exist here, so navigation callbacks do nothing.
 */
export function AgentChat({ agentId, workspaceId }: AgentChatProps) {
  const serverId = usePluginServerId();
  const agentWorkspaceId = useSessionStore((state) => {
    const session = state.sessions[serverId];
    return (
      (session?.agents.get(agentId) ?? session?.agentDetails.get(agentId))?.workspaceId ?? null
    );
  });
  const resolvedWorkspaceId = workspaceId ?? agentWorkspaceId;
  const viewedTimelineSync = useSessionStore(
    (state) => state.sessions[serverId]?.viewedTimelineSync ?? null,
  );
  const tabId = `plugin-agent-chat:${agentId}`;
  const value = useMemo<PaneContextValue | null>(
    () =>
      resolvedWorkspaceId
        ? {
            serverId,
            workspaceId: resolvedWorkspaceId,
            host: "explorer",
            tabId,
            target: { kind: "agent", agentId },
            openTab: noop,
            openPreferredTarget: noop,
            closeCurrentTab: noop,
            retargetCurrentTab: noop,
            setCurrentTabState: noop,
            openFileInWorkspace: noop,
            openImportSheet: noop,
          }
        : null,
    [agentId, resolvedWorkspaceId, serverId, tabId],
  );
  const tabIds = useMemo(() => [tabId], [tabId]);

  // A workspace screen tells the timeline sync which chats are on screen; this chat has no tab.
  useEffect(() => {
    if (!viewedTimelineSync) return;
    viewedTimelineSync.replaceVisibleAgentIds(tabId, [agentId]);
    return () => viewedTimelineSync.replaceVisibleAgentIds(tabId, []);
  }, [agentId, tabId, viewedTimelineSync]);

  if (!value) {
    return (
      <View style={styles.unavailable}>
        <Text style={styles.unavailableText}>This agent is unavailable.</Text>
      </View>
    );
  }
  return (
    <WorkspaceComposerEditingSessionsProvider
      workspaceKey={`${serverId}:${value.workspaceId}`}
      tabIds={tabIds}
    >
      <PaneProvider value={value}>
        <PaneFocusProvider value={FOCUSED}>
          <AgentConversationPanel />
        </PaneFocusProvider>
      </PaneProvider>
    </WorkspaceComposerEditingSessionsProvider>
  );
}

const styles = StyleSheet.create((theme) => ({
  unavailable: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface0,
  },
  unavailableText: { color: theme.colors.foregroundMuted },
}));
