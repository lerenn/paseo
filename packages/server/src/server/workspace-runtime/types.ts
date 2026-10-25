import type {
  WorkspaceRuntimeExecRequest,
  WorkspaceRuntimeExit,
  WorkspaceRuntimeInputRequest,
  WorkspaceRuntimePrepareRequest,
  WorkspaceRuntimeWorkspaceRequest,
  WorkspaceRuntimeFsRequest,
  WorkspaceRuntimeCommandRequest,
  WorkspaceRuntimeReconcileRequest,
  WorkspaceRuntimeActivityEvent,
  WorkspaceRuntimeDescription,
  WorkspaceRuntimeStatus,
  WorkspaceRuntimeDisplay,
} from "@getpaseo/plugin/server";

export type RuntimeFsVerb =
  | "fs.stat"
  | "fs.readdir"
  | "fs.read"
  | "fs.write"
  | "fs.mkdir"
  | "fs.rename"
  | "fs.remove"
  | "fs.copy";

export interface RuntimeExecSink {
  onStarted(): void;
  onStdout(data: Uint8Array): void;
  onStderr(data: Uint8Array): void;
  onExit(exit: WorkspaceRuntimeExit): void;
  /** The runtime could not start the process. */
  onFailed(error: Error): void;
}

export interface RuntimeExecControl {
  /** `null` closes stdin. Callers send only after `onStarted`. */
  writeStdin(data: Uint8Array | null): void;
  signal(signal: string): void;
  /** Cancel a launch that has not started, or kill one that has. */
  abort(): void;
}

export interface RuntimeNotice {
  workspaceId: string;
  level: "info" | "warning" | "error";
  message: string;
}

/** What core needs from a registered workspace runtime. A plugin proxy implements it. */
export interface WorkspaceRuntimeBackend {
  readonly id: string;
  readonly label: string;
  /** SVG markup for the runtime, if its plugin declared one. */
  readonly icon?: string;
  /** The runtime serves the workspace's files; without it the Files panel is unavailable. */
  readonly providesFiles: boolean;
  describe(): Promise<WorkspaceRuntimeDescription>;
  create(request: WorkspaceRuntimeWorkspaceRequest): Promise<void>;
  inspect(request: WorkspaceRuntimeWorkspaceRequest): Promise<WorkspaceRuntimeStatus>;
  pause(request: WorkspaceRuntimeWorkspaceRequest): Promise<void>;
  resume(request: WorkspaceRuntimeWorkspaceRequest): Promise<void>;
  destroy(request: WorkspaceRuntimeWorkspaceRequest): Promise<void>;
  reconcile(request: WorkspaceRuntimeReconcileRequest): Promise<void>;
  checkCommand(request: WorkspaceRuntimeCommandRequest): Promise<boolean>;
  /** Display details for one workspace, or null when the runtime has none. Must not wake the sandbox. */
  describeWorkspace(
    request: WorkspaceRuntimeWorkspaceRequest,
  ): Promise<WorkspaceRuntimeDisplay | null>;
  prepare(request: WorkspaceRuntimePrepareRequest): Promise<void>;
  beforeInput(request: WorkspaceRuntimeInputRequest): Promise<void>;
  /** One file system call; the result is whatever the verb returns (see WorkspaceRuntimeFileSystem). */
  fs(verb: RuntimeFsVerb, request: WorkspaceRuntimeFsRequest): Promise<unknown>;
  /** The workspace directory inside the runtime; the daemon path when it is the same. */
  mapCwd(request: WorkspaceRuntimeWorkspaceRequest & { cwd: string }): Promise<string>;
  activity(event: WorkspaceRuntimeActivityEvent): void;
  exec(request: WorkspaceRuntimeExecRequest, sink: RuntimeExecSink): RuntimeExecControl;
  onNotice(listener: (notice: RuntimeNotice) => void): () => void;
}

/** The reserved id for the daemon host. A plugin cannot register it; a request can name it. */
export const LOCAL_WORKSPACE_RUNTIME_ID = "local";

/** What a workspace stores to select its runtime. */
export interface WorkspaceRuntimeSelection {
  id: string;
  options?: Record<string, unknown>;
}

/** Thrown when a workspace selects a runtime nobody registered. There is no host fallback. */
export class WorkspaceRuntimeUnavailableError extends Error {
  constructor(
    public readonly runtimeId: string,
    detail?: string,
  ) {
    super(
      `Workspace runtime "${runtimeId}" is not available${detail ? `: ${detail}` : ""}. ` +
        "Paseo does not fall back to running on the host.",
    );
    this.name = "WorkspaceRuntimeUnavailableError";
  }
}

export class RemoteLaunchUnsupportedError extends Error {
  constructor(
    public readonly provider: string,
    public readonly runtimeId: string,
  ) {
    super(
      `Provider "${provider}" cannot run in workspace runtime "${runtimeId}": it does not support remote launch.`,
    );
    this.name = "RemoteLaunchUnsupportedError";
  }
}
