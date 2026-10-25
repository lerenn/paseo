import { describe, expect, it } from "vitest";
import { agentStatusBucket, statusGlyphKind } from "./agent-status-indicator";

const idle = { status: "idle", pendingPermissions: [] } as const;

describe("agent status indicator", () => {
  it("draws what the sidebar draws for each bucket", () => {
    expect(statusGlyphKind("running")).toBe("ring");
    expect(statusGlyphKind("needs_input")).toBe("alert");
    expect(statusGlyphKind("attention")).toBe("attention-dot");
    expect(statusGlyphKind("failed")).toBe("failed-dot");
    expect(statusGlyphKind("done")).toBe("muted-dot");
  });

  it("derives the bucket from the live agent", () => {
    expect(agentStatusBucket({ ...idle, status: "running" })).toBe("running");
    expect(agentStatusBucket({ ...idle, pendingPermissions: [{}] })).toBe("needs_input");
    expect(agentStatusBucket({ ...idle, status: "error" })).toBe("failed");
    expect(agentStatusBucket({ ...idle, requiresAttention: true })).toBe("attention");
    expect(agentStatusBucket(idle)).toBe("done");
  });

  it("draws nothing for an agent the host does not know", () => {
    expect(agentStatusBucket(undefined)).toBeNull();
    expect(agentStatusBucket(null)).toBeNull();
  });
});
