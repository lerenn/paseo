import type { PluginHostProps, PluginWorkspaceLocationProject } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo, type ReactElement } from "react";
import { withUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { useHostRuntimeClient, useHosts } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import { createPluginClientStateSource } from "../client-state/source";
import { PluginEnvironmentProvider, type PluginEnvironment } from "../popover";
import { resolvePluginPlatform } from "../platform";
import { useInstalledPlugins } from "../registry";
import { SurfaceErrorBoundary } from "../surface-error-boundary";
import { toPluginTheme } from "../theme";
import { availableWorkspaceLocations, type WorkspaceLocationEntry } from "./model";

const pluginThemeMapping = (theme: Theme) => ({ theme: toPluginTheme(theme) });

export function useWorkspaceLocations(input: {
  serverId: string;
  project: PluginWorkspaceLocationProject | null;
}): WorkspaceLocationEntry[] {
  const installations = useInstalledPlugins();
  const { serverId, project } = input;
  return useMemo(
    () => availableWorkspaceLocations(installations, { serverId, project }),
    [installations, serverId, project],
  );
}

interface WorkspaceLocationSettingsProps {
  entry: WorkspaceLocationEntry;
  project: PluginWorkspaceLocationProject;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
}

function renderNothing() {
  return null;
}

function WorkspaceLocationSettingsHost({
  entry,
  project,
  value,
  onChange,
  disabled,
  theme,
}: WorkspaceLocationSettingsProps & { theme: PluginTheme }): ReactElement | null {
  const { installation, location } = entry;
  const client = useHostRuntimeClient(installation.serverId);
  const toast = useToast();
  const compact = useIsCompactFormFactor();
  const hostLabel = useHosts().find((host) => host.serverId === installation.serverId)?.label;
  const environment = useMemo<PluginEnvironment | null>(
    () =>
      client
        ? {
            installation,
            toast,
            state: createPluginClientStateSource(installation.serverId),
          }
        : null,
    [client, installation, toast],
  );
  const host = useMemo<PluginHostProps["host"]>(
    () => ({ id: installation.serverId, label: hostLabel ?? installation.serverId }),
    [hostLabel, installation.serverId],
  );
  const layout = useMemo<PluginHostProps["layout"]>(
    () => ({ compact, platform: resolvePluginPlatform() }),
    [compact],
  );
  const Settings = location.Settings;
  if (!Settings || !environment) return null;
  return (
    <SurfaceErrorBoundary
      installation={installation}
      Surface={Settings}
      renderError={renderNothing}
    >
      <PluginEnvironmentProvider environment={environment}>
        <Settings
          theme={theme}
          host={host}
          layout={layout}
          project={project}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      </PluginEnvironmentProvider>
    </SurfaceErrorBoundary>
  );
}

const ThemedSettingsHost = withUnistyles(WorkspaceLocationSettingsHost);

/** The selected location's `Settings`, inside the plugin's runtime and its own error boundary. */
export function WorkspaceLocationSettings(props: WorkspaceLocationSettingsProps) {
  return <ThemedSettingsHost {...props} uniProps={pluginThemeMapping} />;
}
