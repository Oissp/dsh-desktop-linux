import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  desktopTargetBuildPaths,
  desktopTargetPlatform,
  developmentRuntimeDirectory,
  resolveDesktopBuildTarget,
} from '../scripts/desktop-build-paths.mjs'

describe('desktop build paths', () => {
  it('owns every mutable build directory under the linux-x64 target', () => {
    const linux = desktopTargetBuildPaths('linux-x64')
    const mutableKeys = [
      'root',
      'artifacts',
      'unsignedArtifacts',
      'runtime',
      'packageSet',
      'dsh',
      'dshPnpm',
      'electron',
      'packedDsh',
      'packedVendor',
      'packedLandlock',
    ] as const

    for (const key of mutableKeys) {
      expect(linux[key]).toContain(join('targets', 'linux-x64'))
    }
    expect(linux.artifacts).toContain(join('targets', 'linux-x64', 'artifacts'))
  })

  it('keeps the immutable upstream download cache outside the target directory', () => {
    const linux = desktopTargetBuildPaths('linux-x64')
    expect(linux.downloads).not.toContain(`${sep}targets${sep}`)
  })

  it('resolves the development primary runtime from the build target rather than the host architecture', () => {
    expect(developmentRuntimeDirectory({}, 'darwin', 'arm64'))
      .toContain(join('targets', 'mac-arm64', 'runtime', 'primary-runtime'))
    expect(developmentRuntimeDirectory({}, 'darwin', 'x64'))
      .toContain(join('targets', 'mac-x64', 'runtime', 'primary-runtime'))
    expect(developmentRuntimeDirectory({}, 'win32', 'arm64'))
      .toContain(join('targets', 'win-x64', 'runtime', 'primary-runtime'))
  })

  it('maps every target to the platform and architecture of the payload it prepares', () => {
    expect(desktopTargetPlatform('mac-arm64')).toEqual({ platform: 'darwin', arch: 'arm64' })
    expect(desktopTargetPlatform('mac-x64')).toEqual({ platform: 'darwin', arch: 'x64' })
    expect(desktopTargetPlatform('win-x64')).toEqual({ platform: 'win32', arch: 'x64' })
    expect(() => desktopTargetPlatform('linux-x64' as 'mac-x64')).toThrow(/unsupported target/u)
  })

  it('resolves environment overrides and rejects unsupported targets', () => {
    expect(resolveDesktopBuildTarget({}, 'linux', 'x64')).toBe('linux-x64')
    expect(resolveDesktopBuildTarget({
      DSH_DESKTOP_TARGET_PLATFORM: 'linux',
      DSH_DESKTOP_TARGET_ARCH: 'x64',
    }, 'linux', 'arm64')).toBe('linux-x64')
    expect(() => resolveDesktopBuildTarget({}, 'linux', 'arm64')).toThrow(/unsupported target/u)
    expect(() => resolveDesktopBuildTarget({}, 'darwin', 'arm64')).toThrow(/unsupported target/u)
    expect(() => resolveDesktopBuildTarget({}, 'win32', 'x64')).toThrow(/unsupported target/u)
    expect(() => desktopTargetBuildPaths('linux-arm64' as 'linux-x64')).toThrow(/unsupported target/u)
  })
})
