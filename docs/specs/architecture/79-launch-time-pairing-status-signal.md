# #79 — Launch-time signal: does a stored pairing exist?

## Files to read first

- `src/main/pairedServerStore.ts:31-138` — `PairedServerStore` interface and `load()` semantics. **The source of all three outcomes:** returns a record (paired), returns `null` (not-paired — the *only* null path), throws `MalformedPairedServerRecordError` on a decoded-but-malformed blob, or propagates a decrypt failure out of `secureStore.get`. Read the `load()` doc-comment at :131-136 closely.
- `src/main/secureStore.ts:54-95` — `SecureStore.get`: absent → `null`, present-but-undecryptable → the decrypt throw *propagates* (it is NOT a `MalformedPairedServerRecordError`). This is the second error sub-case the AC mandates.
- `src/main/pairingHandler.ts:29-103` — the pattern to mirror: an injected `PairingHandleTarget` (structural stand-in for `ipcMain`), single-registration, exact-channel teardown, value-free responses, guard-then-handle. Your handler is a smaller sibling of this one.
- `src/main/pairingHandler.test.ts:1-55, 202-220` — the test idiom to copy verbatim: `fakeTarget()` = `{ handle: vi.fn(), removeHandler: vi.fn() }`, `listenerOf(target)` pulls the registered listener out of `target.handle.mock.calls[0][1]` and drives it directly; the "never returns a secret in any response" assertion (`JSON.stringify(res)` must not contain the token/key/relay).
- `src/shared/ipc/pairing.ts:17-62` — the channel-constant + value-free-response idiom this slice mirrors. Note the contrast: pairing needs `isPairingRequest` because `submit` carries an untrusted paste; **this slice's query carries no request body, so it needs no request guard** (§ Trust boundary below).
- `src/shared/ipc/events.ts:14-37` — precedent that a `src/shared/ipc/*` module can legitimately be *just* a channel constant + a discriminated union with no runtime logic and no companion runtime test.
- `src/preload/index.ts:34-43` — where and how the new `invoke` wrapper is added; the fixed-channel / never-cross-`ipcRenderer` discipline every bridge method follows. `PyryApi = typeof api` (line 67) picks up the new method automatically; `src/preload/index.d.ts` needs no edit.
- `src/main/index.ts:100-138` — the composition root. `pairedServerStore` is already constructed at :109; the pairing handler is registered at :113 with `will-quit` teardown at :117. Register the new status handler in the same block, reusing that same store.
- `src/main/daemonConnection.ts:79-86, 173-179` — the current `failed{ code: 'not-paired' }` this signal *replaces as a routing source*. Confirms the additive-only constraint: **do not touch this file** — the connection-lifecycle events stay exactly as they are.
- `docs/knowledge/decisions/0005-secret-at-rest-safestorage-fail-closed.md` — the "decrypt failure propagates, never masked as absence" and "recovery is a consumer decision" rationale the `error` outcome exists to preserve.

## Context

The renderer has two screens (pairing, conversation) but no launch-time way to learn whether the device is already paired. Today the only pairing-related fact reaching the renderer is a *connection error*: `daemonConnection` emits `failed{ code: 'not-paired' }` **after** the connect sequence (`connecting` → `failed`, `src/main/daemonConnection.ts:176-178`). That is unusable as a routing signal — it arrives late (the renderer would show the wrong screen, then flip) and it is error-shaped (the conversation UI renders it as a failure banner, conflating "never paired" with "connection failed").

The background process already holds the authoritative fact: `pairedServerStore.load()` returns the record, `null`, or throws. This slice exposes that fact to the renderer as a clean, connect-independent, value-free answer. It is the **data-path half** of the app-shell composition; the renderer routing that consumes it is **#80** (blocked on this slice). What the renderer *does* with each outcome (re-pair prompt vs. hard error) is out of scope here.

## Design

### Transport decision: a dedicated request/response `invoke` channel

A new channel `pyry:pairing-status`, request/response via `ipcRenderer.invoke` / `ipcMain.handle`, mirroring the existing pairing channel's shape. **Not** a startup event on the daemon-event channel, for two reasons:

1. **Additive-only constraint.** A startup event would mean growing the `DaemonEvent` union — which the ticket forbids ("do not change the daemon-event union's connection-lifecycle members").
2. **Determinism.** An event is *pushed* and would race `connecting`/`failed` — exactly the anti-pattern this ticket removes. An `invoke` is *pulled*: the renderer calls `window.pyry.pairingStatus()` and `await`s the answer before it decides what to render. The answer resolves from a single local store read, independent of `connection.start()` and the daemon-event channel.

**A new channel, not an extra member on `pyry:pairing`.** The pairing handler holds submit→confirm round-trip state (`pendingConfirm`); the status query is a stateless read. Keeping them separate leaves `PairingRequest` / `isPairingRequest` / `pairingHandler` untouched and matches how commands (`pyry:command`) and events (`pyry:daemon-event`) are already separate channels per concern.

### Module 1 — shared contract: `src/shared/ipc/pairingStatus.ts` (new)

Types + a channel constant, no runtime logic (the `events.ts` precedent). Contract:

```ts
export const PAIRING_STATUS_CHANNEL = 'pyry:pairing-status' as const

// Three outcomes, discriminated on `status`. Value-free BY CONSTRUCTION: no member
// declares any field beyond the discriminant, so the handler cannot serialize a token,
// server key, relay URL, or record field back across the boundary (the events.ts / pairing.ts
// argument). Keep it minimal — do NOT add a speculative error-sub-reason field; #43/#44
// own recovery policy and will extend additively if they ever need it.
export type PairingStatus =
  | { status: 'paired' }      // load() returned a present, valid record
  | { status: 'not-paired' }  // load() returned null — the ONLY not-paired path
  | { status: 'error' }       // load() threw (malformed record OR propagated decrypt failure)
```

No request guard. The query carries **no request body** (see § Trust boundary), so there is no untrusted request field to validate — the contrast with `pairing.ts`'s `isPairingRequest` is deliberate and should be noted in the module doc-comment.

### Module 2 — main handler: `src/main/pairingStatusHandler.ts` (new)

The injected-target, single-registration sibling of `pairingHandler.ts`:

```ts
// Structural stand-in for ipcMain — unit-tested with { handle: vi.fn(), removeHandler: vi.fn() },
// no Electron harness. Listener takes only the invoke event (no request arg — there is no body).
export interface PairingStatusHandleTarget {
  handle(channel: string, listener: (event: unknown) => Promise<PairingStatus>): void
  removeHandler(channel: string): void
}

// Registers the single status handler; returns an unregister handle that removes the exact channel.
export function registerPairingStatusHandler(
  target: PairingStatusHandleTarget,
  deps: { store: PairedServerStore }
): () => void
```

Listener behavior (the whole body is ~6 lines — do not expand it):

1. `try { const record = await store.load() }` → `record === null ? { status: 'not-paired' } : { status: 'paired' }`.
2. `catch` (any throw) → `{ status: 'error' }`. **Classify-don't-forward:** the caught object is DROPPED — its message could echo a filesystem path (decrypt failure) or record bytes (malformed). It is never logged, never interpolated, never returned. This single catch covers *both* mandated error sub-cases (`MalformedPairedServerRecordError` and the propagated decrypt failure) because both surface as a throw out of `load()`; the handler does not — and must not — inspect the error type.
3. Never rethrows: `handle` must resolve to a value.

**The module is log-free by construction — no `console.*` anywhere** (the `secureStore` / `pairedServerStore` / `daemonConnection` posture). A propagated decrypt-failure error can carry a filesystem path or OS keychain detail, so a `console.error('pairing status failed', err)` would leak it. Do not log the caught object. Unlike `pairingHandler` (which logs one fixed value-free string on a malformed request), this handler has no untrusted-request path and therefore no reason to log at all. Code-review must reject any `console.*` in this module.

The invariant the AC turns on: **`null` is the only path to `not-paired`; every throw is `error`.** The error outcome is never collapsed into not-paired (ADR 0005).

### Module 3 — preload bridge: `src/preload/index.ts` (modify)

Add one method to the `api` object, mirroring `submitPairingPaste`'s fixed-channel discipline:

```ts
pairingStatus: (): Promise<PairingStatus> => ipcRenderer.invoke(PAIRING_STATUS_CHANNEL),
```

Import `PAIRING_STATUS_CHANNEL, type PairingStatus` from `../shared/ipc/pairingStatus`. `PyryApi = typeof api` exposes it to the renderer automatically; `src/preload/index.d.ts` is unchanged. Invoke is called with no second argument — no data leaves the renderer.

### Module 4 — composition root: `src/main/index.ts` (modify)

Inside `app.whenReady().then(...)`, after `pairedServerStore` is constructed (:109), register the new handler with **that same store instance** (do not construct a second store) and tear it down on `will-quit`, symmetric with `unregisterPairing`:

```ts
const unregisterPairingStatus = registerPairingStatusHandler(ipcMain, { store: pairedServerStore })
app.on('will-quit', () => unregisterPairingStatus())
```

`ipcMain` satisfies `PairingStatusHandleTarget` structurally (it has `handle`/`removeHandler`), exactly as it satisfies `PairingHandleTarget`. Registration happens synchronously in `whenReady`, before `createWindow()` and before the renderer document loads — so the handler is guaranteed present when the renderer's first `invoke` arrives.

## State + concurrency model

- **No store, no mutable state.** Unlike `pairingHandler` (which holds `pendingConfirm`), this handler holds nothing between calls. Each invoke is an independent `store.load()`.
- **No shared-state race with the connect sequence.** `PairedServerStore.load()` is stateless — no cache, it reads through on every call (`pairedServerStore.ts:131-136`). The status query's `load()` and `daemonConnection.bootstrap`'s `load()` (`daemonConnection.ts:175`) are two independent concurrent reads over the same read-only store; there is no writer in this flow, so no check-then-act gap and no ordering dependency. The status answer therefore does not race the connect sequence (AC2).
- **Single `await`, no interleaving hazard.** The listener awaits exactly once (`load()`) and returns; there is no read-then-mutate across the await.
- **Teardown.** Nothing to cancel beyond `removeHandler`, wired on `will-quit` — no timers, no listeners, no long-lived tasks. Symmetric with the pairing handler's teardown.

## Error handling

| `load()` outcome | Source | Response |
|---|---|---|
| resolves a record | present + valid blob | `{ status: 'paired' }` |
| resolves `null` | absent blob (`secureStore.get` → null) | `{ status: 'not-paired' }` |
| throws `MalformedPairedServerRecordError` | present, decrypts, but not the record shape (`decodeRecord`) | `{ status: 'error' }` |
| throws (other) | present but undecryptable — tamper / keychain rotation; decrypt failure propagates out of `secureStore.get` | `{ status: 'error' }` |

The handler's single `catch` maps every throw to `error` without inspecting the error, and DROPS the caught object. The handler never throws out of itself. No network, socket, or parse failure modes apply here — there is no transport in this path; the only failure surface is the local store read.

## Testing strategy

`src/main/pairingStatusHandler.test.ts` (new), vitest, against a **fake `PairedServerStore`** (`{ save, load }` where only `load` is exercised) — no keychain, no filesystem, no Electron. Copy the `fakeTarget()` / `listenerOf()` idiom from `pairingHandler.test.ts:10-23`. Scenarios (bullets, not full bodies):

- **Registration/teardown:** `registerPairingStatusHandler` calls `target.handle` exactly once with `PAIRING_STATUS_CHANNEL` (assert against the exported constant, not a literal); the returned unregister calls `target.removeHandler` once with the same channel.
- **present/valid → paired:** fake `load` resolves a record → listener resolves `{ status: 'paired' }`.
- **absent → not-paired:** fake `load` resolves `null` → `{ status: 'not-paired' }`.
- **malformed-throw → error:** fake `load` rejects with `new MalformedPairedServerRecordError()` → `{ status: 'error' }`.
- **propagated-decrypt-failure → error:** fake `load` rejects with a *generic* `Error` (NOT a `MalformedPairedServerRecordError`, simulating the decrypt failure propagating out of `secureStore.get`) → `{ status: 'error' }`. Asserting a plain `Error` here is what proves the handler doesn't branch on the error type.
- **never rejects:** the two error cases resolve (via `expect(...).resolves`), never reject — `handle` must produce a value.
- **secret-free (mirror `pairingHandler.test.ts:202-220`):** with a record carrying secret-shaped `token` / `server_static_pubkey` / `relay`, the `paired` response `JSON.stringify`'d contains none of them — a runtime backstop to the by-construction guarantee.

Type-level coverage of the shared contract is via `npm run typecheck`; the shared module has no runtime logic, so it needs no companion runtime test (the `events.ts` precedent). `npm run build` is the salvage/QA gate.

## Out of scope (do not implement here)

- Renderer consumption / screen routing on the answer — **#80**.
- Recovery policy for the `error` outcome (re-pair prompt vs. hard error) — ADR 0005 defers this to **#43/#44**; this slice only guarantees `error` is *distinguishable* from `not-paired`.
- Any change to wire types, the `DaemonEvent` union, or the connection-lifecycle events — additive-only.

## Open questions

- **`PairingStatusHandleTarget` export.** Exported for test-typing parity with `PairingHandleTarget`. If the test types its fake structurally without importing the interface, it may stay module-internal — developer's call, no behavior impact.
- None blocking.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — the renderer→main `invoke` carries **no request body**, so the untrusted-input surface is empty and there is nothing to validate (deliberate contrast with `pairing.ts`'s `isPairingRequest`, which guards an untrusted paste). The boundary is a single explicit function (the handler listener). The main→renderer response is a closed 3-value union that is value-free by construction — no member declares a field that could hold a secret, so #80 downstream receives only `PairingStatus`, never record data. The disk→memory boundary (malformed/undecryptable blob) is handled by the inherited `pairedServerStore.load()` and surfaced as opaque `error`; the handler never trusts an unreadable blob.
- [Tokens, secrets, credentials] No findings — no token is generated, stored, or transmitted here; the existing `safeStorage`-backed `pairedServerStore` is reused unchanged. The response type structurally cannot carry the token / server key / relay URL, and caught errors are dropped (classify-don't-forward). Token lifecycle/rotation/revocation is out of scope for an existence-read (owned by #43/#44).
- [File / storage operations] No findings — no new filesystem path is constructed; the store name is a fixed constant (`PAIRED_SERVER_NAME`) and the injected store is reused, so no untrusted input reaches any path. Single `load()` per invoke — no check-then-open TOCTOU. Encryption-at-rest is inherited unchanged.
- [Inter-process / Electron attack surface] No findings — `webPreferences` are untouched (`sandbox: true`, `contextIsolation: true`, `nodeIntegration` unset/false, `index.ts:32-33`). The new IPC surface takes **zero arguments** and returns a closed 3-value enum — a minimal capability, not a broad one (no filesystem, no socket, no record data). `ipcRenderer` and Node primitives never cross the bridge; only the typed wrapper does, with the channel fixed in it. Repeated invokes are cheap local reads with no amplification, no state mutation, and no secret returned — not a meaningful DoS vector for an already-compromised renderer. Every secret and the decrypt stay main-side.
- [Cryptographic primitives] N/A — this slice performs no cryptographic operation. It reads an already-decrypted result (or a propagated decrypt failure) from the inherited secure store; no RNG, no comparison, no key/nonce handling, no hand-rolled crypto.
- [Network & I/O] N/A — no network or socket I/O in this path. The only I/O is the inherited local store read, bounded by the OS keychain/filesystem, not a remote peer. Frame caps, relay-URL validation, TLS, timeouts, and reconnect all live in the untouched transport layer.
- [Error messages, logs, telemetry] SHOULD FIX — **addressed inline** (§ Design, Module 2): a propagated decrypt-failure error can carry a filesystem path / OS detail, so the handler must be log-free by construction (no `console.*`) and must drop the caught object rather than log or interpolate it. The spec now states this explicitly and directs code-review to reject any `console.*` in the module. No secret reaches the renderer console — only the value-free enum crosses.
- [Concurrency] No findings — the handler holds no mutable state; the flow has no writer (both this `load()` and `daemonConnection.bootstrap`'s `load()` are read-only concurrent reads over a cache-free store), so there is no check-then-act gap and no ordering dependency; single-await listener; teardown via `will-quit` (`removeHandler`), symmetric with the pairing handler. Window-close mid-`load()` leaves no partial state and exposes no secret.
- [Threat model alignment] No findings — the malicious-relay and hostile-daemon threats do not apply to this local store read (no relay, no daemon in the path). Token-theft-from-disk is not weakened: the signal discloses pairing *existence* only, never the token — minimum disclosure for routing. Renderer-compromise-reaching-transport is stopped by process isolation: the new bridge method can only return an enum, never be leveraged toward keys/token/socket. The opaque single `error` value deliberately does not distinguish tamper vs. keychain-rotation, so it leaks nothing about *why* a record is unreadable (a positive of keeping the union minimal).

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-07
