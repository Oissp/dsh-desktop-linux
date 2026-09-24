# Agent Note: Shell prompt documents are served, and Linux uses an opaque card

Status: implemented

English | [中文](2026-09-19-linux-shell-prompt-opaque-card.zh.md)

## Problem

[The 0.1.6-alpha.2 merge](../architecture/2026-09-18-merge-0.1.6-alpha.2-linux-desktop.md) replaced this fork's native `dialog.showMessageBox` update prompts with shell-drawn windows that load `dsh-app://shell/update-dialog.html` and `dsh-app://shell/mandatory-update.html`. The merge also dropped the `shell` branch from the `dsh-app` protocol handler, which the fork's pre-merge `main.ts` carried as `if (url.hostname === 'shell') return serveShellAsset(request)`. Nothing served that host afterwards, so the handler fell through to its `404` and every prompt loaded an empty document. The documents ship correctly inside `app.asar` under `renderer/`; no code read them.

Two symptoms followed, both reported against Linux `0.1.6-alpha.2.1` and later. Because `update-dialog.css` never loaded, the prompt window had no scrim, no centering, and no card. The transient **正在检查更新…** prompt therefore appeared as a full-parent-bounds `transparent: true` window containing nothing, and on X11 without a compositing manager that alpha has no backdrop to blend against and paints as an opaque slab over the product window. Restricting the prompt to an opaque 420x320 card turned the same empty document into a small blank white window instead.

An uncomposited transparent window still cannot present a scrim, so the surface split below remains necessary; it was not what blanked the content.

Serving the documents exposed two further defects that the blank window had hidden. The card's fixed 320 height left bare white backing under a short prompt, and every prompt rendered English on a system reporting an English locale even with 中文 selected in the application, because the update machinery captured its dictionary from `app.getLocale()` before the engine's Language preference was read.

## Decision

The protocol handler serves the `shell` host from `join(app.getAppPath(), 'renderer')` through the existing `serveWebDocument`, which already performs the path-containment check and MIME mapping the deleted `serveShellAsset` duplicated. Its `<head>` boot injection applies only to `/` and `/index.html`, so shell documents are served byte-for-byte.

`update-overlay.ts` owns the surface decision, and the surface is chosen per platform rather than globally, so the upstream sheet survives wherever it works.

`desktopDialogSurface(platform)` returns `window` on Linux and `overlay` elsewhere. `createUpdatePromptWindow` builds an opaque frameless card for `window`: 420 wide, centered on the parent's content bounds, `backgroundColor` prepainted with `surfaceBackground()` in the resolved theme, no `transparent`, and no CSS inserted into the parent. It builds the sheet for `overlay`, passing the non-native `nativeModal` the ordinary prompt already used, so macOS keeps the sheet out of its viewport-wide sheet animation and blocks the parent's input itself.

The card carries no content height of its own, so a fixed height leaves bare white backing under a short prompt. The document measures `#dialog` once laid out and reports it over `UPDATE_DIALOG_IPC.resize`; `fitDialogCard` clamps that to `CARD_MIN_HEIGHT` below and the parent's content height above, then re-centers. A `ResizeObserver` and the disclosure's `toggle` event re-report, so expanding technical details grows the window instead of scrolling inside it. The sheet already spans its parent, so `fitDialogCard` ignores measurements there and the renderer does not send them.

`mandatoryUpdateSurface(platform)` returns `overlay` only on macOS, because the mandatory modal offers native move, resize, and maximize that the frameless sheet cannot provide on Windows; Linux and Windows both get the framed 640x560 window that the Windows branch already used.

The main process publishes the chosen surface as `UpdateDialogView.surface` and `MandatoryUpdateView.surface`. Each renderer copies it to `document.body.dataset.surface`, and `update-dialog.css` uses that attribute to drop the scrim and the card radius and shadow. It does not force `main` to fill the window, because that would defeat the height measurement.

Every shell locale consumer takes `() => DesktopLocale` rather than a `DesktopLocale`. `DesktopLocaleController` reads the engine's `locale.preference` from `settings.yaml` after the update machinery is constructed and reassigns the `locale` binding, so a dictionary captured at construction pinned every prompt to `app.getLocale()` for the process lifetime while the menus, which rebuild from `currentDesktopLocale()`, followed the setting. Passing `() => locale` reads the current binding at display time, which is why a Language change reaches the next prompt. `MandatoryUpdateView.locale` stays a value: it crosses IPC to the renderer, which cannot call a function.

The self-drawn window is kept rather than reverting to native dialogs because the post-merge flow closes prompts programmatically. `controller.abort()` dismisses the transient checking prompt the moment the check returns, and `updateDialog.cancel()` dismisses ordinary prompts when policy turns blocking or on shutdown. `dialog.showMessageBox` exposes no close operation, so a native prompt would stay on screen until the user answered it.

## Alternatives considered

**Revert to native `dialog.showMessageBox` on Linux.** Rejected: the merged flow depends on programmatic dismissal, and the transient checking prompt would linger until clicked. The pre-merge code could use native dialogs because it had neither a transient prompt nor the mandatory-policy machinery that cancels ordinary prompts.

**Restore `serveShellAsset` as its own reader.** Rejected: it duplicated `serveWebDocument`'s traversal guard, MIME table, and method check. Reusing the tested function leaves one reader to audit for path containment.

**Detect compositing and keep the sheet where it works.** Rejected: Electron exposes no compositing query, and an environment heuristic would be wrong on the X11 desktops that do composite — the common case — while still being unable to help the ones that do not.

**Make the sheet opaque at full parent bounds.** Rejected: an opaque window sized to the parent's content bounds hides the product window entirely instead of covering it with a scrim.

**Pass `--enable-transparent-visuals`.** Rejected: the switch does not make alpha composite without a compositing manager, and it adds a GPU-affecting startup flag to every Linux launch.

**Shrink `CARD_HEIGHT` to fit a typical prompt.** Rejected: it trades bare backing under short prompts for scrolling under long ones, and the technical-details disclosure changes the needed height while the prompt is open, so no fixed value is right.

**Await the stored locale preference before constructing the update machinery.** Rejected: it fixes the language at launch but not a Language change made while the application runs, and it puts a settings read on the startup path ahead of the first window.

## Consequences

Linux prompts no longer cover the product window, and the mandatory modal keeps native window controls there. The remaining trade-off is that the card is centered at creation and at each measurement rather than following the parent's move and resize, which the sheet still does.

The fork's diff against upstream grows in the `shell` branch in `main.ts`, the Linux branch with the surface and fitting functions in `update-overlay.ts`, the `resize` channel, and the locale getters. Upstream `master` has no `shell` branch in its handler and no other code serving that host, so a merge that takes upstream's handler wholesale deletes the branch again and blanks every prompt. `.github/sync-trimmed-paths.txt` records deleted files, not modified behavior, so none of these divergences are tracked there.

That risk is not hypothetical, and it is not limited to the handler. The 0.1.7-alpha.1 merge took upstream's `update-overlay.ts`, `update-dialog.ts`, and `update-dialog.css` wholesale and reverted this note's whole design: the prompt went back to a full-parent transparent sheet, which a Wayland session cannot position over its parent and which therefore left the product window partly uncovered and still interactive; the palette went back to light-only; and the dictionaries went back to launch-time capture. The reverted stylesheet was the visible tell — `mandatory-update.css` kept referring to the `--shell-*` tokens that `update-dialog.css` had stopped defining. Any merge that touches these three files needs the surface split, the token table, and the locale getters re-checked, not just the protocol handler.

That the documents 404'd silently for two releases is the lesson worth carrying: `loadURL` resolves a 404 without rejecting, so `void window.loadURL(page).catch(abort)` never fired and the prompt reported success while showing nothing.

## Testing

`apps/desktop/tests/main-startup.spec.ts` asserts the handler routes `dsh-app://shell/update-dialog.html` to the packaged `renderer` directory and still 404s an unowned host; removing the branch fails it. `update-overlay.spec.ts` pins each platform's surface, the card's opaque centered geometry, that the card surface inserts no CSS into the parent, and `fitDialogCard`'s clamping at both bounds and its no-op on the sheet. `update-dialog.spec.ts` pins the Linux prompt, the published `surface`, rejection of an unusable reported height, and that a Language change between two prompts reaches the second. `update-error-renderer.spec.ts` asserts both documents copy the surface onto `document.body.dataset` and that the card document reports a height while the sheet document does not. `package-deb.yml` runs this suite before packaging.

No automated check proves a prompt renders visible content, which is why the 404 survived the suite; nothing proves the copy is the language the user selected either, since the tests supply their own dictionary. Verifying a prompt on an installed Linux build remains a manual acceptance step.

## Related

[The channel-derivation note](2026-09-19-desktop-update-channel-derivation.md) covers the other defect the same merge introduced in the update path. [The shell appearance note](../architecture/2026-09-20-shell-appearance-follows-engine-theme.md) covers how these documents follow the application appearance.
