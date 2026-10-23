import { describe, expect, it } from "vitest";
import { availableWorkspaceLocations } from "./model";
import type { InstalledPlugin } from "../types";

const project = { id: "p1", name: "app", directory: "/work/app" };

function installation(
  serverId: string,
  locations: InstalledPlugin["workspaceLocations"],
): InstalledPlugin {
  return { id: "kube", serverId, workspaceLocations: locations } as InstalledPlugin;
}

function location(
  id: string,
  isAvailable?: InstalledPlugin["workspaceLocations"][number]["isAvailable"],
): InstalledPlugin["workspaceLocations"][number] {
  return {
    id,
    title: id,
    icon: "Blocks",
    isAvailable,
    createWorkspace: async () => ({ workspaceId: "w" }),
  };
}

describe("availableWorkspaceLocations", () => {
  it("offers only locations of plugins installed on the selected host", () => {
    const entries = availableWorkspaceLocations(
      [installation("a", [location("pod")]), installation("b", [location("vm")])],
      { serverId: "a", project },
    );
    expect(entries.map((entry) => entry.key)).toEqual(["kube/pod"]);
  });

  it("offers nothing without a project", () => {
    expect(
      availableWorkspaceLocations([installation("a", [location("pod")])], {
        serverId: "a",
        project: null,
      }),
    ).toEqual([]);
  });

  it("filters by isAvailable and hides an option whose isAvailable throws", () => {
    const entries = availableWorkspaceLocations(
      [
        installation("a", [
          location("yes", () => true),
          location("no", () => false),
          location("boom", () => {
            throw new Error("boom");
          }),
        ]),
      ],
      { serverId: "a", project },
    );
    expect(entries.map((entry) => entry.location.id)).toEqual(["yes"]);
  });
});
