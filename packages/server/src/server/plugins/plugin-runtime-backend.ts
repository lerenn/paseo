import { randomUUID } from "node:crypto";
import type {
  WorkspaceRuntimeActivityEvent,
  WorkspaceRuntimeDescription,
  WorkspaceRuntimeExecRequest,
  WorkspaceRuntimeCommandRequest,
  WorkspaceRuntimeFsRequest,
  WorkspaceRuntimeReconcileRequest,
  WorkspaceRuntimeInputRequest,
  WorkspaceRuntimePrepareRequest,
  WorkspaceRuntimeDisplay,
  WorkspaceRuntimeStatus,
  WorkspaceRuntimeWorkspaceRequest,
} from "@getpaseo/plugin/server";
import type {
  PluginProcessMessage,
  PluginProcessRequest,
  PluginRuntimeCallVerb,
} from "./plugin-process-protocol.js";
import type {
  RuntimeFsVerb,
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
    readonly providesFiles: boolean,
    private readonly directoryOf: (workspaceId: string) => string | undefined,
    private readonly transport: PluginRuntimeTransport,
  ) {}

  private call(verb: PluginRuntimeCallVerb, input: unknown): Promise<unknown> {
    return this.transport.call({
      type: "runtime.call",
      requestId: randomUUID(),
      runtimeId: this.id,
      verb,
      input: this.withWorkspaceCwd(input),
    });
  }

  /** Every workspace-scoped call says where its workspace is on the daemon. */
  private withWorkspaceCwd(input: unknown): unknown {
    const request = input as { workspaceId?: string; workspaceCwd?: string; cwd?: string };
    if (typeof request?.workspaceId !== "string" || request.workspaceCwd !== undefined) {
      return input;
    }
    const workspaceCwd = this.directoryOf(request.workspaceId) ?? request.cwd;
    return workspaceCwd === undefined ? input : { ...request, workspaceCwd };
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

  async reconcile(request: WorkspaceRuntimeReconcileRequest): Promise<void> {
    await this.call("reconcile", request);
  }

  async checkCommand(request: WorkspaceRuntimeCommandRequest): Promise<boolean> {
    return (await this.call("check_command", request)) !== false;
  }

  async describeWorkspace(
    request: WorkspaceRuntimeWorkspaceRequest,
  ): Promise<WorkspaceRuntimeDisplay | null> {
    const display = await this.call("describe_workspace", request);
    return display && typeof display === "object" ? (display as WorkspaceRuntimeDisplay) : null;
  }

  async prepare(request: WorkspaceRuntimePrepareRequest): Promise<void> {
    await this.call("prepare", request);
  }

  async fs(verb: RuntimeFsVerb, request: WorkspaceRuntimeFsRequest): Promise<unknown> {
    return this.call(verb, request);
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
        ...((this.directoryOf(request.workspaceId) ?? request.workspaceCwd)
          ? { workspaceCwd: this.directoryOf(request.workspaceId) ?? request.workspaceCwd }
          : {}),
        ...(request.options ? { options: request.options } : {}),
        ...(request.agentId ? { agentId: request.agentId } : {}),
        ...(request.provider ? { provider: request.provider } : {}),
        purpose: request.purpose,
        ...(request.interactive !== undefined ? { interactive: request.interactive } : {}),
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
