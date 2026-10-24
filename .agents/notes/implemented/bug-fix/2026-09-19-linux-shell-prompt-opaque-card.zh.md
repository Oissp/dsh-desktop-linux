# Agent Note: Shell prompt documents are served inside the product window

Status: implemented

[English](2026-09-19-linux-shell-prompt-opaque-card.md) | 中文

## Problem

[0.1.6-alpha.2 合并](../architecture/2026-09-18-merge-0.1.6-alpha.2-linux-desktop.zh.md)把本 fork 的原生 `dialog.showMessageBox` 更新提示换成了 Shell 自绘窗口，其文档来自 `dsh-app://shell/update-dialog.html` 与 `dsh-app://shell/mandatory-update.html`。同一次合并还从 `dsh-app` 的 protocol handler 里删掉了 `shell` 分支——fork 合并前的 `main.ts` 带着 `if (url.hostname === 'shell') return serveShellAsset(request)`。此后没有任何代码服务该 host，handler 一路落到 `404`，于是每个提示加载到的都是空文档。这些文档本身正确打进了 `app.asar` 的 `renderer/`，只是没有代码去读。

由此产生两个症状，都报告在 Linux `0.1.6-alpha.2.1` 及之后。因为 `update-dialog.css` 从未加载，提示窗口既没有遮罩、也没有居中和卡片。瞬时的 **正在检查更新…** 提示于是表现为一个与父窗口内容区等大、内部空无一物的 `transparent: true` 窗口；在没有合成器的 X11 上，这份 alpha 没有背景可混，被画成盖住产品窗口的不透明深色板。那是一个独立原生窗口。fork 当时的应对方式是一个 Linux 专用的不透明居中卡片窗口（见本笔记原标题）；在提示改为产品窗口内视图之后，它被移除，当前发布的就是后者。

把文档真正服务出来之后，又暴露出两个此前被空白窗口掩盖的缺陷。提示需要一个只有文档自己知道的高度；而更新机制在引擎的 Language 选择被读出之前就从 `app.getLocale()` 捕获了词典，于是系统语言为英文的机器上即使应用内已选择中文，每个提示仍然显示英文。

## Decision

protocol handler 用现成的 `serveWebDocument` 从 `join(app.getAppPath(), 'renderer')` 服务 `shell` host；被删掉的 `serveShellAsset` 重复实现的路径包含检查与 MIME 映射，该函数本来就有。它对 `<head>` 的 boot 注入只作用于 `/` 与 `/index.html`，因此 Shell 文档按原字节服务；`/design-platform.css` 则由同一处从构建产物客户端的 `lib/welcome` 目录服务。

`update-overlay.ts` 负责提示的表面形式：用隔离的 Shell preload 创建 `WebContentsView`，以 `setBackgroundColor('#00000000')` 作透明底，并加入产品窗口的 `contentView`，而不是另开一个窗口。该视图铺满宿主内容区（Windows 上让出标题栏），跟随宿主缩放，只在宿主已有焦点时转发焦点，并在宿主上消费 `before-input-event`，使产品快捷键与编辑按键到不了背后的页面。文档在产品窗口内部参与合成，因此遮罩天然以产品页面为背景；不再存在一个独立的透明原生窗口供未合成的会话压平。

强制更新模态在 Linux 与 macOS 上使用同一个视图，在 Windows 上把文档嵌入产品页面本身，因为那里标题栏属于产品。加载失败或渲染进程崩溃时回落到一次原生 `dialog.showMessageBox`，提供下载页与退出应用两个选项，既让父窗口保持阻塞，也留出一条出路，随后重新加载视图。

两个文档都先加载 `design-platform.css` 与 `shell-theme.js`，再加载自己的样式表，因此配色就是产品的配色：`update-dialog.css` 与 `mandatory-update.css` 引用 `--dsw-alias-*` 令牌，`shell-theme.js` 依据 `prefers-color-scheme` 切换 `body[data-ds-dark-theme]`，而该媒体特性由外观控制器通过 `nativeTheme.themeSource` 驱动。关闭图标是用 `currentColor` 着色的 `update-close.svg` CSS mask，因此它跟随文字色，且不需要内联一份路径副本。

不再保留任何平台表面分流。没有 `desktopDialogSurface`、没有 `mandatoryUpdateSurface`、没有 `fitDialogCard`、没有 `UPDATE_DIALOG_IPC.resize` 通道、两个视图上都没有 `surface` 字段、也没有预涂的窗口底色：卡片、它的高度适配与预涂底色都只为了让一个独立窗口可见，而内嵌视图让这些全部失去必要。这就是上游 `master` 已发布的设计；[0.2.1-rc.3 合并笔记](../architecture/2026-10-24-merge-0.2.1-rc.3-linux-desktop.zh.md)记录了 fork 为何采用它而不是恢复卡片。

两个 Shell 类都接收 `() => DesktopLocale` 而不是 `DesktopLocale`。`DesktopLocaleController` 在更新机制构造之后才从 `settings.yaml` 读出引擎的 `locale.preference` 并重新赋值 `locale` 绑定；构造时捕获的词典因此把所有提示在整个进程生命周期里钉在 `app.getLocale()` 上，而按 `currentDesktopLocale()` 重建的菜单却跟随了设置。传取值器在显示时才读当前绑定，下一次提示才能用上新语言。`MandatoryUpdateView.locale` 仍是取值：它要跨 IPC 送到渲染进程，而渲染进程无法调用函数。

提示保持 Shell 自绘而不回退到原生对话框，是因为合并后的流程需要以程序方式关闭提示：`controller.abort()` 在检查返回的瞬间关闭瞬时的检查提示，`updateDialog.cancel()` 在策略转为强制或关闭应用时关闭普通提示。`dialog.showMessageBox` 没有提供任何关闭操作，原生提示会一直留在屏幕上直到用户点击。

## Alternatives considered

**在 Linux 上回退到原生 `dialog.showMessageBox`。** 否决：合并后的流程依赖程序化关闭，瞬时的检查提示会滞留到被点击为止。合并前的代码能用原生对话框，是因为它既没有瞬时提示，也没有会取消普通提示的强制策略机制。

**把 `serveShellAsset` 作为独立读取器恢复回来。** 否决：它重复了 `serveWebDocument` 的目录穿越防护、MIME 表与方法检查。复用已有测试的函数，只留一处需要审计路径包含的读取器。

**保留 fork 的不透明居中卡片，连同它的高度回报通道与预涂底色。** 否决发生在视图取代独立窗口之后：卡片存在是因为透明原生窗口在没有合成器时无法呈现其 alpha，而窗口内视图消掉了那个窗口。保留卡片等于为一个视图已经正确渲染的表面，继续维护高度通道、`surface` 字段、预涂辅助函数，以及一处 Linux 特有的视觉分歧。

**检测合成器，在能用的地方保留覆盖层。** 否决：Electron 没有暴露合成查询接口，而按环境做启发式判断在能合成的 X11 桌面（也就是常见情况）上会判错，同时又帮不了不能合成的那些。

**把覆盖层做成铺满父窗口的不透明表面。** 否决：与父窗口内容区等大的不透明表面会完全遮住产品窗口，而不是用遮罩盖住它。

**加 `--enable-transparent-visuals` 开关。** 否决：该开关并不能在没有合成器时让 alpha 参与合成，却会给每次 Linux 启动都加上一个影响 GPU 的启动参数。

**在构造更新机制之前先 await 已存的语言偏好。** 否决：它只能定住启动时的语言，无法覆盖运行中修改 Language 的情况，还会在第一个窗口之前给启动路径加上一次设置读取。

## Consequences

提示现在从产品窗口内部覆盖它，遮罩与产品页面合成，强制更新模态保留产品窗口自己的标题栏与原生提醒行为。卡片剩下的代价——只在创建与每次测量时居中、不跟随父窗口——随卡片一并消失。

本 fork 在该子系统中的差异现在只剩 `main.ts` 里的 `shell` 分支与两处语言取值器；`update-overlay.ts`、文档标记与样式表以及这一组文件的其余部分都跟随上游。`.github/sync-trimmed-paths.txt` 记录的是被删除的文件而非被修改的行为，这两处分叉都不在它的覆盖范围内。

整体采用上游 `update-overlay.ts`、`update-dialog.ts` 与 `update-dialog.css` 的合并不再是一次设计倒退——那就是设计本身。剩下的风险是语言接线：上游接收 `DesktopLocale` 取值，整体采用会再次把提示钉在启动时的词典上，`update-dialog.spec.ts` 里跨一次 Language 改动渲染两次提示的用例会失败。任何触及这些文件的合并都要重新核对取值器与 `shell` 分支，而不是表面形式。

这些文档静默 404 了两个版本，这一点最值得记住：`loadURL` 解析 404 时并不 reject，因此 `void window.loadURL(page).catch(abort)` 从未触发，提示在什么都没显示的情况下报告成功。

## Testing

`apps/desktop/tests/main-startup.spec.ts` 断言 handler 把 `dsh-app://shell/update-dialog.html` 路由到打包的 `renderer` 目录、把 `design-platform.css` 路由到 `lib/welcome`、把 `update-close.svg` 作为 `image/svg+xml` 服务，并且对非自有 host 仍然返回 404；删掉该分支会让它失败。`update-overlay.spec.ts` 钉住视图加入宿主 `contentView`、透明底色、Windows 上的标题栏让位、输入拦截、焦点跟随宿主以及监听器释放。`update-dialog.spec.ts` 钉住提示生命周期、对非自有响应的拒绝，以及两次提示之间切换语言后第二次能用上新语言。`update-error-renderer.spec.ts` 钉住文档的纯文本渲染与键盘顺序。`shell-theme.spec.ts` 钉住每个 Shell 文档应用初始配色并跟随其变化。`package-deb.yml` 在打包前运行这套测试。

没有任何自动检查能证明提示真的渲染出了可见内容，这正是 404 能通过整套测试的原因；也没有任何检查能证明文案就是用户所选的语言，因为测试自带词典。在已安装的 Linux 构建上实际查看提示，仍然是一个手工验收步骤。

## Related

[频道推导笔记](2026-09-19-desktop-update-channel-derivation.zh.md)记录了同一次合并给更新路径带来的另一个缺陷。[Shell 外观笔记](../architecture/2026-09-20-shell-appearance-follows-engine-theme.zh.md)记录了这些文档如何跟随应用配色。[0.2.1-rc.3 合并笔记](../architecture/2026-10-24-merge-0.2.1-rc.3-linux-desktop.zh.md)记录了采用上游窗口内提示表面形式的过程。
