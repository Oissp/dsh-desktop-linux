# Agent Note: The packaged Linux Office preview needs a fork patch on the LibreOffice kit

Status: implemented

English | [中文](2026-09-18-desktop-office-preview-asar-engine-probe.zh.md)

## Problem

The sidebar preview converts an Office document through `@deepseek-ai/libreoffice-kit`, which selects a native engine on macOS and Windows and the WASM engine on Linux. Before falling back it probes for the native package with `installedPackageExists`, implemented as `lstatSync(path, { throwIfNoEntry: false }) !== void 0`. Electron's asar fs shim returns `null`, not `undefined`, for a path that is missing inside `app.asar`, and `null !== undefined` is true. The absent `@deepseek-ai/libreoffice-kit-linux-x64-glibc` package therefore reads as installed but incomplete, `resolveEngine` throws, and the WASM fallback never runs, so every preview conversion fails in the packaged Linux application. Development runs and the packaging runtime smoke read the real filesystem, where the missing path returns `undefined`, so neither reproduces it.

The kit itself is not the only file involved. `apps/desktop-host/src/office.ts` rewrites the engine specifier for the packaged case, but that rewrite only applies to module resolution; the probe reads directories from `require.resolve.paths` and stats them directly, so it still sees the asar path.

## Decision

The fork patches the kit rather than waiting for an upstream release. `patches/@deepseek-ai__libreoffice-kit@0.1.2.patch` rewrites the probe to `Boolean(lstatSync(...))` inside a `try`, treating a falsy stat and a throwing stat as absent. The patch is declared in [pnpm-workspace.yaml](../../../../pnpm-workspace.yaml) under `patchedDependencies`, which is what makes pnpm install the patched copy everywhere in the workspace.

The patch only reaches the packaged application because [prepare-dsh.ts](../../../../apps/desktop/scripts/prepare-dsh.ts) carries it: `applyRuntimePatches` copies the repository's patch file and its `patchedDependencies` entry into the temporary build root before the production install, keyed on the `name@version` pairs that appear in the generated lockfile. Without that step the packaged runtime ships the unpatched package even when the repository declares the patch.

The build root generates its own `pnpm-workspace.yaml` from the core package set, so the repository catalog and its `patchedDependencies` never reach the production install. A patched transitive dependency (the kit) otherwise drifts to the latest registry release that satisfies its range, and the patch is then silently dropped because its `name@version` key no longer matches the resolved lockfile entry. That drift shipped: the 0.1.7-rc.2.1 build resolved kit 0.1.2 while the patch targeted 0.1.1, so the packaged runtime carried the unpatched kit and every Office preview failed. `createRuntimeProjectMetadata` now reads the repository `patchedDependencies` and pins each patched package to its declared version in the build-root `overrides:` section (not as a direct `package.json` dependency, so absent packages are not forced into the tree), so the production install always resolves the version the patch targets regardless of registry releases. `applyRuntimePatches` additionally emits a CI-visible `::warning::` when a declared patch is skipped because its `name@version` is absent from the lockfile, so a future drift cannot fail silently.

The declaration and the file name both carry the kit version, and pnpm records a patch hash in the lockfile, so a kit upgrade invalidates the patch. Regenerate it with `pnpm patch @deepseek-ai/libreoffice-kit@<version>` followed by `pnpm patch-commit`, and confirm that the resolved copy is the one under a `_patch_hash=` directory.

## Alternatives considered

**Wait for upstream to fix the probe.** Rejected: the defect is still present in kit 0.1.2, and upstream's 0.1.7 Office work routes the authoring skills through a standalone CLI process while leaving the sidebar preview resolving the engine inside the Electron process, so the packaged Linux preview stays broken until the probe itself is fixed.

**Serve the preview through the standalone CLI, as the skills do.** Rejected: the preview is a Host RPC (`officeToPdf.render`) answered in the Electron process, and the CLI path exists to give model-authored Office work a bounded subprocess. Moving the preview onto it changes the RPC and its cancellation behavior, not just the probe.

**Pre-resolve the engine in the Host and inject it.** Rejected: `resolveEngine` takes injectable parameters, but `office-to-pdf` constructs its converter through the kit's `createConverter`, which resolves internally, so the Host has no seam to inject through without changing the kit.

**Delete the native engine packages at packaging time.** Rejected: `runtime-file-policy.ts` already prunes other platforms' engines, but the probe looks for a package the fork never installs, so pruning cannot change what it finds.

## Consequences

Packaged Linux builds keep a working Office preview. The cost is a standing patch on a third-party package with three failure modes that only show up in a packaged build: a kit upgrade silently invalidates the patch; a merge that resolves `pnpm-workspace.yaml` in upstream's favour drops the declaration and the patch file together; and a registry release newer than the patched version lets the build root resolve it, silently dropping the patch. The first two shipped before this fix: the 0.1.7-alpha.1 merge removed both, and 0.1.7-alpha.1 through 0.1.7-alpha.2.1 could not preview any Office document. The third shipped in the 0.1.7-rc.2.1 build, which resolved kit 0.1.2 against a 0.1.1 patch. The version-pin override and the skip warning close the third path; the first two remain merge hygiene.

The patch can be retired when the kit treats a falsy stat as absent, or when the sidebar preview stops resolving the engine inside the asar. Until then, an upstream refactor of `lib/index.js`'s engine resolution, or of the `patchedDependencies` block in `pnpm-workspace.yaml`, requires re-applying the change on top.

## Testing

`pnpm exec vitest run apps/desktop/tests` covers the packaging gate, including `prepare-dsh.spec.ts`, which pins that only patches whose package is installed are carried, that they are declared in the build workspace, and that a version-drifted patch emits a `::warning::`. `core-package-set.spec.ts` pins that `createRuntimeProjectMetadata` carries every patched package's version into the build-root overrides. `packages/document/office-to-pdf/tests` covers the conversion service. The patch itself is verified by reading the resolved package: the workspace must link `@deepseek-ai+libreoffice-kit@0.1.2_patch_hash=*`, and that copy's `installedPackageExists` must be the `Boolean(...)` form. `pnpm run hygiene` regenerates `THIRD_PARTY_NOTICES.md`, which discloses the patched package.
