import { useMemo } from "react";
import type { WorkspaceRuntimeDetails, WorkspaceRuntimeSummary } from "@getpaseo/protocol/messages";
import { useFetchQuery } from "@/data/query";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";

const RUNTIME_STALE_MS = 60_000;

/** What a workspace shows for the runtime its agents run in. */
export interface WorkspaceRuntimeBadge {
  id: string;
  label: string;
  /** SVG markup the runtime's plugin declared, or null for the generic glyph. */
  icon: string | null;
}

/**
 * The runtime a workspace runs in, as a badge. Nothing for a workspace on the daemon host. A
 * runtime whose plugin is not loaded (yet) still shows, under its id, so the workspace never
 * looks local by accident.
 */
export function useWorkspaceRuntimeBadge(
  serverId: string,
  runtimeId: string | null | undefined,
): WorkspaceRuntimeBadge | null {
  const client = useHostRuntimeClient(serverId);
  const supported = useHostFeature(serverId, "workspaceRuntimes");
  const queryKey = useMemo(() => ["host", serverId, "workspace-runtimes"] as const, [serverId]);
  const query = useFetchQuery<WorkspaceRuntimeSummary[], Error>({
    queryKey,
    queryFn: () => {
      // The query is disabled without a client; the empty list only satisfies the type.
      return client ? client.fetchWorkspaceRuntimes() : Promise.resolve([]);
    },
    enabled: Boolean(runtimeId) && supported && client !== null,
    retry: false,
    dataShape: "value",
    staleTimeMs: RUNTIME_STALE_MS,
  });
  return useMemo(() => resolveRuntimeBadge(runtimeId, query.data), [query.data, runtimeId]);
}

export function resolveRuntimeBadge(
  runtimeId: string | null | undefined,
  runtimes: readonly WorkspaceRuntimeSummary[] | undefined,
): WorkspaceRuntimeBadge | null {
  if (!runtimeId) return null;
  const runtime = runtimes?.find((candidate) => candidate.id === runtimeId);
  return {
    id: runtimeId,
    label: runtime?.label ?? runtimeId,
    icon: runtime?.icon ?? null,
  };
}

const DETAILS_STALE_MS = 10_000;

/**
 * What the workspace's runtime says about it (label, tooltip, header detail), or null. Refetched
 * every few seconds while mounted so a state change in the sandbox shows without a reload.
 */
export function useWorkspaceRuntimeDetails(
  serverId: string,
  workspaceId: string | null | undefined,
  runtimeId: string | null | undefined,
): WorkspaceRuntimeDetails | null {
  const client = useHostRuntimeClient(serverId);
  const supported = useHostFeature(serverId, "workspaceRuntimeDetails");
  const queryKey = useMemo(
    () => ["host", serverId, "workspace-runtime-details", workspaceId ?? ""] as const,
    [serverId, workspaceId],
  );
  const query = useFetchQuery<WorkspaceRuntimeDetails, Error>({
    queryKey,
    queryFn: () =>
      client && workspaceId
        ? client.fetchWorkspaceRuntimeDetails(workspaceId)
        : Promise.resolve({}),
    enabled: Boolean(runtimeId) && Boolean(workspaceId) && supported && client !== null,
    retry: false,
    dataShape: "value",
    staleTimeMs: DETAILS_STALE_MS,
    refetchInterval: DETAILS_STALE_MS,
  });
  const data = query.data;
  return useMemo(
    () => (data && (data.label || data.tooltip || data.detail || data.hostIcon) ? data : null),
    [data],
  );
}
