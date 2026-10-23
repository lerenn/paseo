import type { PluginWorkspaceLocationProject } from "@getpaseo/plugin/client";
import type { InstalledPlugin, PluginWorkspaceLocationContribution } from "../types";

export interface WorkspaceLocationEntry {
  /** `<pluginId>/<locationId>`; unique across plugins and the form's remembered choice. */
  key: string;
  installation: InstalledPlugin;
  location: PluginWorkspaceLocationContribution;
}

export function workspaceLocationKey(pluginId: string, locationId: string): string {
  return `${pluginId}/${locationId}`;
}

/**
 * The plugin locations offered for `project` on `serverId`: those of plugins installed on that
 * host whose `isAvailable` accepts it. A throwing `isAvailable` hides its option.
 */
export function availableWorkspaceLocations(
  installations: readonly InstalledPlugin[],
  input: { serverId: string; project: PluginWorkspaceLocationProject | null },
): WorkspaceLocationEntry[] {
  const { serverId, project } = input;
  if (!project) return [];
  const entries: WorkspaceLocationEntry[] = [];
  for (const installation of installations) {
    if (installation.serverId !== serverId) continue;
    for (const location of installation.workspaceLocations) {
      if (!isAvailable(installation, location, { hostId: serverId, project })) continue;
      entries.push({
        key: workspaceLocationKey(installation.id, location.id),
        installation,
        location,
      });
    }
  }
  return entries;
}

function isAvailable(
  installation: InstalledPlugin,
  location: PluginWorkspaceLocationContribution,
  context: { hostId: string; project: PluginWorkspaceLocationProject },
): boolean {
  if (!location.isAvailable) return true;
  try {
    return location.isAvailable(context);
  } catch (error) {
    console.warn(`[Plugins] ${installation.id}/${location.id} isAvailable failed`, error);
    return false;
  }
}
