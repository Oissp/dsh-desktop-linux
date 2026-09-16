# Agent Note: Rewrite the desktop native loader's Electron fingerprint at packaging time

Status: implemented

English | [中文](2026-09-16-desktop-native-loader-electron-fingerprint-patch.zh.md)

## Problem

This fork packages its own Linux desktop installers (`.deb` + AppImage) and pins a newer Electron than upstream to keep the tray fixes from the fork's Electron 44.3.0 bump (44.0.0 → 44.3.0). The packaged runtime bundles `node-addon-require-builtin`, whose compiled binary admits an Electron runtime only when the running Node.js version triple and V8 version string exactly equal one of its recorded Electron profiles — 43.0.0 → Node 24.17.0 / V8 15.0.245.13-electron.0, 44.0.0 → Node 24.18.1 / V8 15.2.124.13-electron.0, 45.0.0-alpha.6 → Node 24.21.0 / V8 15.4.80-electron.0. Electron 44.2.0 updated its Node.js to 24.20.0 and backported V8 fixes (15.2.124.19-electron.0), so inside the fork's packages every load of the loader failed at boot:

```
dsh desktop: host preparation failed: node-addon-require-builtin unsupported: Unsupported/no-context
(unsupported Electron runtime fingerprint: Node 24.20.0, V8 15.2.124.19-electron.0
(supported Electron versions: 43.0.0, 44.0.0, 45.0.0-alpha.6))
```

Upstream releases do not hit this because upstream pins `electron@44.0.0`, whose fingerprint the loader records. The addon's native source is not public (the binary carries only a `/workspace/packages/native` build path), and the latest published version, 0.1.6, still lacks a 44.2+ profile. The fork's 0.1.6-alpha.1 packages could not start at all.

## Decision

Reconcile the bundled loader's Electron profile table with the packaged Electron build during `prepare:dsh`, before integrity sealing: [scripts/native-electron-fingerprint.ts](../../../../apps/desktop/scripts/native-electron-fingerprint.ts) probes the packaged Electron binary under `ELECTRON_RUN_AS_NODE` for its `{electron, node, v8}` identity, locates the profile record for the same Electron major, rewrites the record's Node.js version triple and V8 version string in place, and then loads the loader under the packaged Electron as a packaging acceptance gate that resolves every internal module the dsh profile resolver requires. A release may only be packaged after that gate passes.

Facts about the binary that the code alone does not carry:

- The loader selects a profile purely by exact Node.js triple plus exact V8 string. The record's Electron version text is diagnostic-only, and the separate `electron-<major>` tag selects the embedder-data ABI and must keep describing the packaged major, so neither is rewritten.
- Rewriting strings alone was tested against the real binary and is insufficient: patching the recorded V8 string (and even the Electron version text) still fails because the exact Node.js triple is also compared.
- Records are fixed-stride `{length, pointer}` string references, so in-place rewriting requires the replacement V8 text to have the same byte length; a mismatch fails the build instead of corrupting the table.
- The reconciler fails loud on every unmet precondition: no prebuilt binary under the runtime tree, no recognized profile table, no record for the packaged major, or a rejected load during verification. Packaging aborts instead of shipping a boot-broken app.
- The loader's own materialization cache verifies a cached copy's SHA-256 against the source and falls back to the source directory on mismatch, so patched binaries are never shadowed by stale cache entries.
- The packaging engine cache key hashes every tracked source file, including this patcher, so patcher changes force a full re-preparation.

Retirement condition: when upstream publishes a `node-addon-require-builtin` that records the packaged Electron's fingerprint, the reconciler becomes a no-op for that build (already-matching records are left alone) and should be retired once no packaged Electron needs the rewrite.

## Consequences

The fork keeps Electron 44.3.0 and its tray fixes, and packages boot on Electron builds the loader never recorded. The cost is a maintainer-owned dependence on the private binary's record layout: an addon update that changes the profile table shape fails packaging loudly, never at user boot, and the patcher must be retired once no packaged Electron needs the rewrite. The same-length V8 constraint narrows what Electron can ship — a future backport that lengthens the V8 string fails packaging until the patcher learns to rebuild the string area.

## Alternatives considered

- **Pin Electron 44.0.0 like upstream.** Rejected: it discards the GNOME/Wayland tray regression fix and the Flatpak/Snap tray icon fix that motivated the bump, and it leaves the fork one Electron patch line behind upstream's shell requirements.
- **Wait for an upstream addon release.** Rejected as the only plan: the native source is private, no release had added the profile, and the desktop stayed unusable in the meantime.
- **Run the dsh host under the bundled plain Node.js runtime instead of `ELECTRON_RUN_AS_NODE`.** Rejected: the shell binds its host process to the Electron binary it ships; introducing a second runtime multiplies the qualification surface the release pipeline owns, for a problem one data rewrite already solves.
