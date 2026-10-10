/** Prepare the target Electron distribution, pinned pnpm CLI and primary runtime. */

import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { downloadArtifact } from '@electron/get'
import extractZip from 'extract-zip'
import { preparePrimaryRuntime, smokePrimaryRuntime } from '../../../scripts/primary-runtime/prepare.ts'
import { readPrimaryRuntime } from '../../../packages/skill/tool-workspace-dependencies/src/index.ts'
import { prepareDesktopCli } from './prepare-cli.ts'
import { resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'

const BUILD_PATHS = resolveDesktopTargetBuildPaths()
const RUNTIME_ROOT = BUILD_PATHS.runtime

async function main(): Promise<void> {
  const target = resolveDesktopBuildTarget()
  if (target !== 'linux-x64') throw new Error(`desktop runtime: unsupported target ${target}`)
  const platform = 'linux'
  const require = createRequire(import.meta.url)
  const { version } = require('electron/package.json') as { version: string }
  const archive = await downloadArtifact({ version, platform, arch: 'x64', artifactName: 'electron', cacheRoot: BUILD_PATHS.downloads })
  rmSync(BUILD_PATHS.electron, { recursive: true, force: true })
  await extractZip(archive, { dir: BUILD_PATHS.electron })
  const executable = join(BUILD_PATHS.electron, 'electron')
  const nodeVersion = execFileSync(executable, ['-p', 'process.versions.node'], {
    encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  }).trim()
  rmSync(RUNTIME_ROOT, { recursive: true, force: true })
  mkdirSync(RUNTIME_ROOT, { recursive: true })
  const desktopVersion = (JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { version: string }).version
  await preparePrimaryRuntime({ target, output: RUNTIME_ROOT, cache: BUILD_PATHS.downloads, version: desktopVersion })
  smokePrimaryRuntime(join(RUNTIME_ROOT, 'primary-runtime'))
  const { pnpm } = await readPrimaryRuntime(join(RUNTIME_ROOT, 'primary-runtime'))
  if (pnpm === undefined) throw new Error('desktop runtime: primary-runtime manifest has no pnpm version')
  cpSync(join(import.meta.dirname, 'node-bin'), join(RUNTIME_ROOT, 'bin'), { recursive: true })
  chmodSync(join(RUNTIME_ROOT, 'bin', 'node'), 0o755)
  writeFileSync(join(RUNTIME_ROOT, 'versions.json'), `${JSON.stringify({
    schemaVersion: 1,
    node: nodeVersion,
    pnpm,
  }, undefined, 2)}\n`)
  prepareDesktopCli(join(RUNTIME_ROOT, 'cli'), platform)
  cpSync(join(import.meta.dirname, '..', 'lib', 'command-manager-entry.js'), join(RUNTIME_ROOT, 'cli', 'command-manager.js'))
}

await main()
