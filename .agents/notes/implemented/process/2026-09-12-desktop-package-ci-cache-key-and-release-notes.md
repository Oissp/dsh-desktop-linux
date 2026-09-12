# Agent Note: Desktop package CI — deterministic cache key and release-note boundaries

Status: implemented

English | [中文](2026-09-12-desktop-package-ci-cache-key-and-release-notes.zh.md)

## Problem

The desktop packaging workflow shipped a broken engine build cache and cumulative release notes.

`hashFiles()` evaluated the engine-cache key over the working tree, where the `packages/**`, `vendor/**`, `native/**`, and `apps/desktop-host/**` patterns also match `node_modules` (created by `pnpm install`) and build outputs emitted during `prepare:*`. Identical source produced three different keys across two runs — run 1 computed `5d060509…`, run 2 computed `194d1927…` at restore and `883de9b8…` at save — so the cache never hit and the save step wrote a fresh entry every run.

Release notes were generated with `git log "$(git describe --tags --abbrev=0)"..HEAD`. This repository carries upstream engine tags (`dsh-v0.1.5-rc.2` at HEAD), which never advance on desktop releases — desktop release tags live in the separate `dsh-desktop-linux-release` repo. Every release therefore repeated the full history since the engine tag (97 → 106 → 113 commit lines), and all release-repo tags point at the same commit, since `gh release create` tags the release repo's immutable `main` HEAD.

## Decision

**Engine cache key.** A `Compute engine cache key` step hashes only tracked source with `git ls-files <pathspecs> | git hash-object --stdin-paths | git hash-object --stdin`. `git ls-files` is sorted and excludes untracked `node_modules` and build outputs; the pathspec list still excludes `apps/desktop/package.json`, so a pure version bump hits the cache. Restore and save both use `steps.engine-key.outputs.key`. Dependency changes are still caught by `pnpm-lock.yaml`, which is in the pathspec list.

**Release notes.** The notes step walks `git log HEAD -- apps/desktop/package.json`, finds the newest commit whose version differs from the release version, and logs `git log <that commit>..HEAD`. Desktop versions live only in `apps/desktop/package.json`; that commit is the previous desktop release boundary. Without a previous version it falls back to the last 50 commits. Notes now carry a `自 v<previous> 以来` scope line.

## Alternatives considered

**Keep `hashFiles` but control the file set.** `hashFiles` accepts no exclude patterns and its walk order is not controllable from the workflow expression, so neither node_modules pollution nor cross-run ordering could be fixed from the expression side.

**Tag the source repo with desktop versions.** Desktop tags would make `git describe` usable, but the source repo is a fork that intentionally preserves upstream tags, and desktop releases publish to a separate repo; minting interleaved `v0.1.5-rc.2.N` tags here would pollute the fork's tag namespace.

## Consequences

A pure version bump now restores the engine cache and skips the `prepare:*` engine phase (≈345s), which was the goal of the cache. Release notes contain only commits since the previous desktop release instead of the full history since the engine tag. The release-repo tags still all point at the same commit — inherent to `gh release create` tagging the immutable `main` HEAD of an assets-only repo, and harmless for `electron-updater`; making tags carry source provenance would require a separate marker-commit design.
