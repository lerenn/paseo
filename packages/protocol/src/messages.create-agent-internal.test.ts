import { describe, expect, test } from "vitest";

import { SessionInboundMessageSchema } from "./messages.js";

describe("create request internal field", () => {
  test("accepts internal on create_agent_request", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "create_agent_request",
      requestId: "create-agent-internal",
      config: {
        provider: "codex",
        cwd: "/repo/app",
      },
      internal: true,
    });

    expect(parsed).toEqual({
      type: "create_agent_request",
      requestId: "create-agent-internal",
      config: {
        provider: "codex",
        cwd: "/repo/app",
      },
      internal: true,
      labels: {},
    });
  });

  test("accepts internal on agent.create.request", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "agent.create.request",
      requestId: "agent-create-internal",
      config: {
        provider: "codex",
        cwd: "/repo/app",
      },
      internal: true,
    });

    expect(parsed).toEqual({
      type: "agent.create.request",
      requestId: "agent-create-internal",
      config: {
        provider: "codex",
        cwd: "/repo/app",
      },
      internal: true,
      labels: {},
    });
  });
});

describe("create request plugin options", () => {
  test("keeps per-plugin option values on create and workspace-initial agents", () => {
    const pluginOptions = { "agent-roles": { role: "reviewer" } };
    const created = SessionInboundMessageSchema.parse({
      type: "agent.create.request",
      requestId: "create-agent-options",
      config: { provider: "codex", cwd: "/repo/app" },
      pluginOptions,
    });
    expect(created).toMatchObject({ pluginOptions });

    const workspace = SessionInboundMessageSchema.parse({
      type: "workspace.create.request",
      requestId: "create-workspace-options",
      source: { kind: "directory", path: "/repo/app" },
      agent: { config: { provider: "codex", cwd: "/repo/app" }, pluginOptions },
    });
    expect(workspace).toMatchObject({ agent: { pluginOptions } });
  });

  test("still parses a create request that omits them", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "create_agent_request",
      requestId: "no-options",
      config: { provider: "codex", cwd: "/repo/app" },
    });
    expect(parsed).not.toHaveProperty("pluginOptions");
  });
});
