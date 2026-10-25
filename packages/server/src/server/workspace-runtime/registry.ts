import {
  LOCAL_WORKSPACE_RUNTIME_ID,
  WorkspaceRuntimeUnavailableError,
  type WorkspaceRuntimeBackend,
} from "./types.js";
import type {
  WorkspaceRuntimeDisplay,
  WorkspaceRuntimeWorkspaceRequest,
} from "@getpaseo/plugin/server";

/** How long a workspace's display details are reused before the runtime is asked again. */
const DISPLAY_TTL_MS = 10_000;

/** Workspace runtimes registered by plugins, keyed by runtime id. */
export class WorkspaceRuntimeRegistry {
  private readonly backends = new Map<string, WorkspaceRuntimeBackend>();
  private readonly listeners = new Set<() => void>();
  private readonly displays = new Map<
    string,
    { at: number; value: Promise<WorkspaceRuntimeDisplay | null> }
  >();
  private workspaceDirectory: ((workspaceId: string) => string | undefined) | null = null;

  /** Where a workspace lives on the daemon, so every runtime call can carry it. */
  setWorkspaceDirectoryResolver(
    resolver: ((workspaceId: string) => string | undefined) | null,
  ): void {
    this.workspaceDirectory = resolver;
  }

  directoryOf(workspaceId: string): string | undefined {
    return this.workspaceDirectory?.(workspaceId);
  }

  register(backend: WorkspaceRuntimeBackend): () => void {
    if (backend.id === LOCAL_WORKSPACE_RUNTIME_ID) {
      throw new Error(`"${LOCAL_WORKSPACE_RUNTIME_ID}" is reserved for the daemon host`);
    }
    if (this.backends.has(backend.id)) {
      throw new Error(`Workspace runtime already registered: ${backend.id}`);
    }
    this.backends.set(backend.id, backend);
    this.displays.clear();
    const stopNotices = backend.onNotice((notice) => this.displays.delete(notice.workspaceId));
    this.notify();
    return () => {
      stopNotices();
      if (this.backends.get(backend.id) === backend) {
        this.backends.delete(backend.id);
        this.displays.clear();
        this.notify();
      }
    };
  }

  find(id: string): WorkspaceRuntimeBackend | null {
    return this.backends.get(id) ?? null;
  }

  require(id: string): WorkspaceRuntimeBackend {
    const backend = this.backends.get(id);
    if (!backend) throw new WorkspaceRuntimeUnavailableError(id);
    return backend;
  }

  /**
   * A backend that finds the runtime's current registration on every call. A launcher outlives
   * its plugin: after a reload the old backend's channel is closed, so a launcher that kept it
   * would fail every relaunch. A runtime that is gone at call time fails the call; it never
   * falls back to the host.
   */
  live(id: string): WorkspaceRuntimeBackend {
    return new Proxy({} as WorkspaceRuntimeBackend, {
      get: (_target, property) => {
        const backend = this.require(id);
        const value = Reflect.get(backend, property, backend) as unknown;
        return typeof value === "function" ? value.bind(backend) : value;
      },
    });
  }

  /**
   * Display details for a workspace of a registered runtime, cached for a few seconds and dropped
   * when the runtime reports a state change for the workspace, or registers or unregisters. A
   * runtime that is not registered or cannot answer has no details.
   */
  async displayOf(
    id: string,
    request: WorkspaceRuntimeWorkspaceRequest,
  ): Promise<WorkspaceRuntimeDisplay | null> {
    const backend = this.backends.get(id);
    if (!backend) return null;
    const cached = this.displays.get(request.workspaceId);
    if (cached && Date.now() - cached.at < DISPLAY_TTL_MS) return cached.value;
    const value = backend.describeWorkspace(request).catch(() => null);
    this.displays.set(request.workspaceId, { at: Date.now(), value });
    return value;
  }

  list(): Array<{ id: string; label: string; icon: string | undefined }> {
    return [...this.backends.values()].map((backend) => ({
      id: backend.id,
      label: backend.label,
      icon: backend.icon,
    }));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
