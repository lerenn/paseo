import { describe, expect, it } from "vitest";
import { createWorkspaceCommand } from "./index.js";

describe("workspace archive options", () => {
  const archive = createWorkspaceCommand().commands.find(
    (command) => command.name() === "archive",
  )!;
  const option = (long: string) => archive.options.find((o) => o.long === long);

  it("takes --reason with a text", () => {
    expect(option("--reason")?.required).toBe(true);
  });

  it("takes --if-idle as a flag", () => {
    expect(option("--if-idle")).toBeDefined();
    expect(option("--if-idle")?.required).toBeFalsy();
  });
});
