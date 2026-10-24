import type { ChildProcess } from "node:child_process";
import type { JsonValue } from "@getpaseo/protocol/agent-types";
import type {
  WorkspaceRuntimeOptions,
  WorkspaceRuntimeProcessPurpose,
} from "@getpaseo/plugin/server";
import { createRemoteChildProcess } from "./remote-child-process.js";
import type { RuntimeNotice, WorkspaceRuntimeBackend } from "./types.js";

export interface ProviderProcessSpawnInput {
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
  /** "probe" processes only read provider metadata and never start a sandbox. */
  purpose?: WorkspaceRuntimeProcessPurpose;
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
  /** The agent's final MCP servers, read when the process starts. */
  mcpServers?: () => Record<string, JsonValue> | undefined;
  onNotice?: (notice: RuntimeNotice) => void;
}

export function createRuntimeProcessLauncher(
  options: RuntimeProcessLauncherOptions,
): ProviderProcessLauncher {
  const { backend, workspaceId } = options;
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
        const request = {
          workspaceId,
          options: options.runtimeOptions,
          agentId: options.agentId,
          provider: options.provider,
          purpose,
          argv,
          cwd: input.cwd,
          env: input.env,
        };
        try {
          if (purpose === "session") {
            await backend.prepare({ ...request, mcpServers: options.mcpServers?.() });
          }
          const control = backend.exec(request, {
            ...sink,
            onExit(exit) {
              unsubscribe();
              // A lost sandbox is not a finished process: let the runtime re-adopt what is left,
              // so the next input relaunches into a consistent runtime.
              if (exit.reason === "runtime-lost") void backend.reconcile().catch(() => undefined);
              sink.onExit(exit);
            },
            onFailed(error) {
              unsubscribe();
              sink.onFailed(error);
            },
          });
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
