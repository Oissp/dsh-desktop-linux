/** Build one release target with matching Electron, Node.js, and dsh architecture. */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { parseArgs } from 'node:util'
import { join, resolve } from 'node:path'
import { shellVersionExtendsEngine } from '../src/release-version.ts'
import { desktopTargetBuildPaths, type DesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { DESKTOP_BUILD_VERSION_ENV, resolveDesktopBuildVersion, validateDesktopBuildVersion } from './desktop-build-version.mjs'

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
  /** Build identifier to publish under, when this build does not publish the product version. */
  readonly requestedBuildVersion: string | undefined
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
    // `pnpm run <script> -- --build-version x` forwards the separator itself, and the script's own
    // preset arguments come first, so it can land anywhere; parseArgs would read the rest as targets.
    args: [...argv].filter(argument => argument !== '--'),
    allowPositionals: true,
    options: {
      dir: { type: 'boolean', default: false },
      'prepare-only': { type: 'boolean', default: false },
      'builder-only': { type: 'boolean', default: false },
      'build-version': { type: 'string' },
    },
  })
  if (positionals.length > 1) throw new Error('desktop package: expected at most one target')
  const name = positionals[0] ?? hostTargetName(hostPlatform, hostArch)
  const prepareOnly = values['prepare-only']
  const builderOnly = values['builder-only']
  if (prepareOnly && builderOnly) {
    throw new Error('desktop package: --prepare-only and --builder-only are mutually exclusive')
  }
  const requestedBuildVersion = values['build-version']?.trim()
  if (values['build-version'] !== undefined && (requestedBuildVersion === undefined || requestedBuildVersion === '')) {
    throw new Error('desktop package: --build-version requires a value')
  }
  return {
    target: resolveDesktopPackageTarget(name, hostPlatform, hostArch),
    directory: values.dir,
    prepareOnly,
    builderOnly,
    requestedBuildVersion,
  }
}

/**
 * Build the electron-builder command arguments for the validated target.
 * @param target - The supported release target.
 * @param directory - Whether to stop at an unpacked application directory.
 * @param buildVersion - Version electron-builder stamps into artifacts and the update feed.
 * @returns Arguments that keep publishing under the separate release workflow.
 */
export function desktopElectronBuilderArguments(
  target: DesktopPackageTarget,
  directory: boolean,
  buildVersion: string,
): readonly string[] {
  return [
    'exec',
    'electron-builder',
    '--config',
    'electron-builder.config.mjs',
    '--config.extraMetadata.version',
    buildVersion,
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

/**
 * Resolve the version one run publishes from what its command line asked for.
 * @param invocation - Validated packaging request.
 * @param productVersion - Version the manifests declare.
 * @param environment - Release settings.
 * @returns The product version, or the requested build version after validation.
 */
function resolveRequestedBuildVersion(
  invocation: DesktopPackageInvocation,
  productVersion: string,
  environment: NodeJS.ProcessEnv,
): string {
  const requested = invocation.requestedBuildVersion
  if (requested === undefined) return resolveDesktopBuildVersion(environment, productVersion)
  return validateDesktopBuildVersion(requested, productVersion)
}

async function main(): Promise<void> {
  const invocation = parseDesktopPackageInvocation(process.argv.slice(2))
  const { target } = invocation
  const buildPaths = desktopTargetBuildPaths(target.name)
  const productVersion = packageVersion(join(APP_ROOT, 'package.json'), 'desktop package')
  const dshVersion = packageVersion(join(REPOSITORY_ROOT, 'package.json'), 'dsh package')
  if (!shellVersionExtendsEngine(productVersion, dshVersion)) {
    throw new Error(`desktop package: desktop version ${productVersion} does not extend dsh version ${dshVersion}`)
  }
  const buildVersion = resolveRequestedBuildVersion(invocation, productVersion, process.env)
  process.env[DESKTOP_BUILD_VERSION_ENV] = buildVersion
  process.stdout.write(`desktop package: ${target.name} publishes ${buildVersion}${buildVersion === productVersion ? '' : ` for product version ${productVersion}`}\n`)
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
  await runPnpm(desktopElectronBuilderArguments(target, invocation.directory, buildVersion), targetEnv)
}

/**
 * Bare specifiers the built shell bundle imports, so Electron resolves them while loading
 * its main script. A package whose build output the prepare step never produced still
 * resolves as a directory, so resolution — not existence — is what proves it usable.
 * @param bundle - Built shell main bundle.
 * @returns Sorted specifiers, excluding relative paths and Node.js builtins.
 */
export function shellRuntimeImports(bundle: string): string[] {
  const specifiers = new Set<string>()
  for (const match of bundle.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/gu)) {
    const specifier = match[1]!
    if (!specifier.startsWith('.') && !specifier.startsWith('node:')) specifiers.add(specifier)
  }
  return [...specifiers].sort()
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
  // The prepare step this cache-backed build skipped is also what builds the shell's
  // workspace dependencies, and electron-builder packs their output into the application.
  const resolve = createRequire(import.meta.url).resolve
  for (const specifier of shellRuntimeImports(readFileSync(join(APP_ROOT, 'lib', 'main.js'), 'utf8'))) {
    try {
      resolve(specifier)
    } catch {
      missing.push([`${specifier} build output`, specifier])
    }
  }
  if (missing.length > 0) {
    throw new Error(`desktop package: --builder-only needs prepared outputs missing: ${missing.map(([label]) => label).join(', ')}`)
  }
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) await main()
