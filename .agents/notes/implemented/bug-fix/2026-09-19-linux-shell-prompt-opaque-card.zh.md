# Agent Note: Shell prompt documents are served, and Linux uses an opaque card

Status: implemented

[English](2026-09-19-linux-shell-prompt-opaque-card.md) | 中文

## Problem

[0.1.6-alpha.2 合并](../architecture/2026-09-18-merge-0.1.6-alpha.2-linux-desktop.zh.md)把本 fork 的原生 `dialog.showMessageBox` 更新提示换成了 Shell 自绘窗口，其文档来自 `dsh-app://shell/update-dialog.html` 与 `dsh-app://shell/mandatory-update.html`。同一次合并还从 `dsh-app` 的 protocol handler 里删掉了 `shell` 分支——fork 合并前的 `main.ts` 带着 `if (url.hostname === 'shell') return serveShellAsset(request)`。此后没有任何代码服务该 host，handler 一路落到 `404`，于是每个提示加载到的都是空文档。这些文档本身正确打进了 `app.asar` 的 `renderer/`，只是没有代码去读。

由此产生两个症状，都报告在 Linux `0.1.6-alpha.2.1` 及之后。因为 `update-dialog.css` 从未加载，提示窗口既没有遮罩、也没有居中和卡片。瞬时的 **正在检查更新…** 提示于是表现为一个与父窗口内容区等大、内部空无一物的 `transparent: true` 窗口；在没有合成器的 X11 上，这份 alpha 没有背景可混，被画成盖住产品窗口的不透明深色板。把提示限制为不透明的 420x320 卡片后，同一个空文档就变成了一个小的纯白空窗口。

未被合成的透明窗口依然无法呈现遮罩，因此下面的表面拆分仍然必要；它并不是内容空白的原因。

## Decision

protocol handler 用现成的 `serveWebDocument` 从 `join(app.getAppPath(), 'renderer')` 服务 `shell` host；被删掉的 `serveShellAsset` 重复实现的路径包含检查与 MIME 映射，该函数本来就有。它对 `<head>` 的 boot 注入只作用于 `/` 与 `/index.html`，因此 Shell 文档按原字节服务。

表面形式由 `update-overlay.ts` 决定，并且按平台而非全局选择，因此上游的覆盖层在所有能用的地方都保留下来。

`desktopDialogSurface(platform)` 在 Linux 上返回 `window`，其他平台返回 `overlay`。`createUpdatePromptWindow` 在 `window` 下构造不透明无边框卡片：420x320，居中于父窗口内容区，`backgroundColor: '#ffffff'`，不带 `transparent`，也不向父窗口插入任何 CSS；在 `overlay` 下构造未改动的透明覆盖层。

`mandatoryUpdateSurface(platform)` 只在 macOS 上返回 `overlay`，因为强制更新模态提供原生移动、缩放与最大化，而无边框覆盖层在 Windows 上给不了这些能力；Linux 与 Windows 都使用 Windows 分支原本就在用的 640x560 带边框窗口。

主进程把选定的表面形式发布为 `UpdateDialogView.surface` 与 `MandatoryUpdateView.surface`。两个渲染进程各自把它写到 `document.body.dataset.surface`，`update-dialog.css` 依据该属性去掉遮罩，并让 `main` 铺满窗口、去掉卡片圆角与阴影。

保留自绘窗口而不回退到原生对话框，是因为合并后的流程需要以程序方式关闭提示：`controller.abort()` 在检查返回的瞬间关闭瞬时的检查提示，`updateDialog.cancel()` 在策略转为强制或关闭应用时关闭普通提示。`dialog.showMessageBox` 没有提供任何关闭操作，原生提示会一直留在屏幕上直到用户点击。

## Alternatives considered

**在 Linux 上回退到原生 `dialog.showMessageBox`。** 否决：合并后的流程依赖程序化关闭，瞬时的检查提示会滞留到被点击为止。合并前的代码能用原生对话框，是因为它既没有瞬时提示，也没有会取消普通提示的强制策略机制。

**把 `serveShellAsset` 作为独立读取器恢复回来。** 否决：它重复了 `serveWebDocument` 的目录穿越防护、MIME 表与方法检查。复用已有测试的函数，只留一处需要审计路径包含的读取器。

**检测合成器，在能用的地方保留覆盖层。** 否决：Electron 没有暴露合成查询接口，而按环境做启发式判断在能合成的 X11 桌面（也就是常见情况）上会判错，同时又帮不了不能合成的那些。

**把覆盖层按父窗口全尺寸做成不透明。** 否决：与父窗口内容区等大的不透明窗口会完全遮住产品窗口，而不是用遮罩盖住它。

**加 `--enable-transparent-visuals` 开关。** 否决：该开关并不能在没有合成器时让 alpha 参与合成，却会给每次 Linux 启动都加上一个影响 GPU 的启动参数。

## Consequences

Linux 上的提示不再盖住产品窗口，强制更新模态在该平台也保留了原生窗口控件。代价在卡片的固定几何上：超过 420x320 的内容在 `main` 内部滚动而不是把窗口撑大；卡片只在创建时居中一次，不再像覆盖层那样跟随父窗口的移动与缩放。

fork 相对上游的差异落在两个文件：`main.ts` 里的 `shell` 分支，以及 `update-overlay.ts` 里的 Linux 分支与两个表面函数。上游 `master` 的 handler 没有 `shell` 分支，也没有其他代码服务该 host，因此一次整体采用上游 handler 的合并会再次删掉该分支，让所有提示重新变成空白。`.github/sync-trimmed-paths.txt` 记录的是被删除的文件而非被修改的行为，两处分叉都不在它的覆盖范围内。

这些文档静默 404 了两个版本，这一点最值得记住：`loadURL` 解析 404 时并不 reject，因此 `void window.loadURL(page).catch(abort)` 从未触发，提示在什么都没显示的情况下报告成功。

## Testing

`apps/desktop/tests/main-startup.spec.ts` 断言 handler 把 `dsh-app://shell/update-dialog.html` 路由到打包的 `renderer` 目录，并且对非自有 host 仍然返回 404；删掉该分支会让它失败。`update-overlay.spec.ts` 钉住各平台的表面形式、卡片不透明且居中的几何，以及卡片表面不向父窗口插入 CSS。`update-dialog.spec.ts` 钉住 Linux 提示与发布的 `surface`。`update-error-renderer.spec.ts` 断言两个文档都把该字段写到 `document.body.dataset`，因此丢掉这行赋值会失败，而不是悄悄把遮罩恢复回来。`package-deb.yml` 在打包前运行这套测试。

没有任何自动检查能证明提示真的渲染出了可见内容，这正是 404 能通过整套测试的原因。在已安装的 Linux 构建上实际查看提示，仍然是一个手工验收步骤。

## Related

[频道推导笔记](2026-09-19-desktop-update-channel-derivation.zh.md)记录了同一次合并给更新路径带来的另一个缺陷。
