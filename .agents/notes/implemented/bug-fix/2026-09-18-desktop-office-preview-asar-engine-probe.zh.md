# Agent Note: 打包后的 Linux Office 预览需要 fork 给 LibreOffice kit 打补丁

Status: implemented

[English](2026-09-18-desktop-office-preview-asar-engine-probe.md) | 中文

## Problem

侧边栏预览通过 `@deepseek-ai/libreoffice-kit` 转换 Office 文档，该 kit 在 macOS 与 Windows 上选择原生引擎，在 Linux 上选择 WASM 引擎。回退之前它会用 `installedPackageExists` 探测原生包，实现为 `lstatSync(path, { throwIfNoEntry: false }) !== void 0`。对 `app.asar` 内不存在的路径，Electron 的 asar fs shim 返回 `null` 而非 `undefined`，而 `null !== undefined` 为真。于是缺失的 `@deepseek-ai/libreoffice-kit-linux-x64-glibc` 被读成"已安装但不完整"，`resolveEngine` 抛出异常，WASM 回退永不执行，打包后的 Linux 应用中每次预览转换都失败。开发运行与打包期的 runtime smoke 读取真实文件系统，缺失路径返回 `undefined`，因此两者都复现不了。

涉及的并不只有 kit 自身。`apps/desktop-host/src/office.ts` 为打包场景改写了引擎说明符，但该改写只作用于模块解析；探测从 `require.resolve.paths` 取目录并直接 stat，看到的仍是 asar 路径。

## Decision

fork 给 kit 打补丁，而不是等上游发版。`patches/@deepseek-ai__libreoffice-kit@0.1.0.patch` 把探测改写为在 `try` 中执行 `Boolean(lstatSync(...))`，把假值 stat 与抛出的 stat 都视为不存在。补丁在 [pnpm-workspace.yaml](../../../../pnpm-workspace.yaml) 的 `patchedDependencies` 中声明，这正是让 pnpm 在工作区各处安装已打补丁副本的依据。

补丁之所以能进入打包产物，是因为 [prepare-dsh.ts](../../../../apps/desktop/scripts/prepare-dsh.ts) 携带了它：`applyRuntimePatches` 在正式安装前把仓库的补丁文件及其 `patchedDependencies` 条目复制进临时构建根，并以生成的 lockfile 中出现的 `name@version` 为键筛选。缺少这一步时，即使仓库声明了补丁，打包运行时仍会带上未打补丁的包。

声明与文件名都带 kit 版本，且 pnpm 在 lockfile 中记录 patch hash，因此 kit 升级会让补丁失效。用 `pnpm patch @deepseek-ai/libreoffice-kit@<version>` 加 `pnpm patch-commit` 重新生成，并确认解析到的是 `_patch_hash=` 目录下的副本。

## Alternatives considered

**等上游修好探测。** 否决：该缺陷在 kit 0.1.0 中依然存在，而上游 0.1.7 的 Office 工作只是把创作技能改走独立 CLI 进程，侧边栏预览仍在 Electron 进程内解析引擎，所以在探测本身被修好之前，打包后的 Linux 预览一直是坏的。

**像技能那样让预览也走独立 CLI。** 否决：预览是在 Electron 进程内应答的 Host RPC（`officeToPdf.render`），而 CLI 路径存在的意义是给模型创作的 Office 工作一个受控子进程。把预览搬到那条路径上改变的是 RPC 及其取消行为，而不只是探测。

**在 Host 侧预先解析引擎再注入。** 否决：`resolveEngine` 接受可注入参数，但 `office-to-pdf` 通过 kit 的 `createConverter` 构造转换器，后者在内部完成解析，Host 没有可注入的接缝，除非改动 kit。

**在打包期删除原生引擎包。** 否决：`runtime-file-policy.ts` 已经在裁剪其他平台的引擎，但探测寻找的是 fork 从不安装的包，裁剪无法改变它找到的结果。

## Consequences

打包后的 Linux 构建保留可用的 Office 预览。代价是 fork 长期维护一个第三方包的补丁，且有两条只在打包构建中显形的失败路径：kit 升级会静默让补丁失效；把 `pnpm-workspace.yaml` 按上游一侧解决的合并会同时丢掉声明与补丁文件。第二条已经发生过：0.1.7-alpha.1 的合并把两者都移除，0.1.7-alpha.1 至 0.1.7-alpha.2.1 因此无法预览任何 Office 文档。

当 kit 把假值 stat 视为不存在，或侧边栏预览不再在 asar 内解析引擎时，本补丁即可退役。在那之前，上游若重构 `lib/index.js` 的引擎解析，或重构 `pnpm-workspace.yaml` 的 `patchedDependencies` 块，都需要在其之上重新套用本改动。

## Testing

`pnpm exec vitest run apps/desktop/tests` 覆盖打包门禁，其中 `prepare-dsh.spec.ts` 钉住"只携带已安装包的补丁并在构建工作区中声明它们"。`packages/document/office-to-pdf/tests` 覆盖转换服务。补丁本身通过读取解析结果验证：工作区必须链接到 `@deepseek-ai+libreoffice-kit@0.1.0_patch_hash=*`，且该副本的 `installedPackageExists` 必须是 `Boolean(...)` 形式。`pnpm run hygiene` 会重新生成 `THIRD_PARTY_NOTICES.md`，其中披露了被打补丁的包。
