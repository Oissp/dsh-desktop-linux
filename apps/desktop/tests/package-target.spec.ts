import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  desktopElectronBuilderArguments,
  parseDesktopPackageInvocation,
  resolveDesktopPackageTarget,
} from '../scripts/package-target.ts'
import { desktopTargetBuildPaths } from '../scripts/desktop-build-paths.mjs'

describe('desktop package target', () => {
  it('packs the Electron distribution that prepare:runtime extracted', async () => {
    // 配置文件在导入时就会按宿主平台求值默认导出，需要先把目标固定到 linux-x64。
    process.env.DSH_DESKTOP_APP_ID = 'com.example.desktop-test'
    process.env.DSH_DESKTOP_TARGET_PLATFORM = 'linux'
    process.env.DSH_DESKTOP_TARGET_ARCH = 'x64'
    const { createElectronBuilderConfig } = await import('../electron-builder.config.mjs')
    const config = createElectronBuilderConfig({ DSH_DESKTOP_APP_ID: 'com.example.desktop-test' }, 'linux', 'x64')
    expect(config.electronDist).toBe(desktopTargetBuildPaths('linux-x64').electron)
    expect(join(config.electronDist, 'electron')).toContain(join('targets', 'linux-x64', 'electron'))
  })

  it('gives the packaged Linux app one identity for window association', async () => {
    const { createElectronBuilderConfig } = await import('../electron-builder.config.mjs')
    const config = createElectronBuilderConfig({ DSH_DESKTOP_APP_ID: 'com.example.desktop-test' }, 'linux', 'x64')
    // 桌面环境用窗口的 WM_CLASS/app_id 匹配 .desktop 的 StartupWMClass。两处回退值并不相等
    // （Electron 用 app 名的小写 slug，electron-builder 用 productName），只有随包写入的
    // desktopName 让它们取到同一个身份，.desktop 文件名也才会跟着它。
    expect(config.extraMetadata.desktopName).toBe(config.appId)
    expect(config.linux.syncDesktopName).toBe(true)
  })

  it('selects the Linux x64 target selectors', () => {
    expect(resolveDesktopPackageTarget('linux-x64', 'linux', 'x64')).toMatchObject({
      platform: 'linux', arch: 'x64', builderPlatform: '--linux', builderArch: '--x64',
    })
  })

  it('rejects unsupported targets and hosts before building', () => {
    expect(() => resolveDesktopPackageTarget('linux-x64', 'darwin', 'arm64')).toThrow(/Linux x64/u)
    expect(() => resolveDesktopPackageTarget('linux-x64', 'linux', 'arm64')).toThrow(/Linux x64/u)
    expect(() => resolveDesktopPackageTarget('linux-x64', 'linux', 'x86')).toThrow(/Linux x64/u)
    expect(() => resolveDesktopPackageTarget('mac-arm64', 'darwin', 'arm64')).toThrow(/unsupported target/u)
    expect(() => resolveDesktopPackageTarget('win-x64', 'win32', 'x64')).toThrow(/unsupported target/u)
  })

  it('parses installer and unpacked-directory invocations', () => {
    expect(parseDesktopPackageInvocation(['linux-x64'], 'linux', 'x64').directory).toBe(false)
    expect(parseDesktopPackageInvocation(['linux-x64', '--dir'], 'linux', 'x64').directory).toBe(true)
    expect(parseDesktopPackageInvocation([], 'linux', 'x64').target.name).toBe('linux-x64')
    expect(parseDesktopPackageInvocation(['--prepare-only'], 'linux', 'x64').prepareOnly).toBe(true)
    expect(parseDesktopPackageInvocation(['--builder-only'], 'linux', 'x64').builderOnly).toBe(true)
    expect(() => parseDesktopPackageInvocation(['linux-x64', '--prepare-only', '--builder-only'], 'linux', 'x64'))
      .toThrow(/mutually exclusive/u)
    expect(() => parseDesktopPackageInvocation(['linux-x64', 'linux-arm64'], 'linux', 'x64'))
      .toThrow(/at most one target/u)
  })

  it('keeps electron-builder publishing to the release workflow', () => {
    const target = resolveDesktopPackageTarget('linux-x64', 'linux', 'x64')
    expect(desktopElectronBuilderArguments(target, false)).toEqual([
      'exec',
      'electron-builder',
      '--config',
      'electron-builder.config.mjs',
      '--linux',
      '--x64',
      '--publish',
      'never',
    ])
    expect(desktopElectronBuilderArguments(target, true)).toContain('--dir')
  })
})
