import path from "node:path";
import { runGitCommand } from "../../utils/run-git-command.js";
import {
  BINARY_MIME_TYPES,
  FILE_EXPLORER_STREAM_CHUNK_BYTES,
  FILE_TYPE_SAMPLE_BYTES,
  IMAGE_MIME_TYPES,
  isLikelyBinary,
  isValidUtf8,
  isValidUtf8Prefix,
  MAX_EDITABLE_FILE_BYTES,
  textMimeTypeForExtension,
} from "./file-kinds.js";
import { RuntimeFiles, RuntimeFsError } from "./runtime-files.js";
import type {
  ExplorerEntryKind,
  ExplorerEntryMutationResult,
  ExplorerFileKind,
  ExplorerFileVersion,
  ExplorerFileWriteResult,
  FileExplorerDirectory,
  FileExplorerEntry,
  FileExplorerFileBytes,
  FileExplorerFileStream,
  WriteFileParams,
} from "./service.js";

/**
 * The file explorer over a workspace runtime's file system. It mirrors the host explorer in
 * service.ts (same results, same errors) and differs where a disk is not there to ask: revisions
 * come from size and modification time, binary detection samples the first bytes, and symlink
 * confinement is the runtime's job.
 */

interface RuntimeStat {
  kind: "file" | "directory" | "other";
  size: number;
  mtimeMs: number;
  mode?: number;
}

const OUTSIDE_WORKSPACE = "Access outside of workspace is not allowed";

function revisionOf(stat: RuntimeStat): string {
  return `rt:${stat.size}:${stat.mtimeMs}`;
}

function modifiedAt(stat: RuntimeStat): string {
  return new Date(stat.mtimeMs).toISOString();
}

/** A request path relative to the explorer root, whether it arrived relative or absolute. */
function relativeTo(files: RuntimeFiles, requested: string): string {
  const relative = path.isAbsolute(requested)
    ? path.relative(files.hostRoot, requested).split(path.sep).join("/")
    : requested;
  return files.resolve(relative || ".").relative;
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof RuntimeFsError && ["ENOENT", "ENOTDIR", "ELOOP"].includes(error.code ?? "")
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function requireStat(files: RuntimeFiles, relative: string): Promise<RuntimeStat> {
  const stat = await files.stat(relative);
  if (!stat) throw new RuntimeFsError(`ENOENT: ${relative} does not exist`, "ENOENT");
  return stat;
}

async function sniff(
  files: RuntimeFiles,
  relative: string,
  size: number,
): Promise<{ kind: ExplorerFileKind; mimeType: string }> {
  const ext = path.posix.extname(relative).toLowerCase();
  if (ext in IMAGE_MIME_TYPES) return { kind: "image", mimeType: IMAGE_MIME_TYPES[ext] };
  const binary = {
    kind: "binary" as const,
    mimeType: BINARY_MIME_TYPES[ext] ?? "application/octet-stream",
  };
  if (ext in BINARY_MIME_TYPES) return binary;
  if (size === 0) return { kind: "text", mimeType: textMimeTypeForExtension(ext) };
  const sample = Buffer.from(
    await files.read(relative, { offset: 0, length: Math.min(FILE_TYPE_SAMPLE_BYTES, size) }),
  );
  if (isLikelyBinary(sample) || !isValidUtf8Prefix(sample)) return binary;
  return { kind: "text", mimeType: textMimeTypeForExtension(ext) };
}

export async function listDirectory(
  files: RuntimeFiles,
  relativePath: string,
): Promise<FileExplorerDirectory> {
  const relative = relativeTo(files, relativePath);
  if ((await requireStat(files, relative)).kind !== "directory") {
    throw new Error("Requested path is not a directory");
  }
  const entries: FileExplorerEntry[] = (await files.readdir(relative)).map((entry) => ({
    name: entry.name,
    path: relative === "." ? entry.name : `${relative}/${entry.name}`,
    kind: (entry.kind === "directory" ? "directory" : "file") as ExplorerEntryKind,
    size: entry.size,
    modifiedAt: modifiedAt(entry),
  }));
  entries.sort((a, b) => {
    const byModified = new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
    return byModified !== 0 ? byModified : a.name.localeCompare(b.name);
  });
  return { path: relative, entries };
}

export async function readFileBytes(
  files: RuntimeFiles,
  relativePath: string,
): Promise<FileExplorerFileBytes> {
  const relative = relativeTo(files, relativePath);
  const stat = await requireStat(files, relative);
  if (stat.kind !== "file") throw new Error("Requested path is not a file");
  const bytes = await files.read(relative);
  const buffer = Buffer.from(bytes);
  const ext = path.posix.extname(relative).toLowerCase();
  const base = {
    path: relative,
    size: stat.size,
    modifiedAt: modifiedAt(stat),
    revision: revisionOf(stat),
    bytes,
  };
  if (ext in IMAGE_MIME_TYPES) {
    return { ...base, kind: "image", encoding: "binary", mimeType: IMAGE_MIME_TYPES[ext] };
  }
  if (ext in BINARY_MIME_TYPES || isLikelyBinary(buffer) || !isValidUtf8(buffer)) {
    return {
      ...base,
      kind: "binary",
      encoding: "binary",
      mimeType: BINARY_MIME_TYPES[ext] ?? "application/octet-stream",
    };
  }
  return { ...base, kind: "text", encoding: "utf-8", mimeType: textMimeTypeForExtension(ext) };
}

export async function streamFile(
  files: RuntimeFiles,
  relativePath: string,
  consume: (file: FileExplorerFileStream) => Promise<void>,
): Promise<void> {
  const relative = relativeTo(files, relativePath);
  const stat = await requireStat(files, relative);
  if (stat.kind !== "file") throw new Error("Requested path is not a file");
  const { kind, mimeType } = await sniff(files, relative, stat.size);
  const revision = revisionOf(stat);
  async function* chunks(): AsyncIterable<Uint8Array> {
    let offset = 0;
    while (offset < stat.size) {
      const length = Math.min(FILE_EXPLORER_STREAM_CHUNK_BYTES, stat.size - offset);
      const chunk = await files.read(relative, { offset, length });
      if (chunk.byteLength === 0) throw new Error("File changed during transfer");
      offset += chunk.byteLength;
      yield chunk;
    }
    const latest = await requireStat(files, relative);
    if (revisionOf(latest) !== revision) throw new Error("File changed during transfer");
  }
  await consume({
    path: relative,
    kind,
    encoding: kind === "text" ? "utf-8" : "binary",
    mimeType,
    size: stat.size,
    modifiedAt: modifiedAt(stat),
    revision,
    chunks: chunks(),
  });
}

export async function fileVersion(
  files: RuntimeFiles,
  root: string,
  relativePath: string,
): Promise<ExplorerFileVersion> {
  try {
    const relative = relativeTo(files, relativePath);
    const stat = await files.stat(relative);
    if (!stat) return { status: "missing", cwd: root, path: relativePath };
    if (stat.kind !== "file") {
      return {
        status: "error",
        cwd: root,
        path: relativePath,
        error: "Requested path is not a file",
      };
    }
    const type = await sniff(files, relative, stat.size);
    return {
      status: "ready",
      cwd: root,
      path: relative,
      size: stat.size,
      modifiedAt: modifiedAt(stat),
      revision: revisionOf(stat),
      kind: type.kind,
      mimeType: type.mimeType,
    };
  } catch (error) {
    if (isMissing(error)) return { status: "missing", cwd: root, path: relativePath };
    return { status: "error", cwd: root, path: relativePath, error: describe(error) };
  }
}

export async function writeFile(
  files: RuntimeFiles,
  params: WriteFileParams,
): Promise<ExplorerFileWriteResult> {
  const {
    root,
    relativePath,
    content,
    contentEncoding = "utf-8",
    expectedModifiedAt,
    expectedRevision,
  } = params;
  const encoded = Buffer.from(content, contentEncoding === "base64" ? "base64" : "utf8");
  if (encoded.byteLength > MAX_EDITABLE_FILE_BYTES) {
    return { status: "error", error: "File is too large to edit" };
  }
  const matches = (stat: RuntimeStat): boolean =>
    expectedRevision
      ? revisionOf(stat) === expectedRevision
      : modifiedAt(stat) === expectedModifiedAt;
  const conflict = (stat: RuntimeStat, relative: string): ExplorerFileWriteResult => ({
    status: "conflict",
    version: {
      status: "ready",
      cwd: root,
      path: relative,
      size: stat.size,
      modifiedAt: modifiedAt(stat),
      revision: revisionOf(stat),
    },
  });
  let relative: string;
  let mode = 0o600;
  let expectedMtimeMs: number | undefined;
  try {
    relative = relativeTo(files, relativePath);
    const stat = await requireStat(files, relative);
    if (stat.kind !== "file") return { status: "error", error: "Requested path is not a file" };
    if (stat.size > MAX_EDITABLE_FILE_BYTES)
      return { status: "error", error: "File is too large to edit" };
    if (contentEncoding === "utf-8") {
      const current = Buffer.from(await files.read(relative));
      if (isLikelyBinary(current) || !isValidUtf8(current)) {
        return { status: "error", error: "Binary files cannot be edited" };
      }
    }
    mode = stat.mode ?? mode;
    if (!matches(stat)) return conflict(stat, relative);
    expectedMtimeMs = stat.mtimeMs;
  } catch (error) {
    if (isMissing(error)) {
      return { status: "conflict", version: { status: "missing", cwd: root, path: relativePath } };
    }
    return { status: "error", error: describe(error) };
  }
  try {
    const written = await files.write(relative, encoded, { mode, expectedMtimeMs });
    return {
      status: "written",
      modifiedAt: modifiedAt(written),
      size: written.size,
      revision: revisionOf(written),
    };
  } catch (error) {
    if (error instanceof RuntimeFsError && error.code === "ECONFLICT") {
      const latest = await files.stat(relative).catch(() => null);
      return latest
        ? conflict(latest, relative)
        : { status: "conflict", version: { status: "missing", cwd: root, path: relativePath } };
    }
    return { status: "error", error: describe(error) };
  }
}

export async function downloadInfo(files: RuntimeFiles, relativePath: string) {
  const relative = relativeTo(files, relativePath);
  const stat = await requireStat(files, relative);
  if (stat.kind !== "file") throw new Error("Requested path is not a file");
  const { mimeType } = await sniff(files, relative, stat.size);
  return {
    path: relative,
    absolutePath: path.join(files.hostRoot, relative),
    fileName: path.posix.basename(relative),
    mimeType,
    size: stat.size,
  };
}

function validName(name: string): { name: string } | { error: string } {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") return { error: "Invalid name" };
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return { error: "Name cannot contain path separators" };
  }
  return { name: trimmed };
}

function mutationError(error: unknown, name?: string): ExplorerEntryMutationResult {
  if (error instanceof RuntimeFsError && error.code === "EEXIST" && name) {
    return { status: "error", error: `"${name}" already exists` };
  }
  if (isMissing(error)) return { status: "error", error: "File or folder no longer exists" };
  return { status: "error", error: describe(error) };
}

export async function createEntry(
  files: RuntimeFiles,
  params: { parentPath: string; name: string; kind: ExplorerEntryKind },
): Promise<ExplorerEntryMutationResult> {
  const valid = validName(params.name);
  if ("error" in valid) return { status: "error", error: valid.error };
  try {
    const parent = relativeTo(files, params.parentPath);
    if ((await requireStat(files, parent)).kind !== "directory") {
      return { status: "error", error: "Parent path is not a directory" };
    }
    const target = parent === "." ? valid.name : `${parent}/${valid.name}`;
    if (params.kind === "directory") await files.mkdir(target);
    else await files.write(target, new Uint8Array(), { mode: 0o644, exclusive: true });
    return { status: "ok", path: target };
  } catch (error) {
    return mutationError(error, valid.name);
  }
}

export async function duplicateEntry(
  files: RuntimeFiles,
  relativePath: string,
): Promise<ExplorerEntryMutationResult> {
  try {
    const source = relativeTo(files, relativePath);
    if (source === ".") return { status: "error", error: "Cannot duplicate the workspace root" };
    const stat = await requireStat(files, source);
    const sourceName = path.posix.basename(source);
    const extension = stat.kind === "directory" ? "" : path.posix.extname(sourceName);
    const baseName = extension ? sourceName.slice(0, -extension.length) : sourceName;
    const directory = path.posix.dirname(source);
    let target = "";
    for (let copyNumber = 1; ; copyNumber += 1) {
      const suffix = copyNumber === 1 ? " copy" : ` copy ${copyNumber}`;
      const name = `${baseName}${suffix}${extension}`;
      target = directory === "." ? name : `${directory}/${name}`;
      if (!(await files.stat(target))) break;
    }
    await files.copy(source, target);
    return { status: "ok", path: target };
  } catch (error) {
    return mutationError(error);
  }
}

export async function renameEntry(
  files: RuntimeFiles,
  params: { relativePath: string; name: string },
): Promise<ExplorerEntryMutationResult> {
  const valid = validName(params.name);
  if ("error" in valid) return { status: "error", error: valid.error };
  try {
    const source = relativeTo(files, params.relativePath);
    if (source === ".") return { status: "error", error: "Cannot rename the workspace root" };
    await requireStat(files, source);
    const directory = path.posix.dirname(source);
    const target = directory === "." ? valid.name : `${directory}/${valid.name}`;
    if (target === source) return { status: "ok", path: target };
    if (await files.stat(target))
      return { status: "error", error: `"${valid.name}" already exists` };
    // Git runs in the runtime too (its commands follow the workspace), so tracked files keep history.
    const repository = await runGitCommand(["rev-parse", "--is-inside-work-tree"], {
      cwd: files.hostRoot,
      acceptExitCodes: [0, 128],
    });
    const tracked =
      repository.exitCode === 0
        ? await runGitCommand(["ls-files", "-z", "--", `:(literal)${source}`], {
            cwd: files.hostRoot,
            envOverlay: { GIT_LITERAL_PATHSPECS: undefined },
          })
        : null;
    if (tracked?.stdout) await runGitCommand(["mv", "--", source, target], { cwd: files.hostRoot });
    else await files.rename(source, target);
    return { status: "ok", path: target };
  } catch (error) {
    return mutationError(error, valid.name);
  }
}

export async function deleteEntry(
  files: RuntimeFiles,
  relativePath: string,
): Promise<ExplorerEntryMutationResult> {
  try {
    const target = relativeTo(files, relativePath);
    if (target === ".") return { status: "error", error: "Cannot delete the workspace root" };
    const stat = await requireStat(files, target);
    await files.remove(target, stat.kind === "directory");
    return { status: "ok", path: target };
  } catch (error) {
    return mutationError(error);
  }
}

export { OUTSIDE_WORKSPACE };
