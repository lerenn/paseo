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
import { createLineRewriter, rewritePathPrefix } from "./path-map.js";
import { WorkspaceRuntimeRegistry } from "./registry.js";
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
}

/** A real plugin worker and a real backend, joined by an in-memory channel. */
function createHarness(options: { failExec?: string; mapTo?: string } = {}): Harness {
  const calls: string[] = [];
  const prepared: WorkspaceRuntimePrepareRequest[] = [];
  const execs: WorkspaceRuntimeExecRequest[] = [];
  const stdinSeen: string[] = [];
  const notices: RuntimeNotice[] = [];
  const exits: Array<(exit: WorkspaceRuntimeExit) => void> = [];
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  let backend!: PluginRuntimeBackend;

  const runtime: WorkspaceRuntimeRegistration = {
    id: "fake",
    label: "Fake",
    describe: () => ({ protocolVersion: 1, capabilities: { pipes: true, pty: false } }),
    ...(options.mapTo ? { mapCwd: () => options.mapTo! } : {}),
    reconcile: () => {
      calls.push("reconcile");
    },
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
  backend = new PluginRuntimeBackend("fake", "Fake", undefined, {
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
    onNotice: (notice) => notices.push(notice),
  });
  return {
    backend,
    launcher,
    stdinSeen,
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
    const harness = createHarness();
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
