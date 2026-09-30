#!/usr/bin/env bash
# 合并后自动修复双语配对哈希，并验证只有 .i18n.yaml 文件发生变动。
#
# 上游编辑 paired document（如 README.md）时，fork 侧的 pairing hash 不匹配，
# 合并驱动器报冲突。本脚本在合并完成后运行：
#   1. 运行 verify-translation-pairing --write 修复所有 pairing hash
#   2. 检查 git diff 是否只有 .i18n.yaml 文件变动
#      - 是 → 配对修复成功，可以提交
#      - 否 → 有非配对文件变动，需要人工检查
#
# 用法：scripts/verify-sync-pairing-after-merge.sh
# 退出码：0 = 配对修复成功且只有 .i18n.yaml 变动，1 = 需要人工干预

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# 检查 tsx 是否可用
if [ ! -x "node_modules/.bin/tsx" ]; then
  echo "::error::tsx 未安装，请先运行 pnpm install" >&2
  exit 1
fi

echo "正在修复双语配对哈希..."
# --write --all：重新记录所有完整配对的哈希。合并后上游内容已进入 fork，
# 配对两侧都已更新，此时 re-record 是安全的（内容已由合并引入，非人工篡改）。
node_modules/.bin/tsx scripts/verify-translation-pairing.ts --write --all 2>&1 || {
  echo "::error::verify-translation-pairing 失败，请检查双语文件一致性" >&2
  exit 1
}

# 收集 git diff 中变动的文件
CHANGED_FILES=$(git diff --name-only 2>/dev/null || true)
if [ -z "$CHANGED_FILES" ]; then
  echo "没有文件变动——配对哈希已经一致。"
  exit 0
fi

# 检查是否有非 .i18n.yaml 文件变动
NON_PAIRING=$(echo "$CHANGED_FILES" | grep -vE '\.i18n\.yaml$' || true)
if [ -n "$NON_PAIRING" ]; then
  echo "::warning::配对修复后存在非 .i18n.yaml 文件变动，需要人工检查："
  echo "$NON_PAIRING" | sed 's/^/  /'
  echo ""
  echo "只有 .i18n.yaml 变动才是预期的配对修复结果。"
  exit 1
fi

PAIRING_COUNT=$(echo "$CHANGED_FILES" | wc -l)
echo "配对修复成功：$PAIRING_COUNT 个 .i18n.yaml 文件的哈希已更新。"
echo "变动文件："
echo "$CHANGED_FILES" | sed 's/^/  /'
echo ""
echo "可以安全提交这些配对哈希更新。"
