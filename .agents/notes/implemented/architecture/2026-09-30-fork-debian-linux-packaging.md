# Agent Note: Fork Debian Linux packaging

Status: implemented

English | [中文](2026-09-30-fork-debian-linux-packaging.zh.md)

> Analyzed: `Oissp/dsh-desktop-linux` (fork, origin) ← `deepseek-ai/deepseek-harness` (upstream). Analysis point: desktop `0.2.0-rc.2.2`, engine `0.2.0-rc.2`, fully synced to the upstream `0.2.0-rc.2` release line.

## Problem

This fork needs a Linux desktop packaging and release pipeline for `deepseek-harness` (upstream declares macOS/Windows as its only supported platforms and has no runnable Linux release target). Upstream's 0.2.0-rc packaging shell and release pipeline (macOS signing/notarization, Windows EV signing, COS upload, installed-update delta updates) are macOS/Windows-specific; keeping them would leave the Linux build with large amounts of dead code and invalid packaging config (such as `mac`/`win` blocks). The fork must diverge the packaging layer on its side with minimal intrusion, without rewriting the runtime core.

## Decision

The fork takes a "minimal intrusion, maximum reuse" approach: rather than rewriting upstream's packaging core, it removes macOS/Windows-specific code with a trim list (`.github/sync-trimmed-paths.txt`) and replaces the trimmed release pipeline with an independent Linux packaging entry point (`package-target.ts` + `electron-builder.config.mjs` + `package-deb.yml`). The runtime core (engine, Office, Python, Node, pnpm, plugin management, Host startup, native recovery) stays identical to upstream.

Key mapping:

| Dimension | Fork | Upstream counterpart |
|---|---|---|
| electron-builder config factory | `electron-builder.config.mjs` (Linux-only, no `mac`/`win` block) | `scripts/electron-builder-config.mjs` (has mac/win blocks, trimmed) |
| Packaging entry | `scripts/package-target.ts` (hardcoded `linux-x64`) | `scripts/packaging-run.mjs` (multi-target dispatch, trimmed) |
| Release/upload | `.github/workflows/package-deb.yml` (gh release → GitHub Releases) | `release.yml` + `release-publish.yml` + COS upload pipeline (trimmed) |
| Auto-update source | GitHub Releases provider (`latest-linux.yml`) | COS + self-hosted CDN (`nightly-linux.yml`) |
| Runtime preparation | **Reuses** `scripts/primary-runtime/prepare.ts` | same file |
| Office integration | **Reuses** `smoke-runtime.ts`, `libreoffice-packages.mjs` | same set of files |
| Runtime file policy | **Reuses** `runtime-file-policy.ts` | same file |

### Functional parity

- **Runtime core** (engine, Office, Python, Node, plugin management, Host, native recovery): **identical**, shared upstream source.
- **Desktop shell**: identical + Linux-specific enhancements (tray, appearance icon switching, opaque prompt card, StartupWMClass consistency, desktop locale controller).
- **Packaging/release**: functionally equivalent but different path (GitHub Releases replaces COS; no signing replaces signing).
- **"Manage dsh command" (desktop-cli)**: the upstream 0.2.0-rc.2 feature was originally trimmed by the fork, then synced to Linux (`pkexec` elevation, Linux launcher, tray menu item), per the desktop-cli Linux sync feature note.

## Trim reasonableness

All 267 trimmed paths are justified as "Linux has no equivalent": macOS signing/notarization, Windows EV signing, the COS upload pipeline, the installed-update delta pipeline, and upstream CI workflows. `primary-runtime-lock.json` is retained exceptionally (read directly by `gen-third-party-notices.ts`, avoiding a fork of the generator).

The desktop-cli files were originally trimmed in the 0.2.0-rc.2 merge (the mac/win launchers are platform-specific), but the cross-platform `login-shell-environment.ts` was kept; they were then restored and adapted for Linux.

## CI / release pipeline

- `package-deb.yml`: push to main (shell changes) + manual, produces deb + AppImage + `latest-linux.yml`, published to `Oissp/dsh-desktop-linux-release`.
- `package-deb-test.yml`: PR to main + engine source paths, produces deb only, no publish.
- Shared engine cache (`prepare-desktop-engine` composite action), complementary trigger paths, idempotent publishing, concurrency control, and thorough artifact verification.

The fork's release pipeline is functionally equivalent to upstream's; only the update source and signing chain differ (Linux needs no signing).

## Upstream merge process

The fork has completed several upstream merges (0.1.6-alpha.2 / 0.1.7-rc.1 / 0.1.7-rc.2 / 0.2.0-rc.1 / 0.2.0-rc.2); the trim list is the core merge tool, and each merge has an Agent Note recording the conflict decisions.

Improvement directions: automatic trim-list completeness verification (check in `package-deb-test.yml` that trimmed files are absent), a machine-readable baseline for behavior modifications (`sync-forked-paths.txt`), and automatic pairing-hash re-record. The merge runbook lives at `.github/MERGE_UPSTREAM.md` and the Linux packaging guide at `apps/desktop/LINUX_PACKAGING.md`.

## Alternatives considered

**Rewrite the packaging core (no trim list).** Rejected: it would cause constant merge conflicts with upstream (every upstream rework needs the fork-side logic reapplied) and waste the same-source guarantee of the existing runtime core. The trim list + independent Linux entry turns repeated conflicts into mechanical operations.

**Add a Linux branch to upstream's mac/win packaging shell and contribute it back.** Rejected as a near-term option: upstream declares "Linux has no supported release target", so it cannot merge soon; the fork-first strategy already works. If upstream later accepts Linux, it can be the basis for an upstream PR.

**Edit the README to document Linux packaging instead of keeping upstream bytes.** Rejected: the fork keeps `apps/desktop/README.md` byte-identical to upstream to reduce merge conflicts; Linux packaging commands live in `package.json` scripts and `package-deb.yml`.

## Consequences

- **Bought**: low-cost merging with upstream; a functionally equivalent packaging/release/update pipeline for Linux users; a zero-fork runtime core.
- **Paid**: the fork maintains a separate packaging shell and release pipeline; each upstream rework of fork-modified files (`desktop-build-paths.mjs`, `electron-builder.config.mjs`, `package-target.ts`, …) raises conflicts that must be reapplied by hand; the README still carries mac/win packaging instructions that may confuse Linux users (intentional).
- **Limits**: deb users update by reinstalling or switching to AppImage (electron-updater's AppImage delta support is limited); desktop-cli command management is reliable only for the deb install (AppImage mount-path instability), and `isInstalledLocation` is always true on Linux.

## Testing

`pnpm run test:docs` (including `verify-agent-note-format`), `pnpm run doc-sync`, `pnpm run lint`, `git diff --check`. Desktop packaging/release verification is covered by `package-deb-test.yml`.
