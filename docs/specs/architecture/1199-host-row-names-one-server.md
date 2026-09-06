# #1199 — the sidebar host row names ONE server: its label and its dots read by server id

## Files read

- `src/renderer/src/store/hostLabelStore.ts` → `HostLabelValue`, `HostLabelState`, `selectHostLabel`,
  `setHostLabel` — the single-slot store this ticket re-keys. Its header's nesting argument (the union
  under one field, never intersected flat) is the constraint the keyed shape must preserve.
- `src/renderer/src/store/hostLabelLoader.ts` → `mapHostLabel`, `loadHostLabel`, `startHostLabelLoad`,
  `HostLabelData` — the three-arm collapse (unchanged), the write path, and the StrictMode one-shot
  guard whose "invoke twice, apply exactly one write" contract is a written obligation with its own tests.
- `src/renderer/src/store/serverInfoStore.ts` → `selectServers`, `ServerInfoValue` — the paired-server
  list in `pairedServerStore.list()` order (oldest-paired first), and the empty-list-is-the-only-absent-form
  collapse the launch frame relies on.
- `src/renderer/src/store/serverInfoLoader.ts` → `ServerInfoData`, `loadServerInfo` — the shipped one-shot
  that fills that list. This ticket mounts it in `ChannelList`; it currently mounts only in Settings and
  ConversationScreen.
- `src/renderer/src/store/sessionStore.ts` → `selectStatusFor`, `selectStatus`, `initialSessionState`,
  `StatusOrigin` — the per-server daemon status (undefaulted, `undefined` for a silent server) and the
  app-wide cell's initial value, which is the collapse target for a silent one.
- `src/renderer/src/store/relayLinkStore.ts` → `selectRelayLinkStatusFor`, `initialRelayLinkState` — the
  same, relay side. Its header states the "call it with a client-held id" rule this design obeys.
- `src/renderer/src/store/conversationListStore.ts` → `byServer`, `selectConversationsFor` — the keyed
  copy-on-write idiom this store follows, and the header stating the take-the-id-from-the-client rule.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `hostRowLabel`, `HostRow`, `HostRowControl`,
  `HostConnectionDots`, `HostConnectionDotsControl`, `HOST_ROW_FALLBACK_LABEL` — the row itself. The pure
  view / store-bound container split is the seam the unit tier reaches the matrix through.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `daemonLeg`, `relayLeg`,
  `ConnectionLeg` — the two leg mappings the dots reuse across screens; their argument types
  (`ConnectionStatus`, `RelayLinkStatus | null`) are what force the silent-server collapse.
- `src/preload/index.ts` → `hostLabelFor` — the keyed bridge method (#1157), already typed onto
  `window.pyry` through the inferred `PyryApi`. Its header records that a refusal is indistinguishable
  from an unreadable label, so the renderer gets no oracle.
- `src/main/pairingHandler.ts` → the `hostLabel?.saveFor(prepared.serverId, request.label)` call —
  confirms the keyed write uses `parsed.payload.server`, the same id `serverInfoHandler` reports and
  `connectionRegistry` stamps events with. One id space, verified rather than assumed.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → the `#834` and `#718` describes — the
  four-arm matrix and the dot contract, both proven through the exported pure views.
- `e2e/fixtures/launchPairedApp.ts` → `LaunchControl.hostLabel`, `secondServer`, `PairedServerHandle`,
  `FIRST_SERVER_ID`, `SECOND_SERVER_ID` — the two-daemon launch. `hostLabel` types a name for the FIRST
  pairing only, which is what makes "server 1 named, server 2 unnamed" reachable with no fixture change.
- `e2e/unpair-repair.spec.ts` → its two-server drop drive — the proven `serverA.forwarder.closeClientLeg(4401)`
  shape and the list→thread click that a `secondServer` launch needs.
- `e2e/host-label-sidebar.spec.ts` → the end-to-end label population, asserted by character count and
  never by value. That posture carries into this ticket's spec.
- `docs/knowledge/features/channel-list.md`, `.../renderer-stores.md` — the package overviews for the two
  areas touched.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=106-3094

The node id in the ticket body **no longer resolves** in the file — both `get_design_context` and
`get_screenshot` answer "node not found" for `106:3094`, so it has been deleted or renumbered since #834
and #718 built the row against it. Read the parent desktop frame (`102-4`) instead, which contains the row
in situ: the sidebar draws a host row per machine — a 12px server-rack glyph, the machine's name in the
body-small type, and a pair of 6px connection dots pinned flush to the row's right edge — repeated under
both the Channels and the Chats headings, with **"Pyrybox" and "Macbook" each carrying their own dot pair**.
That two-named-rows picture is exactly what this ticket makes reachable and what #1070 then loops.

**This ticket changes no pixel.** AC5 pins the rendered markup byte-identical for the one-server case,
launch frame included; only the source of the label and of the two dots' categories moves. No CSS is
touched, so `e2e/sidebar-tree-geometry.spec.ts`'s `.channel-list__host-label` measurements are unaffected.

## Context

The host row reads two app-wide globals, and with two machines paired both answer for whichever server was
named or moved last: `HostRowControl` reads `selectHostLabel` off a single-slot store filled by the unkeyed
`window.pyry.hostLabel()`, and `HostConnectionDotsControl` reads `selectStatus` and `selectRelayLinkStatus`,
both "most recently written across every connection" cells.

Every part needed to fix it has already landed with no consumer: `hostLabelFor` on the preload bridge
(#1157) over a keyed main-side store (#1155/#1156), `selectStatusFor` (#1133), `selectRelayLinkStatusFor`
(#1134), and the paired-server list in `serverInfoStore` (#1148). Both status bridges already file every
status into their keyed map under the event's own origin stamp, so the keyed cells are live in production
today — **only the read side is missing**, which is what makes AC4 a detector rather than a test of code
this ticket writes. This slice moves the row onto them while it is still a single row; #1070 turns it into
a loop.

No ADR is warranted: this consumes contracts three prior tickets already recorded, and adds no new
boundary, channel or wire type.

## Design

### The store — `hostLabelStore.ts`

`HostLabelValue`'s four arms are **unchanged**, and the nesting that keeps `label` off the three non-`stored`
arms stays: a flat re-key would leak one machine's name across another's transition, which is the exact
failure the current header argues against, now with a second machine to leak to.

The state's single `hostLabel` slot becomes a keyed map, following `sessionStore`'s `statuses` and
`conversationListStore`'s `byServer`:

- `HostLabelState` → `{ byServer: ReadonlyMap<string, HostLabelValue> }`, initial `new Map()`.
- `setHostLabelFor(serverId: string, value: HostLabelValue)` replaces `setHostLabel`. Copy-on-write inside
  zustand's **functional** `set((s) => …)` updater — clone the map, set one slot, return it. AC1's
  "every other server's held value is referentially identical" falls out of that rather than needing a
  test to police it, and the functional form is load-bearing for a second reason under Concurrency below.
- `selectHostLabelFor(serverId: string | null)` replaces `selectHostLabel`. A missing slot — and a `null`
  id, the frame before the paired-server list has resolved — both answer a **module-level shared**
  `{ status: 'loading' }` constant. `loading` is already the created-in arm and `hostRowLabel` already
  collapses it to the fallback word, so no new arm is needed; the constant must be shared rather than a
  fresh literal per call, or a narrow-slice reader would re-render on every store notification.

A `Map`, not a `Record`. The key is a string that arrived over IPC, and a plain object keyed by it would
make `'__proto__'` a prototype-pollution sink; `Map` has no such sink. Stated in the store's header.

### The data path — `hostLabelLoader.ts`

`mapHostLabel` is unchanged — same three-arm collapse, same verbatim label, same unconditional `error`
default. The two write functions gain the id:

- `loadHostLabelFor(invokeFor, serverId, setFor)` — `invokeFor(serverId)`, then
  `setFor(serverId, mapHostLabel(res))`; on rejection `setFor(serverId, { status: 'error' })`. The promise
  always resolves. **The write key is the argument, never a field of the response** (see Security review).
- `startHostLabelLoads(serverIds, invokeFor, setFor)` replaces `startHostLabelLoad` — one `active` flag
  covering all N reads, one cleanup that lowers it, returning `() => void`. The StrictMode contract is
  preserved per server: invoke twice, apply exactly one write.

`HostLabelData` reads `selectServers` and fires the reads for the ids it finds. Its effect depends on a
**value-derived key** (the ids joined on a NUL separator and split back inside the effect), not on
the array reference, so a referentially-new list holding the same ids does not re-issue N invokes.
The round-trip through the separator is deliberate: it leaves the effect depending on nothing but the
key, so there is no stale-closure question. A server id containing a NUL would split into ids main
does not know, each answering not-stored — the row falls back to the generic word, degrading safely.

### The row — `ChannelList.tsx`

`ChannelList` mounts `<ServerInfoData />` beside `<HostLabelData />` — the smallest route to the list, and
the list #1070 iterates.

`HostRowControl` resolves the named server once: `useServerInfoStore((s) => s.servers[0]?.serverId ?? null)`,
a primitive read in the `openConversationId` idiom already in this file. It passes that id to `HostRow` as
a new `serverId: string | null` prop and reads the label through `selectHostLabelFor(serverId)`.

`HostRow` gains `serverId` as pure pass-through to its dot subtree — it names the machine the row is about,
and it is the shape #1070's loop needs. `HostRow`'s header already declines four sinks for the label; the
id gets the same treatment and the ticket's fifth-sink answer: **the key is the server id, the value is the
label, and neither ever becomes an attribute, a class, a React key, a title, a URL or a log line.**

`HostConnectionDotsControl({ serverId })` reads each leg through its own per-server selector and flattens
`undefined` at the point of use:

- daemon: `daemonLeg(status ?? initialSessionState.status)`
- relay: `relayLeg(relayStatus ?? initialRelayLinkState.status)`

The collapse target is written as **the two stores' own initial cells**, not as restated literals. That is
AC5's launch frame by construction rather than by a constant someone must keep in sync: today's first frame
is the app-wide pair's initial cell — the offline daemon dot and the unknown relay dot — and a silent
server now lands on exactly the same values by reading the same constants. Stated in the container's header.

A `null` id never reaches a keyed selector: `StatusOrigin` admits `null` as a real slot (unstamped writes
land there), so passing it through would read someone else's cell. Both containers branch before the read.

`hostRowLabel` and the two pure views' markup are untouched.

## State + concurrency model

Renderer state only: three zustand singletons read, one written (`hostLabelStore`). No IPC beyond two
existing one-shot invokes, no daemon events, no sockets, no timers, no listeners.

Ordering across a sidebar mount: `ServerInfoData`'s invoke resolves → `serverInfoStore` fills → the derived
key changes → `HostLabelData`'s effect issues one `hostLabelFor` per id → each resolution writes one slot.
Every intermediate frame renders the fallback word and the initial dot pair, which is what the row shows
today at launch.

Cancellation is the `active` flag alone, lowered by the effect cleanup on unmount — the shipped one-shot
posture, with no subscription to unwind. `ChannelList` remounts on return from settings / archive /
pairServer, which re-reads both lists; it does not remount across the `list` ↔ `thread` flip.

Two per-server resolutions landing in the same tick cannot clobber one another because the setter's
mutation happens inside zustand's functional updater, which sees the latest state rather than a value
captured at call time.

## Error handling

Per server, independently, which is AC2's whole claim: a rejected `hostLabelFor` invoke or a main-side
`error` arm writes `{ status: 'error' }` into **that** slot; every other slot keeps its value and its
reference. `mapHostLabel`'s unconditional `error` default keeps ADR 0005's never-mask-unreadable-as-absent
rule by construction. The caught rejection object is dropped unread — never logged, interpolated or stored.

At the row, all four non-name outcomes converge on `HOST_ROW_FALLBACK_LABEL` through the unchanged
`hostRowLabel`, so an unnamed, unreadable or not-yet-read machine reads as the generic word rather than
borrowing a neighbour's name.

Dots: a server that has reported nothing is not an error state — it collapses to the initial cell, which
reads "Pyrycode Offline" / "Relay Unknown". No fifth category is invented.

## Testing strategy

**vitest (node, static markup).**

- `hostLabelStore.test.ts` — the keyed slot round-trips all four arms; a write for one server leaves
  another's held value `toBe`-identical (AC1); a missing slot and a `null` id both answer `loading`, and the
  answer is the same reference across calls; the four-arm nesting still swaps wholesale (no `label` survives
  a `stored → not-stored` transition); isolated stores stay independent; `setHostLabelFor`'s reference is
  stable.
- `hostLabelLoader.test.ts` — `mapHostLabel` unchanged; `loadHostLabelFor` writes under the **requested**
  id for each arm and for a rejection; a rejection for one server leaves the other's slot untouched (AC2);
  `startHostLabelLoads` issues one invoke per id and, across a StrictMode mount → cleanup → mount, applies
  exactly one write per server; a cleanup before resolution applies none; `HostLabelData` renders empty
  markup with no bridge mock.
- `ChannelList.test.tsx` — the `#834` matrix keeps proving `hostRowLabel` and `HostRow` (both unchanged in
  behaviour); the `HostRow` call sites gain `serverId={null}`, which is the launch frame the server
  renderer can reach; the default markup still renders the fallback in both trees and the two dot classes
  and accessible names are unchanged (AC5).

**Playwright, fake tier — `e2e/host-row-per-server.spec.ts` (new).** AC4's detector, unreachable from the
unit tier: `launchPairedApp({}, { hostLabel, secondServer: {} })` — both options are `LaunchControl`, the
SECOND argument; the first is daemon-reply knobs only and silently drops an unknown extra — click server
A's row to reach the thread
(so the composer's app-wide-status surface is on screen beside the sidebar), read the host row's two
`aria-label`s as a **live** baseline, then `servers[1].forwarder.closeClientLeg(4401)`.

The positive, auto-waiting read is ordered **first**: the composer's Re-pair button appearing proves the
drop reached the renderer, because that control reads the app-wide `selectStatus` cell the dropped leg
writes. Only then is the host row's pair re-read and asserted identical. Both halves are non-vacuous — the
baseline asserts a connected leg rather than any value, and the app-wide surface is proven to have moved in
the same window in which the row did not. Against today's app-wide read the row's dots move with it and the
spec reddens.

Secret hygiene follows `host-label-sidebar.spec.ts`: the label is asserted by **character count**, never by
value, so no failure diff can print it. Every other assertion reads an accessible name from a client-owned
constant or a small integer.

`e2e/multi-server-launch.spec.ts`'s header states that the row "reads a single-valued `hostLabelStore`" and
defers per-server dots to #1070. This ticket falsifies the first clause and takes the dots half of the
second; those comment lines are corrected to name #1199.

## Open questions

1. **Does the keyed main-side read answer for a fixture pairing?** `pairingHandler` calls
   `hostLabel.saveFor(prepared.serverId, request.label)` with `parsed.payload.server`, the same id
   `serverInfoHandler` reports — verified during Phase A, so the e2e label path should stand. Confirm
   end-to-end that `e2e/host-label-sidebar.spec.ts` stays green through the extra round trip.
2. **Does `HostRow` gaining a prop it does not render read as a smell?** The alternative is each container
   resolving `servers[0]` independently, which duplicates the derivation. Prop chosen for single-sourcing
   and for #1070's loop; revisit if the implementation shows the pass-through is unused.
3. **Do the per-server relay slots actually fill in the fake tier?** If server A's relay slot is silent at
   the baseline read, the relay dot reads "Relay Unknown" rather than connected. The spec takes its
   baseline from the live render rather than asserting a literal, so it holds either way, but the
   **daemon** dot must read connected for the test to be a detector — assert that one explicitly.

Each resolution lands in a `## Revisions` entry if it changes the design.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST FIX, and one invariant made explicit. The one boundary this ticket adds a
  caller for is `window.pyry.hostLabelFor(serverId)` — renderer → main, untrusted → trusted, already
  validated main-side on its own merits (the preload header records that building the request object in the
  bridge is a convenience, not a defence). Two rules the design pins because getting either backwards is
  the cross-machine leak this ticket exists to prevent: (a) **every id is client-held** — `HostLabelData`
  takes ids only from `selectServers`, and `HostRowControl` only from `servers[0]`; no daemon-supplied
  field is ever a lookup key, which is `conversationListStore`'s stated rule applied here. (b) **the write
  key is the argument, never a response field** — `HostLabelResult` deliberately never echoes the id
  (preload header), so `loadHostLabelFor` writes under the id it queried with. A future edit that keyed the
  write off a response field would let one machine's answer land on another's row: MUST FIX if it appears.
- **[Tokens, secrets, credentials]** No findings. No token, key or credential is read, written or crossed.
  The host label is operator-typed untrusted text, not a credential; it stays in renderer memory, never
  reaching `localStorage`, `sessionStorage`, IndexedDB or disk. The `serverId` is non-secret —
  `serverInfoHandler` already vets it as such for the Settings list. The ticket's fifth-sink warning is
  answered in `HostRow`'s header and enforced by the shipped "label occurs exactly once, immediately after
  the label span's opening tag" assertion, which catches any new attribute nobody thought to ban.
- **[File / storage operations]** Not applicable, and by design rather than by omission: this ticket adds
  no filesystem access, no path construction and no at-rest write. The label's at-rest storage is #1155/#1156's,
  main-side, unchanged here.
- **[Inter-process / Electron attack surface]** No findings. No new `contextBridge` method, no new
  `ipcMain` channel, no `webPreferences` change, no protocol handler, no navigation. This ticket adds a
  *caller* for an existing keyed channel. Amplification was checked concretely: the invoke count is bounded
  by the paired-server count, each read is an independent at-rest query with no state mutation and no secret
  returned, and a refusal is indistinguishable from an unreadable label, so a compromised renderer gains no
  oracle for guessing ids. The effect's dependency is a **value-derived** key rather than the array
  reference specifically so a repeated `setServers` write of an identical list cannot spin the effect into
  a re-invoke loop — the deterministic half of that guard, not a convention.
- **[Cryptographic primitives]** Not applicable. No randomness, no hashing, no key material, no Noise
  surface; the handshake and the transport stay where they are, in the background process.
- **[Network & I/O]** Not applicable. No socket, no URL, no frame, no timeout to set. The only I/O is two
  existing one-shot IPC invokes.
- **[Error messages, logs, telemetry]** No findings. This ticket adds **no `console.*` call anywhere** — a
  useful one would have to carry the label (operator content) or the id, and ADR 0007's content-free rule
  and CLAUDE.md both forbid the first. `loadHostLabelFor`'s catch drops the rejection object unread. The
  e2e spec asserts the label by character count, so a failing diff prints a small integer.
- **[Concurrency]** No findings, and one load-bearing choice recorded. N per-server invokes resolve
  independently and can land in the same tick; the setter mutates inside zustand's functional
  `set((s) => …)` updater, so each read sees the latest map. An object-spread setter capturing `s.byServer`
  outside the updater would silently lose a slot on a concurrent resolution — that shape is a MUST FIX if it
  appears in review. Teardown is the single `active` flag lowered by the effect cleanup; no timers, no
  listeners, no sockets, nothing that can outlive the sidebar.
- **[Threat model alignment]** A hostile or confused daemon cannot steer this row: it supplies no lookup
  key on either the label path or the dot path, and both status bridges stamp origin from the connection
  rather than the payload. A malicious relay is content-blind and reaches nothing here — the label is
  at-rest state read main-side. A renderer compromise gains no capability it did not already have.
- **[Threat model alignment]** OUT OF SCOPE — **serverId collision across pairings.** A pairing payload
  claiming an already-paired `server` id would make the new machine inherit the keyed slots of the old one,
  including its host label, until the next read. This is a pairing-layer concern shared by every store
  already keyed on this id space (`sessionStore.statuses` #1133, `relayLinkStore.statuses` #1134,
  `conversationListStore.byServer`, and the main-side keyed label store #1156, whose `saveFor` overwrites
  at pairing time anyway); this ticket introduces no new instance of it and inherits the id space as it
  stands. Not deferred to a named ticket because none exists — flagged here for whoever hardens the
  pairing-payload identity check.
- **[Threat model alignment]** OUT OF SCOPE — retiring the unkeyed `hostLabel()` main-side arm, which
  loses its last renderer consumer here. The ticket defers it explicitly (#1186 may still want it); leaving
  the handler registered is fine, and this ticket's obligation is only that the renderer stops reading both.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-06

## Revisions

### 2026-09-06 — open questions resolved; the e2e spec ships both halves green

**What changed.** Nothing in the design above. The e2e spec proves AC4 (the per-server dots) and AC3's
two-server label half, both unskipped. No production code changed as a result of any open question.

**Open question 1, resolved: yes.** The keyed main-side read answers for a fixture pairing, including
with a second server paired — `launchPairedApp({}, { hostLabel, secondServer: {} })` names machine 1,
leaves machine 2 unnamed, and the row naming machine 1 shows machine 1's name.
`e2e/host-label-sidebar.spec.ts` also stays green through the extra round trip.

**Open question 2, resolved: keep the prop.** `serverId` is read by the dot subtree on every render, so
it is not an unused pass-through, and it is the shape #1070's loop needs.

**Open question 3, resolved: yes, the per-server relay slot fills.** The spec now pins the relay dot's
live category (`Relay Connected`) alongside the daemon dot's rather than leaving it to the baseline
capture, so both legs of the "did not move" comparison start from an asserted state rather than from
whatever the render happened to hold.

**Verified by mutation.** Reverting `HostConnectionDotsControl` to the app-wide reads and rebuilding
reddens the spec at the AC4 assertion.

### 2026-09-06 — the #1200 deferral is withdrawn: it was a fixture-argument bug in this ticket's own spec

**What changed.** The AC3 two-server assertion is un-skipped and passes. Bug #1200 is closed as not
reproducible. The Revisions entry that stood here — reporting that pairing a second server erases the
first server's stored host label — was wrong and has been removed rather than amended, because every
observation in it was an artefact.

**What drove it.** The spec passed `hostLabel` in `launchPairedApp`'s FIRST argument. It lives on
`LaunchControl`, the second. The first argument is `LaunchPairedAppOptions` — daemon-reply knobs — so
the property was an unknown extra, dropped silently; `control.hostLabel` was `undefined`, and
`drivePairingForm`'s `if (label !== undefined)` guard never filled the host-name field. **No machine was
ever named.** Every downstream reading followed: `hostLabelFor(id)` answering `not-stored` for both ids
and `hostLabel()` answering `not-stored` too are exactly what a store holding no label returns. There
was no main-side defect. Moving the option to the second argument is the only change, and both the
keyed read and the unkeyed one then answer with the stored label.

**Why nothing caught it.** No tsconfig includes `e2e/` and Playwright strips types with esbuild, so the
excess-property error (TS2353) surfaced in no gate — the spec ran green with a dead option, and every
assertion that did not read the label still passed. An ad-hoc `tsc --noEmit` over the spec is the only
detector, and it is now part of this ticket's verification.

**The lesson worth carrying.** A skipped test and a filed bug are load-bearing claims about production
code, so the bar for filing one is that the setup the repro rests on is proven to have happened — not
that the assertion failed. Here the failing assertion was the *only* evidence of the setup, and it was
also the thing the broken setup made fail, so it could never have discriminated. The check that would
have caught it costs one command: typecheck the spec.
