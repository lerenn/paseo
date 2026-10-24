import type { InstalledPlugin } from "../types";

export interface ResolvedCreateOption {
  /** `pluginId:optionId`, unique across plugins. */
  key: string;
  pluginId: string;
  optionId: string;
  label: string;
  icon: InstalledPlugin["createOptions"][number]["icon"];
  description?: string;
  options: Array<{ value: string; label: string; description?: string }>;
  defaultValue: string;
}

export type PluginCreateSelections = Readonly<Record<string, string>>;

export function resolveCreateOptions(
  plugins: readonly InstalledPlugin[],
  serverId: string,
): ResolvedCreateOption[] {
  return plugins
    .filter((plugin) => plugin.serverId === serverId)
    .flatMap((plugin) =>
      plugin.createOptions.map((option) => {
        const text = (value: Parameters<typeof plugin.i18n.resolve>[0]) =>
          plugin.i18n.resolve(value, plugin.locale);
        const options = option.options.map((entry) => ({
          value: entry.value,
          label: text(entry.label),
          ...(entry.description ? { description: text(entry.description) } : {}),
        }));
        return {
          key: createOptionKey(plugin.id, option.id),
          pluginId: plugin.id,
          optionId: option.id,
          label: text(option.label),
          icon: option.icon,
          ...(option.description ? { description: text(option.description) } : {}),
          options,
          defaultValue: option.defaultValue ?? options[0].value,
        };
      }),
    );
}

export function createOptionKey(pluginId: string, optionId: string): string {
  return `${pluginId}:${optionId}`;
}

export function selectedCreateOptionValue(
  option: ResolvedCreateOption,
  selections: PluginCreateSelections,
): string {
  const selected = selections[option.key];
  return selected !== undefined && option.options.some((entry) => entry.value === selected)
    ? selected
    : option.defaultValue;
}

/** The `pluginOptions` of a create request: every visible option, namespaced by plugin. */
export function buildPluginOptions(
  options: readonly ResolvedCreateOption[],
  selections: PluginCreateSelections,
): Record<string, Record<string, string>> | undefined {
  if (options.length === 0) return undefined;
  const result: Record<string, Record<string, string>> = {};
  for (const option of options) {
    (result[option.pluginId] ??= {})[option.optionId] = selectedCreateOptionValue(
      option,
      selections,
    );
  }
  return result;
}
