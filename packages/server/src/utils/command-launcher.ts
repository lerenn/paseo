import { AsyncLocalStorage } from "node:async_hooks";
import type { ChildProcess } from "node:child_process";
import type { ProviderProcessLauncher } from "../server/workspace-runtime/process-launcher.js";
import { spawnProcess, type SpawnProcessOptions } from "./spawn.js";

/**
 * Finds the workspace runtime that owns a directory, if any. Installed by the daemon; absent in
 * tools that spawn commands without one.
 */
export type CommandLauncherResolver = (cwd: string) => ProviderProcessLauncher | null;

let resolveCommandLauncher: CommandLauncherResolver | null = null;
const hostOnly = new AsyncLocalStorage<true>();

/**
 * Runs an operation with its commands on the daemon host even for a runtime workspace's
 * directory. A project is the daemon's own registered checkout: its kind and identity come from
 * that checkout, not from whichever sandbox happens to hold a copy.
 */
export function runCommandsOnHost<T>(operation: () => T): T {
  return hostOnly.run(true, operation);
}

export function setCommandLauncherResolver(resolver: CommandLauncherResolver | null): void {
  resolveCommandLauncher = resolver;
}

/** Whether a directory belongs to a workspace runtime, so a failed command there proves nothing about it. */
export function hasWorkspaceRuntime(cwd: string): boolean {
  return resolveCommandLauncher?.(cwd) != null;
}

export interface SpawnCommandOptions extends SpawnProcessOptions {
  /** A user is waiting on the result; a runtime may resume a suspended sandbox for it. */
  interactive?: boolean;
}

/**
 * Spawns a short command for a workspace directory: in the workspace's runtime when it has one,
 * on the daemon host otherwise. A workspace with a runtime never falls back to the host.
 */
export function spawnWorkspaceCommand(
  command: string,
  args: string[],
  options: SpawnCommandOptions & { cwd: string },
): ChildProcess {
  const { interactive, ...spawnOptions } = options;
  const launcher = hostOnly.getStore() ? null : resolveCommandLauncher?.(options.cwd);
  if (!launcher) return spawnProcess(command, args, spawnOptions);
  const child = launcher.spawn({
    command,
    args,
    cwd: options.cwd,
    env: Object.fromEntries(
      Object.entries(spawnOptions.envOverlay ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    purpose: "command",
    interactive,
  });
  // A local spawn with an ignored stdin reads end-of-file at once; so must the remote one.
  if (spawnOptions.stdio?.[0] === "ignore") child.stdin?.end();
  return child;
}
