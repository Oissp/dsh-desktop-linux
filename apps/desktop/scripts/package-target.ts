/** Build one release target with matching Electron, Node.js, and dsh architecture. */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { join, resolve } from 'node:path'
import { desktopTargetBuildPaths, type DesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { shellVersionExtendsEngine } from '../src/release-version.ts'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')

/** Fixed platform and architecture identifier exposed by package scripts. */
export type DesktopPackageTargetName = 'linux-x64'

/** The single supported release target and its electron-builder selectors. */
export interface DesktopPackageTarget {
  readonly name: DesktopPackageTargetName
  readonly platform: 'linux'
  readonly arch: 'x64'
  readonly builderPlatform: '--linux'
  readonly builderArch: '--x64'
}

const TARGETS: Record<DesktopPackageTargetName, DesktopPackageTarget> = {
  'linux-x64': {
    name: 'linux-x64',
    platform: 'linux',
    arch: 'x64',
    builderPlatform: '--linux',
    builderArch: '--x64',
  },
}

function isTargetName(value: string): value is DesktopPackageTargetName {
  return Object.hasOwn(TARGETS, value)
}

function packageVersion(path: string, label: string): string {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    throw new Error(`desktop package: ${label} has no version`)
  }
  return manifest.version
}

/**
 * Reject a Desktop version that does not extend the bundled engine version.
 * The version becomes both the release tag and the artifact name, so a mismatch
 * would publish artifacts no update check can resolve.
 * @param desktopVersion - Version in `apps/desktop/package.json`.
 * @param dshVersion - Version in the repository root `package.json`.
 */
function assertDesktopVersionExtendsEngine(desktopVersion: string, dshVersion: string): void {
  if (!shellVersionExtendsEngine(desktopVersion, dshVersion)) {
    throw new Error(`desktop package: desktop version ${desktopVersion} does not extend dsh version ${dshVersion}`)
  }
}

/**
 * Resolve a named release target and reject hosts that cannot execute its packaged runtime.
 * @param name - The fixed Desktop release target name.
 * @param hostPlatform - Build-host Node.js platform.
 * @param hostArch - Build-host Node.js architecture.
 * @returns The target selectors shared by runtime preparation and electron-builder.
 */
export function resolveDesktopPackageTarget(
  name: string,
  hostPlatform: NodeJS.Platform = process.platform,
  hostArch: string = process.arch,
): DesktopPackageTarget {
  if (!isTargetName(name)) {
    throw new Error(`desktop package: unsupported target ${JSON.stringify(name)}; expected ${Object.keys(TARGETS).join(', ')}`)
  }
  const target = TARGETS[name]
  if (hostPlatform !== 'linux' || hostArch !== 'x64') {
    throw new Error('desktop package: linux-x64 requires a Linux x64 build host')
  }
  return target
}

interface DesktopPackageInvocation {
  readonly target: DesktopPackageTarget
  readonly directory: boolean
  readonly prepareOnly: boolean
  readonly builderOnly: boolean
}

function hostTargetName(platform: NodeJS.Platform, arch: string): DesktopPackageTargetName {
  const name = `${platform}-${arch}`
  if (!isTargetName(name)) throw new Error(`desktop package: unsupported build host ${platform}-${arch}`)
  return name
}

/**
 * Parse the fixed-target packaging command line.
 * @param argv - Arguments after the script entry point.
 * @param hostPlatform - Build-host Node.js platform.
 * @param hostArch - Build-host Node.js architecture.
 * @returns The validated target, directory flag, and which of prepare-only or builder-only apply.
 */
export function parseDesktopPackageInvocation(
  argv: readonly string[],
  hostPlatform: NodeJS.Platform = process.platform,
  hostArch: string = process.arch,
): DesktopPackageInvocation {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      dir: { type: 'boolean', default: false },
      'prepare-only': { type: 'boolean', default: false },
      'builder-only': { type: 'boolean', default: false },
    },
  })
  if (positionals.length > 1) throw new Error('desktop package: expected at most one target')
  const name = positionals[0] ?? hostTargetName(hostPlatform, hostArch)
  const prepareOnly = values['prepare-only']
  const builderOnly = values['builder-only']
  if (prepareOnly && builderOnly) {
    throw new Error('desktop package: --prepare-only and --builder-only are mutually exclusive')
  }
  return {
    target: resolveDesktopPackageTarget(name, hostPlatform, hostArch),
    directory: values.dir,
    prepareOnly,
    builderOnly,
  }
}

/**
 * Build the electron-builder command arguments for the validated target.
 * @param target - The supported release target.
 * @param directory - Whether to stop at an unpacked application directory.
 * @returns Arguments that keep publishing under the separate validated upload command.
 */
export function desktopElectronBuilderArguments(
  target: DesktopPackageTarget,
  directory: boolean,
): readonly string[] {
  return [
    'exec',
    'electron-builder',
    '--config',
    'electron-builder.config.mjs',
    target.builderPlatform,
    target.builderArch,
    '--publish',
    'never',
    ...(directory ? ['--dir'] : []),
  ]
}

function runPnpm(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = APP_ROOT,
): Promise<void> {
  const pnpmEntry = process.env.npm_execpath
  if (pnpmEntry === undefined || pnpmEntry === '') {
    throw new Error('desktop package: invoke this script through a pnpm package command')
  }
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [pnpmEntry, ...args], {
      cwd,
      env,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`desktop package: pnpm ${args.join(' ')} exited with ${String(code ?? signal)}`))
    })
  })
}

async function main(): Promise<void> {
  const invocation = parseDesktopPackageInvocation(process.argv.slice(2))
  const { target } = invocation
  const buildPaths = desktopTargetBuildPaths(target.name)
  assertDesktopVersionExtendsEngine(
    packageVersion(join(APP_ROOT, 'package.json'), 'desktop package'),
    packageVersion(join(REPOSITORY_ROOT, 'package.json'), 'dsh package'),
  )
  const buildEnv = process.env
  const targetEnv: NodeJS.ProcessEnv = {
    ...buildEnv,
    DSH_DESKTOP_TARGET_PLATFORM: target.platform,
    DSH_DESKTOP_TARGET_ARCH: target.arch,
  }
  if (invocation.builderOnly) {
    assertBuilderInputsPresent(buildPaths)
  } else {
    await runPnpm(['run', 'build:official'], buildEnv, REPOSITORY_ROOT)
    await runPnpm(['run', 'release:pack', '--family', 'dsh', '--out', buildPaths.packedDsh], buildEnv, REPOSITORY_ROOT)
    await runPnpm([
      '--dir',
      'apps/desktop-host',
      'pack',
      '--pack-destination',
      buildPaths.packedDsh,
    ], buildEnv, REPOSITORY_ROOT)
    await runPnpm(['run', 'release:pack', '--family', 'vendor', '--out', buildPaths.packedVendor], buildEnv, REPOSITORY_ROOT)
    rmSync(buildPaths.packedLandlock, { recursive: true, force: true })
    mkdirSync(buildPaths.packedLandlock, { recursive: true })
    await runPnpm(['--dir', 'native/system', 'run', 'build:ts'], buildEnv, REPOSITORY_ROOT)
    await runPnpm([
      '--dir',
      'native/system/packages/entry',
      'pack',
      '--pack-destination',
      buildPaths.packedLandlock,
    ], buildEnv, REPOSITORY_ROOT)
    await runPnpm(['run', 'prepare:runtime'], targetEnv)
    await runPnpm(['run', 'prepare:packages'], targetEnv)
    await runPnpm(['run', 'prepare:dsh'], targetEnv)
  }
  if (invocation.prepareOnly) return
  await runPnpm(desktopElectronBuilderArguments(target, invocation.directory), targetEnv)
}

/**
 * Verify every prepared input electron-builder consumes exists before a cache-backed build.
 * @param buildPaths - Target paths whose prepared engine and runtime directories are required.
 */
function assertBuilderInputsPresent(buildPaths: DesktopTargetBuildPaths): void {
  const required: ReadonlyArray<readonly [string, string]> = [
    ['desktop main bundle', join(APP_ROOT, 'lib', 'main.js')],
    ['Electron runtime', join(buildPaths.electron, 'electron')],
    ['dsh runtime manifest', join(buildPaths.dsh, 'package.json')],
  ]
  const missing = required.filter(([, path]) => !existsSync(path))
  if (missing.length > 0) {
    throw new Error(`desktop package: --builder-only needs prepared outputs missing: ${missing.map(([label]) => label).join(', ')}`)
  }
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) await main()
