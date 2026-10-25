import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type {
  WorkspaceRuntimeExit,
  WorkspaceRuntimeExecRequest,
  WorkspaceRuntimePrepareRequest,
  WorkspaceRuntimeRegistration,
} from "@getpaseo/plugin/server";
import { createPluginRuntimeHost } from "../plugins/plugin-runtime-host.js";
import type {
  PluginProcessMessage,
  PluginProcessRequest,
} from "../plugins/plugin-process-protocol.js";
import { PluginRuntimeBackend } from "../plugins/plugin-runtime-backend.js";
import { createRuntimeProcessLauncher } from "./process-launcher.js";
import { setCommandLauncherResolver, spawnWorkspaceCommand } from "../../utils/command-launcher.js";
import { createLineRewriter, rewritePathPrefix } from "./path-map.js";
import { WorkspaceRuntimeRegistry } from "./registry.js";
import { RuntimeWorkspaceIndex } from "./workspace-index.js";
import { spawnProviderProcess } from "./spawn-provider-process.js";
import { WorkspaceRuntimeUnavailableError, type RuntimeNotice } from "./types.js";

interface Harness {
  backend: PluginRuntimeBackend;
  calls: string[];
  prepared: WorkspaceRuntimePrepareRequest[];
  execs: WorkspaceRuntimeExecRequest[];
  notices: RuntimeNotice[];
  finishLast(exit: WorkspaceRuntimeExit): void;
  launch(overrides?: { purpose?: "session" | "probe" }): ReturnType<typeof spawnProviderProcess>;
  launcher: ReturnType<typeof createRuntimeProcessLauncher>;
  stdinSeen: string[];
  reconciles: string[][];
}

/** A real plugin worker and a real backend, joined by an in-memory channel. */
function createHarness(
  options: { failExec?: string; mapTo?: string; missing?: string[]; live?: boolean } = {},
): Harness {
  const calls: string[] = [];
  const prepared: WorkspaceRuntimePrepareRequest[] = [];
  const execs: WorkspaceRuntimeExecRequest[] = [];
  const stdinSeen: string[] = [];
  const reconciles: string[][] = [];
  const notices: RuntimeNotice[] = [];
  const exits: Array<(exit: WorkspaceRuntimeExit) => void> = [];
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  let backend!: PluginRuntimeBackend;

  const runtime: WorkspaceRuntimeRegistration = {
    id: "fake",
    label: "Fake",
    describe: () => ({ protocolVersion: 1, capabilities: { pipes: true, pty: false } }),
    ...(options.mapTo ? { mapCwd: () => options.mapTo! } : {}),
    reconcile: (request) => {
      calls.push("reconcile");
      reconciles.push(request.workspaces.map((workspace) => workspace.workspaceId));
    },
    checkCommand: ({ command }) => !(options.missing ?? []).includes(command),
    prepare: (request, context) => {
      calls.push("prepare");
      prepared.push(request);
      context.notice("pod pending", "info");
    },
    exec: (request) => {
      calls.push("exec");
      execs.push(request);
      if (options.failExec) throw new Error(options.failExec);
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      stdin.on("data", (chunk) => {
        stdinSeen.push(chunk.toString());
        stdout.write(chunk);
      });
      stdin.on("end", () => stdout.end());
      let resolveExit!: (exit: WorkspaceRuntimeExit) => void;
      const exit = new Promise<WorkspaceRuntimeExit>((resolve) => {
        resolveExit = resolve;
      });
      exits.push(resolveExit);
      return {
        stdin,
        stdout,
        stderr,
        exit,
        signal: (signal) => resolveExit({ code: null, signal, reason: "exited" }),
      };
    },
  };

  const host = createPluginRuntimeHost({
    send(message: PluginProcessMessage) {
      if (message.type.startsWith("runtime.")) {
        backend.handleMessage(message as Parameters<PluginRuntimeBackend["handleMessage"]>[0]);
      }
    },
  });
  host.register(runtime);
  const reply = {
    result(requestId: string, output: unknown) {
      const waiter = pending.get(requestId);
      pending.delete(requestId);
      waiter?.resolve(output);
    },
    error(requestId: string, error: string) {
      const waiter = pending.get(requestId);
      pending.delete(requestId);
      waiter?.reject(new Error(error));
    },
  };
  const deliver = (message: PluginProcessRequest) => {
    host.handle(message, reply);
  };
  backend = new PluginRuntimeBackend("fake", "Fake", undefined, false, () => "/daemon/ws", {
    call: (message) =>
      new Promise((resolve, reject) => {
        pending.set(message.requestId, { resolve, reject });
        queueMicrotask(() => deliver(message));
      }),
    post: (message) => queueMicrotask(() => deliver(message)),
  });
  const launcher = createRuntimeProcessLauncher({
    backend,
    workspaceId: "wks_0123456789abcdef",
    agentId: "agent-1",
    provider: "claude",
    workspaceRoot: options.mapTo ? "/daemon/ws" : undefined,
    ...(options.live
      ? { liveWorkspaces: () => [{ workspaceId: "wks_0123456789abcdef", cwd: "/daemon/ws" }] }
      : {}),
    mcpServers: () => ({ tools: { type: "stdio", command: "mcp-tools" } }),
    onNotice: (notice) => notices.push(notice),
  });
  return {
    backend,
    launcher,
    stdinSeen,
    reconciles,
    calls,
    prepared,
    execs,
    notices,
    finishLast: (exit) => exits.at(-1)?.(exit),
    launch: (overrides) =>
      spawnProviderProcess("claude", ["--print"], {
        launcher,
        purpose: overrides?.purpose,
        cwd: "/daemon/checkout",
        envOverlay: { PASEO_AGENT_ID: "agent-1", DROPPED: undefined },
      }),
  };
}

describe("workspace runtime process launch", () => {
  it("pipes stdio through the plugin and prepares with the final launch", async () => {
    const harness = createHarness();
    const child = harness.launch();
    const output = new Promise<string>((resolve) =>
      child.stdout!.once("data", (chunk) => resolve(chunk.toString())),
    );
    const closed = new Promise<[number | null, string | null]>((resolve) =>
      child.once("close", (code, signal) => resolve([code, signal])),
    );
    child.stdin!.write("hello\n");
    child.stdin!.end();
    expect(await output).toBe("hello\n");
    harness.finishLast({ code: 0, signal: null, reason: "exited" });
    expect(await closed).toEqual([0, null]);
    expect(harness.calls).toEqual(["prepare", "exec"]);
    expect(harness.prepared[0]).toMatchObject({
      workspaceId: "wks_0123456789abcdef",
      agentId: "agent-1",
      provider: "claude",
      purpose: "session",
      argv: ["claude", "--print"],
      cwd: "/daemon/checkout",
      env: { PASEO_AGENT_ID: "agent-1" },
    });
    expect(harness.execs[0]?.env).toEqual({ PASEO_AGENT_ID: "agent-1" });
    expect(harness.notices).toEqual([
      { workspaceId: "wks_0123456789abcdef", level: "info", message: "pod pending" },
    ]);
  });

  it("never prepares a probe, so a probe cannot create a sandbox", async () => {
    const harness = createHarness();
    const child = harness.launch({ purpose: "probe" });
    await new Promise<void>((resolve) => child.once("spawn", () => resolve()));
    expect(harness.calls).toEqual(["exec"]);
    expect(harness.execs[0]?.purpose).toBe("probe");
    child.kill();
  });

  it("reports a lost runtime and reconciles it", async () => {
    const harness = createHarness({ live: true });
    const child = harness.launch() as ReturnType<typeof harness.launch> & {
      runtimeExit: WorkspaceRuntimeExit | null;
    };
    await new Promise<void>((resolve) => child.once("spawn", () => resolve()));
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    harness.finishLast({
      code: null,
      signal: null,
      reason: "runtime-lost",
      message: "pod evicted",
    });
    await exited;
    expect(child.runtimeExit).toMatchObject({ reason: "runtime-lost", message: "pod evicted" });
    await expect.poll(() => harness.calls.includes("reconcile")).toBe(true);
  });

  it("surfaces a launch failure as a spawn error and close", async () => {
    const harness = createHarness({ failExec: "unschedulable volume" });
    const child = harness.launch();
    const events: string[] = [];
    const error = new Promise<Error>((resolve) => child.once("error", resolve));
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    child.once("error", () => events.push("error"));
    child.once("close", () => events.push("close"));
    expect((await error).message).toBe("unschedulable volume");
    await closed;
    expect(events).toEqual(["error", "close"]);
  });

  it("forwards kill to the runtime", async () => {
    const harness = createHarness();
    const child = harness.launch();
    const closed = new Promise<string | null>((resolve) =>
      child.once("close", (_code, signal) => resolve(signal)),
    );
    child.kill("SIGTERM");
    expect(await closed).toBe("SIGTERM");
  });
});

describe("workspace runtime registry", () => {
  it("refuses a runtime nobody registered instead of falling back to the host", () => {
    const registry = new WorkspaceRuntimeRegistry();
    expect(() => registry.require("missing")).toThrow(WorkspaceRuntimeUnavailableError);
    expect(() => registry.require("missing")).toThrow(/does not fall back to running on the host/);
  });
});

describe("workspace runtime path mapping", () => {
  it("rewrites a path prefix only where it stands alone", () => {
    const rewrite = (text: string) => rewritePathPrefix(text, "/daemon/ws", "/pod/ws");
    expect(rewrite('{"cwd":"/daemon/ws","file":"/daemon/ws/src/a.ts"}')).toBe(
      '{"cwd":"/pod/ws","file":"/pod/ws/src/a.ts"}',
    );
    expect(rewrite("/daemon/ws2 /other/daemon/ws /daemon/ws.bak")).toBe(
      "/daemon/ws2 /other/daemon/ws /daemon/ws.bak",
    );
    expect(rewrite("file:///daemon/ws/x")).toBe("file:///pod/ws/x");
  });

  it("rewrites whole lines even when a path is split across chunks", () => {
    const lines = createLineRewriter((line) => rewritePathPrefix(line, "/a", "/b"));
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const out = [
      ...lines.push(encoder.encode('{"p":"/')),
      ...lines.push(encoder.encode('a/x"}\n{"p":"/a"}')),
      ...lines.flush(),
    ].map((chunk) => decoder.decode(chunk));
    expect(out.join("")).toBe('{"p":"/b/x"}\n{"p":"/b"}');
  });

  it("maps argv, env, cwd and both stream directions through the runtime's mapCwd", async () => {
    const harness = createHarness({ mapTo: "/pod/ws" });
    const child = spawnProviderProcess("claude", ["--add-dir", "/daemon/ws/extra"], {
      launcher: harness.launcher,
      cwd: "/daemon/ws/sub",
      envOverlay: { PASEO_AGENT_CWD: "/daemon/ws/sub" },
    });
    const echoed = new Promise<string>((resolve) =>
      child.stdout!.once("data", (chunk) => resolve(chunk.toString())),
    );
    child.stdin!.write('{"cwd":"/daemon/ws/sub"}\n');
    expect(await echoed).toBe('{"cwd":"/daemon/ws/sub"}\n');
    expect(harness.execs[0]).toMatchObject({
      argv: ["claude", "--add-dir", "/pod/ws/extra"],
      cwd: "/pod/ws/sub",
      env: { PASEO_AGENT_CWD: "/pod/ws/sub" },
    });
    expect(harness.stdinSeen).toEqual(['{"cwd":"/pod/ws/sub"}\n']);
    child.kill();
  });
});

describe("workspace commands", () => {
  it("runs a command in the runtime without preparing and keeps binary output intact", async () => {
    const harness = createHarness({ mapTo: "/pod/ws" });
    setCommandLauncherResolver((cwd) => (cwd.startsWith("/daemon/ws") ? harness.launcher : null));
    try {
      const child = spawnWorkspaceCommand("git", ["status"], {
        cwd: "/daemon/ws",
        interactive: true,
        envOverlay: { GIT_OPTIONAL_LOCKS: "0" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const binary = Buffer.from([0xff, 0xfe, 0x00, 0x80]);
      const out = new Promise<Buffer>((resolve) => {
        const chunks: Buffer[] = [];
        child.stdout!.on("data", (chunk: Buffer) => chunks.push(chunk));
        child.stdout!.on("end", () => resolve(Buffer.concat(chunks)));
      });
      child.stdin!.write(binary);
      child.stdin!.end();
      await new Promise<void>((resolve) => child.once("spawn", () => resolve()));
      harness.finishLast({ code: 0, signal: null, reason: "exited" });
      expect((await out).equals(binary)).toBe(true);
      expect(harness.calls).toEqual(["exec"]);
      expect(harness.execs[0]).toMatchObject({
        purpose: "command",
        interactive: true,
        cwd: "/pod/ws",
        env: { GIT_OPTIONAL_LOCKS: "0" },
      });
    } finally {
      setCommandLauncherResolver(null);
    }
  });

  it("finds the deepest runtime workspace for a path and never falls back to the host", async () => {
    const registry = new WorkspaceRuntimeRegistry();
    const index = new RuntimeWorkspaceIndex({
      workspaceRegistry: {
        list: async () => [
          { workspaceId: "wks_a", cwd: "/daemon/a", runtime: { id: "gone" }, archivedAt: null },
          { workspaceId: "wks_host", cwd: "/daemon/host", archivedAt: null },
        ],
        subscribeToMutations: () => () => {},
      } as never,
      runtimes: registry,
      logger: { debug() {}, warn() {} } as never,
    });
    await index.initialize();
    expect(index.find("/daemon/a/src/x.ts")?.workspaceId).toBe("wks_a");
    expect(index.find("/daemon/host")).toBeNull();
    expect(index.launcherForPath("/daemon/host/src")).toBeNull();
    const child = index.launcherForPath("/daemon/a")!.spawn({ command: "git", args: [], env: {} });
    const error = await new Promise<Error>((resolve) => child.once("error", resolve));
    expect(error).toBeInstanceOf(WorkspaceRuntimeUnavailableError);
  });
});

const onNotice = () => () => undefined;

describe("live workspace runtime backend", () => {
  it("follows a plugin reload and fails, not falls back, once the runtime is gone", () => {
    const registry = new WorkspaceRuntimeRegistry();
    const first = { id: "pod", label: "First", providesFiles: false, onNotice } as never;
    const unregister = registry.register(first);
    const live = registry.live("pod");
    expect(live.label).toBe("First");
    unregister();
    registry.register({ id: "pod", label: "Reloaded", providesFiles: false, onNotice } as never);
    expect(live.label).toBe("Reloaded");
    const gone = new WorkspaceRuntimeRegistry();
    expect(() => gone.live("pod").label).toThrow(WorkspaceRuntimeUnavailableError);
  });
});

describe("workspace runtime display details", () => {
  function runtimeWithDisplay(calls: { count: number }) {
    const listeners = new Set<(notice: { workspaceId: string }) => void>();
    return {
      backend: {
        id: "pod",
        label: "Pod",
        providesFiles: false,
        onNotice: (listener: (notice: { workspaceId: string }) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        describeWorkspace: async () => {
          calls.count += 1;
          return { label: `image-${calls.count}`, tooltip: "full ref" };
        },
      },
      notify: (workspaceId: string) => listeners.forEach((listener) => listener({ workspaceId })),
    };
  }

  it("caches a workspace's details, refreshes after a state change and has none for an unknown runtime", async () => {
    const registry = new WorkspaceRuntimeRegistry();
    const calls = { count: 0 };
    const { backend, notify } = runtimeWithDisplay(calls);
    registry.register(backend as never);
    const request = { workspaceId: "w1" };

    expect(await registry.displayOf("pod", request)).toEqual({
      label: "image-1",
      tooltip: "full ref",
    });
    expect(await registry.displayOf("pod", request)).toEqual({
      label: "image-1",
      tooltip: "full ref",
    });
    expect(calls.count).toBe(1);

    notify("w1");
    expect((await registry.displayOf("pod", request))?.label).toBe("image-2");

    expect(await registry.displayOf("gone", request)).toBeNull();

    const withIcon = new WorkspaceRuntimeRegistry();
    withIcon.register({
      ...backend,
      describeWorkspace: async () => ({ hostIcon: "Ship", tooltip: "pod" }),
    } as never);
    expect(await withIcon.displayOf("pod", request)).toEqual({ hostIcon: "Ship", tooltip: "pod" });
  });

  it("answers null when the runtime cannot describe the workspace", async () => {
    const registry = new WorkspaceRuntimeRegistry();
    registry.register({
      id: "pod",
      label: "Pod",
      providesFiles: false,
      onNotice: () => () => undefined,
      describeWorkspace: async () => {
        throw new Error("pod is gone");
      },
    } as never);
    expect(await registry.displayOf("pod", { workspaceId: "w1" })).toBeNull();
  });
});

describe("workspace runtime lifecycle", () => {
  it("reconciles a lost runtime with the live workspaces, and not without them", async () => {
    const live = createHarness({ live: true });
    const child = live.launch();
    await new Promise<void>((resolve) => child.once("spawn", () => resolve()));
    live.finishLast({ code: null, signal: null, reason: "runtime-lost" });
    await expect.poll(() => live.reconciles).toEqual([["wks_0123456789abcdef"]]);

    const blind = createHarness();
    const other = blind.launch();
    await new Promise<void>((resolve) => other.once("spawn", () => resolve()));
    blind.finishLast({ code: null, signal: null, reason: "runtime-lost" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(blind.reconciles).toEqual([]);
  });

  it("fails a session whose provider binary is missing from the runtime", async () => {
    const harness = createHarness({ missing: ["claude"] });
    const child = harness.launch();
    const error = await new Promise<Error>((resolve) => child.once("error", resolve));
    expect(error.message).toBe(
      `"claude" was not found in the "fake" runtime. Install it in the runtime's image.`,
    );
    expect(harness.calls).not.toContain("exec");
  });

  it("warns about a missing stdio MCP binary and still launches", async () => {
    const harness = createHarness({ missing: ["mcp-tools"] });
    const child = harness.launch();
    await new Promise<void>((resolve) => child.once("spawn", () => resolve()));
    expect(harness.notices).toContainEqual({
      workspaceId: "wks_0123456789abcdef",
      level: "warning",
      message: `MCP server "tools" runs "mcp-tools", which was not found in the "fake" runtime.`,
    });
    child.kill();
  });

  it("destroys the sandbox when a workspace is archived or removed by any path", async () => {
    const destroyed: string[] = [];
    const registry = new WorkspaceRuntimeRegistry();
    const reconciled: string[][] = [];
    registry.register({
      id: "pod",
      label: "Pod",
      providesFiles: false,
      onNotice,
      destroy: async (request: { workspaceId: string }) => void destroyed.push(request.workspaceId),
      reconcile: async (request: { workspaces: Array<{ workspaceId: string }> }) =>
        void reconciled.push(request.workspaces.map((workspace) => workspace.workspaceId)),
    } as never);
    let notify: (mutation: unknown) => void = () => {};
    const index = new RuntimeWorkspaceIndex({
      workspaceRegistry: {
        list: async () => [
          { workspaceId: "wks_a", cwd: "/d/a", runtime: { id: "pod" }, archivedAt: null },
          { workspaceId: "wks_b", cwd: "/d/b", runtime: { id: "pod" }, archivedAt: null },
        ],
        subscribeToMutations: (listener: (mutation: unknown) => void) => {
          notify = listener;
          return () => {};
        },
      } as never,
      runtimes: registry,
      logger: { debug() {}, warn() {} } as never,
    });
    await index.initialize();
    expect(reconciled).toEqual([["wks_a", "wks_b"]]);
    notify({ kind: "archive", workspaceId: "wks_a", workspace: null });
    notify({ kind: "remove", workspaceId: "wks_b", workspace: null });
    notify({ kind: "remove", workspaceId: "wks_b", workspace: null });
    await expect.poll(() => destroyed).toEqual(["wks_a", "wks_b"]);
    expect(index.workspacesOf("pod")).toEqual([]);
  });
});

describe("workspace directory on every call", () => {
  it("tells the runtime where the workspace is, whatever options it inherited", async () => {
    const seen: Array<{ workspaceCwd?: string }> = [];
    const host = createPluginRuntimeHost({ send: () => undefined });
    host.register({
      id: "fake",
      label: "Fake",
      describe: () => ({ protocolVersion: 1, capabilities: { pipes: true, pty: false } }),
      beforeInput: (request) => void seen.push(request),
      exec: () => {
        throw new Error("unused");
      },
    });
    const pending = new Map<string, { resolve(value: unknown): void }>();
    const backend = new PluginRuntimeBackend(
      "fake",
      "Fake",
      undefined,
      false,
      (id) => (id === "wks_a" ? "/daemon/a" : undefined),
      {
        call: (message) =>
          new Promise((resolve) => {
            pending.set(message.requestId, { resolve });
            host.handle(message, {
              result: (requestId, output) => pending.get(requestId)?.resolve(output),
              error: (requestId) => pending.get(requestId)?.resolve(null),
            });
          }),
        post: () => undefined,
      },
    );
    await backend.beforeInput({
      workspaceId: "wks_a",
      agentId: "agent-1",
      options: { cwd: "/caller/copy" },
    });
    expect(seen).toEqual([expect.objectContaining({ workspaceCwd: "/daemon/a" })]);
  });
});
