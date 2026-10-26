import { expect, test } from "vitest";
import { createPaseoApi } from "@getpaseo/client";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import { PluginHookHandlers, describeHookAgent } from "./index.js";

const paseo = createPaseoApi(
  new DaemonClient({ url: "ws://127.0.0.1:1/ws", clientId: "lifecycle-unit" }),
);

test("removing an old registration twice preserves a newer registration for the same hook", async () => {
  const hooks = new PluginHookHandlers(() => {});
  const remove = hooks.before("workspace.create", ({ request }) => {
    return { ...request, title: "old" };
  });
  remove();
  hooks.before("workspace.create", ({ request }) => {
    return { ...request, title: "new" };
  });
  remove();
  const output = await hooks.invoke(
    "operation",
    "before",
    "workspace.create",
    {
      source: { kind: "directory", path: "/project" },
    },
    paseo,
  );
  expect(output).toEqual({ source: { kind: "directory", path: "/project" }, title: "new" });
});

test("before hooks compose returned requests and preserve the original input", async () => {
  const hooks = new PluginHookHandlers(() => {});
  hooks.before("workspace.create", ({ request }) => {
    return { ...request, title: "first" };
  });
  hooks.before("workspace.create", () => {
    return;
  });
  hooks.before("workspace.create", ({ request }) => {
    return { ...request, title: request.title + ":second" };
  });
  const input = { source: { kind: "directory", path: "/project" } };
  expect(await hooks.invoke("operation", "before", "workspace.create", input, paseo)).toEqual({
    source: { kind: "directory", path: "/project" },
    title: "first:second",
  });
  expect(input).toEqual({ source: { kind: "directory", path: "/project" } });
});

test("teardown aborts an active callback and removes its registrations", async () => {
  const hooks = new PluginHookHandlers(() => {});
  hooks.before("workspace.create", async (_input, context) => {
    await new Promise<void>((_resolve, reject) => {
      context.signal.addEventListener(
        "abort",
        () => {
          reject(new Error("Hook aborted"));
        },
        { once: true },
      );
    });
  });
  const invocation = hooks.invoke(
    "operation",
    "before",
    "workspace.create",
    {
      source: { kind: "directory", path: "/project" },
    },
    paseo,
  );
  hooks.close();
  await expect(invocation).rejects.toThrow("Hook aborted");
  expect(hooks.catalog()).toEqual({ events: [], before: [] });
});

test("session-open hooks reject changes to session identity instead of silently ignoring them", async () => {
  const hooks = new PluginHookHandlers(() => {});
  hooks.before("agent.session_open", ({ request }) => {
    return { ...request, provider: "another-provider" };
  });
  await expect(
    hooks.invoke(
      "operation",
      "before",
      "agent.session_open",
      {
        agentId: "agent",
        workspaceId: "workspace",
        provider: "claude",
        cwd: "/project",
        reason: "resume",
        purpose: "interactive",
        env: {},
      },
      paseo,
    ),
  ).rejects.toThrow("agent.session_open hooks can only change env");
});

const createConfig = { provider: "claude", cwd: "/project" };

test("agent.create hooks see the labels and parent of a top-level agent and of a subagent", async () => {
  const hooks = new PluginHookHandlers(() => {});
  const seen: Array<{ labels: Record<string, string>; parentAgentId: string | null }> = [];
  hooks.before("agent.create", ({ request }) => {
    seen.push({ labels: request.labels, parentAgentId: request.parentAgentId });
  });
  await hooks.invoke(
    "operation",
    "before",
    "agent.create",
    { config: createConfig, labels: { team: "payments" }, parentAgentId: null },
    paseo,
  );
  await hooks.invoke(
    "operation",
    "before",
    "agent.create",
    {
      config: createConfig,
      labels: { [PARENT_AGENT_ID_LABEL]: "agent-1" },
      parentAgentId: "agent-1",
    },
    paseo,
  );
  expect(seen).toEqual([
    { labels: { team: "payments" }, parentAgentId: null },
    { labels: { [PARENT_AGENT_ID_LABEL]: "agent-1" }, parentAgentId: "agent-1" },
  ]);
});

test("edits to the labels and parent of agent.create are ignored", async () => {
  const hooks = new PluginHookHandlers(() => {});
  hooks.before("agent.create", ({ request }) => ({
    ...request,
    labels: { injected: "yes" },
    parentAgentId: "someone-else",
  }));
  const later: Array<{ labels: Record<string, string>; parentAgentId: string | null }> = [];
  hooks.before("agent.create", ({ request }) => {
    later.push({ labels: request.labels, parentAgentId: request.parentAgentId });
  });
  const output = (await hooks.invoke(
    "operation",
    "before",
    "agent.create",
    { config: createConfig, labels: { team: "payments" }, parentAgentId: null },
    paseo,
  )) as { labels: Record<string, string>; parentAgentId: string | null };
  expect(output.labels).toEqual({ team: "payments" });
  expect(output.parentAgentId).toBeNull();
  expect(later).toEqual([{ labels: { team: "payments" }, parentAgentId: null }]);
});

test("agent events carry the agent's labels", () => {
  expect(
    describeHookAgent({
      id: "a",
      provider: "claude",
      cwd: "/project",
      labels: { team: "payments", [PARENT_AGENT_ID_LABEL]: "p" },
    }),
  ).toMatchObject({
    labels: { team: "payments", [PARENT_AGENT_ID_LABEL]: "p" },
    parentAgentId: "p",
  });
});

test("agent.prompt hooks compose prepends in order and cannot change anything else", async () => {
  const hooks = new PluginHookHandlers(() => {});
  hooks.before("agent.prompt", ({ request }) => ({
    ...request,
    prompt: "rewritten",
    labels: { injected: "yes" },
    firstPrompt: false,
    prepend: "one",
  }));
  hooks.before("agent.prompt", ({ request }) => ({
    ...request,
    prepend: `${request.prepend}+two`,
  }));
  const output = await hooks.invoke(
    "operation",
    "before",
    "agent.prompt",
    {
      agentId: "a",
      labels: { team: "payments" },
      parentAgentId: null,
      prompt: "hello",
      firstPrompt: true,
    },
    paseo,
  );
  expect(output).toEqual({
    agentId: "a",
    labels: { team: "payments" },
    parentAgentId: null,
    prompt: "hello",
    firstPrompt: true,
    prepend: "one+two",
  });
});

test("agent.prompt rejects an oversized prepend", async () => {
  const hooks = new PluginHookHandlers(() => {});
  hooks.before("agent.prompt", ({ request }) => ({ ...request, prepend: "x".repeat(20_000) }));
  await expect(
    hooks.invoke(
      "operation",
      "before",
      "agent.prompt",
      { agentId: "a", labels: {}, parentAgentId: null, prompt: "hi", firstPrompt: true },
      paseo,
    ),
  ).rejects.toThrow("prepend exceeds");
});
