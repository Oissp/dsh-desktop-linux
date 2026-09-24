import { join } from 'node:path'
import { officeAsarUnpackPatterns } from '../../scripts/libreoffice-packages.mjs'
import {
  resolveDesktopAppId,
} from './scripts/desktop-release-environment.mjs'
import { resolveDesktopLinuxFormats } from './scripts/desktop-linux-formats.mjs'
import { desktopTargetBuildPaths, desktopTargetPlatform, resolveDesktopBuildTarget } from './scripts/desktop-build-paths.mjs'

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
  const buildPaths = desktopTargetBuildPaths(resolveDesktopBuildTarget(env, hostPlatform, hostArch))
  const payloadTarget = desktopTargetPlatform(resolveDesktopBuildTarget(env, hostPlatform, hostArch))
  const linuxFormats = resolveDesktopLinuxFormats(env)
  return {
    appId,
    productName: 'DeepSeek Harness',
    // Linux 靠 .desktop 的 StartupWMClass 匹配窗口的 WM_CLASS/app_id，而两边的回退值不一致：
    // electron-builder 回退到 productName，Electron 回退到 app 名的小写 slug。把 desktopName
    // 显式写成 appId 并随包写入 manifest，两处才取到同一个反向 DNS 身份。
    extraMetadata: { desktopName: appId },
    // electron-builder 的 linux ${arch} 宏是 amd64/x86_64（非 x64），本仓库仅构建
    // linux-x64，硬编码命名以与 README/校验/发布 glob 保持一致。
    artifactName: 'deepseek-harness-${version}-linux-x64.${ext}',
    directories: { output: buildPaths.artifacts },
    asar: true,
    // 复用 prepare:runtime 解压好的 Electron 发行版：electron-builder 默认会另下一份，
    // 与随壳缓存的运行时重复；同时让 --builder-only 的 Electron 断言与打包输入同源。
    electronDist: buildPaths.electron,
    files: [
      'lib/*.js',
      'lib/*.cjs',
      // welcome.html 通过相对路径引用 lib/welcome/ 下的 React 产物（welcome.js/welcome.css、
      // brand-font.css 及字体）；'lib/*.js' 只匹配顶层，不会带入该子目录，缺这条 welcome
      // 窗口加载即失败、显示空白竖长窗口（0.1.7-rc.1 回归）。
      'lib/welcome/**/*',
      'renderer/**/*',
      'package.json',
      { from: buildPaths.dsh, to: 'dsh', filter: ['**/*'] },
      // electron-builder excludes a source directory's root node_modules.
      { from: join(buildPaths.dsh, 'node_modules'), to: 'dsh/node_modules', filter: ['**/*'] },
    ],
    asarUnpack: [
      '**/*.{node,dylib,dll,so,exe}',
      '**/*.so.*',
      '**/spawn-helper',
      '**/@vscode/ripgrep-*/bin/rg',
      '**/node_modules/@deepseek-ai/libreoffice-kit-*/**/*',
    ],
    // 上面的通配只命中引擎包（libreoffice-kit-*），kit 本体仍留在 asar 内。而 desktop-host
    // 把 kit 的 CLI 路径映射到 app.asar.unpacked 下交给 skill-office，后者在插件加载时
    // stat 该文件，缺失会让宿主启动直接失败。这里按上游同一处逻辑解包完整 Office 闭包
    // （kit 本体、其依赖与选定引擎），使映射到的路径真实存在。
    beforePack: async context => {
      const patterns = await officeAsarUnpackPatterns(buildPaths.dsh, payloadTarget)
      const existing = context.packager.config.asarUnpack ?? []
      context.packager.config.asarUnpack = [...(typeof existing === 'string' ? [existing] : existing), ...patterns]
    },
    extraResources: [
      { from: buildPaths.runtime, to: 'runtime' },
      // About 面板图标（main.ts setAboutPanelOptions 读取 resources/icon.png）。
      { from: 'build/icon.png', to: 'icon.png' },
      // 运行期窗口/托盘图标：浅色/深色外观各一对（app icon 本身由 electron-builder
      // 从 build/icon.png 自动识别，不随外观切换）。dsh 运行时树不再放 extraResources：
      // 随 asar 打包（files 内的 dsh 映射），宿主以 ELECTRON_RUN_AS_NODE 运行。
      { from: 'build/icon-dark.png', to: 'icon-dark.png' },
      { from: 'build/tray-dark.png', to: 'tray-dark.png' },
      { from: 'build/icon-white.png', to: 'icon-white.png' },
      { from: 'build/tray-white.png', to: 'tray-white.png' },
    ],
    linux: {
      category: 'Development',
      // scoped 包名 @deepseek-ai/dsh-desktop 会被 electron-builder 算成非法的
      // @deepseek-aidsh-desktop（含 @/ 分隔符），必须显式给安全的可执行名。
      executableName: 'deepseek-harness-desktop',
      // 让 .desktop 文件名跟随 desktopName，而不是 executableName：桌面环境按文件名
      // 标识启动项，名字与窗口身份不一致时窗口不会被归到该启动项下。
      syncDesktopName: true,
      icon: 'build/icon.png',
      target: linuxFormats,
    },
    deb: {
      packageName: 'deepseek-harness-desktop',
    },
    publish: [{
      // 自动更新走独立发布仓库的 GitHub Releases：electron-updater 读取 app-update.yml
      // 里的 provider=github，从该仓库各 release 的 <channel>-linux.yml 与安装资产拉取更新。
      provider: 'github',
      owner: 'Oissp',
      repo: 'dsh-desktop-linux-release',
    }],
  }
}

export default createElectronBuilderConfig()
