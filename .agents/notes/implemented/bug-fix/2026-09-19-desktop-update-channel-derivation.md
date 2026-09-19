# Agent Note: Desktop update channel derives from the installed version

Status: implemented

English | [中文](2026-09-19-desktop-update-channel-derivation.zh.md)

## Problem

[The 0.1.6-alpha.2 merge](../architecture/2026-09-18-merge-0.1.6-alpha.2-linux-desktop.md) pinned `updater.channel = 'latest'` in `update-coordinator.ts`, reasoning that the GitHub provider must request `latest-linux.yml` rather than upstream's `nightly-linux.yml`. That reading inverts electron-updater's precedence. `GitHubProvider` treats `updater.channel` as the installed client's own channel and uses it to filter the release feed, ahead of the prerelease segment of the installed version. With `channel === 'latest'` neither admission test can hold for a release tagged `v0.1.6-alpha.2.1`: `shouldFetchVersion` admits only an absent channel or `alpha`/`beta`, and `isNextPreRelease` requires the tag's prerelease segment to equal the channel. The tag stays `null` and every check throws `ERR_UPDATER_NO_PUBLISHED_VERSIONS`, so no installed build could discover an update at all.

## Decision

`DesktopUpdateCoordinator` leaves `updater.channel` unset. electron-updater then derives the channel from `semver.prerelease(currentVersion)[0]` — `alpha` for the versions this fork publishes — and matches it against the release feed's tags. The channel metadata filename follows from the resolved tag: the client requests `alpha-linux.yml` first, and falls back to `latest-linux.yml`, the file electron-builder's default `github` channel actually publishes, when the prerelease-named file is absent.

The installed version is the only place the channel is decided. Neither packaging nor the release workflow selects one, so a version moving from `alpha` to `beta` to stable changes the followed channel with no configuration change.

## Alternatives considered

**Publish `alpha-linux.yml` beside `latest-linux.yml`.** Rejected: the duplicate would have to be renamed per prerelease identifier, putting the channel name into the release workflow's asset list for no user-visible gain over a fallback that already succeeds. It would also remove the only end-to-end exercise of that fallback.

**Keep `channel = 'latest'` and set `allowPrerelease = false`.** Rejected: the release repository publishes prereleases only, so a stable-channel lookup would resolve nothing and reproduce the same failure.

**Keep upstream's `nightly` channel and publish `nightly-linux.yml`.** Rejected in [the merge note](../architecture/2026-09-18-merge-0.1.6-alpha.2-linux-desktop.md): the channel name would then have to flow through the electron-builder config, the release asset list, and the updater, for no benefit over the name the provider resolves on its own.

## Consequences

Update checks against `Oissp/dsh-desktop-linux-release` resolve the newest matching release instead of failing outright. The cost is one wasted request per check: the client asks for `alpha-linux.yml`, receives 404 because the release carries only `latest-linux.yml`, then retries the default name.

The fork's diff against upstream in `update-coordinator.ts` shrinks from replacing `'nightly'` with another literal to deleting the assignment, so an upstream refactor of that constructor is the only case that needs the removal re-applied.

## Testing

`apps/desktop/tests/update-coordinator.spec.ts` asserts the coordinator leaves `updater.channel` undefined alongside the flags it does set, so re-pinning a channel fails the desktop suite that `package-deb.yml` runs before packaging.
