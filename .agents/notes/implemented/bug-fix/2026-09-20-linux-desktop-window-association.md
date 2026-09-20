# Agent Note: Linux desktop entry and window share one identity

Status: implemented

English | [中文](2026-09-20-linux-desktop-window-association.zh.md)

## Problem

electron-builder reported `desktopName is not set in package.json` on every packaging run. A Linux desktop environment associates a running window with an installed launcher entry by matching the window's `WM_CLASS` on X11 and application ID on Wayland against the entry's `StartupWMClass`. Both sides derive that value from `desktopName`, and with it unset each fell back to a different field: electron-builder wrote `StartupWMClass=DeepSeek Harness` from `productName`, Electron reports a lowercased hyphenated slug of the app name (`deepseek-harness`), and the installed entry was named after `executableName` (`deepseek-harness-desktop.desktop`). No two of the three matched, so a desktop environment could show a running window as its own taskbar entry instead of the installed launcher.

## Decision

`apps/desktop/electron-builder.config.mjs` sets `extraMetadata: { desktopName: appId }` and `linux.syncDesktopName: true`. The value reaches the packaged `package.json` that Electron reads and the metadata electron-builder's Linux target reads, from the one source the config already requires: `DSH_DESKTOP_APP_ID`. The entry installs as `<appId>.desktop`, and both `StartupWMClass` and Electron's application ID are the app ID without a trailing `.desktop` suffix, because electron-builder strips that suffix and Electron documents it as optional.

The installed entry is now `<appId>.desktop` rather than `deepseek-harness-desktop.desktop`. A launcher pinned before this change references the old filename and needs pinning again once.

The `Verify artifacts` step in [the packaging workflow](../../../../.github/workflows/package-deb.yml) asserts that the built `.deb` carries the entry and that its `StartupWMClass` equals the application ID without the suffix, so every release build checks the identity. Its previous `grep -E "icons/hicolor|/\.desktop"` listed no entry at all, because the pattern required a literal `/` before `.desktop` and every installed entry ends in `-<name>.desktop`.

## Alternatives considered

**Set `desktopName` to the executable name and leave `syncDesktopName` off.** All three values would align without renaming the installed entry, so existing pins survive. Electron documents the value as the app's reverse-DNS identity and reports it to `xdg-desktop-portal`, which refuses sessions for an ID it cannot resolve to an installed `.desktop` file, so the executable name would trade a one-time re-pin for a portal identity that has to change again later.

**Pin `StartupWMClass` through `linux.desktop.entry` instead.** The entry could be made to match Electron's slug fallback without touching `desktopName`. It writes the slug of the product name into the build configuration as a second copy of a value Electron derives at runtime, and leaves the application ID non-reverse-DNS.

**Write `desktopName` into `apps/desktop/package.json`.** It needs no electron-builder metadata merge, but it duplicates an environment-supplied identifier as a constant that silently keeps the default when `DSH_DESKTOP_APP_ID` is overridden.

## Consequences

A running window now carries the identity its launcher entry declares, so desktop environments group it under the installed entry. The application ID Electron reports to portals is reverse-DNS.

This is a fork divergence: upstream ships no Linux Desktop release target, and its `apps/desktop/electron-builder.config.mjs` has no `linux` block. A merge that takes upstream's config wholesale drops both fields and restores the mismatch and the warning.

## Testing

`apps/desktop/tests/package-target.spec.ts` pins `extraMetadata.desktopName` to the resolved `appId` and `linux.syncDesktopName` to true; it passes locally. The generated entry and its `StartupWMClass` can only be checked from a Linux build, which the packaging workflow does on every run.
