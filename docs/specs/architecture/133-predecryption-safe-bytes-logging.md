# Spec #133 — Log wire-decoder and framing errors with their safe pre-decryption bytes

**Ticket:** https://github.com/pyrycode/pyrycode-desktop/issues/133
**Size:** S (additive; ~50 production LOC across **4 production files** — `diagnosticLog.ts`, `noiseSession.ts`, `noiseRelayDriver.ts`, `daemonConnection.ts`; ~100 test LOC; no edit fan-out — every new field is optional; `codec.ts` is read-only/out of scope, see §4)
**Labels:** `security-sensitive` (self-review pass appended below), no Figma.

## Files to read first

- `src/main/diagnosticLog.ts:20-46` — the `DiagnosticEvent` allowlist + the `hash?` field #130 added. The new branded `safeBytes?` field slots in additively here; the byte-encoder co-locates in this file (the security-contract home).
- `src/main/diagnosticLog.test.ts:86-101` — the **existing `@ts-expect-error` compile-time type-pin block** (secret-carrying fields rejected at the type level). Extend it: a plain `string` and a post-decryption value must fail to type-check into `safeBytes`. This is the AC5 precedent — same file, same idiom.
- `src/main/transport/inboundMessage.ts:19-50, 133-170` — the **#130 POST-decryption sibling** (the opposite rule): how it injects an optional `DiagnosticLog`, logs `hash?` **after** the envelope narrows so the throw path stays unlogged, and its doc-comment already forward-references #133. Read it to mirror the injection discipline — but **do not import the byte-encoder here** (AC4).
- `src/main/transport/noiseSession.ts:26-28, 207-283` — the `LOG-FREE` header comment to reconcile, and the three inbound-read catch sites: `transport-decrypt-failed` (L213-216), the rekey-reply read `handshake-read-failed` (L234-243), the message-2 read `handshake-read-failed` (L269-278). **The `beginRekey` catch at L194-199 is an OUTBOUND write failure — no inbound frame in scope — it stays byte-free.**
- `src/main/transport/noiseRelayDriver.ts:16-18, 220-228, 251-265` — the `LOG-FREE` header to reconcile, the `createSession({...})` config build (forward the logger), and the `onMessage` framing catch (L253-257) classifying `inbound-frame-decode-failed`. **This is the DI convergence point** — it owns the framing catch and builds the session config.
- `src/main/transport/codec.ts:18-22` — the "performs no logging" purity contract. **Read-only** — the codec stays pure and unedited (its comment remains accurate; §4). Confirm the boundary; do not add a logger or a log call here.
- `src/main/daemonConnection.ts:263-271, 299-314` — the #127 relay-leg wiring at L270 (the one-line mirror to follow) and the `createDriver({...})` construction at L299 where the new driver-level `diagnosticLog` is added.
- `src/main/transport/noiseSession.test.ts` / `noiseRelayDriver.test.ts` — the existing fake-session / fake-supervisor harnesses. Add the capture tests following their shape; inject a fake `DiagnosticLog` (`{ event: (f) => captured.push(f) }`).
- `CLAUDE.md` "Keep the transport out of the window" / "Don't put crypto, sockets, or tokens in the renderer" — the boundary this ticket must not cross.

## Context

Two pre-decryption boundaries in the main process classify a failure into a static code and then **drop everything else** — including the raw failing bytes, which are ciphertext / handshake material / length prefixes (safe to keep, per Bucket 1: *"a framing or transport error is ciphertext and length prefixes, not plaintext"*):

1. **`noiseSession.ts`** — a frame that fails to open is classified into a `NoiseSessionErrorReason` and surfaced as `{ type: 'error', reason }` ("static reason only — never bytes"). The failing `frame` is in scope at each inbound-read catch but discarded.
2. **`noiseRelayDriver.ts` `onMessage`** — a malformed inbound relay frame throws `WireDecodeError` from the codec; the driver classifies it into `inbound-frame-decode-failed` and drops the raw frame. The codec (`codec.ts`) is pure and **performs no logging by contract** — so the log belongs at the driver's *call site* that catches the error, not inside the codec.

This wires the content-free logger (#126, merged) into those paths. It is the mirror-image of #130 (merged): #130 hashes post-decryption content and **never keeps bytes**; #133 keeps the *pre-decryption* raw bytes because they are provably not plaintext. Both blockers landed — `diagnosticLog.ts`'s allowlist already carries `hash?`, so the additive-field pattern is proven in place.

## Design

### 1. `diagnosticLog.ts` — the branded safe-bytes field + its sole encoder

The whole type-safety contract lives in one reviewed file (mirrors how `hash?` lives here). Three additions:

**a. A branded encoding type** — a nominal `string` subtype whose brand symbol never leaves the module, so a bare `string` (or any post-decryption-derived value) cannot be assigned where the field is expected:

```ts
declare const safeBytesBrand: unique symbol
/** Content-free encoding of raw bytes that failed BEFORE decryption. Minted ONLY by
 *  encodeSafeBytes; a plain string does not satisfy the brand (AC3/AC5). */
export type SafeBytesEncoding = string & { readonly [safeBytesBrand]: true }
```

**b. The additive allowlist field** on `DiagnosticEvent`, distinct from `hash?`:

```ts
/** Hex of the raw bytes of a frame that failed BEFORE decryption (ciphertext / handshake
 *  material / length prefixes — safe to keep, Bucket 1). Bounded to MAX_SAFE_BYTES raw bytes.
 *  Typed as the branded encoder output so no post-decryption value type-checks here (≠ hash?). */
safeBytes?: SafeBytesEncoding
```

**c. The sole minter** — a dedicated pre-decryption encoder, co-located so the brand symbol stays module-private and nothing outside can fabricate the brand without an explicit, greppable cast:

```ts
const MAX_SAFE_BYTES = 64 // fixed cap on RAW bytes captured (→ 128 hex chars); mirrors #130's MAX_LOGGED_TYPE_CHARS discipline
export function encodeSafeBytes(frame: Uint8Array): SafeBytesEncoding
// behaviour: hex-encode frame.subarray(0, MAX_SAFE_BYTES); return branded. Total on any input.
```

- **Encoding:** lowercase hex (byte-aligned, greppable, unambiguous — consistent with #130's hash), of the first `MAX_SAFE_BYTES` raw bytes. Never a decoded string.
- **Cap:** fixed `MAX_SAFE_BYTES` (recommend 64). Enough to show the frame header / length-prefix / ciphertext prefix for diagnosis; small enough to keep log lines compact and to deny a hostile peer a per-frame log-amplification lever. Developer may tune with a documented rationale (constant-with-comment precedent: `MAX_PENDING_FRAMES`, `MAX_LOGGED_TYPE_CHARS`).
- `Buffer` usage here is fine — `diagnosticLog.ts` is a main-process module (`tsconfig.node`, `types: ["node"]`); this does not make it Electron-dependent. Keep the module Electron-free.
- **Doc-comment:** update the `DiagnosticEvent` header (L20-25) to note the new pre-decryption raw-safe-bytes field alongside the "no secret-carrying shape" contract, and that it is populated only via `encodeSafeBytes`.

### 2. `noiseSession.ts` — log at the three inbound-read catches

Add one **optional** config field (mirrors `inboundMessage` / `relayConnection` injection discipline):

```ts
// on NoiseSessionConfig:
diagnosticLog?: DiagnosticLog   // import type from '../diagnosticLog'; also import { encodeSafeBytes }
```

Introduce a small helper alongside the existing `fail(reason)`:

```ts
function failWithFrame(reason: NoiseSessionErrorReason, frame: Uint8Array): void
// behaviour: config.diagnosticLog?.event({ event: 'noise-frame-failed', code: reason,
//   bytes: frame.length, safeBytes: encodeSafeBytes(frame) }); then fail(reason).
```

Convert **only** the three inbound-read catch sites — where `frame` is the inbound bytes in scope — from `fail(reason)` to `failWithFrame(reason, frame)`:
- `transport-decrypt-failed` (L215) — `frame` is the post-handshake ciphertext that failed AEAD.
- message-2 read `handshake-read-failed` (L274) — `frame` is the daemon's handshake message 2.
- rekey-reply read `handshake-read-failed` (L242) — `frame` is the daemon's rekey handshake reply.

**Leave byte-free** (still plain `fail(reason)`): `unexpected-frame` at L165 (outbound write) and L264 (a pre-`start()` frame — not named by the ticket), and the `beginRekey` `handshake-read-failed` at L197 (outbound fresh-msg1 write, no inbound frame). The ticket's Technical Notes enumerate exactly the three sites above — do not over-apply.

- **Doc-comment:** update the `LOG-FREE by construction` header (L26-28). It currently says "NO … frame/plaintext bytes in any diagnostic." Reconcile: the session now emits content-free records at pre-decryption read failures carrying the **capped raw ciphertext / handshake bytes** (safe precisely because the frame is pre-decryption); it still emits **no key, token, or plaintext bytes**, and the caught wasm-error *object* is still classified-and-dropped, never forwarded.

### 3. `noiseRelayDriver.ts` — log at the framing catch + forward into the session

Add one **optional** config field on `NoiseRelayDriverConfig` and thread it two ways:

```ts
diagnosticLog?: DiagnosticLog   // import type from '../diagnosticLog'; also import { encodeSafeBytes }
```

- **Framing log** — in `onMessage`'s catch (L255), before `emit(...)`, log the raw inbound frame:
  ```ts
  config.diagnosticLog?.event({ event: 'relay-frame-decode-failed',
    code: 'inbound-frame-decode-failed', bytes: frame.length, safeBytes: encodeSafeBytes(frame) })
  ```
  The caught `WireDecodeError` *object* is still dropped (its `.message` could echo more than the bounded prefix); only the static code + the capped raw `frame` are logged. The `emit({ type: 'error', reason: 'inbound-frame-decode-failed' })` and the frame-drop are unchanged.
- **Forward into the session** — in `onConnected`'s `createSession({...})` build (L220-228), add `diagnosticLog: config.diagnosticLog`. Note `material` (`SessionMaterial`) does **not** carry the logger — the driver injects its own constant `config.diagnosticLog`, so a #83 per-dial reload never has to thread it through `DialConfig`.
- **Doc-comment:** update the `LOG-FREE by construction` header (L16-18) — the driver now emits a content-free record at the `inbound-frame-decode-failed` catch carrying the **capped raw pre-decryption frame bytes** (still-encrypted / length-prefix bytes, never plaintext); the caught error object is still dropped.

### 4. `codec.ts` — no change (out of scope; read-only)

**Do not edit `codec.ts`.** It **stays a pure, throw-only, no-logging module** (AC2). Its "This module performs no logging" and "[the decode errors] never echo the raw bytes" lines (L18-22) remain **literally true** after this ticket — the codec still throws a category-only `WireDecodeError` and logs nothing; the *driver* (the caller that catches it) is where the safe raw bytes are logged, and the driver's own comment (§3) carries that reconciliation. There is no contradiction to fix in the codec, so touching it would violate CLAUDE.md's "touch only what the task needs" and could dull the load-bearing purity invariant. The developer should still **read** `codec.ts:18-22` to confirm the boundary, but must not inject a logger, add a log call, or change its comments.

The ticket's Technical Notes mention the codec comment under "doc-comment reconciliation," but that note is an architect pointer, not a prescription; the reconciliation it seeks is satisfied by the driver's updated comment plus this explicit decision. This keeps the change at 4 production files.

### 5. `daemonConnection.ts` — one-line wiring

In `bootstrap`'s `createDriver({...})` (L299-314), add `diagnosticLog: deps.diagnosticLog`. This mirrors the existing relay-leg mirror at L270 and closes over the same process-singleton (`deps.diagnosticLog`) already injected by #126/#128. No other change — `deps.diagnosticLog` already exists on `DaemonConnectionDeps`. This is a **second** downward path for the same singleton (L270 → relayConnection for the relay leg; L299 → driver for framing + session), both referencing the one logger.

## State + concurrency model

No new state, no new async task, no store surface. `DiagnosticLog.event()` is synchronous, single-writer, and swallows sink throws (`diagnosticLog.ts:93-99`) — a diagnostics sink cannot crash the transport it observes. The log calls sit inside existing synchronous catch blocks; they add no `await`, no listener, no timer, no cancellation surface. The generation-fence and teardown behaviour of the session/driver are untouched.

## Error handling

The log calls are best-effort and cannot alter control flow:
- Every log site is `config.diagnosticLog?.event(...)` — absent a logger, it is a no-op (existing optional-inject discipline). Absent-logger behaviour is byte-identical to today.
- `event()` never throws (it swallows sink errors internally), so no log call can turn a recoverable transport error into a crash.
- All existing failure surfaces are preserved verbatim: `noiseSession` still emits the same `{ type: 'error', reason }`; the driver still emits `{ type: 'error', reason: 'inbound-frame-decode-failed' }` and drops the frame; the codec still fails closed. The frame bytes reach only the main-process diagnostic sink, **never** `onEvent` and never the renderer.

## Testing strategy

Unit tests (vitest, `npm test`) + typecheck (`npm run typecheck`). No new fakes beyond a capture `DiagnosticLog` (`{ event: (f) => captured.push(f) }`).

- **`diagnosticLog.test.ts`** (extend the existing `@ts-expect-error` block at L86-101 — the AC5 compile-time pin, same `src/main` file so no `TS6307` cross-project boundary issue):
  - `@ts-expect-error` — assigning a plain `string` to `safeBytes` fails to type-check.
  - `@ts-expect-error` — assigning a post-decryption value (e.g. the output shape of `hashPlaintext`, a bare hex `string`) to `safeBytes` fails to type-check.
  - Runtime: `encodeSafeBytes(bytes)` returns lowercase hex of at most `2 * MAX_SAFE_BYTES` chars; an over-long frame is truncated to the cap; a captured event carries the branded value under `safeBytes`.
- **`noiseSession.test.ts`**:
  - A `transport-decrypt-failed` (garbage transport frame) with an injected capture logger records `{ event: 'noise-frame-failed', code: 'transport-decrypt-failed', bytes, safeBytes: <hex of the frame prefix> }`, AND still emits `{ type: 'error', reason: 'transport-decrypt-failed' }` on `onEvent`, AND `onEvent`'s payload carries no `safeBytes` / raw bytes (bytes reach only the logger).
  - A `handshake-read-failed` (malformed message 2) records the ciphertext frame the same way.
  - Boundary: the `beginRekey` outbound-write failure path (if exercised) records **no** `safeBytes` (byte-free), proving the three-site scoping.
- **`noiseRelayDriver.test.ts`**:
  - A malformed inbound frame (bad base64 / bad JSON / wrong version) with an injected capture logger records `{ event: 'relay-frame-decode-failed', code: 'inbound-frame-decode-failed', bytes, safeBytes: <hex prefix> }`, AND still emits `{ type: 'error', reason: 'inbound-frame-decode-failed' }`, AND still drops the frame (no session delivery).
- **Content-free assertion** (mirror `diagnosticLog.test.ts:51-72`): plant no plaintext into these paths — the failing frames are ciphertext/handshake bytes by construction — and assert the serialized log line for a failure contains the expected hex prefix and nothing decoded.

## Open questions

- **Event names.** `code` carries the exact classification (the reason string) — that is load-bearing. The coarse `event` name (`noise-frame-failed` / `relay-frame-decode-failed`) is a recommendation; align it with the #127 relay-leg / #128 daemon-leg naming already in the log if that convention differs. Developer's call.
- **Cap value.** `MAX_SAFE_BYTES = 64` is a recommended default. If a length-prefix diagnosis needs more of the frame, the developer may raise it with a comment; `bytes: frame.length` already carries the true (uncapped) length alongside the capped hex, so a truncation/length-mismatch is visible even at the smaller cap.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] No MUST FIX.** The logged bytes cross untrusted→trusted at the driver's `onMessage` and the session's `onFrame` (a hostile relay / daemon supplies them). The design logs them content-free and **never interprets or branches on the content** — no misroute is possible. The boundary is explicit (the three named catch sites + the driver's framing catch), and the brand `SafeBytesEncoding` is the type-system signal separating "safe pre-decryption bytes" from post-decryption `hash?` at every call site.
- **[Tokens, secrets, credentials] No MUST FIX — the load-bearing invariant.** The only frame carrying a secret is **outbound message 1** (the `hello` early-data holds the device **token**), written in `start()` / `beginRekey()`. Those are the `unexpected-frame` (L165) and `beginRekey` `handshake-read-failed` (L197) outbound-write catches, which the spec keeps **byte-free**. Every logged frame is *inbound*: post-handshake AEAD ciphertext, Noise handshake message 2 / rekey reply (ephemeral pubkey + encrypted static + MAC — public handshake material, no client secret), or a base64-wrapped `{"v":2,"type":...,"data":<b64 ciphertext>}` routing wrapper. The client static private key never appears on the wire; the daemon never echoes the token back. **No secret can reach these three log sites** — this is why the outbound catches must stay byte-free, and the spec pins that scoping (Design §2, and a boundary test in §Testing).
- **[Cryptographic primitives] No findings.** No crypto is added; `encodeSafeBytes` is hex, applied *after* the AEAD/handshake has already failed. Logging a bounded ciphertext prefix leaks nothing an on-path relay does not already hold. Unlike a hash of plaintext (#130's concern, salted there via full-frame hashing), AEAD ciphertext is nonce-randomized, so a logged ciphertext prefix enables **no log-read confirmation attack** — a strictly easier case than #130. No key/nonce touched; no hand-rolled crypto.
- **[Error messages, logs, telemetry] No MUST FIX — the core category.** Logged fields are all allowlisted: `event`/`code` (static), `bytes` (a length), `safeBytes` (bounded hex, never a decoded string). The caught `WireDecodeError` / wasm-error *object* is still classified-and-dropped, never forwarded (its `.message` could echo more than the bounded prefix). Bytes reach only the main-process rotating sink (#126) under `userData` — never `onEvent`, never the renderer (Testing asserts `onEvent` carries no bytes). The log file's readability inherits #126's accepted threat model; it now additionally carries bounded *ciphertext*, which is not confidential.
- **[Network & I/O] SHOULD FIX (accepted residual).** A malicious relay flooding malformed frames now produces **one bounded log line per frame** where the pre-#133 code produced none — a small new write-amplification. Mitigated by (a) the fixed `MAX_SAFE_BYTES` cap (≤128 hex chars/line regardless of frame size; inbound frames are already `maxPayload`/`MAX_FRAME_BYTES`-bounded) and (b) #126's rotating file sink, which bounds total disk by design. A per-frame log rate-limiter is deferred per Evidence-Based Fix Selection (unobserved failure mode; rotation already bounds the real risk). Code-review should confirm the cap is applied to the raw bytes *before* hex-encoding.
- **[Trust boundaries — brand enforcement] SHOULD FIX (accepted residual).** The brand prevents *accidental* assignment of a bare string / post-decryption value into `safeBytes` (AC5 type-pin proves this). It does not structurally forbid a determined `x as SafeBytesEncoding` cast in a post-decryption file. Mitigation: `encodeSafeBytes` takes `Uint8Array` and is documented as pre-decryption-only; `inboundMessage.ts` (post-decryption) must not import it (AC4); the type-pin test guards the field shape. A `no-restricted-imports` lint would be belt-and-suspenders but is over-engineering for an unobserved failure — deferred. Code-review must verify no post-decryption module imports `encodeSafeBytes`.
- **[Inter-process / Electron attack surface] No findings.** No new IPC channel, `contextBridge` API, `BrowserWindow`, or protocol handler. Bytes stay in the main process (transport-out-of-the-window preserved).
- **[File / storage operations] No findings.** No path handling, no untrusted-path concatenation, no TOCTOU, no new files — the log lands via the existing #126 sink.
- **[Concurrency] No findings.** No new async task, listener, timer, or shared-state mutation. `event()` is synchronous single-writer inside existing catch blocks; no cancellation or teardown surface added.
- **[Threat model alignment] Addressed.** Malicious relay → bounded log lines, no plaintext/secret exposure. Hostile daemon → its own malformed bytes logged back, revealing nothing it did not send. Token-theft-from-disk → unchanged (token stays in `safeStorage`; log is content-free + bounded ciphertext). Renderer compromise → bytes never leave the main process.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-08
