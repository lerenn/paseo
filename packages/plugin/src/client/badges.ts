import type { PluginSerializableIcon } from "../icons.js";

/** What a badge's `text` and `tooltip` functions are given. */
export interface PluginBadgeAgent {
  id: string;
  title: string | null;
  labels: Readonly<Record<string, string>>;
}

export interface PluginAgentBadgeContribution {
  /** Lowercase letters, digits and hyphens, unique within the plugin. */
  id: string;
  /**
   * "agent" (default) badges an agent that matches. "workspace" also badges the workspace's
   * sidebar row when any agent in it matches.
   */
  scope?: "agent" | "workspace";
  match: {
    /** Every key must be on the agent. A value must equal the label's; "*" accepts any value. */
    labels: Readonly<Record<string, string>>;
  };
  render: {
    icon: PluginSerializableIcon;
    /** Short text beside the icon. Omit for an icon-only badge. */
    text?(agent: PluginBadgeAgent): string;
    tooltip?(agent: PluginBadgeAgent): string;
  };
}
