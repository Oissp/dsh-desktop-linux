import { describe, expect, it } from 'vitest'
import { shellVersionExtendsEngine } from '../src/release-version.ts'

describe('desktop shell version extends engine version', () => {
  it('accepts identical versions', () => {
    expect(shellVersionExtendsEngine('0.1.5-rc.2', '0.1.5-rc.2')).toBe(true)
    expect(shellVersionExtendsEngine('1.0.0', '1.0.0')).toBe(true)
  })

  it('accepts a prerelease engine version extended with a build counter', () => {
    expect(shellVersionExtendsEngine('0.1.5-rc.2.1', '0.1.5-rc.2')).toBe(true)
    expect(shellVersionExtendsEngine('1.2.3-rc.1.3', '1.2.3-rc.1')).toBe(true)
  })

  it('rejects unrelated, renamed, invalid, and build-metadata-only versions', () => {
    expect(shellVersionExtendsEngine('2.0.0', '1.0.0')).toBe(false)
    expect(shellVersionExtendsEngine('1.0.0-other.1', '1.0.0')).toBe(false)
    expect(shellVersionExtendsEngine('1.0.0+desktop.1', '1.0.0')).toBe(false)
    expect(shellVersionExtendsEngine('0.1.5-rc.2_0.1', '0.1.5-rc.2')).toBe(false)
    expect(shellVersionExtendsEngine('not-a-version', '1.0.0')).toBe(false)
  })
  it('rejects a non-semver extension of a stable engine version', () => {
    // 稳定引擎版本没有合法 semver 后缀可扩展：1.0.0.1 不是合法 semver（第四个数字段）。
    expect(shellVersionExtendsEngine('1.0.0.1', '1.0.0')).toBe(false)
    expect(shellVersionExtendsEngine('1.0.0.2', '1.0.0')).toBe(false)
  })
})
