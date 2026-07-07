# Pairing-confirmation gate

The desktop client's **fingerprint-confirm gate**: the pure, main-process service that turns a **validated** pairing record into a short, human-comparable **fingerprint** of its `server_static_pubkey` and persists the record **only** through an explicit confirm step. It is the human-verify step mobile's paste path skipped (mobile #501) — before the client trusts a pasted server key, the operator eyeballs its fingerprint against what `pyry pair` printed on pyrybox (and what the phone shows), and only then confirms. A tampered or wrong key produces a fingerprint that will **not** match, and the operator declines.

Introduced in [#53](../codebase/53.md). It lives **entirely** in `src/main` — the `token` (a bearer credential) and `server_static_pubkey` (a static key) never reach the renderer, the preload bridge, or IPC ([ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md); CLAUDE.md "Keep the transport out of the window"). It consumes the [pairing-payload gate](pairing-payload-gate.md)'s `{ ok: true }` `QrPayload` and persists through the injected [paired-server store](paired-server-store.md); it is **log-free by construction** — no `console.*` anywhere, no persistence of its own, no crypto beyond a hash, no IPC, no socket, no UI. Only the fingerprint (a hash) is safe to surface toward the renderer, and that surfacing is the pairing IPC channel (#54), not this slice.

## What it does

Gives the background process **one factory** — `createPairingConfirmation({ store })` — that returns a `{ prepare }` handle:

- **`prepare(record)`** derives the fingerprint (a pure, synchronous hash) and returns a discriminated `PreparedPairing`:
  - **Success** (`{ ok: true, fingerprint, confirm }`) carries the display `fingerprint` **plus the one persist handle** `confirm`, bound to exactly the record it fingerprinted.
  - **Failure** (`{ ok: false, reason }`) carries **only** a value-free category `reason` — and **no `confirm` handle**, so a malformed key is *structurally* unpersistable.
- **`confirm()`** is the returned closure — the **only** thing in the module that persists. It `await`s the injected store's `save` on the fingerprinted snapshot. Deriving the fingerprint persists nothing on its own.

The load-bearing shape: there is **exactly one `store.save` call site** in the whole module, it is **unreachable without first calling `prepare`**, and it is **structurally absent on a rejected key**. These are properties of the code's shape, not of convention.

## How it works

**One** production file in `src/main/`, a flat sibling of `pairingPayload.ts` and `pairedServerStore.ts` (`@shared` alias not wired for `src/main` — the store types are imported by relative path). A pure core over one injected seam (`PairedServerStore`), matching the `secureStore` / `deviceKeypair` / `pairedServerStore` shape.

| File | Role |
|---|---|
| `src/main/pairingConfirmation.ts` | The whole gate: `createPairingConfirmation`, the `PairingConfirmation` interface, `PreparedPairing` / `FingerprintRejectReason` types, and the module-private `deriveFingerprint` helper. Imports **only** `blake2s` from `@noble/hashes/blake2` (the BLAKE2s digest — **not** `node:crypto`, which lacks BLAKE2 under Electron's BoringSSL; see [#101](../codebase/101.md)) and the **types** `PairedServerRecord` / `PairedServerStore` (relative path). No `electron`/`fs`/socket/IPC import. ~156 LOC. |

### Public surface

```ts
import type { PairedServerRecord, PairedServerStore } from './pairedServerStore'

/** Why fingerprint derivation rejected a record. Value-free category strings, safe to surface. */
export type FingerprintRejectReason =
  | 'pubkey-not-base64'      // server_static_pubkey is not canonical standard (padded) base64
  | 'pubkey-wrong-length'    // decoded key is not exactly 32 bytes (X25519 public-key width)
  | 'fingerprint-unavailable' // the digest primitive itself threw — distinct from a malformed key (#101)

/** Result of preparing a validated record for confirmation. On success carries the display
 *  fingerprint plus the ONE persist handle; on failure only a value-free reason (no confirm). */
export type PreparedPairing =
  | { ok: true; fingerprint: string; confirm: () => Promise<void> }
  | { ok: false; reason: FingerprintRejectReason }

/** The confirm gate. `prepare` derives the fingerprint and returns a confirm handle bound to the
 *  exact record fingerprinted; it persists NOTHING on its own. */
export interface PairingConfirmation {
  prepare(record: PairedServerRecord): PreparedPairing
}

export function createPairingConfirmation(deps: { store: PairedServerStore }): PairingConfirmation
```

Four exported symbols, one injected dep. **No standalone fingerprint export** — the pure derivation is a module-private helper; the parity/determinism tests drive it through `prepare`. `PreparedPairing` is a discriminated union on `ok`, so a consumer reading `.confirm`/`.fingerprint` without narrowing on `ok === true` is a **compile error** — "no confirm on a rejected key" is partly type-enforced.

### The prepare → confirm gate

`prepare(record)` is **synchronous and pure** (a hash is sync); only `confirm()` is async (it awaits the one `store.save`). Behaviour:

1. **Snapshot** the four record fields once into a fresh, `Object.freeze`d local. `confirm` closes over this snapshot, not the caller's live reference.
2. **Derive** the fingerprint from `snapshot.server_static_pubkey`. On a malformed key, return `{ ok: false, reason }` — **no `confirm` closure is created**.
3. On success, return `{ ok: true, fingerprint, confirm }` where `confirm` is `() => store.save(snapshot)`.

Three properties fall out **structurally**:

- **Exactly one persist site.** `store.save(...)` appears once in the module — inside the `confirm` closure `prepare` builds. `grep` for `.save(` returns one hit. Nothing else persists.
- **Unreachable without confirm.** The only way to obtain a `confirm` is to call `prepare`, which derives (but does not persist) the fingerprint first. There is no persist path that skips `prepare`.
- **Confirm binds to exactly the fingerprinted record.** `confirm` closes over the frozen `snapshot`. If the caller mutates its own record object between `prepare` and `confirm`, the persisted bytes are still the ones that were fingerprinted — closing a confused-deputy / TOCTOU gap.

This is exactly the shape #54 needs across an IPC round-trip: main calls `prepare`, sends only `fingerprint` to the renderer, holds the `PreparedPairing` in main memory, and calls `confirm()` when the renderer signals the user clicked confirm. The token/key never cross to the renderer.

### Fingerprint derivation — byte-identical to the daemon

Input: `server_static_pubkey`, a **standard (padded) base64** string of a raw 32-byte X25519 key (per the wire contract — `StdEncoding`, not the outer envelope's `RawURLEncoding`). Steps, first failure wins:

| Step | Check | Reject reason |
|---|---|---|
| 1 | Decode as **canonical** standard base64. Node's `Buffer.from(s, 'base64')` is **lenient** (silently drops out-of-alphabet chars, tolerates missing padding), so it is guarded by a **re-encode-and-compare**: `keyBytes.toString('base64') !== pubkey` rejects. Only input that round-trips through a canonical standard-base64 encode is accepted. | `pubkey-not-base64` |
| 2 | Decoded length is exactly `32` (`PUBKEY_BYTES`). | `pubkey-wrong-length` |
| 3 | `blake2s(keyBytes, { dkLen: DIGEST_BYTES })` (BLAKE2s-256 → 32-byte `Uint8Array`), wrapped in a `try/catch` — a throw returns the reason at right; on success take the **first 8 bytes** (`FINGERPRINT_BYTES`) → format as colon-separated lowercase hex. | `fingerprint-unavailable` (throw) / — (success) |

- **The form is fixed by cross-repo parity with the daemon:** `BLAKE2s-256(pubkey)` truncated to the first **8 bytes**, colon-separated lowercase hex — e.g. `aa:bb:cc:dd:ee:ff:11:22`, matching `/^[0-9a-f]{2}(:[0-9a-f]{2}){7}$/`, **exactly 23 chars**. It must be byte-identical to the daemon's `internal/pair.Fingerprint` and mobile's, so the operator can compare the desktop screen against what `pyry pair` printed on pyrybox and what the phone shows. **Pinned vector:** `Fingerprint(32 zero bytes) === "32:0b:5e:a9:9e:65:3b:c2"` (independently recomputed in code review).
- **BLAKE2s-256 via `@noble/hashes`** (`blake2s(keyBytes, { dkLen: 32 })`, imported from the non-deprecated `@noble/hashes/blake2` subpath) — a vetted, audited, **pure-JS** implementation, verified byte-identical to the daemon's `golang.org/x/crypto/blake2s.Sum256`. No hand-rolled crypto. **Why not `node:crypto`:** `createHash('blake2s256')` throws `Error: Digest method not supported` under **Electron's BoringSSL**, which has no BLAKE2 family — it worked only under vitest's full-OpenSSL Node, so pairing was completely broken in the built app until [#101](../codebase/101.md). A pure-JS digest has no native crypto backend to diverge, so it computes identical bytes under Node **and** Electron and stays **synchronous** (keeping `prepare` sync). The wasm Noise lib exposes no standalone hash (only handshake-transcript hashing), and WebCrypto has no BLAKE2, so a small pure-JS dependency is the unavoidable primitive.
- **The 8-byte / 64-bit truncation is load-bearing and exact.** Do not narrow it (a 32-bit fingerprint is brute-forceable) and do not widen it (the operator compares against the daemon's/phone's 8-byte form; a mismatched width defeats the visual check). It is a named constant with the rationale documented in-code.
- Rejections are value-free category strings built through a `reject(reason)` helper (mirroring `pairingPayload.ts`); the caught base64/decode error object is never echoed.

## State + concurrency

- **No store slice, no Zustand, no renderer state** — a main-process service object, not UI state. No event stream, no subscription.
- **No long-lived work.** `prepare` is a synchronous pure transform; `confirm` is a single `await store.save(snapshot)` and returns. No timers, listeners, sockets, or `AbortController` — nothing to cancel on teardown.
- **Immutable binding across the derive→confirm gap.** The `snapshot` is captured at `prepare` time and `confirm` persists it, so there is no check-then-act race even though `prepare` (sync) and `confirm` (async) are separated in time (in #54, across an IPC round-trip).
- **Double-confirm is idempotent.** Calling a `confirm` twice issues two `store.save(snapshot)` calls with identical bytes; the store is last-writer-wins over one blob, so the end state is unchanged. No guard is added here (a UI-level button debounce is #54's concern; there is no observed double-confirm failure to defend).

## Security properties

The architect security-review verdict is **PASS**; the code review (security-sensitive) confirmed each property holds structurally and found no issues.

- **The gate *is* the mitigation** for the ticket's threat — a tampered/wrong server key trusted without verification. Its security rests on the human fingerprint compare against pyrybox/the phone, plus the 64-bit width. The desktop has no a-priori trust anchor for the key (this is the trust-establishment step), so a shape-valid-but-attacker key correctly produces a fingerprint that will not match, and the operator declines.
- **The single boundary where the key stops being an opaque string.** The upstream gate (#52) validates the relay and structural shape but treats `server_static_pubkey` as an opaque non-empty string ([pairing-payload-gate § Deliberately not validated](pairing-payload-gate.md#deliberately-not-validated-here)); this service is the **first** place its base64/32-byte shape is checked. A malformed key yields `{ ok: false }` with **no `confirm` handle** — structurally unpersistable.
- **Confused-deputy / TOCTOU closed by design.** `confirm` persists the frozen `snapshot`, not the caller's live reference, so the caller cannot swap the record between derive and persist.
- **Token/key never cross a boundary, never logged, never returned.** The ok-object exposes only `fingerprint` (a hash) and an opaque `confirm` callable — the record is not a returned field. Log-free by construction (six-method console spy). No RNG (deterministic hash), no keys generated, no `(key, nonce)` pair.
- **Persistence delegates to the injected store, fail-closed.** This service never touches `safeStorage`, the filesystem, or the secure store directly — it calls the injected [paired-server store](paired-server-store.md)'s `save`. It **catches nothing** from `save`: the fail-closed `EncryptionUnavailableError` (unavailable keychain) and any other persist error propagate uncaught, so plaintext never lands and the store's fail-closed guarantee is never swallowed. The store name is a fixed constant, never payload-derived — no path-traversal surface.

## Edge cases and limitations

- **Malformed key — not canonical base64** (`"!!!"`, URL-safe alphabet, missing padding, dropped chars, non-zero trailing bits) — `{ ok: false, reason: 'pubkey-not-base64' }`; no confirm handle, `save` never called.
- **Malformed key — wrong length** (decodes to 31 or 33 bytes, not 32) — `{ ok: false, reason: 'pubkey-wrong-length' }`; no confirm handle.
- **Digest primitive throws** — the `try/catch` around `blake2s(...)` returns `{ ok: false, reason: 'fingerprint-unavailable' }`; no confirm handle, no fingerprint shown, `save` never called. This is a **structural AC**, not an observed path: with pure-JS `@noble/hashes` on an already-validated 32-byte input the digest is deterministic pure computation and cannot fail — the catch exists so a throw (were one ever possible) returns a typed reason through `prepare` instead of escaping `ipcMain.handle` and wedging the pairing screen forever in `submitting` (the exact `node:crypto`/BoringSSL failure [#101](../codebase/101.md) fixed). The handler collapses it to the value-free `invalid-key` like the other reject reasons — see [#101](../codebase/101.md)'s reason-mapping decision (no distinct shared `PairingErrorReason` is added for an unobservable path).
- **Keychain unavailable at persist** — `store.save` throws `EncryptionUnavailableError`, which propagates out of `confirm()`; nothing persisted (the store is fail-closed). Surfacing "can't store — keychain unavailable" is #54's job.
- **Any other `store.save` throw** (decrypt/write) — propagates verbatim out of `confirm()`; the service adds no catch.
- **Double confirm** — two identical `save` calls; last-writer-wins over one blob → one logical record (idempotent).
- **Caller mutates its record between derive and confirm** — the pre-mutation bytes that were fingerprinted are what persist (frozen snapshot).
- **Not wired yet** — nothing constructs a live `PairingConfirmation`; the real `PairedServerStore` (over the real `createSecureStore`) is constructed at the composition root by the pairing IPC slice (#54). **Hand-off to #54:** the renderer must send a bare "confirm" signal (no payload, never a record); only `fingerprint` may flow to the renderer; #54 must hold at most one live `PreparedPairing` and discard it on a new paste (so `confirm` cannot persist a superseded record); and #54 must validate the pasted-string IPC arg is a `string` before calling `parsePairingPayload` (carried from the #52 hand-off).
- **Fingerprint display grouping is the daemon's, unconditionally** — the colon-separated lowercase-hex form is fixed by parity; any spacing/label decoration around this exact 23-char string is #54's renderer concern.
- **Un-pair / re-pair after confirm** is out of scope (the store overwrites last-writer-wins); confirm-then-reconnect is the transport's concern (#7/#30).

## Related

- [Pairing-payload gate](pairing-payload-gate.md) / [#52](../codebase/52.md) — the upstream gate; this service consumes its `{ ok: true }` `QrPayload` and is the first place `server_static_pubkey`'s shape is checked (the payload gate deliberately leaves it opaque).
- [Paired-server store](paired-server-store.md) / [#44](../codebase/44.md) — the injected persistence seam; `confirm` calls its `save` at the one persist site.
- [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — token/keys never reach the renderer; the fingerprint (a hash) is the only pairing-derived value safe to surface (surfacing is #54).
- [ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md) — the fail-closed secret-at-rest posture the injected store inherits, which `confirm` upholds by catching nothing.
- [Wire codec](wire-codec.md) / [#5](../codebase/5.md) — the ported wire types, including the `QrPayload` that `PairedServerRecord` aliases.
- [#53 codebase notes](../codebase/53.md) — implementation summary, patterns, and lessons.
- [#101 codebase notes](../codebase/101.md) — the BoringSSL digest fix: swapped `node:crypto` `createHash('blake2s256')` (throws under Electron) for pure-JS `@noble/hashes` `blake2s`, added the `fingerprint-unavailable` reject reason, and a `check:electron-digest` runtime gate. Restores pairing in the built app.
- Downstream consumer: the pairing IPC channel (#54), which surfaces the `fingerprint` to the renderer and calls `confirm()` on the operator's click.
