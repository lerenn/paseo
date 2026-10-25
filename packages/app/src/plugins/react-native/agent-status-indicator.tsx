import type { AgentStatusIndicatorProps } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { View } from "react-native";
import { CircleAlert } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { StatusRing } from "@/components/status-ring";
import { useSessionStore } from "@/stores/session-store";
import { deriveSidebarStateBucket, type SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { getStatusDotColor } from "@/utils/status-dot-color";
import {
  STATUS_INDICATOR_ALERT_SIZE,
  STATUS_INDICATOR_FILLED_DOT_SIZE,
} from "@/utils/status-indicator-geometry";
import type { Theme } from "@/styles/theme";
import { usePluginServerId } from "../installation-provider";

const DEFAULT_SIZE = 14;
const ThemedCircleAlert = withUnistyles(CircleAlert);
const needsInputMapping = (theme: Theme) => ({
  color: theme.colors.surface0,
  fill: getStatusDotColor({ theme, bucket: "needs_input" }) ?? undefined,
});

export type StatusGlyphKind = "ring" | "alert" | "attention-dot" | "failed-dot" | "muted-dot";

/** Which glyph a bucket draws, the same choice the sidebar makes. */
export function statusGlyphKind(bucket: SidebarStateBucket): StatusGlyphKind {
  switch (bucket) {
    case "running":
      return "ring";
    case "needs_input":
      return "alert";
    case "failed":
      return "failed-dot";
    case "attention":
      return "attention-dot";
    case "done":
      return "muted-dot";
  }
}

/** The bucket of an agent the session knows, or null for one it does not. */
export function agentStatusBucket(
  agent:
    | {
        status: Parameters<typeof deriveSidebarStateBucket>[0]["status"];
        pendingPermissions: readonly unknown[];
        requiresAttention?: boolean;
        attentionReason?: Parameters<typeof deriveSidebarStateBucket>[0]["attentionReason"];
      }
    | null
    | undefined,
): SidebarStateBucket | null {
  if (!agent) return null;
  return deriveSidebarStateBucket({
    status: agent.status,
    pendingPermissionCount: agent.pendingPermissions.length,
    requiresAttention: agent.requiresAttention,
    attentionReason: agent.attentionReason,
  });
}

/**
 * The status glyph the sidebar draws for an agent: a ring while it runs, an alert when it needs
 * input, a coloured dot for attention and failure, a muted dot when it is done. A bucket the
 * sidebar has no glyph for (an unknown agent) draws nothing.
 */
export function AgentStatusGlyph({
  bucket,
  size = DEFAULT_SIZE,
}: {
  bucket: SidebarStateBucket | null;
  size?: number;
}) {
  const boxStyle = useMemo(() => [styles.box, { width: size, height: size }], [size]);
  if (bucket === null) return null;
  const kind = statusGlyphKind(bucket);
  let glyph;
  if (kind === "ring") glyph = <StatusRing backdrop="surface0" />;
  else if (kind === "alert") {
    glyph = <ThemedCircleAlert size={STATUS_INDICATOR_ALERT_SIZE} uniProps={needsInputMapping} />;
  } else if (kind === "muted-dot") glyph = <View style={styles.idleDot} />;
  else glyph = <View style={kind === "failed-dot" ? styles.failedDot : styles.attentionDot} />;
  return (
    <View style={boxStyle} testID={`agent-status-indicator-${bucket}`} accessibilityRole="image">
      {glyph}
    </View>
  );
}

/** The live status of one agent on the plugin's host, drawn like the sidebar draws it. */
export function AgentStatusIndicator({ agentId, size }: AgentStatusIndicatorProps) {
  const serverId = usePluginServerId();
  const bucket = useSessionStore((state): SidebarStateBucket | null => {
    const session = state.sessions[serverId];
    const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
    return agentStatusBucket(agent);
  });
  return <AgentStatusGlyph bucket={bucket} size={size} />;
}

const styles = StyleSheet.create((theme) => ({
  box: { alignItems: "center", justifyContent: "center" },
  idleDot: {
    width: STATUS_INDICATOR_FILLED_DOT_SIZE,
    height: STATUS_INDICATOR_FILLED_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foregroundMuted,
    opacity: 0.5,
  },
  attentionDot: {
    width: STATUS_INDICATOR_FILLED_DOT_SIZE,
    height: STATUS_INDICATOR_FILLED_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.statusDotSuccess,
  },
  failedDot: {
    width: STATUS_INDICATOR_FILLED_DOT_SIZE,
    height: STATUS_INDICATOR_FILLED_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.statusDotDanger,
  },
}));
