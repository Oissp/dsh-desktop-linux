import { describe, expect, it } from 'vitest'
import { compare } from './compare-dsh-versions.mjs'

describe('compare-dsh-versions (sync-upstream 的 semver 严格升级门禁)', () => {
  it('returns 0 for equal versions, ignoring build metadata', () => {
    expect(compare('0.1.5-rc.2', '0.1.5-rc.2')).toBe(0)
    expect(compare('1.0.0+deadbeef', '1.0.0')).toBe(0)
    expect(compare('1.0.0-rc.1+build.7', '1.0.0-rc.1')).toBe(0)
  })

  it('compares core numerically', () => {
    expect(compare('2.0.0', '1.9.9')).toBe(1)
    expect(compare('1.0.1', '1.0.2')).toBe(-1)
  })

  it('orders prerelease correctly per semver', () => {
    expect(compare('0.1.5-rc.2.1', '0.1.5-rc.2')).toBe(1) // 构建后缀扩展（desktop 壳版本）
    expect(compare('0.1.5-rc.2.1', '0.1.5-rc.3')).toBe(-1)
    expect(compare('0.1.5', '0.1.5-rc.99')).toBe(1) // 稳定版 > 预发布
    expect(compare('0.1.5-rc.2', '0.1.5-rc.10')).toBe(-1) // 数字标识按数值比，非字典序
    expect(compare('1.0.0-rc.1', '1.0.0-rc.a')).toBe(-1) // numeric < alphanumeric
    expect(compare('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1) // 前缀相等时长者更大
  })

  it('keeps multi-hyphen prerelease segments intact (review item 1)', () => {
    expect(compare('0.1.5-rc.1-hotfix.2', '0.1.5-rc.1')).toBe(1)
    expect(compare('0.1.5-rc.1-hotfix.2', '0.1.5-rc.1.1')).toBe(1)
  })

  it('treats 1e3 as alphanumeric, not numeric 1000', () => {
    expect(compare('1.0.0-a.1e3', '1.0.0-a.1000')).toBe(1)
  })

  it('rejects non-semver input loudly instead of comparing NaN (review items 1/3)', () => {
    expect(() => compare('1.0.0.1', '1.0.0')).toThrow() // 第四个点分数字段非法
    expect(() => compare('0.1', '0.1.0')).toThrow() // 短 core 不是合法 semver
    expect(() => compare('0.1.5-rc.2_0.1', '0.1.5-rc.2')).toThrow() // 非法字符
    expect(() => compare('1.0.0+', '1.0.0')).toThrow() // 空 build metadata
    expect(() => compare('not-a-version', '1.0.0')).toThrow()
    expect(() => compare('01.0.0', '1.0.0')).toThrow() // core 前导零非法
  })
})
