import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Text } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MenuFillPageDefinition } from "@/components/ui/menu";
import { SheetPaneHostProvider, type SheetPaneHost } from "@/screens/workspace/sheet-pane";
import type { SheetTab } from "@/stores/workspace-layout-store";
import type { ProviderSubagentRow, SubagentRow } from "./select";
import { SubagentsTrack } from "./track";

// The real page needs a whole workspace pane behind it. These tests are about whether the track
// asks for sheet pages at all, so the page builder is a stand-in.
const sheetPanePage = vi.hoisted(() =>
  vi.fn(
    (sheet: SheetTab): MenuFillPageDefinition => ({
      id: sheet.tab.tabId,
      fill: true,
      content: null,
    }),
  ),
);
const useSheetPanePage = vi.hoisted(() => vi.fn(() => sheetPanePage));

vi.mock("@/screens/workspace/sheet-pane", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/screens/workspace/sheet-pane")>()),
  useSheetPanePage,
}));

// App sources compile against the classic JSX runtime, which expects React on the global.
beforeEach(() => vi.stubGlobal("React", React));

interface Mounted {
  root: Root;
  container: HTMLDivElement;
}

const mounted: Mounted[] = [];

function mount(node: ReactNode): void {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  mounted.push({ root, container });
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
  vi.clearAllMocks();
});

function click(testID: string): void {
  const element = document.querySelector(`[data-testid="${testID}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`${testID} did not render`);
  }
  act(() => element.click());
}

const ROW: ProviderSubagentRow = {
  kind: "provider",
  id: "sub-1",
  parentAgentId: "parent-1",
  provider: "claude",
  title: "Explore",
  description: "Find the bug",
  subtitle: null,
  status: "running",
  requiresAttention: false,
  createdAt: new Date("2026-10-30T10:00:00.000Z"),
};

const SHEET: SheetTab = {
  tab: {
    tabId: "sheet-sub-1",
    target: { kind: "provider_subagent", parentAgentId: "parent-1", subagentId: "sub-1" },
    createdAt: 0,
  },
  policy: { openAsTab: true },
  parentTabId: "parent-tab",
};

const HOST: SheetPaneHost = {
  workspaceKey: "server-1:ws-1",
  serverId: "server-1",
  workspaceId: "ws-1",
  isWorkspaceFocused: true,
  buildContent: () => {
    throw new Error("the stand-in page never builds pane content");
  },
};

function Track({
  sheetTabFor,
  onOpenProviderSubagent,
}: {
  sheetTabFor: (row: SubagentRow) => SheetTab | null;
  onOpenProviderSubagent: (parentAgentId: string, subagentId: string) => void;
}) {
  return (
    <SubagentsTrack
      serverId="server-1"
      rows={[ROW]}
      onOpenSubagent={vi.fn()}
      onOpenProviderSubagent={onOpenProviderSubagent}
      sheetTabFor={sheetTabFor}
      onArchiveSubagent={vi.fn()}
    />
  );
}

describe("subagents track", () => {
  it("renders outside a workspace pane and opens rows through the caller", () => {
    // A plugin surface's AgentChat has a composer but no sheet pane host.
    const sheetTabFor = vi.fn(() => SHEET);
    const onOpenProviderSubagent = vi.fn();
    mount(
      <>
        <Text>plugin surface</Text>
        <Track sheetTabFor={sheetTabFor} onOpenProviderSubagent={onOpenProviderSubagent} />
      </>,
    );

    click("subagents-track-header");
    click(`subagents-track-row-${ROW.id}`);

    expect(useSheetPanePage).not.toHaveBeenCalled();
    expect(sheetTabFor).not.toHaveBeenCalled();
    expect(onOpenProviderSubagent).toHaveBeenCalledWith(ROW.parentAgentId, ROW.id);
  });

  it("opens rows as sheet pages inside a workspace pane", () => {
    const sheetTabFor = vi.fn(() => SHEET);
    const onOpenProviderSubagent = vi.fn();
    mount(
      <SheetPaneHostProvider value={HOST}>
        <Track sheetTabFor={sheetTabFor} onOpenProviderSubagent={onOpenProviderSubagent} />
      </SheetPaneHostProvider>,
    );

    click("subagents-track-header");
    click(`subagents-track-row-${ROW.id}`);

    expect(useSheetPanePage).toHaveBeenCalled();
    expect(sheetPanePage).toHaveBeenCalledWith(SHEET);
    expect(onOpenProviderSubagent).not.toHaveBeenCalled();
  });
});
