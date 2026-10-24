import { describe, expect, it, vi } from "vitest";
import {
  checkoutRequestToPluginRef,
  composerAgentToPluginAgent,
  createWorkspaceThroughPlugin,
} from "./create";
import type { WorkspaceLocationEntry } from "./model";

const project = { id: "p1", name: "app", directory: "/work/app" };

function entry(
  createWorkspace: WorkspaceLocationEntry["location"]["createWorkspace"],
): WorkspaceLocationEntry {
  return {
    key: "kube/pod",
    installation: { id: "kube" } as WorkspaceLocationEntry["installation"],
    location: { id: "pod", title: "Pod", icon: "Blocks", createWorkspace },
  };
}

function client(entries: { id: string }[]) {
  return {
    fetchWorkspaces: vi.fn(async () => ({ entries })),
    fetchAgent: vi.fn(async (id: string) => ({ agent: { id } })),
    createAgent: vi.fn(async (_options: Record<string, unknown>) => ({ id: "new-agent" })),
  };
}

function run(
  locationEntry: WorkspaceLocationEntry,
  fake: ReturnType<typeof client>,
  extra: { withInitialAgent: boolean } = { withInitialAgent: true },
) {
  return createWorkspaceThroughPlugin({
    entry: locationEntry,
    client: fake as never,
    serverId: "host",
    project,
    settings: { size: "s" },
    idempotencyKey: "draft-1",
    prompt: "hello",
    slug: "brave-otter-12",
    checkout: { action: "branch-off", refName: "refs/heads/main" },
    agent: {
      config: {
        provider: "claude",
        cwd: "/x",
        model: "opus",
        thinkingOptionId: "medium",
        modeId: "bypass",
        featureValues: { fast: true },
      },
    } as never,
    ...extra,
  });
}

describe("createWorkspaceThroughPlugin", () => {
  it("hands the plugin its context and starts the first agent in the returned workspace", async () => {
    const create = vi.fn(async () => ({ workspaceId: "w1" }));
    const fake = client([{ id: "w1" }]);
    const result = await run(entry(create), fake);
    expect(create).toHaveBeenCalledWith({
      hostId: "host",
      project,
      settings: { size: "s" },
      idempotencyKey: "draft-1",
      prompt: "hello",
      slug: "brave-otter-12",
      ref: { action: "branch-off", refName: "refs/heads/main" },
      agent: {
        provider: "claude",
        model: "opus",
        thinkingOptionId: "medium",
        modeId: "bypass",
        featureValues: { fast: true },
      },
    });
    expect(fake.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "w1", idempotencyKey: "draft-1" }),
    );
    expect(result.agent).toEqual({ id: "new-agent" });
  });

  it("asks the daemon to name the workspace from the first prompt unless the location opts out", async () => {
    const make = (autoName?: boolean) => {
      const base = entry(async () => ({ workspaceId: "w1" }));
      return { ...base, location: { ...base.location, autoName } };
    };
    const named = client([{ id: "w1", title: "proj-slug" } as never]);
    await run(make(), named);
    expect(named.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceTitleToReplace: "proj-slug" }),
    );
    const optedOut = client([{ id: "w1", title: "proj-slug" } as never]);
    await run(make(false), optedOut);
    expect(optedOut.createAgent.mock.calls[0]?.[0]).not.toHaveProperty("workspaceTitleToReplace");
  });

  it("uses the plugin's agent when it returns agentId", async () => {
    const fake = client([{ id: "w1" }]);
    const result = await run(
      entry(async () => ({ workspaceId: "w1", agentId: "a1" })),
      fake,
    );
    expect(fake.createAgent).not.toHaveBeenCalled();
    expect(result.agent).toEqual({ id: "a1" });
  });

  it("starts no agent for an empty workspace", async () => {
    const fake = client([{ id: "w1" }]);
    const result = await run(
      entry(async () => ({ workspaceId: "w1" })),
      fake,
      {
        withInitialAgent: false,
      },
    );
    expect(fake.createAgent).not.toHaveBeenCalled();
    expect(result.agent).toBeUndefined();
  });

  it("fails when the plugin returns no workspace or one the host does not have", async () => {
    await expect(
      run(
        entry(async () => ({}) as never),
        client([]),
      ),
    ).rejects.toThrow("did not return a workspace");
    await expect(
      run(
        entry(async () => ({ workspaceId: "gone" })),
        client([{ id: "w1" }]),
      ),
    ).rejects.toThrow("not available on this host");
  });
});

describe("checkoutRequestToPluginRef", () => {
  it("passes a base branch", () => {
    expect(checkoutRequestToPluginRef({ action: "branch-off", refName: "refs/heads/dev" })).toEqual(
      {
        action: "branch-off",
        refName: "refs/heads/dev",
      },
    );
  });

  it("passes a change request with its head branch", () => {
    expect(
      checkoutRequestToPluginRef({
        action: "checkout",
        refName: "feature",
        githubPrNumber: 7,
        checkoutSource: { kind: "change_request", forge: "github", number: 7 },
      }),
    ).toEqual({
      action: "checkout",
      refName: "feature",
      changeRequest: { forge: "github", number: 7 },
    });
  });

  it("is null without a choice", () => {
    expect(checkoutRequestToPluginRef(undefined)).toBeNull();
  });
});

describe("composerAgentToPluginAgent", () => {
  it("passes provider, model, thinking option, mode and feature values", () => {
    expect(
      composerAgentToPluginAgent({
        config: { provider: "codex", cwd: "/x", model: "gpt", modeId: "auto" },
      } as never),
    ).toEqual({ provider: "codex", model: "gpt", modeId: "auto" });
  });

  it("is null without an agent", () => {
    expect(composerAgentToPluginAgent(undefined)).toBeNull();
  });
});
