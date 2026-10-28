import {
  LOCAL_WORKSPACE_RUNTIME_ID,
  WorkspaceRuntimeUnavailableError,
  type RuntimeExecControl,
  type RuntimeExecSink,
  type RuntimeLifecycleEvent,
  type WorkspaceRuntimeBackend,
} from "./types.js";
import type {
  WorkspaceRuntimeDisplay,
  WorkspaceRuntimeExecRequest,
  WorkspaceRuntimeWorkspaceRequest,
} from "@getpaseo/plugin/server";

/**
 * How long a call waits for a runtime whose plugin was just stopped. A plugin update or reload
 * unregisters its runtimes, then registers them again once the new process is up.
 */
const RELOAD_GRACE_MS = 30_000;

const ASYNC_VERBS = new Set<string>([
  "describe",
  "create",
  "inspect",
  "pause",
  "resume",
  "destroy",
  "reconcile",
  "checkCommand",
  "prepare",
  "beforeInput",
  "fs",
  "mapCwd",
]);

/** How long a workspace's display details are reused before the runtime is asked again. */
const DISPLAY_TTL_MS = 10_000;

/** Workspace runtimes registered by plugins, keyed by runtime id. */
export class WorkspaceRuntimeRegistry {
  private readonly backends = new Map<string, WorkspaceRuntimeBackend>();
  private readonly listeners = new Set<() => void>();
  private readonly lifecycleListeners = new Set<
    (event: RuntimeLifecycleEvent & { runtimeId: string }) => void
  >();
  private readonly withdrawnAt = new Map<string, number>();
  private readonly displays = new Map<
    string,
    { at: number; value: Promise<WorkspaceRuntimeDisplay | null> }
  >();
  private readonly waiters = new Map<string, Set<() => void>>();
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
    const stopLifecycle = backend.onLifecycle((event) => {
      for (const listener of this.lifecycleListeners) listener({ ...event, runtimeId: backend.id });
    });
    this.withdrawnAt.delete(backend.id);
    for (const wake of this.waiters.get(backend.id) ?? []) wake();
    this.waiters.delete(backend.id);
    this.notify();
    return () => {
      stopNotices();
      stopLifecycle();
      if (this.backends.get(backend.id) === backend) {
        this.backends.delete(backend.id);
        this.displays.clear();
        this.withdrawnAt.set(backend.id, Date.now());
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
   * The runtime's backend, waiting out a reload: a runtime unregistered moments ago is expected
   * back, so the call waits for it instead of failing. One that was never registered, or has been
   * gone longer than the grace period, fails at once.
   */
  async available(id: string): Promise<WorkspaceRuntimeBackend> {
    const present = this.backends.get(id);
    if (present) return present;
    const since = this.withdrawnAt.get(id);
    const remaining = since === undefined ? 0 : since + RELOAD_GRACE_MS - Date.now();
    if (remaining <= 0) throw new WorkspaceRuntimeUnavailableError(id);
    await new Promise<void>((resolve) => {
      const waiting = this.waiters.get(id) ?? new Set<() => void>();
      this.waiters.set(id, waiting);
      waiting.add(resolve);
      setTimeout(resolve, remaining).unref();
    });
    return this.require(id);
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
        if (typeof property === "string" && ASYNC_VERBS.has(property)) {
          return async (...args: unknown[]) => {
            const backend = await this.available(id);
            return (backend as unknown as Record<string, (...a: unknown[]) => unknown>)[property](
              ...args,
            );
          };
        }
        if (property === "exec") {
          return (request: WorkspaceRuntimeExecRequest, sink: RuntimeExecSink) =>
            this.execWhenAvailable(id, request, sink);
        }
        const backend = this.require(id);
        const value = Reflect.get(backend, property, backend) as unknown;
        return typeof value === "function" ? value.bind(backend) : value;
      },
    });
  }

  /** An exec started during a reload begins when the runtime is back; abort cancels the wait. */
  private execWhenAvailable(
    id: string,
    request: WorkspaceRuntimeExecRequest,
    sink: RuntimeExecSink,
  ): RuntimeExecControl {
    const present = this.backends.get(id);
    if (present) return present.exec(request, sink);
    let control: RuntimeExecControl | null = null;
    let aborted = false;
    void (async () => {
      try {
        const backend = await this.available(id);
        if (!aborted) control = backend.exec(request, sink);
      } catch (error) {
        if (!aborted) sink.onFailed(error instanceof Error ? error : new Error(String(error)));
      }
    })();
    return {
      writeStdin: (data) => control?.writeStdin(data),
      signal: (signal) => control?.signal(signal),
      abort: () => {
        aborted = true;
        control?.abort();
      },
    };
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

  /** Planned stops and restarts the runtimes report, across every registered runtime. */
  onLifecycle(
    listener: (event: RuntimeLifecycleEvent & { runtimeId: string }) => void,
  ): () => void {
    this.lifecycleListeners.add(listener);
    return () => this.lifecycleListeners.delete(listener);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
