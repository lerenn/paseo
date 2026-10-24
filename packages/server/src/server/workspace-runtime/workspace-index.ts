import path from "node:path";
import type {
  WorkspaceRuntimeOptions,
  WorkspaceRuntimeReconcileRequest,
} from "@getpaseo/plugin/server";
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
  /** A runtime backend is reconciled once per registration. */
  private readonly reconciled = new WeakSet<object>();

  constructor(
    private readonly dependencies: {
      workspaceRegistry: WorkspaceRegistry;
      runtimes: Pick<
        WorkspaceRuntimeRegistry,
        "find" | "live" | "list" | "subscribe" | "setWorkspaceDirectoryResolver"
      >;
      logger: Logger;
    },
  ) {}

  async initialize(): Promise<() => void> {
    for (const record of await this.dependencies.workspaceRegistry.list()) this.apply(record);
    // A plugin that reloads registers a new backend; launchers hold the old one.
    const unsubscribeRuntimes = this.dependencies.runtimes.subscribe(() => {
      this.launchers.clear();
      this.dependencies.runtimes.setWorkspaceDirectoryResolver(
        (id) => this.workspaces.get(id)?.root,
      );
      this.reconcileRegistered();
    });
    this.reconcileRegistered();
    const unsubscribeMutations =
      this.dependencies.workspaceRegistry.subscribeToMutations?.((mutation: WorkspaceMutation) => {
        if (mutation.kind === "upsert" && mutation.workspace) this.apply(mutation.workspace);
        else this.retire(mutation.workspaceId);
      }) ?? (() => {});
    return () => {
      unsubscribeRuntimes();
      this.dependencies.runtimes.setWorkspaceDirectoryResolver(null);
      unsubscribeMutations();
    };
  }

  private apply(record: PersistedWorkspaceRecord): void {
    if (!record.runtime || record.archivedAt) {
      this.retire(record.workspaceId);
      return;
    }
    this.workspaces.set(record.workspaceId, {
      workspaceId: record.workspaceId,
      root: path.resolve(record.cwd),
      runtime: record.runtime,
    });
    this.launchers.delete(record.workspaceId);
  }

  /**
   * The workspace is archived or removed, by any path: delete its sandbox. A runtime that is not
   * registered right now cannot be told, and learns of the orphan at its next reconcile.
   */
  private retire(workspaceId: string): void {
    const workspace = this.workspaces.get(workspaceId);
    this.workspaces.delete(workspaceId);
    this.launchers.delete(workspaceId);
    if (!workspace) return;
    const backend = this.dependencies.runtimes.find(workspace.runtime.id);
    if (!backend) {
      this.dependencies.logger.warn(
        { workspaceId, runtimeId: workspace.runtime.id },
        "Workspace runtime is not registered; its sandbox is left for the next reconcile",
      );
      return;
    }
    backend
      .destroy({
        workspaceId,
        options: workspace.runtime.options as WorkspaceRuntimeOptions | undefined,
        cwd: workspace.root,
      })
      .catch((error: unknown) => {
        this.dependencies.logger.warn(
          { err: error, workspaceId, runtimeId: workspace.runtime.id },
          "Workspace runtime destroy failed",
        );
      });
  }

  /** Every live workspace in a runtime, the list `reconcile` works from. */
  workspacesOf(runtimeId: string): WorkspaceRuntimeReconcileRequest["workspaces"] {
    return [...this.workspaces.values()]
      .filter((workspace) => workspace.runtime.id === runtimeId)
      .map((workspace) => ({
        workspaceId: workspace.workspaceId,
        options: workspace.runtime.options as WorkspaceRuntimeOptions | undefined,
        cwd: workspace.root,
      }));
  }

  private reconcileRegistered(): void {
    for (const { id } of this.dependencies.runtimes.list()) {
      const backend = this.dependencies.runtimes.find(id);
      if (!backend || this.reconciled.has(backend)) continue;
      this.reconciled.add(backend);
      backend.reconcile({ workspaces: this.workspacesOf(id) }).catch((error: unknown) => {
        this.dependencies.logger.warn(
          { err: error, runtimeId: id },
          "Workspace runtime reconcile failed",
        );
      });
    }
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
          backend: this.dependencies.runtimes.live(workspace.runtime.id),
          workspaceId: workspace.workspaceId,
          runtimeOptions: workspace.runtime.options,
          provider: "workspace",
          workspaceRoot: workspace.root,
          liveWorkspaces: () => this.workspacesOf(workspace.runtime.id),
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
