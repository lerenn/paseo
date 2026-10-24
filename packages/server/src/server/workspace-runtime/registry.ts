import {
  LOCAL_WORKSPACE_RUNTIME_ID,
  WorkspaceRuntimeUnavailableError,
  type WorkspaceRuntimeBackend,
} from "./types.js";

/** Workspace runtimes registered by plugins, keyed by runtime id. */
export class WorkspaceRuntimeRegistry {
  private readonly backends = new Map<string, WorkspaceRuntimeBackend>();
  private readonly listeners = new Set<() => void>();

  register(backend: WorkspaceRuntimeBackend): () => void {
    if (backend.id === LOCAL_WORKSPACE_RUNTIME_ID) {
      throw new Error(`"${LOCAL_WORKSPACE_RUNTIME_ID}" is reserved for the daemon host`);
    }
    if (this.backends.has(backend.id)) {
      throw new Error(`Workspace runtime already registered: ${backend.id}`);
    }
    this.backends.set(backend.id, backend);
    this.notify();
    return () => {
      if (this.backends.get(backend.id) === backend) {
        this.backends.delete(backend.id);
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
