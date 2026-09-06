# Server-info channel

The renderer→main IPC surface that lets the window read **every paired server's** non-secret identity
— each one's server id and relay URL — from the at-rest [paired-server store](paired-server-store.md),
**including while disconnected**.

Introduced in [#339](../codebase/339.md), single-valued (the newest paired record only). It is the
**third twin** in the [pairing-status signal](pairing-status-signal.md) (#79) / [unpair
channel](unpair-channel.md) (#173) family: same four-layer shape (shared contract, main handler, preload
bridge, composition-root registration), same injected-target / stateless-handler / classify-don't-forward
discipline. The one structural difference from both siblings: its present arm **carries data** —
`serverId` + `relayUrl` — rather than being fully value-free.
[#1148](https://github.com/pyrycode/pyrycode-desktop/issues/1148) then widened the present arm from one
pair to a list, one entry per paired server, matching [#1069](paired-server-store.md)'s collection —
Settings had caught up with the store everywhere except this read path. Its caller is the [server-info
store](server-info-store.md)'s one-shot loader ([#340](../codebase/340.md)); the visible Settings rows
are [#334](../codebase/334.md) and [#1148](https://github.com/pyrycode/pyrycode-desktop/issues/1148).
Same "ship the IPC boundary ahead of its consumer" shape as [#131→#134](diagnostics-channel.md) and
[#173→#166/#167](unpair-channel.md).

## Why a new channel, not `pairingStatus`

[`pairingStatus`](pairing-status-signal.md) is deliberately value-free — "only the enum comes back,
never the token / server key / relay." Adding `relayUrl` to it would relax that security contract for
a channel whose whole purpose is to leak nothing. A dedicated channel keeps `pairingStatus` value-free
and confines the two-field surface to a new, separately-reviewed boundary.

## What it does

One typed round trip, `window.pyry.serverInfo()` → `Promise<ServerInfo>`:

- **`{ status: 'available', servers }`** — [`pairedServerStore.list()`](paired-server-store.md)
  ("every paired entry, oldest-saved first") returned a non-empty collection; `servers` carries one
  `{ serverId, relayUrl }` entry per record, in `list()`'s own order — the handler never re-sorts.
- **`{ status: 'unavailable' }`** — every non-readable case: nothing paired (`list()` → `[]`) **or** the
  stored collection could not be read (`list()` threw `MalformedPairedServerRecordError` or a propagated
  decrypt failure). All three collapse to this one outcome; the error type is never surfaced, and there
  is deliberately no third arm distinguishing empty from unreadable.

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

export interface ServerInfoEntry {
  serverId: string
  relayUrl: string
}

export type ServerInfo =
  | { status: 'available'; servers: ServerInfoEntry[] }
  | { status: 'unavailable' }
```

- **Value-free-by-construction, relaxed to exactly two non-secret fields PER ENTRY.** The present arm
  declares **only** a list of `ServerInfoEntry` — `token` and `server_static_pubkey` are structurally
  absent from the type, so the handler *cannot* serialize them back even under a bug, however many
  servers are paired. The `status` discriminant is structural (matches its two siblings' shape); the
  security property is that the record's other two fields have no field to ride on, not the
  discriminant itself. `servers` is non-empty on the available arm by handler construction (an empty
  collection returns the absent arm instead); that invariant is documented, not encoded — a non-empty
  tuple type would need an unchecked cast to satisfy, which production code here forbids, and nothing
  downstream depends on it (the renderer maps an empty `servers` to the same value as `unavailable`).
- **No request guard.** The invoke carries zero arguments, mirroring `pairingStatus`/`unpair` — there
  is no untrusted request field to validate.
- **Absent arm carries nothing** — no error-reason field, same discipline as `unpair`'s `error` arm (a
  coarse category could still leak backend detail).
- Imports nothing from `src/main`; relative imports only (no `@shared` alias in main/preload).

### 2. The main-process handler (`src/main/serverInfoHandler.ts`)

Clone of `pairingStatusHandler.ts` in shape; since #1148 the one read is `list()` rather than `load()`:

```ts
export interface ServerInfoHandleTarget {
  handle(channel: string, listener: (event: unknown) => Promise<ServerInfo>): void
  removeHandler(channel: string): void
}

export function registerServerInfoHandler(
  target: ServerInfoHandleTarget,
  deps: { store: Pick<MultiPairedServerStore, 'list'> }
): () => void
```

```ts
const listener = async (): Promise<ServerInfo> => {
  try {
    const records = await store.list()
    if (records.length === 0) return { status: 'unavailable' }
    return {
      status: 'available',
      servers: records.map((record) => ({ serverId: record.server, relayUrl: record.relay }))
    }
  } catch {
    return { status: 'unavailable' }   // classify-don't-forward: the caught object is DROPPED
  }
}
```

- **Explicit two-field literal per entry, never a spread.** The map body names `record.server` /
  `record.relay` individually — never `...record`, never a pass-through of the record object — so
  `token` / `server_static_pubkey` cannot ride along even at runtime, independent of the type check.
  Widening the read from one record to N is exactly what makes a lazy spread cost N bearer tokens
  instead of one, so the explicitness is load-bearing, not stylistic.
- **Store dep typed against `Pick<MultiPairedServerStore, 'list'>`** — the narrowest surface carrying
  the one method the handler calls, following `hostLabelHandler`'s `Pick<HostLabelStore, 'load'>` and
  `connectionRegistry`'s own `Pick`. Naming the whole `MultiPairedServerStore` would drag `save` /
  `clear` / `loadById` / `clearServer` into the type and into every fake for no gain, and would put a
  mutator within this read channel's reach. The fake needs only a `list` stub.
- **Stateless** — reads the store fresh on every invoke (no cache), so a re-pair is observed
  immediately, and the read takes a single consistent snapshot (`fileSecretPersistence` writes
  temp-then-rename, so a concurrent `save` yields the pre- or post-write collection, never a torn one).
- **Sources the at-rest record, never the live `hello_ack.server_id`.** Both fields come off the
  persisted `PairedServerRecord`, so they're available whether or not that server's connection is live
  — a distinction that grew teeth with #1117, which now dials one live connection per record and so
  makes a per-server live id available to reach for instead. Do not.
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
  →  ipcMain handler listener  →  MultiPairedServerStore.list()
       non-empty  →  { status: 'available', servers: records.map(r => ({ serverId: r.server, relayUrl: r.relay })) }
       empty OR throw  →  { status: 'unavailable' }                              [no detail]
```

## Security posture

**Verdict: PASS** (architect self-review in the spec, `security-sensitive` — this is the first of the
three twins whose present arm carries data). Key findings:

- **No untrusted input to validate** — zero-argument invoke, same as its siblings.
- **Exactly two non-secret fields cross, per entry, statically enforced.** `token`/`server_static_pubkey`
  are structurally absent from `ServerInfoEntry`; pinned by a test asserting `JSON.stringify` on the
  available arm contains every entry's `server`/`relay` but none of two DISTINCT records' credentials,
  plus an `Object.keys` pin on the top-level arm **and on each entry** — the per-entry pin is the
  load-bearing half since #1148, because the top-level pin alone (`['servers', 'status']`) still passes
  while a credential rides along inside an entry.
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
  which maps this union into a `ServerInfoValue[]` via a single `window.pyry.serverInfo()` invoke per
  mount. The visible Settings rows are [#334](../codebase/334.md) and
  [#1148](https://github.com/pyrycode/pyrycode-desktop/issues/1148) (one row per entry).
- **No error sub-reason**, same discipline as `pairingStatus`/`unpair` — the unavailable arm never
  distinguishes not-paired from malformed from undecrypted. A future consumer needing that distinction
  extends the union additively.
- **Repeated invokes are cheap** — each is an independent local `store.list()`, no amplification, no
  state mutation, no secret returned.
- **Response size is unbounded in N, deliberately not a finding.** N is the number of servers the user
  paired by hand through the QR flow — not attacker-controlled, not remotely inflatable — and each entry
  is two short strings.

## Related

- [Paired-server store](paired-server-store.md) / [#44](../codebase/44.md) — `load()`, the source of
  both outcomes; `server`/`relay` are the two non-secret fields this channel is scoped to expose.
- [Pairing-status signal](pairing-status-signal.md) / [#79](../codebase/79.md) — the literal
  value-free-by-construction pattern this channel relaxes to exactly two fields.
- [Daemon-event channel plumbing](daemon-event-channel-plumbing.md) / #1068 — reuses this doc's
  `serverId ← record.server`, never `hello_ack.server_id` ruling to stamp every daemon event with its
  originating server's id.
- [Unpair channel](unpair-channel.md) / [#173](../codebase/173.md) — the other twin; the
  read-vs-destructive-action contrast (`load()` here, `clear()` there).
- [ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md) — the credential boundary that
  classifies `server`/`relay` as the non-secret half that may cross.
- [ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md) — the classify-don't-forward
  discipline the `catch` implements.
- [#339 codebase notes](../codebase/339.md) — implementation summary, patterns established.
- [Server-info store](server-info-store.md) / [#340 codebase notes](../codebase/340.md) — the renderer
  store + one-shot loader that consumes this channel.
- [Paired-server store](paired-server-store.md) / [#1069](paired-server-store.md) — the
  `MultiPairedServerStore.list()` collection this channel widened to answer for, per
  [#1148](https://github.com/pyrycode/pyrycode-desktop/issues/1148) · Spec:
  `docs/specs/architecture/1148-settings-lists-every-paired-server.md`.
