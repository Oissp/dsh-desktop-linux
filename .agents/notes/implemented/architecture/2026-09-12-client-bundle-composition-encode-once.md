# Agent Note: Client bundle composition encodes each bundle once

Status: implemented

> Partially superseded for the composition path by [Sync upstream 0.1.6-alpha.1](../process/2026-09-15-sync-upstream-0.1.6-alpha.1-adopt-asar-runtime-and-lazy-combo.md): upstream's deferred combo assembly (`perf(web): defer client combo assembly`, `42286726c8`) ships a maintained equivalent, so this fork's encode-once optimization is retired. This note stays as the investigation record and is not current authority for `buildCombo`.

English | [中文](2026-09-12-client-bundle-composition-encode-once.zh.md)

## Problem

Desktop startup waited on its child host process for 2.8 s before the shell could navigate to the application URL. Attribution over the local development profile — a fresh child per sample, clock stopped on the `{ type: 'ready' }` IPC event, no model or network request issued — put 2164 ms of a 2822 ms boot (77%) inside `buildCombo` in `packages/client/modules`, which composes the client bundles a first page load fetches.

The cost was per-byte work repeated over 11.5 MB of client bundles. `newlineCount` iterated code points to count generated lines for indexed-map section offsets (451 ms self time). Each bundle's text was encoded to UTF-8 twice per combo — once for the content hash, once with the source-map trailer appended (`utf8Write` 450 ms). And `compose()` built every plugin's single-entry combo from scratch on each of the three activation passes, re-decoding and re-encoding bundles the batch pass had already prepared.

The four cheaper hypotheses measured first were all rejected: the runtime descriptor parse plus its two identity hashes (1.7 ms over 2175 files), the awaited `settings.yaml` reads gating tray and window creation (0.25 ms), `applyRelease`'s link verification over 286 packages (9.4 ms), and `NODE_COMPILE_CACHE` (2738 → 2806 ms, no gain).

## Decision

**Prepare each bundle once, when its bytes are read.** `WebPluginRecord` carries a `ComboSegment` in place of the raw bundle: concatenation-ready bytes with debug directives stripped and the statement terminator appended, the generated line count, the fallback generated-file name, and — only for a bundle shipping no authored map — the pre-terminator text the identity map needs for `sourcesContent`. `comboSegment()` produces it at record construction and again in `rebuilt()` when HMR accepts new bytes, so every combo over the same bundle version concatenates the same `Buffer`.

**`buildCombo` concatenates prepared bytes instead of a string.** It collects each segment's bytes, hashes `Buffer.concat` of them with the composed source map, and hands the same array to `comboScript`, which appends the `sourceMappingURL` trailer as one further buffer. The combo source is never materialized as a JavaScript string, so the double UTF-8 encode is gone. Script bytes and rev are byte-identical to the previous path, verified over the 58 built client bundles of the local profile (11,533,086 bytes).

**Count newlines by scanning, not by code point.** `newlineCount` advances through `indexOf('\n')`. Over the real corpus volume this measured 38.5× faster than code-point iteration for the same counts.

**Build the identity map's mappings by repetition.** `identitySectionMap` composes `AAAA` plus `';AACA'.repeat(lines - 1)` from the segment's recorded line count rather than allocating an array and joining it. The map still describes the bundle before its terminator, so its `sourcesContent` and mappings are unchanged; only bundles with no `client.js.map` reach this path.

**Memoize each row's own single-entry combo.** A record's `solo` artifact is built on first use and deleted in `rebuilt()`, whose accepted bytes replace every input together. Recomposing a graph whose rows have not changed reuses those artifacts instead of rebuilding them.

Measured under one harness, median of 5 fresh children to `ready`: **2749 ms → 954 ms (2.88×)**. Reverting the loops in the built bundle restores 2749 ms.

## Testing

`benchmarks/client-bundle-composition/` gates the composition cost: a compiled worker mounts `ClientModuleRegistry` over a synthesized corpus of 70 resolvable client packages (1,400 generated lines each, ~11.7 MB, every package shipping an authored map), times construction through the first served batch, and reports retained heap with the registry still reachable. The budget is 113 ms — `ciTimeBudget(45)` — and a calibration case pins both the accepted samples and the rejected regression medians as source constants.

The negative control runs through the gate itself: reintroducing the code-point newline loop and the per-record rebuild into the built bundle fails the case at a 143.3 ms median. The corpus is generated from reviewed constants in `synthetic-client-packages.ts` and depends on no recorded session, ambient repository, or user material.

`packages/client/modules/tests/loader.client.spec.ts` and `tests/node-half.client.spec.ts` own the behavior; the indexed-map section assertion in the latter caught the one real difference this change introduced in progress, when the statement terminator briefly leaked into the identity map's `sourcesContent`.

## Alternatives considered

**Cache batch artifacts across compose passes.** Keying batch artifacts by phase and member id/rev, retaining only the keys each composition used, measured 940 ms without the cache against 943 ms with it — the three activation passes see genuinely different batch membership, so almost nothing is reused. Reverted rather than kept: the invalidation reasoning is not free, and it bought nothing.

**`NODE_COMPILE_CACHE` for the child host.** V8 code caching addressed the wrong cost. The ESM module graph load was only 30–34 ms of the boot, and enabling the cache measured 2738 → 2806 ms.

**Defer composition past `ready`.** The renderer fetches these batches on its first page load, so moving the work later moves the wait into first paint instead of removing it. The composition itself had to get cheaper.

**Keep the raw bundle on the record and cache the prepared bytes beside it.** Retaining both doubles the retained bytes for every plugin. Nothing outside `comboSegment` read `record.bundle`, so replacing the field was the smaller change and the smaller footprint.

**Skip the per-record combos entirely.** The single-entry combo URLs are advertised in the graph and fetched for individually revised plugins under HMR; dropping them would change what the registry serves. Memoizing them preserves the served set.

## Consequences

Cold desktop startup reaches `ready` 1.8 s sooner, and the same composition path serves the Web profile's first page load. Client bundle bytes now live on records as prepared segments, so a future reader wanting the unmodified artifact must read it from `meta.clientPath` rather than the record. Records with no authored source map retain their decoded text; those with one no longer do, which is the common case.

The benchmark budget is calibrated on an arm64 reference machine through the shared CI time scale, and is a source constant no environment variable overrides. Composition is measured in isolation, so it neither proves nor covers browser transport, paint, or scrolling for these bundles.

Remaining boot cost, ranked, after this change: `buildCombo`'s per-combo source-map JSON assembly (~125 ms self), the crypto `update` over composed bytes (~46 ms), and Node's own module compilation (~90 ms). None was addressed here.
