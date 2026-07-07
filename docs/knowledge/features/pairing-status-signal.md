# Pairing-status signal

The launch-time answer to one question — **"does a stored pairing already exist?"** — served from the background process to the renderer over a dedicated request/response IPC channel, so the app shell can pick a screen (pairing vs. conversation) **before first paint** without inferring pairing state from a connection error.

Introduced in [#79](../codebase/79.md). It is the **data-path half** of the app-shell composition; the renderer routing that consumes it is **#80** (blocked on this slice). It is a smaller, stateless sibling of the [pairing IPC channel](pairing-ipc-channel.md) (#54): same three-layer shape (shared contract, main handler, preload bridge), same "value-free by construction" reply discipline, but no held state and no request body.

## The problem it removes

Before #79, the only pairing-related fact reaching the renderer was a **connection error**: when no pairing exists, [`daemonConnection`](daemon-connection.md) emits `failed{ code: 'not-paired' }` **after** the connect sequence (`connecting` → `failed`, `src/main/daemonConnection.ts:176-178`). That is unusable as a routing signal for two reasons:

1. **It arrives late.** It is *pushed* only after the connect attempt runs, so a renderer routing on it would first show the wrong screen and then flip.
2. **It is error-shaped.** The conversation UI renders it as a failure banner, conflating "first run, never paired" with "connection failed."

The background process already holds the authoritative fact — [`pairedServerStore.load()`](paired-server-store.md) returns the record, `null`, or throws — but never exposed a clean "is there a pairing?" answer. This slice exposes exactly that fact, and nothing more.

## What it does

Gives the renderer **one typed function** (`window.pyry.pairingStatus()`) and the background process **one typed handler** behind a single channel. The renderer calls it and `await`s a **three-outcome** enum before it decides what to render:

- **`paired`** — `load()` returned a present, valid record.
- **`not-paired`** — `load()` returned `null`. This is the **only** path to `not-paired`.
- **`error`** — `load()` threw: a decoded-but-malformed record (`MalformedPairedServerRecordError`) **or** a propagated decrypt failure (tamper / keychain rotation). Both surface as a throw; a single type-blind `catch` maps both to `error`.

The response ever carries **only** the `status` discriminant — never the `token`, `server_static_pubkey`, `relay`, `server`-id, or any record field.

## The load-bearing invariant

> **`null` is the only path to `not-paired`; every throw is `error`.**

The `error` outcome is deliberately **distinct** from `not-paired` and is never collapsed into it. [ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md) forbids masking an unreadable (tampered / undecryptable) record as never-paired — doing so would silently downgrade a security-relevant failure into a benign "first run." Keeping `error` separate preserves that. What the renderer *does* with each outcome (re-pair prompt vs. hard error) is **out of scope** — #80 owns routing, and ADR 0005 defers the recovery policy to #43/#44.

## How it works

Three layers mirroring the pairing channel, plus one line at the composition root:

| Piece | File | Layer |
|---|---|---|
| `PAIRING_STATUS_CHANNEL` + `PairingStatus` union | `src/shared/ipc/pairingStatus.ts` (new) | shared |
| `registerPairingStatusHandler(target, deps)` + structural `PairingStatusHandleTarget` | `src/main/pairingStatusHandler.ts` (new) | background |
| `window.pyry.pairingStatus()` | `src/preload/index.ts` (mod) | preload bridge |
| single `handle` registration + `will-quit` teardown | `src/main/index.ts` (mod) | composition root |

### 1. The shared contract (`src/shared/ipc/pairingStatus.ts`)

A channel constant + a sealed union, **no runtime logic** — the same shape as [`events.ts`](daemon-event-channel.md), which is precedent that a `src/shared/ipc/*` module can be just a constant + a discriminated union with no companion runtime test. Imports nothing from `src/main`; relative imports only (no `@shared` alias in preload/main — project memory `shared-alias-not-available-in-main-preload`).

```ts
export const PAIRING_STATUS_CHANNEL = 'pyry:pairing-status' as const

export type PairingStatus =
  | { status: 'paired' }
  | { status: 'not-paired' }
  | { status: 'error' }
```

- **Value-free by construction.** No member declares any field beyond the `status` discriminant, so the handler *cannot* serialize a secret back — the type is the enforcement, exactly as the [pairing channel](pairing-ipc-channel.md)'s response union is.
- **No request guard.** Unlike `pairing.ts`, this module ships **no `isPairingRequest` sibling**: the query carries **no request body** (the renderer invokes with zero arguments), so there is no untrusted request field to validate. The only untrusted-input surface `pairing.ts` guards — the pasted payload — simply does not exist here. The module doc-comment notes this contrast deliberately.
- **Kept minimal.** No speculative error-sub-reason field distinguishing the two error sub-cases; #43/#44 own recovery policy and will extend additively if they ever need it.

### 2. The main-process handler (`src/main/pairingStatusHandler.ts`)

The injected-target, single-registration sibling of [`pairingHandler.ts`](pairing-ipc-channel.md), but **stateless** — it holds nothing between calls (no `pendingConfirm`), reads the store on each invoke, and takes **no request argument**. No `electron` import; the target is injected structurally, so it unit-tests with a `{ handle: vi.fn(), removeHandler: vi.fn() }` fake.

```ts
export interface PairingStatusHandleTarget {
  handle(channel: string, listener: (event: unknown) => Promise<PairingStatus>): void
  removeHandler(channel: string): void
}

export function registerPairingStatusHandler(
  target: PairingStatusHandleTarget,
  deps: { store: PairedServerStore }
): () => void
```

The whole listener is ~6 lines:

```ts
const listener = async (): Promise<PairingStatus> => {
  try {
    const record = await store.load()
    return record === null ? { status: 'not-paired' } : { status: 'paired' }
  } catch {
    return { status: 'error' }   // classify-don't-forward: the caught object is DROPPED
  }
}
```

- **Classify-don't-forward.** The caught object is **dropped** — never logged, interpolated, or returned. Its message could echo a filesystem path (decrypt failure) or record bytes (malformed). The single `catch` covers *both* mandated error sub-cases because both surface as a throw out of `load()`; the handler does **not** — and must not — inspect the error type.
- **Log-free by construction — no `console.*` anywhere.** A propagated decrypt-failure error can carry a filesystem path or OS-keychain detail, so any `console.error('...', err)` would leak it. This matches the `secureStore` / `pairedServerStore` / `daemonConnection` posture. Unlike `pairingHandler` (which logs one fixed value-free string on a malformed request), this handler has no untrusted-request path and therefore no reason to log at all — code-review rejects any `console.*` here.
- **Never rethrows.** `handle` must resolve to a value; the two error cases resolve to `{ status: 'error' }`, they never reject.

### 3. Preload bridge (`src/preload/index.ts`)

One thin method on the existing `api` object, mirroring `submitPairingPaste`'s fixed-channel discipline:

```ts
pairingStatus: (): Promise<PairingStatus> => ipcRenderer.invoke(PAIRING_STATUS_CHANNEL),
```

`PAIRING_STATUS_CHANNEL` is hardcoded here so the renderer cannot address arbitrary channels; `ipcRenderer` never crosses the bridge; the invoke is called with **no second argument** — no data leaves the renderer. `PyryApi = typeof api` flows the method to `window.pyry` automatically; `src/preload/index.d.ts` stays **untouched** — zero cascade (the #54 precedent). `ipcRenderer.invoke` returns `Promise<any>`, so the narrower declared `Promise<PairingStatus>` is an honest typed wrapper, not an unchecked cast.

### 4. Composition root (`src/main/index.ts`)

Inside `app.whenReady().then(...)`, after `pairedServerStore` is constructed, registered with **that same store instance** (do not construct a second store) and torn down on `will-quit`, symmetric with `unregisterPairing`:

```ts
const unregisterPairingStatus = registerPairingStatusHandler(ipcMain, { store: pairedServerStore })
app.on('will-quit', () => unregisterPairingStatus())
```

`ipcMain` satisfies `PairingStatusHandleTarget` structurally (it has `handle`/`removeHandler`), exactly as it satisfies `PairingHandleTarget`. Registration happens **synchronously in `whenReady`, before `createWindow()`** and before the renderer document loads — so the handler is guaranteed present when the renderer's first `invoke` arrives.

## Why `invoke`, not a startup event

The transport is a **pulled** request/response `invoke`, deliberately **not** a startup event on the daemon-event channel — for two reasons:

1. **Additive-only.** A startup event would grow the `DaemonEvent` union, which the ticket forbids.
2. **Determinism.** An event is *pushed* and would race `connecting` / `failed` — exactly the late-signal anti-pattern this slice removes. An `invoke` is *pulled*: the renderer calls `pairingStatus()` and `await`s the answer, resolved from a **single cache-free `store.load()`**, independent of `connection.start()` and the daemon-event channel.

A **new channel, not an extra member on `pyry:pairing`**: the pairing handler holds submit→confirm round-trip state; this query is a stateless read. Keeping them separate leaves `PairingRequest` / `isPairingRequest` / `pairingHandler` untouched, matching how commands and events are already separate channels per concern.

## Determinism and concurrency

- **No shared-state race with the connect sequence.** `PairedServerStore.load()` is stateless — no cache, it reads through on every call. The status query's `load()` and `daemonConnection.bootstrap`'s `load()` are two **independent read-only concurrent reads** over the same store; there is no writer in this flow, so no check-then-act gap and no ordering dependency. The status answer therefore does not race the connect sequence (the determinism AC).
- **No mutable state, single await.** The handler holds nothing between calls; the listener awaits exactly once (`load()`) and returns — no read-then-mutate across the await, no interleaving hazard.
- **Teardown.** Nothing to cancel beyond `removeHandler`, wired on `will-quit` — no timers, no long-lived tasks. Symmetric with the pairing handler's teardown; single registration for the app lifetime (`ipcMain.handle` allows one handler per channel).

## Error handling

| `load()` outcome | Source | Response |
|---|---|---|
| resolves a record | present + valid blob | `{ status: 'paired' }` |
| resolves `null` | absent blob (`secureStore.get` → `null`) | `{ status: 'not-paired' }` |
| throws `MalformedPairedServerRecordError` | present, decrypts, but not the record shape | `{ status: 'error' }` |
| throws (other) | present but undecryptable — tamper / keychain rotation; decrypt failure propagates out of `secureStore.get` | `{ status: 'error' }` |

The single `catch` maps **every** throw to `error` without inspecting the error, and drops the caught object. The handler never throws out of itself. No network, socket, or parse failure modes apply — there is no transport in this path; the only failure surface is the local store read.

## Edge cases and limitations

- **`error` is opaque by design.** A single `error` value deliberately does not distinguish tamper from keychain-rotation — it leaks nothing about *why* a record is unreadable. If #43/#44 ever need the distinction, they extend the union additively.
- **Recovery is a consumer decision.** This slice only guarantees `error` is *distinguishable* from `not-paired`. What the renderer does with it (re-pair prompt vs. hard error) is #80's / #43/#44's concern, not baked in here.
- **The `failed{ code: 'not-paired' }` connection event is untouched.** This signal *replaces it as a routing source*, but the connection-lifecycle events stay exactly as they are (`daemonConnection.ts` is not modified) — additive only.
- **Repeated invokes are cheap.** Each is an independent local `store.load()` with no amplification, no state mutation, and no secret returned — not a meaningful DoS vector for an already-compromised renderer.

## Security posture

**Verdict: PASS** (architect security-review in the spec; `security-sensitive`-adjacent local store read).

- **Empty untrusted-input surface.** The renderer→main `invoke` carries no request body, so there is nothing to validate — the deliberate contrast with `pairing.ts`'s `isPairingRequest`.
- **Value-free reply by construction.** The response type structurally cannot carry the token / server key / relay URL; a runtime backstop test (`JSON.stringify(res)` contains none of a secret-shaped record's fields) locks it in.
- **Classify-don't-forward + log-free.** Caught errors are dropped, never logged or interpolated, so a decrypt-failure message carrying a filesystem/keychain path cannot leak to the renderer console.
- **Minimal Electron capability.** `webPreferences` untouched (`sandbox: true`, `contextIsolation: true`); the new IPC surface takes **zero arguments** and returns a closed 3-value enum — no filesystem, no socket, no record data. `ipcRenderer` never crosses the bridge.
- **Minimum disclosure.** The signal discloses pairing *existence* only, never the token — the least a routing decision needs.

## Related

- [Pairing IPC channel](pairing-ipc-channel.md) / [#54](../codebase/54.md) — the stateful request/response sibling this mirrors; read for the boundary-guard rationale and the `invoke`-vs-`send` contrast (this slice is its stateless, body-free counterpart)
- [Paired-server store](paired-server-store.md) / [#44](../codebase/44.md) — `load()`, the source of all three outcomes; the `null`-only-on-absence / throw-on-unreadable semantics this handler classifies
- [Daemon connection](daemon-connection.md) / [#62](../codebase/62.md) — the `failed{ code: 'not-paired' }` this signal replaces as a routing source (and leaves untouched)
- [Daemon-event channel](daemon-event-channel.md) / [#18](../codebase/18.md) — the `events.ts` "constant + union, no runtime logic" precedent this shared module follows; the push channel this slice deliberately does *not* grow
- [ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md) — "decrypt failure propagates, never masked as absence; recovery is a consumer decision" — the rationale the `error` outcome exists to preserve
- [#79 codebase notes](../codebase/79.md) · Spec: `docs/specs/architecture/79-launch-time-pairing-status-signal.md`
