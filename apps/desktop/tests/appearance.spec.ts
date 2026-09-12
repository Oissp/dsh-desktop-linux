import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const theme = vi.hoisted(() => ({ shouldUseDarkColors: false, on: vi.fn(), removeListener: vi.fn() }))
vi.mock('electron', () => ({ nativeTheme: theme }))

const { readAppearancePreference, resolveAppearance, DesktopAppearanceController } = await import('../src/appearance.ts')

let dir: string | undefined
afterEach(() => {
  if (dir !== undefined) { rmSync(dir, { recursive: true, force: true }); dir = undefined }
})

/** Wait past the 150ms refresh debounce and actual filesystem event delivery. */
function settle(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 500))
}

/** Poll until the applied appearances match the expectation, so slow fs events cannot flake. */
async function waitForAppearances(
  applied: readonly string[],
  expected: readonly string[],
  timeoutMs = 3_000,
): Promise<void> {
  const start = Date.now()
  while (applied.length < expected.length) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`applied ${JSON.stringify(applied)}, expected ${JSON.stringify(expected)}`)
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  expect(applied).toEqual(expected)
}

describe('desktop appearance', () => {
  it('reads the ui-theme preference from a yaml settings document', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-appearance-'))
    const path = join(dir, 'settings.yaml')
    writeFileSync(path, 'ui-theme:\n  preference: dark\n')
    expect(await readAppearancePreference(path)).toBe('dark')
  })

  it('returns undefined when the document is absent', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-appearance-'))
    expect(await readAppearancePreference(join(dir, 'missing.yaml'))).toBeUndefined()
  })

  it('prefers an explicit light/dark preference over the OS theme', () => {
    expect(resolveAppearance('light')).toBe('light')
    expect(resolveAppearance('dark')).toBe('dark')
  })

  it('follows the OS theme for system and absent preferences', () => {
    theme.shouldUseDarkColors = false
    expect(resolveAppearance('system')).toBe('light')
    expect(resolveAppearance(undefined)).toBe('light')
    theme.shouldUseDarkColors = true
    expect(resolveAppearance('system')).toBe('dark')
    expect(resolveAppearance(undefined)).toBe('dark')
    theme.shouldUseDarkColors = false
  })

  it('keeps the explicit appearance when a refresh cannot read the document', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-appearance-'))
    const path = join(dir, 'settings.yaml')
    writeFileSync(path, 'ui-theme:\n  preference: dark\n')
    const applied: string[] = []
    const controller = new DesktopAppearanceController(path, (appearance) => { applied.push(appearance) })
    await controller.start()
    expect(applied).toEqual(['dark'])
    rmSync(path)
    await settle()
    expect(applied).toEqual(['dark'])
    controller.dispose()
  })

  it('follows the OS theme after a readable document removes the preference', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-appearance-'))
    const path = join(dir, 'settings.yaml')
    writeFileSync(path, 'ui-theme:\n  preference: dark\n')
    const applied: string[] = []
    const controller = new DesktopAppearanceController(path, (appearance) => { applied.push(appearance) })
    await controller.start()
    expect(applied).toEqual(['dark'])
    // 与引擎改写 settings.yaml 的方式一致：先删后建。两次操作之间留出事件交付窗口，
    // 避免 FSEvents 合并事件导致第二次（可读）刷新丢失；重建后再等待偏好切换。
    rmSync(path)
    await settle()
    writeFileSync(path, 'ui-theme:\n  preference: system\n')
    await waitForAppearances(applied, ['dark', 'light'])
    controller.dispose()
  })
})
