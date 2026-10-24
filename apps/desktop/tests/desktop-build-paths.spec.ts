import { join, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  desktopTargetBuildPaths,
  desktopTargetPlatform,
  developmentRuntimeDirectory,
  resolveDesktopBuildTarget,
  resolveDesktopTargetBuildPaths,
} from '../scripts/desktop-build-paths.mjs'

describe('desktop build paths', () => {
  it('owns every mutable build directory under the linux-x64 target', () => {
    const linux = desktopTargetBuildPaths('linux-x64')
    const mutableKeys = [
      'root',
      'artifacts',
      'unsignedArtifacts',
      'unnotarizedArtifacts',
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

  it('shares download and package caches outside the target directory', () => {
    const linux = desktopTargetBuildPaths('linux-x64')
    expect(linux.downloads).not.toContain(`${sep}targets${sep}`)
    expect(linux.pnpmStore).not.toContain(`${sep}targets${sep}`)
    expect(linux.downloads).not.toBe(linux.pnpmStore)
  })

  it('retains target outputs while relocating caches through the supplied environment', () => {
    const cache = resolve('external-package-cache')
    const environment = { DSH_DESKTOP_PACKAGE_CACHE_DIR: cache }
    const defaults = desktopTargetBuildPaths('linux-x64', {})
    const paths = resolveDesktopTargetBuildPaths(environment, 'linux', 'x64')
    expect(paths).toEqual({ ...defaults, downloads: join(cache, 'downloads'), pnpmStore: join(cache, 'pnpm-store') })
    const configured = desktopTargetBuildPaths('linux-x64', environment)
    expect(configured.downloads).toBe(join(cache, 'downloads'))
    expect(configured.pnpmStore).toBe(join(cache, 'pnpm-store'))
    expect(configured.root).not.toContain(cache)
    expect(defaults.pnpmStore).not.toContain(`${sep}targets${sep}`)
  })

  it('resolves the development primary runtime from the build target', () => {
    expect(developmentRuntimeDirectory({}, 'linux', 'x64'))
      .toContain(join('targets', 'linux-x64', 'runtime', 'primary-runtime'))
  })

  it('maps the linux-x64 target to the platform and architecture of the payload it prepares', () => {
    expect(desktopTargetPlatform('linux-x64')).toEqual({ platform: 'linux', arch: 'x64' })
    expect(() => desktopTargetPlatform('mac-arm64' as 'linux-x64')).toThrow(/unsupported target/u)
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

  it.each(['', ' ', 'relative/cache', './cache', 'cache\0invalid'])('rejects invalid cache directory %j', (directory) => {
    expect(() => desktopTargetBuildPaths('linux-x64', { DSH_DESKTOP_PACKAGE_CACHE_DIR: directory }))
      .toThrow('DSH_DESKTOP_PACKAGE_CACHE_DIR')
  })
})
