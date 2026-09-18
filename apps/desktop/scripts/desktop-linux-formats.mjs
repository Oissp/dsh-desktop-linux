/** Resolve the Linux artifact formats one packaging run builds. */

/** Environment variable that selects the Linux artifact formats. */
export const DESKTOP_LINUX_FORMATS_ENV = 'DSH_DESKTOP_LINUX_FORMATS'

/** Every Linux artifact format electron-builder may produce, in canonical build order. */
const LINUX_FORMATS = ['deb', 'AppImage']

/**
 * Resolve the Linux artifact formats from the packaging environment.
 * An absent or empty variable selects every format; an unknown or empty entry fails loud
 * rather than dropping the format the caller meant to request.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @returns {string[]} Selected formats in canonical order, without duplicates.
 */
export function resolveDesktopLinuxFormats(env) {
  const value = env[DESKTOP_LINUX_FORMATS_ENV]?.trim()
  if (value === undefined || value === '') return [...LINUX_FORMATS]
  const requested = value.split(',').map(entry => entry.trim())
  const empty = requested.indexOf('')
  if (empty !== -1) {
    throw new Error(`desktop linux formats: ${DESKTOP_LINUX_FORMATS_ENV} has an empty entry at position ${String(empty + 1)}`)
  }
  for (const format of requested) {
    if (!LINUX_FORMATS.includes(format)) {
      throw new Error(`desktop linux formats: ${DESKTOP_LINUX_FORMATS_ENV} has unsupported format ${JSON.stringify(format)}; expected ${LINUX_FORMATS.join(' or ')}`)
    }
  }
  const selected = new Set(requested)
  return LINUX_FORMATS.filter(format => selected.has(format))
}
