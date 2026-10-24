# Agent Note: Shell prompt documents are served inside the product window

Status: implemented

English | [中文](2026-09-19-linux-shell-prompt-opaque-card.zh.md)

## Problem

[The 0.1.6-alpha.2 merge](../architecture/2026-09-18-merge-0.1.6-alpha.2-linux-desktop.md) replaced this fork's native `dialog.showMessageBox` update prompts with shell-drawn windows that load `dsh-app://shell/update-dialog.html` and `dsh-app://shell/mandatory-update.html`. The merge also dropped the `shell` branch from the `dsh-app` protocol handler, which the fork's pre-merge `main.ts` carried as `if (url.hostname === 'shell') return serveShellAsset(request)`. Nothing served that host afterwards, so the handler fell through to its `404` and every prompt loaded an empty document. The documents ship correctly inside `app.asar` under `renderer/`; no code read them.

Two symptoms followed, both reported against Linux `0.1.6-alpha.2.1` and later. Because `update-dialog.css` never loaded, the prompt window had no scrim, no centering, and no card. The transient **正在检查更新…** prompt therefore appeared as a full-parent-bounds `transparent: true` window containing nothing, and on X11 without a compositing manager that alpha has no backdrop to blend against and paints as an opaque slab over the product window. That was a separate native window. The fork's answer at the time was a Linux-only opaque centered card in its own window, recorded under this note's original title; it was removed when the prompt became a view inside the product window, which is what ships.

Serving the documents exposed two further defects that the blank window had hidden. The prompt needed a height the document alone knew, and the update machinery captured its dictionary from `app.getLocale()` before the engine's Language preference was read, so every prompt rendered English on a system reporting an English locale even with 中文 selected in the application.

## Decision

The protocol handler serves the `shell` host from `join(app.getAppPath(), 'renderer')` through the existing `serveWebDocument`, which already performs the path-containment check and MIME mapping the deleted `serveShellAsset` duplicated. Its `<head>` boot injection applies only to `/` and `/index.html`, so shell documents are served byte-for-byte, and `/design-platform.css` is served from the built client's `lib/welcome` directory beside them.

`update-overlay.ts` owns the prompt surface as a `WebContentsView` created with the isolated shell preload, painted with `setBackgroundColor('#00000000')`, and added to the product window's `contentView` rather than opened as a window of its own. The view spans the owner's content bounds below the Windows caption, follows the owner's resize, forwards focus only while the owner already has focus, and consumes `before-input-event` on the owner so product shortcuts and editing keys do not reach the page behind it. Because the document is composited inside the product window, the scrim has the product page as its backdrop by construction; no separate transparent native window exists for an uncomposited session to flatten.

The mandatory modal uses the same view on Linux and macOS and embeds the document in the product page on Windows, where the caption area belongs to the product. A failed or crashed load falls back to one native `dialog.showMessageBox` offering the download page and application exit, which keeps the parent blocked and leaves an escape hatch, then reloads the view.

Both documents load `design-platform.css` and `shell-theme.js` before their own stylesheet, so their palette is the product's: `update-dialog.css` and `mandatory-update.css` reference `--dsw-alias-*` tokens, and `shell-theme.js` toggles `body[data-ds-dark-theme]` from `prefers-color-scheme`, which the appearance controller drives through `nativeTheme.themeSource`. The close glyph is a CSS mask over `update-close.svg` painted with `currentColor`, so it follows the label color without an inline copy of the paths.

No platform surface split remains. There is no `desktopDialogSurface`, no `mandatoryUpdateSurface`, no `fitDialogCard`, no `UPDATE_DIALOG_IPC.resize` channel, no `surface` field on either view, and no prepainted window background: the card, its height fitting, and its prepaint existed only to make a separate window legible, and the attached view made all of them unnecessary. This is the design upstream `master` shipped; [the 0.2.1-rc.3 merge note](../architecture/2026-10-24-merge-0.2.1-rc.3-linux-desktop.md) records why the fork adopted it rather than restoring the card.

Both shell classes take `() => DesktopLocale` rather than a `DesktopLocale`. `DesktopLocaleController` reads the engine's `locale.preference` from `settings.yaml` after the update machinery is constructed and reassigns the `locale` binding, so a dictionary captured at construction pinned every prompt to `app.getLocale()` for the process lifetime while the menus, which rebuild from `currentDesktopLocale()`, followed the setting. Passing a getter reads the current binding at display time, which is why a Language change reaches the next prompt. `MandatoryUpdateView.locale` stays a value: it crosses IPC to the renderer, which cannot call a function.

The documents stay shell-drawn rather than reverting to native dialogs because the merged flow closes prompts programmatically. `controller.abort()` dismisses the transient checking prompt the moment the check returns, and `updateDialog.cancel()` dismisses ordinary prompts when policy turns blocking or on shutdown. `dialog.showMessageBox` exposes no close operation, so a native prompt would stay on screen until the user answered it.

## Alternatives considered

**Revert to native `dialog.showMessageBox` on Linux.** Rejected: the merged flow depends on programmatic dismissal, and the transient checking prompt would linger until clicked. The pre-merge code could use native dialogs because it had neither a transient prompt nor the mandatory-policy machinery that cancels ordinary prompts.

**Restore `serveShellAsset` as its own reader.** Rejected: it duplicated `serveWebDocument`'s traversal guard, MIME table, and method check. Reusing the tested function leaves one reader to audit for path containment.

**Keep the fork's opaque centered card, with its height-reporting channel and prepaint color.** Rejected after the view replaced the separate window: the card existed because a transparent native window cannot composite its alpha without a compositing manager, and an in-window view removes that window. Keeping the card would have preserved the height channel, the `surface` field, the prepaint helper, and a Linux-only visual divergence to serve a surface the view already renders correctly.

**Detect compositing and keep the sheet where it works.** Rejected: Electron exposes no compositing query, and an environment heuristic would be wrong on the X11 desktops that do composite — the common case — while still being unable to help the ones that do not.

**Make the sheet a full-parent opaque surface.** Rejected: an opaque surface covering the parent's content hides the product window entirely instead of covering it with a scrim.

**Pass `--enable-transparent-visuals`.** Rejected: the switch does not make alpha composite without a compositing manager, and it adds a GPU-affecting startup flag to every Linux launch.

**Await the stored locale preference before constructing the update machinery.** Rejected: it fixes the language at launch but not a Language change made while the application runs, and it puts a settings read on the startup path ahead of the first window.

## Consequences

Prompts now cover the product window from inside it, with the scrim composited against the product page, and the mandatory modal keeps the product window's own caption and native attention behaviour. The card's residual trade-off — centered only at creation and at each measurement rather than following the parent — is gone with the card.

The fork's divergence in this subsystem is now the `shell` branch in `main.ts` and the two locale getters; `update-overlay.ts`, the document markup and stylesheets, and everything else in the trio follow upstream. `.github/sync-trimmed-paths.txt` records deleted files, not modified behavior, so neither divergence is tracked there.

A merge that takes upstream's `update-overlay.ts`, `update-dialog.ts`, and `update-dialog.css` wholesale is no longer a design regression — it is the design. The risk that remains is the locale wiring: upstream takes a `DesktopLocale` value, so a wholesale take pins prompts to the launch-time dictionary again, and `update-dialog.spec.ts` fails on the case that renders two prompts across a Language change. Any merge touching these files re-checks the getters and the `shell` branch, not the surface.

That the documents 404'd silently for two releases is the lesson worth carrying: `loadURL` resolves a 404 without rejecting, so `void window.loadURL(page).catch(abort)` never fired and the prompt reported success while showing nothing.

## Testing

`apps/desktop/tests/main-startup.spec.ts` asserts the handler routes `dsh-app://shell/update-dialog.html` to the packaged `renderer` directory, serves `design-platform.css` from `lib/welcome`, serves `update-close.svg` as `image/svg+xml`, and still 404s an unowned host; removing the branch fails it. `update-overlay.spec.ts` pins attachment to the owner's `contentView`, the transparent view background, caption clearance on Windows, input blocking, focus following the owner, and listener release. `update-dialog.spec.ts` pins the prompt lifecycle, rejection of unowned responses, and that a Language change between two prompts reaches the second. `update-error-renderer.spec.ts` pins the documents' text-only rendering and keyboard order. `shell-theme.spec.ts` pins that each shell document applies the app palette and follows changes to it. `package-deb.yml` runs this suite before packaging.

No automated check proves a prompt renders visible content, which is why the 404 survived the suite; nothing proves the copy is the language the user selected either, since the tests supply their own dictionary. Verifying a prompt on an installed Linux build remains a manual acceptance step.

## Related

[The channel-derivation note](2026-09-19-desktop-update-channel-derivation.md) covers the other defect the same merge introduced in the update path. [The shell appearance note](../architecture/2026-09-20-shell-appearance-follows-engine-theme.md) covers how these documents follow the application palette. [The 0.2.1-rc.3 merge note](../architecture/2026-10-24-merge-0.2.1-rc.3-linux-desktop.md) records the adoption of upstream's in-window prompt surface.
