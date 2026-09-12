import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const theme = vi.hoisted(() => ({ shouldUseDarkColors: false, on: vi.fn(), removeListener: vi.fn() }))
vi.mock('electron', () => ({ nativeTheme: theme }))

const { readAppearancePreference, resolveAppearance } = await import('../src/appearance.ts')

let dir: string | undefined
afterEach(() => {
  if (dir !== undefined) { rmSync(dir, { recursive: true, force: true }); dir = undefined }
})

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
})
