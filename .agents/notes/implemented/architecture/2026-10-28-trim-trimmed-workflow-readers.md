# Agent Note: Trim the specs that read trimmed packaging workflows

Status: implemented

English | [中文](2026-10-28-trim-trimmed-workflow-readers.zh.md)

## Problem

`scripts/macos-package-workflow.spec.ts` and `scripts/desktop-publish-workflow.spec.ts` read their workflow file at module scope, and the fork trims all three workflows they load: `macos-package.yml`, `macos-intel-package.yml`, and `desktop-publish.yml`. Both specs therefore throw `ENOENT` while Vitest collects them, so a run names neither a test nor an assertion; every invocation that includes `scripts/**/*.spec.ts` fails before any test executes.

The alpha.4 and alpha.5 merges kept these two specs on purpose while trimming the comparable specs added later ([alpha.4](2026-10-16-merge-0.2.1-alpha.4-linux-desktop.md), [alpha.5](2026-10-16-merge-0.2.1-alpha.5-linux-desktop.md)). The 0.2.2-alpha.2 merge then trimmed `scripts/desktop-package-forms.spec.ts` — a reader of the same workflows — which left one trimmed reader beside two kept ones that break identically ([merge note](2026-10-28-merge-0.2.2-alpha.2-linux-desktop.md)).

## Decision

Both specs are trimmed, and `.github/sync-trimmed-paths.txt` now holds 418 paths.

The keep decision rested on the assertions staying available if the fork ever adopts the macOS packaging or COS publication pipeline. The fork cannot: `desktopTargetPlatform` returns Linux x64, `electron-builder.config.mjs` has no mac or win block, and CI runs only `apps/desktop/tests` through `package-deb.yml` and `package-deb-test.yml`. Upstream holds the assertions in its own history, so a future adoption can restore them from there instead of from this tree.

## Alternatives considered

**Keep both specs and skip them when the workflow file is absent.** Rejected: the guard would sit inside upstream-owned files that the fork cannot exercise, so every upstream edit to either spec would have to re-apply it, and the resulting suites still report no passing test.

**Trim only `scripts/macos-package-workflow.spec.ts`.** Rejected: the two specs share one condition and one recorded decision; trimming one would leave `scripts/desktop-publish-workflow.spec.ts` breaking collection while the trim list presented the class as handled.

**Keep both specs unchanged.** Rejected: `pnpm run test` and any `pnpm exec vitest run scripts` invocation fail at collection, and the failure reads as breakage rather than as a recorded trim.

## Consequences

A future upstream sync that modifies either spec now yields a modify/delete conflict the trim list resolves without a decision, instead of a conflict in a guard the fork must re-apply.

If the fork ever adopts macOS packaging or the COS publication pipeline, the two specs come back from upstream's history together with the workflows they exercise; restoring them without those workflows would reintroduce the collection failure.
