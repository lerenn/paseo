import { useMemo, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { PluginBadgeAgent } from "@getpaseo/plugin/client";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import { PluginIconView } from "../icons";
import { resolveAgentBadges, type ResolvedAgentBadge } from "./model";
import { pluginAgentBadgeStore } from "./store";

const BADGE_ICON_SIZE = 12;
/** Badges stack; past this many the rest are summarised so a row stays compact. */
const MAX_VISIBLE_BADGES = 3;

/**
 * `currentColor` does not follow the theme on native and inherits a fixed colour on web, so the
 * badge icon takes the theme's foreground colour (which changes with light and dark mode).
 */
function BadgeIcon({ icon, color = "" }: { icon: ResolvedAgentBadge["icon"]; color?: string }) {
  return <PluginIconView icon={icon} size={BADGE_ICON_SIZE} color={color} />;
}
const ThemedBadgeIcon = withUnistyles(BadgeIcon);
const foregroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });

/** The agents a surface stands for, as the badge functions see them. */
function useBadgeAgents(input: {
  serverId: string;
  agentId?: string;
  workspaceId?: string;
}): PluginBadgeAgent[] {
  const { serverId, agentId, workspaceId } = input;
  const agents = useSessionStore((state) => state.sessions[serverId]?.agents);
  return useMemo(() => {
    const result: PluginBadgeAgent[] = [];
    if (!agents) return result;
    for (const agent of agents.values()) {
      if (agentId ? agent.id !== agentId : agent.workspaceId !== workspaceId) continue;
      if (agent.archivedAt) continue;
      result.push({ id: agent.id, title: agent.title ?? null, labels: agent.labels ?? {} });
    }
    return result;
  }, [agents, agentId, workspaceId]);
}

/** Every badge a surface earns, for the surface's agent or its workspace's agents. */
export function useAgentBadges(input: {
  serverId: string;
  agentId?: string;
  workspaceId?: string;
}): ResolvedAgentBadge[] {
  const registered = useSyncExternalStore(
    pluginAgentBadgeStore.subscribe,
    pluginAgentBadgeStore.getSnapshot,
  );
  const agents = useBadgeAgents(input);
  const surface = input.agentId ? "agent" : "workspace-row";
  return useMemo(
    () => (registered.length === 0 ? [] : resolveAgentBadges(registered, agents, surface)),
    [registered, agents, surface],
  );
}

function Badge({ badge }: { badge: ResolvedAgentBadge }) {
  const content = (
    <View style={styles.badge} testID={`agent-badge-${badge.key}`}>
      <ThemedBadgeIcon icon={badge.icon} uniProps={foregroundMapping} />
      {badge.text ? (
        <Text style={styles.text} numberOfLines={1}>
          {badge.text}
        </Text>
      ) : null}
    </View>
  );
  if (!badge.tooltip) return content;
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{badge.tooltip}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Plugin badges for an agent (`agentId`) or for a workspace's agents (`workspaceId`, sidebar
 * rows). Nothing when no plugin badges match, so a row without them keeps its look.
 */
export function AgentBadges(input: { serverId: string; agentId?: string; workspaceId?: string }) {
  const badges = useAgentBadges(input);
  if (badges.length === 0) return null;
  const visible = badges.slice(0, MAX_VISIBLE_BADGES);
  const hidden = badges.length - visible.length;
  return (
    <View style={styles.row}>
      {visible.map((badge) => (
        <Badge key={badge.key} badge={badge} />
      ))}
      {hidden > 0 ? <Text style={styles.text}>+{hidden}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1], flexShrink: 1 },
  badge: { flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 1 },
  text: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, flexShrink: 1 },
  tooltipText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
}));
