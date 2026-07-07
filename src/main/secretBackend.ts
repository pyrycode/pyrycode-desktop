// The test/dev-only secret-encryption affordance (#99), quarantined to its own module so the
// production chain (secureStore.ts, electronSecretEncryption.ts, the persistence layer) stays free of
// any dev/keychain-free/env code. It answers ONE question — "which SecretEncryption backend should
// the secret store use?" — and is the only place a keychain-free backend can ever be selected.
// Everything here is pure and synchronous; `selectSecretEncryption` runs ONCE at the composition root
// (index.ts) producing the immutable backend captured by the store. Nothing here reads
// `app.isPackaged` or `process.env` itself — the effectful choice is passed in, so this module unit-
// tests with plain values (mirroring relayPolicy.ts, and keeping this module free of any `electron`
// import so the whole test file runs in plain Node).
//
// The relaxation is bounded on two independent axes, BOTH required simultaneously: (1) `!isPackaged`
// — a deterministic code gate checked false-first, so a packaged build never even reads the flag and
// its secret backend is byte-identical to today; (2) an explicit env opt-in equal to exactly `'1'`.
//
// The real backend is INJECTED as a lazily-called factory `real: () => SecretEncryption` rather than
// imported: electronSecretEncryption.ts is the only module that imports `electron`, so a static
// import here would drag `electron` into every unit test. Passing the factory also means it is never
// even called on the dev path — the keychain-free backend is chosen without constructing the real one.
import type { SecretEncryption } from './secureStore'

/**
 * The environment variable that opts a non-packaged build into the keychain-free backend. Single-
 * sourced here so a rename is one edit; #93 sets this exact var when driving the built app headless.
 * Honest name: it selects a test-only secret backend, nothing more. Analog of #97's
 * LOOPBACK_RELAY_ENV_FLAG.
 */
export const TEST_SECRET_BACKEND_ENV_FLAG = 'PYRY_TEST_SECRET_BACKEND'

// A fixed marker byte + XOR key for the keychain-free transform (mirroring the secureStore.test.ts
// fakeEncryption idiom). NOT cryptographic — the ciphertext is trivially reversible. Its only jobs
// are to round-trip within a run and to be observably different from the plaintext, so a stored blob
// is never raw plaintext. Distinct from any real key; never selected in a packaged build.
const MARKER = 0xa9
const XOR_KEY = 0x3c

/**
 * Module-private — the affordance's guts are not importable elsewhere (mirrors loopbackDevRelayPolicy).
 * A deterministic, reversible, byte-blind transform with `isAvailable() === true`, so `secureStore.set`
 * no longer fails closed on the dev path. Prefixes a marker byte then XORs each payload byte, returning
 * a FRESH Uint8Array (never the input) whose bytes differ from the plaintext. Stateless: no per-instance
 * or module-level mutable state, so a blob encrypted by one selection decrypts on any other.
 *
 * NOT cryptography, and deliberately NOT the Linux `basic_text` fallback (which the real backend
 * rejects precisely because it masquerades as available in production) — this is a separate dev-only
 * module reachable only through the gate, never in a shipped build.
 */
const keychainFreeSecretEncryption = (): SecretEncryption => ({
  isAvailable: () => true,
  encrypt(plaintext) {
    const out = new Uint8Array(plaintext.length + 1)
    out[0] = MARKER
    for (let i = 0; i < plaintext.length; i += 1) out[i + 1] = plaintext[i] ^ XOR_KEY
    return out
  },
  decrypt(ciphertext) {
    if (ciphertext.length < 1 || ciphertext[0] !== MARKER) {
      throw new Error('keychain-free decrypt: not a ciphertext this backend produced')
    }
    const out = new Uint8Array(ciphertext.length - 1)
    for (let i = 1; i < ciphertext.length; i += 1) out[i - 1] = ciphertext[i] ^ XOR_KEY
    return out
  }
})

/**
 * The deterministic, `isPackaged`-false-first gate — belt-and-suspenders "different fabric" (code, not
 * config). When packaged, the env flag is NEVER read, so a shipped build's secret backend is byte-
 * identical to today regardless of environment (AC3). Opt-in is exact: only the string `'1'` selects
 * the keychain-free backend — an unset var, empty string, `'0'`, or `'true'` all resolve to `real()`.
 * The real backend is called (constructed) only on the paths that return it — never on the dev path.
 */
export function selectSecretEncryption(opts: {
  isPackaged: boolean
  env: Record<string, string | undefined>
  real: () => SecretEncryption
}): SecretEncryption {
  if (opts.isPackaged) return opts.real()
  if (opts.env[TEST_SECRET_BACKEND_ENV_FLAG] === '1') return keychainFreeSecretEncryption()
  return opts.real()
}
