/**
 * Shell UI language resolved from the engine's persisted locale preference.
 *
 * The dsh web engine persists its Language choice (`locale.preference`, a
 * BCP 47-style id such as `zh` or `en`) in `<harness home>/settings.yaml`
 * alongside `ui-theme.preference`. The shell resolves its dictionary from
 * that preference, falling back to Electron's system locale while no explicit
 * choice is stored, and watches the document so tray menus and dialogs follow
 * the setting live.
 * @module
 */

import { readFile } from 'node:fs/promises'
import { load } from 'js-yaml'
import { resolveDesktopLocale, type DesktopLocale } from './locale.ts'
import { DesktopSettingsWatcher } from './settings-watcher.ts'

/** The dsh engine's locale namespace and field inside settings.yaml. */
const LOCALE_SETTINGS_NAMESPACE = 'locale'
const LOCALE_PREFERENCE_FIELD = 'preference'

function preferenceOf(sections: unknown): string | undefined {
  if (typeof sections !== 'object' || sections === null) return undefined
  const locale = (sections as Record<string, unknown>)[LOCALE_SETTINGS_NAMESPACE]
  if (typeof locale !== 'object' || locale === null) return undefined
  const preference = (locale as Record<string, unknown>)[LOCALE_PREFERENCE_FIELD]
  return typeof preference === 'string' && preference !== '' ? preference : undefined
}

/** One locale read: the stored preference and whether the document was readable. */
interface LocalePreferenceSnapshot {
  readonly preference: string | undefined
  readonly readable: boolean
}

async function readLocalePreferenceSnapshot(path: string): Promise<LocalePreferenceSnapshot> {
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

/** Read the stored locale preference; `undefined` when absent or unreadable. */
export async function readLocalePreference(path: string): Promise<string | undefined> {
  return (await readLocalePreferenceSnapshot(path)).preference
}

/**
 * Watch one settings document and re-apply the shell locale on external edits.
 * An explicit engine preference wins; absence delegates to the system locale.
 */
export class DesktopLocaleController {
  private watcher: DesktopSettingsWatcher
  private preference: string | undefined
  private closed = false
  private locale: DesktopLocale

  /**
   * @param settingsPath - the `<harness home>/settings.yaml` document.
   * @param systemLocale - Electron's locale, used while no preference is stored.
   * @param apply - invoked with the resolved locale at start and on change.
   */
  constructor(
    private readonly settingsPath: string,
    private readonly systemLocale: string,
    private readonly apply: (locale: DesktopLocale) => void,
  ) {
    this.locale = resolveDesktopLocale(systemLocale)
    this.watcher = new DesktopSettingsWatcher(settingsPath, () => { void this.refresh() })
  }

  /** Read the initial preference, apply once, and arm the watcher. */
  async start(): Promise<void> {
    this.preference = await readLocalePreference(this.settingsPath)
    this.locale = resolveDesktopLocale(this.preference ?? this.systemLocale)
    this.apply(this.locale)
    this.watcher.start()
  }

  /** Stop watching the settings document. */
  dispose(): void {
    this.closed = true
    this.watcher.dispose()
  }

  private applyLocale(): void {
    const resolved = resolveDesktopLocale(this.preference ?? this.systemLocale)
    if (resolved.id === this.locale.id) return
    this.locale = resolved
    this.apply(resolved)
  }

  private async refresh(): Promise<void> {
    if (this.closed) return
    // 读失败（引擎写入期间的竞态/瞬时错误）不等于偏好被清成默认：保留当前语言。
    const snapshot = await readLocalePreferenceSnapshot(this.settingsPath)
    if (!snapshot.readable) return
    const preference = snapshot.preference
    if (preference === this.preference) return
    this.preference = preference
    this.applyLocale()
  }
}
