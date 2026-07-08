# Unpair channel

The renderer→main IPC surface that lets the window ask the background process to **erase the stored
pairing** and return the app to a clean, not-paired state — the recovery mechanism for a stale,
wrong, or never-connecting pairing.

Introduced in [#173](../codebase/173.md), on top of [#172](../codebase/172.md)'s
`ClearablePairedServerStore.clear()`. It is the **byte-for-byte twin** of the [pairing-status
signal](pairing-status-signal.md) (#79/#80): same three-layer shape (shared contract, main handler,
preload bridge) plus a composition-root registration line, same value-free-by-construction reply
discipline, no held state, no request body. Where pairing-status *reads* a fact, unpair *triggers a
mutation* — the destructive-action counterpart in the same family as the [diagnostics
channel](diagnostics-channel.md) (#131), which established the general "ship the IPC boundary ahead
of its UI consumer" shape this ticket reuses a second time.

**First caller: [#166](../codebase/166.md).** The conversation screen's unpair control now invokes
`window.pyry.unpair()` through the pure `runUnpair` helper — a confirm-guarded manual "forget this
pairing" action that, on `ok`, resets the renderer's session state and routes back to pairing. A
second caller (an offer-re-pair-on-connection-failure prompt) may still ship in
[#167](https://github.com/pyrycode/pyrycode-desktop/issues/167).

## Why this exists

The renderer can never erase the pairing record itself — the paired-server record (bearer `token`,
`server_static_pubkey`) lives only in the background process behind `SecureStore` (CLAUDE.md: "Keep
the transport out of the window"). Recovery from a stale, wrong, or never-connecting pairing needs
*some* trigger the UI can pull, so this channel exposes exactly one capability: "erase the stored
pairing," nothing more granular and nothing that reads back a value.

## What it does

One typed round trip, `window.pyry.unpair()` → `Promise<UnpairResult>`:

- **`{ result: 'ok' }`** — [`pairedServerStore.clear()`](paired-server-store.md) completed. Covers
  both "a record was erased" and "there was nothing to erase" — `clear()` is idempotent, so unpairing
  an already-clean state is still success.
- **`{ result: 'error' }`** — `clear()` threw. The handler classifies-don't-forward: every throw maps
  to this value-free outcome, and the caught object is dropped — never logged, interpolated, or
  returned. `clear()` is itself fail-closed (a `secureStore.delete` failure propagates rather than
  being swallowed), so this `error` arm is the boundary that turns that propagated throw into a safe,
  value-free result. It never resolves `ok` while a live bearer token may still be on disk.

No request body crosses the boundary (the renderer invokes with zero arguments) and no response field
beyond the `result` discriminant — value-free **by construction**: the type has nowhere to put a
token, `server_static_pubkey`, relay URL, keychain path, or error detail, so the handler cannot leak
one even by mistake.

## How it works

| Piece | File | Layer |
|---|---|---|
| `UNPAIR_CHANNEL` + `UnpairResult` union | `src/shared/ipc/unpair.ts` (new) | shared contract |
| `registerUnpairHandler(target, deps)` + `UnpairHandleTarget` | `src/main/unpairHandler.ts` (new) | background handler |
| `window.pyry.unpair()` | `src/preload/index.ts` (mod, +11) | preload bridge |
| single `handle` registration + `will-quit` teardown | `src/main/index.ts` (mod, +11) | composition root |

### 1. The shared contract (`src/shared/ipc/unpair.ts`)

```ts
export const UNPAIR_CHANNEL = 'pyry:unpair' as const

export type UnpairResult = { result: 'ok' } | { result: 'error' }
```

No runtime logic, no companion `isUnpairRequest` guard — unlike `pairing.ts`'s pasted-payload
validation, there is no request body here to validate. Imports nothing from `src/main` (shared is a
clean leaf loaded by both preload and renderer).

### 2. The main-process handler (`src/main/unpairHandler.ts`)

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

The listener is ~6 lines:

```ts
const listener = async (): Promise<UnpairResult> => {
  try {
    await store.clear()
    return { result: 'ok' }
  } catch {
    return { result: 'error' }   // classify-don't-forward: the caught object is DROPPED
  }
}
```

- **Stateless, single store interaction.** The listener's *only* store call is `clear()` — never
  `load`/`save`. It erases; it does not read. No state held between invokes.
- **Store dep typed against the concrete `ClearablePairedServerStore`**, not base
  `PairedServerStore` — the base interface deliberately does not carry `clear()` (see [paired-server
  store](paired-server-store.md)), so this handler's fake stubs only `clear` and every other consumer's
  fake needs no edit.
- **Log-free by construction** — no `console.*` anywhere in the module. A propagated
  `secureStore.delete` error can carry a keychain/filesystem path; logging it would leak that path to
  the console. `handle` must resolve to a value, so the listener never rethrows.
- Nothing Electron-specific is imported — `ipcMain` satisfies `UnpairHandleTarget` structurally, so
  the unit test injects a fake `{ handle: vi.fn(), removeHandler: vi.fn() }`, no Electron harness.

### 3. Preload bridge (`src/preload/index.ts`)

```ts
unpair: (): Promise<UnpairResult> => ipcRenderer.invoke(UNPAIR_CHANNEL),
```

`UNPAIR_CHANNEL` is fixed here so the renderer cannot address arbitrary IPC channels; only this typed
function crosses the bridge, never `ipcRenderer` itself. Called with no second argument — no data
leaves the renderer. `PyryApi = typeof api` re-derives `window.pyry.unpair` automatically, so
`src/preload/index.d.ts` needed no edit.

### 4. Composition-root registration (`src/main/index.ts`)

```ts
const unregisterUnpair = registerUnpairHandler(ipcMain, { store: pairedServerStore })
app.on('will-quit', () => unregisterUnpair())
```

Registered in the pairing-status sibling slot, alongside `registerPairingStatusHandler`, over the
**same** `pairedServerStore` built once at the composition root — no second store constructed. Needs
only the store (no `connection`, no `did-finish-load` gate), so placement is not correctness-critical
(nothing calls `unpair()` yet to race it) but groups with its twin for readability.

## Data flow

```
renderer window.pyry.unpair()  →  ipcRenderer.invoke(UNPAIR_CHANNEL)  [no body]
  →  ipcMain handler listener  →  ClearablePairedServerStore.clear()
  →  secureStore.delete(PAIRED_SERVER_NAME)
  →  resolves { result: 'ok' }  (or { result: 'error' } on any throw)   [value-free]
```

## Security posture

**Verdict: PASS** (architect security-review in the spec, `security-sensitive`). This ticket
*introduces* the renderer→main IPC boundary that #172 deliberately deferred.

- **No untrusted input to validate.** Zero-argument invoke — the value-free contract makes a request
  guard unnecessary by construction, same as `pairingStatus`.
- **The renderer can trigger, never parameterize.** `clear()` is keyed by the fixed
  `PAIRED_SERVER_NAME` constant inside the store, not a caller-supplied name — no channel, name, or
  record field is caller-controlled.
- **Value-free reply by construction.** No response field beyond the discriminant, so the handler
  cannot serialize a token/key/relay/path back even under a bug — pinned by a test asserting the `ok`
  response stringifies to exactly `{"result":"ok"}`.
- **Symmetric with the existing capability, not a new class of power.** A renderer that can already
  `submitPairingPaste`/`confirmPairing` (establish or overwrite pairing) being able to erase it
  introduces no new attack surface — worst case is an availability annoyance (the user re-pairs), not
  a secret leak.
- **Destructive but recoverable, and device-identity-preserving.** `clear()` deletes only
  `PAIRED_SERVER_NAME`; the device static keypair (`pyrycode.device_static`) lives under a distinct
  name in a distinct store and is structurally untouched.

## Edge cases and limitations

- **Confirmation gate lives in the caller, not here.** This channel ships only the mechanism; the
  "are you sure?" UI gate is [#166](../codebase/166.md)'s concern — a two-step confirm phase in the
  conversation screen's `UnpairControl`, ahead of the `unpair()` invoke.
- **Live-session teardown is still out of scope**, confirmed by #166: erasing the at-rest record and
  resetting renderer state does not tear down an in-flight Noise session or relay socket — the
  current connection persists until next launch. In #166's target scenario (a stale/wrong record
  trapping the user on a dead conversation screen) the session is not live, so this is a
  no-observed-failure edge deferred, not defended.
- **No error sub-reason.** The `error` arm deliberately carries no detail beyond the discriminant.
  #166's caller synthesizes its own generic `ConnectionError` (`code: 'unpair'`) on that arm rather
  than threading a sub-reason through. A future recovery flow that needs to distinguish error
  sub-cases extends the union additively; it is not pre-built here.

## Related

- [Paired-server store](paired-server-store.md) / [#172 codebase notes](../codebase/172.md) — the
  `clear()` capability this channel calls.
- [Pairing-status signal](pairing-status-signal.md) / [#79 codebase notes](../codebase/79.md) — the
  literal source pattern this channel clones field-for-field.
- [Diagnostics channel](diagnostics-channel.md) / [#131 codebase notes](../codebase/131.md) — the
  other "ship an IPC boundary ahead of its consumer" precedent.
- [Pairing IPC channel](pairing-ipc-channel.md) — the stateful request/response sibling this
  contrasts with (that channel holds `pendingConfirm` state and validates a pasted request body; this
  one holds nothing and has no body to validate).
- [Conversation shell](conversation-shell.md) / [App shell](app-shell.md) / [Session store](session-store.md)
  — the three renderer-side seams [#166](../codebase/166.md) wires together as this channel's first caller.
- [#173 codebase notes](../codebase/173.md) — implementation summary, patterns established, lessons
  learned.
- [#166 codebase notes](../codebase/166.md) — the first consumer: confirm-guarded control, session
  reset, and route flip.
- [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — the security model this
  channel's value-free contract enforces (token/keys never reach the renderer).
