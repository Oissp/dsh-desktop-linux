import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  desktopTargetBuildPaths,
  resolveDesktopBuildTarget,
} from '../scripts/desktop-build-paths.mjs'

describe('desktop build paths', () => {
  it('owns every mutable build directory under the linux-x64 target', () => {
    const linux = desktopTargetBuildPaths('linux-x64')
    const mutableKeys = [
      'root',
      'artifacts',
      'runtime',
      'packageSet',
      'dsh',
      'dshPnpm',
      'nodeExtract',
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
