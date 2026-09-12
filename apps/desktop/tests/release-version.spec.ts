import { describe, expect, it } from 'vitest'
import { shellVersionExtendsEngine } from '../src/release-version.ts'

describe('desktop shell version extends engine version', () => {
  it('accepts identical versions', () => {
    expect(shellVersionExtendsEngine('0.1.5-rc.2', '0.1.5-rc.2')).toBe(true)
    expect(shellVersionExtendsEngine('1.0.0', '1.0.0')).toBe(true)
  })

  it('accepts the engine version extended with a build counter', () => {
    expect(shellVersionExtendsEngine('0.1.5-rc.2.1', '0.1.5-rc.2')).toBe(true)
    expect(shellVersionExtendsEngine('1.0.0.3', '1.0.0')).toBe(true)
  })

  it('rejects unrelated, renamed, invalid, and build-metadata-only versions', () => {
    expect(shellVersionExtendsEngine('2.0.0', '1.0.0')).toBe(false)
    expect(shellVersionExtendsEngine('1.0.0-other.1', '1.0.0')).toBe(false)
    expect(shellVersionExtendsEngine('1.0.0+desktop.1', '1.0.0')).toBe(false)
    expect(shellVersionExtendsEngine('0.1.5-rc.2_0.1', '0.1.5-rc.2')).toBe(false)
    expect(shellVersionExtendsEngine('not-a-version', '1.0.0')).toBe(false)
  })
})
