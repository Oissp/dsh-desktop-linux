# Agent Note: Shell documents follow the engine appearance

Status: implemented

[English](2026-09-20-shell-appearance-follows-engine-theme.md) | 中文

## Problem

Shell 拥有一批产品不负责渲染的文档：更新提示、强制更新模态、以及策略登录占位页。它们的样式表写死了浅色配色——`update-dialog.css` 以 `color-scheme: light` 开头，并直接写死 `#fff`、`#0f1115`、`#f5f5f5`——因此无论 设置 → 通用设置 → 外观 选了什么，它们都保持白色，而产品的每个界面都跟随了设置。产品自己的弹窗（例如插件管理器的添加插件模态）通过 `--dsw-*` 别名令牌与 `body[data-ds-dark-theme]` 换色，这正是这个落差在同一个窗口里看得见的原因：主题化的页面背后是一张白色的提示。

这份偏好其实已经被读取，只是没有用在这里。`DesktopAppearanceController` 解析 `settings.yaml` 里的 `ui-theme.preference`，在打包的 Linux 上切换窗口与托盘图标；`preload-theme.ts` 在 macOS 上把产品的主题源转发给 `nativeTheme.themeSource`，让侧边栏的毛玻璃材质跟随应用。两者都到不了 Shell 文档，两者也都不在 Windows 上运行。

## Decision

存下来的偏好在每个平台都成为 `nativeTheme.themeSource`。Electron 明确说明：设置它会让渲染进程里的 `prefers-color-scheme` 匹配，应用应当读取 `shouldUseDarkColors` 来决定套用什么样式，因此 Shell 文档不需要新通道——它们声明 `color-scheme: light dark`，并把深色块放在 `@media (prefers-color-scheme: dark)` 之后。`themeSourceOf` 只把内置的 `light` 与 `dark` 这一对映射为覆盖性的主题源；`system`、偏好缺失、以及任何自定义主题 id 都让操作系统说了算，这与 `resolveAppearance` 一直对图标采用的规则相同。

`DesktopAppearanceController` 现在在每个平台运行，而不再只活在打包 Linux 的分支里，其回调只在 Linux 上做图标工作。它在主窗口创建之前启动，因此 Windows 标题栏覆盖层的颜色与 Linux 的窗口图标在首次绘制时就是对的，而不是事后被纠正。它记录上次应用过的外观并跳过重复，因为写入 `themeSource` 会触发 `updated`，否则每次变更都会应用两次。

每个 Shell 文档用自己那份取值重绘，这些取值就是产品别名令牌解析出的结果，因为客户端调色板是装进产品文档 `body` 的，而 Shell 文档是另一个文档。浅色取值就是原本写在那里的字面量——它们与 `bg-layer-1`、`label-primary`、`button-primary-fill`、`button-elevated-fill` 完全一致——深色块取 `design-platform.css` 中 `body[data-ds-dark-theme]` 下的同一批令牌。

不透明提示窗口按解析出的表面色预涂底色，因为文档自身的绘制发生在窗口显示之后，`backgroundColor` 不一致就会闪一下。关闭图标改为内联的 `fill="currentColor"`，不再作为 `<img>` 引入：那个资源带固定深色填充，深色卡片会把它藏起来。

## Alternatives considered

**像 `surface` 那样，把解析出的外观经 IPC 发布给每个 Shell 文档。** 否决：Shell 就得为每个文档以及将来每个新文档自己维护这条传播路径，而 `themeSource` 已经能抵达每个渲染进程的 `prefers-color-scheme`。

**保持控制器仅限 Linux，把产品窗口的主题源 IPC 扩展到所有平台。** 否决：Shell 的提示可能在产品窗口加载之前就出现，它们的配色不该依赖一个还不存在的文档。

**改用 CSS 系统颜色，就像 `policy-login-loading.html` 那样。** 否决：`Canvas` 与 `CanvasText` 跟随配色方案，但不跟随产品调色板，提示与产品窗口并排时会呈现不同的灰。登录占位页保留系统颜色，是因为它必须在任何 origin、字体或样式表可用之前渲染。

**把客户端的 `--dsw-*` 样式表引入 Shell 文档。** 否决：那些表由客户端 bundle 在运行时安装，而 Shell 只需要少量取值，不需要整套调色板。

**用 CSS mask 给关闭图标换色。** 否决：内联这两条路径让字形只有一处定义，不需要前缀、不需要为 mask 资源额外放宽 CSP，也不改动按钮结构。

## Consequences

浅色渲染没有变化，因为浅色令牌取值就是样式表里原本的字面量。深色渲染使用产品的深色调色板，这意味着主按钮反相为近白填充配深色文字，而不是保持深色。选择自定义主题的用户在 Shell 文档里得到的是操作系统外观而非该主题的调色板，因为自定义 id 在 Shell 里没有对应取值——这与图标一直以来的限制相同。

有两个事实现在各有两处。Shell 的令牌取值重复了 `design-platform.css` 解析出的结果，因此上游改调色板不会传到它们这里；`update-dialog.css` 的深色取值因此在注释里写明来源令牌。而 `nativeTheme.themeSource` 在 macOS 上有两个写入方，本控制器与产品窗口的 IPC；两者源自同一份存储偏好因而一致，但改动其一需要考虑另一个。

Windows 得到的不止是提示的变更：右键菜单、DevTools 与标题栏覆盖层都改为跟随应用外观而不是操作系统，因为设置 `themeSource` 就是这个效果。

## Testing

`appearance.spec.ts` 钉住 `themeSourceOf` 的映射——包括自定义主题 id 与偏好缺失都解析为 `system`——以及控制器写入的是主题源本身，而不只是回调值。`update-overlay.spec.ts` 钉住卡片与强制更新窗口在深浅两种主题下的预涂底色。`update-error-renderer.spec.ts` 钉住关闭图标由 `currentColor` 着色，改回 `<img>` 会让它失败。

没有任何自动检查会在深色模式下渲染 Shell 文档，因为 jsdom 不应用 `prefers-color-scheme`，也不会为对比度解析 CSS。在已安装的构建上确认提示配色，仍然是一个手工步骤。

## Related

[Shell 提示笔记](../bug-fix/2026-09-19-linux-shell-prompt-opaque-card.zh.md)记录了提示文档的服务、表面形式、尺寸与语言。
