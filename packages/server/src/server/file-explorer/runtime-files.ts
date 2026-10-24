import path from "node:path";
import type {
  WorkspaceRuntimeFsEntry,
  WorkspaceRuntimeFsStat,
  WorkspaceRuntimeOptions,
} from "@getpaseo/plugin/server";
import type { WorkspaceRuntimeBackend } from "../workspace-runtime/types.js";
import { expandUserPath } from "../path-utils.js";

/** A workspace directory as a runtime sees it, so the explorer never touches the host disk. */
export interface ExplorerRuntimeTarget {
  backend: WorkspaceRuntimeBackend;
  workspaceId: string;
  options?: WorkspaceRuntimeOptions;
  /** The workspace directory on the daemon. */
  hostRoot: string;
}

/** Finds the runtime that owns a directory. Installed by the daemon. */
export type ExplorerRuntimeResolver = (directory: string) => ExplorerRuntimeTarget | null;

let resolveTarget: ExplorerRuntimeResolver | null = null;

export function setExplorerRuntimeResolver(resolver: ExplorerRuntimeResolver | null): void {
  resolveTarget = resolver;
}

export function findExplorerRuntimeTarget(directory: string): ExplorerRuntimeTarget | null {
  return resolveTarget?.(directory) ?? null;
}

/** A failed runtime call carries the POSIX code its message starts with. */
export class RuntimeFsError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = "RuntimeFsError";
  }
}

function toFsError(error: unknown): RuntimeFsError {
  const message = error instanceof Error ? error.message : String(error);
  const code = /^(E[A-Z]+):/.exec(message)?.[1];
  return new RuntimeFsError(message, code);
}

/** The files under one explorer root, in the runtime. Paths are relative to that root. */
export class RuntimeFiles {
  private constructor(
    private readonly target: ExplorerRuntimeTarget,
    readonly hostRoot: string,
    private readonly runtimeRoot: string,
  ) {}

  static async open(root: string): Promise<RuntimeFiles | null> {
    const hostRoot = path.resolve(expandUserPath(root));
    const target = findExplorerRuntimeTarget(hostRoot);
    if (!target) return null;
    if (!target.backend.providesFiles) {
      throw new Error(
        `Workspace runtime "${target.backend.id}" does not provide files. Paseo does not fall back to the host.`,
      );
    }
    const runtimeWorkspaceRoot = await target.backend.mapCwd({
      workspaceId: target.workspaceId,
      options: target.options,
      cwd: target.hostRoot,
    });
    const relativeToWorkspace = path.relative(target.hostRoot, hostRoot);
    return new RuntimeFiles(
      target,
      hostRoot,
      path.posix.join(runtimeWorkspaceRoot, ...relativeToWorkspace.split(path.sep).filter(Boolean)),
    );
  }

  /** A path inside the root, normalised; throws when it would leave it. */
  resolve(relativePath: string): { relative: string; runtimePath: string } {
    const relative = path.posix.normalize(relativePath.split(path.sep).join("/") || ".");
    if (relative === ".." || relative.startsWith("../") || path.posix.isAbsolute(relative)) {
      throw new Error("Access outside of workspace is not allowed");
    }
    return {
      relative: relative === "" ? "." : relative,
      runtimePath: path.posix.join(this.runtimeRoot, relative),
    };
  }

  private async call(
    verb: Parameters<WorkspaceRuntimeBackend["fs"]>[0],
    extra: object,
    runtimePath: string,
  ) {
    try {
      return await this.target.backend.fs(verb, {
        workspaceId: this.target.workspaceId,
        options: this.target.options,
        path: runtimePath,
        ...extra,
      } as never);
    } catch (error) {
      throw toFsError(error);
    }
  }

  async stat(relative: string): Promise<WorkspaceRuntimeFsStat | null> {
    return (await this.call(
      "fs.stat",
      {},
      this.resolve(relative).runtimePath,
    )) as WorkspaceRuntimeFsStat | null;
  }

  async readdir(relative: string): Promise<WorkspaceRuntimeFsEntry[]> {
    return (await this.call(
      "fs.readdir",
      {},
      this.resolve(relative).runtimePath,
    )) as WorkspaceRuntimeFsEntry[];
  }

  async read(relative: string, range?: { offset: number; length: number }): Promise<Uint8Array> {
    const bytes = await this.call("fs.read", range ?? {}, this.resolve(relative).runtimePath);
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayLike<number>);
  }

  async write(
    relative: string,
    data: Uint8Array,
    options: { mode?: number; exclusive?: boolean; expectedMtimeMs?: number } = {},
  ): Promise<WorkspaceRuntimeFsStat> {
    return (await this.call(
      "fs.write",
      { data, ...options },
      this.resolve(relative).runtimePath,
    )) as WorkspaceRuntimeFsStat;
  }

  async mkdir(relative: string): Promise<void> {
    await this.call("fs.mkdir", {}, this.resolve(relative).runtimePath);
  }

  async rename(relative: string, toRelative: string): Promise<void> {
    await this.call(
      "fs.rename",
      { to: this.resolve(toRelative).runtimePath },
      this.resolve(relative).runtimePath,
    );
  }

  async remove(relative: string, recursive: boolean): Promise<void> {
    await this.call("fs.remove", { recursive }, this.resolve(relative).runtimePath);
  }

  async copy(relative: string, toRelative: string): Promise<void> {
    await this.call(
      "fs.copy",
      { to: this.resolve(toRelative).runtimePath },
      this.resolve(relative).runtimePath,
    );
  }
}
