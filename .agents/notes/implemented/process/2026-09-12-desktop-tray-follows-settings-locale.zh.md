# Agent Note: 桌面托盘跟随引擎的语言偏好

Status: implemented

[English](2026-09-12-desktop-tray-follows-settings-locale.md) | 中文

## 问题

托盘菜单——包括 Desktop Plugins 子菜单——在 `apps/desktop/src/locale.ts` 里已经带了完整的中英文词典，但外壳的语言一直取自 Electron 的系统语言（`app.getLocale()`）。用户在 通用设置 → Language 选了中文、而系统跑在英文环境下时，托盘仍然是英文；引擎侧设置（`<harness home>/settings.yaml` 里的 `locale.preference`，由 web 引擎的 LocaleRuntime 写入）被外壳完全忽略。

## 决策

**读取引擎持久化的偏好。** 新的 `DesktopLocaleController`（`apps/desktop/src/desktop-locale.ts`）在启动时读取 `settings.yaml` 的 `locale.preference`，用 `resolveDesktopLocale(preference ?? systemLocale)` 解析词典、应用，并监视文档以跟随实时变更。没有显式选择时退回系统语言，与改动前的行为一致。

**抽取共享的 settings 监视器。** `DesktopAppearanceController` 原本用的父目录监视机制（150 ms 防抖、home 目录缺失时 2 s 重挂、监视父目录以覆盖建/替换/删）原样抽进 `DesktopSettingsWatcher`（`settings-watcher.ts`）。外观与语言两个控制器现在共用它，行为不变。

**语言变更时重建托盘。** `main.ts` 持有一对可变 `locale`/`messages` 与一个 `rebuildTrayMenu()` 闭包。控制器的 apply 回调切换这对值、按当前词典重建托盘右键菜单，并重设插件窗口标题。`quit` 角色项带上显式 `messages.quitMenu` 标签——否则 Electron 会用自己内置的本地化标签覆盖词典。

**读失败保留当前语言。** 引擎写入窗口期间的一次读失败不被当作「偏好被清成默认」：控制器保留已应用的语言，与外观控制器既有的读失败语义一致。

## 备选方案

**启动时从 `app.getLocale()` 解析一次。** 不采用：目的是跟随设置的选择，而它可能在运行中改变；没有监视器的话托盘会一直停留在启动时的语言直到重启。

**由渲染进程通过 IPC 推送偏好。** 不采用：外观控制器已经在读同一份持久化文档，语言控制器也照做——单一事实来源，而不是多一条带顺序问题的写入路径。

## 后果

托盘菜单、它的退出标签以及插件窗口标题现在实时跟随 通用设置 → Language，在用户做出显式选择前退回系统语言。测试覆盖了存储偏好读取、系统语言回退、读失败保留已应用语言、以及文档变更后的实时切换。`DesktopSettingsWatcher` 的抽取让两个控制器共用一份监视实现。
