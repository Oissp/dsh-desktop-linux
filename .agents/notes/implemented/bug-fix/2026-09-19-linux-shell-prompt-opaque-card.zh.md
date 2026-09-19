# Agent Note: Linux shell prompts use an opaque card instead of the transparent sheet

Status: implemented

[English](2026-09-19-linux-shell-prompt-opaque-card.md) | 中文

## Problem

[0.1.6-alpha.2 合并](../architecture/2026-09-18-merge-0.1.6-alpha.2-linux-desktop.zh.md)把本 fork 的原生 `dialog.showMessageBox` 更新提示换成了 Shell 自绘的覆盖层窗口。`createUpdateOverlay` 构造一个无边框的 `transparent: true` 子窗口，尺寸取 `parent.getContentBounds()`；`update-dialog.css` 用 `body { background: rgb(0 0 0 / 24%) }` 铺遮罩，父窗口的 `body` 则被插入 2px `filter: blur()`。`update-dialog.html` 与 `mandatory-update.html` 都引用该样式表，因此两者都带上了这层遮罩。

透明窗口的 alpha 需要合成器才能与背后内容混合。在没有合成器的 X11 上，alpha 无处可混，会被画成不透明底色，于是遮罩变成一块盖住整个产品窗口的深色板，只剩居中的白色卡片可见。用户报告的场景是瞬时的 **正在检查更新…** 提示。合并前的版本显示的是原生对话框，因此 `0.1.6-alpha.2.1` 及之后的每个 Linux 构建都带有该缺陷，而在覆盖层能正常合成的 darwin 与 win32 上从未出现。

## Decision

表面形式由 `update-overlay.ts` 决定，并且按平台而非全局选择，因此上游的覆盖层在所有能用的地方都保留下来。

`desktopDialogSurface(platform)` 在 Linux 上返回 `window`，其他平台返回 `overlay`。`createUpdatePromptWindow` 在 `window` 下构造不透明无边框卡片：420x320，居中于父窗口内容区，`backgroundColor: '#ffffff'`，不带 `transparent`，也不向父窗口插入任何 CSS；在 `overlay` 下构造未改动的透明覆盖层。

`mandatoryUpdateSurface(platform)` 只在 macOS 上返回 `overlay`，因为强制更新模态提供原生移动、缩放与最大化，而无边框覆盖层在 Windows 上给不了这些能力；Linux 与 Windows 都使用 Windows 分支原本就在用的 640x560 带边框窗口。

主进程把选定的表面形式发布为 `UpdateDialogView.surface` 与 `MandatoryUpdateView.surface`。两个渲染进程各自把它写到 `document.body.dataset.surface`，`update-dialog.css` 依据该属性去掉遮罩，并让 `main` 铺满窗口、去掉卡片圆角与阴影。

保留自绘窗口而不回退到原生对话框，是因为合并后的流程需要以程序方式关闭提示：`controller.abort()` 在检查返回的瞬间关闭瞬时的检查提示，`updateDialog.cancel()` 在策略转为强制或关闭应用时关闭普通提示。`dialog.showMessageBox` 没有提供任何关闭操作，原生提示会一直留在屏幕上直到用户点击。

## Alternatives considered

**在 Linux 上回退到原生 `dialog.showMessageBox`。** 否决：合并后的流程依赖程序化关闭，瞬时的检查提示会滞留到被点击为止。合并前的代码能用原生对话框，是因为它既没有瞬时提示，也没有会取消普通提示的强制策略机制。

**检测合成器，在能用的地方保留覆盖层。** 否决：Electron 没有暴露合成查询接口，而按环境做启发式判断在能合成的 X11 桌面（也就是常见情况）上会判错，同时又帮不了不能合成的那些。

**把覆盖层按父窗口全尺寸做成不透明。** 否决：与父窗口内容区等大的不透明窗口会完全遮住产品窗口，而不是用遮罩盖住它。

**加 `--enable-transparent-visuals` 开关。** 否决：该开关并不能在没有合成器时让 alpha 参与合成，却会给每次 Linux 启动都加上一个影响 GPU 的启动参数。

## Consequences

Linux 上的提示不再盖住产品窗口，强制更新模态在该平台也保留了原生窗口控件。代价在卡片的固定几何上：超过 420x320 的内容在 `main` 内部滚动而不是把窗口撑大；卡片只在创建时居中一次，不再像覆盖层那样跟随父窗口的移动与缩放。

fork 相对上游在 `update-overlay.ts` 上的差异增加了 Linux 分支与两个表面函数。需要重新套用它的是上游对提示窗口的重构：`.github/sync-trimmed-paths.txt` 记录的是被删除的文件而非被修改的行为，因此一次把 `createUpdateOverlay` 恢复成唯一提示构造函数的合并，会在 Linux 上悄悄把那块深色板带回来。

## Testing

`apps/desktop/tests/update-overlay.spec.ts` 钉住各平台的表面形式、卡片不透明且居中的几何，以及卡片表面不向父窗口插入 CSS。`update-dialog.spec.ts` 钉住 Linux 提示与发布的 `surface`。`update-error-renderer.spec.ts` 断言两个文档都把该字段写到 `document.body.dataset`，因此丢掉这行赋值会失败，而不是悄悄把遮罩恢复回来。`package-deb.yml` 在打包前运行这套测试。

## Related

[频道推导笔记](2026-09-19-desktop-update-channel-derivation.zh.md)记录了同一次合并给更新路径带来的另一个缺陷。
