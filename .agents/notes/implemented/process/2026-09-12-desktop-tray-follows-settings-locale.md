# Agent Note: Desktop tray follows the engine's language preference

Status: implemented

English | [中文](2026-09-12-desktop-tray-follows-settings-locale.zh.md)

## Problem

The tray menu — including the Desktop Plugins submenu — shipped with full Chinese and English dictionaries in `apps/desktop/src/locale.ts`, but the shell resolved its language from Electron's system locale (`app.getLocale()`). A user who picked 中文 in 通用设置 → Language while the OS ran in English still saw an English tray; the engine-side setting (`locale.preference` in `<harness home>/settings.yaml`, written by the web engine's LocaleRuntime) was ignored by the shell entirely.

## Decision

**Read the engine's persisted preference.** A new `DesktopLocaleController` (in `apps/desktop/src/desktop-locale.ts`) reads `locale.preference` from `settings.yaml` on start, resolves the dictionary with `resolveDesktopLocale(preference ?? systemLocale)`, applies it, and watches the document for live changes. Absent an explicit choice it falls back to the system locale, matching the pre-change behavior.

**Extract the shared settings watcher.** The parent-directory watch machinery that `DesktopAppearanceController` already used (150 ms debounce, 2 s re-arm when the home directory is missing, parent-dir watch so creates/replaces/deletes fire) is extracted verbatim into `DesktopSettingsWatcher` (`settings-watcher.ts`). Both the appearance and locale controllers now use it; behavior is unchanged.

**Rebuild the tray on language change.** `main.ts` holds a mutable `locale` and a `rebuildTrayMenu()` closure whose labels come from `currentDesktopLocale()`, which resolves `windowsLanguage`. The controller's apply callback records the resolved id in `windowsLanguage` and rebuilds the tray context menu. The `quit` role item gets an explicit `messages.quitMenu` label — Electron would otherwise override the dictionary with its own built-in localized label.

**Unreadable document keeps the current language.** A read failure during the engine's write window is not treated as "preference cleared to default": the controller retains the applied locale, mirroring the appearance controller's established read-failure semantics.

## Alternatives considered

**Resolve once from `app.getLocale()` at startup.** Rejected: the whole point is to follow the settings choice, which can change at runtime; without a watcher the tray would keep the launch-time language until restart.

**Have the renderer push the preference over IPC.** Rejected: the appearance controller already reads the same persisted document, so the locale controller does too — one source of truth instead of a second write path with ordering concerns.

## Consequences

The tray menu and its quit label now follow 通用设置 → Language live, falling back to the system locale until the user makes an explicit choice. Tests cover the stored-preference read, system-locale fallback, an unreadable document keeping the applied locale, and the live switch after a document edit. The extraction of `DesktopSettingsWatcher` keeps the two controllers on one watch implementation.
