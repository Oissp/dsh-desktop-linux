/** Materialize the complete production runtime before publishing Desktop resources. */

import { spawn, execFile } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { load } from 'js-yaml'
import { desktopNodeEnvironment } from '../src/node-environment.ts'
import { createRuntimeProjectMetadata } from '../src/project-manager.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import { shellVersionExtendsEngine } from '../src/release-version.ts'
import { parseDesktopRelease, type DesktopRelease } from '../src/release.ts'
import {
  DESKTOP_HOST_PACKAGE,
  DESKTOP_HOST_RUNTIME_FILES,
  DESKTOP_PACKAGES_DIR,
  DESKTOP_PACKAGE_SET_FILE,
  readDesktopCorePackageSet,
  verifyDesktopCoreLockfile,
} from '../src/core-package-set.ts'
import { smokeDesktopRuntime } from './smoke-runtime.ts'
import {
  patchNativeElectronFingerprint,
  readElectronRuntimeFingerprint,
  verifyNativeElectronFingerprint,
} from './native-electron-fingerprint.ts'
import { writeDesktopRuntime, verifyDesktopRuntime } from '../src/runtime-tree.ts'
import { resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { desktopRuntimeFileExclusion } from './runtime-file-policy.ts'
import { selectOfficeEngine } from '../../../scripts/libreoffice-packages.mjs'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPO_ROOT = resolve(APP_ROOT, '..', '..')
const BUILD_PATHS = resolveDesktopTargetBuildPaths()
const DSH_OUTPUT_ROOT = BUILD_PATHS.dsh
const RUNTIME_ROOT = BUILD_PATHS.runtime
const PNPM_BUILD_STATE = BUILD_PATHS.dshPnpm
const PACKAGE_SET_ROOT = BUILD_PATHS.packageSet
// pnpm 与运行时负载冒烟一律跑在目标 Electron 的 Node 模式（ELECTRON_RUN_AS_NODE）下，
// 与打包后宿主进程的启动方式一致；--expose-internals 是内置加载器的运行前提。
const NODE = join(BUILD_PATHS.electron, process.platform === 'win32' ? 'electron.exe' : 'electron')
const PNPM = join(RUNTIME_ROOT, 'pnpm', 'bin', 'pnpm.mjs')

// Created on first use so importing this module as a library performs no filesystem work.
let buildRoot: string | undefined

function buildRootPath(): string {
  return buildRoot ??= mkdtempSync(join(tmpdir(), 'dsh-desktop-runtime-'))
}

function storeRootPath(): string {
  return join(buildRootPath(), 'store')
}

function manifestVersion(path: string, subject: string): string {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string') throw new Error(`desktop runtime: ${subject} has no version`)
  return manifest.version
}

/**
 * Resolve the shell's Electron executable for runtime fingerprint probing and
 * native-load verification. Electron downloads its binary on first require.
 * @returns Path to the Electron executable the packaged shell runs on.
 */
function resolveElectronExecutable(): string {
  const require = createRequire(join(APP_ROOT, 'package.json'))
  const executable: unknown = require('electron')
  if (typeof executable !== 'string') throw new Error('desktop runtime: the electron executable is unavailable')
  return executable
}

function desktopRelease(): DesktopRelease {  const desktopVersion = manifestVersion(join(APP_ROOT, 'package.json'), 'desktop package')
  const dshVersion = manifestVersion(resolve(APP_ROOT, '..', '..', 'package.json'), 'root dsh package')
  if (!shellVersionExtendsEngine(desktopVersion, dshVersion)) {
    throw new Error(`desktop runtime: Electron ${desktopVersion} must bind @deepseek-ai/dsh ${dshVersion} or a ${dshVersion}.N extension`)
  }
  const runtime = JSON.parse(readFileSync(join(RUNTIME_ROOT, 'versions.json'), 'utf8')) as Record<string, unknown>
  return parseDesktopRelease({
    schemaVersion: 1,
    // 描述符携带内置引擎版本（运行时用它与 @deepseek-ai/dsh / host 包版本比对）；
    // 壳的 .N 构建后缀只体现在 apps/desktop 版本上。
    version: dshVersion,
    hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    nodeVersion: runtime.node,
    pnpmVersion: runtime.pnpm,
  })
}

function runPnpm(args: readonly string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const [command, ...commandArgs] = args
    if (command === undefined) throw new Error('desktop runtime: pnpm command is required')
    const config = join(PNPM_BUILD_STATE, 'config')
    const userConfig = join(config, 'npmrc')
    mkdirSync(config, { recursive: true })
    writeFileSync(userConfig, '')
    const child = spawn(NODE, [
      '--expose-internals',
      PNPM,
      '--config.registry=https://registry.npmjs.org/',
      `--config.store-dir=${storeRootPath()}`,
      '--config.enable-global-virtual-store=false',
      `--config.userconfig=${userConfig}`,
      command,
      ...commandArgs,
    ], {
      cwd: buildRootPath(),
      env: desktopNodeEnvironment(NODE, join(RUNTIME_ROOT, 'bin'), {
        ...Object.fromEntries(Object.entries(process.env).filter(([name]) => (
          name !== 'NODE_OPTIONS' && name !== 'NODE_PATH' && !/^DSH_DESKTOP_/u.test(name) && !/^(?:npm|pnpm|corepack)_/iu.test(name)
        ))),
        NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/',
        NPM_CONFIG_STORE_DIR: storeRootPath(),
        NPM_CONFIG_USERCONFIG: userConfig,
        XDG_CACHE_HOME: join(PNPM_BUILD_STATE, 'cache'),
        XDG_CONFIG_HOME: config,
        XDG_STATE_HOME: join(PNPM_BUILD_STATE, 'state'),
      }),
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`desktop runtime: pnpm exited with ${String(code ?? signal)}`))
    })
  })
}

/**
 * Carry runtime-relevant pnpm patches from the repository workspace into the
 * isolated build root. The build root generates its own pnpm-workspace.yaml,
 * so patchedDependencies declared in the repository root never reach the
 * production install; without this, the packaged runtime ships unpatched
 * sources — notably the libreoffice-kit asar engine probe, whose absence makes
 * every Office preview conversion fail under Electron's asar fs shim.
 *
 * Pnpm rejects patches whose package is not installed (`ERR_PNPM_UNUSED_PATCH`),
 * so only patches whose `name@version` key appears in the already-generated
 * lockfile are carried. Returns whether any patch was applied, so the caller
 * can regenerate the lockfile with patches recorded.
 * @param repoRoot - Repository root holding pnpm-workspace.yaml and patches/.
 * @param buildRoot - Build root whose lockfile and workspace receive the patches.
 * @param lockfile - The patch-less lockfile generated by the first install.
 * @returns whether any runtime patch was copied and declared.
 */
export function applyRuntimePatches(repoRoot: string, buildRoot: string, lockfile: string): boolean {
  const declared = (load(readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8')) as {
    patchedDependencies?: Record<string, string>
  }).patchedDependencies
  if (declared === undefined) return false
  const carried = Object.entries(declared).filter(([key]) => lockfileHasPackage(lockfile, key))
  if (carried.length === 0) return false
  mkdirSync(join(buildRoot, 'patches'), { recursive: true })
  const lines = ['patchedDependencies:']
  for (const [key, file] of carried) {
    copyFileSync(join(repoRoot, file), join(buildRoot, file))
    lines.push(`  ${JSON.stringify(key)}: ${file}`)
  }
  appendFileSync(join(buildRoot, 'pnpm-workspace.yaml'), `${lines.join('\n')}\n`)
  return true
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Whether a `name@version` package key has a resolution entry in the lockfile.
 * Matches the `packages`/`snapshots` entries pnpm writes at indent 2, tolerating
 * peer or patch-hash suffixes and optional quoting of scoped names.
 * @param lockfile - Generated pnpm-lock.yaml content.
 * @param key - Package key in `name@version` form.
 * @returns whether the package is installed in that lockfile.
 */
export function lockfileHasPackage(lockfile: string, key: string): boolean {
  return new RegExp(`^  ['"]?${escapeRegExp(key)}(?:\\([^\\r\\n]*\\))?['"]?:`, 'mu').test(lockfile)
}

async function main(): Promise<void> {
  rmSync(DSH_OUTPUT_ROOT, { recursive: true, force: true })
  rmSync(PNPM_BUILD_STATE, { recursive: true, force: true })
  mkdirSync(storeRootPath(), { recursive: true })
  try {
    const release = desktopRelease()
    copyFileSync(join(PACKAGE_SET_ROOT, DESKTOP_PACKAGE_SET_FILE), join(buildRootPath(), DESKTOP_PACKAGE_SET_FILE))
    cpSync(join(PACKAGE_SET_ROOT, DESKTOP_PACKAGES_DIR), join(buildRootPath(), DESKTOP_PACKAGES_DIR), { recursive: true })
    createRuntimeProjectMetadata(buildRootPath(), release)
    await runPnpm(['install', '--lockfile-only'])
    if (applyRuntimePatches(REPO_ROOT, buildRootPath(), readFileSync(join(buildRootPath(), 'pnpm-lock.yaml'), 'utf8'))) {
      await runPnpm(['install', '--lockfile-only'])
    }
    verifyDesktopCoreLockfile(
      readFileSync(join(buildRootPath(), 'pnpm-lock.yaml'), 'utf8'),
      readDesktopCorePackageSet(buildRootPath(), release.version),
    )
    await runPnpm(['install', '--prod', '--frozen-lockfile', '--trust-lockfile'])
    const packageSet = readDesktopCorePackageSet(buildRootPath(), release.version)
    const targetName = resolveDesktopBuildTarget()
    const target = { platform: process.platform, arch: targetName.endsWith('arm64') ? 'arm64' : 'x64' }
    const modules = join(buildRootPath(), 'node_modules')
    const officeManifest = JSON.parse(readFileSync(join(modules, '@deepseek-ai', 'libreoffice-kit', 'package.json'), 'utf8')) as {
      optionalDependencies?: Record<string, string>
    }
    const officeEngine = selectOfficeEngine(officeManifest, target)
    mkdirSync(DSH_OUTPUT_ROOT, { recursive: true })
    cpSync(modules, join(DSH_OUTPUT_ROOT, 'node_modules'), {
      recursive: true, dereference: true,
      filter: source => desktopRuntimeFileExclusion(relative(modules, source), target, officeEngine) === undefined,
    })
    // Office 技能资产必须作为 runtime 资源随包携带：desktop-host 的 office 插件在启动时
    // 读取 runtime/office-skills，缺失会让 Host 启动失败（packages/skill/skill-office 的
    // 资产校验）。与上游 primary-runtime 准备流程中的 prepareOfficeSkillAssets 一致。
    const hostRequire = createRequire(resolve(APP_ROOT, '..', 'desktop-host', 'package.json'))
    cpSync(join(dirname(hostRequire.resolve('@deepseek-ai/dsh-skill-office/package.json')), 'assets'),
      join(RUNTIME_ROOT, 'office-skills'), { recursive: true, dereference: true })
    if (!existsSync(join(DSH_OUTPUT_ROOT, 'node_modules', '@deepseek-ai', `libreoffice-kit-${officeEngine}`, 'prebuilds.json'))) {
      throw new Error(`desktop runtime: missing required LibreOffice engine ${officeEngine}`)
    }
    // 打包的 Electron 构建可能在同一 Electron 大版本内带入 Node.js/V8 补丁更新，而内置的
    // node-addon-require-builtin 按 (Node 三元组, V8 字符串) 精确匹配 Electron profile 表，
    // 不改写就会在启动时拒绝加载（host preparation failed）。改写后必须在实际的 Electron
    // 二进制下实测加载，作为打包验收门槛。
    const electronExecutable = resolveElectronExecutable()
    const fingerprint = readElectronRuntimeFingerprint(electronExecutable)
    for (const binary of patchNativeElectronFingerprint(DSH_OUTPUT_ROOT, fingerprint)) {
      console.log(`desktop runtime: rewrote the Electron fingerprint profile in ${relative(APP_ROOT, binary)}`)
    }
    verifyNativeElectronFingerprint(DSH_OUTPUT_ROOT, electronExecutable)
    writeFileSync(join(DSH_OUTPUT_ROOT, 'package.json'), `${JSON.stringify({
      name: '@deepseek-ai/dsh-desktop-runtime', private: true, version: release.version, type: 'module',
      dependencies: Object.fromEntries(packageSet.packages.map(entry => [entry.name, entry.version])),
    }, undefined, 2)}\n`)
    for (const file of DESKTOP_HOST_RUNTIME_FILES) {
      if (!existsSync(join(DSH_OUTPUT_ROOT, 'node_modules', DESKTOP_HOST_PACKAGE, file))) {
        throw new Error(`desktop runtime: missing private Host file ${file}`)
      }
    }
    writeDesktopRuntime(DSH_OUTPUT_ROOT, release, packageSet.packages.map(entry => entry.name), target)
    const descriptor = await verifyDesktopRuntime(DSH_OUTPUT_ROOT, release.version, target)
    await new Promise<void>((accept, reject) => {
      execFile(NODE, ['--expose-internals', join(APP_ROOT, 'tests/fixtures/runtime-payload-smoke.mjs'), DSH_OUTPUT_ROOT],
        { timeout: 120_000, env: desktopNodeEnvironment(NODE, join(RUNTIME_ROOT, 'bin'), { ...process.env, NODE_OPTIONS: '' }) },
        (error, stdout, stderr) => {
          if (error !== null) reject(new Error(`desktop native payload smoke failed: ${stderr}`, { cause: error }))
          else { process.stdout.write(stdout); accept() }
        })
    })
    await smokeDesktopRuntime(DSH_OUTPUT_ROOT, NODE, descriptor, { ...process.env, NODE_OPTIONS: '' }, RUNTIME_ROOT)
    await verifyDesktopRuntime(DSH_OUTPUT_ROOT, release.version, target)
  } catch (error) {
    rmSync(DSH_OUTPUT_ROOT, { recursive: true, force: true })
    throw error
  } finally {
    rmSync(buildRootPath(), { recursive: true, force: true })
    rmSync(PNPM_BUILD_STATE, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  await main()
}
