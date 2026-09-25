# Agent Note: Fork-trimmed links are declared, not rewritten

Status: implemented

English | [中文](2026-09-20-fork-trimmed-link-gate.zh.md)

## Problem

The fork keeps upstream Agent Notes and root `AGENTS.md` byte-identical and drops the upstream files and README sections it does not carry. Upstream prose still links into what was dropped: 72 links into files listed in [sync-trimmed-paths.txt](../../../../.github/sync-trimmed-paths.txt), and 3 fragments into sections the fork removed from `apps/desktop/README.md`.

`verify-md-links` requires every relative link to resolve, so `pnpm run test:docs` reported 75 broken links that no fork edit could repair without rewriting the upstream files — which would put every later upstream merge into conflict on exactly the files the fork leaves alone.

## Decision

[verify-md-links-trimmed.ts](../../../../scripts/verify-md-links-trimmed.ts) is the fork's driver for that gate, and the `verify-md-links` script in `package.json` runs it. It imports `markdownLinkSourcePaths`, `findViolations`, and `anchorCache` from the unmodified upstream [verify-md-links.ts](../../../../scripts/verify-md-links.ts) and withholds a violation only when the link's target keys a line in a fork trim manifest:

- [sync-trimmed-paths.txt](../../../../.github/sync-trimmed-paths.txt) — upstream files the fork does not carry, keyed by repository-relative path. The list is maintained by hand.
- [md-links-trimmed-sections.txt](../../../../.github/md-links-trimmed-sections.txt) — sections removed from upstream files the fork keeps, keyed by `path#fragment`.

A missing file keys as its path; a missing fragment as path and fragment together. Every other broken link still fails, and a passing run reports how many links it withheld.

The three section entries name `#windows-ev-signing` and `#release-versions` in the Desktop README. The fork packages only Linux, so it carries no Windows signing procedure, and its Desktop version appends a `.N` build suffix to the bundled dsh version instead of upstream's `.YYYYMMDD.index`.

## Alternatives considered

**Rewrite the upstream notes to unlink trimmed targets.** It repairs the links at their source, but changes 62 upstream files, so the next upstream merge conflicts on each one — the cost the fork's trim list exists to avoid.

**Accept the red gate.** `test:docs` would stay red on every run, and a real broken link would be indistinguishable from the 75 known ones.

**Restore the removed sections in the Desktop README.** The fork does no Windows signing, and the upstream release-version section documents a scheme the fork replaced; both sections would describe work the fork does not do.

**Edit the upstream gate in place.** The fork has never modified an upstream script, and the driver's own CLI entry point is guarded by `import.meta.filename`, so an imported wrapper needs no change upstream.

## Consequences

Upstream files stay byte-identical and upstream merges stay automatic. The gate no longer proves that links into fork-trimmed paths resolve — those targets cannot exist in this fork, so the check was unsatisfiable rather than informative.

A newly dropped file or section must be declared, in `sync-trimmed-paths.txt` for a file and in the sections manifest for a section, or the gate fails on the links into it.

The upstream gate stays live as an imported module, so upstream changes to source discovery, fragment slugs, and reporting reach the fork without a merge.

## Testing

`pnpm run verify-md-links` checks 2013 files and withholds 75 links. Adding a document with a missing target and a missing anchor in an unlisted section reports both and exits 1. [verify-md-links-trimmed.spec.ts](../../../../scripts/verify-md-links-trimmed.spec.ts) covers target keying, fragment keying, percent-escapes, and manifest parsing. `pnpm run test:docs` reports 20 passed, 0 failed.
