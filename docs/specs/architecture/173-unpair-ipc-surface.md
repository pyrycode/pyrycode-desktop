# Spec #173 — Unpair IPC surface: value-free channel + handler + preload method + registration

Ships the renderer→main IPC surface that lets the window ask the background process to erase the
stored pairing, on top of the store-side `clear()` that already merged in #172. Four pieces, the
byte-for-byte #131 diagnostics-channel footprint: a shared **contract** (channel constant + value-
free result union), a main-side **handler**, a preload **bridge method**, and the composition-root
**registration** + teardown. No caller yet — the visible unpair action ships in renderer follow-ups
#166 / #167, exactly how the diagnostics bridge (#131) shipped ahead of its consumer (#134).

**Size:** S. Two new production files (`src/shared/ipc/unpair.ts`, `src/main/unpairHandler.ts`),
one new test file (`src/main/unpairHandler.test.ts`), two edited (`src/preload/index.ts` +2 lines,
`src/main/index.ts` +3 lines). Four new exported symbols (`UNPAIR_CHANNEL`, `UnpairResult`,
`UnpairHandleTarget`, `registerUnpairHandler`). **Zero consumer cascade** — every piece is additive;
nothing calls `unpair()` yet, and the store type widening this depends on already landed in #172.

**Design source:** N/A — no UI in this ticket. This is IPC plumbing (contract + handler + bridge +
registration) with no rendered surface; the visible unpair control lands in #166 / #167. No `## Figma`
section in the ticket body is correct, and code-review's visual-fidelity check is intentionally out
of scope here.

## Files to read first

- `src/shared/ipc/pairingStatus.ts` (whole file, 48 lines) — **the contract to clone.** A channel
  constant + a value-free discriminated union, no runtime logic, relative imports only, nothing from
  `src/main`. Its header doc-comment is the "value-free BY CONSTRUCTION" argument you restate for
  `unpair.ts`. Note it ships **no request guard** (no `isPairingRequest` sibling) because the query
  carries no body — same for unpair.
- `src/main/pairingStatusHandler.ts` (whole file, 60 lines) — **the handler to clone.** Injected
  minimal `PairingStatusHandleTarget`, single-registration + exact-teardown, `try`/`catch` that maps
  every throw to the value-free error arm and **drops the caught object** (log-free, no `console.*`).
  The only deltas for unpair: (a) type the store dep against `ClearablePairedServerStore` (not base
  `PairedServerStore`), and (b) call `store.clear()` instead of `store.load()`.
- `src/main/pairingStatusHandler.test.ts` (whole file, 114 lines) — **the test idiom to clone.**
  `fakeTarget()` (`L13-18`), `listenerOf()` (`L22-26`), the registration assertion against the
  exported constant (`L46-60`), and the value-free JSON assertion (`L103-113`, `JSON.stringify` then
  `.not.toContain(secret)`). Your fake store stubs `clear` instead of `load`.
- `src/main/pairedServerStore.ts:44-55, 133-159` — `ClearablePairedServerStore` (the handler's store
  dep type, carries `clear()`; base `PairedServerStore` deliberately does not) and `clear()`'s
  contract: keyed by the store's own `name` (`PAIRED_SERVER_NAME`), idempotent, **fail-closed — no
  `try`/`catch`, a delete failure propagates.** This is what the handler's error arm converts to a
  value-free result.
- `src/preload/index.ts:60-68, 82-92` — **the bridge method to clone** is `pairingStatus` (`L60-68`):
  a fixed-channel `ipcRenderer.invoke(CONSTANT)` with no args, narrow declared return type. And
  `PyryApi = typeof api` (`L92`) — adding `unpair` to `api` flows the type automatically, so
  **`src/preload/index.d.ts` needs no edit.**
- `src/main/index.ts:124-142` — the composition root. `pairedServerStore` is built once at `L132`
  (return type `ClearablePairedServerStore`); `registerPairingStatusHandler(ipcMain, { store:
  pairedServerStore })` + its `will-quit` teardown sit at `L141-142`. **This is the sibling slot for
  the unpair registration** — same store, no `connection` dependency, synchronous.
- `src/shared/ipc/pairing.ts:57-62` — the *alternate* `{ ok: true } | { ok: false; reason }`
  convention, read **for contrast**: unpair deliberately carries **no reason field** (value-free
  error arm). We follow `pairingStatus`'s single-discriminant style, not this one.
- `docs/knowledge/decisions/0007-content-free-diagnostics-by-construction.md` and
  `docs/knowledge/decisions/0002-remote-head-over-relay-shared-wire.md` — the "keep secrets/transport
  out of the window" boundary this value-free contract enforces.
- `docs/specs/architecture/172-paired-server-store-erase.md` — the sibling spec; its Security review
  already foreshadows this ticket's contract ("the channel must be value-free (no args) so a
  compromised renderer can at most trigger an unpair … never leak or inject a secret").

## Context

Recovery from a stale, wrong, or never-connecting pairing needs the UI to be able to trigger erasing
the persisted pairing. The renderer can never do this itself: the paired-server record (bearer
`token`, `server_static_pubkey`) lives only in the background process behind `SecureStore`
(CLAUDE.md: "keep the transport out of the window"). #172 landed the domain capability —
`createPairedServerStore` now returns a `ClearablePairedServerStore` whose `clear()` erases the
record, idempotent and fail-closed. This ticket ships the IPC surface **on top of** it, unwired: no
renderer calls it yet (that is #166 / #167). Same "ship the boundary ahead of its consumer" shape as
#131→#134.

## Design

Four additive pieces. Each mirrors an existing, merged twin — the work is faithful cloning, not
invention.

### 1. Shared contract — `src/shared/ipc/unpair.ts` (new)

A channel constant + a value-free result union, no runtime logic. Mirrors `pairingStatus.ts`
exactly, including the header doc-comment restating the value-free-by-construction argument and the
"no request guard, because the query carries no body" note.

```ts
/** The IPC channel the unpair request/response travels on, renderer ↔ main. Single source of
 *  truth: the preload invoker ships on it, the main handler registers on it. */
export const UNPAIR_CHANNEL = 'pyry:unpair' as const

/**
 * The value-free outcome of "erase the stored pairing", discriminated on `result`. Value-free BY
 * CONSTRUCTION: neither member has a field beyond the discriminant, so the handler cannot serialize
 * a token, server key, relay URL, keychain path, or any error detail back across the boundary.
 */
export type UnpairResult = { result: 'ok' } | { result: 'error' }
```

- **Discriminant style follows `pairingStatus`** (a single `result` field with string literals),
  not `pairing.ts`'s `{ ok: boolean; reason }`. The error arm carries **no reason** — a coarse
  reason category could leak backend detail, and the ticket mandates "no field beyond the
  discriminant." If a future recovery flow needs to distinguish error sub-cases it extends
  additively; do not add it speculatively now.
- Imports **nothing** from `src/main` (shared is a clean leaf loaded by preload + renderer); relative
  imports only. No `isUnpairRequest` guard — there is no request body to validate (the invoke carries
  zero arguments), so there is no untrusted-input surface at this boundary.

### 2. Main-side handler — `src/main/unpairHandler.ts` (new)

Clone of `pairingStatusHandler.ts`. Two contracts:

```ts
export interface UnpairHandleTarget {
  handle(channel: string, listener: (event: unknown) => Promise<UnpairResult>): void
  removeHandler(channel: string): void
}

export function registerUnpairHandler(
  target: UnpairHandleTarget,
  deps: { store: ClearablePairedServerStore }
): () => void
```

Behaviour (do not pre-write the body — it is ~6 lines, cloned from `pairingStatusHandler`):

- The registered listener takes **no request argument** (the invoke carries no body). It `await`s
  `store.clear()` and resolves `{ result: 'ok' }`. In a `catch` it resolves `{ result: 'error' }` —
  **classify-don't-forward**: the caught object is dropped, never inspected, logged, interpolated, or
  returned (a propagated keychain/filesystem error can carry a path). `handle` must resolve to a
  value, so the listener never rethrows.
- **Fail-closed is the whole point of the error arm.** #172's `clear()` is itself fail-closed (a
  `secureStore.delete` failure propagates rather than being swallowed). This handler's `error`
  outcome is the boundary that turns that throw into a value-free result — it must **never** resolve
  `ok` while a live bearer token may still sit on disk. So: only the *successful completion* of
  `clear()` maps to `ok`; every throw maps to `error`.
- **`console.*`-free by construction** — no logging anywhere in the module (a propagated error can
  carry a keychain/fs path), matching `pairingStatusHandler`.
- Store dep typed against the concrete `ClearablePairedServerStore` (which carries `clear()`), **not**
  base `PairedServerStore`. Register on `UNPAIR_CHANNEL`; return an unregister thunk that removes
  exactly that channel (`ipcMain.handle` allows one handler per channel). Holds no state between
  calls. Imports nothing Electron-specific — `ipcMain` satisfies `UnpairHandleTarget` structurally,
  and the unit test injects a fake.

The invariant the test pins: **the listener's ONLY store interaction is `clear()`** — never `load`/
`save`. It erases; it does not read.

### 3. Preload bridge method — `src/preload/index.ts` (edit, +2 lines)

Clone of the `pairingStatus` method. Add one import and one method to the `api` object:

```ts
// import { UNPAIR_CHANNEL, type UnpairResult } from '../shared/ipc/unpair'
unpair: (): Promise<UnpairResult> => ipcRenderer.invoke(UNPAIR_CHANNEL),
```

- `UNPAIR_CHANNEL` is **fixed here**, so the renderer cannot address arbitrary IPC channels; only
  this typed function crosses the bridge, never `ipcRenderer` itself. Called with **no second
  argument** — no data leaves the renderer; only the enum comes back.
- **No `src/preload/index.d.ts` edit** — `PyryApi = typeof api` already re-derives the window type
  from `api`, so the new method flows to `window.pyry.unpair` automatically.

### 4. Composition-root registration — `src/main/index.ts` (edit, +3 lines)

Register alongside the existing pairing-status handler at `L141-142`, over the **same**
`pairedServerStore` (do not build a second store), with symmetric `will-quit` teardown:

```ts
const unregisterUnpair = registerUnpairHandler(ipcMain, { store: pairedServerStore })
app.on('will-quit', () => unregisterUnpair())
```

- `pairedServerStore` (built at `L132`) has type `ClearablePairedServerStore`, so it satisfies the
  handler's concrete store dep with no cast and no new construction.
- **Placement:** the pairing-status slot (after `L142`), **not** the `connection`-dependent block at
  `L189`. The unpair handler needs only the store — no `connection`, no `did-finish-load` gate — so
  it belongs with the synchronous pairing-status registration. Placement is not correctness-critical
  (no caller races it — the UI is #166/#167), but grouping with its twin over the shared store is the
  readable choice and satisfies AC5's "alongside the existing pairing handlers, over the same
  paired-server store."

### Data flow (AC1 clear path)

```
renderer window.pyry.unpair()  →  ipcRenderer.invoke(UNPAIR_CHANNEL)  [no body]
  →  ipcMain handler listener  →  ClearablePairedServerStore.clear()
  →  secureStore.delete(PAIRED_SERVER_NAME)
  →  resolves { result: 'ok' }  (or { result: 'error' } on any throw)   [value-free]
```

## State + concurrency model

- **No store state.** The handler holds nothing between invokes (no pending state, unlike
  `pairingHandler`'s `pendingConfirm`) — each invoke reads through to `clear()`. Nothing to select,
  subscribe, or memoise (background-process code, not React).
- **No read-modify-write.** `clear()` is an unconditional delete; there is no check-then-act race
  across the single `await`. Concurrent invokes are last-writer-wins at the persistence layer, which
  for an idempotent delete is a no-op cascade — no coordination needed.
- **Teardown:** `ipcMain.handle` allows one handler per channel; the returned thunk `removeHandler`s
  exactly `UNPAIR_CHANNEL` on `will-quit`, symmetric with `unregisterPairingStatus`. No timers, no
  listeners, no sockets to cancel.
- **Live-session teardown is OUT OF SCOPE** (as in #172). Erasing the at-rest record does **not**
  tear down an in-flight Noise session or relay socket — the current connection lives until next
  launch. Orchestrating an active-connection teardown on unpair belongs to the #166/#167 caller or a
  later ticket; do not build it here.

## Error handling

| Failure | Layer | Behaviour |
|---|---|---|
| `store.clear()` (→ `secureStore.delete`) throws | main handler | `catch` resolves `{ result: 'error' }`. Caught object **dropped** — never logged, interpolated, or returned. Never resolves `ok`. |
| Store already not-paired (delete no-op) | persistence | `clear()` resolves; handler resolves `{ result: 'ok' }`. Idempotent — unpairing a clean state is success. |
| Handler unregistered (post-`will-quit`) | Electron | Invoke rejects in the renderer (no handler on channel) — outside this ticket's surface; the app is quitting. |

The `error` arm is the **fail-closed boundary**: it converts #172's propagated delete failure into a
value-free result without ever reporting success while a token may remain on disk. No secret,
keychain path, or error string crosses back — the union has no field to carry one, and the handler is
log-free.

## Testing strategy

Unit tests only, in `src/main/unpairHandler.test.ts`, cloning `pairingStatusHandler.test.ts`'s
fake-driven idiom — no keychain, no filesystem, no Electron harness (`npm test`, vitest). The fake
target is `{ handle: vi.fn(), removeHandler: vi.fn() }`; the fake store satisfies
`ClearablePairedServerStore` with inert `save`/`load` (`vi.fn()`) and a **`clear` stub** carrying the
scenario's behaviour (the only method the handler touches). Scenarios (developer writes them in the
project's vitest idiom, as bullet points not full bodies):

- **Registration + exact teardown (AC1, AC5):** `registerUnpairHandler(fakeTarget, { store })` calls
  `handle` exactly once with `(UNPAIR_CHANNEL, function)` — assert against the **exported constant**,
  not a string literal, so a channel rename can't silently pass. The returned thunk calls
  `removeHandler(UNPAIR_CHANNEL)` exactly once.
- **Success → ok (AC2):** `clear` resolves; drive the extracted listener → resolves `{ result: 'ok' }`.
- **Erase actually happens (AC2):** on a successful invoke, `store.clear` was called **exactly once**
  and `store.load`/`store.save` were **never** called — proves it erases, not reads.
- **Failure → value-free error (AC2), resolves-never-rejects:** `clear` rejects with an `Error` whose
  message carries a secret-shaped path (e.g. `'delete failed: /Users/x/Library/Keychains/...'`);
  drive the listener → `await expect(listener({})).resolves.toEqual({ result: 'error' })` (resolves,
  never rejects — `handle` must produce a value).
- **No secret / detail crosses back (AC1, AC2 — the value-free assertion):** in the failure scenario
  above, `JSON.stringify(await listener({}))` **does not contain** the thrown message's path
  substring; and the success result stringifies to exactly `{"result":"ok"}` (no extra field). Mirror
  `pairingStatusHandler.test.ts:103-113`.
- **Log-free (AC2):** spy `console.error`/`console.log`/`console.warn`; assert **none** called on
  either the ok path or the error path. Deterministic net for "no `console.*` in the handler" — the
  place a propagated keychain/fs error would otherwise leak.

Type coverage (`npm run typecheck`) confirms: (a) the handler's `deps.store: ClearablePairedServerStore`
accepts `pairedServerStore` at the composition root with no cast, and (b) `unpair` on the preload
`api` flows to `window.pyry.unpair` via `PyryApi = typeof api` (no `index.d.ts` edit). If either
broke, `index.ts` / the renderer type would fail to compile.

## Open questions

None. The design is fully determined by the ticket body, the merged #172 store, and the
`pairingStatus` twin it clones. The one judgement call — value-free single-discriminant result with
no reason field vs. a `pairing`-style `{ ok, reason }` — is settled by the ticket's explicit "no
field beyond the discriminant" and the `pairingStatus` precedent it names.

## Security review

**Verdict:** PASS

Adversarial self-review per the architect security-review pass (label `security-sensitive`). This
ticket **introduces a renderer→main IPC boundary**, so unlike #172 (which added no boundary) the
trust-boundary and Electron-attack-surface categories are load-bearing here, not N/A.

**Findings:**

- **[Trust boundaries]** No findings. The invoke carries **no request body** (zero arguments), so
  there is no untrusted input to validate — the value-free contract makes an `isUnpairRequest` guard
  unnecessary by construction (same as `pairingStatus`). The one thing the renderer can do is
  *trigger* the erase; it cannot parameterise it (no channel, name, or record field is caller-
  controlled — `clear()` is keyed by the fixed `PAIRED_SERVER_NAME` constant inside #172's store).
- **[Tokens, secrets, credentials]** No findings — positive-posture change. The response union has
  **no field beyond the discriminant**, so the handler *cannot* serialize a token,
  `server_static_pubkey`, relay URL, keychain path, or error detail back to the renderer — value-free
  by construction, statically enforced by the union type. The success path *destroys* the at-rest
  bearer token, shrinking the token-theft-from-disk window. **MUST-verify at code-review:** the
  `catch` drops the caught object entirely (no `console.*`, no return of `error.message`) — a
  propagated `secureStore.delete` error can carry a filesystem/keychain path.
- **[Inter-process / Electron attack surface]** No findings, and this is the load-bearing scope check.
  The preload exposes **one** typed method **fixed** to `UNPAIR_CHANNEL` — the renderer cannot address
  arbitrary channels, and `ipcRenderer` never crosses the bridge (only the typed function does). A
  compromised renderer can at most invoke `unpair()` and erase the local pairing — an **availability
  annoyance** (the user re-pairs), never a secret leak or injection. This is **symmetric with the
  existing capability**: a renderer that can already `submitPairingPaste`/`confirmPairing` (establish
  or overwrite pairing) being able to erase it introduces no new class of power. `ipcMain.handle`
  allows one handler per channel; the single registration + `will-quit` teardown prevents duplicate/
  leaked handlers. **Accepted, no mitigation needed** — exposing this capability to the app's own UI
  is the ticket's purpose.
- **[Availability / destructive action]** Considered. Unpair is destructive but **recoverable** (the
  user re-pairs from the paste) and does **not** touch the device static keypair: #172's `clear()`
  deletes only `PAIRED_SERVER_NAME`, a distinct name in a distinct store from
  `pyrycode.device_static`. No confirmation gate is in scope here (that is UI, #166/#167) — this
  ticket only ships the mechanism. No mass/remote destructive reach: the action is local, single-
  record, single-user.
- **[File / storage operations]** No findings. The handler performs no file/path operation itself; it
  delegates to #172's `clear()`, which deletes by a fixed constant (no path traversal, no caller
  input, no TOCTOU — a single unconditional idempotent delete). Encryption-at-rest and atomic-write
  concerns are owned by the unchanged `SecureStore`/`SecretPersistence` adapters.
- **[Fail-closed correctness]** No findings — verified. The handler resolves `ok` **only** on
  successful completion of `clear()`; every throw maps to the value-free `error`. It can never report
  success while a live bearer token remains on disk. Pinned by the "failure → error / resolves-never-
  rejects" test.
- **[Cryptographic primitives]** N/A. No key material, no crypto, no comparison, no RNG — the handler
  triggers a stored-blob delete.
- **[Network & I/O]** N/A. No socket, relay, or network path is touched. Live-session teardown is
  explicitly out of scope — erasing at-rest storage does not tear down an in-flight Noise session.
- **[Error messages, logs, telemetry]** No findings. Log-free by construction; the caught error is
  dropped, not logged or returned. Covered by the log-free test on both the ok and error paths.
- **[Threat model alignment]** Aligned. Token-theft-from-disk: reduced (the token is erased).
  Renderer compromise reaching secrets: blocked — the value-free contract means a compromised renderer
  gains only the ability to trigger an unpair, never to read or inject a secret. Malicious relay /
  hostile daemon: N/A (no network). Device-identity preservation: the device keypair survives (#172
  scope proof).

**Reviewer:** architect (self-review, `security-sensitive` label)
**Date:** 2026-07-08
