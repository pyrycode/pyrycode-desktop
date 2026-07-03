// The device static Noise keypair: generate-once, persist, retrieve. The desktop client's stable
// cryptographic identity — the initiator static key for the Noise_IK handshake — held across
// launches (#43). Launch 1 generates + persists; every later launch reads the persisted pair.
//
// This is the PURE CORE: it imports no effectful dependency (no `electron`, no `fs`, no
// `noise-c.wasm`) — only the TYPE of SecureStore. Both effectful edges are injected:
//   - persistence: SecureStore (#42, src/main/secureStore.ts) — encrypt-at-rest via safeStorage,
//     fail-closed. The keypair is serialized to bytes and stored by name THROUGH this surface;
//     this module never touches safeStorage or the filesystem directly (ADR 0005).
//   - X25519 keygen: KeyPairGenerator — the production impl wraps noise-c.wasm's CreateKeyPair
//     (noiseKeyPairGenerator.ts); tests fake it. Using the SAME library the handshake uses keeps
//     the persisted key format handshake-compatible by construction (#29).
// The isolation makes "the AC tests run with no keychain, no filesystem, no wasm" structural.
//
// It lives entirely in src/main — the private key and raw key bytes never reach the renderer,
// preload, or IPC (CLAUDE.md "Keep the transport out of the window"; ADR 0002). It is LOG-FREE by
// construction: no console.* anywhere; keys are opaque Uint8Array locals, never logged.
import type { SecureStore } from './secureStore'

/** Each X25519 key is exactly 32 bytes; the serialized blob is priv‖pub = 64 bytes. */
const KEY_LENGTH = 32
const BLOB_LENGTH = KEY_LENGTH * 2

/**
 * The device static Noise keypair. BOTH keys are MAIN-PROCESS ONLY — they never cross the
 * contextBridge / IPC. A future ticket that surfaces the client identity to the renderer must
 * return only `publicKey`, never the pair.
 */
export interface DeviceKeyPair {
  /** 32-byte X25519 private key — the Noise_IK Initialize `s`, used by the transport. */
  readonly privateKey: Uint8Array
  /** 32-byte X25519 public key — the client static public; pairing + fast startup read. */
  readonly publicKey: Uint8Array
}

/**
 * Injected X25519 keygen seam. The production impl wraps noise-c.wasm's CreateKeyPair (whose keys
 * come from crypto.getRandomValues, a CSPRNG); tests fake it with deterministic bytes.
 */
export interface KeyPairGenerator {
  generate(): Promise<DeviceKeyPair>
}

/**
 * The device-identity accessor. `ensure()` is generate-once: the first call generates + persists,
 * and every later call — this process or a later launch — returns the SAME persisted pair, never a
 * fresh one.
 */
export interface DeviceKeypairStore {
  ensure(): Promise<DeviceKeyPair>
}

/**
 * Thrown when a stored blob is present but is not a valid 64-byte keypair (tamper / format drift).
 * The message is static and carries no key bytes; it lets the consumer branch to a "re-pair"
 * recovery rather than silently regenerating (which would rotate the device identity).
 */
export class MalformedDeviceKeypairError extends Error {
  constructor(message = 'stored device keypair is malformed') {
    super(message)
    this.name = 'MalformedDeviceKeypairError'
  }
}

/**
 * Milestone-1 single-pyrybox store name. Mobile keys per server-id
 * (`pyrycode.device_static.<server-id>`); appending `.${serverId}` is the deferred one-line
 * multi-server change (out of scope here), enabled by keeping this constant explicit.
 */
export const DEVICE_STATIC_KEY_NAME = 'pyrycode.device_static'

/** Serialize the pair to priv‖pub. Throws on a non-32-byte key — a format invariant, not user data. */
function encodeKeyPair(pair: DeviceKeyPair): Uint8Array {
  if (pair.privateKey.length !== KEY_LENGTH || pair.publicKey.length !== KEY_LENGTH) {
    throw new MalformedDeviceKeypairError('device keypair must be two 32-byte keys')
  }
  const blob = new Uint8Array(BLOB_LENGTH)
  blob.set(pair.privateKey, 0)
  blob.set(pair.publicKey, KEY_LENGTH)
  return blob
}

/** Parse a stored blob back into a pair. Throws MalformedDeviceKeypairError unless it is 64 bytes. */
function decodeKeyPair(blob: Uint8Array): DeviceKeyPair {
  if (blob.length !== BLOB_LENGTH) {
    throw new MalformedDeviceKeypairError()
  }
  return {
    privateKey: blob.slice(0, KEY_LENGTH),
    publicKey: blob.slice(KEY_LENGTH, BLOB_LENGTH)
  }
}

/**
 * Build a DeviceKeypairStore over the injected persistence + keygen seams. Generate-once is
 * enforced by (1) a within-process memoized promise that serializes concurrent first-calls and
 * (2) the persisted blob as the source of truth — a fresh process re-reads it rather than
 * regenerating. No path returns an unpersisted or partial pair; errors propagate (fail-loud).
 */
export function createDeviceKeypairStore(deps: {
  secureStore: SecureStore
  generator: KeyPairGenerator
  name?: string
}): DeviceKeypairStore {
  const { secureStore, generator } = deps
  const name = deps.name ?? DEVICE_STATIC_KEY_NAME

  async function load(): Promise<DeviceKeyPair> {
    const blob = await secureStore.get(name)
    // A present blob is the source of truth — decode and return it, never regenerate. A decrypt
    // failure inside get() propagates; a wrong-length blob throws MalformedDeviceKeypairError.
    if (blob !== null) return decodeKeyPair(blob)
    // Absent: generate, persist, then return. If set() rejects (keychain unavailable), the
    // freshly-generated pair is NOT returned — returning an unpersisted pair would break
    // generate-once on the next launch.
    const pair = await generator.generate()
    await secureStore.set(name, encodeKeyPair(pair))
    return pair
  }

  // The lazy-async-singleton: a second (or concurrent) ensure() returns the cached promise, so
  // keygen + persist run at most once per process and the concurrent-first-call race is closed. On
  // rejection the memo is cleared so a later retry (e.g. once the keychain becomes available) can
  // proceed — a transient failure must not poison the store for the process lifetime.
  let memo: Promise<DeviceKeyPair> | null = null
  return {
    ensure() {
      if (memo === null) {
        memo = load().catch((err) => {
          memo = null
          throw err
        })
      }
      return memo
    }
  }
}
