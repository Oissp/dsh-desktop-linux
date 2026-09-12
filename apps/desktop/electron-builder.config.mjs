import { join } from 'node:path'
import {
  resolveDesktopAppId,
} from './scripts/desktop-release-environment.mjs'
import { resolveDesktopAutoUpdateConfig } from './scripts/desktop-auto-update-environment.mjs'
import { desktopTargetBuildPaths, resolveDesktopBuildTarget } from './scripts/desktop-build-paths.mjs'

/**
 * Create electron-builder configuration from one release environment.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @param {NodeJS.Platform} hostPlatform - Build-host platform used when no explicit target is present.
 * @param {string} hostArch - Build-host architecture used when no explicit target is present.
 * @returns {object} electron-builder configuration.
 */
export function createElectronBuilderConfig(
  env = process.env,
  hostPlatform = process.platform,
  hostArch = process.arch,
) {
  const appId = resolveDesktopAppId(env)
  const targetPlatform = env.DSH_DESKTOP_TARGET_PLATFORM
  const resolvedPlatform = targetPlatform ?? hostPlatform
  const resolvedArch = env.DSH_DESKTOP_TARGET_ARCH ?? hostArch
  const update = resolveDesktopAutoUpdateConfig(env, resolvedPlatform, resolvedArch)
  const buildPaths = desktopTargetBuildPaths(resolveDesktopBuildTarget(env, hostPlatform, hostArch))
  return {
    appId,
    productName: 'DeepSeek Harness',
    // electron-builder 的 linux ${arch} 宏是 amd64/x86_64（非 x64），本仓库仅构建
    // linux-x64，硬编码命名以与 README/校验/发布 glob 保持一致。
    artifactName: 'deepseek-harness-${version}-linux-x64.${ext}',
    directories: { output: buildPaths.artifacts },
    asar: true,
    files: [
      'lib/*.js',
      'lib/*.cjs',
      'renderer/**/*',
      'package.json',
    ],
    extraResources: [
      { from: buildPaths.runtime, to: 'runtime' },
      { from: buildPaths.dsh, to: 'dsh' },
      // electron-builder excludes a source directory's root node_modules.
      { from: join(buildPaths.dsh, 'node_modules'), to: 'dsh/node_modules' },
    ],
    afterPack: async context => {
      const { verifyDesktopRuntime } = await import('./lib/types/runtime-tree.js')
      await verifyDesktopRuntime(join(context.packager.getResourcesDir(context.appOutDir), 'dsh'),
        context.packager.appInfo.version, { platform: resolvedPlatform, arch: resolvedArch })
    },
    linux: {
      category: 'Development',
      // scoped 包名 @deepseek-ai/dsh-desktop 会被 electron-builder 算成非法的
      // @deepseek-aidsh-desktop（含 @/ 分隔符），必须显式给安全的可执行名。
      executableName: 'deepseek-harness-desktop',
      target: ['deb', 'AppImage'],
    },
    deb: {
      packageName: 'deepseek-harness-desktop',
    },
    publish: [{ provider: 'generic', url: update.publicUrl }],
  }
}

export default createElectronBuilderConfig()
