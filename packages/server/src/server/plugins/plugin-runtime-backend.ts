import { randomUUID } from "node:crypto";
import type {
  WorkspaceRuntimeActivityEvent,
  WorkspaceRuntimeDescription,
  WorkspaceRuntimeExecRequest,
  WorkspaceRuntimeInputRequest,
  WorkspaceRuntimePrepareRequest,
  WorkspaceRuntimeStatus,
  WorkspaceRuntimeWorkspaceRequest,
} from "@getpaseo/plugin/server";
import type {
  PluginProcessMessage,
  PluginProcessRequest,
  PluginRuntimeCallVerb,
} from "./plugin-process-protocol.js";
import type {
  RuntimeExecControl,
  RuntimeExecSink,
  RuntimeNotice,
  WorkspaceRuntimeBackend,
} from "../workspace-runtime/types.js";

export interface PluginRuntimeTransport {
  call(message: Extract<PluginProcessRequest, { type: "runtime.call" }>): Promise<unknown>;
  post(message: PluginProcessRequest): void;
}

type RuntimeMessage = Extract<PluginProcessMessage, { type: `runtime.${string}` }>;

/** Core's view of a workspace runtime a plugin registered, reached over the plugin channel. */
export class PluginRuntimeBackend implements WorkspaceRuntimeBackend {
  private readonly execs = new Map<string, RuntimeExecSink>();
  private readonly noticeListeners = new Set<(notice: RuntimeNotice) => void>();

  constructor(
    readonly id: string,
    readonly label: string,
    readonly icon: string | undefined,
    private readonly transport: PluginRuntimeTransport,
  ) {}

  private call(verb: PluginRuntimeCallVerb, input: unknown): Promise<unknown> {
    return this.transport.call({
      type: "runtime.call",
      requestId: randomUUID(),
      runtimeId: this.id,
      verb,
      input,
    });
  }

  async describe(): Promise<WorkspaceRuntimeDescription> {
    return (await this.call("describe", {})) as WorkspaceRuntimeDescription;
  }

  async create(request: WorkspaceRuntimeWorkspaceRequest): Promise<void> {
    await this.call("create", request);
  }

  async inspect(request: WorkspaceRuntimeWorkspaceRequest): Promise<WorkspaceRuntimeStatus> {
    return (await this.call("inspect", request)) as WorkspaceRuntimeStatus;
  }

  async pause(request: WorkspaceRuntimeWorkspaceRequest): Promise<void> {
    await this.call("pause", request);
  }

  async resume(request: WorkspaceRuntimeWorkspaceRequest): Promise<void> {
    await this.call("resume", request);
  }

  async destroy(request: WorkspaceRuntimeWorkspaceRequest): Promise<void> {
    await this.call("destroy", request);
  }

  async reconcile(): Promise<void> {
    await this.call("reconcile", {});
  }

  async prepare(request: WorkspaceRuntimePrepareRequest): Promise<void> {
    await this.call("prepare", request);
  }

  async mapCwd(request: WorkspaceRuntimeWorkspaceRequest & { cwd: string }): Promise<string> {
    const mapped = await this.call("map_cwd", request);
    return typeof mapped === "string" && mapped ? mapped : request.cwd;
  }

  async beforeInput(request: WorkspaceRuntimeInputRequest): Promise<void> {
    await this.call("before_input", request);
  }

  activity(event: WorkspaceRuntimeActivityEvent): void {
    this.transport.post({
      type: "runtime.activity",
      runtimeId: this.id,
      workspaceId: event.workspaceId,
      agentId: event.agentId,
      activity: event.activity,
      ...(event.options ? { options: event.options } : {}),
    });
  }

  exec(request: WorkspaceRuntimeExecRequest, sink: RuntimeExecSink): RuntimeExecControl {
    const execId = randomUUID();
    this.execs.set(execId, sink);
    this.transport.post({
      type: "runtime.exec.start",
      execId,
      runtimeId: this.id,
      request: {
        workspaceId: request.workspaceId,
        ...(request.options ? { options: request.options } : {}),
        ...(request.agentId ? { agentId: request.agentId } : {}),
        ...(request.provider ? { provider: request.provider } : {}),
        purpose: request.purpose,
        argv: [...request.argv],
        ...(request.cwd ? { cwd: request.cwd } : {}),
        env: request.env,
      },
    });
    return {
      writeStdin: (data) => this.transport.post({ type: "runtime.exec.stdin", execId, data }),
      signal: (signal) => this.transport.post({ type: "runtime.exec.signal", execId, signal }),
      abort: () => this.transport.post({ type: "runtime.exec.abort", execId }),
    };
  }

  onNotice(listener: (notice: RuntimeNotice) => void): () => void {
    this.noticeListeners.add(listener);
    return () => this.noticeListeners.delete(listener);
  }

  /** Routes a message from the plugin process. Returns true when it belonged to this runtime. */
  handleMessage(message: RuntimeMessage): void {
    if (message.type === "runtime.notice") {
      if (message.runtimeId !== this.id) return;
      const level =
        message.level === "error" || message.level === "warning" ? message.level : "info";
      for (const listener of this.noticeListeners) {
        listener({ workspaceId: message.workspaceId, level, message: message.message });
      }
      return;
    }
    const sink = this.execs.get(message.execId);
    if (!sink) return;
    switch (message.type) {
      case "runtime.exec.started":
        sink.onStarted();
        break;
      case "runtime.exec.stdout":
        sink.onStdout(message.data);
        break;
      case "runtime.exec.stderr":
        sink.onStderr(message.data);
        break;
      case "runtime.exec.exit":
        this.execs.delete(message.execId);
        sink.onExit({
          code: message.code,
          signal: message.signal,
          reason: message.reason,
          ...(message.message ? { message: message.message } : {}),
        });
        break;
      case "runtime.exec.failed":
        this.execs.delete(message.execId);
        sink.onFailed(new Error(message.error));
        break;
    }
  }

  /** The plugin stopped: running processes are gone with their runtime. */
  failAll(reason: string): void {
    for (const [execId, sink] of this.execs) {
      this.execs.delete(execId);
      sink.onExit({ code: null, signal: null, reason: "runtime-lost", message: reason });
    }
  }
}
