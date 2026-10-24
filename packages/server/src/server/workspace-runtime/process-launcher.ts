import type { ChildProcess } from "node:child_process";
import type { JsonValue } from "@getpaseo/protocol/agent-types";
import type {
  WorkspaceRuntimeOptions,
  WorkspaceRuntimeProcessPurpose,
} from "@getpaseo/plugin/server";
import { createLineRewriter, toHostPaths, toRuntimePaths, type PathMap } from "./path-map.js";
import { createRemoteChildProcess } from "./remote-child-process.js";
import type { WorkspaceRuntimeReconcileRequest } from "@getpaseo/plugin/server";
import type {
  RuntimeExecControl,
  RuntimeExecSink,
  RuntimeNotice,
  WorkspaceRuntimeBackend,
} from "./types.js";

export interface ProviderProcessSpawnInput {
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
  /** "probe" processes only read provider metadata and never start a sandbox. */
  purpose?: WorkspaceRuntimeProcessPurpose;
  /** For commands: a user is waiting, so the runtime may resume a suspended sandbox. */
  interactive?: boolean;
  signal?: AbortSignal;
}

/**
 * Starts provider processes for one agent in its workspace's runtime. It rides on
 * AgentLaunchContext, and every provider spawn site asks it instead of spawning locally.
 */
export interface ProviderProcessLauncher {
  readonly runtimeId: string;
  spawn(input: ProviderProcessSpawnInput): ChildProcess;
}

export interface RuntimeProcessLauncherOptions {
  backend: WorkspaceRuntimeBackend;
  workspaceId: string;
  runtimeOptions?: WorkspaceRuntimeOptions;
  agentId?: string;
  provider: string;
  /** The workspace directory on the daemon. Enables path mapping through `mapCwd`. */
  workspaceRoot?: string;
  /** The agent's final MCP servers, read when the process starts. */
  mcpServers?: () => Record<string, JsonValue> | undefined;
  onNotice?: (notice: RuntimeNotice) => void;
  /**
   * Every live workspace of this runtime, for `reconcile` after a lost sandbox. Without it the
   * launcher does not reconcile: a runtime told about too few workspaces would delete live ones.
   */
  liveWorkspaces?: () => WorkspaceRuntimeReconcileRequest["workspaces"];
}

function rewriteIfText(chunks: Uint8Array[], map: PathMap): Uint8Array[] {
  const joined = Buffer.concat(chunks);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(joined);
    return [new TextEncoder().encode(toHostPaths(text, map))];
  } catch {
    return [joined];
  }
}

async function requireCommand(
  backend: WorkspaceRuntimeBackend,
  request: { workspaceId: string; options?: WorkspaceRuntimeOptions },
  command: string,
): Promise<void> {
  const present = await backend.checkCommand({
    workspaceId: request.workspaceId,
    options: request.options,
    command,
  });
  if (!present) {
    throw new Error(
      `"${command}" was not found in the "${backend.id}" runtime. Install it in the runtime's image.`,
    );
  }
}

/** A stdio MCP server whose binary is missing would fail inside the agent; say so up front. */
async function warnAboutMissingMcpCommands(
  backend: WorkspaceRuntimeBackend,
  request: { workspaceId: string; options?: WorkspaceRuntimeOptions },
  options: RuntimeProcessLauncherOptions,
): Promise<void> {
  const servers = options.mcpServers?.() ?? {};
  for (const [name, server] of Object.entries(servers)) {
    const command = (server as { type?: string; command?: unknown }).command;
    if (typeof command !== "string") continue;
    const present = await backend
      .checkCommand({ workspaceId: request.workspaceId, options: request.options, command })
      .catch(() => true);
    if (!present) {
      options.onNotice?.({
        workspaceId: request.workspaceId,
        level: "warning",
        message: `MCP server "${name}" runs "${command}", which was not found in the "${backend.id}" runtime.`,
      });
    }
  }
}

function mapJson<T>(value: T | undefined, rewrite: (text: string) => string): T | undefined {
  return value === undefined ? undefined : (JSON.parse(rewrite(JSON.stringify(value))) as T);
}

/** Rewrites paths on the sink's output and on the control's input when the runtime maps them. */
function mapStreams(
  map: PathMap,
  sink: RuntimeExecSink,
  bufferStdout: boolean,
): { sink: RuntimeExecSink; wrapControl(control: RuntimeExecControl): RuntimeExecControl } {
  const stdout = createLineRewriter((line) => toHostPaths(line, map));
  // A command's output may be binary (a Git blob). Hold it until exit and rewrite only text.
  const heldStdout: Uint8Array[] = [];
  const stderr = createLineRewriter((line) => toHostPaths(line, map));
  const stdin = createLineRewriter((line) => toRuntimePaths(line, map));
  const drain = (): void => {
    if (bufferStdout) {
      for (const chunk of rewriteIfText(heldStdout.splice(0), map)) sink.onStdout(chunk);
    }
    for (const chunk of stdout.flush()) sink.onStdout(chunk);
    for (const chunk of stderr.flush()) sink.onStderr(chunk);
  };
  return {
    sink: {
      ...sink,
      onStdout: (data) => {
        if (bufferStdout) heldStdout.push(data);
        else stdout.push(data).forEach((chunk) => sink.onStdout(chunk));
      },
      onStderr: (data) => stderr.push(data).forEach((chunk) => sink.onStderr(chunk)),
      onExit(exit) {
        drain();
        sink.onExit({ ...exit, message: exit.message && toHostPaths(exit.message, map) });
      },
    },
    wrapControl: (control) => ({
      ...control,
      writeStdin(data) {
        // A command's input may be binary; only protocol text is rewritten.
        if (bufferStdout) {
          control.writeStdin(data);
          return;
        }
        if (data === null) {
          for (const chunk of stdin.flush()) control.writeStdin(chunk);
          control.writeStdin(null);
          return;
        }
        for (const chunk of stdin.push(data)) control.writeStdin(chunk);
      },
    }),
  };
}

export function createRuntimeProcessLauncher(
  options: RuntimeProcessLauncherOptions,
): ProviderProcessLauncher {
  const { backend, workspaceId } = options;
  let pathMap: Promise<PathMap | null> | null = null;
  const resolvePathMap = (): Promise<PathMap | null> => {
    const root = options.workspaceRoot;
    if (!root) return Promise.resolve(null);
    pathMap ??= backend
      .mapCwd({ workspaceId, options: options.runtimeOptions, cwd: root })
      .then((runtimeRoot) => (runtimeRoot === root ? null : { host: root, runtime: runtimeRoot }));
    return pathMap;
  };
  return {
    runtimeId: backend.id,
    spawn(input) {
      const purpose = input.purpose ?? "session";
      const argv: [string, ...string[]] = [input.command, ...input.args];
      return createRemoteChildProcess(async (sink) => {
        const unsubscribe = options.onNotice
          ? backend.onNotice((notice) => {
              if (notice.workspaceId === workspaceId) options.onNotice?.(notice);
            })
          : () => undefined;
        try {
          const map = await resolvePathMap();
          const mapped = (text: string): string => toRuntimePaths(text, map);
          const request = {
            interactive: input.interactive,
            workspaceId,
            options: options.runtimeOptions,
            agentId: options.agentId,
            provider: options.provider,
            purpose,
            argv: argv.map(mapped) as [string, ...string[]],
            cwd: input.cwd === undefined ? undefined : mapped(input.cwd),
            env: Object.fromEntries(Object.entries(input.env).map(([k, v]) => [k, mapped(v)])),
          };
          if (purpose === "session") {
            await requireCommand(backend, request, request.argv[0]);
            await warnAboutMissingMcpCommands(backend, request, options);
            await backend.prepare({
              ...request,
              mcpServers: mapJson(options.mcpServers?.(), mapped),
            });
          }
          const streams = map ? mapStreams(map, sink, purpose === "command") : null;
          const target = streams?.sink ?? sink;
          const rawControl = backend.exec(request, {
            ...target,
            onExit(exit) {
              unsubscribe();
              // A lost sandbox is not a finished process: let the runtime re-adopt what is left,
              // so the next input relaunches into a consistent runtime.
              const live = options.liveWorkspaces?.();
              if (exit.reason === "runtime-lost" && live) {
                void backend.reconcile({ workspaces: live }).catch(() => undefined);
              }
              target.onExit(exit);
            },
            onFailed(error) {
              unsubscribe();
              target.onFailed(error);
            },
          });
          const control = streams ? streams.wrapControl(rawControl) : rawControl;
          input.signal?.addEventListener("abort", () => control.abort(), { once: true });
          return control;
        } catch (error) {
          unsubscribe();
          throw error;
        }
      });
    },
  };
}
