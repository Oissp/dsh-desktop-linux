import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, type TestContext } from 'vitest'
import { classifyForkBaseline, isGeneratedForkPath, parseForkBaseline, verifyForkBaseline } from './verify-sync-forked-paths.ts'

const baselinePath = '.github/sync-forked-paths.txt'

function repository(test: TestContext): { root: string; write(file: string, source: string): void; commit(message: string): void } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-fork-baseline-'))
  test.onTestFinished(() => { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) })
  const git = (args: string[]): void => {
    execFileSync('git', args, {
      cwd: root,
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: join(root, 'global.gitconfig'),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 'Fork baseline test',
        GIT_AUTHOR_EMAIL: 'fork-baseline@example.invalid',
        GIT_COMMITTER_NAME: 'Fork baseline test',
        GIT_COMMITTER_EMAIL: 'fork-baseline@example.invalid',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
  }
  const write = (file: string, source: string): void => {
    const path = join(root, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, source)
  }
  const commit = (message: string): void => {
    git(['add', '.'])
    git(['commit', '--quiet', '-m', message])
  }
  git(['init', '--quiet'])
  git(['config', 'user.name', 'Fork baseline test'])
  git(['config', 'user.email', 'fork-baseline@example.invalid'])
  return { root, write, commit }
}

describe('fork sync baseline parsing', () => {
  it('drops blank lines and comments while preserving inline explanations', () => {
    expect(parseForkBaseline(`
# header
apps/desktop/src/main.ts # fork-owned behavior

packages/core/session/src/index.ts
`)).toEqual(['apps/desktop/src/main.ts', 'packages/core/session/src/index.ts'])
  })

  it('treats a missing final newline as one complete entry', () => {
    expect(parseForkBaseline('README.md')).toEqual(['README.md'])
  })
})

describe('fork sync baseline classification', () => {
  it('reports modified behavior files that lack an entry', () => {
    expect(classifyForkBaseline(
      ['apps/desktop/src/main.ts', 'apps/desktop/scripts/prepare-dsh.ts'],
      ['apps/desktop/src/main.ts'],
    )).toEqual({
      missing: ['apps/desktop/scripts/prepare-dsh.ts'],
      stale: [],
    })
  })

  it('reports baseline entries that no longer differ from the merge base', () => {
    expect(classifyForkBaseline(
      ['apps/desktop/src/main.ts'],
      ['apps/desktop/src/main.ts', 'README.md'],
    )).toEqual({ missing: [], stale: ['README.md'] })
  })

  it.each([
    'pnpm-lock.yaml',
    'scripts/no-unknown-casts.baseline.json',
    'apps/desktop/README.i18n.yaml',
    '.agents/notes/implemented/architecture/example.md',
    'apps/desktop/tests/signing-concurrency/README.zh.md',
    'apps/desktop/tests/preload-mandatory-overlay.spec.ts',
  ])('excludes generated or documentation-only path %s', (file) => {
    expect(isGeneratedForkPath(file)).toBe(true)
  })

  it.each([
    'apps/desktop/src/main.ts',
    'apps/desktop/scripts/prepare-dsh.ts',
    'apps/desktop/README.md',
    'apps/desktop/tests/package-target.spec.ts',
    'scripts/verify-sync-forked-paths.ts',
  ])('keeps behavior or build path %s in the check', (file) => {
    expect(isGeneratedForkPath(file)).toBe(false)
  })
})


describe('fork sync baseline gate', () => {
  it('reports a modified file without an entry and a baseline entry that no longer differs', (test) => {
    const repo = repository(test)
    repo.write('tracked.ts', 'base\n')
    repo.commit('base')
    repo.write('tracked.ts', 'fork\n')
    repo.commit('fork')
    repo.write(baselinePath, 'README.md\n')
    expect(verifyForkBaseline(repo.root, 'HEAD~1')).toMatchObject({
      missing: ['tracked.ts'],
      stale: ['README.md'],
    })
  })

  it('fails closed on an empty baseline', (test) => {
    const repo = repository(test)
    repo.write('tracked.ts', 'base\n')
    repo.commit('base')
    repo.write('tracked.ts', 'fork\n')
    repo.commit('fork')
    repo.write(baselinePath, '')
    expect(() => verifyForkBaseline(repo.root, 'HEAD~1')).toThrow(/empty/u)
  })
})
