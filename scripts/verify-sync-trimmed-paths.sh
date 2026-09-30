#!/usr/bin/env bash
# 验证裁剪清单完整性：清单内列出的路径不应存在于工作树。
#
# 合并上游后，被裁剪的文件可能被上游重新带回或新增（合并不冲突就会直接进入代码树）。
# 本脚本在合并提交前或 CI 中运行，确保清单内路径全部被删除。
#
# 用法：
#   scripts/verify-sync-trimmed-paths.sh           # 检查工作树
#   scripts/verify-sync-trimmed-paths.sh --staged  # 检查 Git 暂存区（合并提交前）
#
# 退出码：0 = 全部删除，1 = 有残留

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TRIM_LIST="$REPO_ROOT/.github/sync-trimmed-paths.txt"

if [ ! -f "$TRIM_LIST" ]; then
  echo "::error::裁剪清单不存在: $TRIM_LIST" >&2
  exit 1
fi

STAGED=false
if [ "${1:-}" = "--staged" ]; then
  STAGED=true
fi

# 读取裁剪清单：跳过注释行和空行
mapfile -t PATHS < <(grep -vE '^\s*#|^\s*$' "$TRIM_LIST" || true)

if [ ${#PATHS[@]} -eq 0 ]; then
  echo "::error::裁剪清单为空或只含注释" >&2
  exit 1
fi

VIOLATIONS=()
for entry in "${PATHS[@]}"; do
  # 去除首尾空白
  path="${entry#"${entry%%[![:space:]]*}"}"
  path="${path%"${path##*[![:space:]]}"}"
  [ -z "$path" ] && continue

  if $STAGED; then
    # 检查 Git 暂存区：git ls-files 会列出已暂存的文件
    if git -C "$REPO_ROOT" ls-files --cached -- "$path" | grep -q .; then
      VIOLATIONS+=("$path")
    fi
  else
    # 检查工作树
    if [ -e "$REPO_ROOT/$path" ]; then
      VIOLATIONS+=("$path")
    fi
  fi
done

if [ ${#VIOLATIONS[@]} -gt 0 ]; then
  echo "::error::裁剪清单内的路径仍存在（合并后未删除）："
  for v in "${VIOLATIONS[@]}"; do
    echo "  $v"
  done
  echo ""
  echo "请在合并提交前删除这些文件，或将其从 .github/sync-trimmed-paths.txt 中移除。"
  exit 1
fi

echo "裁剪清单完整性检查通过：${#PATHS[@]} 条路径全部不存在于工作树。"
