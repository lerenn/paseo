import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

const APP_DOCK_STORAGE_KEY = "app-dock";
const APP_DOCK_STORE_VERSION = 1;

export const APP_DOCK_MIN_WIDTH = 280;
export const APP_DOCK_MAX_WIDTH = 720;
export const APP_DOCK_DEFAULT_WIDTH = 400;

/** The plugin panel the dock shows. It lives on one host, never on a workspace. */
export interface AppDockPanel {
  serverId: string;
  pluginId: string;
  panelId: string;
}

interface AppDockState {
  open: boolean;
  width: number;
  /** Fills the room beside the left sidebar instead of sharing it with the content. */
  maximized: boolean;
  panel: AppDockPanel | null;
  /** Shows the dock on `panel`. */
  show: (panel: AppDockPanel) => void;
  /** Closes the dock when it shows `panel`, otherwise shows `panel`. */
  toggle: (panel: AppDockPanel) => void;
  close: () => void;
  /** Closes the dock when it shows a panel for which `matches` holds. */
  closeIf: (matches: (panel: AppDockPanel) => boolean) => void;
  resize: (width: number) => void;
  toggleMaximized: () => void;
}

const AppDockPersistedStateSchema = z.object({
  open: z.boolean(),
  width: z.number(),
  maximized: z.boolean().default(false),
  panel: z.object({ serverId: z.string(), pluginId: z.string(), panelId: z.string() }).nullable(),
});

export function clampAppDockWidth(width: number): number {
  return Math.min(APP_DOCK_MAX_WIDTH, Math.max(APP_DOCK_MIN_WIDTH, Math.round(width)));
}

export function isSameAppDockPanel(left: AppDockPanel | null, right: AppDockPanel): boolean {
  return (
    left !== null &&
    left.serverId === right.serverId &&
    left.pluginId === right.pluginId &&
    left.panelId === right.panelId
  );
}

export const useAppDockStore = create<AppDockState>()(
  persist(
    (set, get) => ({
      open: false,
      width: APP_DOCK_DEFAULT_WIDTH,
      maximized: false,
      panel: null,
      show: (panel) => set({ open: true, panel }),
      toggle: (panel) => {
        const state = get();
        if (state.open && isSameAppDockPanel(state.panel, panel)) {
          set({ open: false });
          return;
        }
        set({ open: true, panel });
      },
      close: () => set({ open: false }),
      closeIf: (matches) => {
        const { open, panel } = get();
        if (open && panel && matches(panel)) set({ open: false });
      },
      resize: (width) => set({ width: clampAppDockWidth(width) }),
      toggleMaximized: () => set((state) => ({ maximized: !state.maximized })),
    }),
    {
      name: APP_DOCK_STORAGE_KEY,
      version: APP_DOCK_STORE_VERSION,
      storage: createValidatedPersistStorage(AsyncStorage, AppDockPersistedStateSchema),
      partialize: (state) => ({
        open: state.open,
        width: state.width,
        maximized: state.maximized,
        panel: state.panel,
      }),
    },
  ),
);
