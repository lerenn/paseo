import { describe, expect, it } from "vitest";
import type { InstalledPlugin } from "../types";
import { buildPluginOptions, resolveCreateOptions, selectedCreateOptionValue } from "./model";

function plugin(id: string, serverId: string, createOptions: InstalledPlugin["createOptions"]) {
  return {
    id,
    serverId,
    locale: "en",
    i18n: { resolve: (text: unknown) => String(text) },
    createOptions,
  } as unknown as InstalledPlugin;
}

const role = {
  id: "role",
  label: "Role",
  icon: "UserRound",
  options: [
    { value: "none", label: "No role" },
    { value: "reviewer", label: "Reviewer" },
  ],
};

describe("create options", () => {
  it("lists only the options of plugins on the host, defaulting to the first value", () => {
    const options = resolveCreateOptions(
      [plugin("agent-roles", "a", [role]), plugin("other", "b", [role])],
      "a",
    );
    expect(options.map((option) => option.key)).toEqual(["agent-roles:role"]);
    expect(options[0].defaultValue).toBe("none");
  });

  it("namespaces the request values per plugin and falls back to the default", () => {
    const options = resolveCreateOptions(
      [
        plugin("agent-roles", "a", [{ ...role, defaultValue: "reviewer" }]),
        plugin("other", "a", [role]),
      ],
      "a",
    );
    expect(
      buildPluginOptions(options, { "other:role": "reviewer", "agent-roles:role": "gone" }),
    ).toEqual({
      "agent-roles": { role: "reviewer" },
      other: { role: "reviewer" },
    });
    expect(selectedCreateOptionValue(options[1], {})).toBe("none");
  });

  it("sends nothing when no plugin contributes an option", () => {
    expect(buildPluginOptions([], {})).toBeUndefined();
  });
});
