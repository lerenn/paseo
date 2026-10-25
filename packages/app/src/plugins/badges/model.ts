import type { PluginAgentBadgeContribution, PluginBadgeAgent } from "@getpaseo/plugin/client";
import type { PluginSerializableIcon } from "@getpaseo/plugin/client";

export interface RegisteredAgentBadge {
  key: number;
  pluginId: string;
  id: string;
  scope: "agent" | "workspace";
  labels: Readonly<Record<string, string>>;
  icon: PluginSerializableIcon;
  text?: (agent: PluginBadgeAgent) => string;
  tooltip?: (agent: PluginBadgeAgent) => string;
}

export interface ResolvedAgentBadge {
  key: string;
  icon: PluginSerializableIcon;
  text: string | null;
  tooltip: string | null;
}

const BADGE_ID = /^[a-z][a-z0-9-]*$/;

/** Validates a contribution. Returns it normalized, or throws naming what is wrong. */
export function validateAgentBadge(
  input: PluginAgentBadgeContribution,
): Pick<RegisteredAgentBadge, "id" | "scope" | "labels" | "text" | "tooltip"> {
  if (typeof input.id !== "string" || !BADGE_ID.test(input.id)) {
    throw new Error(`Invalid plugin agent badge id: ${String(input.id)}`);
  }
  const scope = input.scope ?? "agent";
  if (scope !== "agent" && scope !== "workspace") {
    throw new Error(`Plugin agent badge ${input.id} has an invalid scope`);
  }
  const labels = input.match?.labels;
  const entries = labels && typeof labels === "object" ? Object.entries(labels) : [];
  if (entries.length === 0) {
    throw new Error(`Plugin agent badge ${input.id} must match at least one label`);
  }
  for (const [key, value] of entries) {
    if (!key.trim() || typeof value !== "string") {
      throw new Error(`Plugin agent badge ${input.id} has an invalid label match`);
    }
  }
  for (const name of ["text", "tooltip"] as const) {
    const fn = input.render?.[name];
    if (fn !== undefined && typeof fn !== "function") {
      throw new Error(`Plugin agent badge ${input.id} ${name} must be a function`);
    }
  }
  return {
    id: input.id,
    scope,
    labels: Object.fromEntries(entries),
    text: input.render.text,
    tooltip: input.render.tooltip,
  };
}

export function agentMatchesLabels(
  agent: Pick<PluginBadgeAgent, "labels">,
  match: Readonly<Record<string, string>>,
): boolean {
  return Object.entries(match).every(([key, value]) => {
    const actual = agent.labels[key];
    return actual !== undefined && (value === "*" || actual === value);
  });
}

function safely(call: (() => string) | undefined): string | null {
  if (!call) return null;
  try {
    const value = call();
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    // A plugin's text function must not take the row down with it.
    return null;
  }
}

/**
 * The badges a set of agents earns on a surface. "agent" surfaces (the agent header and list row)
 * show every matching badge; a "workspace-row" shows only badges that opted into workspace scope,
 * for any matching agent in the workspace. A badge shows once however many agents match, with its
 * text from the first match.
 */
export function resolveAgentBadges(
  badges: readonly RegisteredAgentBadge[],
  agents: readonly PluginBadgeAgent[],
  surface: "agent" | "workspace-row",
): ResolvedAgentBadge[] {
  const resolved: ResolvedAgentBadge[] = [];
  for (const badge of badges) {
    if (surface === "workspace-row" && badge.scope !== "workspace") continue;
    const agent = agents.find((candidate) => agentMatchesLabels(candidate, badge.labels));
    if (!agent) continue;
    resolved.push({
      key: `${badge.pluginId}/${badge.id}`,
      icon: badge.icon,
      text: safely(badge.text ? () => badge.text!(agent) : undefined),
      tooltip: safely(badge.tooltip ? () => badge.tooltip!(agent) : undefined),
    });
  }
  return resolved;
}
