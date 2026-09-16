import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  parseElectronRuntimeFingerprint,
  patchNativeElectronFingerprint,
  type ElectronRuntimeFingerprint,
} from '../scripts/native-electron-fingerprint.ts'

const FIXTURE_FINGERPRINT: ElectronRuntimeFingerprint = {
  electron: '44.3.0', node: [24, 20, 0], v8: '15.2.124.19-electron.0',
}

const TEMP_ROOTS: string[] = []

afterAll(() => {
  for (const root of TEMP_ROOTS) rmSync(root, { recursive: true, force: true })
})

interface BinaryProfileSpec {
  readonly electron: string
  readonly node: readonly [number, number, number]
  readonly v8: string
}

/**
 * Build a binary carrying the native loader's Electron profile table layout:
 * a string area of NUL-terminated texts followed by fixed-stride 0x38 records
 * of {electron version length, pointer, Node.js triple, V8 length, pointer}.
 * Record string pointers hold the string's own file offset.
 */
function buildNativeLoaderBinary(specs: readonly BinaryProfileSpec[]): Buffer {
  const chunks: Buffer[] = []
  let cursor = 0
  const put = (value: string): number => {
    const bytes = Buffer.from(`${value}\0`, 'latin1')
    const start = cursor
    chunks.push(bytes)
    cursor += bytes.length
    return start
  }
  const planned = specs.map(spec => ({ spec, electronOffset: put(spec.electron), v8Offset: put(spec.v8) }))
  const records = planned.map(({ spec, electronOffset, v8Offset }) => {
    const record = Buffer.alloc(0x38)
    record.writeBigUInt64LE(BigInt(spec.electron.length), 0x00)
    record.writeBigUInt64LE(BigInt(electronOffset), 0x08)
    record.writeUInt32LE(spec.node[0] ?? 0, 0x10)
    record.writeUInt32LE(spec.node[1] ?? 0, 0x14)
    record.writeUInt32LE(spec.node[2] ?? 0, 0x18)
    record.writeBigUInt64LE(BigInt(spec.v8.length), 0x20)
    record.writeBigUInt64LE(BigInt(v8Offset), 0x28)
    return record
  })
  return Buffer.concat([...chunks, ...records])
}

function writeRuntimeTree(binaries: readonly Buffer[]): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-native-fingerprint-'))
  TEMP_ROOTS.push(root)
  for (const [index, binary] of binaries.entries()) {
    const directory = join(root, 'node_modules', `node-addon-require-builtin-linux-x64-gnu-${index}`, 'prebuilt')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'loader.node'), binary)
  }
  return root
}

/** Read back the first profile record whose V8 version text matches. */
function readRecord(binary: Buffer, v8: string): { electron: string; node: readonly [number, number, number] } {
  const text = binary.toString('latin1')
  const start = text.indexOf(`${v8}\0`)
  expect(start).toBeGreaterThanOrEqual(0)
  const pointer = Buffer.alloc(8)
  pointer.writeBigUInt64LE(BigInt(start))
  const slot = binary.indexOf(pointer)
  expect(slot).toBeGreaterThanOrEqual(0)
  const offset = slot - 0x28
  const electronOffset = Number(binary.readBigUInt64LE(offset + 0x08))
  const electronLength = Number(binary.readBigUInt64LE(offset))
  return {
    electron: binary.subarray(electronOffset, electronOffset + electronLength).toString('latin1'),
    node: [
      binary.readUInt32LE(offset + 0x10),
      binary.readUInt32LE(offset + 0x14),
      binary.readUInt32LE(offset + 0x18),
    ],
  }
}

describe('parse electron runtime fingerprint', () => {
  it('extracts the Electron identity from a process.versions record', () => {
    expect(parseElectronRuntimeFingerprint({
      node: '24.20.0', v8: '15.2.124.19-electron.0', electron: '44.3.0', chrome: '152.0.7977.78',
    })).toEqual(FIXTURE_FINGERPRINT)
  })

  it('rejects records that are not Electron runtimes or carry malformed versions', () => {
    expect(() => parseElectronRuntimeFingerprint({ node: '24.20.0', v8: '15.2.124.19', electron: '44.3.0' }))
      .toThrow(/not an Electron build/u)
    expect(() => parseElectronRuntimeFingerprint({ node: '24.20.0', v8: '15.2.124.19-electron.0' }))
      .toThrow(/malformed Electron version/u)
    expect(() => parseElectronRuntimeFingerprint({ node: '24.20', v8: '15.2.124.19-electron.0', electron: '44.3.0' }))
      .toThrow(/malformed Node/u)
  })
})

describe('patch native electron fingerprint', () => {
  const PUBLISHED_PROFILES: readonly BinaryProfileSpec[] = [
    { electron: '43.0.0', node: [24, 17, 0], v8: '15.0.245.13-electron.0' },
    { electron: '44.0.0', node: [24, 18, 1], v8: '15.2.124.13-electron.0' },
    { electron: '45.0.0-alpha.6', node: [24, 21, 0], v8: '15.4.80-electron.0' },
  ]

  it('rewrites the matching Electron major to the packaged fingerprint', () => {
    const root = writeRuntimeTree([buildNativeLoaderBinary(PUBLISHED_PROFILES)])
    const [binary] = patchNativeElectronFingerprint(root, FIXTURE_FINGERPRINT)
    expect(binary).toContain('node-addon-require-builtin-linux-x64-gnu-0')
    const record = readRecord(readFileSync(binary ?? ''), '15.2.124.19-electron.0')
    expect(record).toEqual({ electron: '44.0.0', node: [24, 20, 0] })
    expect(readRecord(readFileSync(binary ?? ''), '15.0.245.13-electron.0').node).toEqual([24, 17, 0])
    expect(readRecord(readFileSync(binary ?? ''), '15.4.80-electron.0').node).toEqual([24, 21, 0])
  })

  it('leaves the table alone once it already records the packaged fingerprint', () => {
    const patched = buildNativeLoaderBinary(PUBLISHED_PROFILES.toSpliced(1, 1, {
      electron: '44.0.0', node: [24, 20, 0], v8: '15.2.124.19-electron.0',
    }))
    const root = writeRuntimeTree([patched])
    expect(patchNativeElectronFingerprint(root, FIXTURE_FINGERPRINT)).toEqual([])
  })

  it('rewrites every candidate binary in the tree', () => {
    const root = writeRuntimeTree([
      buildNativeLoaderBinary(PUBLISHED_PROFILES),
      buildNativeLoaderBinary(PUBLISHED_PROFILES),
    ])
    expect(patchNativeElectronFingerprint(root, FIXTURE_FINGERPRINT)).toHaveLength(2)
  })

  it('fails loud when no binary, no table, or no matching major exists', () => {
    const emptyRoot = writeRuntimeTree([])
    expect(() => patchNativeElectronFingerprint(emptyRoot, FIXTURE_FINGERPRINT))
      .toThrow(/no node-addon-require-builtin prebuilt binary/u)

    const noTableRoot = writeRuntimeTree([Buffer.alloc(0x100, 0)])
    expect(() => patchNativeElectronFingerprint(noTableRoot, FIXTURE_FINGERPRINT))
      .toThrow(/no Electron profile table recognized/u)

    const otherMajorRoot = writeRuntimeTree([buildNativeLoaderBinary([
      { electron: '43.0.0', node: [24, 17, 0], v8: '15.0.245.13-electron.0' },
    ])])
    expect(() => patchNativeElectronFingerprint(otherMajorRoot, FIXTURE_FINGERPRINT))
      .toThrow(/not 44\.x/u)
  })

  it('fails loud when the recorded V8 version differs in length from the packaged one', () => {
    const root = writeRuntimeTree([buildNativeLoaderBinary([
      { electron: '44.0.0', node: [24, 18, 1], v8: '15.2.124-electron.0' },
    ])])
    expect(() => patchNativeElectronFingerprint(root, FIXTURE_FINGERPRINT))
      .toThrow(/differs in length/u)
  })
})
