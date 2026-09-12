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

import { watch, type FSWatcher } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { nativeTheme } from 'electron'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { parse } from 'yaml'

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
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return undefined
  }
  try {
    return preferenceOf(parse(text))
  } catch {
    return undefined
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
  private watcher: FSWatcher | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private retry: ReturnType<typeof setTimeout> | undefined
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
  ) {}

  /** Read the initial preference, apply once, and arm both watchers. */
  async start(): Promise<void> {
    this.preference = await readAppearancePreference(this.settingsPath)
    this.apply(resolveAppearance(this.preference))
    nativeTheme.on('updated', this.onThemeUpdated)
    this.startWatcher()
  }

  /** Stop watching the document and the OS theme. */
  dispose(): void {
    this.closed = true
    nativeTheme.removeListener('updated', this.onThemeUpdated)
    if (this.timer !== undefined) clearTimeout(this.timer)
    if (this.retry !== undefined) clearTimeout(this.retry)
    this.watcher?.close()
    this.watcher = undefined
  }

  /**
   * Watch the parent directory (not the file) so creates, replaces, and deletes
   * all fire. A missing home directory before the engine's first write re-arms
   * this watcher on a short retry.
   */
  private startWatcher(): void {
    this.watcher?.close()
    this.watcher = undefined
    try {
      const watcher = watch(dirname(this.settingsPath), (_event, filename) => {
        if (typeof filename === 'string' && filename !== basename(this.settingsPath)) return
        this.scheduleRefresh()
      })
      watcher.unref()
      watcher.on('error', () => { watcher.close(); this.scheduleRetry() })
      this.watcher = watcher
    } catch {
      this.scheduleRetry()
    }
  }

  private scheduleRetry(): void {
    if (this.closed || this.retry !== undefined) return
    this.retry = setTimeout(() => {
      this.retry = undefined
      this.startWatcher()
    }, 2_000)
    this.retry.unref()
  }

  /** Debounce edits around the engine's write settle window. */
  private scheduleRefresh(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.refresh()
    }, 150)
  }

  private async refresh(): Promise<void> {
    const preference = await readAppearancePreference(this.settingsPath)
    if (preference === this.preference) return
    this.preference = preference
    this.apply(resolveAppearance(preference))
  }
}
