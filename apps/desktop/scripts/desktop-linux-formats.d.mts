/** Environment variable that selects the Linux artifact formats. */
export const DESKTOP_LINUX_FORMATS_ENV: 'DSH_DESKTOP_LINUX_FORMATS'

/** One Linux artifact format electron-builder may produce. */
export type DesktopLinuxFormat = 'deb' | 'AppImage'

/**
 * Resolve the Linux artifact formats from the packaging environment.
 * An absent or empty variable selects every format; an unknown or empty entry fails loud
 * rather than dropping the format the caller meant to request.
 * @param env - Packaging environment.
 * @returns Selected formats in canonical order, without duplicates.
 */
export function resolveDesktopLinuxFormats(env: NodeJS.ProcessEnv): DesktopLinuxFormat[]
