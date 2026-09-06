# 1148 — Settings lists every paired server, one row each

Split from #1090. Makes the server-info read path — bridge contract, main handler, renderer store,
loader, row — answer for the whole paired-server collection instead of the newest record alone.

## Files read

- `src/shared/ipc/serverInfo.ts` → `SERVER_INFO_CHANNEL`, `ServerInfo` — the contract this slice
  reshapes. Its header states the value-free-relaxed-to-two-non-secret-fields rule that has to be
  carried forward per entry.
- `src/main/serverInfoHandler.ts` → `registerServerInfoHandler`, `ServerInfoHandleTarget` — the read
  site. Its header records why the dep is typed against the narrowest interface that carries what it
  needs, and why the module is log-free.
- `src/main/serverInfoHandler.test.ts` → `storeWithLoad`, `RECORD`, the `Object.keys` structural pin —
  the credential-never-crosses assertions this slice must restate per entry.
- `src/main/pairedServerStore.ts` → `MultiPairedServerStore.list` ("every paired entry, oldest-saved
  first; empty when nothing is paired") — AC1's ordering, so no client-side sort. Also
  `MalformedPairedServerRecordError`, whose decode rejects a repeated `server` id — that is what makes
  `serverId` a safe React key. `createPairedServerStore` already returns `MultiPairedServerStore`, so
  the composition root needs no edit.
- `src/main/hostLabelHandler.ts` → its `Pick<HostLabelStore, 'load'>` dep, and
  `src/main/connectionRegistry.ts` → its `Pick<MultiPairedServerStore, …>` dep — the established
  narrowest-surface idiom this slice's handler follows.
- `src/renderer/src/store/serverInfoStore.ts` → `ServerInfoValue`, `ServerInfoState`,
  `createServerInfoStore`, `selectServerInfo` — the single-value store being migrated.
- `src/renderer/src/store/serverInfoLoader.ts` → `mapServerInfo`, `loadServerInfo`, `ServerInfoData` —
  the one-shot mount invoke and its StrictMode `active` guard, both unchanged.
- `src/renderer/src/screens/settings/ServerRow.tsx` → `ServerRow`, `ServerRowControl` — the pure
  view / store-bound container split (#330) that decides where the loop can live.
- `src/renderer/src/screens/settings/ServerRow.test.tsx` → its header, which records that the
  container's populated branch is unreachable under `renderToStaticMarkup` and rejects seeding the
  singleton in favour of injected props. This is why the list lands on the view's props.
- `src/renderer/src/screens/settings/SettingsScreen.tsx` → the `settings__section-body` flex column
  mounting `ServerInfoData` + `ServerRowControl` by name; and `SettingsScreen.test.tsx`, which asserts
  the loading branch ("Server" + "Loading") through that mount.
- `src/renderer/src/clearPairingScopedState.ts` → its `serverInfoStore` "(a one-shot mount invoke)"
  self-heal note and the "does a reconnect to the SAME daemon need to clear it?" discriminator.
- `src/preload/index.ts` → `serverInfo`, typed only against `ServerInfo`, so a type-only reshape leaves
  it untouched.
- `docs/knowledge/features/settings-screen.md`, `server-info-channel.md`, `server-info-store.md` — the
  pages the documentation phase updates; `settings-screen.md` is at 45943 bytes against the 50000-byte
  `npm run check:docs` cap, and its "Desktop remains single-server … not a multi-server manager" bullet
  is what this slice retires.

Codegraph was not used: every `mcp__codegraph__*` call in this repo fails with "CodeGraph not
initialized". The reading list above came from Grep + Read.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=17-12

The Server row is a 16px-gap horizontal frame, `px-[16px] py-[10px]`, holding a 2px-gap text column:
the "Server" label in M3 body-large on `schemes/on-surface`, the server id beneath it in body-small on
`schemes/on-surface-variant`, then the two-dot status slot (90:4, drawn in Figma as Relay + Pyrycode
dots) which desktop renders EMPTY as a mount target for #330. The trailing chevron (17:16) stays
omitted, per `settings-screen.md` § No trailing chevron. **Nothing visual changes in this slice**: no
new element, no new copy, no `settings.css` edit. The same row markup is emitted once per paired
server, and `.settings__section-body` is already a plain flex column with per-row padding, so N rows
stack correctly untouched. The desktop-only relay-URL line beneath the id (not drawn in Figma) also
repeats per row, unchanged.

## Context

Since #1069 the paired-server store holds a collection keyed by server id, and since #1117 the
background process dials one live connection per record. The server-info read path never caught up:
`registerServerInfoHandler` calls `load()`, which returns the newest record only, and every layer above
it — the `ServerInfo` union, `serverInfoStore`, `mapServerInfo`, `ServerRow` — is single-valued. Pair a
second machine and Settings names whichever was paired last.

This slice makes that path answer for the set. It is the first of #1090's four slices, and the repeated
row is what #1152's per-server Unpair hangs on. No ADR is warranted: this widens an existing contract
along the collection axis #1069 already established and introduces no new decision.

Out of scope, deliberately: no Unpair action; no launch-route change (`pairingStatusHandler` already
answers `paired` whenever any record exists, because `load()` returns null only on an empty collection).

### Size

Over the 800-line ceiling, stated on the record. The only split available cuts the main side (contract
+ handler) from the renderer side (store + loader + row), and that first child's sole consumer is its
one sibling in the same family — it cannot even land green, because `mapServerInfo` reads `res.serverId`
off the arm that stops existing. Buying it a build would mean a throwaway transitional arm on an
in-process bridge whose two sides ship in the same binary. Floor beats ceiling: one ticket. Every other
line of the boundary holds — 5 production files, 2 new exported names, ~5 consumer call sites, 5 AC, no
reject branches.

## Design

### The contract — `src/shared/ipc/serverInfo.ts`

The present arm carries a list; the absent arm is untouched.

- `ServerInfoEntry` — a new exported interface, `{ serverId: string; relayUrl: string }`: exactly the
  two non-secret fields, per entry. `token` and `server_static_pubkey` stay structurally absent, so the
  handler still cannot serialize a credential across the boundary however many records it holds.
- `ServerInfo` — `{ status: 'available'; servers: ServerInfoEntry[] } | { status: 'unavailable' }`.

Empty, absent and unreadable keep collapsing to the SAME `unavailable` arm. No third arm: the renderer
has nothing to do with the distinction, and minting one would put a store-state category on the wire
that no consumer reads. The available arm is non-empty by handler construction; that invariant is not
load-bearing anywhere (the renderer maps an empty `servers` to the same value it maps `unavailable` to),
so it is documented rather than encoded — a non-empty tuple type would need an `as` cast to satisfy,
which production code here forbids.

### The read — `src/main/serverInfoHandler.ts`

The listener moves from `store.load()` to `store.list()`, keeping its shape otherwise: still stateless,
still zero-argument, still log-free, still one registration and an exact teardown.

- Dep type: `{ store: Pick<MultiPairedServerStore, 'list'> }`. The narrowest surface that carries the
  method, following `hostLabelHandler`'s `Pick<HostLabelStore, 'load'>` and `connectionRegistry`'s
  `Pick<MultiPairedServerStore, …>`. Naming the full `MultiPairedServerStore` would drag `save`,
  `clear`, `loadById` and `clearServer` into the type and into every fake for no gain. The concrete
  store satisfies it structurally, so `index.ts` is untouched.
- Empty collection → `{ status: 'unavailable' }`, returned before the arm is built.
- Otherwise `{ status: 'available', servers: records.map(…) }`, where the map body is an EXPLICIT
  two-field literal — `{ serverId: record.server, relayUrl: record.relay }` — never `...record`, never
  a pass-through of the record object. This is the credential-stripping guarantee, and widening the
  read from one record to N is exactly what makes a lazy spread cost N tokens instead of one.
- The `catch` is unchanged: every throw collapses to `unavailable` with the caught object dropped, no
  type inspection, no log, no interpolation (AC5).

Ordering comes from `list()` ("oldest-saved first") and is passed through with no client-side sort
(AC1).

### The store — `src/renderer/src/store/serverInfoStore.ts`

- `ServerInfoValue` keeps its name and its `{ serverId, relayUrl }` shape: it stays the value of ONE
  row, which is what `ServerRow`'s prop still means.
- `ServerInfoState` becomes `{ servers: ServerInfoValue[] }`; `initialServerInfoState` is
  `{ servers: [] }`.
- The single setter is renamed `setServers(servers: ServerInfoValue[])` and the selector `selectServers`
  — still one mutation ("record what the loader mapped"), still whole-value replacement, still no merge.
  Keeping the singular names over a list would be actively misleading.
- `[]` is the ONE absent form. A `ServerInfoValue[] | null` would carry a not-yet-fetched vs
  fetched-and-empty distinction that nothing reads — every consumer renders the same placeholder for
  both, and AC3 forbids a distinct "no servers" copy — so it would be an unobservable impossible-state
  pair. This is the store header's own "ceremony without benefit" test applied to the migration.

`serverInfoStore` stays OUT of `clearPairingScopedState`. That file names it as self-healing via "a
one-shot mount invoke", and the self-heal survives this migration intact: the loader still refetches on
every Settings mount and still replaces the whole value, so a clear would still be dead code. This is
NOT the `conversationListStore` case (#1086), where keying by server retired a whole-array overwrite —
here the overwrite is a whole-array write that scoping never touched.

### The loader — `src/renderer/src/store/serverInfoLoader.ts`

- `mapServerInfo(res: ServerInfo): ServerInfoValue[]` — `available` maps each entry to a FRESH
  `{ serverId, relayUrl }` literal; `unavailable` (and an empty `servers`) maps to `[]`. The
  reconstruct is kept per entry rather than passing the bridge objects through: a structured-clone'd
  IPC object can carry own properties the type does not declare, so rebuilding is the renderer-side
  half of the same field-by-field defence the handler applies main-side.
- `loadServerInfo` is unchanged in shape — one invoke, write the mapped value once, `catch` writes `[]`,
  the returned promise always resolves.
- `ServerInfoData` is unchanged: the one-shot `useEffect`, the StrictMode `active` guard, the
  `window.pyry` dereference inside the effect.

### The row — `src/renderer/src/screens/settings/ServerRow.tsx`

Three exports, of which the first is untouched:

- `ServerRow({ serverInfo: ServerInfoValue | null })` — **unchanged**. Still one row: label, id line,
  relay line, empty status slot, or the label plus the `Loading…` placeholder when null. Its four
  existing tests keep passing verbatim.
- `ServerRows({ servers: ServerInfoValue[] })` — NEW pure exported view. Non-empty → one `<ServerRow>`
  per entry, in the given order, keyed by `serverId`; empty → a single `<ServerRow serverInfo={null} />`,
  which reproduces the existing placeholder exactly and adds no copy string (AC3). Returns a fragment,
  so the rows are direct children of `.settings__section-body` and no wrapper changes the flex column.
- `ServerRowControl()` — keeps its name and arity (SettingsScreen imports it), reads `selectServers`
  from the store and hands it to `ServerRows`. Still a pure store read: no effects, no `window.pyry`.

The loop lives on the exported VIEW, not in the container, because the container's populated branch is
unreachable under `renderToStaticMarkup` (zustand v5 reads `getInitialState()`) — `ServerRow.test.tsx`'s
header and `settings-screen.md` both record this, and `e2e/` has no coverage of this row in either tier.
Putting it in the container would leave AC2 with no detector but a `vi.mock` of the store module, which
this file already declined once in favour of injected props. On the view, a two-entry injection
server-renders to two rows.

`serverId` as the React key: it is unique by store construction (decode raises
`MalformedPairedServerRecordError` on a repeated `server` id, so a duplicate collapses to `unavailable`
before it reaches the renderer) and stable across refetches, which index keys are not.

## State + concurrency model

One store slice, `servers`, written by exactly one path (the loader's `setServers`) and read by one
selector. `selectServers` returns the array reference, so a write re-renders `ServerRowControl` once
per Settings mount — the loader fires once per mount and writes once.

No new async work: the loader's one-shot invoke is the only task, and its cancellation path is the
existing `active` flag flipped by the effect cleanup. `list()` is a single `secureStore.get` + decode
that reads off the store's mutation chain, so a concurrent `save` yields either the pre- or the
post-write collection, never a torn one (`fileSecretPersistence` writes temp-then-rename). A row list
one write stale is corrected by the next Settings mount.

## Error handling

Unchanged at every layer, per AC5. The handler catches every throw from `list()` —
`MalformedPairedServerRecordError` or a propagated decrypt failure — and returns `{ status:
'unavailable' }` without inspecting the error type; the caught object is dropped, never logged,
interpolated or returned. The loader catches a rejected invoke and writes `[]`. The row renders the
existing placeholder for `[]`. No new failure mode is introduced: widening the read changes what a
successful read returns, not how a failed one is classified.

The module stays LOG-FREE by construction — no `console.*` on any path. That is the deliberate posture
for this channel (an error message here can carry a keychain path or record bytes), not an omission.

## Testing strategy

All vitest; no `e2e/` spec, since this row has no coverage in either Playwright tier and the ticket adds
no interaction. Renderer specs are static server renders (`renderToStaticMarkup`).

- `serverInfoHandler.test.ts` — the fake store becomes a `list`-only `Pick<MultiPairedServerStore,
  'list'>`. Scenarios: two records → `available` with both entries in `list()` order, each carrying its
  own id and relay (AC1); the serialized response contains both relays and NEITHER sentinel credential,
  with an `Object.keys` pin on the arm and on each entry (AC4); empty collection → `unavailable`
  (AC3); `MalformedPairedServerRecordError` and a plain decrypt-failure `Error` → `unavailable`,
  resolving not rejecting, with no path detail crossing (AC5); log-free across all four paths.
- `serverInfoStore.test.ts` — starts `[]`; `setServers` records the list in order; a later write
  replaces the whole array with no merge; two stores stay independent; injected initial state; setter
  reference stable.
- `serverInfoLoader.test.ts` — `mapServerInfo` on a two-entry `available` returns both in order with
  no `status` property on either entry, and returns fresh literals (not the bridge objects); an empty
  `servers` and `unavailable` both map to `[]`; `loadServerInfo` writes once per outcome and writes
  `[]` on a rejected invoke without rejecting into the caller; the real-store seam drives `[]` → two
  entries.
- `ServerRow.test.tsx` — the four existing single-row cases unchanged, plus `ServerRows`: two entries
  server-render to two rows in order, each with its own id and relay (AC2); an empty list renders one
  placeholder row with the label and `Loading…` and no blank value line (AC3).
- `SettingsScreen.test.tsx` — expected to pass unedited; its loading-branch assertion ("Server" +
  "Loading") is exactly what an empty store now renders. Verified in Phase B.

## Open questions

- Does `SettingsScreen.test.tsx` pass unedited under the `[]`-is-absent store? Expected yes; if the
  markup shifts, the fix is in `ServerRows`' empty branch, not in that test.
- Does any renderer consumer outside `ServerRow.tsx` read `selectServerInfo` / `setServerInfo`? The
  grep says no (loader + the two test files only). Confirmed at implementation time by the build.

## Security review

**Verdict:** PASS

**Findings:**

### 1. Trust boundaries

The only boundary this slice touches is main → renderer, inside `registerServerInfoHandler`'s listener.
It stays a single named function, and it does NOT move — it multiplies. The renderer → main direction
carries nothing: the query is a zero-argument invoke with no request body, so there is no untrusted
field to validate at the boundary and no request guard is warranted (the module's own header already
rules this).

**Finding (SHOULD FIX, carried into Phase B).** Widening the read turns the boundary from one object
literal into a `.map()` callback. A `...record` spread, or passing the `PairedServerRecord` through, now
costs N bearer tokens instead of one, and a loop body is where a later field addition (the host label of
#833/#834 is the obvious candidate) would be written. The explicit
`{ serverId: record.server, relayUrl: record.relay }` literal inside the map is load-bearing and must be
named as such in the code.

### 2. Tokens, secrets, credentials

`token` and `server_static_pubkey` remain structurally absent from `ServerInfoEntry`, so the compiler
still refuses to let either cross, per record. This slice generates no randomness, stores nothing, and
changes no token lifecycle.

**Finding (SHOULD FIX, carried into Phase B).** The handler's local scope now holds the FULL collection
of bearer tokens for the duration of one listener call, where it previously held one record. It must
stay local: never assigned to module state (the handler is stateless and stays so), never logged, never
interpolated, never returned. The array is unreferenced when the listener returns.

**Finding (SHOULD FIX — the highest-value one here).** The existing credential guard degrades silently
under a naive migration. `serverInfoHandler.test.ts`'s structural pin,
`Object.keys(response).sort()`, becomes `['servers', 'status']` and then passes while a credential rides
along INSIDE an entry — the pin is no longer looking where the fields are. The per-entry
`Object.keys(entry).sort()` pin required by the Testing strategy is what keeps AC4 detecting, and the
`JSON.stringify(response).not.toContain(SECRET_TOKEN)` assertions must be restated against a two-record
fixture whose entries carry DISTINCT sentinel credentials, so neither can false-pass by collision.

### 3. File / storage operations

Not applicable by design decision: this slice adds no filesystem operation. `list()` is
`createPairedServerStore`'s existing `read()` — one `secureStore.get` (Electron `safeStorage`-backed)
plus a decode. No path is constructed, so there is no traversal or TOCTOU surface; no write, so there is
no atomicity question. `serverId` never becomes a path, a store name, or an object key on the main side
(`loadById`'s comment already rules on this), and this slice does not change that.

### 4. Inter-process / Electron attack surface

No new channel, no new `contextBridge` API, no new argument. The preload invoker is unchanged, so the
exposed capability is not widened — it remains "ask for the paired-server identities", with the response
shape narrowed by the union.

Response size is now unbounded in N. Not a finding: N is the number of servers the user paired by hand
through the QR flow, so it is not attacker-controlled and not remotely inflatable, and each entry is two
short strings. An attacker able to forge a large collection into the encrypted blob would need the OS
keychain, at which point they already hold the account — out of scope, and unchanged by this slice.

`webPreferences`, navigation guards and window-open policy are untouched.

### 5. Cryptographic primitives

Not applicable by design decision: no RNG, no hashing, no key derivation, no handshake code, no secret
comparison (so no `timingSafeEqual` site). The Noise variant constant is not reached.

One considered case: `serverId` becomes a React `key`. It is daemon/QR-sourced text, but a React key is
an internal reconciliation identity and never reaches the DOM as an attribute, a URL, or a lookup path,
so CLAUDE.md's daemon-text sink rule is not engaged. Uniqueness is guaranteed upstream — the store's
decode raises `MalformedPairedServerRecordError` on a repeated `server` id, so a duplicate collapses to
`unavailable` before the renderer sees it.

### 6. Network & I/O

Not applicable by design decision: no socket, no frame, no timeout, no TLS configuration. The relay URL
on this path is DISPLAYED, never dialled — it comes off the at-rest record, and connecting to it is
`connectionRegistry`'s business, not this row's.

**Finding (SHOULD FIX, carried into Phase B).** `relayUrl` must stay an auto-escaped React text child in
every row. With N rows the URL line is more likely to overflow, which makes a `title={relayUrl}` tooltip
or an `<a href={relayUrl}>` the natural usability reflex — both put daemon-sourced text into an
attribute or a URL, which CLAUDE.md forbids outright. Neither is in this design and neither may be added
here; if the overflow needs handling, it is CSS, and `settings.css` is out of scope for this slice.

### 7. Error messages, logs, telemetry

The handler stays LOG-FREE on every path — no `console.*`, and the caught object is dropped rather than
logged, interpolated or returned, because a decrypt failure's message can carry a keychain path and a
malformed-record error can echo record bytes. That absence is the deliberate posture for this channel,
not a missing feature, and the existing log-free test is restated. The absent arm still carries no
error-reason field, so the error TYPE is never surfaced to the renderer (AC5); the renderer cannot tell
"never paired" from "blob unreadable", which is the intended information hiding.

No telemetry, no crash reporter, no new renderer console output.

### 8. Concurrency

The one async task is the loader's existing one-shot invoke, whose cancellation path is the StrictMode
`active` flag flipped by the effect cleanup — unchanged, and no new long-lived work is launched, so
there is no timer, listener or `AbortController` to add.

Check-then-act: the handler reads the collection and maps it with no `await` in the gap (`.map` is
synchronous), so there is no shared-state race to guard. `list()` reads off `createPairedServerStore`'s
mutation chain, so a concurrent `save` yields either the pre- or the post-write collection and never a
torn one — `fileSecretPersistence` writes temp-then-rename. A stale row list self-corrects on the next
Settings mount.

### 9. Threat model alignment

- **Hostile daemon / impersonation inside the session** — not on this path, and this is the trap #1117
  newly created. Now that the background process dials one live connection per record, a live
  `hello_ack.server_id` per server is available and would be the wrong source: it is daemon-asserted,
  and it is absent while disconnected. The row MUST keep sourcing the at-rest `PairedServerRecord`, as
  the contract's header has required since #339. **SHOULD FIX, carried into Phase B**: state this in the
  handler's comment so the next editor does not reach for the registry.
- **Malicious / compromised relay** — not on this path. Nothing here opens or reads a socket; the relay
  URL is a rendered string.
- **Token theft from disk** — unchanged. The collection stays `safeStorage`-encrypted, and this slice
  neither adds a read path outside `secureStore` nor a plaintext copy.
- **Renderer compromise reaching the transport** — unchanged and still bounded: a compromised renderer
  can invoke this channel and learn N server ids and relay URLs, which it could already learn for one.
  It gains no key, no token, no socket handle, and no new capability, because the union's shape is what
  limits the answer.
- **Out of scope, named:** per-server Unpair and its confirmation (#1152, natively blocked by this
  ticket) — this slice adds no mutation surface at all, so no CSRF-shaped "renderer asks main to erase
  server X" question arises here.

**No MUST FIX.** The three carried-forward SHOULD FIX items — the explicit per-entry literal, the
per-entry `Object.keys` pin, and the at-rest-not-live source — are design constraints already present in
the sections above; the review makes them explicit obligations for Phase B rather than changes to the
plan.
</content>
</invoke>
