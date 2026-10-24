import path from "node:path";
import type { Logger } from "pino";
import type {
  PersistedWorkspaceRecord,
  WorkspaceMutation,
  WorkspaceRegistry,
} from "../workspace-registry.js";
import { createRuntimeProcessLauncher, type ProviderProcessLauncher } from "./process-launcher.js";
import { createRemoteChildProcess } from "./remote-child-process.js";
import type { ExplorerRuntimeTarget } from "../file-explorer/runtime-files.js";
import type { WorkspaceRuntimeRegistry } from "./registry.js";
import { WorkspaceRuntimeUnavailableError } from "./types.js";

interface IndexedWorkspace {
  workspaceId: string;
  root: string;
  runtime: NonNullable<PersistedWorkspaceRecord["runtime"]>;
}

function contains(root: string, target: string): boolean {
  return target === root || target.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

/**
 * Answers, synchronously, which workspace runtime owns a directory. Daemon tools that work on a
 * path (Git, the file explorer) have a path and no workspace id, and they cannot await a lookup.
 */
export class RuntimeWorkspaceIndex {
  private readonly workspaces = new Map<string, IndexedWorkspace>();
  private readonly launchers = new Map<string, ProviderProcessLauncher>();

  constructor(
    private readonly dependencies: {
      workspaceRegistry: WorkspaceRegistry;
      runtimes: WorkspaceRuntimeRegistry;
      logger: Logger;
    },
  ) {}

  async initialize(): Promise<() => void> {
    for (const record of await this.dependencies.workspaceRegistry.list()) this.apply(record);
    // A plugin that reloads registers a new backend; launchers hold the old one.
    const unsubscribeRuntimes = this.dependencies.runtimes.subscribe(() => this.launchers.clear());
    const unsubscribeMutations =
      this.dependencies.workspaceRegistry.subscribeToMutations?.((mutation: WorkspaceMutation) => {
        if (mutation.kind === "upsert" && mutation.workspace) this.apply(mutation.workspace);
        else this.drop(mutation.workspaceId);
      }) ?? (() => {});
    return () => {
      unsubscribeRuntimes();
      unsubscribeMutations();
    };
  }

  private apply(record: PersistedWorkspaceRecord): void {
    if (!record.runtime || record.archivedAt) {
      this.drop(record.workspaceId);
      return;
    }
    this.workspaces.set(record.workspaceId, {
      workspaceId: record.workspaceId,
      root: path.resolve(record.cwd),
      runtime: record.runtime,
    });
    this.launchers.delete(record.workspaceId);
  }

  private drop(workspaceId: string): void {
    this.workspaces.delete(workspaceId);
    this.launchers.delete(workspaceId);
  }

  /** The runtime workspace whose directory contains `target`, the deepest one if nested. */
  find(target: string): IndexedWorkspace | null {
    const resolved = path.resolve(target);
    let best: IndexedWorkspace | null = null;
    for (const workspace of this.workspaces.values()) {
      if (
        contains(workspace.root, resolved) &&
        (!best || workspace.root.length > best.root.length)
      ) {
        best = workspace;
      }
    }
    return best;
  }

  /** The runtime and workspace directory behind `target`, for the file explorer; null on the host. */
  explorerTargetForPath(target: string): ExplorerRuntimeTarget | null {
    const workspace = this.find(target);
    if (!workspace) return null;
    const backend = this.dependencies.runtimes.find(workspace.runtime.id);
    if (!backend) {
      // No host fallback: the explorer fails like the command would.
      throw new WorkspaceRuntimeUnavailableError(workspace.runtime.id);
    }
    return {
      backend,
      workspaceId: workspace.workspaceId,
      options: workspace.runtime.options,
      hostRoot: workspace.root,
    };
  }

  /** Starts commands for `target` in its workspace's runtime; null for a host directory. */
  launcherForPath(target: string): ProviderProcessLauncher | null {
    const workspace = this.find(target);
    if (!workspace) return null;
    const cached = this.launchers.get(workspace.workspaceId);
    if (cached) return cached;
    const backend = this.dependencies.runtimes.find(workspace.runtime.id);
    const launcher: ProviderProcessLauncher = backend
      ? createRuntimeProcessLauncher({
          backend,
          workspaceId: workspace.workspaceId,
          runtimeOptions: workspace.runtime.options,
          provider: "workspace",
          workspaceRoot: workspace.root,
        })
      : {
          runtimeId: workspace.runtime.id,
          // No host fallback: the command fails like a missing binary would.
          spawn: () =>
            createRemoteChildProcess(async () => {
              throw new WorkspaceRuntimeUnavailableError(workspace.runtime.id);
            }),
        };
    this.launchers.set(workspace.workspaceId, launcher);
    return launcher;
  }
}
