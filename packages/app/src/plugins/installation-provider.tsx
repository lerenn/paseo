import { QueryClientProvider } from "@tanstack/react-query";
import {
  PaseoApiProvider,
  PluginRpcProvider,
  PluginTranslationProvider,
} from "@getpaseo/plugin/client/host";
import React, { createContext, useContext, type ReactNode } from "react";
import type { InstalledPlugin } from "./types";

const PluginServerIdContext = createContext<string | null>(null);

/** The host a plugin surface renders for. Throws outside a plugin surface. */
export function usePluginServerId(): string {
  const serverId = useContext(PluginServerIdContext);
  if (serverId === null) throw new Error("usePluginServerId must be used inside a plugin surface");
  return serverId;
}

/** Every plugin surface renders under its installation: one query cache, one Paseo client, RPCs. */
export function PluginInstallationProvider({
  plugin,
  children,
}: {
  plugin: InstalledPlugin;
  children: ReactNode;
}) {
  return (
    <PluginServerIdContext.Provider value={plugin.serverId}>
      <QueryClientProvider client={plugin.queryClient}>
        <PaseoApiProvider paseo={plugin.paseo}>
          <PluginRpcProvider invoke={plugin.invoke}>
            <PluginTranslationProvider runtime={plugin.i18n}>{children}</PluginTranslationProvider>
          </PluginRpcProvider>
        </PaseoApiProvider>
      </QueryClientProvider>
    </PluginServerIdContext.Provider>
  );
}
