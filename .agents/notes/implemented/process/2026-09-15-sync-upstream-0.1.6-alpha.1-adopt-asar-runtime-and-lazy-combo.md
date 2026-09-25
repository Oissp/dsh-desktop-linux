# Agent Note: Sync upstream 0.1.6-alpha.1 — adopt asar runtime and lazy combo assembly, keep Linux trims

Status: implemented

English | [中文](2026-09-15-sync-upstream-0.1.6-alpha.1-adopt-asar-runtime-and-lazy-combo.zh.md)

## Problem

The fork last tracked `deepseek-ai/deepseek-harness` at `dsh-v0.1.5-rc.2` (PR #3977). Upstream released `0.1.6-alpha.1` (PR #4171) and advanced 599 commits past the sync point. The scheduled `sync-upstream.yml` would merge `upstream/master` into `main`, but three fork-local divergences collided with upstream changes in the same files: the desktop packaging layout, the client bundle composition path, and the Linux-only CI and platform trims.

## Decision

**Adopt upstream's ASAR runtime packaging; drop the fork's `extraResources/dsh` layout and `afterPack` verification.** Upstream's `feat(desktop): run runtime host from asar` moves the dsh production tree inside `app.asar` via `files: [{ from: buildPaths.dsh, to: 'dsh', filter: ['**/*'] }, …]` and `asarUnpack` for native modules, and `main.ts`/`host-process.ts` resolve the packaged runtime as `join(app.getAppPath(), 'dsh')` with the host child spawned under `ELECTRON_RUN_AS_NODE: '1'` against `process.execPath`. The fork's `apps/desktop/electron-builder.config.mjs` carried dsh as `extraResources` and verified `resources/dsh` in `afterPack`; that target path no longer exists under the ASAR model, and the auto-merged `main.ts` already implements upstream's resolution (the fork never touched those regions). The resolved config keeps upstream's `files`/`asarUnpack`, keeps the fork's Linux-only surface (hardcoded `linux-x64` `artifactName`, `deb` + `executableName` + `icon`, the GitHub Releases `publish` provider to `Oissp/dsh-desktop-linux-release`, and the four tray/window icon `extraResources`), and drops both the two dsh `extraResources` entries and the `afterPack` hook. Runtime-tree verification still runs at `prepare:dsh` build time (`verifyDesktopRuntime` in `prepare-dsh.ts`), which is where upstream relies on it; the packaged-app recheck the fork added has no upstream equivalent and no remaining path to check.

**Adopt upstream's deferred client combo assembly; retire the fork's encode-once optimization.** Upstream's `perf(web): defer client combo assembly` replaces eager combo construction with `LazyResponse`/`ComboResource`: `buildCombo` returns a plan whose `scriptBody`/`sourceMapBody` are `lazyBody` thunks materialized once on first fetch and memoized per combo. `buildCombo` therefore leaves the `ready` path, and each combo is encoded once at request time rather than per activation pass. The fork's encode-once change (`2026-09-12-client-bundle-composition-encode-once.md`) solved the same `buildCombo` startup cost by pre-encoding each bundle into a `ComboSegment`; upstream now ships a maintained equivalent, so `packages/client/modules/src/index.ts` takes upstream's version wholesale. `registry.fetchBundle` became `async`; `benchmarks/client-bundle-composition/client-bundle-composition.worker.ts` now `await`s it. The benchmark's 113 ms budget was calibrated against the fork's eager model and now includes first-fetch body materialization, so its `test:bench` regression gate may need recalibration; `package-deb` does not run `test:bench`, so desktop release is unblocked.

**Keep the Linux-only CI and platform trims as modify/delete resolutions.** The fork deleted upstream's `ci.yml`, `ci-master.yml`, `e2e.yml`, `e2b-e2e.yml`, `issue-lifecycle.yml`, `issue-policy.yml`, `python-release.yml`, `build-exe-for-python-sdk.yml`, and the macOS desktop specs (`macos-signature.spec.ts` and its siblings), running only `package-deb.yml`. Upstream modified seven of those workflows and `macos-signature.spec.ts` since the sync point, producing modify/delete conflicts. Each resolves to the fork's deletion: the fork cannot run Windows/macOS CI or sign macOS artifacts, and resurrecting those workflows would add Actions the fork does not exercise. The trim list (`.github/sync-trimmed-paths.txt`) resolves these conflicts automatically: listed paths keep the fork's deletion, and a clean merge removes any listed file upstream re-added.

**Desktop version follows the engine.** `apps/desktop/package.json` version is `0.1.6-alpha.1`, matching the merged root `package.json` engine version per the release-identity rule (Electron and `@deepseek-ai/dsh` share one exact version). The merge push triggers `package-deb.yml` (`paths: package.json, apps/desktop/**`) and publishes `v0.1.6-alpha.1` to `dsh-desktop-linux-release`, which does not yet exist there.

## Testing

Host and client typecheck pass (`tsc -b tsconfig.host.json`, `tsdown --env.DSH_BUILD_FACE host` for typert namespace declarations, `tsc -b tsconfig.client.json`). `apps/desktop/tests` passes 176 tests across 28 files — the `package-deb` gate, including `main-startup`, `host-process`, `runtime-tree`, `package-target`, and `release-version`. `packages/client/modules/tests` passes 85 tests. `verify-third-party-notices` reports the regenerated `THIRD_PARTY_NOTICES.md` up to date.

## Alternatives considered

**Keep the fork's `extraResources/dsh` layout and revert upstream's ASAR `main.ts` changes.** Rejected: it fights the maintained direction, re-creates the per-sync conflict in `main.ts`/`host-process.ts`/`electron-builder.config.mjs`, and the fork's only reason for the layout — upstream had no Linux packaging when the fork started — is gone now that upstream ships the ASAR model and a Linux target.

**Keep the fork's encode-once and merge it with upstream's lazy assembly.** Rejected: both optimize the same `buildCombo` cost; combining them doubles the retained bytes the encode-once note explicitly avoided and re-introduces a fork-local divergence on a hot upstream path. Upstream's memoized lazy body already encodes each combo once.

**Take upstream's `electron-builder.config.mjs` whole.** Rejected: it carries macOS/Windows signing, NSIS, the generic COS `publish` provider, and the `${os}-${arch}` `artifactName`, none of which the Linux-only fork ships. The union keeps upstream's ASAR fields and the fork's Linux release identity.

## Consequences

`main` tracks upstream `0.1.6-alpha.1`. The fork's desktop packaging now matches upstream's ASAR runtime model, so future `electron-builder.config.mjs` conflicts shrink to the Linux-only fields. The encode-once Agent Note (`2026-09-12-client-bundle-composition-encode-once.md`) describes a fork optimization upstream has superseded; it stays as historical record of the fork's investigation and is not current authority for the composition path. The client-bundle-composition benchmark's budget may need recalibration against the lazy model in a separate change.
