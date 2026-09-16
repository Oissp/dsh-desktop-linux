/** Reconcile the bundled native require-builtin loader's Electron profile table with the packaged Electron build. */

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Runtime identity an Electron binary reports under ELECTRON_RUN_AS_NODE.
 * The native require-builtin loader admits a runtime only when its Node.js
 * version triple and V8 version string equal a recorded Electron profile.
 */
export interface ElectronRuntimeFingerprint {
  /** Full Electron version, e.g. `44.3.0`. */
  readonly electron: string
  /** Node.js version reported by the Electron build, e.g. `[24, 20, 0]`. */
  readonly node: readonly [number, number, number]
  /** Full V8 version string, e.g. `15.2.124.19-electron.0`. */
  readonly v8: string
}

/** Version text accepted for the Electron and Node.js components. */
const RUNTIME_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:\.\d+)?(?:[-+].*)?$/u

/** V8 version string emitted by Electron builds, e.g. `15.2.124.19-electron.0`. */
const ELECTRON_V8_PATTERN = /^\d+(?:\.\d+)+-electron\.\d+$/u

/** V8 version strings as they appear inside a native loader binary (NUL-terminated). */
const BINARY_V8_PATTERN = /\d+(?:\.\d+)+-electron\.\d+/gu

/** Electron version text recorded in a native loader profile, e.g. `44.0.0` or `45.0.0-alpha.6`. */
const PROFILE_ELECTRON_PATTERN = /^\d+\.\d+\.\d+\S*$/u

/**
 * One recorded Electron profile inside the native loader binary. The binary
 * stores a fixed-stride table of these records; each holds two length-prefixed
 * string references plus the Node.js version triple the loader compares against
 * the running runtime. The Electron version text is diagnostic-only.
 */
interface NativeElectronProfile {
  /** Byte offset of the record inside the binary. */
  readonly offset: number
  /** Electron version text recorded for display, e.g. `44.0.0`. */
  readonly electronVersion: string
  /** Node.js version triple the loader compares against the running runtime. */
  readonly node: readonly [number, number, number]
  /** Byte offset of the recorded V8 version text. */
  readonly v8Offset: number
  /** Recorded V8 version text, e.g. `15.2.124.13-electron.0`. */
  readonly v8: string
}

/** Fixed record stride inside the native loader's profile table. */
const PROFILE_STRIDE = 0x38

/**
 * Parse a `process.versions` record into an Electron runtime fingerprint.
 * @param versions - `process.versions` contents reported by the Electron binary.
 * @returns The extracted Electron, Node.js, and V8 identity.
 */
export function parseElectronRuntimeFingerprint(
  versions: Readonly<Record<string, unknown>>,
): ElectronRuntimeFingerprint {
  const electron = versions['electron']
  const node = versions['node']
  const v8 = versions['v8']
  if (typeof electron !== 'string' || !RUNTIME_VERSION_PATTERN.test(electron)) {
    throw new Error(`native electron fingerprint: malformed Electron version ${JSON.stringify(electron)}`)
  }
  if (typeof v8 !== 'string' || !ELECTRON_V8_PATTERN.test(v8)) {
    throw new Error(`native electron fingerprint: V8 version ${JSON.stringify(v8)} is not an Electron build`)
  }
  if (typeof node !== 'string') {
    throw new Error(`native electron fingerprint: malformed Node.js version ${JSON.stringify(node)}`)
  }
  const components = node.split('.').map(component => Number(component))
  if (components.length < 3 || components.slice(0, 3).some(component => !Number.isInteger(component) || component < 0)) {
    throw new Error(`native electron fingerprint: malformed Node.js version ${JSON.stringify(node)}`)
  }
  return { electron, node: [components[0] ?? 0, components[1] ?? 0, components[2] ?? 0], v8 }
}

/**
 * Probe one Electron binary for its runtime fingerprint.
 * @param electronExecutable - Path to an `electron` executable.
 * @returns The identity the binary reports under `ELECTRON_RUN_AS_NODE`.
 */
export function readElectronRuntimeFingerprint(electronExecutable: string): ElectronRuntimeFingerprint {
  const stdout = execFileSync(
    electronExecutable,
    ['-e', 'process.stdout.write(JSON.stringify(process.versions))'],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 120_000 },
  )
  return parseElectronRuntimeFingerprint(JSON.parse(stdout) as Readonly<Record<string, unknown>>)
}

/**
 * Rewrite the native loader's Electron profile table so it admits the packaged Electron build.
 *
 * The loader keeps a fixed-stride table of Electron profiles and matches the running
 * runtime by exact Node.js version triple plus V8 version string. When the packaged
 * Electron build updates either component within one Electron major (a patch-level
 * Node.js or V8 backport), the recorded profile no longer matches and every native
 * load fails at boot. This rewrites the matching profile's recorded values in place;
 * the profile's Electron version text and embedder-data tag stay untouched because
 * the loader does not compare them and the tag must keep describing the Electron major.
 * @param runtimeRoot - Materialized runtime tree whose `node_modules` carries the loader.
 * @param fingerprint - Identity of the Electron build the runtime ships with.
 * @returns Paths of the binaries whose recorded profiles were rewritten.
 */
export function patchNativeElectronFingerprint(
  runtimeRoot: string, fingerprint: ElectronRuntimeFingerprint,
): readonly string[] {
  const binaries = findNativeLoaderBinaries(join(runtimeRoot, 'node_modules'))
  if (binaries.length === 0) {
    throw new Error(`native electron fingerprint: no node-addon-require-builtin prebuilt binary under ${runtimeRoot}/node_modules`)
  }
  const major = fingerprint.electron.split('.')[0] ?? ''
  const patched: string[] = []
  for (const binary of binaries) {
    const data = readFileSync(binary)
    const profile = selectNativeElectronProfile(data, major, binary)
    if (profile === undefined) continue
    if (!rewriteNativeElectronProfile(data, profile, fingerprint)) continue
    writeFileSync(binary, data)
    patched.push(binary)
  }
  return patched
}

/**
 * Prove the packaged loader admits the packaged Electron build by loading it under
 * that Electron and resolving every internal module the dsh profile resolver needs.
 * @param runtimeRoot - Materialized runtime tree whose `node_modules` carries the loader.
 * @param electronExecutable - Path to the packaged Electron executable.
 */
export function verifyNativeElectronFingerprint(runtimeRoot: string, electronExecutable: string): void {
  const smoke = join(import.meta.dirname, '..', 'tests', 'fixtures', 'native-electron-fingerprint-smoke.mjs')
  execFileSync(electronExecutable, [smoke, runtimeRoot], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    timeout: 120_000,
  })
}

function selectNativeElectronProfile(
  data: Buffer, major: string, binary: string,
): NativeElectronProfile | undefined {
  const profiles = readNativeElectronProfiles(data)
  if (profiles.length === 0) {
    throw new Error(`native electron fingerprint: no Electron profile table recognized in ${binary}`)
  }
  const profile = profiles.find(candidate => candidate.electronVersion.startsWith(`${major}.`))
  if (profile === undefined) {
    const known = profiles.map(candidate => candidate.electronVersion).join(', ')
    throw new Error(`native electron fingerprint: the bundled node-addon-require-builtin records Electron ${known} but not ${major}.x; update the dependency or retire the fingerprint patcher`)
  }
  return profile
}

function rewriteNativeElectronProfile(
  data: Buffer, profile: NativeElectronProfile, fingerprint: ElectronRuntimeFingerprint,
): boolean {
  if (profile.node[0] === fingerprint.node[0] && profile.node[1] === fingerprint.node[1]
    && profile.node[2] === fingerprint.node[2] && profile.v8 === fingerprint.v8) {
    return false
  }
  const replacement = Buffer.from(fingerprint.v8, 'latin1')
  if (replacement.length !== Buffer.byteLength(profile.v8, 'latin1')) {
    throw new Error(`native electron fingerprint: recorded V8 version ${profile.v8} differs in length from ${fingerprint.v8}; in-place rewriting cannot apply`)
  }
  data.writeUInt32LE(fingerprint.node[0] ?? 0, profile.offset + 0x10)
  data.writeUInt32LE(fingerprint.node[1] ?? 0, profile.offset + 0x14)
  data.writeUInt32LE(fingerprint.node[2] ?? 0, profile.offset + 0x18)
  replacement.copy(data, profile.v8Offset)
  const reread = readNativeElectronProfile(data, profile.offset, profile.v8Offset, fingerprint.v8)
  if (reread === undefined
    || reread.node[0] !== fingerprint.node[0] || reread.node[1] !== fingerprint.node[1] || reread.node[2] !== fingerprint.node[2]) {
    throw new Error(`native electron fingerprint: rewriting the Electron ${profile.electronVersion} profile in place did not produce the recorded fingerprint`)
  }
  return true
}

function readNativeElectronProfiles(data: Buffer): NativeElectronProfile[] {
  const text = data.toString('latin1')
  const profiles: NativeElectronProfile[] = []
  const seen = new Set<number>()
  for (const match of text.matchAll(BINARY_V8_PATTERN)) {
    const v8 = match[0]
    if (v8 === undefined) continue
    const v8Offset = match.index
    if (v8Offset === undefined) continue
    const pointer = Buffer.alloc(8)
    pointer.writeBigUInt64LE(BigInt(v8Offset))
    for (let slot = data.indexOf(pointer); slot !== -1; slot = data.indexOf(pointer, slot + 1)) {
      const offset = slot - 0x28
      if (offset < 0 || seen.has(offset)) continue
      const profile = readNativeElectronProfile(data, offset, v8Offset, v8)
      if (profile === undefined) continue
      seen.add(offset)
      profiles.push(profile)
    }
  }
  return profiles
}

function readNativeElectronProfile(
  data: Buffer, offset: number, v8Offset: number, v8: string,
): NativeElectronProfile | undefined {
  if (offset + PROFILE_STRIDE > data.length) return undefined
  if (data.readBigUInt64LE(offset + 0x20) !== BigInt(v8.length)) return undefined
  if (data.readBigUInt64LE(offset + 0x28) !== BigInt(v8Offset)) return undefined
  const electronOffsetValue = data.readBigUInt64LE(offset + 0x08)
  const electronLengthValue = data.readBigUInt64LE(offset)
  const electronOffset = Number(electronOffsetValue)
  const electronLength = Number(electronLengthValue)
  if (electronOffset + electronLength > data.length) return undefined
  const electronVersion = data.subarray(electronOffset, electronOffset + electronLength).toString('latin1')
  if (!PROFILE_ELECTRON_PATTERN.test(electronVersion)) return undefined
  const nodeMajor = data.readUInt32LE(offset + 0x10)
  const nodeMinor = data.readUInt32LE(offset + 0x14)
  const nodePatch = data.readUInt32LE(offset + 0x18)
  if (nodeMajor > 99 || nodeMinor > 99 || nodePatch > 99) return undefined
  return { offset, electronVersion, node: [nodeMajor, nodeMinor, nodePatch], v8Offset, v8 }
}

function findNativeLoaderBinaries(modulesRoot: string): string[] {
  const binaries: string[] = []
  const visit = (directory: string, depth: number): void => {
    if (depth > 12) return
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(path, depth + 1)
      } else if (entry.isFile() && entry.name.endsWith('.node') && isNativeLoaderBinary(modulesRoot, path)) {
        binaries.push(path)
      }
    }
  }
  visit(modulesRoot, 0)
  return binaries.sort()
}

function isNativeLoaderBinary(modulesRoot: string, path: string): boolean {
  const segments = relative(modulesRoot, path).split(/[\\/]/u)
  return segments.at(-2) === 'prebuilt'
    && (segments.at(-3)?.startsWith('node-addon-require-builtin-') ?? false)
}
