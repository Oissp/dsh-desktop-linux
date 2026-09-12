# Agent Note: Desktop update install — surface failed installs and recover the session

Status: implemented

English | [中文](2026-09-12-desktop-update-install-failure-surfaced.zh.md)

## Problem

From `0.1.5-rc.2.1` → `0.1.5-rc.2.2`, a user reported that after download+verification finished, the app neither installed nor restarted — silently.

The flow: `checkAndPrompt` → `install()` → `doInstall()` downloaded and verified the deb, then called `beforeRestart()` and `updater.quitAndInstall(false, true)`. electron-updater's `DebUpdater.doInstall` runs `dpkg -i <deb>` synchronously under `pkexec` (with `--disable-internal-agent`, which requires an external polkit agent) or `sudo`. On any failure — no authentication agent, no passwordless sudo tty, dpkg/apt error — `BaseUpdater.install()` catches, dispatches an `error` event, returns `false`, and `quitAndInstall` skips the quit/relaunch. The coordinator published `phase: 'ready'` *before* calling `quitAndInstall` and returned it unconditionally, and never listened for the updater `error` event — so the failure was invisible: no install, no restart, no error shown, and a retry threw "no verified update is available" because `availableVersion` was cleared after download. The startup auto-check also swallowed the failure because `checkAndPrompt` only showed the install-error dialog for manual checks.

## Decision

**Surface the install failure.** `doInstall()` now calls `quitAndInstall` inside `quitForInstall`, which registers a temporary `error` listener before the call and removes it after. electron-updater dispatches `error` synchronously from `quitAndInstall` when the install step throws, so the listener captures the failure and the coordinator publishes `phase: 'error'` with the real message instead of a fake `ready`. On success (no error), `ready` is published only after the call returns — the process quits on a later turn, and `ready` is truthful only then.

**Recover the running session.** `beforeRestart` (which sets `shellInstallerOwnsQuit` and stops the backend) now returns an undo; on a failed install the coordinator runs it, resetting `shellInstallerOwnsQuit` and restarting the backend via `reconcileBackend`, so the current session keeps working instead of becoming a stopped-backend zombie.

**Loud auto-check failures.** `checkAndPrompt` shows the install-error dialog regardless of `manual` — the user explicitly chose "Install and Restart", so a failure must be visible even from the 10-second startup check.

## Alternatives considered

**Listen for `error` on the updater permanently.** Rejected: `checkForUpdates` and `downloadUpdate` already reject their promises *and* emit `error`, so a permanent listener would double-report those failures. The temporary listener is scoped to the one call that has no other error path.

**Release the single-instance lock / manual relaunch.** Rejected after tracing `app.relaunch()`: Electron defers the respawn to `will-quit`, after windows close and just before exit, so the new instance acquires the lock cleanly — there is no relaunch race to fix.

## Consequences

A failed deb install (no polkit agent, sudo without a tty, dpkg/apt error) now publishes `phase: 'error'` with electron-updater's message, restores the backend so the session stays usable, and shows an error dialog from both manual and startup prompts. The previous silent no-op — download+verify "succeeded" but nothing installed — is gone. Tests cover the happy path and the synchronous-error path.
