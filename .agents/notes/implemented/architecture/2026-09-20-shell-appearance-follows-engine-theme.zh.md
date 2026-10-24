# Agent Note: Shell documents follow the engine appearance

Status: implemented

[English](2026-09-20-shell-appearance-follows-engine-theme.md) | 中文

## Problem

Shell 拥有一些产品本身不渲染的文档：更新提示、强制更新模态，以及策略登录占位页。它们的样式表把浅色调色板写死了——`update-dialog.css` 以 `color-scheme: light` 与字面量 `#fff`、`#0f1115`、`#f5f5f5` 开头——因此在 设置 → 通用设置 → 外观 之下它们仍是白的，而每个产品表面都跟随了设置。产品自己的对话框（例如插件管理器的添加插件模态）通过 `--dsw-*` 别名令牌与 `body[data-ds-dark-theme]` 着色，这正是落差在同一个窗口里可见的原因：主题化页面背后是一个白色提示。

这份偏好本来就已经被读取，只是不是为此。`DesktopAppearanceController` 从 `settings.yaml` 解析 `ui-theme.preference`，用于在打包 Linux 上切换窗口与托盘图标；`preload-theme.ts` 在 macOS 上把产品的主题源转发给 `nativeTheme.themeSource`，以便侧边栏的毛玻璃跟随应用。两者都没有抵达 Shell 文档，而且都没有在 Windows 上运行。

## Decision

存下来的偏好在每个平台都成为 `nativeTheme.themeSource`。Electron 明确说明：设置它会让渲染进程里的 `prefers-color-scheme` 匹配，因此 Shell 文档不需要新通道——每个文档都加载 `shell-theme.js`，它读取 `matchMedia('(prefers-color-scheme: dark)')`，据此切换 `body[data-ds-dark-theme]`，并在每次变化时再切换一次。`themeSourceOf` 只把内置的 `light` 与 `dark` 这一对映射为覆盖性的主题源；`system`、偏好缺失、以及任何自定义主题 id 都让操作系统说了算，这与 `resolveAppearance` 一直对图标采用的规则相同。

`DesktopAppearanceController` 现在在每个平台运行，而不再只活在打包 Linux 的分支里，其回调只在 Linux 上做图标工作。它在主窗口创建之前启动，因此 Windows 标题栏覆盖层的颜色与 Linux 的窗口图标在首次绘制时就是对的，而不是事后被纠正。它记录上次应用过的外观并跳过重复，因为写入 `themeSource` 会触发 `updated`，否则每次变更都会应用两次。

每个 Shell 文档都在自己的样式表之前，从构建产物客户端的 `lib/welcome` 目录加载客户端的 `design-platform.css`——与文档同在 `dsh-app://shell/` origin 上服务——并用产品所用的同一批 `--dsw-alias-*` 令牌与 `body[data-ds-dark-theme]` 属性给自己着色。Shell 于是从产品的令牌表解析调色板，而不是从一份副本：`packages/client/ui-theme` 里的调色板改动会通过两边共读的样式表抵达提示，文档也不需要逐个令牌复制来保持同步。

更新提示上的关闭图标是一个 CSS mask——`background: currentColor; mask: url("update-close.svg")`——因此它由周围主题设定的文字色着色。`update-close.svg` 带固定深色填充，只被当作 mask 形状使用，从不直接绘制。

不再有任何一个 Shell 文档是独立原生窗口。更新提示与强制更新模态占据产品窗口内的 `WebContentsView`，策略登录占位页则嵌在产品页面里，因此 Shell 文档的调色板总是对着它所合成的产品表面被看到。

## Alternatives considered

**把解析出的外观经 IPC 发布给每个 Shell 文档。** 否决：Shell 就得为每个文档以及将来每个新文档自己维护这条传播路径，而 `themeSource` 已经能抵达每个渲染进程的 `prefers-color-scheme`。

**保持控制器仅限 Linux，把产品窗口的主题源 IPC 扩展到所有平台。** 否决：Shell 的提示可能在产品窗口加载之前就出现，它们的配色不该依赖一个还不存在的文档。

**改用 CSS 系统颜色，就像 `policy-login-loading.html` 那样。** 否决：`Canvas` 与 `CanvasText` 跟随配色方案，但不跟随产品调色板，提示与产品窗口并排时会呈现不同的灰。登录占位页保留系统颜色，是因为它必须在任何 origin、字体或样式表可用之前渲染。

**保留 Shell 自己的 `--shell-*` 令牌表，而不加载 `design-platform.css`。** 否决于调色板问题解决之后：那张表重复了客户端样式表已经携带的取值，于是上游每次改调色板都要手工再抄一遍，漏抄一处就表现为提示停留在上一个主题。

**通过内联路径 `fill="currentColor"` 给关闭图标换色。** 否决：把随包携带的 SVG 当作 mask 加载，字形只有一处定义；带色的背景本身已给它 `currentColor` 语义，无需在文档里重复那两条路径数据。

## Consequences

浅色渲染没有变化，因为 `design-platform.css` 解析出的就是 Shell 样式表原本携带的那些字面量。深色渲染使用产品的深色调色板，这意味着主按钮反相为近白填充配深色文字，而不是保持深色。选择自定义主题的用户在 Shell 文档里得到的是操作系统外观而非该主题的调色板，因为自定义 id 在 Shell 里没有对应取值——这与图标一直以来的限制相同。

Shell 文档现在依赖构建产物客户端的样式表出现在 `lib/welcome/design-platform.css`，并由 `shell` protocol 分支路由，因此打包步骤必须携带它；路由一旦坏掉，提示会完全没有样式，而不只是配色偏差。

`nativeTheme.themeSource` 在 macOS 上有两个写入方，本控制器与产品窗口的 IPC；两者源自同一份存储偏好因而一致，但改动其一需要考虑另一个。

Windows 得到的不止是提示的变更：右键菜单、DevTools 与标题栏覆盖层都改为跟随应用外观而不是操作系统，因为设置 `themeSource` 就是这个效果。

## Testing

`appearance.spec.ts` 钉住 `themeSourceOf` 的映射——包括自定义主题 id 与偏好缺失都解析为 `system`——以及控制器写入的是主题源本身，而不只是回调值。`shell-theme.spec.ts` 钉住每个 Shell 文档都加载 `shell-theme.js`、应用初始调色板、跟随变化，并在 `pagehide` 时停止监听。`main-startup.spec.ts` 钉住 `dsh-app://shell/design-platform.css` 从 `lib/welcome` 服务、`update-close.svg` 以 `image/svg+xml` 服务。

没有任何自动检查会比较深色模式下的渲染颜色；jsdom 不解析 CSS，因此 `update-error-renderer.spec.ts` 只能断言标记与属性，不能断言对比度。在已安装的构建上确认提示配色，仍然是一个手工步骤。

## Related

[Shell 提示笔记](../bug-fix/2026-09-19-linux-shell-prompt-opaque-card.zh.md)记录了提示文档的服务、窗口内表面形式与语言。
