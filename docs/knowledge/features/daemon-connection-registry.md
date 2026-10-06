# The connection registry (#1117)

Split out of [Daemon connection — per-server routing](daemon-connection-routing.md) 2026-09-07 to keep that document under the size cap. Part of [Daemon connection](daemon-connection.md); see that document for what the package does, its edge cases and its links.

Until this ticket the composition root built exactly **one** `DaemonConnection`, passed it
`serverId: null`, and wired both pairing lifecycle signals as "`reconnect()` that same object" — so
an operator with more than one paired machine only ever reached whichever was paired most recently.
`createConnectionRegistry` (`src/main/connectionRegistry.ts`) is the piece that makes the **set of
live connections follow the set of stored records**: one `DaemonConnection` per paired server,
dialled independently, each reading its own record by id rather than the store's "most recently
saved" answer.

It is Electron-free, filesystem-free and socket-free — the store, the connection factory and the
[diagnostic log](diagnostic-log.md) are all injected, the same seam shape as `DaemonConnectionDeps`'
`createDriver`/`now`/`mintToken` — so it is unit-tested with fakes rather than through
`src/main/index.ts`, which has no unit test in this repo.

## The stable stand-in

`registry.active` is the compatibility view over the current last-held connection. Its type is
`ActiveConnection = Omit<DaemonConnection, 'start' | 'stop' | 'reconnect'>`, and `viewOf` also omits
those lifecycle members from the runtime object. The views returned by `connectionFor` and
`soleConnection` have the same restriction. The composition root retired its `registry.active`
binding once [per-server routing](daemon-connection-routing.md) covered every caller; named-host
reconnect belongs on the registry itself, where the held connection is resolved explicitly.

Every outbound method also needs a `viewOf` delegate: adding it only to the raw
connection does not expose it to the conversation router. `switchAgent(payload)`
forwards the same payload object to the selected connection, leaving authentication
and wire filtering to that connection and its builder. Its registry test records
the forwarded object on alpha and proves beta receives nothing. See
[Switch-agent request](switch-agent-request.md) for the two-host preload-to-wire proof.

## The entry set and its one invariant

The registry holds an ordered `Entry[]` (`{ serverId, record, connection }`), and maintains one rule:
**the list is never empty**, and its last entry is the connection for whatever record `store.load()`
would answer. When nothing is paired, the registry holds exactly one entry: a stand-in built with
`serverId: null` over the *whole* store — byte-for-byte the single connection the root used to build.
So the not-paired settle (`connecting` → `failed(not-paired)`) is preserved by **running the same
code**, not by re-emitting the event from a second place, and `active` needs no null branch.

## Reconcile — one path for both `onPaired` and `onUnpaired`

`onPaired`/`onUnpaired` are both `() => void` by contract (two shipped tests pin the *bare* call —
no record crosses), so the registry can't be handed what changed. Instead `reconcile()` re-reads
`store.list()` and diffs it against the held entries, synchronously scheduling the work and returning
immediately (satisfying the must-not-throw `() => void` contract the way `reconnect()` used to):

- a `server` with no held entry → **build** a connection for it (`viewFor(serverId)`, a
  `{ save, load: () => store.loadById(serverId) }` adapter, so `loadDialConfig` reads *that* record
  with zero changes to `daemonConnection.ts`) and start it if the registry is already dialling.
- a `server` whose held record differs field-for-field from the fresh one → **`reconnect()`** that
  connection alone — a re-pair is a record changing under a live connection (`save` replaces by
  `server` key), which is what today's `reconnect()` already does.
- a `server` whose record is byte-identical → **untouched**. (One narrowing, stated rather than
  hidden: re-pasting a byte-identical payload no longer re-dials, where the old single-connection
  `reconnect()` would have. A real re-pair always differs — the daemon mints a fresh `token` per
  `pyry pair` — so this only costs a manual "retry" gesture via duplicate paste, never a real re-pair.)
- an entry whose record is no longer in the store → **stop and drop** it alone; every other connection
  is left un-reconnected.
- an empty result → the held stand-in is **reused**, never rebuilt, unless the last real record was
  *just* cleared (a stopped connection can never be reused, since `stop()` is permanent). Rebuilding
  an already-held stand-in on every empty reconcile would stop the very connection whose dial *is* the
  `failed(not-paired)` settle — this was one of two departures from the original plan, found by the
  unit tests (see below).

Comparison is by value (`sameRecord`, four named fields), not "re-dial the most recent" — the latter
would also satisfy `onPaired`, but `onUnpaired` runs the identical path, and under a future per-server
unpair (#1090) it would re-handshake an untouched server every time a *different* one was dropped.

**The untrusted `server` id never becomes an object key.** It is QR/paste input, so the reconcile
looks up a held entry with a linear `Array.find`+`===`, never a `Record<string, Entry>` — an id of
`__proto__` or `constructor` would otherwise be a prototype-pollution path reachable from a pasted
payload. Pinned by a regression test.

**Reconciles are serialized through a promise chain** — `pairedServerStore`'s own `mutate` idiom,
lifted a layer up — because the body is a read-modify-write across `await store.list()`: two signals
arriving in quick succession must not each compute their target set from the same stale snapshot and
both build a connection for one new record. `stopped` is checked both before and **after** that
`await`, mirroring `bootstrap`'s own post-await check, so a `will-quit` landing mid-reconcile can't
resume into dialling a socket after the app has already torn everything down.

A throw out of `store.list()` (the unreadable-collection state [paired-server store](paired-server-store.md)'s
`save`-side fix exists for) changes nothing: the entry set is left as it stands, so a live set survives
it and an unpaired launch still dials its stand-in and settles through its own `bootstrap` exactly as
before. The caught object is dropped, never logged and never re-thrown — a decode or keychain message
could echo the blob.

## Wiring — the four lifecycle sites in `src/main/index.ts`

| Site | Before #1117 | After |
|---|---|---|
| connection construction | one `createDaemonConnection({ serverId: null, … })` | `createConnectionRegistry({ createConnection: ({ serverId, pairedServer }) => createDaemonConnection({ …, serverId, pairedServer }), store: pairedServerStore })` |
| `onPaired` | `connection.reconnect()` | `registry.reconcile()` |
| `onUnpaired` | `connection.reconnect()` | `registry.reconcile()` |
| `did-finish-load` | `connection.start()` | `registry.start()` — idempotent, deferred behind the registry's own first store read so a load that outruns that read still dials the right set |
| `will-quit` | `connection.stop()` | `registry.stop()` — reaches every held connection, so a quit never leaks a second server's socket, and latches so a reconcile still in flight builds nothing after |

The pairing and unpairing signals stay value-free by design. The
`app.whenReady().then(() => { … })` callback stays non-`async`: the registry does its own store read
after returning synchronously from its constructor, which is what lets the two "this callback
completes in one tick" comments guarding the pairing/unpair handler registrations keep holding.

### Named-host reconnect IPC

`ConnectionRegistry.reconnect(serverId: string): void` looks through the entries held at the
instant of the call with `Array.find(entry => entry.serverId === serverId)` and invokes only that
connection's `reconnect()`. There is no object-key lookup, normalization, fallback to another host,
or wait for reconciliation. Unknown ids are no-ops. Every string is a no-op while only the
`serverId: null` stand-in exists, including during the initial store read. Empty strings and ids
such as `__proto__`, `constructor`, and `toString` match only when that exact string is held.

The preload entry point is `window.pyry.reconnectServer(serverId: string): Promise<void>`.
[`src/shared/ipc/reconnectServer.ts`](../../../src/shared/ipc/reconnectServer.ts) exports
`RECONNECT_SERVER_CHANNEL = 'pyry:reconnect-server'`, `ReconnectServerRequest`, the pure
`reconnectServerRequest(serverId)` constructor returning a fresh `{ serverId }`, and
`isReconnectServerRequest`. The guard requires a non-null, non-array object with exactly one own
key, `serverId`, holding a string. `Reflect.ownKeys` counts symbol and non-enumerable extras as well
as ordinary fields, including extras valued `undefined`. An inherited id is insufficient; a null
prototype or a non-enumerable own `serverId` is acceptable. There is no id length restriction.
The [unpair channel](unpair-channel.md)'s more permissive guard is not this request's contract.

[`registerReconnectServerHandler`](../../../src/main/reconnectServerHandler.ts) registers the
fixed channel once in `src/main/index.ts`, beside unpair and after registry construction; its
returned cleanup removes that handler on `will-quit`. It holds only
`Pick<ConnectionRegistry, 'reconnect'>` and the shared diagnostic logger. An accepted request
forwards its id once. A malformed request skips the registry entirely. Both resolve `undefined`,
as does a caught dispatch exception; preload also discards any invoke result data.

The handler supplies only fresh constant records to the [diagnostic log](diagnostic-log.md):

| Condition | Diagnostic fields |
|---|---|
| Malformed request | `{ event: 'reconnect-server-refused', code: 'malformed-request' }` |
| Accepted request, including an unknown id | `{ event: 'reconnect-server-requested' }` |
| Dispatch throws, after the requested event | `{ event: 'reconnect-server-failed', code: 'dispatch-failed' }` |

Neither the request, server id, IPC event nor exception details enter those records or the
acknowledgement. A resolved promise or `reconnect-server-requested` log therefore proves no
connection outcome. Progress and outcomes remain on `DAEMON_EVENT_CHANNEL`; see the
[connection lifecycle](daemon-connection-lifecycle.md#composition-root-wiring-srcmainindexts).
Each matched request reaches the existing fresh-dial lifecycle, including repeated requests;
generation fencing supersedes older attempts and a permanently stopped connection stays inert.
The API adds no automatic retry policy. The visible composer control and integrated proof belong
to [#1510](https://github.com/pyrycode/pyrycode-desktop/issues/1510).

## What this doesn't do

- **No per-connection failure fence.** A connection dropped from the set while its own `bootstrap` is
  mid-`await` can still emit one late `failed` event after leaving the set — each connection's
  generation fence is local to itself; the registry adds no cross-connection one. The one reachable
  case is an unpair landing on an in-flight bootstrap, whose late event is `failed(not-paired)` —
  exactly what an unpair is supposed to produce anyway. Deliberately undefended: no such failure has
  been observed, and distinguishing "this server is gone" from "this server failed" belongs to
  per-server status removal (#1085), not here.
- **No host selection on `active`.** It delegates to the last-held connection. Production commands
  use [per-server routing](daemon-connection-routing.md) to select a connection view; explicit
  reconnect takes its server id directly through the registry method above.
- **No pairing content in diagnostics.** The registry emits two [diagnostic log](diagnostic-log.md) events,
  `registry-reconciled { count }` and `registry-reconcile-failed { code: 'unreadable-collection' }` —
  counts and a static code, never a server id or a record. The reconnect IPC handler's events
  above likewise contain only constants. The logger's string fields do not enforce that rule;
  each producer must construct its own safe record.
- **The registry retains each `PairedServerRecord` in memory**, beside the connection it belongs to,
  purely to detect a re-pair by value — not a new exposure, since the connection already holds the
  same token and static key inside its `hello`/headers, and the retention ends when the entry drops.
  The registry's own store handle is a `Pick` without `clear`/`clearServer`, so it cannot erase a
  pairing under any code path (security review verdict: **PASS**).
- **A known, non-load-bearing comment gap:** `sameRecord` compares `PairedServerRecord`'s four fields
  by name and its header claims a field added to the aliased `QrPayload` would be "a compile error
  here" — that isn't true (the function would keep compiling and silently ignore the new field). Code
  review flagged this as a non-blocking SHOULD FIX; a field added to the wire payload alongside a
  daemon change must have `sameRecord` updated by hand.

## Testing

[`connectionRegistry.test.ts`](../../../src/main/connectionRegistry.test.ts) checks independent
alpha/beta targeting, repeated calls, unknown ids, the null stand-in, and held empty/prototype-shaped
ids. Existing assertions still prove lifecycle methods absent from connection views. The
[request tests](../../../src/shared/ipc/reconnectServer.test.ts) pin the closed shape, including
`undefined`, symbol and non-enumerable extras. The
[handler tests](../../../src/main/reconnectServerHandler.test.ts) check registration/removal,
dispatch/refusal, empty acknowledgements and exact diagnostic records, including a throwing
dispatch. The [preload test](../../../src/preload/reconnectServer.test.ts) makes mocked `invoke`
return data and proves the exposed API discards it; an always-undefined mock would miss a bridge
that accidentally forwarded results. These unit seams do not prove a renderer gesture reaches
a real connection.

## Revisions found during implementation

Two departures from the original plan, both surfaced by the unit tests it specified rather than by
production behaviour (each connection's own idempotent `start()`/permanent `stop()` masked both in
practice):

1. **A single `dialling` flag, latched inside the deferred start callback, replaced two flags.** The
   plan had `start()` set a flag synchronously and then schedule the dials — which double-dials,
   because entries built by the deferred store read see the flag already set and dial through the
   *build* arm too. Flipping the flag in the one place any connection is actually dialled makes the
   registry's own plural `start()` idempotent in its own right, and makes a second `did-finish-load`
   arriving before the first read resolves return early rather than re-dialling.
2. **An already-held stand-in is reused, not rebuilt, when the record set reconciles to empty.** The
   common unpaired-launch sequence — construct a stand-in, then reconcile to the same empty set — was
   stopping the very connection whose dial *is* the not-paired settle. A fresh stand-in is now built
   only when the last real record has just been cleared.

Full design, the security review (`PASS`, one MUST FIX resolved before ship — a concurrency gap where
`will-quit` landing mid-reconcile could dial after the app had already torn down, closed by the
post-`await` `stopped` re-check above), and the 19-case test table live in
`docs/specs/architecture/1117-connection-registry.md`.
