import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(), removeItem: vi.fn() },
}));

import { APP_DOCK_MAX_WIDTH, APP_DOCK_MIN_WIDTH, useAppDockStore } from "./app-dock-store";

const overseer = { serverId: "host", pluginId: "overseer", panelId: "chat" };
const other = { serverId: "host", pluginId: "notes", panelId: "list" };

describe("app dock store", () => {
  beforeEach(() => {
    useAppDockStore.setState({ open: false, panel: null, width: 400, maximized: false });
  });

  it("toggles the same panel closed and a different panel over", () => {
    const { toggle } = useAppDockStore.getState();
    toggle(overseer);
    expect(useAppDockStore.getState()).toMatchObject({ open: true, panel: overseer });
    toggle(overseer);
    expect(useAppDockStore.getState().open).toBe(false);
    toggle(overseer);
    toggle(other);
    expect(useAppDockStore.getState()).toMatchObject({ open: true, panel: other });
  });

  it("closes only when the shown panel matches", () => {
    useAppDockStore.getState().show(overseer);
    useAppDockStore.getState().closeIf((panel) => panel.pluginId === "notes");
    expect(useAppDockStore.getState().open).toBe(true);
    useAppDockStore.getState().closeIf((panel) => panel.pluginId === "overseer");
    expect(useAppDockStore.getState().open).toBe(false);
  });

  it("toggles maximized", () => {
    useAppDockStore.getState().toggleMaximized();
    expect(useAppDockStore.getState().maximized).toBe(true);
    useAppDockStore.getState().toggleMaximized();
    expect(useAppDockStore.getState().maximized).toBe(false);
  });

  it("clamps the width", () => {
    useAppDockStore.getState().resize(10);
    expect(useAppDockStore.getState().width).toBe(APP_DOCK_MIN_WIDTH);
    useAppDockStore.getState().resize(5000);
    expect(useAppDockStore.getState().width).toBe(APP_DOCK_MAX_WIDTH);
  });
});
