# Agent Note: desktop-cli Linux sync

Status: implemented

English | [中文](2026-09-30-desktop-cli-linux-sync.zh.md)

## Problem

Upstream 0.2.0-rc.2 added **Manage dsh Command** (desktop-cli), which runs Desktop's bundled dsh CLI from a terminal. The feature gates its menu entry on `darwin || win32` in `main.ts`, `prepareDesktopCli()` accepts only `darwin` and `win32`, and its two launchers are a macOS application-bundle script and a Windows `.cmd`. The fork trimmed every related file in the 0.2.0-rc.2 merge, leaving no Linux code path.

Users need terminal access to plugin management and the other CLI commands without maintaining a second npm installation.

## Decision

Restore desktop-cli's cross-platform layer from upstream and add Linux adaptations. The cross-platform parts (`command-installation.ts`, `desktop-host/src/cli.ts`, and `shellCommand()` in `command-management.ts`) are restored unchanged; only the launcher, platform dispatch, elevation, and menu integration need Linux work.

**Linux launcher** (`apps/desktop/cli/dsh`): the macOS POSIX sh script, with the Electron binary name changed from `DeepSeek Harness` (the macOS `Contents/MacOS/` layout) to `deepseek-harness-desktop` (the Linux deb `executableName`). After resolving symlinks the launcher runs desktop-host's `cli.js` through `ELECTRON_RUN_AS_NODE=1 exec`.

**`prepare-cli.ts` extension**: the platform union grows from `'darwin' | 'win32'` to `'darwin' | 'win32' | 'linux'`, and the `chmodSync` condition changes from `=== 'darwin'` to `!== 'win32'`, because Linux needs the executable bit too.

**`command-manager-entry.ts` Linux branch**: `darwin` and `linux` merge into one branch that shares the symlink management in `command-installation.ts`. Linux `link(2)` does not follow symlinks, so it needs no equivalent of macOS's `link-entry.c` helper; `linkEntry()` takes the `link()` path on every non-darwin platform. The `linkHelper` field stays required by the interface even though Linux never calls it.

**pkexec elevation**: macOS writes `/usr/local/bin` through `osascript ... with administrator privileges`; Linux uses `pkexec --disable-internal-agent` instead. The `worker()` method in `command-management.ts` selects `osascript` or `pkexec` per platform on the `elevated` branch, and the elevation retry condition grows from `darwin` to `darwin || linux`. A pkexec cancellation (exit code 126) maps to `ECANCELED`, matching macOS's osascript error -128.

**`inspect()` extension**: upstream calls `shellCommand()` on `darwin` only, to find which `dsh` the user's shell resolves; Windows returns `activeCommand` through a PowerShell worker. Linux needs the same probe as macOS, so the condition moves from `process.platform !== 'darwin'` (skip everything but darwin) to `process.platform === 'win32'` (skip Windows only).

**Menu integration reaches the tray only**: upstream places **Manage dsh Command…** in `applicationItems()`, the top application menu. A packaged Linux build runs `Menu.setApplicationMenu(null)` in `refreshApplicationMenu()` to hide the top menu bar and serves every entry from the tray menu instead. The entry is therefore integrated into `rebuildTrayMenu()` only, leaving `applicationItems()` untouched: the tray is the only entry a packaged Linux user sees, and the change conflicts with upstream's `applicationItems()` in no way.

**`prepare-runtime.ts` restores CLI preparation**: it restores the `prepareDesktopCli()` call and the `command-manager-entry.js` copy. The platform is hardcoded to `'linux'` because the fork builds linux-x64 only. `prepareCommandLink()` (macOS-only, compiles `link-entry.c`) is not called.

**Self-contained worker bundle**: the command management worker runs on the bare Node shipped inside the packaged runtime, not on Electron, and is the single file `runtime/cli/command-manager.js` that `prepare-runtime.ts` copies. `command-manager-entry` therefore has its own tsdown entry with `codeSplitting: false` and a `workerImports` policy that admits Node builtins only, enforced by `packagedImportsPlugin`. Without that, `@deepseek-ai/dsh-atomic-write` would be split into a shared chunk that never ships with the worker, and the worker would fail at runtime with `ERR_MODULE_NOT_FOUND`.

**Elevation tests run on Linux**: Node reports a non-zero `execFile` exit as a numeric `error.code`, so the pkexec cancellation code 126 is compared with `=== 126`. The elevation tests previously ran on darwin only; they now run on Linux as well and cover the pkexec path, with a numeric 126 in the mock.

## Alternatives considered

**Add the menu entry in both places (`applicationItems` and the tray).** Rejected: a packaged Linux build hides the top menu bar, so the `applicationItems()` change is invisible to users and only adds a merge conflict with upstream. Development mode reaches the entry from the tray as well, because the fork builds its tray in both packaged and development mode.

**Install to `~/.local/bin/dsh` to avoid elevation.** Rejected: the deb installs the application system-wide under `/opt/`, so the command belongs in the system-wide `/usr/local/bin`. `~/.local/bin` is not on the default PATH of every distribution.

**Elevate through sudo.** Rejected: it is a terminal interaction and reads poorly in a GUI application. `pkexec` is the freedesktop standard, ships with mainstream Linux desktops, and Desktop already requires a desktop environment to run.

## Consequences

The restored files move from the trim list to `sync-forked-paths.txt`, the behaviour-modification baseline. Every upstream refactor of `command-management.ts`, `command-manager-entry.ts`, `prepare-cli.ts`, `prepare-runtime.ts`, `main.ts`, or `locale.ts` produces a conflict that needs the fork's Linux adaptations re-applied.

The trim list keeps the macOS/Windows-only files (`cli/dsh.cmd`, `cli/link-entry.c`, `prepare-command-link.ts`, `command-path.ps1`, `windows-cli-signals.ts`, and their tests and fixtures).

An AppImage mount path can differ on every run, so a `dsh` symlink pointing inside the AppImage is unreliable. Command management is dependable for deb installs only; AppImage users should use the deb. `isInstalledLocation` always returns `true` on Linux, and can be extended there if a deb/AppImage distinction is ever needed.

## Testing

`pnpm exec vitest run apps/desktop/tests` reports 796 passed and 4 skipped; the only failure, `ptc-runtime.spec.ts`, is a pre-existing unrelated one (`sandbox-windows-acl` lacks the `yaml` package). All three desktop-cli suites pass: `command-management.spec.ts` (6 tests), `command-installation.spec.ts` (17 tests), and `command-manager-flow.spec.ts` (8 tests | 2 skipped). The tray menu structure assertions in `main-startup.spec.ts` were updated to include the `cliCommandMenu` entry. `pnpm exec oxlint` reports 0 errors, and `npx tsc -p tsconfig.host.json --noEmit` reports 0 errors.
