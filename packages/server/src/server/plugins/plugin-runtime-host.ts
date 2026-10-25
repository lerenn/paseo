import type {
  WorkspaceRuntimeActivity,
  WorkspaceRuntimeContext,
  WorkspaceRuntimeExecRequest,
  WorkspaceRuntimeFileSystem,
  WorkspaceRuntimeOptions,
  WorkspaceRuntimeProcess,
  WorkspaceRuntimeRegistration,
} from "@getpaseo/plugin/server";
import type {
  PluginProcessMessage,
  PluginProcessRequest,
  PluginRuntimeCallVerb,
} from "./plugin-process-protocol.js";

type RuntimeMessage = Extract<PluginProcessRequest, { type: `runtime.${string}` }>;

interface RunningExec {
  runtimeId: string;
  abort: AbortController;
  process: WorkspaceRuntimeProcess | null;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asBytes(chunk: unknown): Uint8Array {
  if (typeof chunk === "string") return new TextEncoder().encode(chunk);
  if (chunk instanceof Uint8Array) return new Uint8Array(chunk);
  throw new Error("Workspace runtime streams must produce bytes or strings");
}

/**
 * Plugin-process side of workspace runtimes: registers a plugin's runtimes, runs their verbs,
 * and bridges each exec's stdio over the plugin channel. Execs of one workspace start in
 * order, so a runtime sees a single launch at a time per workspace.
 */
export function createPluginRuntimeHost(options: { send(message: PluginProcessMessage): void }) {
  const { send } = options;
  const runtimes = new Map<string, WorkspaceRuntimeRegistration>();
  const execs = new Map<string, RunningExec>();
  const startTails = new Map<string, Promise<void>>();

  function register(runtime: WorkspaceRuntimeRegistration): void {
    const id = runtime.id.trim();
    if (!/^[a-z][a-z0-9._-]*$/.test(id)) {
      throw new Error(`Invalid workspace runtime ID: ${runtime.id}`);
    }
    if (!runtime.label.trim()) throw new Error(`Workspace runtime ${id} requires a label`);
    if (typeof runtime.describe !== "function" || typeof runtime.exec !== "function") {
      throw new Error(`Workspace runtime ${id} must implement describe() and exec()`);
    }
    if (id === "local")
      throw new Error('Workspace runtime ID "local" is reserved for the daemon host');
    if (runtimes.has(id)) throw new Error(`Duplicate workspace runtime: ${id}`);
    runtimes.set(id, { ...runtime, id });
  }

  function metadata(): Array<{ id: string; label: string; iconPath?: string; files: boolean }> {
    return [...runtimes.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((runtime) => ({
        id: runtime.id,
        label: runtime.label,
        iconPath: runtime.icon,
        files: runtime.fs !== undefined,
      }));
  }

  function contextFor(runtimeId: string, workspaceId: string): WorkspaceRuntimeContext {
    return {
      notice(message, level = "info") {
        send({ type: "runtime.notice", runtimeId, workspaceId, level, message });
      },
    };
  }

  function requireRuntime(runtimeId: string): WorkspaceRuntimeRegistration {
    const runtime = runtimes.get(runtimeId);
    if (!runtime) throw new Error(`Unknown workspace runtime: ${runtimeId}`);
    return runtime;
  }

  function requireFs(runtime: WorkspaceRuntimeRegistration): WorkspaceRuntimeFileSystem {
    if (!runtime.fs) throw new Error(`Workspace runtime ${runtime.id} does not provide files`);
    return runtime.fs;
  }

  interface CallInput {
    workspaceId?: string;
    options?: WorkspaceRuntimeOptions;
    agentId?: string;
  }
  type Verb = PluginRuntimeCallVerb;
  const verbs: Record<
    Verb,
    (
      runtime: WorkspaceRuntimeRegistration,
      input: never,
      context: WorkspaceRuntimeContext,
    ) => unknown
  > = {
    describe: (runtime) => runtime.describe(),
    create: (runtime, input, context) => runtime.create?.(input, context),
    inspect: async (runtime, input, context) =>
      (await runtime.inspect?.(input, context)) ?? { state: "running" },
    pause: (runtime, input, context) => runtime.pause?.(input, context),
    resume: (runtime, input, context) => runtime.resume?.(input, context),
    destroy: (runtime, input, context) => runtime.destroy?.(input, context),
    reconcile: (runtime, input, context) => runtime.reconcile?.(input, context),
    describe_workspace: async (runtime, input) =>
      (await runtime.describeWorkspace?.(input)) ?? null,
    check_command: async (runtime, input) => (await runtime.checkCommand?.(input)) ?? true,
    prepare: (runtime, input, context) => runtime.prepare?.(input, context),
    before_input: (runtime, input, context) => runtime.beforeInput?.(input, context),
    map_cwd: (runtime, input) => runtime.mapCwd?.(input) ?? null,
    "fs.stat": (runtime, input) => requireFs(runtime).stat(input),
    "fs.readdir": (runtime, input) => requireFs(runtime).readdir(input),
    "fs.read": (runtime, input) => requireFs(runtime).read(input),
    "fs.write": (runtime, input) => requireFs(runtime).write(input),
    "fs.mkdir": (runtime, input) => requireFs(runtime).mkdir(input),
    "fs.rename": (runtime, input) => requireFs(runtime).rename(input),
    "fs.remove": (runtime, input) => requireFs(runtime).remove(input),
    "fs.copy": (runtime, input) => requireFs(runtime).copy(input),
  };

  async function call(
    message: Extract<RuntimeMessage, { type: "runtime.call" }>,
  ): Promise<unknown> {
    const runtime = requireRuntime(message.runtimeId);
    const input = (message.input ?? {}) as CallInput;
    const output = await verbs[message.verb](
      runtime,
      input as never,
      contextFor(runtime.id, input.workspaceId ?? ""),
    );
    return output ?? null;
  }

  async function pumpExit(execId: string, child: WorkspaceRuntimeProcess): Promise<void> {
    try {
      const exit = await child.exit;
      execs.delete(execId);
      send({
        type: "runtime.exec.exit",
        execId,
        code: exit.code,
        signal: exit.signal,
        reason: exit.reason,
        ...(exit.message ? { message: exit.message } : {}),
      });
    } catch (error) {
      execs.delete(execId);
      send({
        type: "runtime.exec.exit",
        execId,
        code: null,
        signal: null,
        reason: "runtime-lost",
        message: describeError(error),
      });
    }
  }

  async function startExec(message: Extract<RuntimeMessage, { type: "runtime.exec.start" }>) {
    const { execId, runtimeId, request } = message;
    const running = execs.get(execId);
    if (!running || running.abort.signal.aborted) {
      execs.delete(execId);
      send({ type: "runtime.exec.failed", execId, error: "Launch was canceled" });
      return;
    }
    try {
      const runtime = requireRuntime(runtimeId);
      const [command, ...args] = request.argv;
      const execRequest: WorkspaceRuntimeExecRequest = {
        workspaceId: request.workspaceId,
        workspaceCwd: request.workspaceCwd,
        options: request.options as WorkspaceRuntimeOptions | undefined,
        agentId: request.agentId,
        provider: request.provider,
        purpose: request.purpose,
        interactive: request.interactive,
        argv: [command, ...args],
        cwd: request.cwd,
        env: request.env,
      };
      const child = await runtime.exec(execRequest, {
        ...contextFor(runtimeId, request.workspaceId),
        signal: running.abort.signal,
      });
      running.process = child;
      if (running.abort.signal.aborted) {
        void Promise.resolve(child.signal("SIGKILL")).catch(() => undefined);
      }
      send({ type: "runtime.exec.started", execId });
      child.stdout.on("data", (chunk) =>
        send({ type: "runtime.exec.stdout", execId, data: asBytes(chunk) }),
      );
      child.stderr.on("data", (chunk) =>
        send({ type: "runtime.exec.stderr", execId, data: asBytes(chunk) }),
      );
      void pumpExit(execId, child);
    } catch (error) {
      execs.delete(execId);
      send({ type: "runtime.exec.failed", execId, error: describeError(error) });
    }
  }

  /** Handles a runtime.* request. Returns false for messages that are not runtime messages. */
  function handle(
    message: PluginProcessRequest,
    reply: {
      result(requestId: string, output: unknown): void;
      error(requestId: string, error: string): void;
    },
  ): boolean {
    switch (message.type) {
      case "runtime.call":
        call(message).then(
          (output) => reply.result(message.requestId, output ?? null),
          (error) => reply.error(message.requestId, describeError(error)),
        );
        return true;
      case "runtime.activity": {
        const activity = message.activity as WorkspaceRuntimeActivity;
        try {
          runtimes.get(message.runtimeId)?.onActivity?.({
            workspaceId: message.workspaceId,
            agentId: message.agentId,
            options: message.options as WorkspaceRuntimeOptions | undefined,
            activity,
          });
        } catch {
          // Activity signals are advisory; a runtime bug must not break the agent.
        }
        return true;
      }
      case "runtime.exec.start": {
        execs.set(message.execId, {
          runtimeId: message.runtimeId,
          abort: new AbortController(),
          process: null,
        });
        const key = message.request.workspaceId;
        const tail = (startTails.get(key) ?? Promise.resolve()).then(() => startExec(message));
        startTails.set(key, tail);
        void tail.finally(() => {
          if (startTails.get(key) === tail) startTails.delete(key);
        });
        return true;
      }
      case "runtime.exec.abort": {
        const running = execs.get(message.execId);
        running?.abort.abort();
        if (running?.process)
          void Promise.resolve(running.process.signal("SIGKILL")).catch(() => undefined);
        return true;
      }
      case "runtime.exec.stdin": {
        const stdin = execs.get(message.execId)?.process?.stdin;
        if (!stdin) return true;
        if (message.data === null) stdin.end();
        else stdin.write(message.data);
        return true;
      }
      case "runtime.exec.signal":
        void Promise.resolve(execs.get(message.execId)?.process?.signal(message.signal)).catch(
          () => undefined,
        );
        return true;
      default:
        return false;
    }
  }

  function close(): void {
    for (const running of execs.values()) {
      running.abort.abort();
      if (running.process) {
        void Promise.resolve(running.process.signal("SIGTERM")).catch(() => undefined);
      }
    }
    execs.clear();
  }

  return { register, metadata, handle, close };
}
