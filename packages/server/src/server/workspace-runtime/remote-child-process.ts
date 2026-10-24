import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { PassThrough, Writable } from "node:stream";
import type { WorkspaceRuntimeExit } from "@getpaseo/plugin/server";
import type { RuntimeExecControl, RuntimeExecSink } from "./types.js";

export type RemoteStart = (sink: RuntimeExecSink) => Promise<RuntimeExecControl>;

/**
 * Detail a caller can read to tell a lost runtime from a finished process. It is set before
 * "exit" fires.
 */
export interface RemoteChildProcess extends ChildProcess {
  readonly runtimeExit: WorkspaceRuntimeExit | null;
}

/**
 * A ChildProcess whose process runs inside a workspace runtime. Providers spawn synchronously,
 * so this returns at once: stdin is buffered, and `start` runs in the background. A start that
 * fails surfaces as "error" followed by "close", like a missing binary does for a local spawn.
 */
export function createRemoteChildProcess(start: RemoteStart): RemoteChildProcess {
  const emitter = new EventEmitter();
  const state = {
    killed: false,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
  };
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let control: RuntimeExecControl | null = null;
  let started = false;
  let finished = false;
  let killRequested: string | null = null;
  const pendingStdin: Array<Uint8Array | null> = [];
  let runtimeExit: WorkspaceRuntimeExit | null = null;

  const flushStdin = (): void => {
    if (!control || !started) return;
    for (const chunk of pendingStdin.splice(0)) control.writeStdin(chunk);
  };

  const stdin = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      pendingStdin.push(new Uint8Array(chunk));
      flushStdin();
      callback();
    },
    final(callback) {
      pendingStdin.push(null);
      flushStdin();
      callback();
    },
  });

  const child = emitter as unknown as RemoteChildProcess;
  Object.assign(child, {
    stdin,
    stdout,
    stderr,
    stdio: [stdin, stdout, stderr, null, null],
    pid: undefined,
    connected: false,
    spawnfile: "",
    spawnargs: [],
    kill(signal?: NodeJS.Signals | number): boolean {
      if (finished) return false;
      const name = typeof signal === "number" ? String(signal) : (signal ?? "SIGTERM");
      killRequested = name;
      state.killed = true;
      if (control) control.signal(name);
      else void startPromise.then((c) => c?.signal(name));
      return true;
    },
    ref() {
      return child;
    },
    unref() {
      return child;
    },
  });

  Object.defineProperties(child, {
    killed: { get: () => state.killed },
    exitCode: { get: () => state.exitCode },
    signalCode: { get: () => state.signalCode },
    runtimeExit: { get: () => runtimeExit },
  });

  const finish = (exit: WorkspaceRuntimeExit): void => {
    if (finished) return;
    finished = true;
    runtimeExit = exit;
    state.exitCode = exit.code;
    state.signalCode = (exit.signal as NodeJS.Signals | null) ?? null;
    stdout.end();
    stderr.end();
    stdin.destroy();
    const signal = state.signalCode;
    emitter.emit("exit", exit.code, signal);
    emitter.emit("close", exit.code, signal);
  };

  const sink: RuntimeExecSink = {
    onStarted() {
      started = true;
      emitter.emit("spawn");
      flushStdin();
      if (killRequested) control?.signal(killRequested);
    },
    onStdout: (data) => void stdout.write(data),
    onStderr: (data) => void stderr.write(data),
    onExit: finish,
    onFailed(error) {
      if (finished) return;
      emitter.emit("error", error);
      finish({ code: null, signal: null, reason: "runtime-lost", message: error.message });
    },
  };

  const startPromise: Promise<RuntimeExecControl | null> = start(sink).then(
    (startedControl) => {
      control = startedControl;
      // "started" can arrive before the control handle does.
      flushStdin();
      if (started && killRequested) control.signal(killRequested);
      return startedControl;
    },
    (error: unknown) => {
      sink.onFailed(error instanceof Error ? error : new Error(String(error)));
      return null;
    },
  );
  return child;
}
