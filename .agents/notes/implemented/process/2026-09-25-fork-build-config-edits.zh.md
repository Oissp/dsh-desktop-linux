# Agent Note: 对上游自有构建与依赖配置的 fork 改动

Status: implemented

[English](2026-09-25-fork-build-config-edits.md) | 中文

## Problem

0.1.7-rc.2 合并把工作区推进到 `tsdown@0.22.2` 与 `rolldown@1.1.1`。合并之后的 `package-deb.yml` 运行报出三处来自 fork 自有副本的警告：

- `` `noExternal` is deprecated. Use `deps.alwaysBundle` instead.``——两个 tsdown 配置。
- `` `inlineDynamicImports` option is deprecated, please use `codeSplitting: false` instead.``——三个。
- Web 客户端构建的 `(!) Some chunks are larger than 500 kB after minification`：`vendor` 740.58 kB、惰性 `langs/cpp` 语法 637.59 kB、`index` 629.23 kB。

同一提交上的 Dependabot 运行因 `@vitest/mocker` 与 postcss 报 `security_update_not_possible` 而失败。没有任何 manifest 声明 postcss，它只能作为传递依赖被解析移动；声明 `vitest` 的四个 manifest 写的是 `^4.1.8`，而 `vitest@4.1.8` 精确要求 `@vitest/mocker@4.1.8`，因此在 vitest 先移动之前，打过补丁的 `@vitest/mocker` 无法被解析到。

## Decision

**四个 tsdown 配置改用现行选项名。** `packages/experimental/webworker-runtime/tsdown.config.ts` 与 `packages/ptc-runtime/ptc-runtime-node/tsdown.config.ts` 把 `noExternal` 换成 `deps.alwaysBundle`；`webworker-runtime`、`packages/experimental/inspector/tsdown.config.ts`、`packages/experimental/browser-use-stagehand-native/tsdown.config.ts` 把 `outputOptions.inlineDynamicImports: true` 换成 `outputOptions.codeSplitting: false`。每一对都是同一选项的现名，Testing 中的同构构建校验证实了这一点。

**Web 客户端构建声明自己的分块预算。** `apps/web/vite.config.ts` 设 `chunkSizeWarningLimit: 800`。500 kB 的默认值早于这套分块方案：`vendor` 有意把整个重型渲染家族——KaTeX、带三个启动语法的 Shiki、micromark 流水线——作为一条只在依赖升级时才变化的缓存条目承载，而最大的惰性 `@shikijs/langs` 语法是单个生成文件。两者按设计就超过 500 kB，再拆分只会毁掉 `VENDOR_PACKAGES` 注释所记述的缓存局部性。上限紧贴最大的实际产物，真正的体积增长仍会触发警告。

**vitest 家族整体提到 `^4.1.11`。** `vitest` 与 `@vitest/coverage-v8` 在声明它们的四个 manifest 中升级——根 `package.json`、`apps/web`、`packages/test-support/client-runtime`、`packages/test-support/session-snapshot`——`@vitest/spy` 则在 `packages/test-support/remote-mock` 升级，那是唯一直接声明它的 manifest。`pnpm update postcss --recursive` 把 postcss 浮动到 8.5.28 并去掉重复项。

## Alternatives considered

**保留弃用警告。** 否决：它们指向 tsdown 已经替换掉的选项，下一个大版本就会移除，届时这四个配置将无法构建。改名是机械的，且可证明不改变行为。

**继续拆分 `vendor` 直到每个分块都在 500 kB 以下。** 否决：能把渲染家族压到 500 kB 以下的拆法是任意的，且会破坏分块方案赖以存在的缓存局部性——一次依赖升级会重算不止一个分块的哈希，回访客户端将重新拉取整个渲染家族。

**用 pnpm override 钉住 `@vitest/mocker` 而不移动 vitest。** 否决：那会把 vitest 留在 4.1.8，同时把它精确声明的一个依赖强推到它并未声明的版本，这正是 override 会掩盖而非修复的不匹配。

**只改 Dependabot 告警点名的那些 manifest。** 否决：`pnpm update vitest` 会重新解析 vitest 及其依赖，但不会解析由 `packages/test-support/remote-mock` 直接声明的 `@vitest/spy`，于是工作区里留下两份 `@vitest/spy`——test-support 包用 4.1.8，vitest 用 4.1.11。任何 `vitest` manifest 留着 `^4.1.8` 同样会让第二份 vitest 解析并存。

## Consequences

这些文件现在都与上游副本不同。上游若提交了同样的 tsdown 选项改名，fork 的改动即成为空操作、可干净合并；上游若重构这些配置、`apps/web` 的分块方案或那四处 `vitest` 范围，则会产生冲突，解决方式是保留 fork 的取值，除非上游已经改到同一个值。

本次锁文件刷新还浮动了一批两个安全目标之外的传递依赖——`qs`、`minimatch`、`lightningcss`、`js-yaml`、`fs-extra`、`brace-expansion`、`ws`、`picomatch`、`nanoid`——全部落在各自声明的范围内，且都通过了 `minimumReleaseAge` 供应链策略。

## Testing

四处 tsdown 改名以「改动前后各构建一次、逐文件比对 SHA-256」验证：四个包共 1013 个产物文件全部一致。`pnpm --filter @deepseek-ai/dsh-web-frontend run build` 产出的三条分块哈希与声明预算之前相同，且不再发出警告。

`pnpm run build` 与 `pnpm run hygiene`（18 项门禁）通过，`pnpm run lint` 干净，`pnpm run test:docs` 全部 20 项文档门禁通过。`pnpm exec vitest run apps/desktop/tests`——即 `package-deb` 门禁——65 个文件 724 项测试通过；受本次版本升级影响的三个包 24 个文件 173 项测试通过。

版本变更后，`pnpm run build` 内部的增量 `tsc -b` 在两个客户端 fixture（`packages/client/ui-sidebar-browser/tests/electron-harness.client.ts` 与 `packages/experimental/client-ui-voice-input/tests/audio-fixture.client.ts`）上报 TS2883，指向 `@vitest/spy` 解析出的 `Procedure`。这两个文件都不在本次改动范围内，而同一棵代码树上 `tsc -b tsconfig.client.json --force` 不报任何错误；强制重建刷新工程状态后，完整的 `pnpm run build` 通过。因此依赖版本变更后应视为需要一次强制重建，增量客户端类型检查在此之前不构成证据。
