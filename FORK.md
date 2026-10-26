# FORK.md

`lerenn/paseo` carries changes until upstream (`getpaseo/paseo`) accepts them. Once a change merges
upstream, drop the fork's copy at the next rebase. Every change here is a generic plugin extension
point; the fork holds no plugin-specific code.

Fork `main` publishes `ghcr.io/lerenn/paseo:main` (and `:sha-<commit>`) on every push.

## Changes

Status values: `in fork` (not posted upstream), `posted` (upstream Discussion or PR open),
`merged upstream` (drop at the next rebase).

### Workspace location options

- **API:** `client.addWorkspaceLocation({ id, title, icon, createWorkspace, isAvailable?, Settings?, defaultValue?, usesRef? })`
  adds an option beside Local and New worktree in the New workspace form. `createWorkspace` runs on
  the client and receives `{ hostId, project, settings, idempotencyKey, prompt, slug, ref, agent }`
  (`slug` is the worktree slug, `ref` the branch picker's choice, `agent` the composer's agent
  settings), plus `autoName` (default true): the daemon renames the workspace from the first prompt
  via the optional `workspaceTitleToReplace` field on agent creation and returns `{ workspaceId, agentId? }`. Reference: `public-docs/plugins/reference.md`,
  section "New workspace locations".
- **Fork PRs:** #4 (`b10be7b16`, option), #6 (`d8ffef51e`, branch picker, slug, ref), #8 (`9f240d678`,
  composer agent settings), #23 (`19dacb64d`, automatic naming).
- **Upstream branches (one aspect each, stacked, cut from upstream main):**
  `upstream/workspace-location-1-option`, `upstream/workspace-location-2-ref-slug`,
  `upstream/workspace-location-3-agent`, `upstream/workspace-location-4-autoname`
  (on `lerenn/paseo`). Step 4 also adds the optional `workspaceTitleToReplace` protocol field.
- **Upstream Discussion / PRs:** one Discussion, four PRs; drafts at
  `/home/paseo/work/upstream-drafts/workspace-location/` (`discussion.md`, `pr-1-option.md` ..
  `pr-4-autoname.md`), not posted.
- **Status:** in fork.

### Create options

- **API:** `client.addCreateOption({ id, label, icon, options, defaultValue?, description? })`: a
  declarative select beside the mode picker on the New workspace and new-agent composers. The value
  reaches `before("agent.create")` as `request.pluginOptions[pluginId][optionId]`.
- **Fork PRs:** #7 (`c88616a78`). First consumer: the Role picker of `lerenn/paseo-agents-roles` (#19).
  Daemons advertise `server_info.features.pluginCreateOptions`; the app hides the picker without it.
- **Upstream branch (one aspect, cut from upstream main):** `upstream/create-options-1-option`
  (on `lerenn/paseo`). Shape mirrors upstream #6928's `select` control.
- **Upstream Discussion / PR:** one Discussion, one PR; drafts at
  `/home/paseo/work/upstream-drafts/create-options/`, not posted. Ask Louis.
- **Status:** in fork.

### AgentChat

- **API:** `AgentChat({ agentId, workspaceId? })` from `@getpaseo/plugin/client/ui` embeds the host
  agent conversation (real composer) for any agent, in any plugin panel. Subagents it lists open in
  place with a Back button (the pane context's `openSubagentTarget`, since there are no workspace
  tabs there). Reference: `public-docs/plugins/reference.md`, section "Agent chat".
- **Fork PRs:** #10 (`8ff47622d`, with the since-removed app dock), #34, #44 (dock removal, `53e880322`). First consumer:
  `lerenn/paseo-assistant`.
- **Removed:** the app dock (`addAppPanel`, `openAppPanel`, `toggleAppPanel`, `closeAppPanel`) was
  taken out of the fork; the Assistant moved to a sidebar entry that opens a full screen. Its
  upstream branches `upstream/app-dock-1-dock` and `-3-window-controls` and its drafts are dropped.
- **Upstream branch (one aspect):** `upstream/plugin-ui-2-agent-chat` (stacked on
  `upstream/plugin-ui-0-agent-status-indicator`; objective: plugin UI components).
- **Upstream Discussion / PR:** drafts only, not posted: `/home/paseo/work/upstream-drafts/plugin-ui/`.
- **Status:** in fork.

### Sidebar groups

- **API:** `addSidebarHeaderItem({ ..., group?: string })`: optional default group name for a header
  row the user has not placed (matched by title, case-insensitive; created if missing; footer items
  ignore it). Users create, rename, delete and reorder collapsible groups in Settings > Sidebar and
  move rows into them. Stored as `sidebarNavGroups` plus `group` / `group:<id>` entries in
  `sidebarNavItems`. Reference: `public-docs/plugins/reference.md`, section "Sidebar items";
  `docs/plugins.md`, "Contribute sidebar items". No Paseo-side plugin sets `group`.
- **Fork PRs:** #9 (merged as `d88d1cb7e`).
- **Upstream branches (one aspect each, stacked, cut from upstream main):**
  `upstream/sidebar-groups-1-groups` (user groups), `upstream/sidebar-groups-2-plugin-hint` (the
  plugin `group` hint, on 1).
- **Upstream Discussion / PRs:** one Discussion, two PRs; drafts at
  `/home/paseo/work/upstream-drafts/sidebar-groups/`, not posted. Ask Louis.
- **Status:** in fork.

### Workspace runtimes

- **API:** `server.registerWorkspaceRuntime({ id, label, icon?, describe, create?, inspect?, pause?,
resume?, destroy?, reconcile?, prepare?, beforeInput?, onActivity?, mapCwd?, checkCommand?, fs?,
exec })` in the plugin server SDK. A workspace selects a runtime with `runtime: { id, options? }`
  on `workspace.create.request` (gated by `server_info.features.workspaceRuntimes`); a workspace an
  agent creates inherits the caller's runtime unless the call names one (`{ id: "local" }` = host).
  Every provider process starts through `spawnProviderProcess` with the `processLauncher` of its
  `AgentLaunchContext`; providers declare `supportsRemoteLaunch` (Claude, Codex and the ACP
  providers do) and others are refused in a runtime workspace, never run on the host. `mapCwd` maps
  the workspace root by textual rewriting of every stream line; Git runs through `exec` with
  `purpose: "command"`; files run through `fs` verbs (polling, no watch); `destroy` runs on every
  removal path, `reconcile` gets the live workspace list, `checkCommand` names a missing binary;
  `workspaceCwd` is on every request. The sidebar shows the runtime's icon and label; an optional `describeWorkspace` adds a per-workspace short label, tooltip, header detail and optional `hostIcon` (a Lucide name that replaces the server icon in the sidebar's host indicator) (RPC `workspace.runtime.details.request`, feature `workspaceRuntimeDetails`). Verbs and
  names follow getpaseo/paseo#3360 (workspace runtime contract), which registers executables in
  daemon config; this layer registers plugin objects and can move onto #3360 if it merges. Not in
  the fork: terminals, scripts, uploads and per-runtime provider catalogs in the runtime.
  Reference: `public-docs/plugins/reference.md`, "Workspace runtimes"; `docs/plugins.md`,
  "Contribute a workspace runtime".
- **Fork PRs:** #17 (`9320d9194`, launch), #20 (`d87671f18`, cwd mapping), #21 (`2bd9e903e`, Git),
  #22 (`b35d3853d`, inheritance), #28 (`811da2353`, files), #27 (`411763c3f`, reliability and CLI),
  #30 (`474f56076`, lifecycle), #25 (`7b730b08e`, sidebar icon). The app dock title-bar fix is #24
  (`b0a12c5ca`, see App dock). Follow-ups: #32/#33 (registry and project reads on the host),
  #37 (worktrees created and deleted on the host), #38 (a runtime unregistered by a plugin update is waited
  for up to 30 s; workspace creation reads its checkout on the host), and the runtime-exit PR (a
  mid-turn process exit the stream never reports fails the turn after 10 s; exit reason `suspended`
  is a planned stop that shows no error; `interrupted` is a platform cut that ends an open turn as canceled, with the message kept as an info item).
- **Upstream branches (one aspect each, stacked in this order, cut from upstream main):**
  `upstream/workspace-runtimes-1-launch`, `-2-cwd`, `-3-git`, `-4-inheritance`, `-5-files`,
  `-6-reliability`, `-7-lifecycle`, `-8-icon`, `-9-details`, `-10-closed-channel`, `-11-interrupted` (on `lerenn/paseo`). Rebuild each by cherry-picking
  its fork PR commit onto the previous branch.
- **Upstream Discussion / PRs:** one Discussion, eight PRs; drafts at
  `/home/paseo/work/upstream-drafts/workspace-runtimes/` (`discussion.md`, `pr-1-launch.md` ..
  `pr-8-icon.md`), not posted (ask Louis).
- **Status:** in fork.

### Agent status indicator

- **API:** `AgentStatusIndicator({ agentId, size? })` from `@getpaseo/plugin/client/ui`: an agent's
  live status as the sidebar draws it (ring running, alert needs input, green dot attention, red dot
  failed, muted dot done). Reference: `public-docs/plugins/reference.md`, "Agent status indicator".
  First consumer: the Release Trains plugin's column headers.
- **Fork PRs:** #35 (`1e043c806`).
- **Upstream branch (one aspect, cut from upstream main):** `upstream/plugin-ui-0-agent-status-indicator`.
- **Upstream Discussion / PR:** drafts only, not posted:
  `/home/paseo/work/upstream-drafts/plugin-ui/` (ask Louis).
- **Status:** in fork.

### Agent badges

- **API:** `client.addAgentBadge({ id, scope?, match: { labels }, render: { icon, text?, tooltip? } })`:
  a small badge on agents that carry the given labels (`"*"` = any value), in the sidebar workspace
  row's meta line (workspace scope) and in the agent list. Stacks, three visible. Reference:
  `public-docs/plugins/reference.md`, "Agent badges". First consumer: the Paseo Factory plugin.
  The agent tab header does not show badges yet.
- **Fork PRs:** #36.
- **Upstream branch (one aspect, cut from upstream main):** `upstream/plugin-ui-1-agent-badges`
  (objective: plugin UI components, with `upstream/plugin-ui-0-agent-status-indicator`).
- **Upstream Discussion / PR:** drafts only, not posted: `/home/paseo/work/upstream-drafts/plugin-ui/`.
- **Status:** in fork.

### Plugin agent-create context

- **API:** `before("agent.create")` requests carry read-only `labels` and `parentAgentId` (null for a
  top-level agent); `PluginHookAgent` carries `labels`. The request also carries read-only `workspaceId` and `runtimeId` (null for a host workspace). A hook that edits them is ignored. Daemons
  advertise `server_info.features.pluginCreateContext`. Reference:
  `public-docs/plugins/reference.md`, "Before hooks". First consumer: the Assistant mailbox.
- **Fork PRs:** see the PR that introduced this entry.
- **Upstream branch (one aspect, cut from upstream main):** `upstream/plugin-create-context-1-hooks`.
- **Upstream Discussion / PR:** drafts only, not posted:
  `/home/paseo/work/upstream-drafts/plugin-create-context/`.
- **Status:** in fork.

### Skip-if-busy sends

- **API:** MCP `send_agent_prompt` takes `activeTurnBehavior: "skip"`: delivers only if the agent
  is not running a turn, otherwise returns `{ skipped: true }` with nothing queued. The check and
  the start of the run happen with no await between them in `startAgentRun`, so two concurrent
  skip sends deliver exactly one. Upstream's `tryRunOutOfBand` is async, so the check runs again
  after it; any new await before the run starts needs the same. It bypasses the agent-message quiet window. Daemons advertise
  `server_info.features.activeTurnSkip`. First consumers: the Assistant and Agents Mail.
- **Fork PRs:** #48 (`5cd7e25b9`), recheck after the out-of-band await in #49.
- **Upstream branch (one aspect, cut from upstream main):** `upstream/agent-send-skip-1-skip`.
- **Upstream Discussion / PR:** drafts only, not posted:
  `/home/paseo/work/upstream-drafts/agent-send-skip/`.

### Plugin prompt hook

- **API:** `before("agent.prompt")`: runs before a user or agent prompt reaches the provider, for
  every provider, with `agentId`, `labels`, `parentAgentId`, `prompt`, `source`, `sourceAgentId` and `isFirstPrompt` (slash commands are left alone). A hook
  sets `prepend` to add a separate `<paseo-plugin-context>` block; the user's text is untouched and
  the timeline shows only what was sent. Plugins compose in ID order; failures and slow hooks (3 s)
  are skipped, never blocking the prompt. Daemons advertise `server_info.features.pluginPromptHook`.
  First consumer: Agents Mail.
- **Fork PRs:** see the PR that introduced this entry.
- **Upstream branch (one aspect, cut from upstream main):** `upstream/plugin-prompt-hook-1-hook`.
- **Upstream Discussion / PR:** drafts only, not posted:
  `/home/paseo/work/upstream-drafts/plugin-prompt-hook/`.
- **Status:** in fork.

### Queue action modifier (#7686)

- **Change:** show the queue action while Cmd/Ctrl is held (`feat(app): show queue action while
Cmd/Ctrl is held`).
- **Upstream PR:** getpaseo/paseo#7686 (open), from `lerenn:feat/queue-send-modifier-v2`.
- **Fork:** not carried on fork `main`; the branch exists on the fork only for the upstream PR.
- **Status:** posted.

### Fork-only infrastructure (never goes upstream)

- `ci(docker): publish fork main builds to GHCR` (#1) and `ci: pin CI jobs to ubuntu-24.04` (#3).
  Keep both across rebases. Drop #3 only when upstream pins the runner itself.
- The `sync-fork` skill (`.agents/skills/sync-fork`, linked from `.claude/skills`): syncs fork
  `main` with upstream through the checklist below, then builds and installs the Linux AppImage
  locally. Keep across rebases.

### Not carried

- HostBadge and `SidebarRow.subtitle` (#2) were reverted by #5. Do not restore.

## Rebase checklist

1. `git fetch upstream && git fetch origin`
2. Check what upstream merged: `git log upstream/main..origin/main --oneline` lists what the fork
   carries; for each change above, look up its upstream PR and mark it `merged upstream`.
3. Rebase or merge `upstream/main` into fork `main`. For every change merged upstream, drop the
   fork's copy (revert it or take upstream's version on conflict) and delete its entry or set it to
   `merged upstream`.
4. Resolve conflicts. The usual hot spots are `packages/app/src/plugins/types.ts`,
   `packages/app/src/plugins/evaluate.ts`, `docs/plugins.md` and the public plugin reference.
5. `npm run build:server && npm run typecheck`, then `npm run lint`.
6. Run the touched suites only, for example
   `npx vitest run packages/app/src/plugins packages/website/src --bail=1`. Do not run the full suite
   locally.
7. Push through a PR and wait for green CI, then merge with a merge commit, never squash. A squashed
   sync has one parent, so git loses track of the upstream commits it contains and the next sync
   replays their conflicts. Fork feature PRs still squash-merge.
8. Rebuild the desktop: `npm run build:desktop -- --publish never --linux --x64`.
9. Refresh each `*-upstream` branch from upstream main with the change cherry-picked, and update
   this file.
