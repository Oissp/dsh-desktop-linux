# Linux 打包指南 (Debian deb + AppImage)

> 本文档独立记录 dsh-desktop-linux fork 的 Linux 打包流程。
> `apps/desktop/README.md` 的 Package 章节保留上游 macOS/Windows 内容以减少合并冲突；
> Linux 专有指令在此文档中维护。

## 概述

fork 在 Linux x64 上构建两种产物：

| 产物 | 用途 | 更新方式 |
|---|---|---|
| `.deb` | Ubuntu / Debian 系统安装包 | 手动下载重装 |
| `.AppImage` | 免安装可执行文件 | electron-updater 自动更新（blockmap 差量） |

自动更新源是独立发布仓库 [Oissp/dsh-desktop-linux-release](https://github.com/Oissp/dsh-desktop-linux-release) 的 GitHub Releases，频道元数据为 `latest-linux.yml`。

## 打包命令

### 完整打包（deb + AppImage）

```sh
# 从仓库根目录
pnpm run package:desktop:linux:x64
```

此命令依次执行：
1. `build:official` — 构建引擎源码
2. `release:pack` — 打包 dsh 和 vendor
3. `prepare:runtime` — 下载 Electron、Node、pnpm、Python 运行时
4. `prepare:packages` — 准备核心包集合
5. `prepare:dsh` — 物化生产运行时（含 Office 引擎、原生模块、冒烟测试）
6. `electron-builder` — 打包 deb + AppImage

### 仅准备（不打包）

```sh
pnpm run prepare:desktop:linux:x64
```

### 仅 builder（跳过引擎准备，用于缓存命中）

```sh
pnpm run package:desktop:linux:x64:builder
```

此模式跳过步骤 1-5，直接运行 electron-builder。要求引擎产物已缓存。`package-target.ts` 会断言所需输入存在。

### 仅目录（不生成安装包）

```sh
pnpm run package:desktop:linux:x64:dir
```

生成 `linux-unpacked/` 目录，用于验证 Electron RunAsNode、bundled pnpm、bundled dsh 资源、插件安装和修复路径。

### 选择产物格式

```sh
# 仅 deb（不构建 AppImage）
DSH_DESKTOP_LINUX_FORMATS=deb pnpm run package:desktop:linux:x64:builder

# 仅 AppImage
DSH_DESKTOP_LINUX_FORMATS=AppImage pnpm run package:desktop:linux:x64:builder
```

`DSH_DESKTOP_LINUX_FORMATS` 环境变量控制格式（逗号分隔），缺省构建全部。未知格式 fail loud。

## 版本号

桌面版本跟随内置 dsh 引擎版本，记录在 `apps/desktop/package.json`：

| 引擎版本 | 桌面版本 | 说明 |
|---|---|---|
| `0.2.0-rc.2` | `0.2.0-rc.2` | 纯引擎同步 |
| `0.2.0-rc.2` | `0.2.0-rc.2.1` | 壳代码有改动（`.N` 构建后缀） |

`shellVersionExtendsEngine` 在打包时校验桌面版本必须扩展引擎版本。

## CI 自动发版

### 发版 workflow: `package-deb.yml`

- **触发**：push 到 `main` 且 `package.json` 或 `apps/desktop/**` 变更
- **产物**：deb + AppImage + `latest-linux.yml`
- **发布**：发到 `Oissp/dsh-desktop-linux-release` 的 `v<version>` Release
- **幂等**：release 已存在则跳过
- **引擎缓存**：`git ls-files` 哈希已跟踪源码作为 key，命中时跳过引擎准备

### 冒烟 workflow: `package-deb-test.yml`

- **触发**：PR 到 `main` + push（引擎源码路径）+ 手动
- **产物**：仅 deb
- **不发布**

两个 workflow 共用 `.github/actions/prepare-desktop-engine` composite action，共享引擎缓存。

## 产物验证

`package-deb.yml` 在发版前验证：

- `.deb` 和 `.AppImage` 文件存在
- `latest-linux.yml` 自动更新频道元数据存在
- `app-update.yml` 指向 `Oissp/dsh-desktop-linux-release` 且 `provider: github`
- `app-update.yml` 不含 GitHub token
- 运行时图标四件套存在（`icon-dark/tray-dark/icon-white/tray-white`）
- `.desktop` 启动项的 `StartupWMClass` 与窗口 `WM_CLASS` 一致
- 裁剪清单完整性（mac/win 专有文件不进入 fork 代码树）

## 运行时内容

打包的应用包含：

```
deepseek-harness-desktop/
  usr/
    bin/deepseek-harness-desktop          # Electron 可执行文件
    share/applications/com.deepseek.harness.desktop.desktop  # .desktop 启动项
    share/icons/hicolor/*/apps/           # 多尺寸图标
  resources/
    app.asar                              # Electron 应用包
      lib/                                # Shell 主进程
      renderer/                           # Web UI
      dsh/                                # 内置 dsh 引擎
        node_modules/                     # 生产依赖
        desktop-runtime.json              # 运行时描述符
    app.asar.unpacked/                    # 原生模块（.node/.so）
      dsh/node_modules/@deepseek-ai/libreoffice-kit-linux-x64/  # Office 引擎
    runtime/
      primary-runtime/                    # Python + Node + pnpm
        dependencies/
          node/bin/node                   # 独立 Node 可执行文件
          python/                         # CPython 3.12 + numpy/pandas/pillow/lxml
        runtime.json                      # 运行时清单
      pnpm/                               # pnpm CLI
      bin/node                            # Node bin 目录入口
      office-skills/                      # Office 技能资产
      cli/
        bin/dsh                           # dsh CLI 启动器（「管理 dsh 命令」的 symlink 目标）
        command-manager.js                # 命令管理 worker（自包含 bundle）
    icon.png, icon-dark.png, ...          # 运行期图标
```

## 内置 dsh CLI（管理 dsh 命令）

Desktop 打包内含一个由内置引擎驱动的 `dsh` CLI。用户可从托盘菜单「管理 dsh 命令」安装它：在 `/usr/local/bin` 创建一个指向 `runtime/cli/bin/dsh` 启动器的 symlink，终端即可直接运行 `dsh`，无需维护另一个 npm 安装。

要点：

- **命令管理 worker**：`runtime/cli/command-manager.js` 是 `command-manager-entry.ts` 打出的**自包含** bundle（`codeSplitting: false`，只依赖 Node 内建模块），因为它是 `prepare-runtime.ts` 复制的单一文件，用打包运行时自带的裸 Node 运行。
- **提权**：写入 `/usr/local/bin` 需要 root，通过 `pkexec --disable-internal-agent` 提权（PolicyKit 弹窗）；取消映射为 `ECANCELED`，不弹错误对话框。
- **仅 deb 可靠**：AppImage 挂载点路径每次运行可能不同，symlink 指向其内部路径不可靠；AppImage 用户应使用 deb 安装包。
- 该功能的决策记录见 [desktop-cli Linux 同步](../.agents/notes/implemented/feature/2026-09-30-desktop-cli-linux-sync.md)（Linux 适配）及其历史方案 [desktop-cli-linux-sync-plan](../.agents/notes/archived/feature/2026-09-30-desktop-cli-linux-sync-plan.md)。

## 应用 ID

默认 `com.deepseek.harness.desktop`，可通过 `DSH_DESKTOP_APP_ID` secret 覆盖。

`.desktop` 文件名、`StartupWMClass`、窗口 `WM_CLASS` 都使用同一个 appId（去掉 `.desktop` 后缀），确保桌面环境能正确将运行中的窗口归到启动项下。

## 本地构建依赖

Ubuntu 24.04 上的构建依赖（CI 自动安装）：

```sh
sudo apt-get install -y --no-install-recommends \
  python3 make g++ fakeroot xz-utils file \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libpango-1.0-0 libcairo2 libgtk-3-0 \
  xvfb xauth
# Ubuntu 24.04 将 libasound2 改名为 libasound2t64
sudo apt-get install -y --no-install-recommends libasound2t64 || \
sudo apt-get install -y --no-install-recommends libasound2
```

## 与上游 macOS/Windows 打包的差异

| 维度 | fork (Linux) | 上游 (macOS/Windows) |
|---|---|---|
| 产物格式 | deb + AppImage | DMG + ZIP (macOS) / NSIS EXE (Windows) |
| 代码签名 | 无 | macOS Developer ID + notarization；Windows EV token |
| 更新源 | GitHub Releases | COS + CDN |
| 更新频道 | `latest-linux.yml` | `nightly-mac.yml` / `nightly-linux.yml` |
| electron-builder 配置 | `electron-builder.config.mjs`（Linux-only） | `scripts/electron-builder-config.mjs`（多目标工厂） |
| 打包入口 | `scripts/package-target.ts` | `scripts/packaging-run.mjs` |
| 发版 CI | `package-deb.yml` | `release.yml` + `release-publish.yml` |

运行时核心（引擎、Office、Python、Node、pnpm、插件管理、Host 启动、原生恢复）与上游**完全同源**，fork 只在外层打包壳和发版管线上分叉。
