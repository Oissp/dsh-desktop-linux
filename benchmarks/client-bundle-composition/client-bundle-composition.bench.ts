/** Required performance budget for composing every client bundle a first page load fetches. */

import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  runBuiltBenchmarkWorker,
  type BuiltBenchmarkWorkerRun,
} from '../support/built-worker.ts'
import { ciTimeBudget, PERFORMANCE_BUDGET_HEADROOM } from '../support/calibration.ts'
import type { ClientBundleCompositionWorkerReport } from './client-bundle-composition.worker.ts'

/** Packages contributing a browser bundle, matching a shipped Web profile's client corpus. */
const PACKAGES = 70
/** Generated lines per bundle; 1,400 reaches the ~165 KB median of a shipped client bundle. */
const LINES_PER_BUNDLE = 1_400
/** Fresh processes; the median enforces the timing budget. */
const ATTEMPTS = 5
/** A stuck composition worker is reaped before the outer benchmark deadline. */
const WORKER_TIMEOUT_MS = 60_000

/**
 * Reference-machine composition of 70 bundles / 11.7 MB. Per-code-point newline
 * counting plus re-encoding each bundle for every combo measured 140 ms on the
 * same corpus, so this budget rejects a return to that composition cost.
 */
const EXPECTED_COMPOSE_MS = 45
const COMPOSE_BUDGET_MS = ciTimeBudget(EXPECTED_COMPOSE_MS)
/** Retained heap with the registry and its served artifacts still reachable. */
const EXPECTED_RETAINED_HEAP_MB = 8.2
const RETAINED_HEAP_BUDGET_MB = Math.ceil(EXPECTED_RETAINED_HEAP_MB * PERFORMANCE_BUDGET_HEADROOM)

const WORKER = join(
  import.meta.dirname,
  '..',
  '.dsh-build',
  'client-bundle-composition',
  'client-bundle-composition.worker.js',
)

function requireReport(
  run: BuiltBenchmarkWorkerRun<ClientBundleCompositionWorkerReport>,
): ClientBundleCompositionWorkerReport {
  if (run.report !== undefined) return run.report
  throw new Error(
    `client-bundle-composition worker failed: exit=${String(run.exitCode)}, `
    + `signal=${String(run.signal)}, timedOut=${String(run.timedOut)}\n`
    + run.stderr.trim().split('\n').slice(-10).join('\n'),
  )
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] as number
}

describe('composition calibration', () => {
  it('rejects the recorded per-code-point and per-combo re-encoding cost', () => {
    const regressionMedian = median([172.7, 134.2, 140.1])
    expect(regressionMedian).toBe(140.1)
    expect(regressionMedian).toBeGreaterThan(COMPOSE_BUDGET_MS)
    expect(median([44.5, 43.1, 45, 44.4, 42.6])).toBeLessThanOrEqual(COMPOSE_BUDGET_MS)
  })
})

describe('composing every client bundle for a first page load', () => {
  it(`composes ${String(PACKAGES)} bundles within ${String(COMPOSE_BUDGET_MS)} ms`, async () => {
    const reports: ClientBundleCompositionWorkerReport[] = []
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      reports.push(requireReport(await runBuiltBenchmarkWorker<ClientBundleCompositionWorkerReport>({
        worker: WORKER,
        args: [String(PACKAGES), String(LINES_PER_BUNDLE)],
        timeoutMs: WORKER_TIMEOUT_MS,
        exposeGc: true,
      })))
    }
    const first = reports[0] as ClientBundleCompositionWorkerReport
    const composeSamples = reports.map(report => report.composeMs)
    const retainedSamples = reports.map(report => report.retainedHeapMb)
    console.log(JSON.stringify({
      benchmark: 'client-bundle-composition/first-page-load',
      packages: first.packages,
      bundleBytes: first.bundleBytes,
      bundleLines: first.bundleLines,
      sourceMapBytes: first.sourceMapBytes,
      batchScriptBytes: first.batchScriptBytes,
      composeMs: { samples: composeSamples, median: median(composeSamples) },
      retainedHeapMb: { samples: retainedSamples, median: median(retainedSamples) },
      budgetMs: COMPOSE_BUDGET_MS,
      retainedHeapBudgetMb: RETAINED_HEAP_BUDGET_MB,
    }))
    // Every advertised bundle reaches the batches a first page load fetches.
    expect(first.entries).toBe(PACKAGES)
    expect(first.batchScriptBytes).toBeGreaterThanOrEqual(first.bundleBytes)
    expect(median(composeSamples)).toBeLessThanOrEqual(COMPOSE_BUDGET_MS)
    expect(median(retainedSamples)).toBeLessThanOrEqual(RETAINED_HEAP_BUDGET_MB)
  })
})
