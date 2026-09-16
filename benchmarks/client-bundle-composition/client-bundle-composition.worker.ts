/** Compiled worker for the client-bundle composition benchmark. */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { ClientModuleRegistry } from '@deepseek-ai/dsh-client-modules'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { assertBuiltBenchmarkRuntime } from '../support/built-worker.ts'
import { writeSyntheticClientPackages } from './synthetic-client-packages.ts'

/** Composition cost and served-artifact totals from one measured activation. */
export interface ClientBundleCompositionWorkerReport {
  readonly packages: number
  readonly bundleBytes: number
  readonly bundleLines: number
  readonly sourceMapBytes: number
  /** Registry construction: read every bundle, compose the graph, build every artifact. */
  readonly composeMs: number
  /** Bytes of the batch scripts a first page load fetches. */
  readonly batchScriptBytes: number
  /** Entries the composed graph advertises. */
  readonly entries: number
  /** Retained heap after composition, with the registry still reachable. */
  readonly retainedHeapMb: number
}

/** Loader row shape the registry scans; the benchmark supplies enabled rows only. */
function loaderEntries(names: readonly string[], baseUrl: string) {
  return function* entries() {
    for (const name of names) {
      yield {
        options: { name },
        fiber: {},
        disabled: false,
        parent: { tree: { ctx: { baseUrl } } },
      }
    }
  }
}

/** Compose one corpus through the production registry and report its cost. */
async function compose(root: string, names: readonly string[]): Promise<{
  readonly composeMs: number
  readonly batchScriptBytes: number
  readonly entries: number
  readonly registry: ClientModuleRegistry
}> {
  const ctx = new Context()
  ctx.baseUrl = `${pathToFileURL(root).href}/`
  ctx.provide('loader', { internal: undefined, entries: loaderEntries(names, ctx.baseUrl) })
  ctx.provide('webServer', {
    port: 0,
    register: () => () => {},
    tapIndex: () => () => {},
  } as unknown as WebServer)
  const started = performance.now()
  const registry = new ClientModuleRegistry(ctx)
  const graph = registry.graph()
  const composeMs = performance.now() - started
  let batchScriptBytes = 0
  for (const batch of graph.batches) {
    const response = await registry.fetchBundle(new Request(`http://dsh.invalid${batch.url}`))
    if (response.status !== 200) throw new Error(`batch ${batch.url} was not served`)
    batchScriptBytes += (await response.bytes()).byteLength
  }
  return { composeMs, batchScriptBytes, entries: graph.entries.length, registry }
}

function positiveInteger(value: string | undefined, label: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`)
  return parsed
}

assertBuiltBenchmarkRuntime(import.meta.url, {
  '@deepseek-ai/dsh-client-modules': import.meta.resolve('@deepseek-ai/dsh-client-modules'),
})
const [packagesValue, linesValue] = process.argv.slice(2)
const shape = {
  packages: positiveInteger(packagesValue, 'packages'),
  linesPerBundle: positiveInteger(linesValue, 'lines per bundle'),
}
const root = mkdtempSync(join(tmpdir(), 'dsh-client-bundle-bench-'))
try {
  const corpus = writeSyntheticClientPackages(root, shape)
  const measured = await compose(root, corpus.names)
  globalThis.gc?.()
  const report: ClientBundleCompositionWorkerReport = {
    packages: corpus.packages,
    bundleBytes: corpus.bundleBytes,
    bundleLines: corpus.bundleLines,
    sourceMapBytes: corpus.sourceMapBytes,
    composeMs: Math.round(measured.composeMs * 10) / 10,
    batchScriptBytes: measured.batchScriptBytes,
    entries: measured.entries,
    retainedHeapMb: Math.round((process.memoryUsage().heapUsed / 1_048_576) * 10) / 10,
  }
  // The registry stays reachable across the retained-heap read.
  if (measured.registry.graph().entries.length !== report.entries) throw new Error('graph changed')
  process.stdout.write(`${JSON.stringify(report)}\n`)
} finally {
  rmSync(root, { recursive: true, force: true })
}
