# desktop-cli Linux 同步方案

> 研究对象：上游 0.2.0-rc.2 的「管理 dsh 命令」(desktop-cli) 功能
> 目标：评估将该功能同步到 Linux 的可行性、工作量和具体实现方案
> 状态：方案设计（未实现）

## 一、功能概述

上游 0.2.0-rc.2 新增了「管理 dsh 命令」功能，让用户从终端直接运行 Desktop 内置的 dsh CLI，无需维护另一个 npm 安装。功能分三层：

### 1.1 启动器层（Launcher）

| 平台 | 文件 | 机制 |
|---|---|---|
| macOS | `apps/desktop/cli/dsh` | POSIX sh 脚本：解析 symlink → 找到 Electron 二进制 → `ELECTRON_RUN_AS_NODE=1 exec` desktop-host 的 `cli.js` |
| Windows | `apps/desktop/cli/dsh.cmd` | CMD 脚本：同上，通过 `%~dp0` 相对路径找到 Electron |

启动器在打包时由 `prepare-cli.ts` 的 `prepareDesktopCli()` 复制到 `resources/cli/bin/` 目录。

### 1.2 命令管理层（Worker）

`command-manager-entry.ts`（打包后为 `resources/cli/command-manager.js`）是一个独立的 Node worker，由 Electron 在 Node 模式下运行。它：

- **inspect**：读取 `/usr/local/bin/dsh`（macOS）或 PATH 目录（Windows）的当前状态
- **install**：创建 symlink 指向启动器，保留旧命令的备份
- **remove**：移除 Desktop 创建的 symlink，恢复旧命令

底层由 `command-installation.ts` 实现，使用 `symlink` + `link` + `rename` 做可逆的命令链接管理，带指纹校验和文件锁。

macOS 的 `link-entry.c` 是一个 C helper，用 `linkat(2)` 精确保留 symlink 的 inode（因为 macOS 的 `link(2)` 会跟随 symlink）。

### 1.3 Shell UI 层

`command-management.ts` 的 `DesktopCommandManager` 提供：
- 原生对话框显示命令状态（已安装/未安装/需修复/被遮蔽）
- 安装/修复/移除按钮
- 更新准备时等待命令操作完成（`commandManager.idle()`）
- macOS 通过 `osascript` 提权写入 `/usr/local/bin`

`main.ts` 在应用菜单中添加「Manage dsh Command…」项，gate 为 `darwin || win32`。

### 1.4 desktop-host CLI 入口

`apps/desktop-host/src/cli.ts` 的 `runDesktopCli()`：
- 调用 `installOfficeEngineResolution()` 设置 Office 引擎解析
- 调用 `runCli({ manageDesktopProfile: true, packageManager: ... })` 运行普通 CLI 调度器
- 使用 bundled pnpm（通过 Electron Node 模式运行）
- Windows 额外注册 Koffi 控制台信号处理器（`windows-cli-signals.ts`）

## 二、Linux 同步可行性分析

### 2.1 已经跨平台的组件（无需改动）

| 组件 | 文件 | 为什么已跨平台 |
|---|---|---|
| 命令安装逻辑 | `command-installation.ts` | `linkEntry()` 在非 darwin 上用 `link()`，Linux 的 `link(2)` 不跟随 symlink，行为正确 |
| CLI 入口 | `desktop-host/src/cli.ts` | `runDesktopCli()` 平台无关；Windows 信号注册已 gate 为 `win32` |
| Shell 命令检测 | `command-management.ts` 的 `shellCommand()` | 用 `userInfo().shell` + POSIX `command -v dsh`，Linux 原生支持 |
| 原子写入 | `@deepseek-ai/dsh-atomic-write` | 跨平台文件锁 |

### 2.2 需要适配的组件

| 组件 | 改动 | 难度 |
|---|---|---|
| 启动器 | 新增 Linux 版 `cli/dsh`（macOS 脚本改二进制名） | 低 |
| `prepare-cli.ts` | 接受 `'linux'` 平台参数 | 低 |
| `command-manager-entry.ts` | 新增 Linux 分支（复用 macOS的 `command-installation.ts` 路径，去掉 `linkHelper` 和 `umask`） | 低 |
| `prepare-runtime.ts` | 传递 `'linux'` 平台给 `prepareDesktopCli()` | 低 |
| `main.ts` | 菜单 gate 加 `linux`；恢复 `DesktopCommandManager` 集成 | 中 |
| `locale.ts` | 恢复 `cliCommand*` 消息 | 低 |
| 提权机制 | 选择 `pkexec` 或用户级目录 | 中（见下文） |

### 2.3 不需要的组件

| 组件 | 原因 |
|---|---|
| `windows-cli-signals.ts` | Linux 原生处理 SIGINT/SIGTERM，不需要 Koffi |
| `link-entry.c` | Linux `link(2)` 不跟随 symlink，不需要 `linkat` helper |
| `command-path.ps1` | Windows PATH 管理专用，Linux 用 symlink |

## 三、实现方案

### 3.1 启动器（`apps/desktop/cli/dsh`）

macOS 启动器几乎可以直接复用，只需改 Electron 二进制名：

```sh
#!/bin/sh
# Run the installed CLI without changing the invoking shell or working directory.
set -e
launcher=$0
while [ -L "$launcher" ]; do
  directory=$(CDPATH= cd -- "$(dirname -- "$launcher")" && pwd -P)
  target=$(readlink "$launcher")
  case "$target" in
    /*) launcher=$target ;;
    *) launcher=$directory/$target ;;
  esac
done
resources=$(CDPATH= cd -- "$(dirname -- "$launcher")/../../.." && pwd -P)
ELECTRON_RUN_AS_NODE=1 exec "$resources/../deepseek-harness-desktop" --expose-internals "$resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js" "$@"
```

与 macOS 版的唯一差异：`exec "$resources/../deepseek-harness-desktop"` 而非 `exec "$resources/../MacOS/DeepSeek Harness"`。

**替代方案**：用同一个 `cli/dsh` 脚本，在运行时检测二进制名。但 macOS 和 Linux 的二进制位置结构不同（macOS 有 `Contents/MacOS/` 层级），统一脚本会增加复杂度。建议保持分离的 `cli/dsh` 文件，在 `prepare-cli.ts` 中按平台选择。

deb 安装后的路径关系：
```
/opt/deepseek-harness-desktop/
  deepseek-harness-desktop          # Electron 可执行文件
  resources/
    app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js
    cli/bin/dsh                     # 启动器（打包时复制）
    runtime/                        # primary-runtime, pnpm, office-skills

/usr/local/bin/dsh -> /opt/deepseek-harness-desktop/resources/cli/bin/dsh  # symlink
```

启动器解析 symlink 后：
- `launcher` = `/opt/deepseek-harness-desktop/resources/cli/bin/dsh`
- `resources` = `dirname(launcher)/../../..` = `/opt/deepseek-harness-desktop/resources`
- `exec` = `$resources/../deepseek-harness-desktop` = `/opt/deepseek-harness-desktop/deepseek-harness-desktop` ✓

### 3.2 `prepare-cli.ts` 扩展

```typescript
export function prepareDesktopCli(destination: string, platform: 'darwin' | 'win32' | 'linux'): void {
  const name = platform === 'win32' ? 'dsh.cmd' : 'dsh'
  const command = join(destination, 'bin', name)
  mkdirSync(join(destination, 'bin'), { recursive: true })
  copyFileSync(join(import.meta.dirname, '..', 'cli', name), command)
  if (platform !== 'win32') chmodSync(command, 0o755)
}
```

改动：类型联合加 `'linux'`；`chmodSync` 条件从 `=== 'darwin'` 改为 `!== 'win32'`（Linux 也需要可执行权限）。

### 3.3 `command-manager-entry.ts` Linux 分支

```typescript
} else if (process.platform === 'linux') {
  // Linux 与 macOS 共用 command-installation.ts 的 symlink 管理逻辑。
  // Linux 的 link(2) 不跟随 symlink，不需要 macOS 的 link-entry.c helper。
  // 目标目录 /usr/local/bin 通常需要 root 权限，通过 pkexec 提权。
  const options = {
    destination: '/usr/local/bin/dsh',
    launcher: join(resources, 'runtime', 'cli', 'bin', 'dsh'),
    // linkHelper 在 Linux 上不使用（command-installation.ts 的 linkEntry 走 link() 分支）
    linkHelper: join(resources, 'runtime', 'cli', 'link-entry'),
  }
  const state = operation === 'inspect' ? await inspectFileCommand(options)
    : operation === 'install' ? await installFileCommand(options, fingerprint)
    : await removeFileCommand(options, fingerprint)
  process.stdout.write(JSON.stringify({ ok: true, state }) + '\n')
}
```

`command-installation.ts` 的 `linkEntry()` 在非 darwin 上用 `link()`，Linux 自动走这个分支。`linkHelper` 字段在 `FileCommandInstallation` 接口中是必需的，但 Linux 不会调用它（`linkEntry` 的 `if (process.platform === 'darwin')` 分支不触发）。

### 3.4 提权机制

macOS 用 `osascript ... with administrator privileges` 写入 `/usr/local/bin`。Linux 的选项：

| 方案 | 优点 | 缺点 |
|---|---|---|
| **pkexec**（推荐） | PolicyKit 标准，GNOME/KDE 桌面自带，GUI 弹窗 | 无桌面环境时不可用（但 Desktop 本身需要桌面） |
| sudo | 通用 | 终端式交互，GUI 应用体验差 |
| `~/.local/bin/dsh` | 无需提权 | 不在所有发行版默认 PATH 中；与 macOS 的 `/usr/local/bin` 不一致 |

**推荐 `pkexec`**，因为：
1. deb 安装的应用是系统级的（装在 `/opt/`），命令也应该装在系统级目录 `/usr/local/bin`
2. `pkexec` 是 freedesktop 标准，主流 Linux 桌面环境都自带
3. Desktop 应用本身需要桌面环境运行，`pkexec` 可用性有保证

`command-management.ts` 的 `worker()` 方法需要增加 Linux 的提权路径：

```typescript
// macOS 用 osascript；Linux 用 pkexec
if (elevated) {
  if (process.platform === 'darwin') {
    // 现有 osascript 逻辑
  } else {
    // Linux: pkexec
    stdout = (await promisify(execFile)('pkexec', ['--disable-internal-agent',
      node, entry, operation, ...expected === undefined ? [] : [expected]],
      { maxBuffer: 65536 })).stdout
  }
}
```

提权触发条件与 macOS 一致：非 inspect 操作遇到 `EACCES`/`EPERM` 时自动提权重试。

### 3.5 `command-management.ts` 的 `inspect()` 调整

当前逻辑：
```typescript
private async inspect(): Promise<CommandState> {
  const state = await this.worker('inspect')
  if (process.platform !== 'darwin') return state  // ← Windows 跳过 shell 探测
  // macOS: shellCommand() 检测用户 shell 中 dsh 解析到哪
}
```

Windows 跳过 `shellCommand()` 是因为 PowerShell worker 已返回 `activeCommand`。Linux 需要像 macOS 一样调用 `shellCommand()` 检测用户的 dsh 命令：

```typescript
private async inspect(): Promise<CommandState> {
  const state = await this.worker('inspect')
  if (process.platform === 'win32') return state  // ← 只 Windows 跳过
  // macOS 和 Linux: shellCommand() 检测用户 shell 中 dsh 解析到哪
  try {
    return { ...state, ...await shellCommand() }
  } catch {
    return { ...state, selectionUnknown: true }
  }
}
```

### 3.6 `prepare-runtime.ts` 恢复 CLI 准备

fork 的 `prepare-runtime.ts` 裁剪了 CLI 准备步骤。恢复后：

```typescript
// 平台映射：linux-x64 → 'linux'
const platform = target.startsWith('mac-') ? 'darwin'
  : target.startsWith('win-') ? 'win32' : 'linux'

// ... 在 RUNTIME_ROOT 准备后 ...
await prepareDesktopCli(join(RUNTIME_ROOT, 'cli'), platform)
// prepareCommandLink 只在 macOS 上运行（Linux 不需要 link-entry.c）
if (platform === 'darwin' && macosMinimumVersion !== undefined) {
  prepareCommandLink(join(RUNTIME_ROOT, 'cli'), arch, macosMinimumVersion)
}
// command-manager-entry.js 和 command-path.ps1 复制
cpSync(join(import.meta.dirname, '..', 'lib', 'command-manager-entry.js'), join(RUNTIME_ROOT, 'cli', 'command-manager.js'))
// command-path.ps1 只在 Windows 上需要
if (platform === 'win32') {
  cpSync(join(import.meta.dirname, 'command-path.ps1'), join(RUNTIME_ROOT, 'cli', 'command-path.ps1'))
}
```

### 3.7 `main.ts` 恢复集成

1. 恢复 `import { DesktopCommandManager } from './command-management.ts'`
2. 恢复 `DesktopCommandManager` 构造（`isInstalledLocation` 在 Linux 上总是 `true`，因为 deb 安装在固定位置）
3. **菜单项只集成到托盘菜单**（见下方详细说明）
4. 恢复 `commandManager.idle()` 在更新准备流程中
5. 恢复 `cliCommand*` locale 消息

`isInstalledLocation` 的 Linux 适配：

```typescript
isInstalledLocation: () => {
  if (process.platform === 'darwin') return app.isInApplicationsFolder()
  // Windows 和 Linux: deb/NSIS 安装在固定位置，总是 true
  return true
}
```

#### 菜单项集成位置：仅托盘菜单

上游把「管理 dsh 命令…」放在 `applicationItems()` 数组里（顶部应用菜单的「Check for Updates…」之后）。但 fork 的打包 Linux 版隐藏了顶部菜单栏——`refreshApplicationMenu()` 在 `app.isPackaged && process.platform === 'linux'` 时执行 `Menu.setApplicationMenu(null)` 然后 return，根本不读 `applicationItems()`。

因此只改 `applicationItems()` 对打包 Linux 用户完全不可见。方案选择**仅集成到 `rebuildTrayMenu()`**（main.ts:1320 附近），不改 `applicationItems()`：

- 打包 Linux 用户唯一可见入口是托盘菜单
- 开发模式也从托盘访问（fork 的托盘在打包和开发模式都建）
- 不改 `applicationItems()`，与上游该函数零冲突

```typescript
rebuildTrayMenu = (): void => {
  if (linuxTray === undefined) return
  linuxTray.setContextMenu(Menu.buildFromTemplate([
    { label: currentDesktopLocale().messages.showWindow, click: focusPrimaryWindow },
    { type: 'separator' },
    { label: currentDesktopLocale().messages.checkUpdatesMenu, click: () => { void openUpdatePrompt(true) } },
    // ↓↓↓ 新增：管理 dsh 命令（Linux 通过托盘访问，顶部菜单栏已隐藏） ↓↓↓
    { label: currentDesktopLocale().messages.cliCommandMenu, click: () => { void commandManager.show() } },
    { type: 'separator' },
    { role: 'quit', label: currentDesktopLocale().messages.quitMenu },
  ]))
}
```

**注意**：`commandManager` 必须在 `rebuildTrayMenu` 定义之前构造。上游在 main.ts:389 构造 `commandManager`，fork 需要确保它在托盘菜单构建之前可用。当前 fork 的 `commandManager` 构造位置需要从上游恢复到托盘代码块之前。

### 3.8 裁剪清单调整

从 `.github/sync-trimmed-paths.txt` 中移除以下路径（恢复到 fork）：

```
apps/desktop/cli/dsh                    # 改为 Linux 版（或保留 macOS 版 + 新增 Linux 版）
apps/desktop/src/command-installation.ts
apps/desktop/src/command-management.ts
apps/desktop/src/command-manager-entry.ts
apps/desktop/scripts/prepare-cli.ts
apps/desktop-host/src/cli.ts
apps/desktop/tests/command-installation.spec.ts
apps/desktop/tests/command-management.spec.ts
apps/desktop/tests/command-manager-flow.spec.ts
```

**保留裁剪**（Linux 仍不需要）：
```
apps/desktop/cli/dsh.cmd                # Windows 专用
apps/desktop/cli/link-entry.c           # macOS 专用（linkat helper）
apps/desktop/scripts/prepare-command-link.ts  # macOS 专用（编译 link-entry.c）
apps/desktop/scripts/command-path.ps1   # Windows 专用
apps/desktop-host/src/windows-cli-signals.ts   # Windows 专用（Koffi）
apps/desktop/tests/cli-launcher.spec.ts        # 可能需要 Linux 适配
apps/desktop/tests/command-path.spec.ts        # Windows 专用
apps/desktop/tests/windows-cli-signals.spec.ts # Windows 专用
```

### 3.9 `electron-builder.config.mjs` 文件列表

CLI 启动器和 worker 需要打包进应用。当前 `files` 列表不包含 `cli/` 目录。需要确认 `prepare-runtime.ts` 把 CLI 文件放到 `resources/cli/`（在 `extraResources` 的 `runtime` 映射下），所以不需要改 `files`——`extraResources` 已经覆盖 `runtime/` 目录。

## 四、工作量评估

| 任务 | 文件数 | 估计难度 |
|---|---|---|
| 新增 Linux 启动器 `cli/dsh` | 1 新文件 | 低 |
| 扩展 `prepare-cli.ts` 接受 `'linux'` | 1 改文件 | 低 |
| 新增 `command-manager-entry.ts` Linux 分支 | 1 恢复+改文件 | 低 |
| `command-management.ts` inspect + pkexec 提权 | 1 恢复+改文件 | 中 |
| 恢复 `command-installation.ts`（无改动） | 1 恢复文件 | 低 |
| 恢复 `desktop-host/src/cli.ts`（无改动） | 1 恢复文件 | 低 |
| `prepare-runtime.ts` 恢复 CLI 准备 | 1 改文件 | 中 |
| `main.ts` 恢复集成 + 托盘菜单项 | 1 改文件 | 中 |
| `locale.ts` 恢复 `cliCommand*` 消息 | 1 改文件 | 低 |
| 裁剪清单调整 | 1 改文件 | 低 |
| 恢复/适配测试 | ~3 文件 | 中 |
| Agent Note | 1 新文件 | 低 |

**总计**：约 12 个文件改动，难度中等。大部分是恢复上游文件 + 小幅 Linux 适配，核心新增逻辑只有 pkexec 提权、启动器二进制名、以及托盘菜单项（打包的 Linux 隐藏顶部菜单栏，所有入口通过托盘提供，不改 `applicationItems()`）。

## 五、风险与注意事项

1. **pkexec 可用性**：无桌面环境或无 PolicyKit 的系统上 `pkexec` 不可用。但 Desktop 本身需要桌面环境，这个前提已满足。如果 `pkexec` 不可用，应 fallback 到提示用户手动创建 symlink。

2. **AppImage 的路径稳定性**：AppImage 是单文件，挂载点路径每次运行可能不同。`dsh` 命令的 symlink 指向 AppImage 内部路径不可靠。**建议 CLI 命令管理功能仅对 deb 安装启用**，AppImage 安装时菜单项不出现或提示「请使用 deb 安装包」。这可以通过 `isInstalledLocation` 检查实现。

3. **上游合并冲突**：恢复这些文件后，每次上游重构 `command-management.ts`、`main.ts`、`prepare-runtime.ts` 等文件时会产生冲突。应将这些文件从裁剪清单移到 `sync-forked-paths.txt`（行为修改基线），并在合并 Agent Note 中记录 fork 的 Linux 适配。

4. **`dsh` 命令冲突**：如果用户已通过 npm 全局安装了 `dsh`，Desktop 的 symlink 会遮蔽它。上游的 `command-installation.ts` 已处理这个场景（保留旧命令备份，检测遮蔽状态），Linux 上同样适用。

5. **`/usr/local/bin` 写入权限**：deb 安装后 `/usr/local/bin` 通常需要 root 权限。`pkexec` 提权是正确方案，但首次安装时用户会看到 PolicyKit 密码弹窗。

## 六、推荐实施顺序

1. **先恢复跨平台文件**（无改动）：`command-installation.ts`、`desktop-host/src/cli.ts`、`command-management.ts`
2. **新增 Linux 启动器**：`cli/dsh`
3. **扩展平台支持**：`prepare-cli.ts`、`command-manager-entry.ts`、`prepare-runtime.ts`
4. **恢复 Shell 集成**：`main.ts`、`locale.ts`
5. **pkexec 提权**：`command-management.ts` 的 `worker()` 方法
6. **调整裁剪清单**：从 `sync-trimmed-paths.txt` 移除恢复的文件
7. **恢复/适配测试**：`command-management.spec.ts`、`command-installation.spec.ts`
8. **验证**：`typecheck` + `vitest run apps/desktop/tests` + 本地 deb 打包测试
9. **写 Agent Note**：记录决策和 Linux 适配细节

## 七、与上游的关系

本方案不修改上游文件——所有 Linux 适配都在 fork 侧完成。如果未来上游接受 Linux 作为支持平台（当前声明「Linux has no supported release target」），fork 的改动可以作为上游 PR 的基础：

- `prepare-cli.ts` 的 `'linux'` 参数扩展
- `command-manager-entry.ts` 的 Linux 分支
- `cli/dsh` 的 Linux 启动器
- `command-management.ts` 的 pkexec 提权
- `main.ts` 的菜单 gate 扩展

这些改动都是**增量的**（新增分支/条件，不修改现有 macOS/Windows 逻辑），适合作为上游贡献。
