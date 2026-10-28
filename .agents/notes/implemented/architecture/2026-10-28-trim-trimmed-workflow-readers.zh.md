# Agent Note: 裁剪读取已裁剪打包 workflow 的 spec

Status: implemented

[English](2026-10-28-trim-trimmed-workflow-readers.md) | 中文

## Problem

`scripts/macos-package-workflow.spec.ts` 与 `scripts/desktop-publish-workflow.spec.ts` 在模块作用域读取 workflow 文件，而 fork 裁剪了它们加载的三个 workflow：`macos-package.yml`、`macos-intel-package.yml` 与 `desktop-publish.yml`。两个 spec 因此在 Vitest 收集阶段就抛 `ENOENT`，一次运行既不报测试也不报断言；任何包含 `scripts/**/*.spec.ts` 的调用都在执行任何测试前失败。

alpha.4 与 alpha.5 合并有意保留了这两个 spec，同时裁剪了后来新增的同类 spec（[alpha.4](2026-10-16-merge-0.2.1-alpha.4-linux-desktop.zh.md)、[alpha.5](2026-10-16-merge-0.2.1-alpha.5-linux-desktop.zh.md)）。0.2.2-alpha.2 合并随后裁剪了读取同一批 workflow 的 `scripts/desktop-package-forms.spec.ts`，于是被裁剪的 reader 与两个同样会失败、却被保留的 reader 并存（[合并笔记](2026-10-28-merge-0.2.2-alpha.2-linux-desktop.zh.md)）。

## Decision

两个 spec 一并裁剪，`.github/sync-trimmed-paths.txt` 现为 418 条。

保留决定的依据是：fork 若将来采纳 macOS 打包或 COS 发布管线，这些断言仍然可用。fork 无法采纳：`desktopTargetPlatform` 返回 Linux x64，`electron-builder.config.mjs` 没有 mac 或 win 配置块，CI 只通过 `package-deb.yml` 与 `package-deb-test.yml` 运行 `apps/desktop/tests`。断言保存在上游历史的版本里，将来采纳时可以从上游恢复，而不必留在本仓库。

## Alternatives considered

**保留两个 spec，并在 workflow 文件缺失时跳过。** 拒绝：守卫要写进 fork 无法执行的上游文件里，上游每次修改这两个 spec 都得重新应用，而且结果套件仍然没有任何通过测试。

**只裁剪 `scripts/macos-package-workflow.spec.ts`。** 拒绝：两个 spec 共享同一个条件和同一条记录的决定；只裁剪一个会让 `scripts/desktop-publish-workflow.spec.ts` 继续破坏收集，而裁剪清单上却显示这一类已经处理完毕。

**两个 spec 原样保留。** 拒绝：`pnpm run test` 以及任何 `pnpm exec vitest run scripts` 调用都在收集阶段失败，且这种失败看起来像代码损坏，而不是已记录的裁剪。

## Consequences

今后上游修改任一 spec 都只会产生由裁剪清单自动消化的 modify/delete 冲突，而不是守卫代码里的冲突。

若 fork 将来采纳 macOS 打包或 COS 发布管线，两个 spec 应与其覆盖的 workflow 一起从上游历史恢复；只恢复 spec 而不恢复 workflow 会重新引入收集失败。
