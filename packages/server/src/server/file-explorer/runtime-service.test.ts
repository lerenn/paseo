import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setExplorerRuntimeResolver } from "./runtime-files.js";
import {
  createExplorerEntry,
  deleteExplorerEntry,
  duplicateExplorerEntry,
  getDownloadableFileInfo,
  getExplorerFileVersion,
  listDirectoryEntries,
  readExplorerFile,
  renameExplorerEntry,
  streamExplorerFile,
  writeExplorerFile,
} from "./service.js";

const RUNTIME_ROOT = "/pod/ws";

let host: string;
let pod: string;

/** A runtime whose files are a temp directory: the daemon's directory beside it stays empty. */
function podBackend() {
  const local = (runtimePath: string): string => {
    const relative = path.posix.relative(RUNTIME_ROOT, runtimePath);
    if (relative.startsWith("..")) throw new Error("EACCES: outside the workspace");
    return path.join(pod, relative);
  };
  const wrap = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new Error(code ? `${code}: ${(error as Error).message}` : (error as Error).message, {
        cause: error,
      });
    }
  };
  const kindOf = (s: Awaited<ReturnType<typeof stat>>) => {
    if (s.isDirectory()) return "directory" as const;
    return s.isFile() ? ("file" as const) : ("other" as const);
  };
  const toStat = (s: Awaited<ReturnType<typeof stat>>) => ({
    kind: kindOf(s),
    size: Number(s.size),
    mtimeMs: Number(s.mtimeMs),
    mode: Number(s.mode) & 0o777,
  });
  const calls: string[] = [];
  const backend = {
    id: "pod",
    label: "Pod",
    providesFiles: true,
    calls,
    mapCwd: async () => RUNTIME_ROOT,
    fs: async (verb: string, request: Record<string, unknown>) => {
      calls.push(verb);
      const target = local(request.path as string);
      return wrap(async () => {
        switch (verb) {
          case "fs.stat":
            return stat(target).then(toStat, (error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return null;
              throw error;
            });
          case "fs.readdir": {
            const names = await readdir(target);
            return Promise.all(
              names.map(async (name) =>
                Object.assign({ name }, toStat(await stat(path.join(target, name)))),
              ),
            );
          }
          case "fs.read": {
            const bytes = await readFile(target);
            const offset = (request.offset as number | undefined) ?? 0;
            const length = request.length as number | undefined;
            return new Uint8Array(
              bytes.subarray(offset, length === undefined ? undefined : offset + length),
            );
          }
          case "fs.write": {
            if (request.exclusive) {
              await writeFile(target, request.data as Uint8Array, {
                flag: "wx",
                mode: request.mode as number,
              });
            } else {
              const current = await stat(target).catch(() => null);
              if (
                current &&
                request.expectedMtimeMs !== undefined &&
                current.mtimeMs !== request.expectedMtimeMs
              ) {
                throw new Error("ECONFLICT: file changed");
              }
              await writeFile(target, request.data as Uint8Array, { mode: request.mode as number });
            }
            return toStat(await stat(target));
          }
          case "fs.mkdir":
            return mkdir(target);
          case "fs.rename":
            return rename(target, local(request.to as string));
          case "fs.remove":
            return rm(target, { recursive: request.recursive === true });
          case "fs.copy":
            return cp(target, local(request.to as string), { recursive: true });
          default:
            throw new Error(`unsupported ${verb}`);
        }
      });
    },
  };
  return backend;
}

beforeEach(async () => {
  host = await mkdtemp(path.join(os.tmpdir(), "explorer-host-"));
  pod = await mkdtemp(path.join(os.tmpdir(), "explorer-pod-"));
  await mkdir(path.join(pod, "src"));
  await writeFile(path.join(pod, "src", "a.ts"), "export const a = 1;\n");
  await writeFile(path.join(pod, "README.md"), "# pod\n");
  await writeFile(path.join(pod, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  // The daemon's own copy is stale and must never be read.
  await writeFile(path.join(host, "README.md"), "# stale host copy\n");
  const backend = podBackend();
  setExplorerRuntimeResolver((directory) =>
    directory.startsWith(host)
      ? ({ backend, workspaceId: "wks_pod", hostRoot: host } as never)
      : null,
  );
});

afterEach(async () => {
  setExplorerRuntimeResolver(null);
  await rm(host, { recursive: true, force: true });
  await rm(pod, { recursive: true, force: true });
});

describe("file explorer in a workspace runtime", () => {
  it("lists and reads the runtime's files, not the host's", async () => {
    const listing = await listDirectoryEntries({ root: host });
    expect(listing.entries.map((entry) => `${entry.kind}:${entry.name}`).sort()).toEqual([
      "directory:src",
      "file:README.md",
      "file:logo.png",
    ]);
    const readme = await readExplorerFile({ root: host, relativePath: "README.md" });
    expect(readme).toMatchObject({ kind: "text", encoding: "utf-8", content: "# pod\n" });
    const image = await readExplorerFile({ root: host, relativePath: "logo.png" });
    expect(image).toMatchObject({ kind: "image", encoding: "base64", mimeType: "image/png" });
    await expect(listDirectoryEntries({ root: host, relativePath: "../escape" })).rejects.toThrow(
      "Access outside of workspace is not allowed",
    );
  });

  it("writes with conflict detection and keeps the file's mode", async () => {
    const version = await getExplorerFileVersion({ root: host, relativePath: "src/a.ts" });
    if (version.status !== "ready") throw new Error("expected a ready version");
    const written = await writeExplorerFile({
      root: host,
      relativePath: "src/a.ts",
      content: "export const a = 22;\n",
      expectedModifiedAt: version.modifiedAt,
      expectedRevision: version.revision,
    });
    expect(written.status).toBe("written");
    expect(await readFile(path.join(pod, "src", "a.ts"), "utf8")).toBe("export const a = 22;\n");
    const stale = await writeExplorerFile({
      root: host,
      relativePath: "src/a.ts",
      content: "lost\n",
      expectedModifiedAt: version.modifiedAt,
      expectedRevision: version.revision,
    });
    expect(stale.status).toBe("conflict");
    expect(await readFile(path.join(pod, "src", "a.ts"), "utf8")).toBe("export const a = 22;\n");
  });

  it("creates, duplicates, renames and deletes entries in the runtime", async () => {
    expect(
      await createExplorerEntry({ root: host, parentPath: "src", name: "b.ts", kind: "file" }),
    ).toEqual({
      status: "ok",
      path: "src/b.ts",
    });
    expect(
      await createExplorerEntry({ root: host, parentPath: "src", name: "b.ts", kind: "file" }),
    ).toEqual({
      status: "error",
      error: '"b.ts" already exists',
    });
    expect(await duplicateExplorerEntry({ root: host, relativePath: "src/a.ts" })).toEqual({
      status: "ok",
      path: "src/a copy.ts",
    });
    expect(
      await renameExplorerEntry({ root: host, relativePath: "src/b.ts", name: "c.ts" }),
    ).toEqual({
      status: "ok",
      path: "src/c.ts",
    });
    expect(await deleteExplorerEntry({ root: host, relativePath: "src/c.ts" })).toEqual({
      status: "ok",
      path: "src/c.ts",
    });
    expect((await readdir(path.join(pod, "src"))).sort()).toEqual(["a copy.ts", "a.ts"]);
    expect(await deleteExplorerEntry({ root: host, relativePath: "." })).toEqual({
      status: "error",
      error: "Cannot delete the workspace root",
    });
  });

  it("streams a file in chunks and describes it for download", async () => {
    const chunks: Uint8Array[] = [];
    await streamExplorerFile({ root: host, relativePath: "README.md" }, async (file) => {
      expect(file).toMatchObject({ kind: "text", encoding: "utf-8", size: 6 });
      for await (const chunk of file.chunks) chunks.push(chunk);
    });
    expect(Buffer.concat(chunks).toString()).toBe("# pod\n");
    expect(await getDownloadableFileInfo({ root: host, relativePath: "README.md" })).toMatchObject({
      path: "README.md",
      fileName: "README.md",
      size: 6,
      absolutePath: path.join(host, "README.md"),
    });
  });

  it("reports a missing file as missing and refuses a runtime without files", async () => {
    expect(await getExplorerFileVersion({ root: host, relativePath: "nope.txt" })).toMatchObject({
      status: "missing",
    });
    setExplorerRuntimeResolver(
      () =>
        ({
          backend: { id: "bare", providesFiles: false },
          workspaceId: "w",
          hostRoot: host,
        }) as never,
    );
    await expect(listDirectoryEntries({ root: host })).rejects.toThrow(/does not provide files/);
  });
});
