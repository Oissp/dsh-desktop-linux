# Agent Note: desktop-cli Linux sync plan

Status: implemented
Archived: 2026-09-30

English | [中文](2026-09-30-desktop-cli-linux-sync-plan.zh.md)

## Problem

Upstream 0.2.0-rc.2 added the「管理 dsh 命令」(desktop-cli) feature, letting users run the Desktop-bundled dsh CLI from a terminal instead of maintaining a separate npm install. In upstream the feature is gated to `darwin || win32` in the `main.ts` menu, `prepareDesktopCli()` accepts only `darwin`/`win32`, and the two launchers are a macOS bundle script and a Windows `.cmd`. The fork trimmed all related files during the 0.2.0-rc.2 merge, leaving no code path on Linux.

Linux users need terminal access to plugin management and the other CLI commands without a separate npm install.

## Decision

Restore the cross-platform layer of desktop-cli from upstream and adapt it for Linux. The cross-platform components (`command-installation.ts`, `desktop-host/src/cli.ts`, the `shellCommand()` in `command-management.ts`) are restored unchanged; only the launcher, platform dispatch, elevation mechanism, and menu integration need Linux adaptation.

- **Linux launcher** (`apps/desktop/cli/dsh`): a POSIX sh script based on the macOS one, differing only in the Electron binary name — `deepseek-harness-desktop` (Linux deb `executableName`) instead of the macOS `Contents/MacOS/` path. After resolving symlinks it runs the desktop-host `cli.js` via `ELECTRON_RUN_AS_NODE=1 exec`.
- **`prepare-cli.ts` extension**: the platform union becomes `'darwin' | 'win32' | 'linux'`; the `chmodSync` condition changes from `=== 'darwin'` to `!== 'win32'` (Linux also needs the executable bit).
- **`command-manager-entry.ts` Linux branch**: `darwin` and `linux` share one branch using `command-installation.ts`'s symlink management. Linux `link(2)` does not follow symlinks, so the macOS `link-entry.c` helper is unnecessary; `linkEntry()` takes the plain `link()` branch on non-darwin. The `linkHelper` field remains required by the interface but is unused on Linux.
- **Elevation**: macOS writes `/usr/local/bin` via `osascript ... with administrator privileges`; Linux uses `pkexec --disable-internal-agent`. The `elevated` branch of `worker()` in `command-management.ts` selects `osascript` or `pkexec` by platform; the elevation-retry condition extends from `darwin` to `darwin || linux`. The `pkexec` cancel exit code 126 maps to `ECANCELED`, mirroring macOS's `osascript` error -128.
- **`inspect()` extension**: upstream runs `shellCommand()` to detect how `dsh` resolves in the user's shell only on `darwin`; Windows returns `activeCommand` from its PowerShell worker. Linux needs the same probe, so the condition changes from `process.platform !== 'darwin'` (skip non-darwin) to `process.platform === 'win32'` (skip only Windows).
- **Menu integration only in the tray**: upstream puts「Manage dsh Command…」in `applicationItems()` (the top application menu), but the packaged Linux build runs `Menu.setApplicationMenu(null)` in `refreshApplicationMenu()` and hides the top menu bar, providing all entries through the tray. The menu item is therefore wired only into `rebuildTrayMenu()` and `applicationItems()` is not modified — the tray is the only visible entry for packaged Linux, with zero conflict against upstream's `applicationItems()`.
- **`prepare-runtime.ts` restores CLI preparation**: it calls `prepareDesktopCli()` and copies `command-manager-entry.js` to `runtime/cli/command-manager.js`. The platform is hardcoded to `'linux'` (the fork builds only linux-x64). It does not call `prepareCommandLink()` (macOS-only, compiles `link-entry.c`).
- **`locale.ts` restores the `cliCommand*` messages** (en + zh).

### Implemented fixes

Two defects surfaced during implementation and were fixed in the same work:

1. **Self-contained worker bundle.** The command-management worker runs with the bare packaged runtime Node (not Electron) from a single copied file `runtime/cli/command-manager.js`, but the tsdown bundle originally code-split its `@deepseek-ai/dsh-atomic-write` dependency into a shared chunk that `prepare-runtime.ts` never ships. The worker died with `ERR_MODULE_NOT_FOUND` at runtime ("Command-manager process failed."). `command-manager-entry` now has its own tsdown entry with `codeSplitting: false` and a `workerImports` policy allowing only Node builtins, enforced by `packagedImportsPlugin`.
2. **Numeric pkexec cancel code.** Node reports a non-zero `execFile` exit as a numeric `error.code`; the elevation tests' pkexec-cancel mock originally set the string `'126'`, which never matched the production `=== 126` check, so the ECANCELED branch could not fire on Linux. The mock now uses the numeric code, matching Node's real behavior. The elevation tests also now run on Linux instead of being darwin-only, so the pkexec path this feature is for is actually covered.

## Alternatives considered

**Add the menu item in both `applicationItems()` and the tray.** Rejected: the packaged Linux build hides the top menu bar, so an `applicationItems()` change is invisible to users and only adds merge conflict surface with upstream. Development mode also accesses the feature through the tray (the fork builds a tray in both packaged and dev modes).

**Use `~/.local/bin/dsh` to avoid elevation.** Rejected: a deb-installed application is system-level (`/opt/`), so the command should live in the system-level `/usr/local/bin`; `~/.local/bin` is not on every distribution's default PATH.

**Use `sudo` for elevation.** Rejected: terminal-style interaction is a poor GUI experience. `pkexec` is a freedesktop standard shipped with mainstream Linux desktops, and the Desktop itself requires a desktop environment to run.

## Consequences

The restored files move from the trim list to `sync-forked-paths.txt` (the behavior-modification baseline). Every time upstream reworks `command-management.ts`, `command-manager-entry.ts`, `prepare-cli.ts`, `prepare-runtime.ts`, `main.ts`, or `locale.ts`, a merge conflict surfaces and the fork's Linux adaptation must be reapplied.

The trim list keeps macOS/Windows-only files (`cli/dsh.cmd`, `cli/link-entry.c`, `prepare-command-link.ts`, `command-path.ps1`, `windows-cli-signals.ts`, and their tests/fixtures).

AppImage mount-point paths can differ on each run, so a `dsh` symlink pointing into the AppImage is unreliable. Command management is reliable only for the deb install; AppImage users should use a deb package. `isInstalledLocation` always returns `true` on Linux; distinguishing deb/AppImage can be added there later.

## Testing

`pnpm exec vitest run apps/desktop/tests` passes the `command-management.spec.ts`, `command-installation.spec.ts`, and `command-manager-flow.spec.ts` suites, including the two elevation tests now running on Linux and exercising the pkexec path; `main-startup.spec.ts` tray-menu structure includes the `cliCommandMenu` entry; `pnpm exec oxlint` and `npx tsc -p tsconfig.host.json --noEmit` report no errors. See the owning feature note for the shipped implementation record.
