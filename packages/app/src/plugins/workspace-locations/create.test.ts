import { describe, expect, it, vi } from "vitest";
import { createWorkspaceThroughPlugin } from "./create";
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
    createAgent: vi.fn(async () => ({ id: "new-agent" })),
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
    agent: { config: { provider: "claude", cwd: "/x" } } as never,
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
    });
    expect(fake.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "w1", idempotencyKey: "draft-1" }),
    );
    expect(result.agent).toEqual({ id: "new-agent" });
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
