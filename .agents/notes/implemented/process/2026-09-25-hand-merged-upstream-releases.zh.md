# Agent Note: 上游发布由人工合并

Status: implemented

[English](2026-09-25-hand-merged-upstream-releases.md) | 中文

## Problem

`.github/workflows/sync-upstream.yml` 按每日 UTC 06:00 的定时把 `deepseek-ai/deepseek-harness` 的 `master` 合并进 `main`，但仅在上游根 `package.json` 版本严格大于本 fork 时才合并——这一比较由 `scripts/compare-dsh-versions.mjs` 完成。落在 `.github/sync-trimmed-paths.txt` 清单内的路径冲突自动解析为保留 fork 的删除；清单外的冲突则中止合并并开 issue 通知人工。

凡是真有发布要合并的运行，都在清单外产生了冲突，因此「中止并通知」才是常态：任务报出问题，人工解决合并并跑过门禁，合并最终还是靠人手落地。该 workflow 给同一次合并加了第二条无人值守的入口，却没有替代人工那条，而 fork 需要盯的恰恰是那些中止的运行。

## Decision

上游发布由人工合并进 `main`。`.github/workflows/sync-upstream.yml` 及其 semver 门禁 `scripts/compare-dsh-versions.mjs`、`scripts/compare-dsh-versions.d.mts`、`scripts/compare-dsh-versions.spec.ts` 一并删除；该门禁没有其他使用方。

`.github/sync-trimmed-paths.txt` 保留。它是 [`scripts/verify-md-links-trimmed.ts`](../../../../scripts/verify-md-links-trimmed.ts) 的输入，用来豁免指向 fork 不携带文件的相对链接，删掉它会让链接门禁在 72 条上游链接上失败。它不再是 workflow 的状态：合并时由人工阅读，其文件头、该脚本的 JSDoc，以及 [fork 裁剪链接门禁](2026-09-20-fork-trimmed-link-gate.zh.md) 这条 Note 都已如此记述。

`docs/development.md` 把只构建 `.deb` 的 PR 冒烟 [package-deb-test.yml](../../../../.github/workflows/package-deb-test.yml) 与 `package-deb.yml` 并列为 fork 的 workflow，并记述上游发布由人工合并。

## Alternatives considered

**修复该 workflow 而不是删除。** 否决：清单外的冲突正是 fork 有意为之的分叉——Linux 托盘与更新表面、客户端包组合路径、桌面打包布局——每一处的解决都需要各自合并 Note 记录的那种判断。workflow 无法套用任何规则来解决它们，因此「修复」等于让它学会 fork 的全部分叉，而这恰恰是它本应免除的人工工作。

**保留为只比较版本、开 issue 而不合并的通知器。** 否决：比较本身只是一次 `git ls-remote` 加一次版本读取，而 fork 仍然得去留意那个 issue。在已经决定要合并时顺手跑一下更省事。

**保留 `scripts/compare-dsh-versions.*` 以备 workflow 回归。** 否决：无使用方的脚本及其 spec 仍会被 `pnpm run test` 收集，仍需维护，而这段比较逻辑要重写也不过三行。

## Consequences

上游跟进现在取决于是否有人去合并；没有任何东西会报告新发布的存在。裁剪清单是链接门禁的承重输入且由人工维护，因此一次合并若删掉文件却没登记进清单，失败的是 `doc-sync` 而不是那次合并。

## Testing

`pnpm run test:docs` 全部 20 项文档门禁通过，其中 `markdown links` 会读取该裁剪清单。在代码树上 `grep`，除本 Note 自身外，找不到任何对 `sync-upstream.yml` 或 `compare-dsh-versions` 的引用。
