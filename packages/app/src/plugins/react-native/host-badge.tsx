import type { HostBadgeProps } from "@getpaseo/plugin/client/ui";
import { HostBadge as AppHostBadge } from "@/hosts/host-badge";
import { useHostBadges } from "@/hosts/use-host-badges";
import { useHosts } from "@/runtime/host-runtime";

/**
 * The badge conversation rows draw, for a plugin's own rows. Like those rows it appears only when
 * more than one host is connected; the host's own setting then decides name, icon, or hidden.
 */
export function HostBadge({ hostId }: HostBadgeProps) {
  const hostCount = useHosts().length;
  const badge = useHostBadges({ enabled: hostCount >= 2 }).get(hostId);
  return badge ? <AppHostBadge badge={badge} /> : null;
}
