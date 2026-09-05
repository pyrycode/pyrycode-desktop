# \#1117 — A connection registry: one live connection per paired server

## Files read

Codegraph is not initialised in this repo (every `mcp__codegraph__*` call fails with "CodeGraph not
initialized"), so this list came from `Read` plus `grep`. Noted as the gap the reading list would
otherwise have been generated from.

- `src/main/index.ts` → the `app.whenReady()` callback — the composition root this slice edits. The
  four lifecycle sites (`onPaired`, `onUnpaired`, the `did-finish-load` handler inside `openWindow`,
  the `will-quit` teardown) and the 22 call sites that reach the one `connection` local.
- `src/main/daemonConnection.ts` → `DaemonConnectionDeps` (what a connection needs constructed),
  `DaemonConnection` (the 25-member handle the stand-in must answer for), `loadDialConfig` (reads
  `pairedServer.load()` per dial — the seam the per-server view plugs into), `bootstrap` and `dial`
  (the `connecting` → `failed(not-paired)` sequence AC4 must preserve), and `start`/`stop`/`reconnect`
  (the idempotence and the permanent `stopped` flag the registry has to respect).
- `src/main/pairedServerStore.ts` → `MultiPairedServerStore` (`save` / `load` / `loadById` / `list` /
  `clear` / `clearServer`), and critically `save`'s filter-then-push (the just-saved record is always
  **last** in `list()` order, which is what makes `load()` and "the active connection" the same thing)
  and `list()`'s throw on an unreadable blob.
- `src/main/emitDaemonEvent.ts` → `bindServerOrigin`'s header: bind exactly once per producer, never
  once over the shared `live.sink`. This is why the registry stamps nothing and hands `live.sink`
  through unwrapped.
- `src/main/liveWindow.ts` → `createLiveWindow`'s sink is process-lifetime and `isDestroyed()` is
  always false, and `replayStatus()` replays **one** last status across all producers. Per-server
  status is \#1085, not this slice.
- `src/main/diagnosticLog.ts` → `DiagnosticEvent`'s allowlist. It has **no** server-id field and no
  index signature, so the registry logs counts, not ids (see § Logging).
- `src/main/pairingHandler.ts` / `src/main/unpairHandler.ts` → `onPaired` / `onUnpaired` are both
  `() => void` and must not throw; two shipped tests pin the bare call.
- `e2e/fixtures/launchPairedApp.ts` → the default fake-tier launch starts from a **fresh, unpaired**
  `--user-data-dir` and drives the real pairing UI. So the not-paired launch path and the
  pair-while-running path are both on the critical path of `npm run e2e`.
- `docs/knowledge/features/daemon-connection-lifecycle.md` → § Connect-on-pair and §
  Teardown-on-unpair: the generation fence, and the ruling that a transient `connecting` →
  `failed(not-paired)` after an unpair is an *accepted* consequence because `appRoute.ts` derives the
  launch route from the pairing-status query, never from session status.
- `docs/knowledge/features/paired-server-store.md` → the collection layout and the deliberate
  asymmetry: `save` overwrites an unreadable blob, every other read throws on one.

## Design source

**Figma:** N/A — no `## Figma` section on the ticket, and correctly so: this slice adds no rendered
surface. It builds background-process objects and emits the same daemon events the renderer already
consumes. The visual-fidelity check is intentionally skipped.

## Context

`src/main/index.ts` builds exactly one `DaemonConnection`, passes it `serverId: null`, and treats
both pairing lifecycle signals as "re-dial that same object". \#1069 made the store hold a collection
keyed by `server`; \#1068 made every connection carry its own `serverId`. Neither builds a second
connection, so the desktop still speaks to whichever machine was paired last. This slice is the one
that makes the **number of connections follow the number of stored records**.

The whole family waits on it: per-server status (\#1085), the server-grouped sidebar (\#1070),
per-server unpair (\#1090), the two-daemon fixture (\#1091), and the three routing slices
(\#1118/\#1119/\#1120) all need more than one connection to exist first.

**No ADR is warranted.** The registry is a composition-root refactor that introduces no new boundary,
no new IPC channel and no new at-rest format; ADR 0002's "keep the transport out of the window" and
ADR 0005's storage rules both hold unchanged. The documentation phase should fold this into
`docs/knowledge/features/daemon-connection-lifecycle.md` (a new § "The connection registry") rather
than mint a decision record.

**Size.** Estimated ~850 lines of total written work across 2 production files
(`src/main/connectionRegistry.ts` new, `src/main/index.ts` modified) — ~50 over the 800 ceiling,
stated rather than split, exactly as the ticket argues. Every seam a cut could follow (build-at-launch
vs build-on-pair, build vs teardown, registry vs stand-in) leaves a half that nothing can observe on
its own: `src/main/index.ts` has no unit test, and the two-daemon e2e fixture is \#1091, which is
blocked on this ticket. The other five boundaries all hold (2 production files, 4 exported symbols, 1
consumer file, 5 acceptance criteria, 2 reject branches).

## Design

One new module, `src/main/connectionRegistry.ts`, exporting `createConnectionRegistry(deps)`. It is
Electron-free and unit-testable: the store, the connection factory and the logger are all injected,
following `DaemonConnectionDeps`' own `createDriver` / `now` / `mintToken` shape.

### The contract

```ts
/** Every DaemonConnection member EXCEPT the three lifecycle ones — the registry owns those. */
export type ActiveConnection = Omit<DaemonConnection, 'start' | 'stop' | 'reconnect'>

export interface ConnectionRegistryDeps {
  /** Read-only by construction: no `clear`, no `clearServer`. The registry cannot erase a pairing. */
  store: Pick<MultiPairedServerStore, 'save' | 'load' | 'loadById' | 'list'>
  /** Injected so the tests drive fakes; the root closes the shared deps into it. */
  createConnection: (spec: {
    serverId: string | null
    pairedServer: PairedServerStore
  }) => DaemonConnection
  diagnosticLog?: DiagnosticLog
}

export interface ConnectionRegistry {
  /** Idempotent. Dials every held connection; a connection built later dials as it is built. */
  start(): void
  /** Permanent. Stops every held connection and refuses to build another. */
  stop(): void
  /** Re-read the store and make the connection set match it. Synchronous, void, never throws. */
  reconcile(): void
  /** The stable stand-in the root's 22 call sites reach. Answers for the most recently saved record. */
  readonly active: ActiveConnection
}
```

`ActiveConnection` is `Omit<…>` rather than the full `DaemonConnection` on purpose: it makes it
structurally impossible for a later call site to start, stop or re-dial one connection through the
stand-in, which is the exact mistake this slice exists to remove from the root.

### The entry set and its one invariant

The registry holds `Entry[]` — `{ serverId: string | null; record: PairedServerRecord | null;
connection: DaemonConnection }` — in **`list()` order**, and maintains one invariant:

> The entry list is never empty, and its last entry's connection is the one that speaks to the record
> `store.load()` would answer.

`save()` filters-then-pushes, so the just-saved record is always last in `list()`, and `load()`
returns `entries[entries.length - 1]` of the store. Holding the entries in the same order makes
"active" and "what `load()` answers" the same thing by construction, not by a second rule.

### The unpaired stand-in — how AC4 falls out of one code path

When the record set is empty the registry holds exactly one entry: a connection built with
`serverId: null` over the **whole** store (`load()`, not `loadById`). That is byte-for-byte today's
composition-root connection, so:

- **Launch with nothing paired:** the stand-in dials, `loadDialConfig` answers `null`, the renderer
  sees `connecting` then `failed(not-paired)` — today's sequence, reproduced by running today's code
  rather than by re-emitting today's events from a second place.
- **A throw out of `list()`** (the unreadable-blob state \#1069's last commit shipped the `save`-side
  fix for): the reconcile catches it and changes nothing, so at launch the stand-in is still the only
  entry, dials, and its own `bootstrap` catch settles `failed(connect-failed)` — again today's exact
  behaviour. Nothing rejects out of `whenReady`.
- **Unpair-all:** reconcile finds zero records, stops and drops every real connection, and installs a
  fresh stand-in that dials and settles `failed(not-paired)` — which is what today's
  `onUnpaired → reconnect()` produces.

The stand-in is also what makes the invariant total: `active` is never null, so the 22 delegating
members need no "no connection yet" branch and no duplicated `not-connected` failure literals.

It is built **synchronously in the constructor**, before the first store read, for two reasons: the
root's `whenReady` callback must stay non-`async` (two shipped comments argue handler-registration
safety from "the whole callback completes in one tick"), and a command arriving in the gap before the
first read resolves then reaches exactly the inert object it reaches today.

### Reconcile — one path for both lifecycle criteria

`reconcile()` is synchronous and void (so it satisfies `onPaired` / `onUnpaired`'s must-not-throw
`() => void` contract); it appends to a promise chain and returns. The chain is
`pairedServerStore`'s own `mutate` idiom, lifted: reconciles run one at a time, and the chain
survives a rejected operation, so two signals arriving in quick succession cannot both build a
connection for the same new record off a stale snapshot.

The body, per reconcile:

0. `if (stopped) return` — and **again immediately after the `await` below**, mirroring `bootstrap`'s
   own post-await `stopped` check. A quit landing while a reconcile is suspended must not resume into
   building and dialling sockets after `will-quit`.
1. `records = await store.list()`. On a throw: log `code: 'unreadable-collection'`, return without
   touching the entry set. The caught object is **dropped**, never logged and never re-thrown
   (classify-don't-forward: a decode or keychain message can echo the blob).
2. For each record, in order: no entry holds its `server` → **build** one and (if started) `start()`
   it. An entry holds it and its **record differs field-for-field** → `reconnect()` that one alone.
   An entry holds it and the record is identical → **untouched**.

   "Holds it" is `entries.find((entry) => entry.serverId === record.server)` — a linear scan with
   `===`. The server id is untrusted QR/paste input, so it must never become an object key: no
   `Record<string, Entry>`, no `obj[serverId]`, no bare-object memo. A `Map` would also be safe; the
   scan is chosen because the set is a handful of entries and it needs no second structure to keep in
   step with the ordered list. `pairedServerStore`'s `decodeCollection` already rejects a repeated
   `server` id, so the scan can never have to choose between two entries for one id.
3. Every prior entry not in the new list — including the unpaired stand-in whenever any record exists
   — is `stop()`ped and dropped.
4. If the new list is empty, install a fresh unpaired stand-in (a stopped connection can never be
   reused: `stop()` sets a permanent flag).

That single body answers both lifecycle criteria: pairing a *new* server takes only branch 2's build
arm, leaving every existing connection untouched; re-pairing an *existing* server takes only the
`reconnect()` arm, re-dialling that one alone; clearing a record takes only branch 3.

**Why record comparison rather than "re-dial the last record".** The just-saved record is always last
in `list()` order, so "re-dial the last one" would also work for `onPaired` — but `onUnpaired` runs
the same path, and under \#1090's per-server erase it would then re-handshake an untouched server
every time a *different* one was unpaired. Comparison is the one rule that is correct for both
signals, which is what keeps this to one code path.

**The one behaviour this narrows, stated rather than hidden:** re-pasting a *byte-identical* pairing
payload no longer re-dials, because nothing changed. Today's `reconnect()` would. A real re-pair
always differs (the daemon mints a fresh `token` per `pyry pair`), and the connection is already live
to that server, so the end state is the same; what is lost is using a duplicate paste as a manual
"retry the connection" gesture. AC2 frames a re-pair as "a record changing under a live connection",
which is what this implements.

### The per-server store view

```ts
const viewFor = (serverId: string): PairedServerStore => ({
  save: (record) => store.save(record),
  load: () => store.loadById(serverId)
})
```

Structurally a `PairedServerStore`, so `loadDialConfig` reads **that server's** record with **zero**
changes to `daemonConnection.ts` — including on every automatic supervisor re-dial, which re-sources
through the same provider. This is what stops a second pairing from silently re-pointing the first
connection at the new record. `save` is forwarded because the interface requires it; the registry
never calls it.

**The id the connection is stamped with and the id its view reads by are one local, minted once**, so
they cannot drift:

```ts
const build = (record: PairedServerRecord): Entry => {
  const serverId = record.server
  return { serverId, record, connection: createConnection({ serverId, pairedServer: viewFor(serverId) }) }
}
```

A drift there is the worst bug this slice can ship: a connection would handshake against one server's
`server_static_pubkey` while presenting another's `token`, or emit events under the wrong origin.

### The active stand-in

One object, constructed once, whose 22 members each delegate to the current last entry's connection
at **call time**. The root binds it once (`const connection = registry.active`) and its 22 call sites
keep their exact current shape. There is no null branch, because the entry list is never empty.

### Root wiring — the four lifecycle sites, and nothing else

| Site | Today | After |
|---|---|---|
| the `createDaemonConnection({…})` block | one connection, `serverId: null` | `createConnectionRegistry({…})` whose `createConnection` closes over the same shared deps, then `const connection = registry.active` |
| `onPaired` | `connection.reconnect()` | `registry.reconcile()` |
| `onUnpaired` | `connection.reconnect()` | `registry.reconcile()` |
| `did-finish-load` | `connection.start()` | `registry.start()` |
| `will-quit` | `connection.stop()` | `registry.stop()` |

`registry.start()` stays idempotent under `.on('did-finish-load')` firing once per window and once
per reload: it sets a flag and calls each connection's own idempotent `start()`. Because the first
store read is async, `start()` defers behind the initial reconcile — otherwise a `did-finish-load`
that beat the read would dial the stand-in and then have it torn down microseconds later. Connections
built by a later reconcile dial as they are built.

`registry.stop()` reaches every entry, so a quit leaks no socket, and sets a permanent flag that makes
every later `reconcile()` and `start()` a no-op.

**Explicitly not touched:** `bundleSink` and `windowLocalSink` stay bound to `null`; the orchestrator
stays constructed once; `unpairHandler.ts` and `pairingHandler.ts` are not edited (the signals stay
value-free); `daemonConnection.ts` is not edited.

## State + concurrency model

- **Three cells**, all module-local: `entries: Entry[]`, `started: boolean`, `stopped: boolean`. No
  store, no timer, no listener — so there is nothing to cancel that the connections do not already own.
- **Reconciles are serialised** through a promise chain (`pairedServerStore`'s `mutate` idiom). The
  read-modify-write across `await store.list()` is exactly the check-then-act gap that idiom exists to
  close; without it two signals could each build a connection for the same record.
- **`started` is deferred, not eager.** `start()` sets the flag and schedules the actual dials behind
  the initial reconcile's promise, so no connection is dialled against a set that is about to change.
  That deferred callback re-checks `stopped` when it fires, for the same reason the reconcile body
  re-checks it after its `await`: a quit landing in the gap must not dial.
- **Cancellation** is delegated: each `DaemonConnection` owns its driver, its supervisor and its
  generation fence, and `stop()` is its idempotent, permanent teardown. The registry adds no async
  work of its own beyond the reconcile chain, which cannot outlive the process.
- **A dropped connection is stopped, never abandoned.** `stop()` closes the relay socket and
  suppresses the resulting terminal, so a drop is silent to the renderer.

## Error handling

- `store.list()` throwing (malformed blob / unavailable keychain) is the one reject branch: caught,
  logged content-free, entry set untouched. At launch that leaves the stand-in, which settles a
  `failed` through its own bootstrap. Never rejects out of `whenReady`.
- The reconcile chain swallows its own copy of every outcome (`then(op, op)` plus a swallowed tail),
  so one failed reconcile can neither wedge the chain nor raise an unhandled rejection.
- `reconcile()`, `start()` and `stop()` are all synchronous, void and non-throwing, satisfying
  `onPaired` / `onUnpaired`'s contract the same way `reconnect()` does today.
- **Known, bounded consequence:** a connection dropped while its own `bootstrap` is mid-`await` can
  still emit one late `failed` (`not-paired` or `connect-failed`) after it has left the set — the
  generation fence is per-connection and a registry has no cross-connection fence. Today's single
  connection is fenced by `reconnect()` bumping its own generation, so this is new in kind but not in
  effect: the reachable case is an unpair landing on an in-flight bootstrap, whose late event is
  `failed(not-paired)` — exactly what unpair is supposed to produce. Deliberately **not** defended
  with a per-entry sink gate: no such failure has been observed, and per-server status removal is
  \#1085's, which is the layer that can actually distinguish "this server is gone" from "this server
  failed".

## Logging

Two events through the injected `DiagnosticLog`, and **counts only**:

- `registry-reconciled` with `count` = the number of live connections after the reconcile.
- `registry-reconcile-failed` with `code: 'unreadable-collection'`.

`DiagnosticEvent` has no server-id field, no index signature and no `Record`, so a server id cannot be
logged without widening that type — a third production file and a security question this slice does
not need to open. A count is strictly less than "nothing but a server id", so AC5 holds with room to
spare.

## Testing strategy

`src/main/connectionRegistry.test.ts` (vitest, node environment — this is `src/main`, no React, no
DOM). Fakes, not mocks, at both seams: an in-memory store fake over an array whose `list()` can be
made to throw, and a connection-factory fake recording every construction spec and returning a
`DaemonConnection` whose members are `vi.fn()`s.

| # | Behaviour proven | AC |
|---|---|---|
| 1 | Two records build two connections, one per record, each constructed with its own `server` as `serverId` | 1 |
| 2 | Each connection's injected `pairedServer.load()` resolves **that** record — not the most recent one | 1 |
| 3 | `start()` dials every held connection | 1 |
| 4 | `start()` called before the initial read resolves still dials both, exactly once each | 1 |
| 5 | Repeated `start()` (a second window's `did-finish-load`) dials nothing again | 4 |
| 6 | Saving a record for an unheld server builds + starts one connection, and calls neither `start` nor `reconnect` nor `stop` on the existing ones | 2 |
| 7 | Saving over a held server calls `reconnect()` on that connection alone | 2 |
| 8 | Removing one record stops that connection alone and leaves the others un-`reconnect`ed | 3 |
| 9 | `stop()` stops every held connection | 3 |
| 10 | After `stop()`, a later `reconcile()` builds nothing | 3 |
| 11 | With no records, exactly one connection is built, with `serverId: null` and the whole-store `load` | 4 |
| 12 | With one record, exactly one connection is built, bound to that record's id | 4 |
| 13 | `list()` throwing leaves the entry set as it stands and logs `unreadable-collection`; a live set survives it | 4 |
| 14 | `active` delegates to the connection for the most recently saved record, and follows a re-pair that reorders the collection | — |
| 15 | Two reconciles fired back-to-back build one connection for a new record, not two | — |
| 16 | The registry never calls `store.save`, and its store handle has no erase member | 5 |
| 17 | A `server` id of `__proto__` / `constructor` builds an ordinary connection and pollutes nothing | 5 |
| 18 | Nothing reaches `console.*` on any path, the `list()`-throw path included (six-method spy, the `daemonConnection` precedent) | 5 |
| 19 | `stop()` landing while a reconcile is suspended builds and starts nothing when it resumes | 3 |

`src/main/index.ts` has no unit test in this repo and gains none; its wiring is covered by
`npm run e2e`'s single-daemon fixture, which must pass unedited (AC4). No new Playwright spec: the
two-daemon fixture is \#1091 and is blocked on this ticket.

## Open questions

1. **Does `registry.start()` need to survive a `did-finish-load` that beats the initial store read?**
   Resolved in design: yes, by deferring the dials behind the initial reconcile rather than by
   assuming the ordering. Practically unreachable (a window load is far slower than a keychain read),
   but the deferral costs one `.then` and removes the assumption.
2. **Should the registry hold each record to detect a re-pair?** Resolved: yes — see § Design. The
   alternative (re-dial the last record) is wrong for `onUnpaired` under \#1090. The retention is
   assessed in § Security review.
3. **Should the drop be fenced so a dropped connection can emit nothing?** Resolved: no — see §
   Error handling. Recorded here so the decision is visible rather than absent.

## Security review

**Verdict:** PASS (after revision — the concurrency finding below was a MUST FIX against the first
draft and the plan was changed before this section was written)

**Findings:**

- **[Trust boundaries]** No findings, and one property made explicit. The untrusted value in this
  design is `record.server` — QR/paste input. It reaches three places: `createConnection`'s
  `serverId` (which \#1068 already stamps onto events crossing IPC), `store.loadById`'s argument
  (matched with `===` against decoded entries; never a store name or a path — `pairedServerStore`'s
  own header rules this), and the reconcile's entry lookup. **The lookup is a linear `Array.find`
  with `===`, never an object key** — a `Record<string, Entry>` indexed by `__proto__` or
  `constructor` would be prototype pollution reachable from a pasted pairing payload. Pinned by test
  17. Nothing else on the record crosses any boundary the registry owns.

- **[Tokens, secrets, credentials]** One deliberate widening, assessed. The registry **retains each
  `PairedServerRecord`** (bearer `token` + `server_static_pubkey`) in main-process memory for the
  lifetime of that server's connection, to detect a re-pair. This is not new exposure: the connection
  it is held beside already holds the same values inside its `hello` blob and its relay headers, and
  the retention ends when the entry is dropped. It is never logged (§ Logging is counts-only), never
  returned from any registry member, never crosses IPC or the preload bridge, and the registry's
  store handle is a `Pick` **without `clear` or `clearServer`**, so it cannot erase a pairing either
  (pinned by test 16). The field comparison is a freshness check between two values this process read
  from its own at-rest store — nothing attacker-supplied is compared against a secret — so
  `timingSafeEqual` is not warranted here. Generation, rotation and revocation stay the daemon's and
  the pairing gate's, unchanged.

- **[File / storage operations]** Not applicable by construction: the registry performs no filesystem
  call, joins no path, and imports neither `fs` nor `electron`. The one store name stays the fixed
  `PAIRED_SERVER_NAME` constant inside `pairedServerStore`; no registry-held value reaches a
  persistence key. At-rest encryption, atomicity and storage scope are all inherited unchanged.

- **[Inter-process / Electron attack surface]** No findings, and the surface **narrows**. The slice
  adds no `ipcMain` channel, no `contextBridge` member and no `webPreferences` change; the only thing
  that crosses to the renderer is the existing `StampedDaemonEvent.serverId` scalar from \#1068. The
  stand-in the root binds is `Omit<DaemonConnection, 'start' | 'stop' | 'reconnect'>`, so no call site
  can reach one connection's lifecycle through it. A compromised renderer gains nothing: it cannot
  enumerate connections, cannot address one, and cannot ask the registry for anything at all.
  Per-server *routing* of renderer commands — and therefore per-server authorisation — is **OUT OF
  SCOPE**, picked up by \#1118, \#1119 and \#1120; until then a renderer command reaches the active
  server exactly as it reaches the single connection today.

- **[Cryptographic primitives]** No findings, two properties named. (a) **Cross-server credential
  mix-up is the worst bug available here** — a connection dialling with one server's
  `server_static_pubkey` and another's `token`. The design forbids it structurally: the view reads
  `loadById(serverId)` and never `load()`, and the stamped id and the view's id are **one local minted
  once** in `build` (§ The per-server store view), so they cannot drift. Pinned by tests 1 and 2.
  (b) **The device static keypair is shared across all connections** — one device identity talking to
  several responders, which is Noise_IK's intended model and mobile's. Each connection runs its own
  session with its own ephemeral `e` and its own per-direction nonce counters, and no session state is
  shared, so no `(key, nonce)` pair is reused. The registry hand-rolls nothing: it constructs no
  handshake, derives no key and touches no AEAD.

- **[Network & I/O]** No findings. `maxFrameBytes`, connect/idle deadlines, ping-pong liveness and
  reconnect backoff are per-driver and inherited verbatim — a second connection gets a second
  supervisor for free. **The socket count is bounded by operator consent**: there is no path that
  builds a connection without a stored record, and no path that stores a record without a confirm
  through \#52's validated pairing gate (scheme allowlist, relay-URL checks). A forged blob holding
  thousands of entries would fan out, but writing it requires the OS keychain, and an attacker holding
  that already holds every token — **OUT OF SCOPE**, and unchanged by this slice.

- **[Error messages, logs, telemetry]** No findings. Two events, `registry-reconciled { count }` and
  `registry-reconcile-failed { code: 'unreadable-collection' }` — counts and a static literal, never a
  server id, never a record. `DiagnosticEvent` has no server-id field, no index signature and no
  `Record`, so this is enforced by the type system rather than by discipline. The `list()` catch
  **drops** the caught object (classify-don't-forward: a decode or keychain message can echo the
  blob). No `console.*` anywhere, pinned by a six-method spy across the happy and throwing paths
  (test 18), the `daemonConnection` precedent.

- **[Concurrency]** **MUST FIX against the first draft, now fixed in the plan.** The draft guarded
  `stopped` only at the top of the reconcile body. A `will-quit` landing while a reconcile was
  suspended on `await store.list()` would have resumed into building and **dialling relay sockets
  after quit** — the leak `stop()` exists to prevent, reintroduced one layer up. The plan now
  re-checks `stopped` immediately after that `await`, and again inside `start()`'s deferred callback,
  mirroring `bootstrap`'s own post-await check. Two further races were walked and are closed: the
  read-modify-write across `list()` is serialised through `pairedServerStore`'s `mutate` idiom, so two
  signals cannot both build a connection for one record off a stale snapshot (test 15); and no two
  sockets can stack on one server, because a re-pair takes `reconnect()`, whose `dial()` stops the
  prior driver before constructing the next. Every long-lived async task stays owned by its own
  connection, which `stop()` tears down.

- **[Threat model alignment]** No findings, one cross-server property named. A **hostile or
  compromised relay** is still content-blind and per-connection; the connections share no session
  state, so one hostile relay cannot reach another connection's session. The only objects shared
  across connections are `live.sink` (one-way emit, no cross-talk), the device static key (above) and
  the diagnostic logger. Critically, **server A cannot impersonate server B in the renderer**: the
  origin stamp is bound main-side at construction from the at-rest record's `server`, never read off
  the wire, so nothing a daemon or relay sends can change the id its events carry — `bindServerOrigin`
  already rules this and the registry adds no second stamping path. Token theft from disk and hostile
  daemon responses are unchanged in kind by this slice.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-05
