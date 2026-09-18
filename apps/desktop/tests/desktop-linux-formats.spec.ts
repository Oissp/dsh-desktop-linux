import { describe, expect, it } from 'vitest'
import {
  DESKTOP_LINUX_FORMATS_ENV,
  resolveDesktopLinuxFormats,
} from '../scripts/desktop-linux-formats.mjs'

describe('desktop linux formats', () => {
  it('builds every format when the environment selects none', () => {
    expect(resolveDesktopLinuxFormats({})).toEqual(['deb', 'AppImage'])
    expect(resolveDesktopLinuxFormats({ [DESKTOP_LINUX_FORMATS_ENV]: '  ' })).toEqual(['deb', 'AppImage'])
  })

  it('builds only the formats the environment names', () => {
    expect(resolveDesktopLinuxFormats({ [DESKTOP_LINUX_FORMATS_ENV]: 'deb' })).toEqual(['deb'])
    expect(resolveDesktopLinuxFormats({ [DESKTOP_LINUX_FORMATS_ENV]: 'AppImage' })).toEqual(['AppImage'])
  })

  it('returns named formats in canonical build order without duplicates', () => {
    expect(resolveDesktopLinuxFormats({ [DESKTOP_LINUX_FORMATS_ENV]: 'AppImage,deb' })).toEqual(['deb', 'AppImage'])
    expect(resolveDesktopLinuxFormats({ [DESKTOP_LINUX_FORMATS_ENV]: 'deb, deb' })).toEqual(['deb'])
  })

  it('rejects a format electron-builder cannot build', () => {
    expect(() => resolveDesktopLinuxFormats({ [DESKTOP_LINUX_FORMATS_ENV]: 'rpm' }))
      .toThrow(/unsupported format "rpm"/u)
    expect(() => resolveDesktopLinuxFormats({ [DESKTOP_LINUX_FORMATS_ENV]: 'deb,rpm' }))
      .toThrow(/unsupported format "rpm"/u)
  })

  it('rejects a list with an empty entry instead of dropping it', () => {
    expect(() => resolveDesktopLinuxFormats({ [DESKTOP_LINUX_FORMATS_ENV]: 'deb,' }))
      .toThrow(/empty entry at position 2/u)
    expect(() => resolveDesktopLinuxFormats({ [DESKTOP_LINUX_FORMATS_ENV]: ',' }))
      .toThrow(/empty entry at position 1/u)
  })
})
