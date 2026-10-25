import type { PluginAgentBadgeContribution } from "@getpaseo/plugin/client";
import { parseSerializablePluginIcon } from "../icons";
import type { InstalledPlugin } from "../types";
import { validateAgentBadge, type RegisteredAgentBadge } from "./model";

/** The agent badges installed plugins registered, for the surfaces that draw them. */
export class PluginAgentBadgeStore {
  private entries: readonly RegisteredAgentBadge[] = [];
  private nextKey = 0;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): readonly RegisteredAgentBadge[] => this.entries;

  add(installation: InstalledPlugin, input: PluginAgentBadgeContribution): () => void {
    const checked = validateAgentBadge(input);
    const icon = parseSerializablePluginIcon(`Plugin agent badge ${checked.id}`, input.render.icon);
    const duplicate = this.entries.some(
      (entry) => entry.pluginId === installation.id && entry.id === checked.id,
    );
    if (duplicate) throw new Error(`Duplicate plugin agent badge: ${checked.id}`);
    const key = this.nextKey++;
    this.publish([...this.entries, { key, pluginId: installation.id, icon, ...checked }]);
    return () => {
      const next = this.entries.filter((entry) => entry.key !== key);
      if (next.length !== this.entries.length) this.publish(next);
    };
  }

  private publish(entries: readonly RegisteredAgentBadge[]): void {
    this.entries = entries;
    for (const listener of this.listeners) listener();
  }
}

export const pluginAgentBadgeStore = new PluginAgentBadgeStore();
