# Agent Note: Fork-trimmed links are declared, not rewritten

Status: implemented

[English](2026-09-20-fork-trimmed-link-gate.md) | 中文

## 问题

本 fork 让上游 Agent Note 与根 `AGENTS.md` 保持逐字节一致，只删掉自己不携带的上游文件与 README 章节。上游正文仍然链向被删掉的内容：72 条链接指向 [sync-trimmed-paths.txt](../../../../.github/sync-trimmed-paths.txt) 里列出的文件，另有 3 条指向 fork 从 `apps/desktop/README.md` 删掉的章节。

`verify-md-links` 要求每条相对链接都能解析，于是 `pnpm run test:docs` 报出 75 条断链。除非改写上游文件，fork 侧无法修复它们——而那会让之后的每次上游合并，恰好在本 fork 刻意不动的这些文件上产生冲突。

## 决策

[verify-md-links-trimmed.ts](../../../../scripts/verify-md-links-trimmed.ts) 是该门禁在 fork 里的驱动，`package.json` 的 `verify-md-links` 脚本运行它。它从未经改动的上游 [verify-md-links.ts](../../../../scripts/verify-md-links.ts) 导入 `markdownLinkSourcePaths`、`findViolations` 与 `anchorCache`，只在链接目标命中 fork 裁剪清单中的某一行时扣下该违规：

- [sync-trimmed-paths.txt](../../../../.github/sync-trimmed-paths.txt)——fork 不携带的上游文件，按仓库相对路径作键。该清单由人工维护。
- [md-links-trimmed-sections.txt](../../../../.github/md-links-trimmed-sections.txt)——从 fork 保留的上游文件中删掉的章节，按 `path#fragment` 作键。

缺失文件以路径作键，缺失锚点以路径加锚点一起作键。其余断链照旧失败；通过时运行会报告扣下了多少条链接。

三条章节条目指向 Desktop README 的 `#windows-ev-signing` 与 `#release-versions`。本 fork 只打包 Linux，不携带 Windows 签名流程；它的 Desktop 版本在内置 dsh 版本后追加 `.N` 构建后缀，而不是上游的 `.YYYYMMDD.index`。

## 考虑过的替代方案

**改写上游笔记，把裁剪目标改成非链接。** 这能在源头修好链接，但要改动 62 个上游文件，下一次上游合并会在每个文件上冲突——正是 fork 的裁剪清单要避免的代价。

**接受门禁红灯。** `test:docs` 会每次运行都是红的，真正的断链与这 75 条已知项再也分不出来。

**在 Desktop README 里恢复被删的章节。** 本 fork 不做 Windows 签名，而上游的发布版本章节描述的是一套已被 fork 替换的方案；两个章节都会描述 fork 并不做的事。

**直接改上游门禁。** 本 fork 从未修改过上游脚本，而驱动自身的 CLI 入口由 `import.meta.filename` 守卫，因此导入式包装无需改动上游。

## 影响

上游文件保持逐字节一致，上游合并保持自动。门禁不再证明指向 fork 裁剪路径的链接可解析——那些目标在本 fork 里不可能存在，所以这项检查本就无法满足，而非提供了信息。

新删掉的文件或章节必须登记：文件进 `sync-trimmed-paths.txt`，章节进章节清单，否则指向它的链接会让门禁失败。

上游门禁仍作为被导入的模块存活，因此上游对源文件发现、锚点 slug 与输出格式的改动无需合并即可到达 fork。

## 测试

`pnpm run verify-md-links` 检查 2013 个文件，扣下 75 条链接。新增一个含缺失目标、以及指向未登记章节的缺失锚点的文档，两者都会被报出并以 1 退出。[verify-md-links-trimmed.spec.ts](../../../../scripts/verify-md-links-trimmed.spec.ts) 覆盖目标作键、锚点作键、百分号转义与清单解析。`pnpm run test:docs` 报告 20 passed、0 failed。
