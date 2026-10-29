# 合并上游指南 (Merge Upstream Runbook)

> 本指南固化 dsh-desktop-linux fork 合并上游 `deepseek-ai/deepseek-harness` 的标准流程。
> 每次 upstream 发版（alpha/beta/rc/stable）后按此流程同步。

## 前置条件

- 本仓库的 remote 命名与直觉相反，先核对 `git remote -v`：
  - `origin` 是**上游引擎仓库** `deepseek-ai/deepseek-harness`——本流程从它取合并源，`git push origin` 会推到上游。
  - `dsh-desktop-linux` 是**本 fork** `Oissp/dsh-desktop-linux`——分支和 PR 推到这里。
  下文按这两个名字书写；若你的克隆用了别的名字，先按此对应关系改名再照做。
- 工作树干净：`git status` 无未提交改动
- 已运行 `pnpm install`

## 关键文件

| 文件 | 作用 |
|---|---|
| [.github/sync-trimmed-paths.txt](sync-trimmed-paths.txt) | 裁剪清单：fork 有意不携带的上游文件（删除） |
| [.github/sync-forked-paths.txt](sync-forked-paths.txt) | 行为修改基线：fork 有意修改（非删除）的上游文件 |
| [scripts/verify-sync-trimmed-paths.sh](../scripts/verify-sync-trimmed-paths.sh) | 验证裁剪清单完整性（清单内路径不存在于工作树） |
| [scripts/verify-sync-pairing-after-merge.sh](../scripts/verify-sync-pairing-after-merge.sh) | 合并后自动修复双语配对哈希 |

## 标准流程

### 1. 获取上游

```sh
git fetch origin --tags
```

确认上游最新版本号（查看 `origin/master` 的 `package.json` version 字段）。

### 2. 创建合并分支

```sh
git checkout main
git checkout -b merge/upstream-<version>
```

### 3. 执行合并

```sh
git merge origin/master  # 或特定 tag，如 origin/dsh-v0.2.0-rc.2
```

### 4. 处理冲突

冲突分四类，按优先级处理：

#### 4a. 裁剪清单内路径（自动以 fork 侧为准）

裁剪清单（`sync-trimmed-paths.txt`）内的路径冲突时，以 fork 侧为准：

```sh
# 对每个清单内的冲突路径
git checkout --ours <path>
git add <path>
```

**或批量处理**（合并冲突标记仍在时）：

```sh
while IFS= read -r line; do
  case "$line" in \#*|"") continue ;; esac
  path="${line%%#*}" && path="${path#"${path%%[![:space:]]*}"}" && path="${path%"${path##*[![:space:]]}"}"
  [ -z "$path" ] && continue
  git checkout --ours -- "$path" 2>/dev/null && git add -- "$path" 2>/dev/null || true
done < .github/sync-trimmed-paths.txt
```

#### 4b. 裁剪清单内被上游「重新带回或新增」的文件

上游恢复或新增清单内文件时，合并不冲突（直接进入 fork 代码树）。**必须在提交前删除**：

```sh
# 合并完成后、提交前运行
scripts/verify-sync-trimmed-paths.sh --staged
```

如有违规，删除对应文件后重新 `git add`。

#### 4c. fork 修改的文件（参考 sync-forked-paths.txt）

[.github/sync-forked-paths.txt](sync-forked-paths.txt) 列出了 fork 有意修改的上游文件。这些文件的冲突**不能自动以 fork 侧为准**——需要：

1. 查看上游改了什么（`git diff HEAD...MERGE_HEAD -- <path>`）
2. 检查上游改动是否已兼容 fork 的改动
3. 重新应用 fork 的修改（参考文件注释和对应 Agent Note）

典型情况：
- `desktop-build-paths.mjs`：上游重构目标映射 → 保留 `SUPPORTED_TARGETS = {'linux-x64'}`
- `main.ts`：上游新增功能 → 评估是否保留 fork 的裁剪和 Linux 适配
- `electron-builder.config.mjs`：上游加 mac/win 字段 → 保持 Linux-only 接口

#### 4d. 双语配对文档（pairing hash 冲突）

`*.i18n.yaml` 的合并驱动器在合并时会看到上游仍有的被裁剪文件，报 pairing 冲突。**合并提交后**自动修复：

```sh
scripts/verify-sync-pairing-after-merge.sh
```

此脚本运行 `verify-translation-pairing --write --all` 重新记录所有配对哈希，并验证只有 `.i18n.yaml` 文件变动。

### 5. 合并后验证

```sh
# 5a. 裁剪清单完整性
scripts/verify-sync-trimmed-paths.sh  # macOS 见下方说明

# 5b. 双语配对
scripts/verify-sync-pairing-after-merge.sh

# 5c. 类型检查
pnpm run typecheck

# 5d. Lint
pnpm run lint

# 5e. 文档检查（含 markdown links、translation pairing）
pnpm run test:docs

# 5f. 桌面测试（package-deb gate）
pnpm exec vitest run apps/desktop/tests  # macOS 见常见问题

# 5g. 包清单与依赖门禁（本 fork 有已知失败，见常见问题）
pnpm run hygiene
```

如果 `test:docs` 中 `translation pairing` 失败，说明配对哈希未修复——重新运行步骤 4d。

### 6. 写合并 Agent Note

在 `.agents/notes/implemented/architecture/` 新增 `YYYY-MM-DD-merge-<version>-linux-desktop.md`（及 `.zh.md`、`.i18n.yaml`），记录：

- **Problem**：上游版本号、提交数、文件数；哪些冲突需要决策
- **Decision**：每个冲突的解决方案和理由
- **Alternatives considered**：考虑过但拒绝的方案
- **Consequences**：未来同步如何处理同类冲突
- **Testing**：运行的验证命令和结果

参考已有合并笔记：
- [2026-09-29-merge-0.2.0-rc.2-linux-desktop.md](../.agents/notes/implemented/architecture/2026-09-29-merge-0.2.0-rc.2-linux-desktop.md)
- [2026-09-28-merge-0.2.0-rc.1-linux-desktop.md](../.agents/notes/implemented/architecture/2026-09-28-merge-0.2.0-rc.1-linux-desktop.md)

### 7. 提升桌面版本号

桌面版本跟随引擎版本，可带 `.N` 构建后缀：

```sh
# 引擎版本 = 根 package.json version
# 桌面版本 = apps/desktop/package.json version
# 如果是纯引擎同步（壳代码无改动），桌面版本 = 引擎版本
# 如果壳代码有改动（如修复），桌面版本 = 引擎版本.N
node -e "const v=require('./apps/desktop/package.json').version; console.log('当前桌面版本:', v)"
```

编辑 `apps/desktop/package.json` 的 `version` 字段。`shellVersionExtendsEngine` 会在打包时校验桌面版本必须扩展引擎版本。

### 8. 提交合并

```sh
git add -A
git commit  # 合并提交
```

### 9. 推送并验证 CI

```sh
git push dsh-desktop-linux merge/upstream-<version>
```

创建 PR 到 `main`。CI 会运行 `package-deb-test.yml`（含裁剪清单完整性检查）。

合并 PR 后，`package-deb.yml` 会自动构建 deb + AppImage 并发布到 `Oissp/dsh-desktop-linux-release`。

## 常见问题

### Q: 上游新增了一个 mac/win 专有文件，但不在裁剪清单里

将其添加到 `.github/sync-trimmed-paths.txt`，在对应版本分组下新增一行并附注释说明裁剪原因。

### Q: 上游重构了 fork 修改的文件

参考 [.github/sync-forked-paths.txt](sync-forked-paths.txt) 中该文件的注释，判断 fork 的改动是否仍需要。如果上游已修复 fork 的问题，可以放弃 fork 改动；否则重新应用。在合并 Agent Note 中记录决策。

### Q: `vitest run apps/desktop/tests` 有失败

区分失败原因：
- **裁剪清单内文件的 spec**：说明清单内文件未被删除（运行步骤 5a）
- **CI workflow specs 读 `.github/workflows/ci.yml`**：fork 不携带上游 CI workflow，这是已知失败（参见合并笔记）
- **其他失败**：检查是否由合并引入

### Q: `scripts/verify-sync-trimmed-paths.sh` 在 macOS 上报 `mapfile: command not found`

脚本用了 bash 4+ 的 `mapfile`，而 macOS 自带 bash 3.2。在 Linux CI 上它正常运行，这是 CI 拥有的信号；本地按脚本逻辑等价地检查即可：

```sh
grep -vE '^\s*#|^\s*$' .github/sync-trimmed-paths.txt | while IFS= read -r path; do
  if [ -e "$path" ]; then echo "worktree residue: $path"; fi
  if git ls-files --cached --error-unmatch -- "$path" >/dev/null 2>&1; then echo "staged residue: $path"; fi
done
```

无输出即为通过。

### Q: macOS 上 `apps/desktop/tests/command-installation.spec.ts` 被跳过

该 spec 覆盖符号链接命令的安装与移除，现在用 `describe.skipIf(process.platform !== 'linux')` 只在 Linux 运行。原因：`src/command-installation.ts` 的 macOS 分支通过 `linkat` helper 建链，而该 helper 的源码 `apps/desktop/cli/link-entry.c` 与编译脚本 `apps/desktop/scripts/prepare-command-link.ts` 都在裁剪清单内（macOS 打包专用）；fork 的 `prepare-runtime.ts` 又硬性拒绝 `linux-x64` 以外的目标，所以出货应用永远不会走到那个分支。Linux CI 完整运行这 17 个用例。若将来需要覆盖 macOS 行为，先恢复这两个文件并让 `prepare-runtime.ts` 接受 darwin 目标。

### Q: `pnpm run hygiene` 的 `vendor rescope` 门禁失败

上游改名前的名称 token 仍散落在 13 个文件里（`docs/subsystems/schedule.md`、`packages/client/ui-agent-preset/**` 等）。这些文件与合并无关，且该门禁在 `main` 上以完全相同的结果失败，属于既有失败。

### Q: `pnpm run hygiene` 的 `constraints` 门禁报「expected a package here」

`packages/<group>/<pkg>/` 下只剩 `lib/` 与 `node_modules/`，是更早同步删除的包留下的本地残留（未被 git 跟踪）。删除这些目录或运行 `pnpm run clean` 后恢复。

### Q: `test:docs` 的 `translation pairing` 失败

运行 `scripts/verify-sync-pairing-after-merge.sh` 修复配对哈希。如果仍有失败，检查双语文件内容是否一致。

### Q: 纯 `.N` 版本 bump 需要重新打包吗

需要。引擎缓存 key 覆盖 prepare 读取的全部已跟踪输入，其中包含 `apps/desktop/package.json`（版本号会写进 `runtime.json`，且 prepare 是唯一构建壳 workspace 依赖 `lib/` 的步骤），所以纯版本 bump 也会重新 prepare；命中缓存时 `package:desktop:linux:x64:builder` 用 `--builder-only` 跳过准备，直接跑 electron-builder——那种情况出现在引擎源码与壳清单都没变的重新打包（如 `workflow_dispatch`）。

### Q: 缓存占用超过 GitHub 10GB 配额怎么办

先按 ref 清理已合并/已关闭 PR 的残留（这些缓存落在 `refs/pull/<n>/merge` 命名空间，PR 结束后没有任何 run 能读到）：

```sh
gh api repos/Oissp/dsh-desktop-linux/actions/caches --jq \
  '.actions_caches[]|select(.ref=="refs/pull/<n>/merge")|.key' \
  | while read -r k; do
      gh api -X DELETE "repos/Oissp/dsh-desktop-linux/actions/caches?key=$(printf %s "$k" | jq -sRr @uri)&ref=refs/pull/<n>/merge"
    done
```

缓存策略本身有五条约束，改动 workflow 时不要退回旧写法：

- **只有 push 构建写缓存。** `pnpm-cache`、`eb-cache` 与引擎缓存都用 `actions/cache/restore` + 单独的 `actions/cache/save`，save 步骤带 `github.event_name == 'push'` 条件。PR 只恢复不写入——否则每个 PR 都会新增约 1GB 死数据，历史上曾累积到 3.4GB。
- **save 步骤排在写缓存的步骤之后。** pnpm store 的 save 在 `pnpm install` 之后，electron 二进制的 save 在打包之后。未命中时这些目录在对应步骤之前是空的，提前 save 会把空目录写进当周 key；下一个 run 精确命中它、`cache-hit` 为 true 又跳过保存，整周都退化成全量下载（0.2.2-alpha.2 合并后的 main run 因此多花了 11 分钟）。
- **pnpm store 的 key 带 ISO 周后缀**（`steps.pnpm-week.outputs.week`）。只用 lockfile 哈希做 key 会在每次依赖变动时新增一份约 810MB 的快照且永不淘汰，5 份就吃掉配额的一半。
- **引擎缓存只在 push 里 save，key 由 prepare 读取的全部已跟踪输入哈希（含 `apps/desktop/package.json`、`apps/desktop/cli/**`、`apps/desktop/tsconfig*.json` 与 composite action 自身），并排除 `**/*.spec.ts`、`**/*.spec.tsx` 与 `**/tests/**`。** 测试文件不进产物，排除后只改测试的提交也能命中缓存，代价是那类提交命中时不会顺带执行 `build:official` 的聚合检查。版本 bump 因此会重新 prepare，而不是命中缓存走 `--builder-only`：prepare 既把壳版本写进 `runtime.json`，又是唯一构建壳 workspace 依赖 `lib/` 的步骤，跳过它会产出一个缺依赖的主进程（0.1.7-rc.1.2 即为此）。
- **两条 workflow 共用一个 concurrency group**（`package-${{ github.ref }}`：push 与 `workflow_dispatch` 在 main 上都落到 `package-refs/heads/main`，PR 上按各自的 ref 分组），避免上游同步这类同时命中双方路径的 push 并行各建一遍引擎、后到的 run 抢写同一 key（报 `another job may be creating this cache`）。`cancel-in-progress` 只在 PR 上为 true：进行中的 run 不会被取消，但每个 group 只保留一个 pending run，排队中的 run 被后入队的 run 顶替（发版 run 因此可能被跳过，由下一次触及发版路径的 push 或手动 `workflow_dispatch` 补发）。
