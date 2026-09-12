# Agent Note: 桌面打包 CI——确定性缓存键与发布说明边界

Status: implemented

[English](2026-09-12-desktop-package-ci-cache-key-and-release-notes.md) | 中文

## 问题

桌面打包工作流交付的引擎构建缓存是坏的，发布说明则一直在累积全量历史。

`hashFiles()` 在工作区上求引擎缓存键，而 `packages/**`、`vendor/**`、`native/**`、`apps/desktop-host/**` 这些模式同样命中 `pnpm install` 创建的 `node_modules` 和 `prepare:*` 阶段写入的构建产物。相同的源码在两次 run 里算出三个不同的键——run 1 算出 `5d060509…`，run 2 在 restore 算出 `194d1927…`、在 save 算出 `883de9b8…`——于是缓存永远不命中，save 步骤每次都写一个新条目。

发布说明用 `git log "$(git describe --tags --abbrev=0)"..HEAD` 生成。本仓库携带的是上游引擎 tag（HEAD 处为 `dsh-v0.1.5-rc.2`），桌面发布不会推进这些 tag——桌面发布 tag 位于独立的 `dsh-desktop-linux-release` 仓库。因此每次发布都重复自引擎 tag 以来的全部历史（97 → 106 → 113 条提交），且发布仓库的所有 tag 都指向同一个提交，因为 `gh release create` 打的是该发布仓库不变的 `main` HEAD。

## 决策

**引擎缓存键。** 新增 `Compute engine cache key` 步骤，用 `git ls-files <pathspecs> | git hash-object --stdin-paths | git hash-object --stdin` 只哈希已跟踪源码。`git ls-files` 输出已排序，并排除未跟踪的 `node_modules` 与构建产物；pathspec 列表仍刻意排除 `apps/desktop/package.json`，使纯版本 bump 能命中缓存。restore 与 save 都使用 `steps.engine-key.outputs.key`。依赖版本变化仍由 `pnpm-lock.yaml` 捕获（它在 pathspec 列表内）。

**发布说明。** notes 步骤遍历 `git log HEAD -- apps/desktop/package.json`，找到版本号与当前发布版本不同的最近一个提交，再以 `git log <该提交>..HEAD` 生成日志。桌面版本只存在于 `apps/desktop/package.json`；该提交即上一版桌面发布的边界。找不到上一版本时回退到最近 50 条提交。说明现在带 `自 v<上一版> 以来` 的范围行。

## 备选方案

**保留 `hashFiles` 但控制文件集合。** `hashFiles` 不支持排除模式，其遍历顺序也无法从工作流表达式控制，因此 node_modules 污染与跨 run 顺序问题都无法在表达式一侧修复。

**给源码仓库打桌面版本 tag。** 桌面 tag 能让 `git describe` 可用，但源码仓库是刻意保留上游 tag 的 fork，桌面发布又发往独立仓库；在这里铸造交错的 `v0.1.5-rc.2.N` tag 会污染 fork 的 tag 命名空间。

## 后果

纯版本 bump 现在能恢复引擎缓存并跳过 `prepare:*` 引擎阶段（约 345 秒）——这正是缓存的目标。发布说明只包含自上一版桌面发布以来的提交，而不是自引擎 tag 以来的全部历史。发布仓库的 tag 仍全部指向同一个提交——这是 `gh release create` 给纯资产仓库的不可变 `main` HEAD 打 tag 的固有行为，对 `electron-updater` 无害；要让 tag 携带源码出处，需要另行设计标记提交。
