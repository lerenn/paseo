import type { ChildProcess } from "node:child_process";
import { spawnProcess, type SpawnProcessOptions } from "../../utils/spawn.js";
import type { ProviderProcessLauncher } from "./process-launcher.js";
import type { WorkspaceRuntimeProcessPurpose } from "@getpaseo/plugin/server";

export interface SpawnProviderProcessOptions extends SpawnProcessOptions {
  /** The agent's workspace runtime. Absent means the process runs on the daemon host. */
  launcher?: ProviderProcessLauncher;
  purpose?: WorkspaceRuntimeProcessPurpose;
}

/**
 * A remote process gets the provider's own environment delta (settings, plugin env, the
 * agent's Paseo variables), never the daemon's environment: the daemon's holds its tokens.
 */
function runtimeEnvDelta(overlay: SpawnProcessOptions["envOverlay"]): Record<string, string> {
  const delta: Record<string, string> = {};
  for (const [key, value] of Object.entries(overlay ?? {})) {
    if (typeof value === "string") delta[key] = value;
  }
  return delta;
}

/**
 * The one place provider processes are started. Every provider (built in or from a plugin
 * SDK) goes through here so a workspace runtime can take over where the process runs.
 */
export function spawnProviderProcess(
  command: string,
  args: string[],
  options: SpawnProviderProcessOptions = {},
): ChildProcess {
  const { launcher, purpose, ...spawnOptions } = options;
  if (!launcher) return spawnProcess(command, args, spawnOptions);
  return launcher.spawn({
    command,
    args,
    cwd: typeof spawnOptions.cwd === "string" ? spawnOptions.cwd : undefined,
    env: runtimeEnvDelta(spawnOptions.envOverlay),
    purpose,
    signal: spawnOptions.signal ?? undefined,
  });
}
