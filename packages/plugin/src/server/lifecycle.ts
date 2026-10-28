import type { AgentToolDefinition } from "./agent-tools.js";
import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentTimelineItem,
  AgentSessionConfig,
} from "@getpaseo/protocol/agent-types";
import type { PaseoApi } from "@getpaseo/client";
import type { WorkspaceCreateRequest } from "@getpaseo/protocol/messages";

export interface PluginHookContext {
  paseo: PaseoApi;
  signal: AbortSignal;
}

export interface PluginHookWorkspace {
  id: string;
  projectId: string;
  cwd: string;
  name: string | null;
  archivedAt: string | null;
}

export interface PluginHookWorktree {
  path: string;
  branch: string;
  sourceCheckout: string;
}

export interface PluginHookAgent {
  id: string;
  workspaceId: string | null;
  parentAgentId: string | null;
  provider: string;
  cwd: string;
  title: string | null;
  /** The agent's labels. `parentAgentId` is derived from them. */
  labels: Record<string, string>;
}

export interface PluginSessionOpenRequest {
  agentId: string;
  workspaceId: string | null;
  provider: string;
  cwd: string;
  reason: "create" | "resume" | "refresh" | "import";
  purpose: "interactive" | "history";
  readonly title: string | null;
  readonly labels: Readonly<Record<string, string>>;
  tools: AgentToolDefinition[];
  env: Record<string, string>;
  mcpServers: NonNullable<AgentSessionConfig["mcpServers"]>;
}

export type PluginTurnOutcome =
  | { kind: "completed" }
  | { kind: "failed"; error: { message: string; code?: string } }
  | { kind: "canceled"; reason: string };

export interface PluginHookEvents {
  "agent.turn.before": { agent: PluginHookAgent; turnId: string | null };
  "agent.turn.after": {
    agent: PluginHookAgent;
    turnId: string | null;
    outcome: PluginTurnOutcome;
    /**
     * @deprecated Always empty. Fetch history on demand with
     * context.paseo.agents.ref(agent.id).timeline.refetch({ direction: "tail", limit: 20 }).
     */
    timeline: readonly AgentTimelineItem[];
  };
  "agent.permission.before": { agent: PluginHookAgent; request: AgentPermissionRequest };
  "agent.permission.after": {
    agent: PluginHookAgent;
    requestId: string;
    resolution: AgentPermissionResponse;
  };
  "agent.archive.after": { agent: PluginHookAgent; archivedAt: string };
  "agent.create.after": { agent: PluginHookAgent };
  "agent.close.after": { agent: PluginHookAgent };
  "workspace.create.after": { workspace: PluginHookWorkspace };
  "workspace.archive.after": { workspace: PluginHookWorkspace };
}

export interface PluginHookRequests {
  "agent.create.before": {
    config: AgentSessionConfig;
    env?: Record<string, string>;
    /**
     * Values the user picked in plugin-contributed create options
     * (`addCreateOption`), keyed by plugin id, then option id.
     */
    pluginOptions?: Record<string, Record<string, string>>;
    /**
     * Read-only context: the labels the agent is created with and the agent that created it as a
     * subagent (null for a top-level agent). A hook cannot change them; edits are ignored.
     */
    labels: Record<string, string>;
    parentAgentId: string | null;
    /** The workspace the agent is created in, or null when it has none. Read-only. */
    workspaceId: string | null;
    /** The id of that workspace's runtime, or null for a workspace on the daemon host. Read-only. */
    runtimeId: string | null;
  };
  /**
   * Runs before a user or agent prompt is delivered to the provider, for every provider. Return the
   * request with `prepend` set to add content in front of the prompt as a separate, marked block;
   * the user's text is never edited and the timeline still shows only what was sent. Hooks of
   * several plugins compose in plugin-ID order (a later one sees the earlier `prepend`). Only
   * `prepend` can change. A hook that throws or exceeds its time budget is skipped: the prompt is
   * always delivered.
   */
  "agent.prompt.before": {
    agentId: string;
    labels: Record<string, string>;
    parentAgentId: string | null;
    /**
     * The prompt's text, unwrapped from the agent-message envelope; image and attachment blocks are
     * not included. Slash commands never reach the hook.
     */
    prompt: string;
    /** Who sent it: the user, or another agent (`sourceAgentId` names it). */
    source: "user" | "agent";
    sourceAgentId: string | null;
    /** First prompt delivered to this provider session (a resumed session counts as new). */
    isFirstPrompt: boolean;
    prepend?: string;
  };
  "agent.open.before": PluginSessionOpenRequest;
  "workspace.create.before": Omit<WorkspaceCreateRequest, "type" | "requestId">;
}

export type PluginHooks = {
  [Name in keyof PluginHookRequests]: {
    request: PluginHookRequests[Name];
    result: PluginHookRequests[Name];
  };
} & { [Name in keyof PluginHookEvents]: { payload: PluginHookEvents[Name] } } & {
  "worktree.create.after": { payload: { worktree: PluginHookWorktree } };
};

export type PluginHookPayload<Name extends keyof PluginHooks> = {
  [Key in keyof PluginHooks]: PluginHooks[Key] extends { request: infer Request }
    ? { request: Request }
    : PluginHooks[Key] extends { payload: infer Payload }
      ? Payload
      : never;
}[Name];
export type PluginHookResult<Name extends keyof PluginHooks> = {
  [Key in keyof PluginHooks]: PluginHooks[Key] extends { result: infer Result }
    ? Result | void
    : void;
}[Name];

type HookHandlers = {
  [Name in keyof PluginHooks]: (
    payload: PluginHookPayload<Name>,
    context: PluginHookContext,
  ) => Promise<PluginHookResult<Name>>;
};

export interface PluginLifecycleRegistration {
  addHook<Name extends keyof PluginHooks>(name: Name, handler: HookHandlers[Name]): () => void;
  /** @deprecated Use addHook with the renamed hook. Removed after 2027-04-30. */
  on<Name extends keyof PluginLifecycleEvents>(
    name: Name,
    handler: (
      event: PluginLifecycleEvents[Name],
      context: PluginHookContext,
    ) => void | Promise<void>,
  ): () => void;
  /** @deprecated Use addHook with the renamed hook. Removed after 2027-04-30. */
  before<Name extends keyof PluginBeforeRequests>(
    name: Name,
    handler: (
      input: { request: PluginBeforeRequests[Name] },
      context: PluginHookContext,
    ) => PluginBeforeRequests[Name] | void | Promise<PluginBeforeRequests[Name] | void>,
  ): () => void;
}

/** @internal Lifecycle policy shared by the daemon and plugin process. */
export const pluginHookRegistry = {
  "workspace.create.before": { waits: true },
  "workspace.create.after": { waits: false },
  "workspace.archive.after": { waits: false },
  "worktree.create.after": { waits: true },
  "agent.create.before": { waits: true },
  "agent.create.after": { waits: false },
  "agent.prompt.before": { waits: true },
  "agent.open.before": { waits: true },
  "agent.close.after": { waits: false },
  "agent.archive.after": { waits: false },
  "agent.turn.before": { waits: false },
  "agent.turn.after": { waits: false },
  "agent.permission.before": { waits: false },
  "agent.permission.after": { waits: false },
} as const satisfies Record<keyof PluginHooks, { waits: boolean }>;

// COMPAT(pluginHookNames): added in v0.14, remove after 2027-04-30
const legacyEvents = {
  "workspace.created": "workspace.create.after",
  "workspace.archived": "workspace.archive.after",
  "agent.created": "agent.create.after",
  "agent.closed": "agent.close.after",
  "agent.archived": "agent.archive.after",
  "agent.turn_started": "agent.turn.before",
  "agent.turn_ended": "agent.turn.after",
  "agent.permission_requested": "agent.permission.before",
  "agent.permission_resolved": "agent.permission.after",
} as const;
const legacyRequests = {
  "workspace.create": "workspace.create.before",
  "agent.create": "agent.create.before",
  "agent.session_open": "agent.open.before",
  "agent.prompt": "agent.prompt.before",
} as const;
export type PluginLifecycleEvents = {
  [Name in keyof typeof legacyEvents]: PluginHookEvents[(typeof legacyEvents)[Name]];
};
export type PluginBeforeRequests = {
  [Name in keyof typeof legacyRequests]: PluginHookRequests[(typeof legacyRequests)[Name]];
};

/** @internal SDK adapter for the daemon's hook registry. */
export function createLifecycleRegistration(
  register: (
    name: keyof PluginHooks,
    handler: (input: never, context: PluginHookContext) => unknown,
  ) => () => void,
): PluginLifecycleRegistration {
  const names = new Set<string>(Object.keys(pluginHookRegistry));
  return {
    addHook(name, handler) {
      if (!names.has(name)) throw new Error(`Unknown lifecycle hook: ${name}`);
      return register(name, handler);
    },
    on(name, handler) {
      if (!Object.hasOwn(legacyEvents, name)) throw new Error(`Unknown lifecycle event: ${name}`);
      return register(legacyEvents[name], handler);
    },
    before(name, handler) {
      if (!Object.hasOwn(legacyRequests, name)) throw new Error(`Unknown before hook: ${name}`);
      return register(legacyRequests[name], handler);
    },
  };
}
