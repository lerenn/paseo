import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { View } from "react-native";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { AgentControlTrigger } from "@/composer/agent-controls/control";
import { useComposerControlLayout } from "@/composer/agent-controls/layout-context";
import { pluginIconComponent } from "../icons";
import { selectedCreateOptionValue, type ResolvedCreateOption } from "./model";
import { useCreateOptionSelections, useCreateOptions, useServerCreateSelections } from "./store";

function CreateOptionControl({
  serverId,
  option,
  disabled,
  onClose,
}: {
  serverId: string;
  option: ResolvedCreateOption;
  disabled: boolean;
  onClose?: () => void;
}): ReactElement {
  const { presentation } = useComposerControlLayout();
  const selections = useServerCreateSelections(serverId);
  const select = useCreateOptionSelections((state) => state.select);
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const value = selectedCreateOptionValue(option, selections);
  const selected = option.options.find((entry) => entry.value === value) ?? option.options[0];
  const Icon = useMemo(() => pluginIconComponent(option.icon), [option.icon]);
  const comboboxOptions = useMemo<ComboboxOption[]>(
    () =>
      option.options.map((entry) => ({
        id: entry.value,
        label: entry.label,
        ...(entry.description ? { description: entry.description } : {}),
      })),
    [option.options],
  );
  const header = useMemo(() => ({ title: option.label }), [option.label]);
  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) onClose?.();
    },
    [onClose],
  );
  const handlePress = useCallback(() => setOpen((current) => !current), []);
  const handleSelect = useCallback(
    (id: string) => {
      select(serverId, option.key, id);
      handleOpenChange(false);
    },
    [handleOpenChange, option.key, select, serverId],
  );
  return (
    <>
      <AgentControlTrigger
        ref={anchorRef}
        icon={Icon}
        surface="toolbar"
        label={option.label}
        value={selected.label}
        showToolbarLabel={presentation.showModeLabel}
        showCaret={presentation.showCarets}
        open={open}
        disabled={disabled}
        onPress={handlePress}
        accessibilityLabel={`${option.label}: ${selected.label}`}
        testID={`create-option-${option.key}`}
      />
      <Combobox
        options={comboboxOptions}
        value={value}
        onSelect={handleSelect}
        open={open}
        onOpenChange={handleOpenChange}
        anchorRef={anchorRef}
        desktopPlacement="top-start"
        desktopMinWidth={220}
        header={header}
      />
    </>
  );
}

/** Pickers plugins add with `addCreateOption`, rendered beside the mode picker on draft composers. */
export function PluginCreateOptionControls({
  serverId,
  disabled = false,
  onClose,
}: {
  serverId: string | null;
  disabled?: boolean;
  onClose?: () => void;
}): ReactElement | null {
  const options = useCreateOptions(serverId ?? "");
  if (!serverId || options.length === 0) return null;
  return (
    <>
      {options.map((option) => (
        <CreateOptionControl
          key={option.key}
          serverId={serverId}
          option={option}
          disabled={disabled}
          onClose={onClose}
        />
      ))}
    </>
  );
}
