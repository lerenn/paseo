import { create } from "zustand";
import { useMemo } from "react";
import { useSessionStore } from "@/stores/session-store";
import { pluginRegistry, useInstalledPlugins } from "../registry";
import {
  buildPluginOptions,
  resolveCreateOptions,
  type PluginCreateSelections,
  type ResolvedCreateOption,
} from "./model";

interface CreateOptionSelectionState {
  /** Per host: the value picked for each `pluginId:optionId` since the last creation. */
  selectionsByServer: Record<string, PluginCreateSelections>;
  select(serverId: string, key: string, value: string): void;
  reset(serverId: string): void;
}

const EMPTY_SELECTIONS: PluginCreateSelections = {};

export const useCreateOptionSelections = create<CreateOptionSelectionState>((set) => ({
  selectionsByServer: {},
  select(serverId, key, value) {
    set((state) => ({
      selectionsByServer: {
        ...state.selectionsByServer,
        [serverId]: { ...state.selectionsByServer[serverId], [key]: value },
      },
    }));
  },
  reset(serverId) {
    set((state) => {
      if (!state.selectionsByServer[serverId]) return state;
      const { [serverId]: _dropped, ...rest } = state.selectionsByServer;
      return { selectionsByServer: rest };
    });
  },
}));

const NO_OPTIONS: ResolvedCreateOption[] = [];

function serverSupportsCreateOptions(serverId: string): boolean {
  return (
    useSessionStore.getState().sessions[serverId]?.serverInfo?.features?.pluginCreateOptions ===
    true
  );
}

/** Empty on a daemon that cannot hand the values to `agent.create` hooks. */
export function useCreateOptions(serverId: string): ResolvedCreateOption[] {
  const installed = useInstalledPlugins();
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.pluginCreateOptions === true,
  );
  return useMemo(
    () => (supported ? resolveCreateOptions(installed, serverId) : NO_OPTIONS),
    [installed, serverId, supported],
  );
}

export function useServerCreateSelections(serverId: string): PluginCreateSelections {
  return useCreateOptionSelections(
    (state) => state.selectionsByServer[serverId] ?? EMPTY_SELECTIONS,
  );
}

/**
 * The `pluginOptions` for a create request on this host, read at submit time so the draft and
 * New workspace flows share one source. Call `resetPluginOptions` once the request is sent.
 */
export function readPluginOptions(serverId: string) {
  if (!serverSupportsCreateOptions(serverId)) return undefined;
  return buildPluginOptions(
    resolveCreateOptions(pluginRegistry.getSnapshot(), serverId),
    useCreateOptionSelections.getState().selectionsByServer[serverId] ?? EMPTY_SELECTIONS,
  );
}

/** A role (or any option) applies to one creation; the next composer starts from defaults. */
export function resetPluginOptions(serverId: string): void {
  useCreateOptionSelections.getState().reset(serverId);
}
