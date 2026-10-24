---
name: sync-fork
description: Sync the lerenn/paseo fork with upstream, rebuild the Linux AppImage and install it locally. Use when the user says "sync the fork", "pull upstream", "check for new code on fork main", "rebuild the AppImage", or "/sync-fork".
user-invocable: true
---

# Sync fork

1. `git fetch --all`. Commit or stash nothing on your own: stop if the working tree is dirty. Switch
   to `main` and fast-forward it from `origin/main` (`git pull --ff-only`).
2. If `upstream/main` has commits that `main` lacks (`git rev-list --count main..upstream/main`),
   follow the **Rebase checklist** in `FORK.md` end-to-end, including the `FORK.md` updates. Report
   conflicts you resolved and how.
3. If `package-lock.json` changed since the last install, run `node scripts/npm-retry.mjs ci`.
4. Build only the AppImage:
   `npm run build:desktop -- --publish never --linux AppImage --x64 > /tmp/appimage-build.log 2>&1`.
   On failure, read the log, fix the cause, and rebuild.
5. Install to `~/AppImages/paseo.appimage`. Paseo usually runs from that file, and overwriting a
   running AppImage in place crashes it, so copy beside it and rename:
   ```bash
   src=packages/desktop/release/Paseo-x86_64.AppImage
   dst=~/AppImages/paseo.appimage
   cp "$src" "$dst.new" && chmod +x "$dst.new" && mv -f "$dst.new" "$dst" && cmp "$dst" "$src"
   ```
   Keep `~/AppImages/paseo.appimage.bak` as the known-good rollback; do not overwrite it unless the
   user asks.
6. Never restart the running Paseo. Tell the user which commits came in and to relaunch the app.
