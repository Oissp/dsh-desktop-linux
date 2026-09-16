/**
 * Load the packaged native require-builtin loader under the packaged Electron runtime
 * and resolve every internal module the dsh profile resolver requires. Run with
 * `ELECTRON_RUN_AS_NODE=1 electron native-electron-fingerprint-smoke.mjs <runtime-root>`;
 * a non-zero exit means the loader refuses the runtime fingerprint or its exports.
 */

import { createRequire } from 'node:module'
import { join } from 'node:path'

const runtimeRoot = process.argv[2]
if (runtimeRoot === undefined) {
  console.error('usage: electron native-electron-fingerprint-smoke.mjs <runtime-root>')
  process.exit(1)
}

const requireFromRuntime = createRequire(join(runtimeRoot, 'package.json'))
let addon
try {
  addon = requireFromRuntime('node-addon-require-builtin')
} catch (error) {
  console.error(`native electron fingerprint smoke: the runtime tree provides no node-addon-require-builtin: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}

let esmLoader
try {
  esmLoader = addon.requireBuiltin('internal/modules/esm/loader').getOrInitializeCascadedLoader()
} catch (error) {
  console.error(`native electron fingerprint smoke: the loader refused the runtime fingerprint: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}

// Mirrors the export checks in the dsh profile resolver's internalModules(): every
// internal module below must expose the members the resolver calls.
const modern = 'getOrCreateModuleJob' in esmLoader
const failures = []
if (typeof esmLoader.resolveSync !== 'function') failures.push('esm loader resolveSync')
if (typeof Reflect.get(esmLoader, modern ? 'getOrCreateModuleJob' : 'getModuleJobForImport') !== 'function') failures.push('esm loader module job')
if (!modern && typeof Reflect.get(esmLoader, 'resolve') !== 'function') failures.push('esm loader resolve')
if (typeof addon.requireBuiltin('internal/modules/cjs/loader').Module._resolveFilename !== 'function') failures.push('cjs loader Module._resolveFilename')
if (typeof addon.requireBuiltin('internal/modules/helpers').getCjsConditions !== 'function') failures.push('module helpers getCjsConditions')
if (typeof addon.requireBuiltin('internal/modules/esm/utils').getDefaultConditions !== 'function') failures.push('esm utils getDefaultConditions')
if (typeof addon.requireBuiltin('internal/modules/esm/resolve').defaultResolve !== 'function') failures.push('esm resolve defaultResolve')
if (failures.length > 0) {
  console.error(`native electron fingerprint smoke: missing internal module exports: ${failures.join(', ')}`)
  process.exit(1)
}

console.log(`native electron fingerprint smoke: ok under Electron ${process.versions.electron} (Node ${process.versions.node}, V8 ${process.versions.v8})`)
