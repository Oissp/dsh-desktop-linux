# Agent Note: 桌面更新安装——暴露安装失败并恢复会话

Status: implemented

[English](2026-09-12-desktop-update-install-failure-surfaced.md) | 中文

## 问题

从 `0.1.5-rc.2.1` 升到 `0.1.5-rc.2.2` 时，用户报告下载+校验完成后，应用既没有安装也没有重启——静默失败。

流程：`checkAndPrompt` → `install()` → `doInstall()` 下载并校验 .deb 后，调用 `beforeRestart()` 与 `updater.quitAndInstall(false, true)`。electron-updater 的 `DebUpdater.doInstall` 用 `dpkg -i <deb>` 在 `pkexec`（带 `--disable-internal-agent`，需要外部 polkit agent）或 `sudo` 下同步执行。任何失败——没有认证 agent、sudo 无 tty 且无免密、dpkg/apt 报错——`BaseUpdater.install()` 捕获后 dispatch 一个 `error` 事件、返回 `false`，`quitAndInstall` 跳过退出/重启。协调器在调用 `quitAndInstall` *之前*就发布 `phase: 'ready'` 并无条件返回，也从不监听更新器的 `error` 事件——于是失败完全不可见：没有安装、没有重启、不报错，重试还会因 `availableVersion` 在下载后被清空而抛「没有已验证的可用更新」。启动时的自动检查同样吞掉失败，因为 `checkAndPrompt` 只在手动检查时才弹安装失败对话框。

## 决策

**暴露安装失败。** `doInstall()` 现在把 `quitAndInstall` 放进 `quitForInstall`：调用前注册一个临时 `error` 监听，调用后移除。electron-updater 在安装步骤抛错时会从 `quitAndInstall` 同步 dispatch `error`，监听器捕获失败，协调器发布带真实消息的 `phase: 'error'` 而不是假的 `ready`。成功（无错误）时，`ready` 只在调用返回后发布——进程在稍后的轮次退出，此时 `ready` 才成立。

**恢复运行中的会话。** `beforeRestart`（设置 `shellInstallerOwnsQuit` 并停止后端）现在返回一个撤销函数；安装失败时协调器执行它，重置 `shellInstallerOwnsQuit` 并通过 `reconcileBackend` 重启后端，当前会话继续可用，而不是变成一个后端已停的僵尸应用。

**自动检查失败也要响。** `checkAndPrompt` 无论 `manual` 与否都弹安装失败对话框——用户明确点了「安装并重启」，即使来自启动 10 秒后的自动检查，失败也必须可见。

## 备选方案

**在更新器上常驻监听 `error`。** 不采用：`checkForUpdates` 与 `downloadUpdate` 既 reject promise 又 emit `error`，常驻监听会重复上报这些失败。临时监听只覆盖唯一没有其他错误通道的那一次调用。

**释放单实例锁 / 手动重启。** 追踪 `app.relaunch()` 后不采用：Electron 把重新拉起推迟到 `will-quit`，在窗口关闭之后、进程退出之前，新实例能干净地拿到锁——没有需要修的重启竞态。

## 后果

失败的 deb 安装（无 polkit agent、sudo 无 tty、dpkg/apt 报错）现在发布带 electron-updater 消息的 `phase: 'error'`，恢复后端让会话保持可用，并从手动与启动两种提示里都弹出错误对话框。此前「下载+校验成功但什么都没装」的静默空操作消失了。测试覆盖了成功路径与同步错误路径。
