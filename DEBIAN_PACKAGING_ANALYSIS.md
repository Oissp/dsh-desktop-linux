# dsh-desktop-linux Debian 打包与官方 macOS/Windows 打包对比分析

> 分析对象：`Oissp/dsh-desktop-linux`（fork，origin）← `deepseek-ai/deepseek-harness`（upstream）
> 分析时点：HEAD = `97f020393b`，desktop 版本 `0.2.0-rc.2.1`，引擎版本 `0.2.0-rc.2`
> 与 upstream/master 关系：**0 commits behind，387 commits ahead**（已完全同步至 `639ed01539`）

---

## 一、总体架构判断

这个 fork 采取的是**「最小侵入、最大复用」**的策略：不重写上游的打包核心，而是用一个裁剪清单（`.github/sync-trimmed-paths.txt`，276 条）移除 macOS/Windows 专有代码，再用一套独立的 Linux 打包入口（`package-target.ts` + `electron-builder.config.mjs` + `package-deb.yml`）替换被裁剪的发版管线。

关键证据：

| 维度 | fork 做法 | 上游对应物 |
|---|---|---|
| electron-builder 配置工厂 | `electron-builder.config.mjs`（Linux-only，无 `mac`/`win` 块） | `scripts/electron-builder-config.mjs`（含 mac/win 块，已裁剪） |
| 打包入口 | `scripts/package-target.ts`（硬编码 `linux-x64`） | `scripts/packaging-run.mjs`（多目标调度，已裁剪） |
| 发版/上传 | `.github/workflows/package-deb.yml`（gh release → GitHub Releases） | `release.yml` + `release-publish.yml` + COS 上传管线（已裁剪） |
| 自动更新源 | GitHub Releases provider（`latest-linux.yml`） | COS + 自建 CDN（`nightly-linux.yml`） |
| 运行时准备 | **直接复用** `scripts/primary-runtime/prepare.ts` | 同一文件 |
| Office 集成 | **直接复用** `smoke-runtime.ts`、`libreoffice-packages.mjs` | 同一组文件 |
| 运行时文件策略 | **直接复用** `runtime-file-policy.ts` | 同一文件 |

**结论：运行时核心（引擎、Office、Python、Node、pnpm、插件管理、Host 启动、原生恢复）与上游完全同源，fork 只在外层打包壳和发版管线上分叉。**

---

## 二、功能一致性分析

### 2.1 ✅ 完全一致的功能

以下功能 fork 与上游**共享同一份源码**，无平台分支：

1. **Electron 运行时模型** — 采用上游 0.1.6-alpha.2 的「Electron 即运行时」重写，Host 在 `ELECTRON_RUN_AS_NODE` 下运行 dsh，不再携带独立 Node 可执行文件（[`2026-09-11-desktop-electron-node-runtime`][electron-runtime] 决策）。
2. **primary-runtime 负载** — Python 3.12、Node 24、pnpm 11.7、numpy/pandas/pillow/lxml wheel。上游已在 `8fad9ccd8c` 中为 `linux-x64` 和 `linux-arm64` 添加了锁文件目标（`scripts/primary-runtime/lock.json`），fork 直接继承。0.1.6-alpha.2 合并时标记为「deferred」的 Linux payload 缺口**已关闭**。
3. **Office 转换** — LibreOffice Kit 引擎选择（`selectOfficeEngine`）、asar 解包模式（`officeAsarUnpackPatterns`）、Office 技能资产（`prepareOfficeSkillAssets`）、Host 冒烟（`smokeDesktopRuntime` 做 DOCX/XLSX/PPTX → PDF）全部复用上游代码。
4. **插件管理** — 共享 Web 插件管理器，bundled pnpm，reserved desktop profile（`.dsh/profiles/desktop`）。
5. **原生恢复** — fatal 启动/渲染/Host 失败的恢复对话框、crash report 写入、第三方插件禁用 + patch 备份。
6. **运行时完整性** — `verifyDesktopRuntime` 做字节级校验，`runtime-tree.ts` 写入 `desktop-runtime.json` 描述符。
7. **单实例锁 + dsh:// 协议** — `app.setAsDefaultProtocolClient('dsh')` 在 Linux 上正常注册（`main.ts:1244`），`open-url` 事件处理与 macOS 一致。
8. **登录 shell 环境读取** — `login-shell-environment.ts`，macOS 和 Linux 共享同一 POSIX 探测逻辑（`<shell> -ilc` + `env -0`），Windows 跳过。
9. **Shell 外观/主题** — `appearance.ts` 读取 `settings.yaml` 的 `ui-theme.preference`，驱动 `nativeTheme.themeSource`，Shell 文档的 `prefers-color-scheme` 跟随引擎设置而非 OS。
10. **更新协调器** — `update-coordinator.ts` 复用上游逻辑，fork 的改动仅是**不设置** `updater.channel`（让版本号的 prerelease 标签自决频道，回落到 `latest-linux.yml`）。

### 2.2 ✅ Linux 专有适配（fork 新增，无上游对应物）

这些是 fork 为 Linux 桌面体验补的功能，上游不存在 Linux release target 所以没有：

| 功能 | 文件 | 说明 |
|---|---|---|
| Linux 系统托盘 | `main.ts:1318-1345` | 上游只为 Windows 建 `DesktopTray`；fork 为 Linux 补了 `Tray`，镜像应用菜单（显示窗口/检查更新/退出），因为打包的 Linux 隐藏顶部菜单栏 |
| 浅色/深色鲸鱼图标切换 | `main.ts:1306-1310` + `appearance.ts` | Linux 打包版根据外观在 `icon-dark/icon-white/tray-dark/tray-white` 间切换窗口与托盘图标 |
| 不透明 prompt 卡片 | `main.ts` + `2026-09-19-linux-shell-prompt-opaque-card` | Linux 无合成器时透明窗口会把 alpha 当不透明绘制，改用居中不透明卡片 |
| StartupWMClass 一致性 | `electron-builder.config.mjs:31` + 验证 | `.desktop` 的 `StartupWMClass` 与窗口 `WM_CLASS` 取同一 appId，避免窗口不被归到启动项 |
| `.desktop` 文件名跟随 desktopName | `electron-builder.config.mjs:88` (`syncDesktopName: true`) | 桌面环境按文件名标识启动项 |
| Linux locale 控制器 | `desktop-locale.ts` | 读取引擎 `locale.preference`，重建托盘菜单 |
| deb 包名/可执行名 | `electron-builder.config.mjs:85,93` | 显式 `executableName`/`packageName` 避免 scoped 包名被 electron-builder 算成非法名 |

### 2.3 ✅ 平台 gating 正确的功能（上游 gate，Linux 走 fallback）

`main.ts` 中的 `process.platform` 分支已确认覆盖 Linux：

- **菜单**：`darwin` 用自定义菜单保留 Window 菜单；`win32` 用 Application/Edit 弹出菜单；**Linux 保留 application 和 Edit 菜单**（`main.ts:103`），打包时 `Menu.setApplicationMenu(null)` + 托盘镜像。
- **全屏**：`darwin || win32` 才转发原生全屏状态（`main.ts:262`），Linux 通过 DOM 处理快捷键。
- **关窗行为**：`darwin` 保留应用生命周期（关最后一个窗口不退出）；`win32` 退出实例；**Linux 与非-darwin 一致**，关最后一个窗口退出（`main.ts:1254`）。
- **目录选择器**：Linux 无 zenity/kdialog 时自动用 browse 模式而非 Electron 对话框（`README.md:11`）。

### 2.4 ⚠️ 有意裁剪、Linux 无对应路径的功能

| 功能 | 裁剪原因 | 影响 |
|---|---|---|
| macOS 签名/公证 | Linux 不需要代码签名 | 无 — Linux 无 Gatekeeper 等价物 |
| Windows EV 签名 | 同上 | 无 |
| COS 上传管线 | fork 用 GitHub Releases 替代 | 无 — 更新源不同但功能等价 |
| installed-update 全套 | 上游为 mac/win 设计的差量更新管线 | AppImage 走 electron-updater 的 blockmap 差量，deb 用户通过 AppImage 或重装更新 |
| 「管理 dsh 命令」(desktop-cli) | `main.ts` 菜单 gate 为 `darwin \|\| win32`，两个启动器是 macOS bundle 脚本和 Windows `.cmd` | **Linux 无 CLI 命令安装功能** — fork 保留了跨平台的 `login-shell-environment.ts`，但 `prepareDesktopCli()` 在 Linux 上无代码路径 |
| macOS entitlements / Windows NSIS installer | 平台专有 | 无 |

### 2.5 ⚠️ 功能缺口与注意事项

1. **「管理 dsh 命令」功能在 Linux 不可用**：上游 0.2.0-rc.2 新增的功能在 `main.ts` 菜单中 gate 为 `darwin || win32`，fork 裁剪了 `apps/desktop/cli/dsh`、`dsh.cmd`、`prepare-cli.ts` 等。这是**合理的裁剪**（Linux 上 `dsh` 命令通常通过 npm 全局安装或 PATH 配置，不需要桌面应用安装），但意味着该菜单项在 Linux 上不出现。裁剪清单注释明确记录了保留跨平台部分的理由。

2. **AppImage 的自动更新限制**：electron-updater 对 AppImage 的差量更新支持有限（不如 macOS ZIP/Windows NSIS 的 blockmap 成熟）。fork 的 `package-deb.yml` 同时产出 deb + AppImage，但自动更新主要面向 AppImage 用户；deb 用户需要手动下载新 deb 重装或改用 AppImage。这是 electron-updater 在 Linux 上的固有限制，非 fork 缺陷。

3. **README 中残留 macOS/Windows 打包指令**：`apps/desktop/README.md` 的 Package/Upload/Updates 章节仍包含 `package:win:x64`、`upload:latest:mac:*`、COS 配置、`nightly-mac.yml` 等上游内容。这是**有意为之**（合并笔记 `2026-09-23-merge-0.1.7-rc.1` 记录：fork 保持 README 与上游字节一致以减少合并冲突，只改了两处 pairing hash），但对 Linux 用户会造成困惑。fork 的实际打包指令（`package:desktop:linux:x64` 等）记录在 `package.json` scripts 和 `package-deb.yml` 中，而非 README。

4. **`runtime-tree.ts:185` 的 JSDoc 注释**提到 "a rewritten one for installed-update qualification"，这是历史残留文本，指向已裁剪的 installed-update 管线。不影响功能，但属于文档不一致。

5. **`desktop-host` 的 `platform-session.ts`** 无 Linux 拒绝逻辑 — Host 本身是平台无关的（`office-engine.ts` 正则已包含 `linux`），Linux 可正常启动。

---

## 三、裁剪合理性评估

### 3.1 裁剪范围（276 条路径）

```
.github/workflows/      20 条（上游 CI/发布 workflow）
apps/desktop/scripts/   ~95 条（mac/win 签名、公证、COS、installed-update、packaging-run）
apps/desktop/tests/     ~85 条（上述脚本的测试与 fixtures）
apps/desktop/installer/  3 条（NSIS uninstall 文件）
.agents/notes/           9 条（installed-update 操作手册与验收记录）
apps/desktop/cli/        3 条（desktop-cli 的 mac/win 启动器）
其他                     ~60 条（entitlements plist、expected JSON、cpp/ps1 fixtures）
```

### 3.2 合理性判断

**✅ 合理的裁剪（无可争议）：**

- **macOS 签名/公证全套**（`notarize-macos*`、`macos-signing-keychain*`、`macos-entitlements.plist`、`verify-macos-signature*`、`sign-primary-runtime.ts`）：Linux 无 Gatekeeper/notarytool 等价物，完全不需要。
- **Windows 签名全套**（`windows-sign*`、`windows-signature-*`、`windows-directory-installer*`、`smoke-windows.ps1`）：同理。
- **COS 上传管线**（`cos-operation.ts`、`desktop-cos.ts`、`desktop-upload-plan.ts`、`upload-target.ts`）：fork 用 GitHub Releases 完全替代，无代码引用这些模块。
- **installed-update 全套**（`installed-update-*.ts` 共 ~15 个文件）：这是上游为 mac/win 设计的「在已安装目录内做差量更新」的管线，Linux 的 deb/AppImage 更新模型完全不同。
- **上游 CI workflows**（`ci.yml`、`ci-master.yml`、`e2e.yml`、`release.yml` 等 20 个）：fork 只运行自己的 `package-deb.yml` + `package-deb-test.yml`，无法承载上游的 macOS/Windows 签名、Python SDK、Cloudflare 预览等流程。

**✅ 合理但需注意的裁剪：**

- **`electron-builder-config.mjs`（上游工厂）+ `.d.mts`**：fork 用自己的 `electron-builder.config.mjs` 替代。合并笔记 `2026-09-28-merge-0.2.0-rc.1` 记录了上游给 `.d.mts` 加 `mac` 块时的冲突处理（保持 fork 侧不携带 mac 块）。这是正确的——声明一个工厂永不产出的字段会误导接口。
- **`koffi` devDependency**：上游 0.2.0-rc.1 给 `apps/desktop` 加了 `koffi@3.1.1`，唯一消费者是 Windows 签名脚本。fork 裁剪了签名脚本所以不需要。合并笔记记录了 `runtime-payload-smoke.mjs` 仍引用 koffi，但它运行在打包运行时内（koffi 来自 bundled profile 而非此 manifest），所以不影响。
- **`apps/desktop/tests/README.md` 及其 zh/i18n**：描述已裁剪的 installed-update 流程，整组裁剪正确。Desktop README 的两个链接指向它们保持为「declared trimmed」状态。

**✅ 例外保留（合理）：**

- **`primary-runtime-lock.json`**：保留，因为 `gen-third-party-notices.ts` 直接读取它生成 THIRD_PARTY_NOTICES.md。forking 该生成器会造成每次合并冲突。过度披露（fork 不 bundle darwin/win 目标）是无害方向。合并笔记 `2026-09-18-merge-0.1.6-alpha.2` 明确记录了这个决策。

**⚠️ 唯一值得讨论的点：**

- **desktop-cli 功能的裁剪**：fork 裁剪了 `apps/desktop/cli/dsh`、`dsh.cmd`、`link-entry.c`、`prepare-cli.ts`、`command-installation.ts` 等，但**保留了** `login-shell-environment.ts` 和 `duration-env.ts`（POSIX 登录 shell 读取，Linux 同样适用）。这个拆分是精确的——裁剪的是 mac/win 专有启动器，保留的是跨平台基础。但用户在 Linux 上不会看到「管理 dsh 命令」菜单项。如果未来希望 Linux 也有此功能，需要新增一个 Linux 启动器（如 symlink 到 `/usr/local/bin`），目前上游没有这个路径。

### 3.3 裁剪清单的维护质量

裁剪清单设计得很好：

1. **每条都有注释说明裁剪原因**（中文，解释为什么 fork 不需要这个文件）。
2. **按上游版本分组**（`0.1.6-alpha.2 新增`、`0.1.7-alpha.1 合并新增`、`0.2.0-rc.2 合并新增`），便于追踪每次合并新裁剪了什么。
3. **`verify-md-links-trimmed.ts` 读取该清单**，豁免指向被裁剪文件的相对链接，避免 markdown 链接检查误报。
4. **`scripts/verify-md-links-trimmed.ts`** 是 fork 新增的，专门处理裁剪后的链接验证。

---

## 四、CI/发版管线对比

### 4.1 fork 的两个 workflow

| workflow | 触发 | 产物 | 发布 |
|---|---|---|---|
| `package-deb.yml` | push 到 main（`package.json` 或 `apps/desktop/**` 变更）+ 手动 | deb + AppImage + `latest-linux.yml` | ✅ 发到 `Oissp/dsh-desktop-linux-release` |
| `package-deb-test.yml` | PR 到 main + push（引擎源码路径）+ 手动 | 仅 deb | ❌ 不发布 |

**设计亮点：**

1. **引擎缓存共享**：两个 workflow 共用 `.github/actions/prepare-desktop-engine` composite action，缓存 key 用 `git ls-files` 哈希已跟踪源码（排除 `apps/desktop/package.json`，因为纯 `.N` 版本 bump 不变引擎产物）。命中时用 `--builder-only` 跳过引擎准备。
2. **触发路径互补不重叠**：`package-deb.yml` 监听 `package.json` + `apps/desktop/**`（壳改动）；`package-deb-test.yml` 监听引擎源码路径。避免同一次 push 双 workflow 并行各建一遍引擎。
3. **幂等发布**：release 仓库中 `v<version>` 已存在则跳过。
4. **并发控制**：`package-deb.yml` 用 `cancel-in-progress: false`（不取消进行中的，避免残缺产物）；`package-deb-test.yml` 用 `cancel-in-progress: true`（冒烟无保留价值）。
5. **产物验证全面**：检查 deb/AppImage/latest-linux.yml 存在、app-update.yml 指向正确仓库且无 token 泄漏、StartupWMClass 一致性、图标四件套、`.desktop` 启动项。
6. **固定 ubuntu-24.04**：注释说明 ubuntu-latest 将于 2026-10-19 迁移到 Ubuntu 26，先在受控版本验证再手动跟进。
7. **libasound2t64 兼容**：Ubuntu 24.04 改名处理。

### 4.2 与上游发版的对比

| 维度 | fork (Linux) | 上游 (mac/win) |
|---|---|---|
| 签名 | 无 | macOS Developer ID + notarization；Windows EV token |
| 更新源 | GitHub Releases (`latest-linux.yml`) | COS + CDN (`nightly-*.yml`) |
| 更新机制 | electron-updater blockmap | electron-updater blockmap + installed-update 差量管线 |
| 版本号 | 跟随引擎（可带 `.N` 后缀） | 同 |
| 测试门槛 | `vitest run apps/desktop/tests`（746 tests） | 同 + mac/win 签名相关测试 |
| 冒烟 | `smokeDesktopRuntime`（DOCX/XLSX/PPTX → PDF） | 同 + Windows NSIS 目录替换测试 |

**fork 的发版管线在功能上与上游等价**，只是更新源和签名链路不同（Linux 不需要签名）。

---

## 五、上游合并流程分析与优化建议

### 5.1 当前合并流程（基于 5 份合并笔记）

fork 已完成 5 次上游合并，每次都有详细的决策记录：

```
2026-09-18  0.1.6-alpha.2  ← 首次大重写（Electron 即运行时），建立裁剪基线
2026-09-23  0.1.7-rc.1     ← 开发目标显式化冲突
2026-09-25  0.1.7-rc.2     ←
2026-09-28  0.2.0-rc.1     ← koffi/mac 块/trim-list modify-delete 冲突
2026-09-29  0.2.0-rc.2     ← desktop-cli 功能裁剪
```

**当前流程的优点：**

1. **裁剪清单是合并的核心工具**：清单内路径的冲突自动以 fork 侧为准，清单外冲突才需要人工决策。这把大部分重复性冲突变成了机械操作。
2. **每次合并都有 Agent Note**：记录了哪些冲突需要决策、为什么这么决策、考虑过什么替代方案、后果是什么。这避免了下次合并重新争论。
3. **合并后验证明确**：每份笔记记录了 `typecheck`、`lint`、`test:docs`、`vitest run apps/desktop/tests` 的结果。
4. **版本号跟随引擎**：desktop 版本 = 引擎版本（可带 `.N` 后缀），`shellVersionExtendsEngine` 在打包时校验。

**当前流程的痛点（从合并笔记推断）：**

1. **裁剪清单只跟踪「删除的文件」，不跟踪「修改的行为」**。笔记 `2026-09-23-merge-0.1.7-rc.1` 明确指出：`desktop-build-paths.mjs`、`development-project.ts`、`dev.ts`、README pair 等文件被 fork **修改**（非删除），这些修改不在裁剪清单内，每次上游重构这些文件就会冲突，需要人工重新应用 linux 映射。
2. **paired document 的合并时冲突**：`README.i18n.yaml` 的合并驱动器在合并时会看到上游仍有的 `tests/README.zh.md`，要求 zh README 链接到上游形式，但 fork 故意改成了 authored path。笔记说这需要每次手动 re-record pairing hash。
3. **裁剪清单内被上游「重新带回或新增」的文件**：清单注释说明，上游恢复或新增这些文件时合并不冲突（直接进入 fork 代码树），**必须在合并提交前手动删除**。这是一个容易遗漏的手动步骤。
4. **`.d.mts` 类型声明文件的冲突**：上游给 `electron-builder-config.d.mts` 加 `mac` 块时，fork 的 `.d.mts` 不携带 mac 块，产生冲突。笔记 `2026-09-28` 记录了这个决策。

### 5.2 优化建议

#### 建议 1：将「行为修改」也纳入可追踪的合并基线

**问题**：裁剪清单只管删除的文件，`desktop-build-paths.mjs`（`SUPPORTED_TARGETS = new Set(['linux-x64'])`）、`package-target.ts`（`DesktopPackageTargetName = 'linux-x64'`）、`desktop-linux-formats.mjs`、`electron-builder.config.mjs` 等 fork 修改的文件不在清单内，每次上游改动就冲突。

**方案**：新增一个 `.github/sync-forked-paths.txt`（或扩展现有清单加一个 `[modified]` 段），列出 fork 有意修改（非删除）的文件，并附一行说明 fork 的改动性质。合并时：
- 清单内 modified 文件的冲突 → 检查 fork 的改动是否仍需要（上游可能已修复或重构），需要则重新应用 fork 改动
- 这不能自动化（需要判断上游改动是否兼容），但能让合并者快速定位哪些冲突是「已知的 fork 决策」而非「新问题」

**优先级**：中 — 当前靠合并笔记记录这些文件名，但笔记是叙述性的，不如清单可机器读取。

#### 建议 2：合并后自动验证裁剪清单的完整性

**问题**：清单注释说「合并完成后删除清单内被上游重新带回或新增的文件」是手动步骤，容易遗漏。如果遗漏，被裁剪的 mac/win 脚本会进入 fork 代码树，`vitest run apps/desktop/tests` 会带入它们的 spec 导致失败——但这只在 CI 才发现。

**方案**：在 `package-deb-test.yml` 的 checkout 后、测试前，加一步：
```bash
# 验证裁剪清单内的文件不存在于工作树
while IFS= read -r line; do
  [ -z "$line" ] && continue
  case "$line" in \#*) continue ;; esac
  if [ -e "$line" ]; then
    echo "::error::裁剪清单内的文件仍存在: $line（合并后未删除）"
    exit 1
  fi
done < .github/sync-trimmed-paths.txt
```

**优先级**：高 — 这是防遗漏的最直接手段，成本低、收益大。

#### 建议 3：pairing hash 的合并后 re-record 自动化

**问题**：每次上游编辑 paired document（如 README），fork 侧的 pairing hash 就不匹配，合并驱动器报冲突，需要手动 `pnpm run verify-translation-pairing --write <file>` re-record。笔记 `2026-09-23` 说这「是较小的、可逆的成本」，但每个涉及 paired doc 的合并都要做。

**方案**：在合并完成后的验证步骤中，自动运行 `pnpm run verify-translation-pairing --write` 修复所有 pairing hash，然后检查 git diff 是否**只有** `.i18n.yaml` 文件变动（如果有非 pairing 文件变动则报错）。这样把 re-record 从手动变成自动。

**优先级**：中 — 频率不高但每次都要记得做。

#### 建议 4：合并运行清单（runbook）

**问题**：当前合并流程分散在 5 份 Agent Note 中，新合并者需要读完所有笔记才能上手。

**方案**：在 `.github/` 或 `docs/` 下新增一个 `MERGE_UPSTREAM.md`（或中文 `合并上游指南.md`），固化步骤：

```
1. git fetch upstream
2. git merge upstream/master（或特定 tag）
3. 冲突处理：
   a. 裁剪清单内路径 → 以 fork 侧为准（git checkout --ours）
   b. 裁剪清单内被上游新增的文件 → 合并后删除
   c. fork 修改的文件（见 sync-forked-paths.txt）→ 重新应用 fork 改动
   d. paired document → 合并后 re-record pairing hash
4. 合并后验证：
   a. 运行裁剪清单完整性检查（建议 2）
   b. pnpm run verify-translation-pairing --write（建议 3）
   c. pnpm run typecheck && pnpm run lint && pnpm run test:docs
   d. pnpm exec vitest run apps/desktop/tests
5. 写合并 Agent Note（记录冲突决策）
6. bump apps/desktop/package.json 版本（跟随引擎 + .N 后缀）
```

**优先级**：高 — 降低合并门槛，减少遗漏。

#### 建议 5：考虑将 fork 的 Linux 适配贡献回上游

**问题**：fork 的 Linux 托盘、外观图标切换、不透明 prompt 卡片、StartupWMClass 一致性等适配都是**通用 Linux 桌面需求**，上游虽然声明「Linux has no supported release target」但代码中已有大量 `process.platform === 'linux'` 分支。

**方案**：评估将以下改动以 PR 形式贡献回上游：
- `appearance.ts`、`desktop-locale.ts`（纯增量，无冲突风险）
- `main.ts` 中的 Linux 托盘块（gate 为 `app.isPackaged && process.platform === 'linux'`，不影响 mac/win）
- `electron-builder.config.mjs` 的 Linux target（上游已有 `electron-builder.config.mjs` 工厂，可加 `linux` 分支）
- `desktop-linux-formats.mjs`（纯增量）

**收益**：减少 fork 维护成本，让上游 CI 覆盖 Linux，合并时不再需要重新应用这些改动。

**优先级**：低（长期）— 取决于上游是否接受 Linux 作为支持平台。当前的 fork-first 策略已经能工作，但如果上游接受，能显著降低长期维护成本。

#### 建议 6：README 的 Linux 打包文档

**问题**：`apps/desktop/README.md` 的 Package 章节仍显示 `package:win:x64`、COS 上传、`nightly-mac.yml` 等上游内容，Linux 用户找不到自己的打包指令。

**方案**：在 README 的 Package 章节顶部加一个 Linux 专有小节，指向 `package-deb.yml` 和 `package.json` scripts 中的 `package:desktop:linux:x64` 命令。由于 fork 保持 README 与上游字节一致以减少合并冲突，可以用一个**独立文件**（如 `apps/desktop/LINUX_PACKAGING.md`）承载 Linux 专有文档，避免修改 README 本身。

**优先级**：中 — 改善 Linux 用户体验，且不增加合并摩擦。

---

## 六、总结

### 整体评价

这个 fork 是一个**工程质量很高的 Linux 适配**，不是简单的「删掉 mac/win 代码」。它的核心策略——用裁剪清单管理删除、用独立入口替换发版管线、复用上游运行时核心——在 5 次合并中证明了有效性（0 commits behind upstream，每次合并的冲突都有记录和决策）。

### 功能一致性

- **运行时核心**（引擎、Office、Python、Node、插件管理、Host、原生恢复）：**完全一致**，共享上游源码。
- **桌面 shell**：**一致 + Linux 专有增强**（托盘、外观图标、不透明 prompt、WM_CLASS 一致性）。
- **打包/发版**：**功能等价但路径不同**（GitHub Releases 替代 COS，无签名替代签名）。
- **缺口**：desktop-cli 命令安装功能在 Linux 不可用（合理裁剪）；README 残留 mac/win 打包指令（有意为之但有用户困惑风险）。

### 裁剪合理性

- **276 条裁剪路径，全部合理**：mac/win 签名/公证/COS/installed-update 管线在 Linux 确实不需要。
- **例外保留 `primary-runtime-lock.json`** 的决策有充分理由（避免 forking 生成器）。
- **裁剪清单维护质量高**：有注释、按版本分组、有 `verify-md-links-trimmed.ts` 配套。

### 合并流程

- **当前流程已相当成熟**：裁剪清单 + Agent Note + 明确的验证步骤。
- **主要优化空间**：(1) 裁剪清单完整性自动验证；(2) 行为修改的可追踪基线；(3) pairing hash 自动 re-record；(4) 合并 runbook 文档化；(5) 长期考虑贡献回上游。
