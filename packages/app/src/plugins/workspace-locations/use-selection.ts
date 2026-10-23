import { useCallback, useMemo, useState } from "react";
import type { PluginWorkspaceLocationProject } from "@getpaseo/plugin/client";
import { useFormPreferences } from "@/hooks/use-form-preferences";
import { useWorkspaceLocations } from "./view";

/**
 * Which plugin workspace location the New workspace form has selected, if any, and its settings.
 * The choice is remembered with the other form preferences; the settings live only as long as the
 * screen. `""` is the explicit choice of a built-in location.
 */
export function useWorkspaceLocationSelection(input: {
  serverId: string;
  project: PluginWorkspaceLocationProject | null;
}) {
  const { preferences, updatePreferences } = useFormPreferences();
  const entries = useWorkspaceLocations(input);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const [settingsByKey, setSettingsByKey] = useState<Record<string, unknown>>({});
  const key = manualKey ?? preferences.workspaceLocation ?? "";
  const selected = entries.find((entry) => entry.key === key) ?? null;
  const settings = selected
    ? (settingsByKey[selected.key] ?? selected.location.defaultValue)
    : undefined;
  const select = useCallback(
    (nextKey: string) => {
      setManualKey(nextKey);
      void updatePreferences({ workspaceLocation: nextKey });
    },
    [updatePreferences],
  );
  const clear = useCallback(() => setManualKey(""), []);
  const changeSettings = useCallback(
    (value: unknown) => {
      if (!selected) return;
      setSettingsByKey((current) => ({ ...current, [selected.key]: value }));
    },
    [selected],
  );
  const { project } = input;
  const formProps = useMemo(
    () => ({
      entries,
      selected,
      onSelect: select,
      settings: selected && project ? { project, value: settings, onChange: changeSettings } : null,
    }),
    [entries, selected, select, project, settings, changeSettings],
  );
  // A plugin location shows the branch picker like New worktree, unless it opts out with
  // `usesRef: false`. Without a checkout to choose from (not a git project) there is nothing to pick.
  const usesRef = useCallback(
    (canCreateWorktree: boolean) =>
      selected !== null && selected.location.usesRef !== false && canCreateWorktree,
    [selected],
  );
  const showsRefPicker = useCallback(
    (builtInShowsRefPicker: boolean, canCreateWorktree: boolean) =>
      selected ? usesRef(canCreateWorktree) : builtInShowsRefPicker,
    [selected, usesRef],
  );
  return { formProps, selected, settings, clear, usesRef, showsRefPicker };
}
