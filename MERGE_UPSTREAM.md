# 合并上游指南 (Merge Upstream Runbook)

> 本指南固化 dsh-desktop-linux fork 合并上游 `deepseek-ai/deepseek-harness` 的标准流程。
> 每次 upstream 发版（alpha/beta/rc/stable）后按此流程同步。

## 前置条件

- 已配置 `upstream` remote：`git remote add upstream https://github.com/deepseek-ai/deepseek-harness.git`
- 工作树干净：`git status` 无未提交改动
- 已运行 `pnpm install`

## 关键文件

| 文件 | 作用 |
|---|---|
| [.github/sync-trimmed-paths.txt](.github/sync-trimmed-paths.txt) | 裁剪清单：fork 有意不携带的上游文件（删除） |
| [.github/sync-forked-paths.txt](.github/sync-forked-paths.txt) | 行为修改基线：fork 有意修改（非删除）的上游文件 |
| [scripts/verify-sync-trimmed-paths.sh](scripts/verify-sync-trimmed-paths.sh) | 验证裁剪清单完整性（清单内路径不存在于工作树） |
| [scripts/verify-sync-pairing-after-merge.sh](scripts/verify-sync-pairing-after-merge.sh) | 合并后自动修复双语配对哈希 |

## 标准流程

### 1. 获取上游

```sh
git fetch upstream --tags
```

确认上游最新版本号（查看 `upstream/master` 的 `package.json` version 字段）。

### 2. 创建合并分支

```sh
git checkout main
git checkout -b merge/upstream-<version>
```

### 3. 执行合并

```sh
git merge upstream/master  # 或特定 tag，如 upstream/dsh-v0.2.0-rc.2
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

[.github/sync-forked-paths.txt](.github/sync-forked-paths.txt) 列出了 fork 有意修改的上游文件。这些文件的冲突**不能自动以 fork 侧为准**——需要：

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
scripts/verify-sync-trimmed-paths.sh

# 5b. 双语配对
scripts/verify-sync-pairing-after-merge.sh

# 5c. 类型检查
pnpm run typecheck

# 5d. Lint
pnpm run lint

# 5e. 文档检查（含 markdown links、translation pairing）
pnpm run test:docs

# 5f. 桌面测试（package-deb gate）
pnpm exec vitest run apps/desktop/tests
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
- [2026-09-29-merge-0.2.0-rc.2-linux-desktop.md](.agents/notes/implemented/architecture/2026-09-29-merge-0.2.0-rc.2-linux-desktop.md)
- [2026-09-28-merge-0.2.0-rc.1-linux-desktop.md](.agents/notes/implemented/architecture/2026-09-28-merge-0.2.0-rc.1-linux-desktop.md)

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
git push origin merge/upstream-<version>
```

创建 PR 到 `main`。CI 会运行 `package-deb-test.yml`（含裁剪清单完整性检查）。

合并 PR 后，`package-deb.yml` 会自动构建 deb + AppImage 并发布到 `Oissp/dsh-desktop-linux-release`。

## 常见问题

### Q: 上游新增了一个 mac/win 专有文件，但不在裁剪清单里

将其添加到 `.github/sync-trimmed-paths.txt`，在对应版本分组下新增一行并附注释说明裁剪原因。

### Q: 上游重构了 fork 修改的文件

参考 [.github/sync-forked-paths.txt](.github/sync-forked-paths.txt) 中该文件的注释，判断 fork 的改动是否仍需要。如果上游已修复 fork 的问题，可以放弃 fork 改动；否则重新应用。在合并 Agent Note 中记录决策。

### Q: `vitest run apps/desktop/tests` 有失败

区分失败原因：
- **裁剪清单内文件的 spec**：说明清单内文件未被删除（运行步骤 5a）
- **CI workflow specs 读 `.github/workflows/ci.yml`**：fork 不携带上游 CI workflow，这是已知失败（参见合并笔记）
- **其他失败**：检查是否由合并引入

### Q: `test:docs` 的 `translation pairing` 失败

运行 `scripts/verify-sync-pairing-after-merge.sh` 修复配对哈希。如果仍有失败，检查双语文件内容是否一致。

### Q: 纯 `.N` 版本 bump 需要重新打包吗

不需要重新准备引擎。`package-deb.yml` 的引擎缓存 key 排除了 `apps/desktop/package.json`，纯版本 bump 命中缓存时用 `--builder-only` 跳过引擎准备，直接跑 electron-builder。
