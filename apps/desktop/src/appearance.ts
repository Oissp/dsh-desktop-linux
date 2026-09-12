/**
 * Appearance-driven window/tray icon selection for the packaged Linux build.
 *
 * The dsh web engine persists its 通用设置 → 外观 choice (`ui-theme.preference`,
 * one of `light` | `dark` | `system`) in `<harness home>/settings.yaml`. This
 * module reads that preference, follows the OS theme for `system`, and hands
 * the resolved appearance to a caller-supplied callback so the shell can swap
 * its window/tray icons. The document is watched for external edits and the
 * native theme listener covers OS-level changes.
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

/** Watch one settings document and re-apply the appearance on external edits. */
export class DesktopAppearanceController {
  private watcher: DesktopSettingsWatcher
  private preference: string | undefined
  private closed = false
  private readonly onThemeUpdated = (): void => { this.apply(resolveAppearance(this.preference)) }

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
    this.apply(resolveAppearance(this.preference))
    nativeTheme.on('updated', this.onThemeUpdated)
    this.watcher.start()
  }

  /** Stop watching the document and the OS theme. */
  dispose(): void {
    this.closed = true
    nativeTheme.removeListener('updated', this.onThemeUpdated)
    this.watcher.dispose()
  }

  private async refresh(): Promise<void> {
    if (this.closed) return
    // 读失败（引擎写入期间的竞态/瞬时错误）不等于偏好被清成 system：保留当前外观。
    const snapshot = await readPreferenceDocument(this.settingsPath)
    if (!snapshot.readable) return
    const preference = snapshot.preference
    if (preference === this.preference) return
    this.preference = preference
    this.apply(resolveAppearance(preference))
  }
}
