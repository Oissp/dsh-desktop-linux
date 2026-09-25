# Agent Note: 同步上游 0.1.6-alpha.1——采纳 asar 运行时与延迟组合装配，保留 Linux 裁剪

Status: implemented

[English](2026-09-15-sync-upstream-0.1.6-alpha.1-adopt-asar-runtime-and-lazy-combo.md) | 中文

## 问题

本 fork 上次跟随 `deepseek-ai/deepseek-harness` 至 `dsh-v0.1.5-rc.2`（PR #3977）。上游发布了 `0.1.6-alpha.1`（PR #4171），自同步点起推进 599 个提交。定时的 `sync-upstream.yml` 会把 `upstream/master` 合并进 `main`，但三处 fork 本地分叉与上游在同一批文件上的改动相撞：桌面打包布局、客户端包组合路径，以及 Linux-only 的 CI 与平台裁剪。

## 决策

**采纳上游的 ASAR 运行时打包；放弃 fork 的 `extraResources/dsh` 布局与 `afterPack` 校验。** 上游的 `feat(desktop): run runtime host from asar`把 dsh 生产树经 `files: [{ from: buildPaths.dsh, to: 'dsh', filter: ['**/*'] }, …]` 与原生模块的 `asarUnpack` 移进 `app.asar`；`main.ts`/`host-process.ts` 在打包态以 `join(app.getAppPath(), 'dsh')` 解析运行时，宿主子进程以 `ELECTRON_RUN_AS_NODE: '1'` 跑在 `process.execPath` 上。fork 的 `apps/desktop/electron-builder.config.mjs` 曾把 dsh 放 `extraResources` 并在 `afterPack` 校验 `resources/dsh`；该目标路径在 ASAR 模型下已不存在，而自动合并后的 `main.ts` 已实现上游解析（fork 从未改过这些区域）。解析后的配置保留上游的 `files`/`asarUnpack`，保留 fork 的 Linux-only 面（硬编码 `linux-x64` 的 `artifactName`、`deb` + `executableName` + `icon`、指向 `Oissp/dsh-desktop-linux-release` 的 GitHub Releases `publish` provider，以及四对托盘/窗口图标 `extraResources`），并删除两条 dsh `extraResources` 条目与 `afterPack` 钩子。运行时树校验仍在 `prepare:dsh` 构建期运行（`prepare-dsh.ts` 中的 `verifyDesktopRuntime`），这正是上游依赖之处；fork 额外加的打包态复检无上游对应、也无剩余路径可查。

**采纳上游的延迟客户端组合装配；退役 fork 的 encode-once 优化。** 上游的 `perf(web): defer client combo assembly`以 `LazyResponse`/`ComboResource` 替代急切构造：`buildCombo` 返回一个计划，其 `scriptBody`/`sourceMapBody` 是 `lazyBody` thunk，在首次取用时物化一次并按 combo 记忆。`buildCombo` 因此离开 `ready` 路径，每个组合在请求时编码一次，而非每次激活遍都编码。fork 的 encode-once 改动（`2026-09-12-client-bundle-composition-encode-once.md`）曾以把每个 bundle 预编码为 `ComboSegment` 解决同一 `buildCombo` 启动开销；上游现已提供维护中的等价方案，故 `packages/client/modules/src/index.ts` 整体取上游版本。`registry.fetchBundle` 变为 `async`；`benchmarks/client-bundle-composition/client-bundle-composition.worker.ts` 随之 `await`。该 benchmark 的 113 ms 预算按 fork 的急切模型校准，现包含首次取用的 body 物化，其 `test:bench` 回归门禁可能需重新校准；`package-deb` 不跑 `test:bench`，故桌面发版不受阻。

**Linux-only 的 CI 与平台裁剪以 modify/delete 方式保留。** fork 删除了上游的 `ci.yml`、`ci-master.yml`、`e2e.yml`、`e2b-e2e.yml`、`issue-lifecycle.yml`、`issue-policy.yml`、`python-release.yml`、`build-exe-for-python-sdk.yml`，以及 macOS 桌面 spec（`macos-signature.spec.ts` 及同级文件），仅运行 `package-deb.yml`。上游自同步点起修改了其中七个 workflow 与 `macos-signature.spec.ts`，形成 modify/delete 冲突。每一处都解析为 fork 的删除：fork 无法运行 Windows/macOS CI 或对 macOS 产物签名，恢复这些 workflow 只会加入 fork 不执行的 Actions。裁剪清单（`.github/sync-trimmed-paths.txt`）自动解决这类冲突：清单内路径保留 fork 的删除结果，干净合并会移除上游重新带回的清单内文件。

**桌面版本跟随引擎。** `apps/desktop/package.json` 版本为 `0.1.6-alpha.1`，与合并后根 `package.json` 的引擎版本一致，遵循发行身份规则（Electron 与 `@deepseek-ai/dsh` 共用一个精确版本）。合并推送触发 `package-deb.yml`（`paths: package.json, apps/desktop/**`），向 `dsh-desktop-linux-release` 发布尚不存在的 `v0.1.6-alpha.1`。

## 测试

Host 与 client 两面类型检查通过（`tsc -b tsconfig.host.json`、`tsdown --env.DSH_BUILD_FACE host` 生成 typert 命名空间声明、`tsc -b tsconfig.client.json`）。`apps/desktop/tests` 28 个文件 176 项通过——即 `package-deb` 门禁，含 `main-startup`、`host-process`、`runtime-tree`、`package-target`、`release-version`。`packages/client/modules/tests` 85 项通过。`verify-third-party-notices` 报告重新生成的 `THIRD_PARTY_NOTICES.md` 已最新。

## 考虑过的替代方案

**保留 fork 的 `extraResources/dsh` 布局并回退上游的 ASAR `main.ts` 改动。** 否决：与维护方向相悖，在 `main.ts`/`host-process.ts`/`electron-builder.config.mjs` 上重建每次同步的冲突，且 fork 该布局的唯一理由——上游在 fork 起步时无 Linux 打包——已随上游交付 ASAR 模型与 Linux target 而消失。

**保留 fork 的 encode-once 并与上游延迟装配合并。** 否决：两者优化同一 `buildCombo` 开销；合并会使 encode-once Note 明确避免的保留字节数翻倍，并在上游热点路径上重建 fork 本地分叉。上游的记忆化 lazy body 已对每个组合编码一次。

**整体取上游的 `electron-builder.config.mjs`。** 否决：它携带 macOS/Windows 签名、NSIS、generic COS `publish` provider 与 `${os}-${arch}` `artifactName`，Linux-only 的 fork 均不交付。并集保留上游的 ASAR 字段与 fork 的 Linux 发行身份。

## 后果

`main` 跟随上游 `0.1.6-alpha.1`。fork 的桌面打包现与上游 ASAR 运行时模型一致，故后续 `electron-builder.config.mjs` 冲突缩减至 Linux-only 字段。encode-once Agent Note（`2026-09-12-client-bundle-composition-encode-once.md`）描述的是上游已取代的 fork 优化；它作为 fork 调查的历史记录保留，不再是组合路径的现行权威。client-bundle-composition benchmark 的预算可能需在另一改动中按延迟模型重新校准。
