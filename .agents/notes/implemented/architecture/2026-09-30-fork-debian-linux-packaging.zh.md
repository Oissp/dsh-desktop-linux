# Agent Note: Fork Debian Linux packaging

Status: implemented

[English](2026-09-30-fork-debian-linux-packaging.md) | 中文

> 分析对象：`Oissp/dsh-desktop-linux`（fork，origin）← `deepseek-ai/deepseek-harness`（upstream）。分析时点：desktop 版本 `0.2.0-rc.2.2`，引擎版本 `0.2.0-rc.2`，已完全同步至上游 `0.2.0-rc.2` 发布线。

## Problem

这个 fork 需要为 `deepseek-harness`（上游只声明 macOS/Windows 为支持平台，无可执行的 Linux release target）提供一条 Linux 桌面打包与发版管线。上游 0.2.0-rc 的打包壳与发版管线（macOS 签名/公证、Windows EV 签名、COS 上传、installed-update 差量更新）是 macOS/Windows 专有的，直接保留会让 Linux 构建产生大量死代码与不合法的打包配置（如 `mac`/`win` 块）。需要在不重写运行时核心的前提下，用最小侵入的方式在 fork 侧分叉打包层。

## Decision

fork 采取「最小侵入、最大复用」策略：不重写上游打包核心，而是用一个裁剪清单（`.github/sync-trimmed-paths.txt`）移除 macOS/Windows 专有代码，再用一套独立的 Linux 打包入口（`package-target.ts` + `electron-builder.config.mjs` + `package-deb.yml`）替换被裁剪的发版管线。运行时核心（引擎、Office、Python、Node、pnpm、插件管理、Host 启动、原生恢复）与上游完全同源。

关键对应：

| 维度 | fork 做法 | 上游对应物 |
|---|---|---|
| electron-builder 配置工厂 | `electron-builder.config.mjs`（Linux-only，无 `mac`/`win` 块） | `scripts/electron-builder-config.mjs`（含 mac/win 块，已裁剪） |
| 打包入口 | `scripts/package-target.ts`（硬编码 `linux-x64`） | `scripts/packaging-run.mjs`（多目标调度，已裁剪） |
| 发版/上传 | `.github/workflows/package-deb.yml`（gh release → GitHub Releases） | `release.yml` + `release-publish.yml` + COS 上传管线（已裁剪） |
| 自动更新源 | GitHub Releases provider（`latest-linux.yml`） | COS + 自建 CDN（`nightly-linux.yml`） |
| 运行时准备 | **直接复用** `scripts/primary-runtime/prepare.ts` | 同一文件 |
| Office 集成 | **直接复用** `smoke-runtime.ts`、`libreoffice-packages.mjs` | 同一组文件 |
| 运行时文件策略 | **直接复用** `runtime-file-policy.ts` | 同一文件 |

### 功能一致性

- **运行时核心**（引擎、Office、Python、Node、插件管理、Host、原生恢复）：**完全一致**，共享上游源码。
- **桌面 shell**：一致 + Linux 专有增强（托盘、外观图标切换、不透明 prompt 卡片、StartupWMClass 一致性、桌面 locale 控制器）。
- **打包/发版**：功能等价但路径不同（GitHub Releases 替代 COS，无签名替代签名）。
- **「管理 dsh 命令」(desktop-cli)**：上游 0.2.0-rc.2 的功能原本在 fork 裁剪，后已同步到 Linux（`pkexec` 提权、Linux 启动器、托盘菜单项）。

## 裁剪合理性

267 条裁剪路径全部基于「Linux 无等价物」：macOS 签名/公证、Windows EV 签名、COS 上传管线、installed-update 差量更新、上游 CI workflows 等。`primary-runtime-lock.json` 例外保留（`gen-third-party-notices.ts` 直接读取它，避免 forking 生成器）。

desktop-cli 相关文件最初在 0.2.0-rc.2 合并时被裁剪（mac/win 启动器是专有的），但保留了跨平台的 `login-shell-environment.ts`；随后恢复并适配到 Linux。

## CI/发版管线

- `package-deb.yml`：push 到 main（壳改动）+ 手动，产出 deb + AppImage + `latest-linux.yml`，发布到 `Oissp/dsh-desktop-linux-release`。
- `package-deb-test.yml`：PR 到 main + 引擎源码路径，仅产出 deb，不发布。
- 引擎缓存共享（`prepare-desktop-engine` composite action）、触发路径互补、幂等发布、并发控制、产物验证全面。

fork 发版管线在功能上与上游等价；更新源与签名链路不同（Linux 无需签名）。

## 上游合并流程

fork 已完成多次上游合并（0.1.6-alpha.2 / 0.1.7-rc.1 / 0.1.7-rc.2 / 0.2.0-rc.1 / 0.2.0-rc.2），裁剪清单是合并核心工具，每次合并都有 Agent Note 记录冲突决策。

优化方向：裁剪清单完整性自动验证（`package-deb-test.yml` 中校验清单内文件不存在）、行为修改的可追踪基线（`sync-forked-paths.txt`）、pairing hash 自动 re-record。合并运行清单位于 `.github/MERGE_UPSTREAM.md`，Linux 打包指南位于 `apps/desktop/LINUX_PACKAGING.md`。

## Alternatives considered

**重写打包核心（不用裁剪清单）。** 拒绝：会造成与上游的持续合并冲突（每个上游重构都需重新应用 fork 侧逻辑），且浪费已有运行时核心的同源保证。裁剪清单 + 独立 Linux 入口把重复冲突变成机械操作。

**为上游 mac/win 打包壳加 Linux 分支并贡献回上游。** 拒绝（长期可选）：上游声明「Linux has no supported release target」，短期无法合并；fork-first 策略已能工作。未来若上游接受 Linux 可作为上游 PR 基础。

**不维护 README 的 Linux 打包指令而是直接改 README。** 拒绝：fork 保持 `apps/desktop/README.md` 与上游字节一致以减少合并冲突，Linux 打包指令记录在 `package.json` scripts 与 `package-deb.yml` 中。

## Consequences

- **买到的**：与上游低成本合并；Linux 用户获得功能等价的打包/发版/更新管线；运行时核心零分叉。
- **付出的**：fork 侧维护一套独立打包壳与发版管线；每次上游重构 `desktop-build-paths.mjs`、`electron-builder.config.mjs`、`package-target.ts` 等 fork 修改文件时产生冲突需人工重新应用；README 残留 mac/win 打包指令可能困惑 Linux 用户（有意为之）。
- **限制**：deb 用户通过重装或改用 AppImage 更新（electron-updater 对 AppImage 差量支持有限）；desktop-cli 命令管理仅对 deb 安装可靠（AppImage 挂载点路径不稳定），`isInstalledLocation` 在 Linux 上恒为 true。

## Testing

`pnpm run test:docs`（含 `verify-agent-note-format`）、`pnpm run doc-sync`、`pnpm run lint`、`git diff --check`。desktop 打包/发版相关验证由 `package-deb-test.yml` 覆盖。
