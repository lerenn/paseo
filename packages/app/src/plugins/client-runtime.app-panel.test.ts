import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(), removeItem: vi.fn() },
}));
vi.mock("@/audio", () => ({ createPlayAudio: () => async () => undefined }));
vi.mock("@/runtime/host-runtime", () => ({ getHostRuntimeStore: () => ({}) }));
vi.mock("./hosts", () => ({ createPluginHosts: () => ({}) }));
vi.mock("./client-state/source", () => ({ createPluginClientStateSource: () => ({}) }));
vi.mock("./navigation", () => ({ createPluginNavigation: () => ({}) }));
vi.mock("./buttons", () => ({ pluginButtonStore: {} }));
vi.mock("./actions", () => ({
  createPluginAgentActionContext: vi.fn(),
  createPluginCapabilities: () => ({}),
  createPluginWorkspaceActionContext: vi.fn(),
}));

import { useAppDockStore } from "@/stores/app-dock-store";
import { createPluginClientRuntime } from "./client-runtime";
import type { InstalledPlugin } from "./types";

function installation(id: string, panels: string[]): InstalledPlugin {
  return {
    id,
    serverId: "host",
    appPanels: panels.map((panel) => ({ id: panel })),
    lifetime: new AbortController(),
    i18n: {},
  } as unknown as InstalledPlugin;
}

describe("app panel runtime", () => {
  beforeEach(() => useAppDockStore.setState({ open: false, panel: null }));

  it("opens, toggles, and closes only the plugin's own panels", () => {
    const overseer = createPluginClientRuntime(installation("overseer", ["chat"]), {
      play: async () => 0,
    });
    const other = createPluginClientRuntime(installation("notes", ["list"]), {
      play: async () => 0,
    });

    overseer.openAppPanel("chat");
    expect(useAppDockStore.getState()).toMatchObject({
      open: true,
      panel: { serverId: "host", pluginId: "overseer", panelId: "chat" },
    });

    other.closeAppPanel();
    expect(useAppDockStore.getState().open).toBe(true);

    overseer.toggleAppPanel("chat");
    expect(useAppDockStore.getState().open).toBe(false);

    other.toggleAppPanel("list");
    overseer.closeAppPanel();
    expect(useAppDockStore.getState().panel?.pluginId).toBe("notes");
    expect(useAppDockStore.getState().open).toBe(true);
  });

  it("throws for an unknown panel", () => {
    const runtime = createPluginClientRuntime(installation("overseer", ["chat"]), {
      play: async () => 0,
    });
    expect(() => runtime.openAppPanel("missing")).toThrow("App panel is unavailable: missing");
  });
});
