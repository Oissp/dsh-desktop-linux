# Agent Note: Hand-merged upstream releases

Status: implemented

English | [中文](2026-09-25-hand-merged-upstream-releases.zh.md)

## Problem

`.github/workflows/sync-upstream.yml` merged `deepseek-ai/deepseek-harness` `master` into `main` on a daily UTC 06:00 schedule, but only when the upstream root `package.json` version was strictly greater than the fork's — the comparison `scripts/compare-dsh-versions.mjs` performed. Conflicts on paths in `.github/sync-trimmed-paths.txt` resolved to the fork's deletion automatically; a conflict anywhere else aborted the merge and opened an issue for a human.

Every run that had a release to merge produced conflicts outside the list, so abort-and-notify was the normal outcome. The job reported a problem, a human resolved the merge and ran the gates, and the merge landed by hand regardless. The workflow added a second, unattended route into the same merge without removing the manual one, and what the fork had to watch was the aborted runs.

## Decision

Upstream releases are merged into `main` by hand. `.github/workflows/sync-upstream.yml` and its semver gate `scripts/compare-dsh-versions.mjs`, `scripts/compare-dsh-versions.d.mts`, and `scripts/compare-dsh-versions.spec.ts` are deleted; the gate had no other consumer.

`.github/sync-trimmed-paths.txt` stays. It is an input to [`scripts/verify-md-links-trimmed.ts`](../../../../scripts/verify-md-links-trimmed.ts), which exempts relative links into files the fork does not carry, so removing it fails the link gate on 72 upstream links. It is no longer workflow state: a merge reads it by hand, and its header, that script's JSDoc, and the [fork-trimmed link gate](2026-09-20-fork-trimmed-link-gate.md) note now say so.

`docs/development.md` names [package-deb-test.yml](../../../../.github/workflows/package-deb-test.yml) — the `.deb`-only pull-request smoke — alongside `package-deb.yml` as the fork's workflows, and records that upstream releases arrive by hand.

## Alternatives considered

**Repair the workflow instead of deleting it.** Rejected: the conflicts outside the trim list are the fork's deliberate divergences — the Linux tray and update surfaces, the client bundle composition path, the desktop packaging layout — and resolving each one needs the judgment its merge note records. No rule the workflow could apply resolves them, so repairing it means teaching it the fork's whole divergence set, which is the manual work the workflow existed to remove.

**Keep it as a notifier that compares versions and opens an issue without merging.** Rejected: the comparison is one `git ls-remote` and a version read, and the fork still has to notice the issue. It is cheaper to run when someone has decided to merge.

**Keep `scripts/compare-dsh-versions.*` for a workflow that might return.** Rejected: an unused script and its spec are still collected by `pnpm run test` and still need maintenance, and the comparison is three lines to rewrite.

## Consequences

Upstream currency now depends on someone merging; nothing reports that a release exists. The trim list is load-bearing for the link gate and maintained by hand, so a merge that drops a file without listing it fails `doc-sync` rather than the merge.

## Testing

`pnpm run test:docs` passes all 20 documentation gates, including `markdown links`, which reads the trim list. `grep` over the tree finds no reference to `sync-upstream.yml` or `compare-dsh-versions` outside this note.
