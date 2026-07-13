# Server-info channel

The renderer→main IPC surface that lets the window read the paired server's **non-secret identity**
— its server id and relay URL — from the at-rest [paired-server store](paired-server-store.md),
**including while disconnected**.

Introduced in [#339](../codebase/339.md). It is the **third twin** in the [pairing-status
signal](pairing-status-signal.md) (#79) / [unpair channel](unpair-channel.md) (#173) family: same
four-layer shape (shared contract, main handler, preload bridge, composition-root registration), same
injected-target / stateless-handler / classify-don't-forward discipline. The one structural difference
from both siblings: its present arm **carries data** — `serverId` + `relayUrl` — rather than being
fully value-free. Its caller is the [server-info store](server-info-store.md)'s one-shot loader
([#340](../codebase/340.md)); the visible Settings row is [#334](../codebase/334.md). Same "ship the IPC
boundary ahead of its consumer" shape as [#131→#134](diagnostics-channel.md) and
[#173→#166/#167](unpair-channel.md).

## Why a new channel, not `pairingStatus`

[`pairingStatus`](pairing-status-signal.md) is deliberately value-free — "only the enum comes back,
never the token / server key / relay." Adding `relayUrl` to it would relax that security contract for
a channel whose whole purpose is to leak nothing. A dedicated channel keeps `pairingStatus` value-free
and confines the two-field surface to a new, separately-reviewed boundary.

## What it does

One typed round trip, `window.pyry.serverInfo()` → `Promise<ServerInfo>`:

- **`{ status: 'available', serverId, relayUrl }`** — [`pairedServerStore.load()`](paired-server-store.md)
  returned a present record; `serverId` ← `record.server`, `relayUrl` ← `record.relay`.
- **`{ status: 'unavailable' }`** — every non-readable case: not paired (`load()` → `null`) **or** the
  stored record could not be read (`load()` threw `MalformedPairedServerRecordError` or a propagated
  decrypt failure). All three collapse to this one outcome; the error type is never surfaced.

**Disconnected-safe source.** Both fields come from the **persisted** record, never the live
`hello_ack.server_id` (a distinct value set on a `connected` daemon event, in `sessionStore`). This is
the point of the ticket: the Settings screen must show which server the client is paired with even
when no connection is up.

## How it works

| Piece | File | Layer |
|---|---|---|
| `SERVER_INFO_CHANNEL` + `ServerInfo` union | `src/shared/ipc/serverInfo.ts` (new) | shared contract |
| `registerServerInfoHandler(target, deps)` + `ServerInfoHandleTarget` | `src/main/serverInfoHandler.ts` (new) | background handler |
| `window.pyry.serverInfo()` | `src/preload/index.ts` (mod, +11) | preload bridge |
| single `handle` registration + `will-quit` teardown | `src/main/index.ts` (mod, +11) | composition root |

### 1. The shared contract (`src/shared/ipc/serverInfo.ts`)

```ts
export const SERVER_INFO_CHANNEL = 'pyry:server-info' as const

export type ServerInfo =
  | { status: 'available'; serverId: string; relayUrl: string }
  | { status: 'unavailable' }
```

- **Value-free-by-construction, relaxed to exactly two non-secret fields.** The present arm declares
  **only** `serverId` + `relayUrl` — `token` and `server_static_pubkey` are structurally absent from
  the type, so the handler *cannot* serialize them back even under a bug. The `status` discriminant is
  structural (matches its two siblings' shape); the security property is that the record's other two
  fields have no field to ride on, not the discriminant itself.
- **No request guard.** The invoke carries zero arguments, mirroring `pairingStatus`/`unpair` — there
  is no untrusted request field to validate.
- **Absent arm carries nothing** — no error-reason field, same discipline as `unpair`'s `error` arm (a
  coarse category could still leak backend detail).
- Imports nothing from `src/main`; relative imports only (no `@shared` alias in main/preload).

### 2. The main-process handler (`src/main/serverInfoHandler.ts`)

Clone of `pairingStatusHandler.ts`, ~8 lines:

```ts
export interface ServerInfoHandleTarget {
  handle(channel: string, listener: (event: unknown) => Promise<ServerInfo>): void
  removeHandler(channel: string): void
}

export function registerServerInfoHandler(
  target: ServerInfoHandleTarget,
  deps: { store: PairedServerStore }
): () => void
```

```ts
const listener = async (): Promise<ServerInfo> => {
  try {
    const record = await store.load()
    return record === null
      ? { status: 'unavailable' }
      : { status: 'available', serverId: record.server, relayUrl: record.relay }
  } catch {
    return { status: 'unavailable' }   // classify-don't-forward: the caught object is DROPPED
  }
}
```

- **Explicit two-field literal, never a spread.** The available arm names `record.server` /
  `record.relay` individually — never `...record` — so `token` / `server_static_pubkey` cannot ride
  along even at runtime, independent of the type check.
- **Store dep typed against the base `PairedServerStore`** (only `load()` is needed), not
  `ClearablePairedServerStore` — the fake needs only `save`/`load` stubs.
- **Stateless** — reads the store fresh on every invoke (no cache), so a re-pair is observed
  immediately.
- **Classify-don't-forward + log-free by construction.** Every throw (`MalformedPairedServerRecordError`
  or a propagated decrypt failure) collapses to `unavailable` without inspecting the error type; the
  caught object is dropped — never logged, interpolated, or returned. No `console.*` anywhere in the
  module. `handle` must resolve to a value, so the listener never rethrows.
- Nothing Electron-specific is imported — `ipcMain` satisfies `ServerInfoHandleTarget` structurally,
  so the unit test injects a fake `{ handle: vi.fn(), removeHandler: vi.fn() }`.

### 3. Preload bridge (`src/preload/index.ts`)

```ts
serverInfo: (): Promise<ServerInfo> => ipcRenderer.invoke(SERVER_INFO_CHANNEL),
```

`SERVER_INFO_CHANNEL` is fixed here so the renderer cannot address arbitrary channels; called with no
second argument — no data leaves the renderer. `PyryApi = typeof api` re-derives `window.pyry.serverInfo`
automatically — no `index.d.ts` edit.

### 4. Composition-root registration (`src/main/index.ts`)

```ts
const unregisterServerInfo = registerServerInfoHandler(ipcMain, { store: pairedServerStore })
app.on('will-quit', () => unregisterServerInfo())
```

Registered at `index.ts:142-153`'s pairing-status/unpair slot, over the **same** `pairedServerStore`
built once at the composition root — no second store constructed. Needs only the store (no
`connection`, no `did-finish-load` gate), so placement is not correctness-critical (no caller races it
yet — the consumer is #340) but groups with its twins for readability.

## Data flow

```
renderer window.pyry.serverInfo()  →  ipcRenderer.invoke(SERVER_INFO_CHANNEL)   [no body]
  →  ipcMain handler listener  →  PairedServerStore.load()
       present record  →  { status: 'available', serverId: record.server, relayUrl: record.relay }
       null OR throw   →  { status: 'unavailable' }                              [no detail]
```

## Security posture

**Verdict: PASS** (architect self-review in the spec, `security-sensitive` — this is the first of the
three twins whose present arm carries data). Key findings:

- **No untrusted input to validate** — zero-argument invoke, same as its siblings.
- **Exactly two non-secret fields cross, statically enforced.** `token`/`server_static_pubkey` are
  structurally absent from `ServerInfo`; pinned by a test asserting `JSON.stringify` on the available
  arm contains `server`/`relay` but not `token`/`server_static_pubkey`, plus an `Object.keys` pin on
  the arm's exact key set.
- **No new class of power.** A renderer that can already `submitPairingPaste`/`confirmPairing`
  (establish or overwrite these very values) gaining read access to two non-secret fields is a strict,
  minimal relaxation — it would observe them anyway once #334 renders them.
- **Absence-collapse is intentional and safe.** `null` / malformed / decrypt-failure all resolve to the
  same `unavailable`, erring toward showing nothing rather than risking a malformed record's bytes.
- **Disconnected-safe source is a correctness property with a security flavour** — reading only the
  persisted record (never `hello_ack.server_id`) keeps this a pure at-rest read with no dependency on
  an in-flight Noise session.

## Edge cases and limitations

- **Caller: the [server-info store](server-info-store.md)'s one-shot loader** ([#340](../codebase/340.md)),
  which maps this union into `{ serverId, relayUrl } | null` via a single `window.pyry.serverInfo()`
  invoke per mount. That store ships dormant too — the visible Settings row is
  [#334](../codebase/334.md).
- **No error sub-reason**, same discipline as `pairingStatus`/`unpair` — the unavailable arm never
  distinguishes not-paired from malformed from undecrypted. A future consumer needing that distinction
  extends the union additively.
- **Repeated invokes are cheap** — each is an independent local `store.load()`, no amplification, no
  state mutation, no secret returned.

## Related

- [Paired-server store](paired-server-store.md) / [#44](../codebase/44.md) — `load()`, the source of
  both outcomes; `server`/`relay` are the two non-secret fields this channel is scoped to expose.
- [Pairing-status signal](pairing-status-signal.md) / [#79](../codebase/79.md) — the literal
  value-free-by-construction pattern this channel relaxes to exactly two fields.
- [Unpair channel](unpair-channel.md) / [#173](../codebase/173.md) — the other twin; the
  read-vs-destructive-action contrast (`load()` here, `clear()` there).
- [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — the credential boundary that
  classifies `server`/`relay` as the non-secret half that may cross.
- [ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md) — the classify-don't-forward
  discipline the `catch` implements.
- [#339 codebase notes](../codebase/339.md) — implementation summary, patterns established.
- [Server-info store](server-info-store.md) / [#340 codebase notes](../codebase/340.md) — the renderer
  store + one-shot loader that consumes this channel.
