# Agent Note: Desktop startup tests pin the simulated Windows architecture

Status: implemented

English | [中文](2026-09-20-desktop-startup-test-windows-arch.zh.md)

## Problem

`apps/desktop/tests/main-startup.spec.ts` simulates the packaged Windows client: its `beforeEach` stubs the global `process` as `{ ...process, platform: 'win32', resourcesPath: 'desktop-test-resources' }`. The spread carried the host architecture, so an arm64 machine produced `platform: 'win32'` together with `arch: 'arm64'`.

`apps/desktop/src/main.ts` copies that pair into the mandatory-update policy identity, and `DesktopMandatoryUpdatePolicy` rejects `desktop-win` at any architecture but `x64` because the shipped Windows client is x64-only. The constructor threw `desktop policy: invalid installed client identity`, startup treated the throw as fatal, and the shell presented its recovery dialog instead of the policy dialog the case awaited.

Fifteen cases failed: one on the dialog assertion and fourteen on timeouts for promises the aborted startup never resolved. Only cases that enable a policy configuration reach the identity, which is why the rest of the file passed. GitHub's `ubuntu-24.04` runners are x64, so CI never built the rejected pair.

## Decision

The `beforeEach` stub names the architecture it simulates: `{ ...process, platform: 'win32', arch: 'x64', resourcesPath: 'desktop-test-resources' }`. The About-panel `it.each` in the same file spreads the already-stubbed `process` and inherits `arch: 'x64'`, so it needs no separate pin.

`apps/desktop/tests/mandatory-update-policy.spec.ts` records the constructor rule the harness depends on: `desktop-win` with `arm64`, a non-semver `version`, an empty `bundledDshVersion`, and a whitespace-only `bundleId` each throw `invalid installed client identity`, while `desktop-mac` with `arm64` constructs a policy.

## Alternatives considered

**Accept Windows arm64 in the policy identity.** The check encodes that no arm64 Windows client ships, and the reported `x-client-platform`/`x-client-arch` pair is what the policy backend matches on. Accepting the pair would require shipping that client first.

**Stub only the `process` fields each case reads.** Every field the startup path touches would have to be enumerated, and a later read of an unlisted field would silently take the host value — the same failure, harder to trace. Pinning the single field that must not vary keeps the spread and its defaults.

**Skip the affected cases on non-x64 hosts.** That hides the failure on the developer's machine rather than making the simulation deterministic, and the suite would silently lose fifteen cases on Apple Silicon.

## Consequences

The suite no longer depends on the host architecture, so those cases run identically on arm64 developer machines and x64 CI.

Every case simulates a Windows x64 client, so no case exercises a Windows arm64 identity; the policy test records that combination as rejected instead of exercising it as a client.

This is a fork divergence: upstream `deepseek-harness` still carries the unpinned stub. A merge that takes upstream's `apps/desktop/tests/main-startup.spec.ts` restores the arm64 failure, and the `arch: 'x64'` pin must be re-applied.

## Testing

`pnpm exec vitest run apps/desktop/tests/main-startup.spec.ts apps/desktop/tests/mandatory-update-policy.spec.ts` passes 96 cases on an arm64 host. Reverting the pin alone fails fifteen of them there.
