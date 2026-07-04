# Spec — Server-key fingerprint + confirm-gated persist (#53)

One new `src/main/` service that turns a **validated** pairing record into a **displayable fingerprint** of its `server_static_pubkey` and persists the record **only** through an explicit confirm step. It is the desktop's fingerprint-confirm gate — the human-verify step mobile's paste path skipped (mobile #501). Deriving the fingerprint persists nothing; there is exactly one persist site, and it is reachable only by calling the confirm handle that `prepare` hands back.

## Files to read first

- `src/main/pairedServerStore.ts:31-64` — `PairedServerRecord` (= `QrPayload`), the `PairedServerStore` interface (`save`/`load`), `PAIRED_SERVER_NAME`. This service consumes `PairedServerStore` as an injected dep and calls its `save` at the one persist site.
- `src/main/pairedServerStore.ts:120-138` — `createPairedServerStore(deps: { … })` factory shape. Mirror this `create*(deps)` injection idiom for `createPairingConfirmation`.
- `src/main/pairingPayload.ts:26-58` — `ParsePairingResult` / `PairingRejectReason` discriminated-result + value-free-reason idiom. `PreparedPairing` / `FingerprintRejectReason` mirror it exactly. Note the upstream produces the `{ ok: true; payload }` record this service consumes.
- `src/main/pairingPayload.ts:145-148` — the `reject(reason)` helper: reject-arm construction isolated so "no field value in a reason" stays structural. Reuse the shape.
- `src/shared/wire/types.ts:119-125` — `QrPayload` shape; `server_static_pubkey` is the fingerprint input (standard-base64 of a raw 32-byte X25519 key).
- `src/main/pairedServerStore.test.ts:1-58` — the Map-backed fake / injected-seam test scaffold. This service's tests fake `PairedServerStore` (a `save` spy is enough — no keychain, no fs).
- `src/main/pairedServerStore.test.ts:167-204` — the six-method `console` log-free spy pattern; copy it verbatim for the log-free test.
- `src/main/transport/noiseSession.test.ts:4` — `import { createHash } from 'node:crypto'`. This is the node-builtin import convention (the `node:` prefix) and confirms BLAKE2s-via-Node-`crypto` is already used in `src/main`.
- `docs/knowledge/features/pairing-payload-gate.md` — § *Deliberately not validated here* + § *Related*. The upstream gate does **not** validate the pubkey's base64/32-byte shape; it hands that off to this ticket. This service is the first place that shape is checked.
- `docs/knowledge/features/paired-server-store.md` — § *Public surface* + § *Security properties*. The `save` contract (fail-closed on unavailable keychain), and the "token/key never cross a boundary, log-free by construction" posture this service must also uphold.
- `docs/knowledge/decisions/0002-remote-head-over-relay-shared-wire.md` — token/keys never reach the renderer; the fingerprint (a hash) is the only pairing-derived value safe to surface (surfacing is #54, not here).

**Cross-repo parity source (read the summary, not the Go):** the daemon's `internal/pair.Fingerprint` fixes the exact fingerprint form — `BLAKE2s-256(pubkey)` truncated to the first **8 bytes**, colon-separated lowercase hex (`aa:bb:cc:dd:ee:ff:11:22`, exactly 23 chars). Pinned by the vector **`Fingerprint(32 zero bytes) == "32:0b:5e:a9:9e:65:3b:c2"`**. Source: pyrycode `docs/knowledge/features/pair-package.md` (§ *Fingerprint*) and `docs/protocol-mobile.md` § *Security review* (the 64-bit width is load-bearing). The desktop fingerprint must be **byte-identical** to this so the operator can compare the desktop screen against what `pyry pair` printed on pyrybox and what the phone shows.

## Context

A paste-based pairing path that stores `server_static_pubkey` straight from the payload is a key-trust hole: nothing lets the operator verify the key before the client trusts it. The upstream gate (#52, `parsePairingPayload`) validates the relay URL and the record's structural shape, but deliberately treats `server_static_pubkey` as an opaque non-empty string — it does **not** confirm the key. This slice is the confirm gate: derive a fingerprint of the key, show it, and persist **only** after an explicit confirm. Mobile #501 proved this matters — its QR path had the gate, its paste path skipped it and persisted immediately. The desktop is paste-only, so the gate is baked in from the start.

Scope boundary: this service consumes the `{ ok: true }` `QrPayload` from #52 and produces (a) a fingerprint string and (b) a confirm handle over the injected paired-server store. Surfacing the fingerprint toward the renderer over IPC — and calling confirm on a user click — is the next slice (#54). Nothing here touches IPC, `safeStorage`, the filesystem, a socket, or the renderer.

## Design

**One production file** — `src/main/pairingConfirmation.ts`, a flat sibling of `pairingPayload.ts` and `pairedServerStore.ts` (`@shared`/relative-import rules identical; import the store types by relative path). Pure core over one injected seam (`PairedServerStore`), matching the `secureStore` / `deviceKeypair` / `pairedServerStore` shape. Log-free by construction: no `console.*` anywhere.

### Public surface (contract — not the body)

```ts
import type { PairedServerRecord, PairedServerStore } from './pairedServerStore'

/** Why fingerprint derivation rejected a record. Value-free category strings, safe to surface. */
export type FingerprintRejectReason =
  | 'pubkey-not-base64'    // server_static_pubkey is not canonical standard (padded) base64
  | 'pubkey-wrong-length'  // decoded key is not exactly 32 bytes (X25519 public-key width)

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

Four exported symbols, one injected dep. No standalone fingerprint export — the pure derivation is a module-private helper; the parity/determinism tests drive it through `prepare`.

### The prepare → confirm gate (the load-bearing shape)

`prepare(record)` is **synchronous and pure** (a hash is sync); only `confirm()` is async (it awaits the one `store.save`). Behaviour:

1. Snapshot the four record fields once into a local `snapshot` (a fresh object — see *binding*, below). Read `snapshot.server_static_pubkey`.
2. Derive the fingerprint from that pubkey (algorithm below). On a malformed key, return `{ ok: false, reason }` — **no `confirm` closure is created**, so a malformed key is structurally unpersistable.
3. On success, return `{ ok: true, fingerprint, confirm }` where `confirm` is `() => store.save(snapshot)`.

Three properties fall out structurally, not by convention:

- **Exactly one persist site.** `store.save(...)` appears once in the whole module — inside the `confirm` closure `prepare` builds. `grep` for `.save(` returns one hit. Nothing else in the module persists.
- **Unreachable without confirm.** The only way to obtain a `confirm` is to call `prepare`, which derives (but does not persist) the fingerprint first. There is no persist path that skips `prepare`.
- **Confirm binds to exactly the fingerprinted record.** `confirm` closes over `prepare`'s `snapshot`, not the caller's live reference. If the caller mutates its own record object between `prepare` and `confirm`, the persisted bytes are still the ones that were fingerprinted (closes a confused-deputy / TOCTOU gap). Freezing `snapshot` is a cheap belt; the store re-picks the four fields at encode time regardless.

The `confirm` closure holds the record (token + key) privately in main-process memory; the returned object exposes only `fingerprint` (a hash) and an opaque callable. This is exactly what #54 needs across an IPC round-trip: main calls `prepare`, sends only `fingerprint` to the renderer, holds the `PreparedPairing` in main memory, and calls `confirm()` when the renderer signals the user clicked confirm. The token/key never cross to the renderer.

### Fingerprint derivation (module-private helper)

Input: `server_static_pubkey`, a **standard (padded) base64** string of a raw 32-byte X25519 key (per the wire contract; `StdEncoding`, not the outer envelope's `RawURLEncoding`). Steps, first failure wins:

| Step | Check | Reject reason |
|---|---|---|
| 1 | Decode as **canonical** standard base64. Node's `Buffer.from(s, 'base64')` is **lenient** (silently drops out-of-alphabet chars, tolerates missing padding) — guard against it: reject unless the input is canonical (e.g. re-encode the decoded bytes with `.toString('base64')` and require it equals the input, or an equivalent strict alphabet+padding check). | `pubkey-not-base64` |
| 2 | Decoded length is exactly `32`. | `pubkey-wrong-length` |
| 3 | `createHash('blake2s256').update(keyBytes).digest()` → take the **first 8 bytes** → format as colon-separated lowercase hex. | — (success) |

- **BLAKE2s-256 via Node's built-in `crypto`** (`import { createHash } from 'node:crypto'`) — OpenSSL-backed, vetted, no new dependency, and **verified byte-identical** to the daemon's `golang.org/x/crypto/blake2s.Sum256`. No hand-rolled crypto. The wasm Noise lib exposes no standalone hash, so `node:crypto` is the right primitive.
- **The 8-byte (64-bit) truncation is load-bearing and exact** — do not narrow it (a 32-bit fingerprint is brute-forceable) and do not widen it (the operator compares against the daemon's/phone's 8-byte form; a mismatched width defeats the visual check). The pinned vector `32:0b:5e:a9:9e:65:3b:c2` for 32 zero bytes is the parity anchor.
- Rejections are value-free category strings built through a `reject(reason)` helper (mirror `pairingPayload.ts:145-148`); the caught base64/decode error object is never echoed.

## State + concurrency model

- **No store slice, no Zustand, no renderer state.** A main-process service object, not UI state. No event stream, no subscription.
- **No long-lived work.** `prepare` is a synchronous pure transform. `confirm` is a single `await store.save(snapshot)` and returns. No timers, listeners, sockets, or `AbortController` — nothing to cancel on teardown.
- **Immutable binding across the derive→confirm gap.** `snapshot` is captured at `prepare` time; `confirm` persists that snapshot. No shared mutable state, so there is no check-then-act race even though `prepare` (sync) and `confirm` (async) are separated in time (in #54, across an IPC round-trip).
- **Double-confirm is idempotent.** Calling a `confirm` twice issues two `store.save(snapshot)` calls with identical bytes; the store is last-writer-wins over one blob, so the end state is unchanged. No guard is added at this layer (the UI-level button debounce is #54's concern; there is no observed double-confirm failure to defend here).

## Error handling

| Failure mode | Layer | Result | UI surfacing (in #54) |
|---|---|---|---|
| `server_static_pubkey` not canonical base64 | `prepare` (derivation) | `{ ok: false, reason: 'pubkey-not-base64' }`; no confirm handle | Block confirm; "pasted key is malformed — re-pair" |
| decoded key ≠ 32 bytes | `prepare` (derivation) | `{ ok: false, reason: 'pubkey-wrong-length' }`; no confirm handle | same |
| keychain unavailable at persist | `confirm` → `store.save` | `EncryptionUnavailableError` propagates out of `confirm()` (nothing persisted — the store is fail-closed) | Surface "can't store — keychain unavailable"; pairing not saved |
| any other `store.save` throw (decrypt/write) | `confirm` → `store.save` | propagates verbatim out of `confirm()` | Surface a generic persist failure |

This service **catches nothing from `store.save`** — the store owns its fail-closed and error contract (`docs/knowledge/features/paired-server-store.md` § *Security properties*); wrapping it here would only risk swallowing the fail-closed guarantee. The only errors this service *produces* are the two value-free `FingerprintReject` arms, and those are data (`ok: false`), never thrown.

Rejection is an expected, routine outcome (a hostile/garbled paste), so it is modelled as an `ok: false` data arm, not an exception — the same choice the upstream gate made.

## Testing strategy

`src/main/pairingConfirmation.test.ts`, vitest (`import { describe, it, expect, vi } from 'vitest'`), `PairedServerStore` faked in-file (a `save` spy backed by an array/`vi.fn()`; no keychain, no fs). Scenarios (bullet points — write them in the project's test idiom, not as pre-written bodies):

- **Fingerprint determinism (AC1).** `prepare` on the same record twice yields the same `fingerprint` string; two records differing only in a non-pubkey field yield the same fingerprint (fingerprint depends only on `server_static_pubkey`); two records with different keys yield different fingerprints.
- **Daemon parity / fixed vector (AC1).** A record whose `server_static_pubkey` is standard-base64 of 32 zero bytes (`"AAAA…AAA="`, 44 chars) prepares to `fingerprint === "32:0b:5e:a9:9e:65:3b:c2"`. Pin the literal — do **not** recompute it from `createHash` in the test (tautological). This is the cross-implementation proof against the daemon.
- **Fingerprint shape.** For an arbitrary valid 32-byte key, `fingerprint` matches `/^[0-9a-f]{2}(:[0-9a-f]{2}){7}$/` and has length 23.
- **Deriving persists nothing (AC2).** After `prepare` on a valid record (without calling `confirm`), the `save` spy has zero calls.
- **Confirm persists exactly once via the store (AC2, AC3).** `prepare` then `await confirm()` → `save` called exactly once, with the four record fields (deep-equal the input record). A second `await confirm()` → two total `save` calls, same bytes (idempotency), still one logical record.
- **Malformed key is unpersistable (AC2).** For `server_static_pubkey` values `"!!!"` (not base64) and a base64 of 31 and of 33 bytes, `prepare` returns `{ ok: false }` with the matching reason and **no `confirm` field**; the `save` spy is never called on any of them.
- **Confirm binds to the snapshot, not the caller's reference.** Mutate the caller's record object's `server_static_pubkey` after `prepare` and before `confirm`; the persisted `server_static_pubkey` equals the pre-mutation value that was fingerprinted.
- **`store.save` failure propagates (error handling).** A fake whose `save` rejects with `EncryptionUnavailableError` → `confirm()` rejects with it; the service adds no catch.
- **Token/key never in the fingerprint output (AC4).** For a record with a recognisable `token` and `server_static_pubkey`, neither string appears as a substring of `fingerprint`; the returned ok-object's own enumerable keys are exactly `ok`, `fingerprint`, `confirm` (the record is not a returned field).
- **Log-free across every path (AC4).** Spy all six `console` methods (`log`/`info`/`warn`/`error`/`debug`/`trace`); run `prepare` happy path, both malformed-key rejects, `confirm` success, and the `save`-rejects path; assert none fired. (Copy `pairedServerStore.test.ts:167-204`.)

Type-level coverage under `npm run typecheck`: `PreparedPairing` is a discriminated union on `ok`, so a consumer that reads `.confirm`/`.fingerprint` without narrowing on `ok === true` is a compile error — the "no confirm on a rejected key" property is partly type-enforced.

## Open questions

- **Fingerprint display grouping is the daemon's, unconditionally.** The colon-separated-lowercase-hex form is fixed by cross-repo parity; there is no desktop styling latitude here (any spacing/label decoration is #54's renderer concern, wrapping this exact 23-char string). No open question — noted to preempt re-litigation.
- **Strict-base64 expression.** Whether to guard Node's lenient decode via re-encode-and-compare or a strict alphabet+padding regex is the developer's call; the malformed-key tests (31/33-byte, `"!!!"`) plus the fixed vector pin the behaviour either way.
- **Un-pair / re-pair after confirm** is out of scope (the store already overwrites last-writer-wins). Confirm-then-reconnect is the transport's concern (#7/#30).

## Design source

N/A — no user-visible UI in this slice. This service lives entirely in `src/main` and returns a fingerprint string + a confirm handle to a main-process caller; rendering the fingerprint and wiring the confirm button land in #54 (the pairing IPC channel), which carries its own Figma anchor.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No MUST FIX — `server_static_pubkey` is validated upstream (#52) for presence/type only, **not** for base64/32-byte shape (pairing-payload-gate.md § *Deliberately not validated here*). This service is the single, explicit boundary where that key crosses from "opaque string" to "well-formed 32-byte key," concentrated in one `prepare` + one private derivation helper. A malformed key yields `{ ok: false }` with **no `confirm` handle**, so it is structurally unpersistable. The record reaches persistence only through `confirm`, which is closed over an immutable `snapshot` — the caller cannot mutate the object between derive and persist (confused-deputy/TOCTOU closed by design).
- [Tokens/secrets] No MUST FIX — no RNG here (deterministic hash). Persistence delegates to the injected `PairedServerStore.save` (Electron `safeStorage`, OS-keychain-backed, fail-closed — inherited from #44); this service never touches `safeStorage`, the filesystem, or `localStorage`. The token is never logged, never a returned field (the ok-object exposes only `fingerprint` + an opaque `confirm` callable), and the fail-closed `EncryptionUnavailableError` propagates uncaught so plaintext never lands. The token resides transiently in main-process memory inside the `confirm` closure — inherent to the flow, same posture as #44; not new.
- [File/storage] No findings — no direct filesystem access. The store name is a fixed constant (`PAIRED_SERVER_NAME`) in `pairedServerStore`, never derived from the pasted payload, so there is no path-traversal surface; atomic-write and encryption-at-rest are the injected store's (inherited).
- [Electron attack surface] OUT OF SCOPE (→ #54) — this module adds **zero** IPC / `contextBridge` / `ipcMain` / `BrowserWindow` surface and lives entirely in main. **Hand-off to #54:** the renderer must send a bare "confirm" signal (no payload), never a record — the record stays in main keyed by the held `PreparedPairing`; only `fingerprint` (a hash) may flow to the renderer; #54 must hold at most one live `PreparedPairing` and discard it on a new paste so `confirm` cannot persist a superseded record; and #54 must validate the pasted-string IPC arg is a `string` before calling `parsePairingPayload` (carried from pairing-payload-gate.md § *Edge cases* hand-off).
- [Cryptographic primitives] No MUST FIX — BLAKE2s-256 via Node's built-in `crypto.createHash('blake2s256')` (OpenSSL-backed, vetted, no hand-rolled crypto), **verified byte-identical** to the daemon's `golang.org/x/crypto/blake2s.Sum256` against the pinned vector `32:0b:5e:a9:9e:65:3b:c2`. No RNG, no keys generated, no `(key, nonce)` pair — reuse is not possible. The 8-byte/64-bit truncation is enforced and pinned (narrowing is brute-forceable; widening defeats the operator's visual compare). `crypto.timingSafeEqual` is **N/A**: no code compares the key/token/fingerprint to a secret — the fingerprint match is performed by the human operator visually.
- [Network & I/O] N/A — no socket, no relay URL use (validated in #52), no `ws`, no frame handling; this service is pre-connection.
- [Errors/logs/telemetry] No findings — log-free by construction (no `console.*`; enforced by a six-method spy test). Reject reasons are fixed value-free category strings built through an isolated `reject()` helper; caught base64/decode error objects are discarded, never echoed. No telemetry. The fingerprint is a hash, not a secret.
- [Concurrency] No findings — `prepare` is synchronous and pure; `confirm` is a single `await store.save(snapshot)`. No timers, listeners, sockets, or long-lived tasks to cancel. The `snapshot` binding removes the derive→confirm race; double-confirm is idempotent (identical bytes, last-writer-wins over one blob).
- [Threat model] No MUST FIX — the fingerprint-confirm gate **is** the mitigation for the ticket's threat (a tampered/wrong server key trusted without verification). Its security rests on the human fingerprint compare against pyrybox/the phone plus the 64-bit width — the desktop has no a-priori trust anchor for the key (this is the trust-establishment step), so a shape-valid-but-attacker key correctly produces a fingerprint that will not match, and the operator declines. Malicious/on-path relay (→ transport #21/#22), hostile daemon response (pre-connection, N/A here), and renderer compromise (record/token never leave main; → #54 boundary) are named and deferred/structurally blocked.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-04
