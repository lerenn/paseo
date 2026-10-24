import type { PluginServerContext } from "@getpaseo/plugin/server";

export default function contribute(server: PluginServerContext) {
  return server.before("agent.create", ({ request }) => {
    const persona = request.pluginOptions?.["create-options"]?.persona;
    if (!persona || persona === "none") return;
    return { ...request, env: { ...request.env, PERSONA: persona } };
  });
}
