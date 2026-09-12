/** Resolvable client-plugin packages synthesized from reviewed constants. */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Fixed dimensions of one synthesized client-plugin corpus. */
export interface SyntheticClientCorpusShape {
  /** Packages contributing a browser bundle. */
  readonly packages: number
  /** Generated lines per bundle, each carrying one statement. */
  readonly linesPerBundle: number
}

/** Byte and line totals of the bundles a corpus wrote. */
export interface SyntheticClientCorpus {
  readonly packages: number
  readonly bundleBytes: number
  readonly bundleLines: number
  readonly sourceMapBytes: number
  readonly names: readonly string[]
}

/** Package-name prefix; the index keeps every synthesized id distinct. */
const PACKAGE_PREFIX = '@deepseek-ai/dsh-client-bench-'

/**
 * One generated statement, sized so 1,400 lines reach the ~165 KB median of a
 * shipped client bundle without depending on any real artifact.
 */
function bundleLine(pkgIndex: number, line: number): string {
  const padding = 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(2)
  return `exports.f${String(pkgIndex)}_${String(line)} = function () { return "${padding}${String(line)}" }`
}

/** Authored map for one generated bundle: one segment per generated line. */
function sourceMap(name: string, lines: number): string {
  const mappings = Array.from({ length: lines }, (_, index) => index === 0 ? 'AAAA' : 'AACA').join(';')
  return JSON.stringify({
    version: 3,
    file: 'client.js',
    sourceRoot: '',
    sources: [`../src/${name.replace(/[^A-Za-z\d]/gu, '-')}.ts`],
    names: [],
    mappings,
  })
}

/**
 * Write a resolvable node_modules corpus of client-plugin packages.
 * @param root - directory receiving `node_modules`; created when missing.
 * @param shape - fixed corpus dimensions.
 * @returns the written package names and their byte and line totals.
 */
export function writeSyntheticClientPackages(
  root: string,
  shape: SyntheticClientCorpusShape,
): SyntheticClientCorpus {
  const names: string[] = []
  let bundleBytes = 0
  let sourceMapBytes = 0
  for (let index = 0; index < shape.packages; index += 1) {
    const name = `${PACKAGE_PREFIX}${String(index)}`
    const pkgRoot = join(root, 'node_modules', ...name.split('/'))
    mkdirSync(join(pkgRoot, 'lib'), { recursive: true })
    writeFileSync(join(pkgRoot, 'package.json'), JSON.stringify({
      name,
      version: '0.0.0',
      exports: { './client': './lib/client.js', './package.json': './package.json' },
      dsh: { client: { platform: 'web' } },
    }))
    const source = `${Array.from(
      { length: shape.linesPerBundle },
      (_, line) => bundleLine(index, line),
    ).join('\n')}\n//# sourceMappingURL=client.js.map\n`
    const map = sourceMap(name, shape.linesPerBundle)
    writeFileSync(join(pkgRoot, 'lib', 'client.js'), source)
    writeFileSync(join(pkgRoot, 'lib', 'client.js.map'), map)
    bundleBytes += Buffer.byteLength(source)
    sourceMapBytes += Buffer.byteLength(map)
    names.push(name)
  }
  return {
    packages: shape.packages,
    bundleBytes,
    bundleLines: shape.packages * shape.linesPerBundle,
    sourceMapBytes,
    names,
  }
}
