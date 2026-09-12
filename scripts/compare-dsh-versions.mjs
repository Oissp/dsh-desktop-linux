/**
 * scripts/compare-dsh-versions.mjs —— 定时同步的 semver 严格升级门禁。
 *
 * 用法：node scripts/compare-dsh-versions.mjs <target> <locked>
 *   退出码 0 = target 严格大于 locked（有变更，需同步）
 *   退出码 2 = target 不大于 locked（相等=无变更；target 更老=npm latest 标签滞后，跳过降级）
 *   退出码 1 = 输入非法 / 比较出错（报错中止，不静默当成"无变更"）
 *
 * 与旧内联比较器的差异（code-review items 1-3）：
 *   - 完整 semver 语法校验：build metadata（+xxx）剥离、pre-release 用剩余 hyphen 段
 *     完整解析（不再 const[c,p]=v.split('-') 丢弃第二个连字符后的内容）、短 core 与
 *     第四个点分字段这类非法输入直接报错而不是 map(Number) 出 NaN 参与比较
 *   - 退出码显式区分"不大于"(2) 与"出错"(1)，shell 侧不再依赖 if/elif 条件退出状态，
 *     脚本本身崩溃（非 0/2）也会被当成错误报出来，而不是静默落入"无变更"
 */
import { argv, exit } from 'node:process'
import { pathToFileURL } from 'node:url'

const SEMVER =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const NUMERIC = /^(0|[1-9][0-9]*)$/

export function compare(a, b) {
  const x = parse(a)
  const y = parse(b)
  const core = compareCore(x.core, y.core)
  return core !== 0 ? core : comparePrerelease(x.prerelease, y.prerelease)
}

function parse(version) {
  const m = SEMVER.exec(version)
  if (!m) throw new Error(`不是合法 semver：${version}`)
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3])],
    // prerelease 为 null 表示"没有预发布段"，语义上大于任何带预发布段的版本
    prerelease: m[4] ? m[4].split('.') : null,
  }
}

function compareCore(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1
  }
  return 0
}

// 预发布段比较：numeric 标识按数值比；alphanumeric 按 ASCII 比；numeric < alphanumeric；
// 无预发布段 > 有预发布段；前缀相等时长者更大（rc.1 < rc.1.0）。
function comparePrerelease(a, b) {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const x = a[i]
    const y = b[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const xNum = NUMERIC.test(x)
    const yNum = NUMERIC.test(y)
    if (xNum && yNum) {
      const nx = Number(x)
      const ny = Number(y)
      if (nx !== ny) return nx > ny ? 1 : -1
      continue
    }
    if (xNum) return -1
    if (yNum) return 1
    return x > y ? 1 : -1
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [target, locked] = argv.slice(2)
  try {
    if (!target || !locked) throw new Error('用法：node scripts/compare-dsh-versions.mjs <target> <locked>')
    exit(compare(target, locked) > 0 ? 0 : 2)
  } catch (error) {
    console.error(`[compare-dsh-versions] ${error.message}`)
    exit(1)
  }
}
