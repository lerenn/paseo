import type { PluginAppPanelProps as SDKAppPanelProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { PluginClientStateProvider } from "@getpaseo/plugin/client/host";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostRuntimeClient, useHosts } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import { usePluginHostNavigation } from "../host-navigation";
import { createPluginClientStateSource } from "../client-state/source";
import { toPluginTheme } from "../theme";
import { useInstalledPlugin } from "../registry";
import { PluginInstallationProvider } from "../installation-provider";
import { SurfaceErrorBoundary } from "../surface-error-boundary";
import { resolvePluginPlatform } from "../platform";

interface AppPluginPanelProps {
  serverId: string;
  pluginId: string;
  panelId: string;
}

const pluginThemeMapping = (theme: Theme) => ({ theme: toPluginTheme(theme) });

function AppPluginPanelBody({
  serverId,
  pluginId,
  panelId,
  theme,
}: AppPluginPanelProps & { theme: PluginTheme }) {
  const plugin = useInstalledPlugin(serverId, pluginId);
  const contribution = plugin?.appPanels.find((panel) => panel.id === panelId) ?? null;
  const client = useHostRuntimeClient(serverId);
  const compact = useIsCompactFormFactor();
  const hosts = useHosts();
  const hostLabel = hosts.find((host) => host.serverId === serverId)?.label ?? serverId;
  const host = useMemo(() => ({ id: serverId, label: hostLabel }), [hostLabel, serverId]);
  const layout = useMemo(() => ({ compact, platform: resolvePluginPlatform() }), [compact]);
  const stateSource = useMemo(() => createPluginClientStateSource(serverId), [serverId]);
  const navigation = usePluginHostNavigation(serverId);

  if (!plugin || !contribution) return <Unavailable message="This plugin panel is unavailable." />;
  if (!client) return <Unavailable message="Plugin host is offline." />;

  const props: SDKAppPanelProps = { theme, host, layout, navigation };
  const Component = contribution.Component;
  return (
    <SurfaceErrorBoundary
      installation={plugin}
      Surface={Component}
      key={`${serverId}/${pluginId}/${panelId}/app`}
    >
      <PluginInstallationProvider plugin={plugin}>
        <PluginClientStateProvider source={stateSource}>
          <Component {...props} />
        </PluginClientStateProvider>
      </PluginInstallationProvider>
    </SurfaceErrorBoundary>
  );
}

const ThemedAppPluginPanelBody = withUnistyles(AppPluginPanelBody);

export function AppPluginPanel(props: AppPluginPanelProps) {
  return <ThemedAppPluginPanelBody {...props} uniProps={pluginThemeMapping} />;
}

function Unavailable({ message }: { message: string }) {
  return (
    <View style={styles.unavailable}>
      <Text style={styles.unavailableText}>{message}</Text>
    </View>
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
