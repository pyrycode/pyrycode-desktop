// The desktop's fingerprint-confirm gate. Given a VALIDATED pairing record (the `{ ok: true }`
// QrPayload the paste gate #52 produces), this turns the record's `server_static_pubkey` into a
// short, human-comparable fingerprint and persists the record ONLY through an explicit confirm.
// It is the human-verify step mobile's paste path skipped (mobile #501): before the client trusts
// a pasted server key, the operator eyeballs its fingerprint against what `pyry pair` printed on
// pyrybox (and what the phone shows) and only then confirms. A tampered/wrong key produces a
// fingerprint that will not match, and the operator declines.
//
// The load-bearing shape: `prepare` derives the fingerprint (a pure, synchronous hash) and hands
// back the ONE persist handle bound to exactly the record it fingerprinted; deriving persists
// nothing. There is exactly one `store.save` call site in the whole module — inside the `confirm`
// closure `prepare` builds — and it is unreachable without first calling `prepare`. A malformed key
// yields an `ok: false` arm with NO confirm handle, so it is structurally unpersistable.
//
// It lives entirely in src/main over one injected seam (PairedServerStore): the `token` (a bearer
// credential) and `server_static_pubkey` never reach the renderer, preload, or IPC (CLAUDE.md
// "Keep the transport out of the window"; ADR 0002). Only the fingerprint (a hash) is safe to
// surface, and that surfacing is #54, not here. This module never touches safeStorage, the
// filesystem, or the secure store directly — it calls the injected store's `save`. It is LOG-FREE
// by construction: no console.* anywhere; the record and key are opaque locals, never a reason and
// never a returned field.
// BLAKE2s-256 comes from @noble/hashes, NOT node:crypto. Electron ships BoringSSL, which has no
// BLAKE2 family, so `createHash('blake2s256')` throws `Error: Digest method not supported` in the
// built app (vitest passes only because it runs under full-OpenSSL Node). @noble/hashes is a vetted,
// audited, pure-JS implementation: it computes the identical bytes under Node AND Electron and stays
// synchronous, so `deriveFingerprint`/`prepare` remain sync. The `/blake2` subpath is the
// non-deprecated home of `blake2s` in the installed v1.8.0 (`/blake2s` is JSDoc-deprecated); both
// export the same function — the parity vectors gate byte-identity to the daemon (#101).
import { blake2s } from '@noble/hashes/blake2'
import type { PairedServerRecord, PairedServerStore } from './pairedServerStore'

/**
 * Why fingerprint derivation rejected a record. Value-free category strings — carry no field value,
 * safe to surface to the operator (in #54). The paste gate (#52) treats `server_static_pubkey` as
 * an opaque non-empty string; this service is the FIRST place its base64/32-byte shape is checked.
 */
export type FingerprintRejectReason =
  | 'pubkey-not-base64' // server_static_pubkey is not canonical standard (padded) base64
  | 'pubkey-wrong-length' // decoded key is not exactly 32 bytes (X25519 public-key width)
  | 'fingerprint-unavailable' // the digest primitive itself failed — distinct from a malformed key

/**
 * Result of preparing a validated record for confirmation. On success carries the display
 * fingerprint plus the ONE persist handle; on failure only a value-free reason (and no confirm, so
 * a rejected key is structurally unpersistable). A discriminated union on `ok`, so a consumer that
 * reads `.confirm`/`.fingerprint` without narrowing on `ok === true` is a compile error.
 */
export type PreparedPairing =
  | { ok: true; fingerprint: string; confirm: () => Promise<void> }
  | { ok: false; reason: FingerprintRejectReason }

/**
 * The confirm gate. `prepare` derives the fingerprint and returns a confirm handle bound to the
 * exact record fingerprinted; it persists NOTHING on its own. The returned object exposes only the
 * fingerprint (a hash) and an opaque `confirm` callable — never the record — so #54 can send the
 * fingerprint to the renderer and hold the handle in main memory, calling `confirm` only when the
 * operator clicks confirm. The token/key never cross to the renderer.
 */
export interface PairingConfirmation {
  prepare(record: PairedServerRecord): PreparedPairing
}

/** X25519 public-key width — the exact decoded length a server_static_pubkey must have. */
const PUBKEY_BYTES = 32

/**
 * Fingerprint truncation width, in bytes (64 bits). Byte-identical to the daemon's
 * internal/pair.Fingerprint. Load-bearing and exact: narrowing (32-bit) is brute-forceable, and
 * widening defeats the operator's visual compare against pyrybox/the phone's 8-byte form.
 */
const FINGERPRINT_BYTES = 8

/**
 * Full BLAKE2s-256 digest width, in bytes — the `dkLen` requested from @noble/hashes before the
 * 8-byte truncation above. This is the daemon's hash (`Noise_IK_..._BLAKE2s`); named so it does not
 * read as coincidental with PUBKEY_BYTES (both 32) at the call site.
 */
const DIGEST_BYTES = 32

/** Internal derivation result — either the display fingerprint or a value-free reject reason. */
type DerivedFingerprint = { ok: true; fingerprint: string } | { ok: false; reason: FingerprintRejectReason }

/**
 * Derive the display fingerprint from a standard (padded) base64 X25519 public key. First failure
 * wins. Node's `Buffer.from(s, 'base64')` is LENIENT (silently drops out-of-alphabet chars, tolerates
 * missing padding), so guard it with a re-encode-and-compare: only input that round-trips through a
 * canonical standard-base64 encode is accepted. On success: BLAKE2s-256 of the raw key bytes,
 * truncated to the first 8 bytes, formatted as colon-separated lowercase hex (e.g.
 * `32:0b:5e:a9:9e:65:3b:c2`). Module-private: the parity/determinism tests drive it through `prepare`.
 */
function deriveFingerprint(pubkey: string): DerivedFingerprint {
  const keyBytes = Buffer.from(pubkey, 'base64')
  if (keyBytes.toString('base64') !== pubkey) {
    return { ok: false, reason: 'pubkey-not-base64' }
  }
  if (keyBytes.length !== PUBKEY_BYTES) {
    return { ok: false, reason: 'pubkey-wrong-length' }
  }
  // Only the digest is newly guarded. @noble/hashes on a validated 32-byte input is deterministic
  // pure computation, so this catch is effectively unreachable — but AC4 requires the digest step to
  // RETURN a typed reason rather than throw (a throw here would escape ipcMain.handle and wedge the
  // pairing screen in `submitting` forever). Return the static value-free reason only: never the
  // caught error's message (it could echo internals), no console.* — the module stays log-free.
  let digest: Uint8Array
  try {
    digest = blake2s(keyBytes, { dkLen: DIGEST_BYTES })
  } catch {
    return { ok: false, reason: 'fingerprint-unavailable' }
  }
  const fingerprint = Array.from(digest.subarray(0, FINGERPRINT_BYTES))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join(':')
  return { ok: true, fingerprint }
}

/** Build a reject arm. Isolated so the "no field value in a reason" property stays structural. */
function reject(reason: FingerprintRejectReason): PreparedPairing {
  return { ok: false, reason }
}

/**
 * Build a PairingConfirmation over the injected paired-server store. The real store is constructed
 * at the composition root by the IPC slice (#54); tests inject a fake store (a `save` spy) — this
 * service never touches safeStorage, the filesystem, or the secure store directly.
 */
export function createPairingConfirmation(deps: { store: PairedServerStore }): PairingConfirmation {
  const { store } = deps

  return {
    prepare(record) {
      // Snapshot the four fields once into a fresh, frozen object. `confirm` closes over this
      // snapshot, not the caller's live reference, so a caller mutating its own record between
      // prepare and confirm cannot change the persisted bytes (closes a confused-deputy/TOCTOU gap).
      const snapshot: PairedServerRecord = Object.freeze({
        server: record.server,
        relay: record.relay,
        token: record.token,
        server_static_pubkey: record.server_static_pubkey
      })

      const derived = deriveFingerprint(snapshot.server_static_pubkey)
      if (!derived.ok) {
        // A malformed key builds NO confirm closure — it is structurally unpersistable.
        return reject(derived.reason)
      }

      // The ONE persist site in the module: reachable only through this closure, only after prepare
      // has derived (but not persisted) the fingerprint. `store.save` is not called anywhere else.
      return {
        ok: true,
        fingerprint: derived.fingerprint,
        confirm: () => store.save(snapshot)
      }
    }
  }
}
