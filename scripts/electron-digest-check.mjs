// AC3 gate for #101 — proves the pairing fingerprint digest works under Electron's BoringSSL runtime,
// which vitest structurally cannot: vitest runs under full-OpenSSL Node (where `blake2s256` exists),
// so it can never catch the BoringSSL divergence that broke pairing in the built app.
//
// Run it under Electron's own runtime:
//   npm run check:electron-digest        (ELECTRON_RUN_AS_NODE=1 electron scripts/electron-digest-check.mjs)
//
// Two parts:
//   1. INFORMATIONAL — document WHY node:crypto is unusable here: show that
//      `createHash('blake2s256')` throws under BoringSSL and that no blake hash is listed. This is the
//      reproduction from the issue body, now proving the fix's premise in-runtime.
//   2. GATING — compute the fingerprint of a 32-zero-byte key via @noble/hashes with the SAME
//      derive+format as deriveFingerprint (pairingConfirmation.ts) and assert it equals the daemon
//      vector. Exit non-zero on mismatch or any throw; exit 0 on match.
import { createHash, getHashes } from 'node:crypto'
import { blake2s } from '@noble/hashes/blake2'

// The daemon's internal/pair.Fingerprint of the all-zero 32-byte key: BLAKE2s-256(0^32)[:8] as
// colon-separated lowercase hex. Same literal the vitest parity test pins.
const EXPECTED = '32:0b:5e:a9:9e:65:3b:c2'
const DIGEST_BYTES = 32
const FINGERPRINT_BYTES = 8

// --- Part 1: informational — node:crypto blake2s256 under this runtime -------------------------
const blakeHashes = getHashes().filter((h) => h.includes('blake'))
console.log('crypto.getHashes() blake entries:', JSON.stringify(blakeHashes))
try {
  createHash('blake2s256').update(Buffer.alloc(32)).digest()
  console.log("node:crypto createHash('blake2s256'): OK (full-OpenSSL runtime — e.g. plain Node)")
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  console.log(`node:crypto createHash('blake2s256'): throws — "${message}" (BoringSSL has no BLAKE2)`)
  console.log('  → this is exactly why the fingerprint uses @noble/hashes, not node:crypto.')
}

// --- Part 2: gating — @noble/hashes fingerprint must match the daemon vector --------------------
function deriveFingerprint(keyBytes) {
  const digest = blake2s(keyBytes, { dkLen: DIGEST_BYTES })
  return Array.from(digest.subarray(0, FINGERPRINT_BYTES))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join(':')
}

try {
  const actual = deriveFingerprint(new Uint8Array(DIGEST_BYTES))
  if (actual !== EXPECTED) {
    console.error(`FAIL: fingerprint ${actual} !== expected ${EXPECTED}`)
    process.exit(1)
  }
  console.log(`OK: @noble/hashes fingerprint under Electron = ${actual} (matches daemon vector)`)
  process.exit(0)
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`FAIL: @noble/hashes blake2s threw under Electron — "${message}"`)
  process.exit(1)
}
