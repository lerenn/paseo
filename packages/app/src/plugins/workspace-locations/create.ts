import type { PluginWorkspaceLocationProject } from "@getpaseo/plugin/client";
import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import type {
  CreateWorkspaceRequestOptions,
  DaemonClient,
  FetchWorkspacesEntry,
} from "@getpaseo/client/internal/daemon-client";
import { normalizeWorkspaceDescriptor } from "@/stores/session-store";
import type { WorkspaceLocationEntry } from "./model";

type WorkspaceCreationClient = Pick<DaemonClient, "fetchWorkspaces" | "fetchAgent" | "createAgent">;

/**
 * Creates a workspace through a plugin's workspace location, then reads back what the plugin made.
 * The plugin owns the workspace; the first agent is the plugin's when it returns an `agentId`,
 * else Paseo starts it in that workspace from `agent`.
 */
export async function createWorkspaceThroughPlugin(input: {
  entry: WorkspaceLocationEntry;
  client: WorkspaceCreationClient;
  serverId: string;
  project: PluginWorkspaceLocationProject;
  settings: unknown;
  idempotencyKey: string;
  prompt: string;
  withInitialAgent: boolean;
  agent?: CreateWorkspaceRequestOptions["agent"];
  /** Called once the workspace exists, before the first agent starts. */
  onWorkspace?: (descriptor: FetchWorkspacesEntry) => void;
}): Promise<{
  workspace: ReturnType<typeof normalizeWorkspaceDescriptor>;
  agent?: AgentSnapshotPayload;
}> {
  const { entry, client } = input;
  const result = await entry.location.createWorkspace({
    hostId: input.serverId,
    project: input.project,
    settings: input.settings,
    idempotencyKey: input.idempotencyKey,
    prompt: input.prompt,
  });
  const workspaceId = typeof result?.workspaceId === "string" ? result.workspaceId.trim() : "";
  if (!workspaceId) {
    throw new Error(`${entry.installation.id} did not return a workspace`);
  }
  const { entries } = await client.fetchWorkspaces({ filter: { projectId: input.project.id } });
  const descriptor = entries.find((workspace) => workspace.id === workspaceId);
  if (!descriptor) {
    throw new Error(`Workspace ${workspaceId} is not available on this host`);
  }
  const workspace = normalizeWorkspaceDescriptor(descriptor);
  input.onWorkspace?.(descriptor);
  if (!input.withInitialAgent) return { workspace };
  if (result.agentId) {
    const fetched = await client.fetchAgent(result.agentId);
    if (!fetched) throw new Error(`Agent ${result.agentId} is not available on this host`);
    return { workspace, agent: fetched.agent };
  }
  if (!input.agent) return { workspace };
  return {
    workspace,
    agent: await client.createAgent({
      ...input.agent,
      workspaceId,
      idempotencyKey: input.idempotencyKey,
    }),
  };
}
