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
- **Fork PRs:** #4 (`b10be7b16`), #6 (`d8ffef51e`, branch picker and slug), #8 (`9f240d678`,
  composer agent settings).
- **Upstream branch:** `lerenn:workspace-location-options-upstream` (one squashed commit on
  upstream main; rebuild it from the fork PRs above after each change).
- **Upstream Discussion / PR:** drafts only, not posted (drafts live in the agent session that
  prepared them; ask Louis).
- **Status:** in fork.

### Create options

- **API:** `client.addCreateOption({ id, label, icon, options, defaultValue?, description? })`: a
  declarative select beside the mode picker on the New workspace and new-agent composers. The value
  reaches `before("agent.create")` as `request.pluginOptions[pluginId][optionId]`.
- **Fork PRs:** #7 (`c88616a78`). First consumer: the Role picker of `lerenn/paseo-agents-roles` (#19).
  Daemons advertise `server_info.features.pluginCreateOptions`; the app hides the picker without it.
- **Upstream branch:** `lerenn:create-options-upstream` (one commit on upstream main; rebuild it
  from the fork PR after each change). Shape mirrors upstream #6928's `select` control.
- **Upstream Discussion / PR:** drafts only, not posted: `/home/paseo/work/upstream-drafts/`
  (`pr-create-options.md`, `discussion-create-options.md`, `screenshots/`; screenshots are also on
  the fork branch `create-options-screenshots`). Ask Louis.
- **Status:** in fork.

### App dock and AgentChat

- **API:** `client.addAppPanel({ id, title, icon, Component })` adds a tab to the app dock, a
  right-hand panel at the far right of the window that belongs to the app, not a workspace (open
  state, width, maximized and selected tab are stored once). `client.openAppPanel(id)`,
  `toggleAppPanel(id)` and `closeAppPanel()` drive it, e.g. from `addHeaderButton`.
  `AgentChat({ agentId, workspaceId? })` from `@getpaseo/plugin/client/ui` embeds the host agent
  conversation (real composer) for any agent. Reference: `public-docs/plugins/reference.md`,
  sections "App panels" and "Agent chat".
- **Fork PRs:** #10 (`8ff47622d`). First consumer: `lerenn/paseo-overseer`.
- **Upstream branch:** `lerenn:upstream/app-dock` (one commit on upstream main; rebuild it from the
  fork PR after each change).
- **Upstream Discussion / PR:** drafts only, not posted: `/home/paseo/overseer-drafts/`
  (`upstream-pr.md`, `upstream-discussion.md`, `screenshots/`). Ask Louis.
- **Status:** in fork.

### Sidebar groups

- **API:** `addSidebarHeaderItem({ ..., group?: string })`: optional default group name for a header
  row the user has not placed (matched by title, case-insensitive; created if missing; footer items
  ignore it). Users create, rename, delete and reorder collapsible groups in Settings > Sidebar and
  move rows into them. Stored as `sidebarNavGroups` plus `group` / `group:<id>` entries in
  `sidebarNavItems`. Reference: `public-docs/plugins/reference.md`, section "Sidebar items";
  `docs/plugins.md`, "Contribute sidebar items". No Paseo-side plugin sets `group`.
- **Fork PRs:** #9 (merged as `d88d1cb7e`).
- **Upstream branch:** `lerenn:sidebar-groups-upstream` (two commits on upstream main).
- **Upstream Discussion / PR:** drafts only, not posted: `/home/paseo/work/upstream-drafts/sidebar-groups-pr.md`
  and `sidebar-groups-discussion.md`, screenshots in `screenshots/` beside them (agent session
  196ab4d0; ask Louis).
- **Status:** in fork.

### Workspace runtimes

- **API:** `server.registerWorkspaceRuntime({ id, label, icon?, describe, create?, inspect?, pause?,
resume?, destroy?, reconcile?, prepare?, beforeInput?, onActivity?, exec })` in the plugin server
  SDK. A workspace selects a runtime with `runtime: { id, options? }` on `workspace.create.request`
  (directory workspaces; gated by `server_info.features.workspaceRuntimes`). Every provider process
  starts through `spawnProviderProcess` with the `processLauncher` of its `AgentLaunchContext`;
  providers declare `supportsRemoteLaunch` (Claude, Codex and the ACP providers do) and others are
  refused in a runtime workspace. `mapCwd` maps the workspace root by textual path rewriting on every
  stream line (phase 2, item 1). Files, Git, terminals and scripts stay on the host until the later
  phase 2 items.
  Verbs and names follow getpaseo/paseo#3360 (workspace runtime contract), which registers
  executables in daemon config; this layer registers plugin objects and can move onto #3360 if it
  merges. Reference: `public-docs/plugins/reference.md`, "Workspace runtimes"; `docs/plugins.md`,
  "Contribute a workspace runtime".
- **Fork PRs:** #17 (merged as `9320d9194`).
- **Upstream branch:** `lerenn:workspace-runtimes-upstream` (one commit on upstream main; rebuild
  it from the fork PR after each change).
- **Upstream Discussion / PR:** drafts only, not posted: `/home/paseo/work/upstream-drafts/workspace-runtimes-pr.md`
  and `workspace-runtimes-discussion.md` (agent session 2wwhd7fm; ask Louis).
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
