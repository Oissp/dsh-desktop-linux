import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { en, type DesktopLocale, zh } from '../src/locale.ts'
import { DesktopLocaleController, readLocalePreference } from '../src/desktop-locale.ts'

let dir: string | undefined
afterEach(() => {
  if (dir !== undefined) { rmSync(dir, { recursive: true, force: true }); dir = undefined }
})

/** Wait past the 150ms refresh debounce and actual filesystem event delivery. */
function settle(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 500))
}

/** Poll until the applied locales match the expectation, so slow fs events cannot flake. */
async function waitForLocales(
  applied: readonly DesktopLocale[],
  expected: readonly DesktopLocale[],
  timeoutMs = 3_000,
): Promise<void> {
  const start = Date.now()
  while (applied.length < expected.length) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`applied ${JSON.stringify(applied.map(l => l.id))}, expected ${JSON.stringify(expected.map(l => l.id))}`)
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  expect(applied).toEqual(expected)
}

describe('desktop shell locale', () => {
  it('reads the locale preference from a yaml settings document', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-locale-'))
    const path = join(dir, 'settings.yaml')
    writeFileSync(path, 'locale:\n  preference: zh\n')
    expect(await readLocalePreference(path)).toBe('zh')
  })

  it('returns undefined when the document is absent or has no preference', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-locale-'))
    expect(await readLocalePreference(join(dir, 'missing.yaml'))).toBeUndefined()
    const path = join(dir, 'settings.yaml')
    writeFileSync(path, 'ui-theme:\n  preference: dark\n')
    expect(await readLocalePreference(path)).toBeUndefined()
  })

  it('prefers the stored preference over the system locale', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-locale-'))
    const path = join(dir, 'settings.yaml')
    writeFileSync(path, 'locale:\n  preference: zh\n')
    const applied: DesktopLocale[] = []
    const controller = new DesktopLocaleController(path, 'en-US', (locale) => { applied.push(locale) })
    await controller.start()
    expect(applied).toEqual([{ id: 'zh-CN', messages: zh }])
    controller.dispose()
  })

  it('falls back to the system locale when no preference is stored', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-locale-'))
    const path = join(dir, 'settings.yaml')
    writeFileSync(path, 'ui-theme:\n  preference: dark\n')
    const applied: DesktopLocale[] = []
    const controller = new DesktopLocaleController(path, 'zh-CN', (locale) => { applied.push(locale) })
    await controller.start()
    expect(applied).toEqual([{ id: 'zh-CN', messages: zh }])
    controller.dispose()
  })

  it('keeps the applied locale when a refresh cannot read the document', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-locale-'))
    const path = join(dir, 'settings.yaml')
    writeFileSync(path, 'locale:\n  preference: zh\n')
    const applied: DesktopLocale[] = []
    const controller = new DesktopLocaleController(path, 'en-US', (locale) => { applied.push(locale) })
    await controller.start()
    expect(applied).toEqual([{ id: 'zh-CN', messages: zh }])
    rmSync(path)
    await settle()
    expect(applied).toEqual([{ id: 'zh-CN', messages: zh }])
    controller.dispose()
  })

  it('switches to the stored preference after the document changes', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-locale-'))
    const path = join(dir, 'settings.yaml')
    writeFileSync(path, 'ui-theme:\n  preference: dark\n')
    const applied: DesktopLocale[] = []
    const controller = new DesktopLocaleController(path, 'en-US', (locale) => { applied.push(locale) })
    await controller.start()
    expect(applied).toEqual([{ id: 'en', messages: en }])
    // 与引擎改写 settings.yaml 的方式一致：先删后建。两次操作之间留出事件交付窗口，
    // 避免 FSEvents 合并事件导致第二次（可读）刷新丢失；重建后再等待语言切换。
    rmSync(path)
    await settle()
    writeFileSync(path, 'locale:\n  preference: zh\n')
    await waitForLocales(applied, [{ id: 'en', messages: en }, { id: 'zh-CN', messages: zh }])
    controller.dispose()
  })
})
