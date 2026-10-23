import type { PluginText } from "../text.js";
import type { ComponentType } from "react";
import type { PaseoApi } from "@getpaseo/client";
import type { AgentTimelineItem, JsonValue } from "@getpaseo/protocol/agent-types";
import type { ZodType, input as ZodInput, output as ZodOutput } from "zod";
import type { PluginFile } from "./file.js";
import type { PluginRpcContract } from "../rpc.js";
import type {
  PluginButtonRegistration,
  PluginHeaderButtonContribution,
  PluginComposerPillContribution,
} from "./buttons.js";
import type {
  PluginTheme,
  PluginWorkspaceSnapshot,
  PluginAgentSnapshot,
  PluginThemeContribution,
  PluginAttachmentSourceContribution,
  PluginTimelineTransformResult,
  PluginCleanup,
} from "../contracts.js";
import type { PluginIconProps, PluginSerializableIcon } from "../icons.js";

export interface PluginHostProps {
  theme: PluginTheme;
  host: {
    id: string;
    label: string;
  };
  layout: {
    compact: boolean;
    platform: "ios" | "android" | "web";
  };
}

interface PluginNavigableHostProps extends PluginHostProps {
  /** Client-owned navigation. Undefined on older hosts; hide dependent affordances when absent. */
  readonly navigation?: {
    /** Present only on Electron. The browser runs locally; serverId selects workspace ownership. */
    readonly openBrowser?: (input: {
      readonly url: string;
      readonly workspaceId: string;
      readonly serverId?: string;
    }) => void;
    readonly openAgent: (input: { readonly agentId: string; readonly serverId?: string }) => void;
    readonly openWorkspace: (input: {
      readonly workspaceId: string;
      readonly serverId?: string;
    }) => void;
  };
}

/** String keys and values: params travel in the screen's URL. */
export type PluginScreenParams = Record<string, string>;

export interface PluginOpenScreenInput {
  screenId: string;
  params?: PluginScreenParams;
}

export interface PluginScreenLocation {
  screenId: string;
  params: PluginScreenParams;
}

export interface PluginSurfaceProps extends PluginNavigableHostProps {}

export interface PluginScreenProps extends PluginSurfaceProps {
  /** The params the screen was opened with; `{}` when none. */
  params: PluginScreenParams;
}

export interface PluginPopoverProps extends PluginHostProps {
  close(): void;
  openScreen(input: PluginOpenScreenInput): void;
}

export interface PluginSidebarItemProps extends PluginHostProps {
  /** This plugin's screen open on this item's host, with its params, else null. */
  currentScreen: PluginScreenLocation | null;
  openScreen(input: PluginOpenScreenInput): void;
  /** Anchored to the item on wide layouts; a bottom sheet on compact layouts. */
  openPopover(Content: ComponentType<PluginPopoverProps>): void;
}

export interface PluginSidebarItemContribution<Text extends PluginText = string> {
  id: string;
  /** Settings row label, accessibility label, and default label for SidebarRow. */
  title: Text;
  Component: ComponentType<PluginSidebarItemProps>;
}

/**
 * A Lucide icon name, inline SVG markup, or a component. Components receive the surface's size
 * and color; buttons widen the props with their host and target context.
 */
export type PluginIcon<Props extends PluginIconProps = PluginIconProps> =
  | PluginSerializableIcon
  | ComponentType<Props>;

export type PluginPanelLocation = "workspace" | "explorer";

export interface PluginOpenPanelOptions {
  location?: PluginPanelLocation;
}

interface PluginWorkspacePanelBase<Text extends PluginText = string> {
  id: string;
  title: Text;
  icon: PluginIcon;
  locations?: readonly PluginPanelLocation[];
}

export interface PluginTab {
  /** Shows the tab's unsaved dot and asks before closing. */
  setModified(modified: boolean): void;
  /** Opaque persisted JSON. Undefined until written; the panel validates it. */
  readonly state: unknown;
  setState(state: JsonValue): void;
}

export interface PluginPanelProps<Params> extends PluginNavigableHostProps {
  workspaceId: string;
  readonly params: Readonly<Params>;
  revision: number;
  tab: PluginTab;
}
export interface PluginWorkspacePanelParams {}
export interface PluginAgentPanelParams {
  readonly agentId: string;
}
export interface PluginFilePanelParams {
  readonly path: string;
  readonly lineStart?: number;
  readonly lineEnd?: number;
}
export interface PluginWorkspacePanelProps extends PluginPanelProps<PluginWorkspacePanelParams> {
  // COMPAT(pluginPanelFlatProps): added in v0.13.0, remove after 2027-04-23
  /** @deprecated Use the panel registration to select the context. */
  context: "workspace";
}
export interface PluginAgentPanelProps extends PluginPanelProps<PluginAgentPanelParams> {
  // COMPAT(pluginPanelFlatProps): added in v0.13.0, remove after 2027-04-23
  /** @deprecated Use the panel registration to select the context. */
  context: "agent";
  // COMPAT(pluginPanelFlatProps): added in v0.13.0, remove after 2027-04-23
  /** @deprecated Read `params.agentId`. */
  agentId: string;
}
export interface PluginFilePanelProps extends PluginPanelProps<PluginFilePanelParams> {
  file: PluginFile;
}

export interface PluginFilePanelContribution<Text extends PluginText = string> {
  id: string;
  title: Text;
  icon: PluginIcon;
  /** Extensions without the dot, case-insensitive, and exact filenames. */
  files: { extensions: readonly string[]; filenames?: readonly string[] };
  Component: ComponentType<PluginFilePanelProps>;
}

export interface PluginClientOpenPanelOptions extends PluginOpenPanelOptions {
  workspaceId: string;
  agentId?: string;
}

// COMPAT(pluginSidebarAliases): added in v0.11.0, remove after 2027-03-29
interface PluginClientContextAliases {
  /** @deprecated Use `addScreen`. */
  addSurface(id: string, Component: ComponentType<PluginSurfaceProps>): PluginCleanup;
  /** @deprecated Use `addSidebarHeaderItem`. */
  addSidebarItem(contribution: PluginSidebarContribution<PluginText>): PluginCleanup;
}

export interface PluginClientContext extends PluginCommandCapabilities, PluginClientContextAliases {
  readonly i18n: import("./translations.js").PluginI18n;
  /** Play a base64-encoded audio file on this client; resolves when playback ends. */
  playAudio(source: { base64: string; mimeType: string }): Promise<void>;
  addSettingsScreen(contribution: PluginSettingsScreenContribution<PluginText>): PluginCleanup;
  addScreen(contribution: PluginScreenContribution<PluginText>): PluginCleanup;
  addSidebarHeaderItem(contribution: PluginSidebarItemContribution<PluginText>): PluginCleanup;
  addSidebarFooterItem(contribution: PluginSidebarItemContribution<PluginText>): PluginCleanup;
  addAgentPanel(contribution: PluginAgentPanelContribution<PluginText>): PluginCleanup;
  addWorkspacePanel(contribution: PluginWorkspacePanelContribution<PluginText>): PluginCleanup;
  addCommandCenterItem(
    contribution: PluginCommandCenterItemContribution<PluginText>,
  ): PluginCleanup;
  addSlashCommand(contribution: PluginClientSlashCommandContribution<PluginText>): PluginCleanup;
  addHeaderButton(
    contribution: PluginHeaderButtonContribution<PluginText>,
  ): PluginButtonRegistration<PluginText>;
  addComposerPill(
    contribution: PluginComposerPillContribution<PluginText>,
  ): PluginButtonRegistration<PluginText>;
  addAttachmentSource(contribution: PluginAttachmentSourceContribution<PluginText>): PluginCleanup;
  addWorkspaceLocation(
    contribution: PluginWorkspaceLocationContribution<PluginText>,
  ): PluginCleanup;
  addCreateOption(contribution: PluginCreateOptionContribution<PluginText>): PluginCleanup;
  addTheme(contribution: PluginThemeContribution<PluginText>): PluginCleanup;
  addFilePanel(contribution: PluginFilePanelContribution<PluginText>): PluginCleanup;
  addTimelineTransformer<ItemType extends AgentTimelineItem["type"]>(
    contribution: PluginTimelineTransformerContribution<ItemType>,
  ): PluginCleanup;
  addTimelineRenderer<Schema extends ZodType>(
    contribution: PluginTimelineRendererContribution<Schema>,
  ): PluginCleanup;
  openPanel(id: string, options: PluginClientOpenPanelOptions): void;
}

/** The project a New workspace form has selected, on the host the plugin is installed on. */
export interface PluginWorkspaceLocationProject {
  id: string;
  name: string;
  /** The project's checkout directory on that host. */
  directory: string;
}

export interface PluginWorkspaceLocationAvailabilityContext {
  hostId: string;
  project: PluginWorkspaceLocationProject;
}

export interface PluginWorkspaceLocationSettingsProps extends PluginHostProps {
  project: PluginWorkspaceLocationProject;
  /** The current settings: `defaultValue` until `onChange` is called. */
  value: unknown;
  onChange(value: unknown): void;
  /** True while the workspace is being created. */
  disabled: boolean;
}

export interface PluginWorkspaceLocationCreateContext {
  hostId: string;
  project: PluginWorkspaceLocationProject;
  /** The settings as last passed to `onChange`, else `defaultValue`. */
  settings: unknown;
  /** Stable for one New workspace draft; a retry of the same draft passes the same key. */
  idempotencyKey: string;
  /** The text the user typed. Paseo still sends it to the first agent. */
  prompt: string;
  /**
   * A short random name, such as `brave-otter-12`, stable for one New workspace draft. It is the
   * slug Paseo gives a new worktree, so a plugin can name its environment the same way, for
   * example `${project.name}-${slug}`, without asking the user.
   */
  slug: string;
  /**
   * What the user chose in the branch picker, as New worktree receives it. Null when the picker
   * is not shown (`usesRef: false`) or the project has no checkout to choose from.
   */
  ref: PluginWorkspaceLocationRef | null;
  /**
   * The agent the user configured in the composer, so the plugin can start its agent the same
   * way. Null when the workspace is created without an agent (an empty workspace).
   */
  agent: PluginWorkspaceLocationAgent | null;
}

/** The composer's agent choices for the first agent. */
export interface PluginWorkspaceLocationAgent {
  provider: string;
  model?: string;
  thinkingOptionId?: string;
  modeId?: string;
  featureValues?: Record<string, unknown>;
}

/** The branch picker's choice. */
export interface PluginWorkspaceLocationRef {
  /** `branch-off` starts a new branch from `refName`; `checkout` opens an existing change request. */
  action: "branch-off" | "checkout";
  /** The base ref (for example `refs/heads/main`), or a change request's head branch. */
  refName?: string;
  /** Set when the user picked a pull or merge request. */
  changeRequest?: { forge: string; number: number; projectPath?: string };
}

export interface PluginWorkspaceLocationResult {
  /** A workspace that exists on the host. */
  workspaceId: string;
  /**
   * An agent the plugin already started in that workspace. Without it, Paseo starts the first
   * agent there the way it does for a built-in location.
   */
  agentId?: string;
}

/**
 * An option in the New workspace form's location dropdown, beside Local and New worktree. Picking
 * it hands workspace creation to the plugin.
 */
export interface PluginWorkspaceLocationContribution<Text extends PluginText = string> {
  id: string;
  title: Text;
  icon: PluginIcon;
  /** Offer the option only for some projects. Default: always. A throw hides it. */
  isAvailable?(context: PluginWorkspaceLocationAvailabilityContext): boolean;
  /** Rendered as a field in the form while this option is selected. Optional: name the environment from `slug` instead of asking. */
  Settings?: ComponentType<PluginWorkspaceLocationSettingsProps>;
  defaultValue?: unknown;
  /** Show the branch picker, as New worktree does. Default true; set false when no ref applies. */
  usesRef?: boolean;
  /** Runs on this client in place of the built-in creation. Throw to show the user an error. */
  createWorkspace(
    context: PluginWorkspaceLocationCreateContext,
  ): Promise<PluginWorkspaceLocationResult>;
}

export type PluginClientContribution = (client: PluginClientContext) => PluginCleanup;

export type PluginWorkspacePanelContribution<Text extends PluginText = string> =
  | (PluginWorkspacePanelBase<Text> & {
      // COMPAT(pluginPanelFlatProps): added in v0.13.0, remove after 2027-04-23
      /** @deprecated Omit context. */
      context?: "workspace";
      Component: ComponentType<PluginWorkspacePanelProps>;
    })
  | (PluginWorkspacePanelBase<Text> & {
      // COMPAT(pluginAgentPanelAlias): added in v0.13.0, remove after 2027-04-23
      /** @deprecated Register with `addAgentPanel`. */
      context: "agent";
      Component: ComponentType<PluginAgentPanelProps>;
    });

export interface PluginAgentPanelContribution<
  Text extends PluginText = string,
> extends PluginWorkspacePanelBase<Text> {
  Component: ComponentType<PluginAgentPanelProps>;
}

export interface PluginSettingsScreenContribution<Text extends PluginText = string> {
  id: string;
  title: Text;
  icon: PluginIcon;
  Component: ComponentType<PluginSurfaceProps>;
}

/** The screen header's title: fixed, or derived from the params the screen was opened with. */
export type PluginScreenTitle<Text extends PluginText = string> =
  | Text
  | ((params: PluginScreenParams) => Text);

export interface PluginScreenContribution<Text extends PluginText = string> {
  id: string;
  title: PluginScreenTitle<Text>;
  Component: ComponentType<PluginScreenProps>;
}

export interface PluginSurfaceContribution {
  id: string;
  Component: ComponentType<PluginSurfaceProps>;
}

/** @deprecated Use `PluginSidebarItemContribution` with `addSidebarHeaderItem`. */
export interface PluginSidebarContribution<Text extends PluginText = string> {
  id: string;
  title: Text;
  icon: PluginIcon;
  surface: string;
}

export type PluginTimelineTransformerContribution<
  ItemType extends AgentTimelineItem["type"] = AgentTimelineItem["type"],
> = ItemType extends AgentTimelineItem["type"]
  ? {
      id: string;
      query: {
        itemType: ItemType;
      };
      transform(input: {
        item: Extract<AgentTimelineItem, { type: ItemType }>;
        phase: "streaming" | "complete";
      }): PluginTimelineTransformResult | undefined;
    }
  : never;

export interface PluginTimelineItemProps<Data = unknown> extends PluginHostProps {
  agentId: string;
  item: {
    type: "plugin";
    kind: string;
    version: number;
    data: Data;
  };
  timestamp: Date;
}

export interface PluginTimelineRendererContribution<Schema extends ZodType = ZodType> {
  kind: string;
  version: number;
  schema: Schema;
  Component: ComponentType<PluginTimelineItemProps<ZodOutput<Schema>>>;
}

export interface PluginCommandCapabilities {
  paseo: PaseoApi;
  rpc<InputSchema extends ZodType, OutputSchema extends ZodType>(
    contract: PluginRpcContract<InputSchema, OutputSchema>,
    input: ZodInput<InputSchema>,
  ): Promise<ZodOutput<OutputSchema>>;
  openScreen(input: PluginOpenScreenInput): void;
  /** @deprecated Use `openScreen`. */
  openSurface(id: string): void;
  openSettings(id: string): void;
}

export interface PluginGlobalCommandContext extends PluginCommandCapabilities {
  context: "global";
}

export interface PluginWorkspaceCommandContext extends PluginCommandCapabilities {
  context: "workspace";
  workspace: PluginWorkspaceSnapshot;
  openPanel(id: string, options?: PluginOpenPanelOptions): void;
}

export interface PluginAgentCommandContext extends PluginCommandCapabilities {
  context: "agent";
  workspace: PluginWorkspaceSnapshot;
  agent: PluginAgentSnapshot;
  openPanel(id: string, options?: PluginOpenPanelOptions): void;
}

interface PluginCommandCenterItemBase<Text extends PluginText = string> {
  id: string;
  title: Text;
  icon: PluginIcon;
  keywords?: readonly string[];
}

export type PluginCommandCenterItemContribution<Text extends PluginText = string> =
  | (PluginCommandCenterItemBase<Text> & {
      context: "global";
      onSelect(context: PluginGlobalCommandContext): void | Promise<void>;
    })
  | (PluginCommandCenterItemBase<Text> & {
      context: "workspace";
      onSelect(context: PluginWorkspaceCommandContext): void | Promise<void>;
    })
  | (PluginCommandCenterItemBase<Text> & {
      context: "agent";
      onSelect(context: PluginAgentCommandContext): void | Promise<void>;
    });

interface PluginClientSlashCommandBase<Text extends PluginText = string> {
  name: string;
  description: Text;
  argumentHint: Text;
}

export type PluginClientSlashCommandContribution<Text extends PluginText = string> =
  | (PluginClientSlashCommandBase<Text> & {
      context: "workspace";
      onSubmit(context: PluginWorkspaceCommandContext & { args: string }): void | Promise<void>;
    })
  | (PluginClientSlashCommandBase<Text> & {
      context: "agent";
      onSubmit(context: PluginAgentCommandContext & { args: string }): void | Promise<void>;
    });

/**
 * A picker on the create composers (New workspace and new agent). The chosen
 * value is held by the host until creation, then handed to `before("agent.create")`
 * hooks as `request.pluginOptions[pluginId][id]`. Same select shape as the
 * provider composer controls, for plugins that are not providers.
 */
export interface PluginCreateOptionContribution<Text extends PluginText = string> {
  /** Unique within the plugin. */
  id: string;
  label: Text;
  icon: PluginSerializableIcon;
  description?: Text;
  options: ReadonlyArray<{ value: string; label: Text; description?: Text }>;
  /** Must match an option value. Defaults to the first option. */
  defaultValue?: string;
}

export type SettingsState<Schema extends ZodType> = (
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "invalid"; error: string; revision: string }
  | { status: "ready"; values: ZodOutput<Schema>; revision: string }
) & {
  saving: boolean;
  saveError: string | null;
  /** Save an entire document against the revision currently displayed. Never throws. */
  save(values: ZodOutput<Schema>, revision: string): Promise<boolean>;
  reset(): Promise<boolean>;
  reload(): Promise<void>;
};
