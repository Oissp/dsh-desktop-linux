import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { trimManifest, trimmedKey } from './verify-md-links-trimmed.ts'

const root = resolve(import.meta.dirname, '..')
/** A note two directories below the repository root, where upstream writes these links. */
const note = resolve(root, '.agents/notes/implemented/process/2026-01-01-topic.md')

describe('verify-md-links-trimmed (fork 裁剪链接门禁)', () => {
  it('keys a missing file by its repository-relative path', () => {
    expect(trimmedKey(note, { url: '../../../../.github/workflows/ci.yml', reason: 'target' }, root))
      .toBe('.github/workflows/ci.yml')
  })

  it('keys a missing fragment by path and fragment together', () => {
    expect(trimmedKey(note, { url: '../../../../apps/desktop/README.md#release-versions', reason: 'anchor' }, root))
      .toBe('apps/desktop/README.md#release-versions')
  })

  it('keys a missing file without its fragment, so a bare path entry still matches', () => {
    expect(trimmedKey(note, { url: '../../../../gone.md#section', reason: 'target' }, root)).toBe('gone.md')
  })

  it('decodes a percent-escaped target the way a renderer resolves it', () => {
    expect(trimmedKey(note, { url: '../../../../docs/My%20File.md', reason: 'target' }, root)).toBe('docs/My File.md')
  })

  it('keeps the raw text of a malformed escape, which matches no manifest entry', () => {
    expect(trimmedKey(note, { url: '../../../../docs/%zz.md', reason: 'target' }, root)).toBe('docs/%zz.md')
  })

  it('reads manifests as data lines only', () => {
    expect(trimManifest('.github/md-links-trimmed-sections.txt')).toContain('apps/desktop/README.md#release-versions')
    expect(trimManifest('.github/sync-trimmed-paths.txt')).toContain('.github/workflows/ci.yml')
    expect(trimManifest('.github/sync-trimmed-paths.txt').some(line => line.startsWith('#'))).toBe(false)
  })
})
