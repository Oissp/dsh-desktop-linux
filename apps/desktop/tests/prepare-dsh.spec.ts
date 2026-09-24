import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

type PrepareDsh = typeof import('../scripts/prepare-dsh.ts')

let applyRuntimePatches: PrepareDsh['applyRuntimePatches']
let lockfileHasPackage: PrepareDsh['lockfileHasPackage']

// The script resolves the linux-x64 build target at module scope, so pin the
// packaging environment before importing it as a library.
beforeAll(async () => {
  vi.stubEnv('DSH_DESKTOP_TARGET_PLATFORM', 'linux')
  vi.stubEnv('DSH_DESKTOP_TARGET_ARCH', 'x64')
  vi.resetModules()
  const module = await import('../scripts/prepare-dsh.ts')
  applyRuntimePatches = module.applyRuntimePatches
  lockfileHasPackage = module.lockfileHasPackage
})

const LOCKFILE = [
  'lockfileVersion: \'9.0\'',
  '',
  'importers:',
  '  .:',
  '    dependencies:',
  '      \'@deepseek-ai/dsh\':',
  '        specifier: 0.1.7-rc.1',
  '',
  'packages:',
  '',
  '  \'@deepseek-ai/libreoffice-kit@0.1.0\':',
  '    resolution: {integrity: sha512-} }',
  '',
  '  node-pty@1.2.0-beta.15:',
  '    resolution: {integrity: sha512-} }',
  '',
  'snapshots:',
  '',
  '  \'@deepseek-ai/libreoffice-kit@0.1.0(patch_hash=df0523db)\':',
  '',
  '  node-pty@1.2.0-beta.15(node):',
  '',
].join('\n')

const REPO_WORKSPACE = [
  'packages:',
  '  - .',
  '',
  'patchedDependencies:',
  '  \'@deepseek-ai/libreoffice-kit@0.1.0\': patches/@deepseek-ai__libreoffice-kit@0.1.0.patch',
  '  \'@electron/osx-sign@1.3.3\': patches/@electron__osx-sign@1.3.3.patch',
  '  \'@yao-pkg/pkg@6.21.0\': patches/@yao-pkg__pkg@6.21.0.patch',
  '  node-pty@1.2.0-beta.15: patches/node-pty@1.2.0-beta.15.patch',
  '',
].join('\n')

/** Materialize a repository root with a workspace file and its patch sources. */
function repoRoot(workspace: string, patches: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-prepare-dsh-repo-'))
  writeFileSync(join(root, 'pnpm-workspace.yaml'), workspace)
  mkdirSync(join(root, 'patches'), { recursive: true })
  for (const [file, body] of Object.entries(patches)) writeFileSync(join(root, file), body)
  return root
}

/** Materialize a build root holding the generated workspace file. */
function buildRoot(workspace: string): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-prepare-dsh-build-'))
  writeFileSync(join(root, 'pnpm-workspace.yaml'), workspace)
  return root
}

describe('desktop runtime patch carrying', () => {
  it('matches installed packages regardless of scope quoting, peer suffixes, or patch hashes', () => {
    expect(lockfileHasPackage(LOCKFILE, '@deepseek-ai/libreoffice-kit@0.1.0')).toBe(true)
    expect(lockfileHasPackage(LOCKFILE, 'node-pty@1.2.0-beta.15')).toBe(true)
  })

  it('does not match a package absent from the lockfile', () => {
    expect(lockfileHasPackage(LOCKFILE, '@electron/osx-sign@1.3.3')).toBe(false)
    expect(lockfileHasPackage(LOCKFILE, '@yao-pkg/pkg@6.21.0')).toBe(false)
    expect(lockfileHasPackage(LOCKFILE, '@deepseek-ai/libreoffice-kit@0.1.1')).toBe(false)
  })

  it('carries only installed patches and declares them in the build workspace', () => {
    const repo = repoRoot(REPO_WORKSPACE, {
      'patches/@deepseek-ai__libreoffice-kit@0.1.0.patch': 'libreoffice patch\n',
      'patches/node-pty@1.2.0-beta.15.patch': 'node-pty patch\n',
      'patches/@electron__osx-sign@1.3.3.patch': 'osx-sign patch\n',
      'patches/@yao-pkg__pkg@6.21.0.patch': 'pkg patch\n',
    })
    const build = buildRoot('packages:\n  - .\n')
    try {
      expect(applyRuntimePatches(repo, build, LOCKFILE)).toBe(true)
      const workspace = readFileSync(join(build, 'pnpm-workspace.yaml'), 'utf8')
      expect(workspace).toContain('patchedDependencies:')
      expect(workspace).toContain('"@deepseek-ai/libreoffice-kit@0.1.0": patches/@deepseek-ai__libreoffice-kit@0.1.0.patch')
      expect(workspace).toContain('"node-pty@1.2.0-beta.15": patches/node-pty@1.2.0-beta.15.patch')
      expect(workspace).not.toContain('@electron/osx-sign')
      expect(workspace).not.toContain('@yao-pkg/pkg')
      expect(readFileSync(join(build, 'patches', '@deepseek-ai__libreoffice-kit@0.1.0.patch'), 'utf8')).toBe('libreoffice patch\n')
      expect(readFileSync(join(build, 'patches', 'node-pty@1.2.0-beta.15.patch'), 'utf8')).toBe('node-pty patch\n')
      expect(() => readFileSync(join(build, 'patches', '@electron__osx-sign@1.3.3.patch'), 'utf8')).toThrow()
    } finally {
      rmSync(repo, { recursive: true, force: true })
      rmSync(build, { recursive: true, force: true })
    }
  })

  it('leaves the build workspace untouched when the repository declares no patches', () => {
    const repo = repoRoot('packages:\n  - .\n', {})
    const build = buildRoot('packages:\n  - .\n')
    try {
      expect(applyRuntimePatches(repo, build, LOCKFILE)).toBe(false)
      expect(readFileSync(join(build, 'pnpm-workspace.yaml'), 'utf8')).toBe('packages:\n  - .\n')
    } finally {
      rmSync(repo, { recursive: true, force: true })
      rmSync(build, { recursive: true, force: true })
    }
  })
})
