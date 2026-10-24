import { WorkspaceRuntimeUnavailableError, type WorkspaceRuntimeBackend } from "./types.js";

/** Workspace runtimes registered by plugins, keyed by runtime id. */
export class WorkspaceRuntimeRegistry {
  private readonly backends = new Map<string, WorkspaceRuntimeBackend>();
  private readonly listeners = new Set<() => void>();

  register(backend: WorkspaceRuntimeBackend): () => void {
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
