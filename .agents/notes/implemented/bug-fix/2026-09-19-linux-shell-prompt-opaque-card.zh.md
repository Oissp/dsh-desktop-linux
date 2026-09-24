# Agent Note: Shell prompt documents are served, and Linux uses an opaque card

Status: implemented

[English](2026-09-19-linux-shell-prompt-opaque-card.md) | 中文

## Problem

[0.1.6-alpha.2 合并](../architecture/2026-09-18-merge-0.1.6-alpha.2-linux-desktop.zh.md)把本 fork 的原生 `dialog.showMessageBox` 更新提示换成了 Shell 自绘窗口，其文档来自 `dsh-app://shell/update-dialog.html` 与 `dsh-app://shell/mandatory-update.html`。同一次合并还从 `dsh-app` 的 protocol handler 里删掉了 `shell` 分支——fork 合并前的 `main.ts` 带着 `if (url.hostname === 'shell') return serveShellAsset(request)`。此后没有任何代码服务该 host，handler 一路落到 `404`，于是每个提示加载到的都是空文档。这些文档本身正确打进了 `app.asar` 的 `renderer/`，只是没有代码去读。

由此产生两个症状，都报告在 Linux `0.1.6-alpha.2.1` 及之后。因为 `update-dialog.css` 从未加载，提示窗口既没有遮罩、也没有居中和卡片。瞬时的 **正在检查更新…** 提示于是表现为一个与父窗口内容区等大、内部空无一物的 `transparent: true` 窗口；在没有合成器的 X11 上，这份 alpha 没有背景可混，被画成盖住产品窗口的不透明深色板。把提示限制为不透明的 420x320 卡片后，同一个空文档就变成了一个小的纯白空窗口。

未被合成的透明窗口依然无法呈现遮罩，因此下面的表面拆分仍然必要；它并不是内容空白的原因。

把文档真正服务出来之后，又暴露出两个此前被空白窗口掩盖的缺陷。卡片固定的 320 高度会在短文案下方留出一片裸露的白底；而在系统语言为英文的机器上，即使应用内已选择中文，每个提示仍然显示英文——更新机制在引擎的 Language 选择被读出之前就从 `app.getLocale()` 捕获了词典。

## Decision

protocol handler 用现成的 `serveWebDocument` 从 `join(app.getAppPath(), 'renderer')` 服务 `shell` host；被删掉的 `serveShellAsset` 重复实现的路径包含检查与 MIME 映射，该函数本来就有。它对 `<head>` 的 boot 注入只作用于 `/` 与 `/index.html`，因此 Shell 文档按原字节服务。

表面形式由 `update-overlay.ts` 决定，并且按平台而非全局选择，因此上游的覆盖层在所有能用的地方都保留下来。

`desktopDialogSurface(platform)` 在 Linux 上返回 `window`，其他平台返回 `overlay`。`createUpdatePromptWindow` 在 `window` 下构造不透明无边框卡片：宽 420，居中于父窗口内容区，`backgroundColor` 用 `surfaceBackground()` 按当前主题预涂，不带 `transparent`，也不向父窗口插入任何 CSS；在 `overlay` 下构造覆盖层，并沿用普通提示本来就在用的非原生 `nativeModal`，使 macOS 不进入整屏 sheet 动画、由覆盖层自己拦截父窗口输入。

卡片自身没有内容高度，固定高度会在短文案下方留出一片裸露的白底。文档在布局完成后量出 `#dialog` 的高度，经 `UPDATE_DIALOG_IPC.resize` 回报；`fitDialogCard` 把它下钳到 `CARD_MIN_HEIGHT`、上钳到父窗口内容区高度，然后重新居中。`ResizeObserver` 与技术详情的 `toggle` 事件会再次回报，因此展开详情是把窗口撑大而不是在内部滚动。覆盖层本身已铺满父窗口，`fitDialogCard` 在该表面忽略测量值，渲染进程也不会发送。

`mandatoryUpdateSurface(platform)` 只在 macOS 上返回 `overlay`，因为强制更新模态提供原生移动、缩放与最大化，而无边框覆盖层在 Windows 上给不了这些能力；Linux 与 Windows 都使用 Windows 分支原本就在用的 640x560 带边框窗口。

主进程把选定的表面形式发布为 `UpdateDialogView.surface` 与 `MandatoryUpdateView.surface`。两个渲染进程各自把它写到 `document.body.dataset.surface`，`update-dialog.css` 依据该属性去掉遮罩以及卡片的圆角与阴影。它不再让 `main` 铺满窗口，否则高度测量就失去意义。

Shell 的每个语言消费方都接收 `() => DesktopLocale` 而不是 `DesktopLocale`。`DesktopLocaleController` 在更新机制构造之后才从 `settings.yaml` 读出引擎的 `locale.preference` 并重新赋值 `locale` 绑定；构造时捕获的词典因此把所有提示在整个进程生命周期里钉在 `app.getLocale()` 上，而按 `currentDesktopLocale()` 重建的菜单却跟随了设置。传 `() => locale` 在显示时才读当前绑定，下一次提示才能用上新语言。`MandatoryUpdateView.locale` 仍是取值：它要跨 IPC 送到渲染进程，而渲染进程无法调用函数。

保留自绘窗口而不回退到原生对话框，是因为合并后的流程需要以程序方式关闭提示：`controller.abort()` 在检查返回的瞬间关闭瞬时的检查提示，`updateDialog.cancel()` 在策略转为强制或关闭应用时关闭普通提示。`dialog.showMessageBox` 没有提供任何关闭操作，原生提示会一直留在屏幕上直到用户点击。

## Alternatives considered

**在 Linux 上回退到原生 `dialog.showMessageBox`。** 否决：合并后的流程依赖程序化关闭，瞬时的检查提示会滞留到被点击为止。合并前的代码能用原生对话框，是因为它既没有瞬时提示，也没有会取消普通提示的强制策略机制。

**把 `serveShellAsset` 作为独立读取器恢复回来。** 否决：它重复了 `serveWebDocument` 的目录穿越防护、MIME 表与方法检查。复用已有测试的函数，只留一处需要审计路径包含的读取器。

**检测合成器，在能用的地方保留覆盖层。** 否决：Electron 没有暴露合成查询接口，而按环境做启发式判断在能合成的 X11 桌面（也就是常见情况）上会判错，同时又帮不了不能合成的那些。

**把覆盖层按父窗口全尺寸做成不透明。** 否决：与父窗口内容区等大的不透明窗口会完全遮住产品窗口，而不是用遮罩盖住它。

**加 `--enable-transparent-visuals` 开关。** 否决：该开关并不能在没有合成器时让 alpha 参与合成，却会给每次 Linux 启动都加上一个影响 GPU 的启动参数。

**把 `CARD_HEIGHT` 调小到贴合典型提示。** 否决：这只是把短文案下方的裸底换成长文案的滚动，而技术详情的展开会在提示打开期间改变所需高度，任何固定值都不对。

**在构造更新机制之前先 await 已存的语言偏好。** 否决：它只能定住启动时的语言，无法覆盖运行中修改 Language 的情况，还会在第一个窗口之前给启动路径加上一次设置读取。

## Consequences

Linux 上的提示不再盖住产品窗口，强制更新模态在该平台也保留了原生窗口控件。剩下的代价是卡片只在创建与每次测量时居中，不再像覆盖层那样跟随父窗口的移动与缩放。

fork 相对上游的差异落在 `main.ts` 里的 `shell` 分支、`update-overlay.ts` 里的 Linux 分支与表面/定尺寸函数、`resize` 通道，以及那些语言取值器上。上游 `master` 的 handler 没有 `shell` 分支，也没有其他代码服务该 host，因此一次整体采用上游 handler 的合并会再次删掉该分支，让所有提示重新变成空白。`.github/sync-trimmed-paths.txt` 记录的是被删除的文件而非被修改的行为，这些分叉都不在它的覆盖范围内。

这个风险不是假设，而且不限于 handler。0.1.7-alpha.1 的合并整体采用了上游的 `update-overlay.ts`、`update-dialog.ts` 和 `update-dialog.css`，把本笔记的整套设计退了回去：提示退回铺满父窗口的透明覆盖层，而 Wayland 会话无法把它定位到父窗口上，于是主窗口露出一部分且仍可交互；配色退回只有浅色；词典退回启动时捕获。被退回的样式表是肉眼可见的线索——`mandatory-update.css` 仍在引用 `update-dialog.css` 已不再定义的 `--shell-*` 令牌。任何触及这三个文件的合并都要重新核对表面分流、令牌表和语言取值器，而不只是协议 handler。

这些文档静默 404 了两个版本，这一点最值得记住：`loadURL` 解析 404 时并不 reject，因此 `void window.loadURL(page).catch(abort)` 从未触发，提示在什么都没显示的情况下报告成功。

## Testing

`apps/desktop/tests/main-startup.spec.ts` 断言 handler 把 `dsh-app://shell/update-dialog.html` 路由到打包的 `renderer` 目录，并且对非自有 host 仍然返回 404；删掉该分支会让它失败。`update-overlay.spec.ts` 钉住各平台的表面形式、卡片不透明且居中的几何、卡片表面不向父窗口插入 CSS，以及 `fitDialogCard` 在上下两端的钳制与在覆盖层上的空操作。`update-dialog.spec.ts` 钉住 Linux 提示、发布的 `surface`、对不可用高度的拒绝，以及两次提示之间切换语言后第二次能用上新语言。`update-error-renderer.spec.ts` 断言两个文档都把表面形式写到 `document.body.dataset`，并且卡片文档会回报高度而覆盖层文档不会。`package-deb.yml` 在打包前运行这套测试。

没有任何自动检查能证明提示真的渲染出了可见内容，这正是 404 能通过整套测试的原因；也没有任何检查能证明文案就是用户所选的语言，因为测试自带词典。在已安装的 Linux 构建上实际查看提示，仍然是一个手工验收步骤。

## Related

[频道推导笔记](2026-09-19-desktop-update-channel-derivation.zh.md)记录了同一次合并给更新路径带来的另一个缺陷。[Shell 外观笔记](../architecture/2026-09-20-shell-appearance-follows-engine-theme.zh.md)记录了这些文档如何跟随应用外观。
