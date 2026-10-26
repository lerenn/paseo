import type { AgentChatProps } from "@getpaseo/plugin/client/ui";
import { lazy, Suspense } from "react";

// The agent panel pulls in most of the app. Loading it on first render keeps plugin module
// resolution, which every plugin load goes through, from importing it.
const LazyAgentChat = lazy(async () => ({
  default: (await import("./agent-chat")).AgentChat,
}));

export function AgentChat(props: AgentChatProps) {
  return (
    <Suspense fallback={null}>
      <LazyAgentChat {...props} />
    </Suspense>
  );
}
