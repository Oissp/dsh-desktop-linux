/** Electron-builder fields asserted by the Desktop release tests. */
export interface DesktopElectronBuilderConfig {
  readonly appId: string
  readonly directories: {
    readonly output: string
  }
  readonly files: readonly [
    string,
    string,
    string,
    string,
    { readonly from: string, readonly to: 'dsh', readonly filter: readonly ['**/*'] },
    { readonly from: string, readonly to: 'dsh/node_modules', readonly filter: readonly ['**/*'] },
  ]
  readonly electronDist: string
  readonly asarUnpack: readonly string[]
  readonly extraMetadata: {
    readonly desktopName: string
  }
  readonly extraResources: readonly [
    { readonly from: string, readonly to: 'runtime' },
    { readonly from: string, readonly to: 'icon-dark.png' },
    { readonly from: string, readonly to: 'tray-dark.png' },
    { readonly from: string, readonly to: 'icon-white.png' },
    { readonly from: string, readonly to: 'tray-white.png' },
  ]
  readonly linux: {
    readonly category: string
    readonly syncDesktopName: boolean
    readonly target: readonly string[]
  }
  readonly publish: readonly [{ readonly provider: 'github', readonly owner: string, readonly repo: string }]
}

/**
 * Create electron-builder configuration from one release environment.
 * @param env - Packaging environment.
 * @param hostPlatform - Build-host platform used when no explicit target is present.
 * @param hostArch - Build-host architecture used when no explicit target is present.
 * @returns electron-builder configuration.
 */
export function createElectronBuilderConfig(
  env?: NodeJS.ProcessEnv,
  hostPlatform?: NodeJS.Platform,
  hostArch?: string,
): DesktopElectronBuilderConfig

declare const electronBuilderConfig: DesktopElectronBuilderConfig

export default electronBuilderConfig
