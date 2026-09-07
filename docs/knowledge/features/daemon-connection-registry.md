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

The composition root binds `registry.active` once, in place of the connection it used to construct
directly. `active`'s type is `Omit<DaemonConnection, 'start' | 'stop' | 'reconnect'>` — deliberately
narrower than the full interface, so the 22 existing call sites (`send`, `interrupt`, the attachment
upload/retrieval, the 21-arm command switch, …) keep their exact current shape while becoming
**structurally unable** to start, stop or re-dial one connection through the stand-in. Each member
resolves the *current* last-held connection at call time, so with more than one connection it answers
for whichever server was paired most recently — where these call sites already reached after a
re-pair, before this ticket. Routing them per server is #1118/#1119/#1120, deliberately out of scope
here.

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
| connection construction | one `createDaemonConnection({ serverId: null, … })` | `createConnectionRegistry({ createConnection: ({ serverId, pairedServer }) => createDaemonConnection({ …, serverId, pairedServer }), store: pairedServerStore })`, then `const connection = registry.active` |
| `onPaired` | `connection.reconnect()` | `registry.reconcile()` |
| `onUnpaired` | `connection.reconnect()` | `registry.reconcile()` |
| `did-finish-load` | `connection.start()` | `registry.start()` — idempotent, deferred behind the registry's own first store read so a load that outruns that read still dials the right set |
| `will-quit` | `connection.stop()` | `registry.stop()` — reaches every held connection, so a quit never leaks a second server's socket, and latches so a reconcile still in flight builds nothing after |

`bundleSink`/`windowLocalSink` stay bound to `null`, the orchestrator stays constructed once, and
`pairingHandler.ts`/`unpairHandler.ts` are untouched — the signals stay value-free by design. The
`app.whenReady().then(() => { … })` callback stays non-`async`: the registry does its own store read
after returning synchronously from its constructor, which is what lets the two "this callback
completes in one tick" comments guarding the pairing/unpair handler registrations keep holding.

## What this doesn't do

- **No per-connection failure fence.** A connection dropped from the set while its own `bootstrap` is
  mid-`await` can still emit one late `failed` event after leaving the set — each connection's
  generation fence is local to itself; the registry adds no cross-connection one. The one reachable
  case is an unpair landing on an in-flight bootstrap, whose late event is `failed(not-paired)` —
  exactly what an unpair is supposed to produce anyway. Deliberately undefended: no such failure has
  been observed, and distinguishing "this server is gone" from "this server failed" belongs to
  per-server status removal (#1085), not here.
- **No per-server routing on `active`, at the time this ticket shipped.** Its 22 delegating members
  all reached whichever connection was paired most recently. #1118 (below) closed this for the ten
  members that carry a conversation id; #1119 (below) closed it for the five that carry a modal,
  question-batch or session id. Only `interrupt` — which carries no payload at all — is left on
  `active` for that reason; it is #1120's.
- **No new IPC surface, no new logged field.** Two [diagnostic log](diagnostic-log.md) events,
  `registry-reconciled { count }` and `registry-reconcile-failed { code: 'unreadable-collection' }` —
  counts and a static code, never a server id or a record. `DiagnosticEvent` has no server-id field
  and no index signature, so this is enforced by the type system, not by discipline.
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

