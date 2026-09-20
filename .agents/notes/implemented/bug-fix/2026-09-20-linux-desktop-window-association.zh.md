# Agent Note: Linux desktop entry and window share one identity

Status: implemented

[English](2026-09-20-linux-desktop-window-association.md) | 中文

## 问题

electron-builder 在每次打包时都报告 `desktopName is not set in package.json`。Linux 桌面环境靠匹配窗口的 `WM_CLASS`（X11）／应用 ID（Wayland）与启动项的 `StartupWMClass`，把运行中的窗口关联到已安装的启动项。两边都从 `desktopName` 取这个值，而它没设置时各自回退到不同的字段：electron-builder 用 `productName` 写出 `StartupWMClass=DeepSeek Harness`，Electron 上报 app 名的小写连字符 slug（`deepseek-harness`），安装的启动项则按 `executableName` 命名（`deepseek-harness-desktop.desktop`）。三者两两都不相等，桌面环境可能把运行中的窗口显示成独立的任务栏项，而不是已安装的启动项。

## 决策

`apps/desktop/electron-builder.config.mjs` 设置 `extraMetadata: { desktopName: appId }` 与 `linux.syncDesktopName: true`。该值同时进入 Electron 读取的打包 `package.json` 和 electron-builder Linux 目标读取的元数据，来源就是配置本就要求的 `DSH_DESKTOP_APP_ID`。启动项安装为 `<appId>.desktop`，`StartupWMClass` 与 Electron 的应用 ID 都等于去掉末尾 `.desktop` 后缀的应用 ID——electron-builder 会剥掉该后缀，Electron 也把它记为可选。

安装的启动项由 `deepseek-harness-desktop.desktop` 变为 `<appId>.desktop`。此前固定到 dock 的启动项引用的是旧文件名，需要重新固定一次。

[打包工作流](../../../../.github/workflows/package-deb.yml)的 `Verify artifacts` 步骤断言产出的 `.deb` 带有该启动项，且其 `StartupWMClass` 等于去掉后缀的应用 ID，因此每次发版构建都会检查这个身份。它此前的 `grep -E "icons/hicolor|/\.desktop"` 一个启动项都没列出，因为该模式要求 `.desktop` 前面紧跟一个字面 `/`，而安装的启动项都以 `-<name>.desktop` 结尾。

## 考虑过的替代方案

**把 `desktopName` 设为可执行名并关掉 `syncDesktopName`。** 三个值同样能对齐，且不用重命名已安装的启动项，现有固定项可以保留。但 Electron 把这个值记为应用的反向 DNS 身份并上报给 `xdg-desktop-portal`，后者会拒绝解析不到已安装 `.desktop` 文件的 ID；用可执行名等于用一次性的重新固定，换来一个日后仍要再改的 portal 身份。

**改用 `linux.desktop.entry` 钉住 `StartupWMClass`。** 不碰 `desktopName` 也能让启动项匹配 Electron 的 slug 回退值。但这会把 productName 的 slug 写进构建配置，成为 Electron 运行期派生值的第二份副本，应用 ID 也仍然不是反向 DNS。

**把 `desktopName` 写进 `apps/desktop/package.json`。** 这样不需要 electron-builder 的元数据合并，但把环境提供的标识复制成常量，`DSH_DESKTOP_APP_ID` 被覆盖时会静默保留默认值。

## 影响

运行中的窗口现在携带其启动项声明的身份，桌面环境会把它归到已安装的启动项之下。Electron 上报给 portal 的应用 ID 是反向 DNS。

这是 fork 与上游的差异：上游没有 Linux Desktop 发布目标，其 `apps/desktop/electron-builder.config.mjs` 也没有 `linux` 块。合并时若整体采纳上游配置，这两个字段都会消失，不匹配与告警随之复现。

## 测试

`apps/desktop/tests/package-target.spec.ts` 钉住 `extraMetadata.desktopName` 等于解析出的 `appId`、`linux.syncDesktopName` 为 true，本地通过。生成的启动项及其 `StartupWMClass` 只能在 Linux 构建中检查，打包工作流每次运行都会做。
