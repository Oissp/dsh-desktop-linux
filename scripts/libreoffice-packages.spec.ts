import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { officeAsarUnpackPatterns, officePackageDirectories } from './libreoffice-packages.mjs'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-office-closure-'))
  temporaryDirectories.push(root)
  const staging = join(root, 'staging')
  async function packageAt(name: string, fields: Record<string, unknown> = {}) {
    const directory = join(staging, 'node_modules', name)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...fields }))
    return directory
  }
  return { root, staging, packageAt }
}

it('returns the kit body, its runtime dependency, and the selected engine', async () => {
  const { staging, packageAt } = await fixture()
  const kit = await packageAt('@deepseek-ai/libreoffice-kit', {
    optionalDependencies: { '@deepseek-ai/libreoffice-kit-wasm': '0.1.0' },
    dependencies: { decoder: '1' },
  })
  const engine = await packageAt('@deepseek-ai/libreoffice-kit-wasm')
  const decoder = await packageAt('decoder')

  // linux/x64 selects the WASM engine; the closure is sorted by absolute path, so the
  // kit body (a path prefix of the engine) precedes the engine, which precedes `decoder`.
  const directories = await officePackageDirectories(staging, { platform: 'linux', arch: 'x64' })

  expect(directories.map(directory => directory.replaceAll('\\', '/')))
    .toStrictEqual([kit, engine, decoder].map(directory => directory.replaceAll('\\', '/')))
})

it('omits optional dependencies that do not support the target platform', async () => {
  const { staging, packageAt } = await fixture()
  await packageAt('@deepseek-ai/libreoffice-kit', {
    optionalDependencies: {
      '@deepseek-ai/libreoffice-kit-wasm': '0.1.0',
      'dsh-foreign-office-fixture': '1',
    },
  })
  await packageAt('@deepseek-ai/libreoffice-kit-wasm')
  await packageAt('dsh-foreign-office-fixture', { os: ['darwin'], cpu: ['arm64'] })

  const directories = await officePackageDirectories(staging, { platform: 'linux', arch: 'x64' })

  expect(directories).toHaveLength(2)
  expect(directories.some(directory => directory.includes('dsh-foreign-office-fixture'))).toBe(false)
})

it('rejects a missing required dependency before resolving the engine', async () => {
  const { staging, packageAt } = await fixture()
  await packageAt('@deepseek-ai/libreoffice-kit', { dependencies: { 'dsh-missing-office-fixture': '1' } })

  await expect(officePackageDirectories(staging, { platform: 'linux', arch: 'x64' }))
    .rejects.toThrow('dsh-missing-office-fixture required by @deepseek-ai/libreoffice-kit is missing')
})

it('rejects a selected engine that is absent from the staging tree', async () => {
  const { staging, packageAt } = await fixture()
  await packageAt('@deepseek-ai/libreoffice-kit', {
    optionalDependencies: { '@deepseek-ai/libreoffice-kit-wasm': '0.1.0' },
  })

  await expect(officePackageDirectories(staging, { platform: 'linux', arch: 'x64' }))
    .rejects.toThrow('Office engine @deepseek-ai/libreoffice-kit-wasm required for linux/x64 is missing')
})

it('unpacks the kit body and its closure with forward-slash asar patterns', async () => {
  const { staging, packageAt } = await fixture()
  await packageAt('@deepseek-ai/libreoffice-kit', {
    optionalDependencies: { '@deepseek-ai/libreoffice-kit-wasm': '0.1.0' },
    dependencies: { decoder: '1' },
  })
  await packageAt('decoder')
  await packageAt('@deepseek-ai/libreoffice-kit-wasm')

  const patterns = await officeAsarUnpackPatterns(staging, { platform: 'linux', arch: 'x64' })

  // The static `asarUnpack` in electron-builder.config.mjs only matches engine packages
  // (`libreoffice-kit-*`); the kit body must be unpacked too, or the skill-office CLI path
  // skill-office stats at load does not exist and Host startup fails (0.1.7-rc.1 regression).
  expect(patterns).toEqual(expect.arrayContaining([
    '**/node_modules/@deepseek-ai/libreoffice-kit/**/*',
    '**/node_modules/@deepseek-ai/libreoffice-kit-wasm/**/*',
    '**/node_modules/decoder/**/*',
  ]))
  expect(patterns.every(pattern => !pattern.includes('\\'))).toBe(true)
})
