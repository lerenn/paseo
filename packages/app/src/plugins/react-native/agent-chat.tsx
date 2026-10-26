import type { AgentChatProps } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { ChevronLeft } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { WorkspaceComposerEditingSessionsProvider } from "@/composer/editing-session";
import { AgentConversationPanel } from "@/panels/agent-panel";
import { providerSubagentPanelRegistration } from "@/panels/provider-subagent-panel";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import {
  createPaneFocusContextValue,
  PaneFocusProvider,
  PaneProvider,
  type PaneContextValue,
} from "@/panels/pane-context";
import { useSessionStore } from "@/stores/session-store";
import { usePluginServerId } from "../installation-provider";

type ChatTarget = Extract<WorkspaceTabTarget, { kind: "agent" | "provider_subagent" }>;

const noop = () => undefined;
const ProviderSubagentPanelView = providerSubagentPanelRegistration.component;
const FOCUSED = createPaneFocusContextValue({ isWorkspaceFocused: true, isPaneFocused: true });

/**
 * The host's agent conversation for any agent, outside a workspace's tab layout.
 * It stands in for a pane: tabs and splits do not exist here, so tab navigation does nothing,
 * but a subagent the conversation points at opens in place, with a back button to return.
 */
export function AgentChat({ agentId, workspaceId }: AgentChatProps) {
  const serverId = usePluginServerId();
  const { t } = useTranslation();
  // The conversation AgentChat was asked for, then each subagent opened from it.
  const [stack, setStack] = useState<ChatTarget[]>([]);
  useEffect(() => setStack([]), [agentId]);
  const root = useMemo<ChatTarget>(() => ({ kind: "agent", agentId }), [agentId]);
  const target = stack.at(-1) ?? root;
  const open = useCallback((next: WorkspaceTabTarget) => {
    if (next.kind === "agent" || next.kind === "provider_subagent") {
      setStack((current) => [...current, next]);
    }
  }, []);
  const back = useCallback(() => setStack((current) => current.slice(0, -1)), []);
  const targetAgentId = target.kind === "agent" ? target.agentId : target.parentAgentId;
  const agentWorkspaceId = useSessionStore((state) => {
    const session = state.sessions[serverId];
    return (
      (session?.agents.get(targetAgentId) ?? session?.agentDetails.get(targetAgentId))
        ?.workspaceId ?? null
    );
  });
  const resolvedWorkspaceId = (target === root ? workspaceId : undefined) ?? agentWorkspaceId;
  const viewedTimelineSync = useSessionStore(
    (state) => state.sessions[serverId]?.viewedTimelineSync ?? null,
  );
  const tabId = `plugin-agent-chat:${stack.length}:${targetAgentId}:${
    target.kind === "provider_subagent" ? target.subagentId : ""
  }`;
  const value = useMemo<PaneContextValue | null>(
    () =>
      resolvedWorkspaceId
        ? {
            serverId,
            workspaceId: resolvedWorkspaceId,
            host: "explorer",
            tabId,
            target,
            openTab: open,
            openSubagentTarget: open,
            openPreferredTarget: noop,
            closeCurrentTab: back,
            retargetCurrentTab: noop,
            setCurrentTabState: noop,
            openFileInWorkspace: noop,
            openImportSheet: noop,
          }
        : null,
    [back, open, resolvedWorkspaceId, serverId, tabId, target],
  );
  const tabIds = useMemo(() => [tabId], [tabId]);

  // A workspace screen tells the timeline sync which chats are on screen; this chat has no tab.
  useEffect(() => {
    if (!viewedTimelineSync || target.kind !== "agent") return;
    viewedTimelineSync.replaceVisibleAgentIds(tabId, [target.agentId]);
    return () => viewedTimelineSync.replaceVisibleAgentIds(tabId, []);
  }, [tabId, target, viewedTimelineSync]);

  if (!value) {
    return (
      <View style={styles.unavailable}>
        <Text style={styles.unavailableText}>This agent is unavailable.</Text>
      </View>
    );
  }
  const Panel = target.kind === "agent" ? AgentConversationPanel : ProviderSubagentPanelView;
  return (
    <View style={styles.frame}>
      {stack.length > 0 ? (
        <View style={styles.backRow}>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={ChevronLeft}
            onPress={back}
            testID="agent-chat-back"
          >
            {t("common.actions.back")}
          </Button>
        </View>
      ) : null}
      <WorkspaceComposerEditingSessionsProvider
        workspaceKey={`${serverId}:${value.workspaceId}`}
        tabIds={tabIds}
      >
        <PaneProvider value={value}>
          <PaneFocusProvider value={FOCUSED}>
            <Panel />
          </PaneFocusProvider>
        </PaneProvider>
      </WorkspaceComposerEditingSessionsProvider>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  frame: { flex: 1, backgroundColor: theme.colors.surface0 },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  unavailable: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface0,
  },
  unavailableText: { color: theme.colors.foregroundMuted },
}));
