import type { PluginClientContext } from "@getpaseo/plugin/client";

export default function contribute(client: PluginClientContext) {
  return client.addCreateOption({
    id: "persona",
    label: "Persona",
    icon: "UserCog",
    options: [
      { value: "none", label: "No persona" },
      { value: "reviewer", label: "Reviewer", description: "Reads the diff and reports problems" },
      { value: "writer", label: "Writer", description: "Drafts documentation" },
    ],
    defaultValue: "none",
  });
}
