# DeepSeek Harness 桌面端

[English](README.md) | 中文

桌面应用是包裹 dsh Web UI 的 Electron 壳。它不打开监听端口：打包后的 Electron 进程以 `ELECTRON_RUN_AS_NODE` 启动已安装的 dsh 项目，带版本的分帧字节管道在没有外层 Base64 信封的情况下承载 Fetch 请求与流式响应，Node IPC 承载生命周期控制，`dsh-app://` 则提供与后端版本匹配的客户端资源。

## 关键技术决策

| 决策 | 原因 | 直接结果 |
|---|---|---|
| 发布身份 | 桌面壳 API、Web 客户端、后端与插件依赖图作为一个组合完成验证；独立版本会产生未经验证的组合，并让更新可用性含糊不清。 | Electron 与 `@deepseek-ai/dsh` 始终使用同一精确版本。即使桌面壳代码不变，升级 dsh 也必须发布新 Desktop 版本。 |
| 运行时 | Electron 的 Node.js 带有 Electron 补丁、fuse、ABI 与生命周期约束，而系统运行时和包管理器状态不可控。 | dsh 以 `ELECTRON_RUN_AS_NODE` 在打包的 Electron 进程内运行，所有包操作都使用内置 pnpm（跑在内置上游 Node.js 上）。系统 Node.js、系统 pnpm 与用户的包管理器配置都不进入执行路径。 |
| 包来源 | 即使离线，启动时安装核心依赖也会增加开销。 | 发布 `app.asar` 携带完整生产依赖树（`dsh` 在归档内，原生模块解包在其旁）；profile 只安装外部插件。 |
| 共享模块 | 宿主 API 可能依赖模块实例身份。 | Desktop 用目录软链接把每个内置第一方包连接到 profile；普通插件依赖保留在本地。 |
| 状态归属 | 共享可执行依赖图会让 CLI（命令行界面）与 Desktop 相互改变 dsh、Cordis、插件或原生模块版本，而两个桌面进程还可能争用同一个 profile。 | Electron 在访问任何 profile 前获取进程生命周期单实例锁，并独占 `$DSH_HOME/profiles/desktop` 及其包管理器状态。CLI 与 Desktop 共享 `$DSH_HOME` 下受支持的产品数据，但绝不共享可执行包、插件激活、锁文件或 `node_modules`。 |
| 通信 | 监听 Web 服务会引入端口归属、认证、CORS 与暴露风险；Electron 主进程与其 `ELECTRON_RUN_AS_NODE` 后端子进程之间也需要明确的跨进程协议。 | 应用不打开 Web 端口。`dsh-app://` 承载 Web 资源和 Fetch 流量；分帧字节管道以背压传输有界请求与响应分块，Node IPC 只承载子进程生命周期控制。 |
| 插件变更 | 包安装和 Host 启动可能失败。 | Desktop 停止 Host 后直接修改当前 profile。失败保留部分修改供用户修复，不自动回滚 profile。 |
| 更新 | 桌面壳与 dsh 独立更新会重新产生版本分裂，而桌面壳未变化的数据块不应强制完整传输。 | Electron 壳、匹配的 dsh 运行时、Node.js 与 pnpm 组成一个更新单元。平台更新产物可以复用未变化的数据块，但运行时版本选择绝不脱离 Desktop 发布。 |

## 安装归属

Electron 拥有 `$DSH_HOME/profiles/desktop`。其 `dependencies` 只包含已安装外部插件的精确版本；`dsh.profile.bundles` 包含内置 bundle，后接已启用插件。应用从打包进 `app.asar` 的 `dsh` 树提供 dsh、私有 Desktop Host 及其生产依赖。共享包链接解析到该打包树内。宿主与插件在以 `ELECTRON_RUN_AS_NODE` 运行的打包 Electron 进程中执行，使用正常的 realpath 解析；Desktop 不启用 `--preserve-symlinks`。CLI 不能启动或修改此 profile。

本地启动页提供启动状态和可用恢复操作；加载后的 dsh 渲染进程仅接收桌面协议标记。独立插件窗口接收结构化的列表、安装、删除、更新和更新检查操作；两个渲染进程都无法访问文件系统、原始 Electron IPC、shell 或任意 pnpm 参数。

Electron 根据应用 locale 选择类型化的英文或中文桌面壳文案，并以英文作为 fallback。菜单、原生对话框、启动页与插件管理渲染进程使用同一 locale 数据；仓库的 Client UI i18n gate 会检查这些桌面源文件。

### 运行时与插件激活

发布 `app.asar` 内的 `dsh/desktop-runtime.json` 绑定 shell 版本、内置 Node 版本、平台、架构、共享包版本和最终文件清单。启动读取元数据，并检查共享包记录。发布 schema、shell 版本、目标兼容性和文件完整性在打包时验证。首次启动不会把核心包复制到 profile 存储或通过 pnpm 安装核心包。

1. 主窗口在 profile 准备或后端启动前显示本地加载页。新 profile 创建清单和共享包链接，保留无关文件，然后启动一次实际后端。未变化的启动复用 profile，不扫描已安装插件的清单。
2. 兼容的应用升级在当前 profile 中刷新共享链接，并检查已启用插件的 peer 要求。插件文件、配置、版本和锁文件留在原处；不运行 pnpm。
3. 内置 Node 版本、平台或架构变化时，禁用脚本重新安装锁定的插件依赖图，验证并链接宿主包，然后运行已批准的待执行构建并再次验证。
4. 插件添加、更新和删除使用内置 pnpm 及 Desktop 独有的包管理器状态。保留的宿主包必须声明为 peer；共享包的嵌套副本和别名会被验证拒绝。普通插件依赖必须解析到 profile 内部。
5. 插件变更在直接修改当前 profile 前停止后端。准备成功后启动 Host。包操作或 Host 启动失败会保留已修改文件并报告错误。未完成的包操作保留标记，使下次启动重试锁定依赖的安装和待执行构建。Desktop 不创建 staging 目录、激活日志或回滚副本。

加载页不依赖 Host。错误页提供重启和重装指导。只有已打包应用的资源支持 profile 恢复时，才提供禁用插件和重置 Desktop；开发模式和早期初始化失败只提供重启。应用菜单仍提供插件管理器入口。每次后端启动前都会检查运行时标识；插件修改不自动回滚。

重置删除 `$DSH_HOME/profiles/desktop` 中除所持事务锁外的所有条目，然后初始化内置 profile。它删除 Desktop 配置和已安装第三方包，不保留备份。共享任务、设置和 Harness-home `.env` 保持不变。壳资源和 preload 失败时使用独立文档显示可用恢复操作和诊断；其控件不依赖 preload。

包事务独占持有 `$DSH_HOME/profiles/desktop/lock`，直到 pnpm 进程退出。重置保留目录及其锁，直到初始化和 Host 启动完成。共享链接使用目录软链接；清理只移除链接，不删除其目标。原生构建遵循 profile 中经过审查的 `allowBuilds` 列表；新安装的包如果需要构建但未在列表中获准，事务会失败。

## 开发

`dev:desktop` 会构建当前 Host、客户端 bundle、Web 前端和 Electron 壳，把已构建的 CLI 包、私有 Desktop Host 包及其 workspace 依赖投影为一次性桌面 npm 项目，然后直接启动 Electron；这条路径不下载安装包内的 Node.js，也不从 npm 解析 dsh：

```sh
pnpm run dev:desktop
```

开发 Harness 状态默认写入 `apps/desktop/.desktop-build/development/home`，一次性 npm 项目位于 `apps/desktop/.desktop-build/development/project`，Electron 浏览器数据则位于 `apps/desktop/.desktop-build/development/electron-user-data`。因此，会话、设置、凭据、包链接和浏览器数据都不会进入用户正常使用的 Harness home；显式 `DSH_HOME` 只会替换开发 Harness home。Renderer DevTools 默认自动打开，Main、Renderer 和 dsh Host 调试端口依次为 9229、9222 和 9230。`DSH_DESKTOP_MAIN_INSPECT_PORT`、`DSH_DESKTOP_RENDERER_DEBUG_PORT` 与 `DSH_DESKTOP_HOST_INSPECT_PORT` 可以替换这些端口，`DSH_DESKTOP_OPEN_DEVTOOLS=0` 则保持 Renderer 调试窗口关闭。

显式构建完成后，`start:desktop` 会重新生成一次性项目，并跳过构建直接启动已有产物：

```sh
pnpm run start:desktop
```

Workspace 开发使用调用命令的 Node.js 运行当前 CLI 与私有 Desktop Host 包，并禁用桌面包修改；只有该模式明确链接的一次性 profile 可以从自身目录外解析 bundle。需要验证内置 Node.js、内置 pnpm、内置 dsh 资源、插件安装和修复时，应运行未封装安装器的应用目录。

## 打包

正常打包只需执行一条完整命令。该命令会先准备发布资源，再生成 Linux 安装包与更新元数据。目标要求通过 `DSH_DESKTOP_APP_ID` 提供反向域名形式的应用 ID：

```sh
export DSH_DESKTOP_APP_ID='<reverse-DNS application ID>'
```

无需提前执行 `prepare:desktop`：

```sh
pnpm run package:desktop
```

发布自动化使用固定目标命令，确保运行时准备、dsh 准备与 electron-builder 接收相同的平台和架构：

```sh
pnpm run package:desktop:linux:x64
```

该命令要求 Linux x64，会生成 `.deb` 安装包和 AppImage；AppImage 作为 electron-updater 更新负载，因为 Debian 包无法携带差分更新。

每个目标都在 `apps/desktop/.desktop-build/targets/<target>/` 下持有自己的打包输入、已准备运行时、包集合、dsh 依赖树、pnpm 准备状态、未打包应用、更新元数据和最终产物。Node.js 归档缓存继续由 `.desktop-build/downloads` 共享，因为每个归档文件名都包含版本、平台和架构，并且在解包前经过验证。目标构建绝不读取其他目标的可变准备状态。

### 运行时文件筛选

生产包首先经过 npm 发布规则和依赖安装。[桌面文件规则](scripts/runtime-file-policy.ts)随后在完整性封存之前过滤不可变的打包 `dsh/node_modules` 副本。它排除 TypeScript 声明、明确属于 JavaScript/CSS/TypeScript 的 source map、TypeScript 构建缓存、Domino 测试目录、指定的原生编译产物，以及其他平台的 node-pty 预构建文件。它保留运行时 JavaScript、原生模块及其 DLL/EXE 辅助程序、WASM、未知资源、许可证和声明。规则不会修改 npm tarball、内置包管理器或用户安装的插件文件。

打包应用运行编译后的 JavaScript 和预生成的 Typert 元数据，不编译 TypeScript 插件。源码级调试导航和编辑器声明仍可从开发包中获取。[复制规则测试](tests/runtime-file-policy.spec.ts)覆盖排除项和保留资源；`prepare:dsh` 先用内置 Node 执行[产物 smoke](tests/fixtures/runtime-payload-smoke.mjs)，再在打包的 Electron 下加载内置的 node-addon-require-builtin（[指纹 smoke](tests/fixtures/native-electron-fingerprint-smoke.mjs)），然后才进行 Host smoke 和最终清单验证。

### 更新分发

打包写入的 `app-update.yml` 以 `provider: github` 指向独立发布仓库 `Oissp/dsh-desktop-linux-release`，并以 `--publish never` 让 electron-builder 自己不上传任何东西。[发版工作流](../../.github/workflows/package-deb.yml)用该仓库的产物创建 `v<version>` GitHub Release：`.deb`、AppImage 与 `latest-linux.yml` 频道元数据。

AppImage 是 electron-updater 的更新负载，因为 Debian 包无法携带差分更新。electron-updater 从已安装版本的预发布段推导要跟随的 release，因此 `0.1.6-alpha.2.1` 安装跟随 `alpha` 版本。更新从公开的发布仓库匿名读取，打包与发版都不需要上传凭据或部署环境。

使用对应的 `:dir` 命令可以生成可直接运行的应用目录，而不是安装包，例如：

```sh
pnpm run package:desktop:dir
pnpm run package:desktop:linux:x64:dir
```

需要检查或诊断为宿主目标准备的资源而不调用 electron-builder 时，可以让同一流水线在准备完成后停止：

```sh
pnpm run prepare:desktop
```

这条诊断命令是另一种停止位置，并非两条命令构建流程的前半段。之后执行 `package:desktop*` 时仍会重新完成正式构建与准备，避免使用陈旧的 dsh 包、运行时文件或 dsh 内容。

每条打包命令都会构建仓库，打包以 dsh 和私有 Desktop Host 为根的第一方生产依赖闭包，并准备目标专用的 Node 与 pnpm 可执行文件。`prepare:dsh` 在构建时安装一次生产依赖图，把物化包复制到将由 electron-builder 打进 `app.asar` 的 `dsh` 树，移除包管理器元数据，并生成包含共享包版本和最终文件哈希的 `desktop-runtime.json`。在完整性封存之前，[Electron 指纹调和器](scripts/native-electron-fingerprint.ts)会把内置 node-addon-require-builtin 记录的 Electron profile（加载器按 Node.js 版本三元组加 V8 版本字符串精确匹配）改写为打包 Electron 的标识——Electron 补丁版本会在同一大版本内移动这两者；随后在实际的 Electron 二进制下加载该加载器，作为打包验收门槛。资源映射明确包含默认根目录过滤器会忽略的 `dsh/node_modules`；复制后的清单在复制完成时验证一次，并在运行时 smoke 之后再验证一次，两次都在 electron-builder 运行之前。已安装应用升级和各目标原生模块的验收需要发布环境。

未压缩产物包含 Electron 壳（物化后的 dsh 生产依赖树打包在其 `app.asar` 内）、上游 Node.js 与 pnpm。安装包大小与文件系统占用不同；发布验收需要测量两者，以及 profile 插件存储和首次启动耗时。此布局用更多应用内文件换取消除用户机器上的核心包安装过程。

## 更新

打包应用会在主窗口打开十秒后检查目标专用的发布流；本地化的 **检查更新…** 菜单项会手动触发同一检查。发现可用版本时，应用打开一个 Shell 自有的确认模态。用户确认后，应用等待正在进行的检查完成，下载并验证 Desktop 发布、停止 dsh 子进程，并把安装与重启交给 electron-updater。下次启动在显示本地加载页的同时校准版本绑定的运行时。

Shell 提示是产品窗口的模态子窗口，其文档从 `dsh-app://shell/` 加载，由 protocol handler 从打包的 `renderer` 目录读取。在能合成透明窗口的平台上，无边框覆盖层连同变暗遮罩盖住父窗口内容。Linux 改用居中于父窗口的不透明卡片：未被合成的透明窗口会把 alpha 画成不透明底色。强制更新模态提供原生移动、缩放与最大化，因此除 macOS 外都使用带边框窗口。

打包为 `DSH_DESKTOP_AUTO_UPDATE_ENV` 选择的部署生成 generic-provider 频道元数据。AppImage 目标内嵌 blockmap，让 electron-updater 可以复用未变化的数据块；`.deb` 安装包不是 updater 的载荷。运行时与桌面壳仍属于同一个 Desktop 发布。

## 底层开发覆盖项

未打包的 Electron 进程使用应用目录下的 `.desktop-build/development/project` 作为开发项目。`DSH_DESKTOP_NODE_BINARY`、`DSH_DESKTOP_PNPM_ENTRY` 和 `DSH_DESKTOP_DSH_DIR` 用于选择明确的运行时资源。打包应用会忽略这些变量，从 `process.resourcesPath` 解析资源，并使用受管 Desktop profile。

## 已知限制

- Desktop 禁用 Web 的「在本地应用中打开…」操作，因为其 Host 插件依赖 HTTP 路由，而 Desktop 不提供 `webServer`。
- 发布更新托管和跨上一版本的已安装产物验证需要生产发布环境。
- 依赖包含 lifecycle script 的桌面插件，只有其包名进入桌面项目经过评审的 `allowBuilds` 策略后才能安装。
- 桌面壳与 CLI dsh 共享 `$DSH_HOME` 下的会话、设置、凭据、工作区和存储，但可执行包、插件激活、锁文件与包管理器状态彼此隔离。
