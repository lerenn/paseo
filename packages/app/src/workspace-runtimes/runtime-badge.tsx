import { Box } from "lucide-react-native";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SvgIcon } from "@/components/provider-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { densityIconSize } from "@/styles/density";
import type { Theme } from "@/styles/theme";
import { isRuntimeBadgeHidden } from "./badge-visibility";
import { useWorkspaceRuntimeBadge, useWorkspaceRuntimeDetails } from "./use-workspace-runtime";

function RuntimeGlyphBase({
  svg,
  size,
  color = "",
}: {
  svg: string | null;
  size: number;
  color?: string;
}) {
  if (!svg) return <Box size={size} color={color} />;
  return <SvgIcon svg={svg} size={size} color={color} />;
}

const ThemedRuntimeGlyph = withUnistyles(RuntimeGlyphBase);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const kindIconProps = (theme: Theme, rt: { breakpoint?: string }) => ({
  color: theme.colors.foregroundMuted,
  size: densityIconSize(rt, "sm"),
});

/**
 * The runtime's icon in the place a workspace's kind icon (monitor, folder, git folder) would
 * go, sized like it. Null for a host workspace, which keeps its kind icon.
 */
export function RuntimeKindIcon({
  serverId,
  runtimeId,
}: {
  serverId: string;
  runtimeId: string | null | undefined;
}) {
  const badge = useWorkspaceRuntimeBadge(serverId, runtimeId);
  if (!badge) return null;
  return <ThemedRuntimeGlyph svg={badge.icon} size={16} uniProps={kindIconProps} />;
}

/**
 * Where a workspace's agents run, when that is not the daemon host: the runtime's own icon, with
 * its name in a tooltip. A host workspace draws nothing, so Local keeps today's look.
 */
export function RuntimeBadge({
  serverId,
  runtimeId,
  workspaceId,
  size,
  hostIconShown = false,
}: {
  serverId: string;
  runtimeId: string | null | undefined;
  workspaceId?: string;
  size: number;
  /** The host indicator already draws the runtime's `hostIcon`; skip this badge if it has no label. */
  hostIconShown?: boolean;
}) {
  const badge = useWorkspaceRuntimeBadge(serverId, runtimeId);
  const details = useWorkspaceRuntimeDetails(serverId, workspaceId, runtimeId);
  if (!badge) return null;
  if (isRuntimeBadgeHidden(details, hostIconShown)) return null;
  const shortLabel = details?.label?.trim() || undefined;
  const tooltip = details?.tooltip ?? badge.label;
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <View
          style={styles.badge}
          testID={`runtime-badge-${badge.id}`}
          accessibilityLabel={shortLabel ? `${badge.label}: ${shortLabel}` : badge.label}
        >
          <ThemedRuntimeGlyph svg={badge.icon} size={size} uniProps={mutedColor} />
          {shortLabel ? (
            <Text style={styles.label} numberOfLines={1}>
              {shortLabel}
            </Text>
          ) : null}
        </View>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{tooltip}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  badge: { flexDirection: "row", alignItems: "center", flexShrink: 1, minWidth: 0, gap: 4 },
  label: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, flexShrink: 1 },
  tooltipText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
}));
