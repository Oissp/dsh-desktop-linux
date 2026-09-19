/**
 * Appearance resolution for the packaged shell.
 *
 * The dsh web engine persists its 通用设置 → 外观 choice (`ui-theme.preference`,
 * one of `light` | `dark` | `system`) in `<harness home>/settings.yaml`. This
 * module reads that preference, follows the OS theme for `system`, and hands
 * the resolved appearance to a caller-supplied callback so the shell can swap
 * its window/tray icons. The document is watched for external edits and the
 * native theme listener covers OS-level changes.
 *
 * The preference also drives `nativeTheme.themeSource`, which is what makes
 * `prefers-color-scheme` in every shell document follow the setting instead of
 * the OS — the shell's own prompts are documents like any other renderer.
 * @module
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { nativeTheme } from 'electron'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { load } from 'js-yaml'
import { DesktopSettingsWatcher } from './settings-watcher.ts'

/** The dsh engine's appearance namespace and field inside settings.yaml. */
const THEME_SETTINGS_NAMESPACE = 'ui-theme'
const THEME_PREFERENCE_FIELD = 'preference'

export type DesktopAppearance = 'light' | 'dark'

/** The settings document the desktop-run engine reads and writes. */
export function desktopSettingsPath(): string {
  return join(resolveDshHome(), 'settings.yaml')
}

function preferenceOf(sections: unknown): string | undefined {
  if (typeof sections !== 'object' || sections === null) return undefined
  const theme = (sections as Record<string, unknown>)[THEME_SETTINGS_NAMESPACE]
  if (typeof theme !== 'object' || theme === null) return undefined
  const preference = (theme as Record<string, unknown>)[THEME_PREFERENCE_FIELD]
  return typeof preference === 'string' ? preference : undefined
}

/** Read the stored appearance preference; `undefined` when absent or unreadable. */
export async function readAppearancePreference(path: string): Promise<string | undefined> {
  return (await readPreferenceDocument(path)).preference
}

/** One appearance read: the stored preference and whether the document was readable. */
interface AppearancePreferenceSnapshot {
  readonly preference: string | undefined
  readonly readable: boolean
}

async function readPreferenceDocument(path: string): Promise<AppearancePreferenceSnapshot> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return { preference: undefined, readable: false }
  }
  try {
    return { preference: preferenceOf(load(text)), readable: true }
  } catch {
    return { preference: undefined, readable: false }
  }
}

/**
 * Resolve the effective appearance: an explicit light/dark preference wins,
 * anything else (`system`, or no preference at all) follows the OS theme.
 */
export function resolveAppearance(preference: string | undefined): DesktopAppearance {
  if (preference === 'light' || preference === 'dark') return preference
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

/**
 * Map the stored preference onto Electron's three-way theme source. The stored
 * value may name a custom theme rather than a built-in preference, and only the
 * built-in pair overrides the OS.
 * @param preference - the stored `ui-theme.preference` value.
 * @returns The theme source that makes `prefers-color-scheme` follow the setting.
 */
export function themeSourceOf(preference: string | undefined): 'system' | 'light' | 'dark' {
  return preference === 'light' || preference === 'dark' ? preference : 'system'
}

/** Watch one settings document and re-apply the appearance on external edits. */
export class DesktopAppearanceController {
  private watcher: DesktopSettingsWatcher
  private preference: string | undefined
  private closed = false
  private appearance: DesktopAppearance = resolveAppearance(undefined)
  private readonly onThemeUpdated = (): void => { this.applyResolved() }

  /**
   * @param settingsPath - the `<harness home>/settings.yaml` document.
   * @param apply - invoked with the resolved appearance at start and on change.
   */
  constructor(
    private readonly settingsPath: string,
    private readonly apply: (appearance: DesktopAppearance) => void,
  ) {
    this.watcher = new DesktopSettingsWatcher(settingsPath, () => { void this.refresh() })
  }

  /** Read the initial preference, apply once, and arm both watchers. */
  async start(): Promise<void> {
    this.preference = await readAppearancePreference(this.settingsPath)
    // 先写主题源：它同步决定 shouldUseDarkColors，resolveAppearance 的 system 分支
    // 据此解析，Shell 文档的 prefers-color-scheme 也跟随它而不是操作系统。
    nativeTheme.themeSource = themeSourceOf(this.preference)
    this.appearance = resolveAppearance(this.preference)
    this.apply(this.appearance)
    nativeTheme.on('updated', this.onThemeUpdated)
    this.watcher.start()
  }

  /** Stop watching the document and the OS theme. */
  dispose(): void {
    this.closed = true
    nativeTheme.removeListener('updated', this.onThemeUpdated)
    this.watcher.dispose()
  }

  private applyResolved(): void {
    const resolved = resolveAppearance(this.preference)
    if (resolved === this.appearance) return
    this.appearance = resolved
    this.apply(resolved)
  }

  private async refresh(): Promise<void> {
    if (this.closed) return
    // 读失败（引擎写入期间的竞态/瞬时错误）不等于偏好被清成 system：保留当前外观。
    const snapshot = await readPreferenceDocument(this.settingsPath)
    if (!snapshot.readable) return
    const preference = snapshot.preference
    if (preference === this.preference) return
    this.preference = preference
    // 写入主题源本身会触发 updated，applyResolved 的去重让这次变更只应用一次。
    nativeTheme.themeSource = themeSourceOf(preference)
    this.applyResolved()
  }
}
