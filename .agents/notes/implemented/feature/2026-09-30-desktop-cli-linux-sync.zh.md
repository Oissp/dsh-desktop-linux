# Agent Note: desktop-cli Linux sync

Status: implemented

[English](2026-09-30-desktop-cli-linux-sync.md) | 中文

## Problem

上游 0.2.0-rc.2 新增「管理 dsh 命令」(desktop-cli) 功能，让用户从终端直接运行 Desktop 内置的 dsh CLI。该功能在 `main.ts` 菜单中 gate 为 `darwin || win32`，`prepareDesktopCli()` 只接受 `darwin/win32`，两个启动器分别是 macOS app bundle 脚本与 Windows `.cmd`。fork 在 0.2.0-rc.2 合并时裁剪了全部相关文件，Linux 上没有任何代码路径。

用户需要终端访问插件管理和其他 CLI 功能，无需维护另一个 npm 安装。

## Decision

从上游恢复 desktop-cli 的跨平台层，并添加 Linux 适配。核心策略：跨平台组件（`command-installation.ts`、`desktop-host/src/cli.ts`、`command-management.ts` 的 `shellCommand()`）直接恢复无需改动；仅启动器、平台分发、提权机制和菜单集成需要 Linux 适配。

**Linux 启动器**（`apps/desktop/cli/dsh`）：基于 macOS 的 POSIX sh 脚本，唯一差异是 Electron 二进制名从 `DeepSeek Harness`（macOS 的 `Contents/MacOS/` 层级）改为 `deepseek-harness-desktop`（Linux deb 的 `executableName`）。启动器解析 symlink 后通过 `ELECTRON_RUN_AS_NODE=1 exec` desktop-host 的 `cli.js`。

**`prepare-cli.ts` 扩展**：类型联合从 `'darwin' | 'win32'` 扩展为 `'darwin' | 'win32' | 'linux'`；`chmodSync` 条件从 `=== 'darwin'` 改为 `!== 'win32'`（Linux 也需要可执行权限）。

**`command-manager-entry.ts` Linux 分支**：`darwin` 和 `linux` 合并为一个分支，共享 `command-installation.ts` 的 symlink 管理逻辑。Linux 的 `link(2)` 不跟随 symlink，不需要 macOS 的 `link-entry.c` helper；`linkEntry()` 在非 darwin 平台自动走 `link()` 分支。`linkHelper` 字段在接口中是必需的，但 Linux 不会调用它。

**pkexec 提权**：macOS 用 `osascript ... with administrator privileges` 写入 `/usr/local/bin`；Linux 用 `pkexec --disable-internal-agent` 替代。`command-management.ts` 的 `worker()` 方法在 `elevated` 分支按平台选择 `osascript` 或 `pkexec`。提权重试条件从 `darwin` 扩展为 `darwin || linux`。pkexec 取消（exit code 126）映射为 `ECANCELED`，与 macOS 的 osascript error -128 对应。

**`inspect()` 扩展**：上游只在 `darwin` 上调用 `shellCommand()` 检测用户 shell 中 `dsh` 解析到哪；Windows 通过 PowerShell worker 返回 `activeCommand`。Linux 需要像 macOS 一样探测，条件从 `process.platform !== 'darwin'`（跳过非 darwin）改为 `process.platform === 'win32'`（只跳过 Windows）。

**菜单集成仅到托盘**：上游把「管理 dsh 命令…」放在 `applicationItems()`（顶部应用菜单）。但 fork 的打包 Linux 在 `refreshApplicationMenu()` 中执行 `Menu.setApplicationMenu(null)` 隐藏顶部菜单栏，改用托盘菜单提供所有入口。因此菜单项只集成到 `rebuildTrayMenu()`（托盘菜单），不改 `applicationItems()`——打包 Linux 用户唯一可见入口是托盘，且与上游 `applicationItems()` 零冲突。

**`prepare-runtime.ts` 恢复 CLI 准备**：恢复 `prepareDesktopCli()` 调用和 `command-manager-entry.js` 复制。平台硬编码为 `'linux'`（fork 只构建 linux-x64）。不调用 `prepareCommandLink()`（macOS 专用，编译 `link-entry.c`）。

**worker 自包含打包**：命令管理 worker 用打包运行时自带的裸 Node（非 Electron）运行，是 `prepare-runtime.ts` 复制的单一文件 `runtime/cli/command-manager.js`，因此 `command-manager-entry` 在 tsdown 中拥有独立入口，`codeSplitting: false`，并用只允许 Node 内建模块的 `workerImports` 策略（由 `packagedImportsPlugin` 强制）保证自包含——避免把 `@deepseek-ai/dsh-atomic-write` 拆进不会随 worker 发布的共享 chunk 导致运行时 `ERR_MODULE_NOT_FOUND`。

**提权测试在 Linux 上运行**：Node 把非零 `execFile` 退出报告为数字型 `error.code`，pkexec 取消码 126 的映射用 `=== 126` 判断；提权测试原先只跑 darwin，现在也在 Linux 上跑并覆盖 pkexec 路径，mock 用数字型 126。

## Alternatives considered

**两处都加菜单项（applicationItems + 托盘）。** 拒绝：打包 Linux 隐藏顶部菜单栏，`applicationItems()` 的改动对用户不可见，只增加与上游的合并冲突。开发模式也从托盘访问（fork 的托盘在打包和开发模式都建）。

**用 `~/.local/bin/dsh` 避免提权。** 拒绝：deb 安装的应用是系统级的（装在 `/opt/`），命令也应装在系统级目录 `/usr/local/bin`；`~/.local/bin` 不在所有发行版默认 PATH 中。

**用 sudo 提权。** 拒绝：终端式交互，GUI 应用体验差。`pkexec` 是 freedesktop 标准，主流 Linux 桌面环境自带，且 Desktop 本身需要桌面环境运行。

## Consequences

恢复的文件从裁剪清单移到 `sync-forked-paths.txt`（行为修改基线）。每次上游重构 `command-management.ts`、`command-manager-entry.ts`、`prepare-cli.ts`、`prepare-runtime.ts`、`main.ts`、`locale.ts` 时会产生冲突，需要重新应用 fork 的 Linux 适配。

裁剪清单保留 macOS/Windows 专有文件（`cli/dsh.cmd`、`cli/link-entry.c`、`prepare-command-link.ts`、`command-path.ps1`、`windows-cli-signals.ts` 及其测试和 fixtures）。

AppImage 的挂载点路径每次运行可能不同，`dsh` 命令的 symlink 指向 AppImage 内部路径不可靠。CLI 命令管理功能仅对 deb 安装可靠；AppImage 用户应使用 deb 安装包。`isInstalledLocation` 在 Linux 上总是返回 `true`，未来如需区分 deb/AppImage 可在此扩展。

## Testing

`pnpm exec vitest run apps/desktop/tests` 报告 796 passed、4 skipped，唯一失败的 `ptc-runtime.spec.ts` 是预先存在的无关失败（`sandbox-windows-acl` 缺少 `yaml` 包）。desktop-cli 三个测试套件全部通过：`command-management.spec.ts`（6 tests）、`command-installation.spec.ts`（17 tests）、`command-manager-flow.spec.ts`（8 tests | 2 skipped）。`main-startup.spec.ts` 的托盘菜单结构断言已更新以包含 `cliCommandMenu` 项。`pnpm exec oxlint` 报告 0 errors。`npx tsc -p tsconfig.host.json --noEmit` 报告 0 errors。
