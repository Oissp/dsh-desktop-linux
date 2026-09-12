import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDesktopUploadPlan } from '../scripts/desktop-upload-plan.ts'
import { desktopUpdateMetadataFilename } from '../scripts/desktop-auto-update-environment.mjs'
import type { DesktopPackageTargetName } from '../scripts/package-target.ts'

const temporaryDirectories: string[] = []
const TEST_ORIGIN = 'https://desktop-updates.example.com'
const TEST_BUCKET = 'test-download-bucket'
const PRODUCTION_BUCKET = 'production-download-bucket'

interface Fixture {
  readonly repositoryRoot: string
  readonly appRoot: string
  readonly artifactsRoot: string
  readonly environment: NodeJS.ProcessEnv
}

function digest(contents: string): string {
  return createHash('sha512').update(contents).digest('base64')
}

async function fixture(
  version = '1.2.3',
  environment: 'test' | 'production' = 'test',
  desktopVersion = version,
): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-upload-'))
  temporaryDirectories.push(root)
  const repositoryRoot = join(root, 'repository')
  const appRoot = join(repositoryRoot, 'apps', 'desktop')
  const artifactsRoot = join(appRoot, '.desktop-build', 'artifacts')
  await mkdir(artifactsRoot, { recursive: true })
  await writeFile(join(repositoryRoot, 'package.json'), `${JSON.stringify({ version })}\n`)
  await writeFile(join(appRoot, 'package.json'), `${JSON.stringify({ version: desktopVersion })}\n`)

  const target: DesktopPackageTargetName = 'linux-x64'
  const base = `deepseek-harness-${desktopVersion}-linux-x64`
  const origin = environment === 'test'
    ? TEST_ORIGIN
    : 'https://download.deepseek.com'
  await writeFile(join(artifactsRoot, `${target}-release.json`), `${JSON.stringify({
    schemaVersion: 1,
    target,
    version,
    environment,
    publicUrl: `${origin}/_/harness/desktop/stable/${target}/`,
  })}\n`)

  const appImage = 'Linux AppImage fixture'
  const blockmap = 'AppImage blockmap fixture'
  await writeFile(join(artifactsRoot, `${base}.AppImage`), appImage)
  await writeFile(join(artifactsRoot, `${base}.AppImage.blockmap`), blockmap)
  await writeFile(join(artifactsRoot, `${base}.deb`), 'Debian package fixture')
  await writeFile(join(artifactsRoot, desktopUpdateMetadataFilename(desktopVersion, 'linux')), `${JSON.stringify({
    version: desktopVersion,
    files: [{
      url: `${base}.AppImage`,
      size: Buffer.byteLength(appImage),
      sha512: digest(appImage),
      blockMapSize: Buffer.byteLength(blockmap),
    }],
  })}\n`)
  return {
    repositoryRoot,
    appRoot,
    artifactsRoot,
    environment: environment === 'test'
      ? {
        DSH_DESKTOP_AUTO_UPDATE_ENV: 'test',
        DOWNLOAD_TEST_ORIGIN: TEST_ORIGIN,
        DOWNLOAD_TEST_COS_BUCKET: TEST_BUCKET,
      }
      : {
        DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
        DOWNLOAD_PROD_COS_BUCKET: PRODUCTION_BUCKET,
      },
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async path => rm(path, {
    recursive: true,
    force: true,
  })))
})

describe('desktop upload plan', () => {
  it('validates Linux artifacts and puts channel metadata last', async () => {
    const paths = await fixture()
    const plan = await createDesktopUploadPlan('linux-x64', paths)
    expect(plan).toMatchObject({
      environment: 'test',
      version: '1.2.3',
      publicUrl: 'https://desktop-updates.example.com/_/harness/desktop/stable/linux-x64/',
      bucket: TEST_BUCKET,
    })
    expect(plan.artifacts.map(artifact => artifact.filename)).toEqual([
      'deepseek-harness-1.2.3-linux-x64.AppImage',
      'deepseek-harness-1.2.3-linux-x64.deb',
      'deepseek-harness-1.2.3-linux-x64.AppImage.blockmap',
      'latest-linux.yml',
    ])
    expect(plan.artifacts.at(-1)).toMatchObject({
      channelMetadata: true,
      cacheControl: 'no-cache',
    })
  })

  it('uploads the prerelease channel metadata emitted by electron-builder', async () => {
    const paths = await fixture('1.2.3-alpha.4')
    const plan = await createDesktopUploadPlan('linux-x64', paths)
    expect(plan.artifacts.map(artifact => artifact.filename)).toEqual([
      'deepseek-harness-1.2.3-alpha.4-linux-x64.AppImage',
      'deepseek-harness-1.2.3-alpha.4-linux-x64.deb',
      'deepseek-harness-1.2.3-alpha.4-linux-x64.AppImage.blockmap',
      'alpha-linux.yml',
    ])
  })

  it('validates the Linux AppImage updater with its embedded blockmap and deb installer and production destination', async () => {
    const paths = await fixture('2.0.0', 'production')
    const plan = await createDesktopUploadPlan('linux-x64', paths)
    expect(plan.artifacts.map(artifact => artifact.filename)).toEqual([
      'deepseek-harness-2.0.0-linux-x64.AppImage',
      'deepseek-harness-2.0.0-linux-x64.deb',
      'deepseek-harness-2.0.0-linux-x64.AppImage.blockmap',
      'latest-linux.yml',
    ])
    expect(plan).toMatchObject({
      publicUrl: 'https://download.deepseek.com/_/harness/desktop/stable/linux-x64/',
      bucket: PRODUCTION_BUCKET,
    })
  })

  it('accepts a shell version that extends the engine version and names artifacts with it', async () => {
    const paths = await fixture('1.2.3-alpha.4', 'test', '1.2.3-alpha.4.1')
    const plan = await createDesktopUploadPlan('linux-x64', paths)
    expect(plan.version).toBe('1.2.3-alpha.4.1')
    expect(plan.artifacts.map(artifact => artifact.filename)).toEqual([
      'deepseek-harness-1.2.3-alpha.4.1-linux-x64.AppImage',
      'deepseek-harness-1.2.3-alpha.4.1-linux-x64.deb',
      'deepseek-harness-1.2.3-alpha.4.1-linux-x64.AppImage.blockmap',
      'alpha-linux.yml',
    ])
  })

  it('rejects a desktop version that does not extend the engine version', async () => {
    const paths = await fixture('1.2.3', 'test', '2.0.0')
    await expect(createDesktopUploadPlan('linux-x64', paths)).rejects.toThrow(/does not extend/u)
  })

  it('rejects a blockmap whose size does not match the update metadata', async () => {
    const paths = await fixture()
    await writeFile(join(paths.artifactsRoot, 'deepseek-harness-1.2.3-linux-x64.AppImage.blockmap'), 'stale')
    await expect(createDesktopUploadPlan('linux-x64', paths)).rejects.toThrow(/blockmap size.*metadata/u)
  })

  it('rejects Linux metadata without an embedded blockmap size', async () => {
    const paths = await fixture()
    const appImage = 'Linux AppImage fixture'
    await writeFile(join(paths.artifactsRoot, 'latest-linux.yml'), `${JSON.stringify({
      version: '1.2.3',
      files: [{
        url: 'deepseek-harness-1.2.3-linux-x64.AppImage',
        size: Buffer.byteLength(appImage),
        sha512: digest(appImage),
      }],
    })}\n`)
    await expect(createDesktopUploadPlan('linux-x64', paths)).rejects.toThrow(/blockMapSize/u)
  })

  it('rejects a completed build from another dsh version or deployment', async () => {
    const paths = await fixture()
    await writeFile(join(paths.repositoryRoot, 'package.json'), '{"version":"1.2.4"}\n')
    await writeFile(join(paths.appRoot, 'package.json'), '{"version":"1.2.4"}\n')
    await expect(createDesktopUploadPlan('linux-x64', paths)).rejects.toThrow(/completion record.*1\.2\.4/u)

    const productionPaths = await fixture('1.2.3', 'production')
    await expect(createDesktopUploadPlan('linux-x64', {
      ...productionPaths,
      environment: {
        DSH_DESKTOP_AUTO_UPDATE_ENV: 'test',
        DOWNLOAD_TEST_ORIGIN: TEST_ORIGIN,
        DOWNLOAD_TEST_COS_BUCKET: TEST_BUCKET,
      },
    })).rejects.toThrow(/completion record.*test/u)
  })

  it('rejects stale architecture metadata and modified updater bytes', async () => {
    const paths = await fixture()
    const metadataPath = join(paths.artifactsRoot, 'latest-linux.yml')
    const appImagePath = join(paths.artifactsRoot, 'deepseek-harness-1.2.3-linux-x64.AppImage')
    await writeFile(appImagePath, 'modified')
    await expect(createDesktopUploadPlan('linux-x64', paths)).rejects.toThrow(/size.*metadata/u)

    const otherArch = 'wrong architecture'
    await writeFile(metadataPath, `${JSON.stringify({
      version: '1.2.3',
      files: [{
        url: 'deepseek-harness-1.2.3-linux-arm64.AppImage',
        size: Buffer.byteLength(otherArch),
        sha512: digest(otherArch),
        blockMapSize: 128,
      }],
    })}\n`)
    await expect(createDesktopUploadPlan('linux-x64', paths)).rejects.toThrow(/linux-x64\.AppImage/u)
  })
})
