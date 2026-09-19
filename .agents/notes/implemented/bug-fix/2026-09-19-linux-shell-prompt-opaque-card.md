# Agent Note: Shell prompt documents are served, and Linux uses an opaque card

Status: implemented

English | [中文](2026-09-19-linux-shell-prompt-opaque-card.zh.md)

## Problem

[The 0.1.6-alpha.2 merge](../architecture/2026-09-18-merge-0.1.6-alpha.2-linux-desktop.md) replaced this fork's native `dialog.showMessageBox` update prompts with shell-drawn windows that load `dsh-app://shell/update-dialog.html` and `dsh-app://shell/mandatory-update.html`. The merge also dropped the `shell` branch from the `dsh-app` protocol handler, which the fork's pre-merge `main.ts` carried as `if (url.hostname === 'shell') return serveShellAsset(request)`. Nothing served that host afterwards, so the handler fell through to its `404` and every prompt loaded an empty document. The documents ship correctly inside `app.asar` under `renderer/`; no code read them.

Two symptoms followed, both reported against Linux `0.1.6-alpha.2.1` and later. Because `update-dialog.css` never loaded, the prompt window had no scrim, no centering, and no card. The transient **正在检查更新…** prompt therefore appeared as a full-parent-bounds `transparent: true` window containing nothing, and on X11 without a compositing manager that alpha has no backdrop to blend against and paints as an opaque slab over the product window. Restricting the prompt to an opaque 420x320 card turned the same empty document into a small blank white window instead.

An uncomposited transparent window still cannot present a scrim, so the surface split below remains necessary; it was not what blanked the content.

## Decision

The protocol handler serves the `shell` host from `join(app.getAppPath(), 'renderer')` through the existing `serveWebDocument`, which already performs the path-containment check and MIME mapping the deleted `serveShellAsset` duplicated. Its `<head>` boot injection applies only to `/` and `/index.html`, so shell documents are served byte-for-byte.

`update-overlay.ts` owns the surface decision, and the surface is chosen per platform rather than globally, so the upstream sheet survives wherever it works.

`desktopDialogSurface(platform)` returns `window` on Linux and `overlay` elsewhere. `createUpdatePromptWindow` builds an opaque frameless card for `window`: 420x320, centered on the parent's content bounds, `backgroundColor: '#ffffff'`, no `transparent`, and no CSS inserted into the parent. It builds the unchanged transparent sheet for `overlay`.

`mandatoryUpdateSurface(platform)` returns `overlay` only on macOS, because the mandatory modal offers native move, resize, and maximize that the frameless sheet cannot provide on Windows; Linux and Windows both get the framed 640x560 window that the Windows branch already used.

The main process publishes the chosen surface as `UpdateDialogView.surface` and `MandatoryUpdateView.surface`. Each renderer copies it to `document.body.dataset.surface`, and `update-dialog.css` uses that attribute to drop the scrim and let `main` fill the window without its card radius or shadow.

The self-drawn window is kept rather than reverting to native dialogs because the post-merge flow closes prompts programmatically. `controller.abort()` dismisses the transient checking prompt the moment the check returns, and `updateDialog.cancel()` dismisses ordinary prompts when policy turns blocking or on shutdown. `dialog.showMessageBox` exposes no close operation, so a native prompt would stay on screen until the user answered it.

## Alternatives considered

**Revert to native `dialog.showMessageBox` on Linux.** Rejected: the merged flow depends on programmatic dismissal, and the transient checking prompt would linger until clicked. The pre-merge code could use native dialogs because it had neither a transient prompt nor the mandatory-policy machinery that cancels ordinary prompts.

**Restore `serveShellAsset` as its own reader.** Rejected: it duplicated `serveWebDocument`'s traversal guard, MIME table, and method check. Reusing the tested function leaves one reader to audit for path containment.

**Detect compositing and keep the sheet where it works.** Rejected: Electron exposes no compositing query, and an environment heuristic would be wrong on the X11 desktops that do composite — the common case — while still being unable to help the ones that do not.

**Make the sheet opaque at full parent bounds.** Rejected: an opaque window sized to the parent's content bounds hides the product window entirely instead of covering it with a scrim.

**Pass `--enable-transparent-visuals`.** Rejected: the switch does not make alpha composite without a compositing manager, and it adds a GPU-affecting startup flag to every Linux launch.

## Consequences

Linux prompts no longer cover the product window, and the mandatory modal keeps native window controls there. The trade-offs are in the card's fixed geometry: content taller than 420x320 scrolls inside `main` instead of growing the window, and the card is centered once at creation rather than following the parent's move and resize, which the sheet still does.

The fork's diff against upstream grows in two files: the `shell` branch in `main.ts` and the Linux branch plus two surface functions in `update-overlay.ts`. Upstream `master` has no `shell` branch in its handler and no other code serving that host, so a merge that takes upstream's handler wholesale deletes the branch again and blanks every prompt. `.github/sync-trimmed-paths.txt` records deleted files, not modified behavior, so neither divergence is tracked there.

That the documents 404'd silently for two releases is the lesson worth carrying: `loadURL` resolves a 404 without rejecting, so `void window.loadURL(page).catch(abort)` never fired and the prompt reported success while showing nothing.

## Testing

`apps/desktop/tests/main-startup.spec.ts` asserts the handler routes `dsh-app://shell/update-dialog.html` to the packaged `renderer` directory and still 404s an unowned host; removing the branch fails it. `update-overlay.spec.ts` pins each platform's surface, the card's opaque centered geometry, and that the card surface inserts no CSS into the parent. `update-dialog.spec.ts` pins the Linux prompt and the published `surface`. `update-error-renderer.spec.ts` asserts both documents copy the field onto `document.body.dataset`, so dropping that assignment fails rather than silently restoring the scrim. `package-deb.yml` runs this suite before packaging.

No automated check proves a prompt renders visible content, which is why the 404 survived the suite. Verifying a prompt on an installed Linux build remains a manual acceptance step.

## Related

[The channel-derivation note](2026-09-19-desktop-update-channel-derivation.md) covers the other defect the same merge introduced in the update path.
