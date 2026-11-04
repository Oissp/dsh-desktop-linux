/**
 * Verify that every upstream file this fork modifies has a baseline entry.
 *
 * `sync-forked-paths.txt` is the merge-time decision list: an entry tells a maintainer
 * that the file intentionally differs and its fork behavior must be re-applied. A
 * modified file missing from the list can be resolved silently toward upstream during
 * a merge. This check compares the fork side of the merge base with that list.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const DEFAULT_BASELINE = '.github/sync-forked-paths.txt'
const DEFAULT_BASE = 'upstream/master'

/**
 * Files whose differences are generated or documentation-only. They are excluded from
 * the modified-file completeness check; a behavior or build file must stay listed.
 */
const generatedOrDocPatterns = [
  /^pnpm-lock\.yaml$/u,
  /^scripts\/no-unknown-casts\.baseline\.json$/u,
  /\.i18n\.yaml$/u,
  /^\.agents\/notes\//u,
  /^apps\/desktop\/tests\/signing-concurrency\/README(?:\.zh)?\.md$/u,
  // Upstream/fork formatting differs only; the behavior is covered by other specs.
  /^apps\/desktop\/tests\/preload-mandatory-overlay\.spec\.ts$/u,
]

/** Result of comparing fork-modified files with the baseline. */
export interface ForkBaselineResult {
  /** Merge base used for the comparison. */
  readonly mergeBase: string
  /** Fork-modified files absent from the baseline and not generated/documentation-only. */
  readonly missing: readonly string[]
  /** Baseline entries that no longer differ from the merge base. */
  readonly stale: readonly string[]
}

/**
 * Whether a path is generated or documentation-only for baseline purposes.
 * @param file - Repository-relative path with forward slashes.
 * @returns True when the path may differ without a merge-time decision entry.
 */
export function isGeneratedForkPath(file: string): boolean {
  return generatedOrDocPatterns.some(pattern => pattern.test(file))
}

/**
 * Read the fork baseline, dropping comments and blank lines.
 * @param source - Contents of `sync-forked-paths.txt`.
 * @returns Paths in file order, without inline comments.
 */
export function parseForkBaseline(source: string): string[] {
  const paths: string[] = []
  for (const line of source.split('\n')) {
    const path = line.split('#', 1)[0]?.trim() ?? ''
    if (path !== '') paths.push(path)
  }
  return paths
}

/**
 * Compare one fork-side modified list with one baseline.
 * @param modified - Files modified on the fork side of the merge base.
 * @param baseline - Parsed baseline paths.
 * @returns Missing baseline entries and stale baseline entries, both sorted.
 */
export function classifyForkBaseline(modified: readonly string[], baseline: readonly string[]): {
  readonly missing: readonly string[]
  readonly stale: readonly string[]
} {
  const baselineSet = new Set(baseline)
  const modifiedSet = new Set(modified)
  return {
    missing: modified.filter(file => !baselineSet.has(file) && !isGeneratedForkPath(file)).sort(),
    stale: baseline.filter(file => !modifiedSet.has(file)).sort(),
  }
}

function git(repoRoot: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/**
 * Verify the fork baseline against a local Git ref.
 * @param repoRoot - Repository checkout.
 * @param base - Ref naming the upstream branch, normally `upstream/master`.
 * @param baselinePath - Repository-relative baseline file.
 * @returns Merge base plus missing and stale entries.
 */
export function verifyForkBaseline(
  repoRoot: string,
  base: string = DEFAULT_BASE,
  baselinePath: string = DEFAULT_BASELINE,
): ForkBaselineResult {
  const mergeBase = git(repoRoot, ['merge-base', base, 'HEAD'])
  if (mergeBase === '') throw new Error(`no merge base between ${base} and HEAD`)
  const modified = git(repoRoot, ['diff', '--diff-filter=M', '--name-only', mergeBase])
    .split('\n')
    .filter(file => file !== '')
  const baseline = parseForkBaseline(readFileSync(resolve(repoRoot, baselinePath), 'utf8'))
  if (baseline.length === 0) throw new Error(`${baselinePath} is empty; the gate refuses an unguarded corpus`)
  return { mergeBase, ...classifyForkBaseline(modified, baseline) }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  const args = process.argv.slice(2)
  let base = DEFAULT_BASE
  for (let index = 0; index < args.length; index += 1) {
    const next = args[index + 1]
    if (args[index] !== '--base' || next === undefined) {
      console.error('usage: node scripts/verify-sync-forked-paths.ts [--base <upstream-ref>]')
      process.exitCode = 1
      break
    }
    base = next
    index += 1
  }

  if (process.exitCode !== 1) {
    try {
      const result = verifyForkBaseline(root, base)
      if (result.missing.length === 0 && result.stale.length === 0) {
        console.log(`verify-sync-forked-paths: baseline matches fork-modified files at ${result.mergeBase}.`)
      } else {
        if (result.missing.length > 0) {
          console.error(`verify-sync-forked-paths: fork-modified files missing from ${DEFAULT_BASELINE} (merge base ${result.mergeBase}):`)
          for (const file of result.missing) console.error(`  ${file}`)
          console.error('Add each behavior/build file with its fork decision, or document why it is generated/documentation-only.')
        }
        if (result.stale.length > 0) {
          console.error(`verify-sync-forked-paths: baseline entries no longer differ from ${result.mergeBase}:`)
          for (const file of result.stale) console.error(`  ${file}`)
          console.error('Remove stale entries so the baseline remains a current merge checklist.')
        }
        process.exitCode = 1
      }
    } catch (error) {
      console.error(`verify-sync-forked-paths: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    }
  }
}
