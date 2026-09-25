/**
 * Relative-link gate for this Linux-only fork.
 *
 * The upstream gate (./verify-md-links.ts) requires every relative link to resolve. This
 * fork deliberately drops upstream files and README sections, so links written upstream
 * into them cannot resolve here by construction. This driver reuses the upstream
 * discovery, scanning, anchors, and reporting unchanged, and withholds only the
 * violations the fork's trim manifests declare intentional. Every other broken link
 * still fails, and the upstream file stays unmodified so upstream merges stay automatic.
 */

import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { anchorCache, findViolations, markdownLinkSourcePaths } from './verify-md-links.ts'

const root = resolve(import.meta.dirname, '..')

/** Upstream files this fork does not carry. */
const TRIMMED_PATHS = '.github/sync-trimmed-paths.txt'
/** Sections removed from upstream files this fork keeps. */
const TRIMMED_SECTIONS = '.github/md-links-trimmed-sections.txt'

type Violation = ReturnType<typeof findViolations>[number]

/**
 * Read a trim manifest as its data lines.
 * @param file - repository-relative manifest path.
 * @param scanRoot - repository root the path resolves against.
 * @returns the manifest's trimmed, non-empty lines, with `#` comments removed.
 */
export function trimManifest(file: string, scanRoot: string = root): string[] {
  return readFileSync(resolve(scanRoot, file), 'utf8').split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
}

/**
 * Key a broken link by what it points at, so one lookup covers both manifests: a
 * missing file keys as its repository-relative path, a missing fragment as
 * `path#fragment`.
 * @param source - absolute path of the Markdown file the link is written in.
 * @param violation - the broken link as the upstream gate reported it.
 * @param scanRoot - repository root the target resolves against.
 * @returns the repository-relative key for the link's target.
 */
export function trimmedKey(source: string, violation: Pick<Violation, 'url' | 'reason'>, scanRoot: string = root): string {
  const raw = violation.url.replace(/[#?].*$/, '')
  let path = raw
  try {
    path = decodeURIComponent(raw)
  } catch {
    // decodeURIComponent throws only on a malformed percent-escape, which names no
    // file; the raw text then keys a lookup that matches no manifest entry.
  }
  const target = relative(scanRoot, resolve(dirname(source), path)).replaceAll('\\', '/')
  if (violation.reason === 'target') return target
  const hash = violation.url.indexOf('#')
  return hash === -1 ? target : `${target}#${violation.url.slice(hash + 1).replace(/\?.*$/, '')}`
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const files = markdownLinkSourcePaths(root)
  const anchorsOf = anchorCache()
  const trimmed = new Set([...trimManifest(TRIMMED_PATHS), ...trimManifest(TRIMMED_SECTIONS)])
  const broken: Violation[] = []
  let ignored = 0
  for (const file of files) {
    const source = resolve(root, file)
    for (const violation of findViolations(source, anchorsOf, root)) {
      if (trimmed.has(trimmedKey(source, violation))) ignored += 1
      else broken.push(violation)
    }
  }

  if (broken.length === 0) {
    const note = ignored === 0 ? '' : ` (${ignored} link(s) into fork-trimmed paths and sections ignored)`
    console.log(`verify-md-links: ${files.length} file(s) checked, all relative cross-links and fragments resolve${note}.`)
    process.exit(0)
  }

  console.error('verify-md-links: broken relative cross-links found:')
  for (const v of broken) {
    console.error(`  ${v.file}:${v.line}  ${v.url}  (${v.reason === 'target' ? 'target does not exist' : 'no such anchor in target'})`)
  }
  process.exit(1)
}
