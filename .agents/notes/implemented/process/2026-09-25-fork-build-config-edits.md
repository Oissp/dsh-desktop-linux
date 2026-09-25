# Agent Note: Fork edits to upstream-owned build and dependency configuration

Status: implemented

English | [中文](2026-09-25-fork-build-config-edits.zh.md)

## Problem

The 0.1.7-rc.2 merge moved the workspace to `tsdown@0.22.2` and `rolldown@1.1.1`. The `package-deb.yml` run that followed the merge then reported three warnings from files the fork owns a copy of:

- `` `noExternal` is deprecated. Use `deps.alwaysBundle` instead.`` — two tsdown configs.
- `` `inlineDynamicImports` option is deprecated, please use `codeSplitting: false` instead.`` — three.
- `(!) Some chunks are larger than 500 kB after minification` from the web client build: `vendor` at 740.58 kB, the lazy `langs/cpp` grammar at 637.59 kB, `index` at 629.23 kB.

The Dependabot run on the same commit failed with `security_update_not_possible` for `@vitest/mocker` and postcss. No manifest declares postcss, so it could only move as a transitive resolution; the four manifests that declare `vitest` said `^4.1.8`, and `vitest@4.1.8` requires `@vitest/mocker@4.1.8` exactly, so the patched `@vitest/mocker` was unreachable until vitest moved first.

## Decision

**The four tsdown configs use the current option names.** `packages/experimental/webworker-runtime/tsdown.config.ts` and `packages/ptc-runtime/ptc-runtime-node/tsdown.config.ts` replace `noExternal` with `deps.alwaysBundle`; `webworker-runtime`, `packages/experimental/inspector/tsdown.config.ts`, and `packages/experimental/browser-use-stagehand-native/tsdown.config.ts` replace `outputOptions.inlineDynamicImports: true` with `outputOptions.codeSplitting: false`. Each pair is the same option under its current name, which the identical-build check under Testing confirms.

**The web client build declares its chunk budget.** `apps/web/vite.config.ts` sets `chunkSizeWarningLimit: 800`. The 500 kB default predates this chunk plan: `vendor` deliberately carries the whole heavy render family — KaTeX, Shiki with its three boot grammars, the micromark pipeline — as one cache entry that changes only on dependency bumps, and the largest lazy `@shikijs/langs` grammar is a single generated file. Both exceed 500 kB by construction, and splitting them further would undo the cache locality the `VENDOR_PACKAGES` comment records. The ceiling sits just above the largest shipped chunk, so real growth still trips it.

**The vitest family moves to `^4.1.11`.** `vitest` and `@vitest/coverage-v8` are bumped in the four manifests that declare them — the root `package.json`, `apps/web`, `packages/test-support/client-runtime`, and `packages/test-support/session-snapshot` — and `@vitest/spy` in `packages/test-support/remote-mock`, the one manifest that declares it directly. `pnpm update postcss --recursive` floats postcss to 8.5.28 and drops the duplicate.

## Alternatives considered

**Leave the deprecation warnings.** Rejected: they name options tsdown has already replaced, so the next major removes them and the four configs stop building. The rename is mechanical and provably behavior-preserving.

**Split `vendor` until every chunk fits under 500 kB.** Rejected: the split that gets the render family under 500 kB is arbitrary, and it breaks the cache locality the chunk plan exists for — a dependency bump would re-hash more than one chunk and returning clients would refetch the render family.

**Pin `@vitest/mocker` with a pnpm override instead of moving vitest.** Rejected: it holds vitest at 4.1.8 while forcing one of its exact dependencies to a version it did not declare, which is the mismatch the override would hide rather than fix.

**Bump only the manifests the Dependabot alert names.** Rejected: `pnpm update vitest` re-resolves vitest and its dependencies but not `@vitest/spy`, which `packages/test-support/remote-mock` declares directly, so the workspace keeps two `@vitest/spy` copies — 4.1.8 for the test-support package and 4.1.11 for vitest. Leaving `^4.1.8` in any `vitest` manifest keeps a second vitest resolution alive the same way.

## Consequences

Each of these files now differs from upstream's copy. An upstream commit that renames the same tsdown options makes the fork's edit a no-op and merges clean; an upstream refactor of those configs, of the `apps/web` chunk plan, or of the four `vitest` ranges conflicts, and the resolution is to keep the fork's value unless upstream has moved to the same one.

The lockfile refresh floated several transitive packages beyond the two security targets — `qs`, `minimatch`, `lightningcss`, `js-yaml`, `fs-extra`, `brace-expansion`, `ws`, `picomatch`, `nanoid` — all within their declared ranges and all accepted by the `minimumReleaseAge` supply-chain policy.

## Testing

The four tsdown renames were checked by building each package before and after the change and comparing the SHA-256 of every emitted file: identical for all 1013 files across the four packages. `pnpm --filter @deepseek-ai/dsh-web-frontend run build` emits the same three chunk hashes as before the budget was declared and no longer warns.

`pnpm run build` and `pnpm run hygiene` (18 gates) pass, `pnpm run lint` is clean, and `pnpm run test:docs` passes all 20 documentation gates. `pnpm exec vitest run apps/desktop/tests` — the `package-deb` gate — passes 724 tests across 65 files, and the three packages touched by the bump pass 173 tests across 24 files.

After the version change, the incremental `tsc -b` inside `pnpm run build` reported TS2883 in two client fixtures, `packages/client/ui-sidebar-browser/tests/electron-harness.client.ts` and `packages/experimental/client-ui-voice-input/tests/audio-fixture.client.ts`, naming `Procedure` from the `@vitest/spy` resolution. Neither file is touched by this change, and `tsc -b tsconfig.client.json --force` on the same tree reports no error; a full `pnpm run build` passes once the forced rebuild has refreshed the project state. Treat a dependency version change as needing a forced rebuild before the incremental client typecheck is evidence.
