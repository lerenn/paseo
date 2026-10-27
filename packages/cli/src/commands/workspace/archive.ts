import type { Command } from "commander";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";
import type { CommandError, OutputSchema, SingleResult } from "../../output/index.js";

interface WorkspaceArchiveResult {
  workspaceId: string;
  status: "archived";
  archivedAt: string;
}

const workspaceArchiveSchema: OutputSchema<WorkspaceArchiveResult> = {
  idField: "workspaceId",
  columns: [
    { header: "WORKSPACE ID", field: "workspaceId", width: 20 },
    { header: "STATUS", field: "status", width: 10 },
    { header: "ARCHIVED AT", field: "archivedAt", width: 26 },
  ],
};

export async function runArchiveCommand(
  workspaceId: string,
  options: {
    host?: string;
    daemonTarget: import("../../utils/daemon-target.js").DaemonTarget;
    reason?: string;
    ifIdle?: boolean;
  },
  _command: Command,
): Promise<SingleResult<WorkspaceArchiveResult>> {
  const host = getDaemonHost({ target: options.daemonTarget });
  const client = await connectToDaemon({ target: options.daemonTarget }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw {
      code: "DAEMON_NOT_RUNNING",
      message: `Cannot connect to daemon at ${host}: ${message}`,
    } satisfies CommandError;
  });
  try {
    const reason = options.reason?.trim();
    if (options.reason !== undefined && !reason) {
      throw {
        code: "INVALID_OPTIONS",
        message: "--reason needs a non-empty text",
      } satisfies CommandError;
    }
    const payload = await client.archiveWorkspace(workspaceId, undefined, {
      ...(reason ? { reason } : {}),
      ...(options.ifIdle ? { ifIdle: true } : {}),
    });
    if (payload.error) {
      // The daemon refused an --if-idle archive: nothing was archived.
      if (options.ifIdle && /is not idle/.test(payload.error)) {
        throw { code: "WORKSPACE_NOT_IDLE", message: payload.error } satisfies CommandError;
      }
      throw new Error(payload.error);
    }
    if (!payload.archivedAt) {
      throw new Error("Workspace archive did not return an archive timestamp");
    }
    return {
      type: "single",
      data: { workspaceId, status: "archived", archivedAt: payload.archivedAt },
      schema: workspaceArchiveSchema,
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw { code: "WORKSPACE_ARCHIVE_FAILED", message } satisfies CommandError;
  } finally {
    await client.close().catch(() => undefined);
  }
}
