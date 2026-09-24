import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  desktopElectronBuilderArguments,
  parseDesktopPackageInvocation,
  resolveDesktopPackageTarget,
  shellRuntimeImports,
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

  it('registers a beforePack hook that unpacks the Office closure beside the engine glob', async () => {
    const { createElectronBuilderConfig } = await import('../electron-builder.config.mjs')
    const config = createElectronBuilderConfig({ DSH_DESKTOP_APP_ID: 'com.example.desktop-test' }, 'linux', 'x64')
    // 静态 asarUnpack 只命中引擎包（libreoffice-kit-*），kit 本体靠 beforePack 在打包期
    // 追加闭包模式解包；缺失该钩子会让 skill-office 的 CLI 路径不存在、宿主启动即失败。
    expect(typeof config.beforePack).toBe('function')
  })

  it('packs the welcome renderer bundle that welcome.html loads from lib/welcome', async () => {
    const { createElectronBuilderConfig } = await import('../electron-builder.config.mjs')
    const config = createElectronBuilderConfig({ DSH_DESKTOP_APP_ID: 'com.example.desktop-test' }, 'linux', 'x64')
    // welcome.html 通过相对路径引用 ../lib/welcome/welcome.js 与样式/字体；'lib/*.js' 只匹配
    // 顶层文件，不会带入该子目录。缺这条模式，打包后 welcome 窗口加载即失败，显示空白竖长窗口。
    const files = config.files as readonly (string | { filter?: readonly string[] })[]
    const patterns = files.flatMap(entry => typeof entry === 'string' ? [entry] : (entry.filter ?? []))
    expect(patterns).toContain('lib/welcome/**/*')
  })

  it('checks every package the built shell bundle imports at load time', () => {
    // prepare 既准备 Electron/dsh，也是唯一构建壳自身 workspace 依赖的步骤；命中缓存跳过它
    // 会让 app.asar 缺少这些包的 lib/，主进程 import 失败、窗口不出现。断言必须只看真正的
    // 外部依赖，否则会把相对导入和内置模块也当成待构建产物。
    expect(shellRuntimeImports([
      'import { app } from "electron";',
      'import { Context } from "@deepseek-ai/cordis";',
      'import { parse } from "@deepseek-ai/dsh-api-gateway/stream-protocol";',
      'import "./local.ts";',
      'import "node:fs";',
      'import "@deepseek-ai/dsh-brand";',
      'const lazy = await import("ws");',
    ].join('\n'))).toEqual(['@deepseek-ai/cordis', '@deepseek-ai/dsh-api-gateway/stream-protocol', '@deepseek-ai/dsh-brand', 'electron', 'ws'])
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

  it('parses build version and keeps electron-builder publishing to the release workflow', () => {
    const target = resolveDesktopPackageTarget('linux-x64', 'linux', 'x64')
    expect(parseDesktopPackageInvocation(['linux-x64'], 'linux', 'x64').requestedBuildVersion).toBeUndefined()
    expect(parseDesktopPackageInvocation(['linux-x64', '--build-version', '0.1.7-alpha.1.20260922.1'], 'linux', 'x64')
      .requestedBuildVersion).toBe('0.1.7-alpha.1.20260922.1')
    // A run script's preset arguments come first, so pnpm forwards the separator after the target.
    expect(parseDesktopPackageInvocation(['linux-x64', '--', '--build-version', '0.1.7-alpha.1.20260922.1'], 'linux', 'x64'))
      .toMatchObject({ requestedBuildVersion: '0.1.7-alpha.1.20260922.1', target: { name: 'linux-x64' } })
    expect(() => parseDesktopPackageInvocation(['linux-x64', '--build-version', '  '], 'linux', 'x64'))
      .toThrow(/--build-version requires a value/u)
    expect(desktopElectronBuilderArguments(target, false, '0.1.7-alpha.1')).toEqual([
      'exec',
      'electron-builder',
      '--config',
      'electron-builder.config.mjs',
      '--config.extraMetadata.version',
      '0.1.7-alpha.1',
      '--linux',
      '--x64',
      '--publish',
      'never',
    ])
    expect(desktopElectronBuilderArguments(target, true, '0.1.7-alpha.1')).toContain('--dir')
  })
})
