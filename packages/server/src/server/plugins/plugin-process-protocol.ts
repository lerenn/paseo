import { UsageScopeSchema, type UsageScope } from "@getpaseo/plugin/server/usage";
import type {
  ProviderConnectRequest,
  ProviderCatalogOptions,
  ProviderEvent,
  ProviderInput,
  ProviderStatusRequest,
} from "@getpaseo/plugin/server/provider";
import {
  ProviderEventSchema,
  ProviderInputSchema,
  ProviderLaunchSchema,
} from "@getpaseo/plugin/server/provider";
import { z } from "zod";

export interface PluginProviderMetadata {
  requiresConfiguration?: boolean;
  hasCatalogCacheKey?: boolean;
  hasStatus?: boolean;
  command?: readonly [string, ...string[]];
  id: string;
  label: string;
  description?: string;
  iconPath?: string;
}

export interface PluginWorkspaceRuntimeMetadata {
  id: string;
  label: string;
  /** SVG markup, read from the plugin directory. */
  icon?: string;
  /** The runtime provides the workspace's files. */
  files?: boolean;
}

export type PluginRuntimeCallVerb =
  | "describe"
  | "create"
  | "inspect"
  | "pause"
  | "resume"
  | "destroy"
  | "reconcile"
  | "prepare"
  | "before_input"
  | "map_cwd"
  | "check_command"
  | "describe_workspace"
  | "fs.stat"
  | "fs.readdir"
  | "fs.read"
  | "fs.write"
  | "fs.mkdir"
  | "fs.rename"
  | "fs.remove"
  | "fs.copy";

export interface PluginRuntimeExecEnvelope {
  workspaceId: string;
  workspaceCwd?: string;
  options?: Record<string, unknown>;
  agentId?: string;
  provider?: string;
  purpose: "session" | "probe" | "command";
  interactive?: boolean;
  argv: string[];
  cwd?: string;
  env: Record<string, string>;
}

export interface PluginUsageSourceMetadata {
  id: string;
  label: string;
  icon?: string;
}

export type PluginProcessRequest =
  | {
      type: "provider.status";
      requestId: string;
      providerId: string;
      request: ProviderStatusRequest;
    }
  | {
      type: "initialize";
      pluginId: string;
      bundle: string;
      appVersion: string;
      pluginDirectory: string;
      settingsDirectory?: string;
    }
  | {
      type: "provider.catalog_key";
      requestId: string;
      providerId: string;
      options: ProviderCatalogOptions;
    }
  | { type: "hook"; requestId: string; kind: "event" | "before"; name: string; input: unknown }
  | { type: "hook.cancel"; requestId: string }
  | { type: "usage.fetch"; requestId: string; sourceId: string; input: unknown }
  | { type: "usage.discover"; requestId: string; sourceId: string; scope: UsageScope }
  | { type: "invoke"; requestId: string; method: string; input: unknown }
  | {
      type: "provider.connect";
      providerId: string;
      connectionId: string;
      request: ProviderConnectRequest;
    }
  | {
      type: "provider.send";
      connectionId: string;
      acceptanceId: string;
      input: ProviderInput;
    }
  | { type: "provider.close"; connectionId: string }
  | {
      type: "runtime.call";
      requestId: string;
      runtimeId: string;
      verb: PluginRuntimeCallVerb;
      input: unknown;
    }
  | {
      type: "runtime.activity";
      runtimeId: string;
      workspaceId: string;
      agentId: string;
      activity: string;
      options?: Record<string, unknown>;
    }
  | {
      type: "runtime.exec.start";
      execId: string;
      runtimeId: string;
      request: PluginRuntimeExecEnvelope;
    }
  | { type: "runtime.exec.abort"; execId: string }
  | { type: "runtime.exec.stdin"; execId: string; data: Uint8Array | null }
  | { type: "runtime.exec.signal"; execId: string; signal: string }
  | { type: "shutdown" }
  | { type: "paseo_frame"; data: string | Uint8Array; isBinary: boolean }
  | { type: "paseo_close" };

export type PluginProcessMessage =
  | { type: "settings.changed"; settingsId: string }
  | { type: "hooks.changed"; hooks: { events: string[]; before: string[] } }
  | {
      type: "ready";
      methods: string[];
      providers: PluginProviderMetadata[];
      usageSources?: PluginUsageSourceMetadata[];
      workspaceRuntimes?: PluginWorkspaceRuntimeMetadata[];
      hooks?: { events: string[]; before: string[] };
    }
  | { type: "result"; requestId: string; output: unknown }
  | { type: "error"; requestId: string; error: string }
  | { type: "fatal"; error: string }
  | {
      type: "provider.connected";
      connectionId: string;
      version: number;
      capabilities: readonly string[];
    }
  | { type: "provider.connect_failed"; connectionId: string; error: string }
  | { type: "provider.accepted"; connectionId: string; acceptanceId: string }
  | {
      type: "provider.rejected";
      connectionId: string;
      acceptanceId: string;
      error: string;
    }
  | { type: "provider.event"; connectionId: string; event: ProviderEvent }
  | { type: "provider.closed"; connectionId: string; error?: string }
  | {
      type: "runtime.notice";
      runtimeId: string;
      workspaceId: string;
      level: string;
      message: string;
    }
  | { type: "runtime.exec.started"; execId: string }
  | { type: "runtime.exec.stdout"; execId: string; data: Uint8Array }
  | { type: "runtime.exec.stderr"; execId: string; data: Uint8Array }
  | {
      type: "runtime.exec.exit";
      execId: string;
      code: number | null;
      signal: string | null;
      reason: "exited" | "runtime-lost" | "suspended";
      message?: string;
    }
  | { type: "runtime.exec.failed"; execId: string; error: string }
  | { type: "paseo_frame"; data: string | Uint8Array; isBinary: boolean }
  | { type: "paseo_close" };

const hooksSchema = z.object({ events: z.array(z.string()), before: z.array(z.string()) }).strict();

const providerMetadataSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
    iconPath: z.string().optional(),
    requiresConfiguration: z.boolean().optional(),
    hasCatalogCacheKey: z.boolean().optional(),
    hasStatus: z.boolean().optional(),
    command: z.tuple([z.string().min(1)], z.string()).optional(),
  })
  .strict();
const usageSourceMetadataSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    icon: z.string().optional(),
  })
  .strict();
const providerConnectRequestSchema = z
  .object({
    launch: ProviderLaunchSchema.optional(),
    versions: z.array(z.number().int().positive()),
    capabilities: z.array(z.string()),
  })
  .strict();
const frameFields = {
  data: z.union([z.string(), z.instanceof(Uint8Array)]),
  isBinary: z.boolean(),
};

export const PluginProcessRequestSchema: z.ZodType<PluginProcessRequest> = z.discriminatedUnion(
  "type",
  [
    z
      .object({
        type: z.literal("provider.status"),
        requestId: z.string().min(1),
        providerId: z.string().min(1),
        request: z.object({ launch: ProviderLaunchSchema.optional() }).strict(),
      })
      .strict(),
    z
      .object({
        type: z.literal("initialize"),
        pluginId: z.string().min(1),
        bundle: z.string(),
        appVersion: z.string(),
        pluginDirectory: z.string(),
        settingsDirectory: z.string().optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("provider.catalog_key"),
        requestId: z.string().min(1),
        providerId: z.string().min(1),
        options: z.discriminatedUnion("scope", [
          z
            .object({
              scope: z.literal("global"),
              force: z.boolean().optional(),
              launch: ProviderLaunchSchema.optional(),
            })
            .strict(),
          z
            .object({
              scope: z.literal("workspace"),
              cwd: z.string(),
              force: z.boolean().optional(),
              launch: ProviderLaunchSchema.optional(),
            })
            .strict(),
        ]),
      })
      .strict(),
    z
      .object({
        type: z.literal("hook"),
        requestId: z.string(),
        kind: z.enum(["event", "before"]),
        name: z.string(),
        input: z.unknown(),
      })
      .strict(),
    z.object({ type: z.literal("hook.cancel"), requestId: z.string() }).strict(),
    z
      .object({
        type: z.literal("usage.fetch"),
        requestId: z.string(),
        sourceId: z.string(),
        input: z.unknown(),
      })
      .strict(),
    z
      .object({
        type: z.literal("usage.discover"),
        requestId: z.string(),
        sourceId: z.string(),
        scope: UsageScopeSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("invoke"),
        requestId: z.string().min(1),
        method: z.string().min(1),
        input: z.unknown(),
      })
      .strict(),
    z
      .object({
        type: z.literal("provider.connect"),
        providerId: z.string().min(1),
        connectionId: z.string().min(1),
        request: providerConnectRequestSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("provider.send"),
        connectionId: z.string().min(1),
        acceptanceId: z.string().min(1),
        input: ProviderInputSchema,
      })
      .strict(),
    z.object({ type: z.literal("provider.close"), connectionId: z.string().min(1) }).strict(),
    z
      .object({
        type: z.literal("runtime.call"),
        requestId: z.string().min(1),
        runtimeId: z.string().min(1),
        verb: z.enum([
          "describe",
          "create",
          "inspect",
          "pause",
          "resume",
          "destroy",
          "reconcile",
          "prepare",
          "before_input",
          "map_cwd",
          "check_command",
          "describe_workspace",
          "fs.stat",
          "fs.readdir",
          "fs.read",
          "fs.write",
          "fs.mkdir",
          "fs.rename",
          "fs.remove",
          "fs.copy",
        ]),
        input: z.unknown(),
      })
      .strict(),
    z
      .object({
        type: z.literal("runtime.activity"),
        runtimeId: z.string().min(1),
        workspaceId: z.string().min(1),
        agentId: z.string().min(1),
        activity: z.string().min(1),
        options: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("runtime.exec.start"),
        execId: z.string().min(1),
        runtimeId: z.string().min(1),
        request: z
          .object({
            workspaceId: z.string().min(1),
            workspaceCwd: z.string().optional(),
            options: z.record(z.string(), z.unknown()).optional(),
            agentId: z.string().optional(),
            provider: z.string().optional(),
            purpose: z.enum(["session", "probe", "command"]),
            interactive: z.boolean().optional(),
            argv: z.array(z.string()).min(1),
            cwd: z.string().optional(),
            env: z.record(z.string(), z.string()),
          })
          .strict(),
      })
      .strict(),
    z.object({ type: z.literal("runtime.exec.abort"), execId: z.string().min(1) }).strict(),
    z
      .object({
        type: z.literal("runtime.exec.stdin"),
        execId: z.string().min(1),
        data: z.instanceof(Uint8Array).nullable(),
      })
      .strict(),
    z
      .object({
        type: z.literal("runtime.exec.signal"),
        execId: z.string().min(1),
        signal: z.string().min(1),
      })
      .strict(),
    z.object({ type: z.literal("shutdown") }).strict(),
    z.object({ type: z.literal("paseo_frame"), ...frameFields }).strict(),
    z.object({ type: z.literal("paseo_close") }).strict(),
  ],
);

export const PluginProcessMessageSchema: z.ZodType<PluginProcessMessage> = z.discriminatedUnion(
  "type",
  [
    z.object({ type: z.literal("settings.changed"), settingsId: z.string() }).strict(),
    z.object({ type: z.literal("hooks.changed"), hooks: hooksSchema }).strict(),
    z
      .object({
        type: z.literal("ready"),
        methods: z.array(z.string()),
        providers: z.array(providerMetadataSchema),
        usageSources: z.array(usageSourceMetadataSchema).optional(),
        workspaceRuntimes: z
          .array(
            z
              .object({
                id: z.string().min(1),
                label: z.string().min(1),
                icon: z.string().optional(),
                files: z.boolean().optional(),
              })
              .strict(),
          )
          .optional(),
        hooks: hooksSchema.optional(),
      })
      .strict(),
    z
      .object({ type: z.literal("result"), requestId: z.string().min(1), output: z.unknown() })
      .strict(),
    z
      .object({ type: z.literal("error"), requestId: z.string().min(1), error: z.string() })
      .strict(),
    z.object({ type: z.literal("fatal"), error: z.string() }).strict(),
    z
      .object({
        type: z.literal("provider.connected"),
        connectionId: z.string().min(1),
        version: z.number().int().positive(),
        capabilities: z.array(z.string()),
      })
      .strict(),
    z
      .object({
        type: z.literal("provider.connect_failed"),
        connectionId: z.string().min(1),
        error: z.string(),
      })
      .strict(),
    z
      .object({
        type: z.literal("provider.accepted"),
        connectionId: z.string().min(1),
        acceptanceId: z.string().min(1),
      })
      .strict(),
    z
      .object({
        type: z.literal("provider.rejected"),
        connectionId: z.string().min(1),
        acceptanceId: z.string().min(1),
        error: z.string(),
      })
      .strict(),
    z
      .object({
        type: z.literal("provider.event"),
        connectionId: z.string().min(1),
        event: ProviderEventSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("provider.closed"),
        connectionId: z.string().min(1),
        error: z.string().optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("runtime.notice"),
        runtimeId: z.string().min(1),
        workspaceId: z.string().min(1),
        level: z.string(),
        message: z.string(),
      })
      .strict(),
    z.object({ type: z.literal("runtime.exec.started"), execId: z.string().min(1) }).strict(),
    z
      .object({
        type: z.literal("runtime.exec.stdout"),
        execId: z.string().min(1),
        data: z.instanceof(Uint8Array),
      })
      .strict(),
    z
      .object({
        type: z.literal("runtime.exec.stderr"),
        execId: z.string().min(1),
        data: z.instanceof(Uint8Array),
      })
      .strict(),
    z
      .object({
        type: z.literal("runtime.exec.exit"),
        execId: z.string().min(1),
        code: z.number().nullable(),
        signal: z.string().nullable(),
        reason: z.enum(["exited", "runtime-lost", "suspended"]),
        message: z.string().optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("runtime.exec.failed"),
        execId: z.string().min(1),
        error: z.string(),
      })
      .strict(),
    z.object({ type: z.literal("paseo_frame"), ...frameFields }).strict(),
    z.object({ type: z.literal("paseo_close") }).strict(),
  ],
);
