import { isDeepStrictEqual } from "node:util";
import {
  serializeAgentTool,
  agentToolMetadataSchema,
  type SessionOpenWireRequest,
  type PluginAgentTools,
} from "../agent-tools.js";
import type { AgentToolDefinition } from "@getpaseo/plugin/server";
import type { AgentStreamEvent } from "../../agent/agent-sdk-types.js";
import { z } from "zod";
import { CreateAgentRequestMessageSchema } from "@getpaseo/protocol/messages";
import type {
  PluginHookAgent,
  PluginHookContext,
  PluginLifecycleRegistration,
} from "@getpaseo/plugin/server";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import type {
  PluginBeforeRequests,
  PluginHookWorkspace,
  PluginLifecycleEvents,
} from "@getpaseo/plugin/server";
import { WorkspaceCreateRequestSchema } from "@getpaseo/protocol/messages";
import type { PersistedWorkspaceRecord } from "../../workspace-registry.js";

export type PluginWireBeforeRequests = Omit<PluginBeforeRequests, "agent.session_open"> & {
  "agent.session_open": SessionOpenWireRequest;
};

/** Daemon-only results; ownership never crosses the plugin process boundary. */
export type PluginBeforeResults = PluginWireBeforeRequests & {
  "agent.session_open": SessionOpenWireRequest & { mcpServerOwners?: Record<string, string> };
};

export const lifecycleEventNames = [
  "agent.created",
  "agent.closed",
  "agent.turn_started",
  "agent.turn_ended",
  "agent.permission_requested",
  "agent.permission_resolved",
  "agent.archived",
  "workspace.created",
  "workspace.archived",
] as const;
export const beforeHookNames = [
  "agent.create",
  "agent.prompt",
  "agent.session_open",
  "workspace.create",
] as const;

/** Before hooks whose failure must never block the operation: a failing hook is skipped. */
export const isolatedBeforeHookNames: ReadonlySet<string> = new Set(["agent.prompt"]);

/** The most a hook may prepend to one prompt. */
export const MAX_PROMPT_PREPEND_CHARS = 16_000;

const beforeSchemas = {
  "agent.create": CreateAgentRequestMessageSchema.pick({
    config: true,
    env: true,
    pluginOptions: true,
  })
    // A hook may return a request without them; they are restored from the original.
    .extend({
      labels: z.record(z.string(), z.string()).optional(),
      parentAgentId: z.string().nullable().optional(),
      workspaceId: z.string().nullable().optional(),
      runtimeId: z.string().nullable().optional(),
    })
    .strict(),
  "agent.prompt": z
    .object({
      agentId: z.string(),
      labels: z.record(z.string(), z.string()),
      parentAgentId: z.string().nullable(),
      prompt: z.string(),
      source: z.enum(["user", "agent"]),
      sourceAgentId: z.string().nullable(),
      isFirstPrompt: z.boolean(),
      prepend: z.string().optional(),
    })
    .strict(),
  "agent.session_open": z
    .object({
      agentId: z.string(),
      workspaceId: z.string().nullable(),
      provider: z.string(),
      cwd: z.string(),
      reason: z.enum(["create", "resume", "refresh", "import"]),
      purpose: z.enum(["interactive", "history"]),
      title: z.string().nullable(),
      labels: z.record(z.string(), z.string()),
      tools: z.array(agentToolMetadataSchema),
      env: z.record(z.string(), z.string()),
      mcpServers: CreateAgentRequestMessageSchema.shape.config.shape.mcpServers.unwrap(),
    })
    .strict(),
  "workspace.create": WorkspaceCreateRequestSchema.omit({ type: true, requestId: true }).strict(),
};

const sessionOpenLocalResultSchema = beforeSchemas["agent.session_open"].extend({
  tools: z.array(
    z.custom<AgentToolDefinition>(
      (tool) =>
        typeof tool === "object" &&
        tool !== null &&
        "input" in tool &&
        "execute" in tool &&
        typeof tool.execute === "function",
    ),
  ),
});

export interface PluginLifecycle {
  emit<Name extends keyof PluginLifecycleEvents>(
    name: Name,
    event: PluginLifecycleEvents[Name],
  ): void;
  before<Name extends keyof PluginWireBeforeRequests>(
    name: Name,
    request: PluginWireBeforeRequests[Name],
  ): Promise<PluginBeforeResults[Name]>;
}

export function validateBeforeRequest<Name extends keyof PluginWireBeforeRequests>(
  name: Name,
  value: unknown,
): PluginWireBeforeRequests[Name] {
  return beforeSchemas[name].parse(value) as PluginWireBeforeRequests[Name];
}

export function describeHookWorkspace(workspace: PersistedWorkspaceRecord): PluginHookWorkspace {
  return {
    id: workspace.workspaceId,
    projectId: workspace.projectId,
    cwd: workspace.cwd,
    name: workspace.title,
    archivedAt: workspace.archivedAt,
  };
}

export function describeHookAgent(agent: {
  id: string;
  workspaceId?: string;
  provider: string;
  cwd: string;
  title?: string | null;
  labels: Record<string, string>;
}): PluginHookAgent {
  return {
    id: agent.id,
    workspaceId: agent.workspaceId ?? null,
    parentAgentId: agent.labels[PARENT_AGENT_ID_LABEL] ?? null,
    provider: agent.provider,
    cwd: agent.cwd,
    title: agent.title ?? null,
    labels: agent.labels,
  };
}

export function publishAgentStream(
  lifecycle: PluginLifecycle,
  agent: PluginHookAgent,
  event: AgentStreamEvent,
): void {
  if (event.type === "turn_started") {
    lifecycle.emit("agent.turn_started", { agent, turnId: event.turnId ?? null });
  } else if (event.type === "turn_completed") {
    lifecycle.emit("agent.turn_ended", {
      agent,
      turnId: event.turnId ?? null,
      timeline: [],
      outcome: { kind: "completed" },
    });
  } else if (event.type === "turn_failed") {
    lifecycle.emit("agent.turn_ended", {
      agent,
      turnId: event.turnId ?? null,
      timeline: [],
      outcome: { kind: "failed", error: { message: event.error, code: event.code } },
    });
  } else if (event.type === "turn_canceled") {
    lifecycle.emit("agent.turn_ended", {
      agent,
      turnId: event.turnId ?? null,
      timeline: [],
      outcome: { kind: "canceled", reason: event.reason },
    });
  } else if (event.type === "permission_requested") {
    lifecycle.emit("agent.permission_requested", { agent, request: event.request });
  } else if (event.type === "permission_resolved") {
    lifecycle.emit("agent.permission_resolved", {
      agent,
      requestId: event.requestId,
      resolution: event.resolution,
    });
  }
}

export function validateBeforeResult<Name extends keyof PluginWireBeforeRequests>(
  name: Name,
  input: PluginWireBeforeRequests[Name],
  output: unknown,
): PluginWireBeforeRequests[Name] {
  const result = validateBeforeRequest(name, output);
  if (name === "agent.session_open") {
    const previous = beforeSchemas["agent.session_open"].parse(input);
    const next = beforeSchemas["agent.session_open"].parse(result);
    if (
      previous.agentId !== next.agentId ||
      previous.workspaceId !== next.workspaceId ||
      previous.provider !== next.provider ||
      previous.cwd !== next.cwd ||
      previous.reason !== next.reason ||
      previous.purpose !== next.purpose ||
      previous.title !== next.title ||
      !isDeepStrictEqual(previous.labels, next.labels)
    ) {
      throw new Error("agent.session_open hooks can only change env, tools, and mcpServers");
    }
  }
  if (name === "agent.prompt") {
    const previous = beforeSchemas["agent.prompt"].parse(input);
    const next = beforeSchemas["agent.prompt"].parse(result);
    if (next.prepend !== undefined && next.prepend.length > MAX_PROMPT_PREPEND_CHARS) {
      throw new Error(`agent.prompt prepend exceeds ${MAX_PROMPT_PREPEND_CHARS} characters`);
    }
    // Only `prepend` is editable; everything else stays as the daemon sent it.
    return { ...previous, prepend: next.prepend } as PluginWireBeforeRequests[Name];
  }
  if (name === "agent.create") {
    const previous = beforeSchemas["agent.create"].parse(input);
    const next = beforeSchemas["agent.create"].parse(result);
    if (previous.config.cwd !== next.config.cwd) {
      throw new Error("agent.create hooks cannot change the workspace directory");
    }
    // The creation context is read-only: whatever a hook returns, the next hook and the daemon
    // see the original labels and parent.
    return {
      ...result,
      labels: previous.labels,
      parentAgentId: previous.parentAgentId,
      workspaceId: previous.workspaceId,
      runtimeId: previous.runtimeId,
    } as PluginWireBeforeRequests[Name];
  }
  return result;
}

type Handler = (input: unknown, context: PluginHookContext) => unknown;

export class PluginHookHandlers implements PluginLifecycleRegistration {
  private readonly events = new Map<string, Set<Handler>>();
  private readonly transforms = new Map<string, Set<Handler>>();
  private readonly active = new Map<string, AbortController>();

  private readonly changed: () => void;

  private readonly agentTools: PluginAgentTools | undefined;

  constructor(changed: () => void, agentTools?: PluginAgentTools) {
    this.agentTools = agentTools;
    this.changed = changed;
  }

  readonly on: PluginLifecycleRegistration["on"] = (name, handler) => {
    if (!lifecycleEventNames.includes(name)) {
      throw new Error(`Unknown lifecycle event: ${name}`);
    }
    return this.register(this.events, name, handler as Handler);
  };

  readonly before: PluginLifecycleRegistration["before"] = (name, handler) => {
    if (!beforeHookNames.includes(name)) {
      throw new Error(`Unknown before hook: ${name}`);
    }
    return this.register(this.transforms, name, handler as Handler);
  };

  catalog(): { events: string[]; before: string[] } {
    return { events: [...this.events.keys()], before: [...this.transforms.keys()] };
  }

  async invoke(
    id: string,
    kind: "event" | "before",
    name: string,
    input: unknown,
    paseo: PluginHookContext["paseo"],
  ): Promise<unknown> {
    const controller = new AbortController();
    this.active.set(id, controller);
    try {
      if (kind === "before") {
        if (
          !beforeHookNames.includes(
            name as keyof import("@getpaseo/plugin/server").PluginBeforeRequests,
          )
        ) {
          throw new Error(`Unknown before hook: ${name}`);
        }
        const hookName = name as keyof import("@getpaseo/plugin/server").PluginBeforeRequests;
        if (hookName === "agent.session_open") {
          return await this.openSession(input, { paseo, signal: controller.signal });
        }
        let request = validateBeforeRequest(hookName, input);
        for (const handler of this.transforms.get(name) ?? []) {
          controller.signal.throwIfAborted();
          const result = await handler(
            { request: structuredClone(request) },
            { paseo, signal: controller.signal },
          );
          if (result !== undefined) request = validateBeforeResult(hookName, request, result);
        }
        return request;
      }
      for (const handler of this.events.get(name) ?? []) {
        controller.signal.throwIfAborted();
        try {
          await handler(structuredClone(input), { paseo, signal: controller.signal });
        } catch (error) {
          console.error(`Lifecycle hook ${name} failed`, error);
        }
      }
      return null;
    } finally {
      this.active.delete(id);
    }
  }

  private async openSession(
    input: unknown,
    context: PluginHookContext,
  ): Promise<SessionOpenWireRequest> {
    let request = validateBeforeRequest("agent.session_open", input);
    this.agentTools?.detach(request.agentId);
    let tools: AgentToolDefinition[] = [];
    for (const handler of this.transforms.get("agent.session_open") ?? []) {
      context.signal.throwIfAborted();
      const result = await handler(
        { request: { ...structuredClone(request), tools: [...tools] } },
        context,
      );
      if (result === undefined) continue;
      const local = sessionOpenLocalResultSchema.parse(result);
      const metadata = local.tools.map(serializeAgentTool);
      request = validateBeforeResult("agent.session_open", request, { ...local, tools: metadata });
      tools = local.tools;
    }
    context.signal.throwIfAborted();
    if (request.purpose === "history") {
      request.tools = [];
      request.mcpServers = {};
    } else this.agentTools?.attach(request.agentId, tools);
    return request;
  }

  cancel(id: string): void {
    this.active.get(id)?.abort();
  }

  close(): void {
    for (const controller of this.active.values()) {
      controller.abort();
    }
    this.events.clear();
    this.transforms.clear();
  }

  private register(
    registry: Map<string, Set<Handler>>,
    name: string,
    handler: Handler,
  ): () => void {
    let handlers = registry.get(name);
    if (!handlers) {
      handlers = new Set();
      registry.set(name, handlers);
    }
    handlers.add(handler);
    this.changed();
    return () => {
      if (!handlers.delete(handler)) {
        return;
      }
      if (handlers.size === 0) {
        registry.delete(name);
      }
      this.changed();
    };
  }
}
