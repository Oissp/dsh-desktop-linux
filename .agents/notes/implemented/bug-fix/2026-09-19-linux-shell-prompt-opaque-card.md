# Agent Note: Linux shell prompts use an opaque card instead of the transparent sheet

Status: implemented

English | [中文](2026-09-19-linux-shell-prompt-opaque-card.zh.md)

## Problem

[The 0.1.6-alpha.2 merge](../architecture/2026-09-18-merge-0.1.6-alpha.2-linux-desktop.md) replaced this fork's native `dialog.showMessageBox` update prompts with a shell-drawn overlay window. `createUpdateOverlay` builds a frameless `transparent: true` child sized to `parent.getContentBounds()`, `update-dialog.css` paints `body { background: rgb(0 0 0 / 24%) }` as a scrim, and the parent's `body` receives a 2px `filter: blur()`. Both `update-dialog.html` and `mandatory-update.html` link that stylesheet, so both inherit the scrim.

A transparent window's alpha needs a compositing manager to blend it against what is behind. On X11 without one the alpha has nothing to blend against and renders as an opaque backing, so the scrim becomes a dark slab covering the whole product window with only the centered white card visible. The reported case was the transient **正在检查更新…** prompt. Pre-merge builds showed native dialogs, so every `0.1.6-alpha.2.1` and later Linux build carries the defect, while darwin and win32 — where the sheet does composite — never showed it.

## Decision

`update-overlay.ts` owns the surface decision, and the surface is chosen per platform rather than globally, so the upstream sheet survives wherever it works.

`desktopDialogSurface(platform)` returns `window` on Linux and `overlay` elsewhere. `createUpdatePromptWindow` builds an opaque frameless card for `window`: 420x320, centered on the parent's content bounds, `backgroundColor: '#ffffff'`, no `transparent`, and no CSS inserted into the parent. It builds the unchanged transparent sheet for `overlay`.

`mandatoryUpdateSurface(platform)` returns `overlay` only on macOS, because the mandatory modal offers native move, resize, and maximize that the frameless sheet cannot provide on Windows; Linux and Windows both get the framed 640x560 window that the Windows branch already used.

The main process publishes the chosen surface as `UpdateDialogView.surface` and `MandatoryUpdateView.surface`. Each renderer copies it to `document.body.dataset.surface`, and `update-dialog.css` uses that attribute to drop the scrim and let `main` fill the window without its card radius or shadow.

The self-drawn window is kept rather than reverting to native dialogs because the post-merge flow closes prompts programmatically. `controller.abort()` dismisses the transient checking prompt the moment the check returns, and `updateDialog.cancel()` dismisses ordinary prompts when policy turns blocking or on shutdown. `dialog.showMessageBox` exposes no close operation, so a native prompt would stay on screen until the user answered it.

## Alternatives considered

**Revert to native `dialog.showMessageBox` on Linux.** Rejected: the merged flow depends on programmatic dismissal, and the transient checking prompt would linger until clicked. The pre-merge code could use native dialogs because it had neither a transient prompt nor the mandatory-policy machinery that cancels ordinary prompts.

**Detect compositing and keep the sheet where it works.** Rejected: Electron exposes no compositing query, and an environment heuristic would be wrong on the X11 desktops that do composite — the common case — while still being unable to help the ones that do not.

**Make the sheet opaque at full parent bounds.** Rejected: an opaque window sized to the parent's content bounds hides the product window entirely instead of covering it with a scrim.

**Pass `--enable-transparent-visuals`.** Rejected: the switch does not make alpha composite without a compositing manager, and it adds a GPU-affecting startup flag to every Linux launch.

## Consequences

Linux prompts no longer cover the product window, and the mandatory modal keeps native window controls there. The trade-offs are in the card's fixed geometry: content taller than 420x320 scrolls inside `main` instead of growing the window, and the card is centered once at creation rather than following the parent's move and resize, which the sheet still does.

The fork's diff against upstream in `update-overlay.ts` grows by the Linux branch and the two surface functions. An upstream refactor of the prompt windows is the change that requires re-applying it: `.github/sync-trimmed-paths.txt` records deleted files, not modified behavior, so a merge that restores `createUpdateOverlay` as the only prompt constructor would silently bring the dark slab back on Linux.

## Testing

`apps/desktop/tests/update-overlay.spec.ts` pins each platform's surface, the card's opaque centered geometry, and that the card surface inserts no CSS into the parent. `update-dialog.spec.ts` pins the Linux prompt and the published `surface`. `update-error-renderer.spec.ts` asserts both documents copy the field onto `document.body.dataset`, so dropping that assignment fails rather than silently restoring the scrim. `package-deb.yml` runs this suite before packaging.

## Related

[The channel-derivation note](2026-09-19-desktop-update-channel-derivation.md) covers the other defect the same merge introduced in the update path.
