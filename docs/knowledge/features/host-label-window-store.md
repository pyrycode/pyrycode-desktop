# Host-label window store

The window's held copy of **every paired server's** operator-typed **host label** — a dedicated Zustand
store fed by one keyed fetch per paired server through the [host-label
channel](host-label-channel.md), so a sidebar host row can name the machine its conversations live on
instead of showing a generic word, **including while disconnected**, since the label is at-rest state.

Introduced in [#833](https://github.com/pyrycode/pyrycode-desktop/issues/833), split off
[#826](https://github.com/pyrycode/pyrycode-desktop/issues/826) alongside
[#834](https://github.com/pyrycode/pyrycode-desktop/issues/834) (the sidebar row that consumes it).
Shipped **dormant** in #833 — no screen mounted the binding that ticket — mirroring
[server-info store](server-info-store.md) / [#340](../codebase/340.md)'s split from its consumer
([#334](../codebase/334.md)). #834 gave it its mount site and its first reader; see § Configuration
and usage below. This is the renderer-side counterpart of the main-process
[host-label store](host-label-store.md); the two share a name-root but not a layer — one persists to
disk, the other holds the read-back value in window state.

**\#1199 re-keyed the single slot by server id.** With more than one server paired, the single-valued
store answered for whichever machine was named or re-paired **last** — the row's own defect, on the
renderer side. `hostLabelFor(serverId)` was already on the preload bridge since
[#1157](https://github.com/pyrycode/pyrycode-desktop/issues/1157), over an already-keyed main-side
store; #1199 is the ticket that finally moved this store, its loader, and the row onto it. See § How it
works below for the shape and § Edge cases for what changed.

## What it does

Retains, **per paired server**, the host-label channel's three-arm outcome in a read-only store,
populated by one keyed `window.pyry.hostLabelFor(serverId)` invoke per paired server, issued once the
paired-server list resolves ([#1157](https://github.com/pyrycode/pyrycode-desktop/issues/1157) shipped
the channel; #1199 gave the renderer its first caller). Like [server-info
store](server-info-store.md), there is no daemon event behind this value — the main-process source is
disconnected-safe at-rest state — so **one-shot invokes**, not a subscription, are the correct shape.
The un-keyed `window.pyry.hostLabel()` this store read through until #1199 has no renderer consumer
left; the main-side handler stays registered ([#1186](https://github.com/pyrycode/pyrycode-desktop/issues/1186)
may still want it) but nothing here calls it.

The one structural difference from `server-info store`, unchanged by #1199: each server's held value
carries **four** arms, not an object-or-null. `HostLabelResult` deliberately keeps never-stored and
unreadable apart per [ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md) —
`ServerInfo` collapses the equivalent pair into one `unavailable` arm, so its store can use `null` for
"nothing yet". This store needs a fourth, pre-settle arm distinct from all three settled ones, per slot.

## How it works

| File | Role |
|---|---|
| `src/renderer/src/store/hostLabelStore.ts` | `HostLabelValue`, `HostLabelState`, DI factory, singleton, hook, selector — pure renderer state. |
| `src/renderer/src/store/hostLabelLoader.ts` | `mapHostLabel`, `loadHostLabel`, `startHostLabelLoad`, `HostLabelData` — the data path. |

### The held value — four arms per server, nested under one field, the map keyed by server id

```ts
export type HostLabelValue =
  | { status: 'loading' }                  // pre-settle; that server's read has not landed yet
  | { status: 'stored'; label: string }    // a label was read — '' IS a stored label
  | { status: 'not-stored' }               // never stored; the ONLY absence path
  | { status: 'error' }                    // unreadable: over-length, malformed, decrypt failure, or a rejected invoke

export interface HostLabelState { byServer: ReadonlyMap<string, HostLabelValue> }
```

`HostLabelValue`'s four arms are **unchanged by #1199** — they describe one server's read either way.
What changed is the state shape: a single `hostLabel` field became a `Map` keyed by server id, following
`sessionStore`'s `statuses` and `conversationListStore`'s `byServer`. A `Map`, not a `Record`: the key is
a string that crossed the IPC bridge, and a plain object keyed by it would make `'__proto__'` a
prototype-pollution sink, which a `Map` structurally cannot be.

A slot is **absent** until that server has been read for — the map is never pre-seeded with the servers
`serverInfoStore` holds. `loading` is the created-in arm and the answer for a slot nothing has been read
for yet, so no fifth arm was needed for "not read for": `selectHostLabelFor` (below) defaults a missing
slot to a **module-level shared** `{ status: 'loading' }` constant rather than a fresh literal per call —
reference stability matters here, since a narrow-slice reader compares with `Object.is`, and a new object
per call would make every store notification look like a change and re-render the row forever.

**The union stays nested under each slot's value, never intersected flat.** `stored` carries `label`;
the other three arms do not. Swapping the whole union object per slot on write means no key survives a
transition — the same reason [`newFolderStore`](new-folder-store.md) and
[`serverInfoStore`](server-info-store.md) nest, now with a second machine to leak a stale `label` to if
the nesting were ever flattened. A test asserts a `stored → not-stored` transition on one server's slot
leaves no `label` key, and that it leaves every *other* server's slot referentially untouched (see
Concurrency below).

### The store — one setter keyed by server id, not a reducer

`createHostLabelStore(init?)` (DI factory over `zustand/vanilla`), `initialHostLabelState = { byServer:
new Map() }`, `hostLabelStore` (app-wide singleton), `useHostLabelStore(selector)`,
`selectHostLabelFor(serverId: string | null)` (the only read surface — a selector *factory*, the
`selectStatusFor`/`selectRelayLinkStatusFor`/`selectConversationsFor` idiom already used across this
directory), `setHostLabelFor(serverId, value)` (the sole mutation, invoked only by the loader wiring;
replaces `setHostLabel`).

**`null` is an accepted id to `selectHostLabelFor`, and it is not a map key.** It is the frame the sidebar
renders before the paired-server one-shot resolves, when the row names nobody yet. It answers the same
shared `loading` constant a not-yet-read server does — deliberately, since `hostRowLabel` turns both into
the fallback word, which is precisely what the row showed at launch before #1199 too. Reading
`byServer.get(null)` instead would be wrong twice over: `null` is a legitimate slot key in the two status
stores (`sessionStore`/`relayLinkStore`, where an unstamped write lands there), so a null id must never
address a slot at all here either.

**Copy-on-write, inside zustand's functional updater.** `setHostLabelFor` clones the map, sets one slot,
and returns the clone from a `set((s) => …)` updater — never an object-spread over a variable captured
outside it. Both halves are load-bearing: cloning is what makes "a write for one server leaves every
other server's held value referentially identical" fall out of the shape instead of needing a test to
police it, and the functional form is what keeps two per-server invokes resolving in the same tick from
clobbering each other (a setter that read `byServer` from a closed-over `s` would silently drop
whichever write landed second).

A single setter rather than a reducer: there is exactly one mutation per slot ("record what the loader
mapped"), so a sealed action union would be a one-member union — ceremony without benefit. The *value* is
a discriminated union; the *mutation* is not. The setter's parameter type includes `loading`, but nothing
writes it — the map never produces it, and narrowing the parameter would need a second type for no gain.

### The map — three arms in, three arms out, ADR 0005 safe by construction

`mapHostLabel(res: HostLabelResult): HostLabelValue` is the pure, React-free collapse — the
`mapServerInfo` analog:

- `stored` → a **fresh** `{ status: 'stored', label: res.label }` literal, reconstructed rather than
  passed through, so nothing the union did not declare can ride an IPC payload into renderer state.
- `not-stored` → a fresh `{ status: 'not-stored' }`.
- everything else → `{ status: 'error' }`.

Written as **two positive checks followed by an unconditional final `return { status: 'error' }`** —
not a `switch` with a `not-stored` default, not an `assertNever` exhaustiveness check. The shape is the
point: there is no code path in the module from an unrecognised value to `not-stored`, so a
structurally-invalid response (a future arm, a buggy handler, a hostile invoke result) degrades to the
conservative outcome by construction rather than by a branch someone has to keep correct.

`label` is held **verbatim** — no trim, no coercion, no re-application of `MAX_HOST_LABEL_LENGTH`, no
escaping, no empty-to-null normalisation. [#824](https://github.com/pyrycode/pyrycode-desktop/issues/824)
already bounded and classified it main-side and returns the string untouched; re-checking here would
either duplicate a bound that can drift or invent an absence. `''` maps to
`{ status: 'stored', label: '' }`, distinct from both `not-stored` and `error`. **What the screen shows
for an empty or absent label is not decided here** — that is [the host row's](channel-list-host-row.md)
call, under CLAUDE.md's escaped-text-only rule (operator ruling 2026-08-20). `mapHostLabel` itself is
per-server-agnostic and unchanged by #1199 — every arm it maps is already a per-server fact.

### The load — one server at a time, always resolves, never `not-stored` on failure

`loadHostLabelFor(invokeFor, serverId, setHostLabelFor): Promise<void>` (#1199, replaces `loadHostLabel`)
resolves `invokeFor(serverId)`, writes `mapHostLabel(res)` into **that server's slot**, and on a
rejection writes `{ status: 'error' }` into the same slot. **The write key is the argument, never a
field of the response** — `HostLabelResult` carries no id at all (the bridge deliberately never echoes
one, so a refusal is indistinguishable from an unreadable label), and the id it was asked with is a
client-held value off the paired-server list. Keying the write off anything the main side sent back
would reintroduce, from the other direction, exactly the bug this path fixes: one machine's answer
landing on another machine's row.

The returned promise **always resolves** — it never rejects into the caller, so a late-arriving handler
failure cannot surface as an unhandled rejection in React. A rejected invoke means the handler is absent
or the main process died mid-query — that is "the stored label could not be read," which is `error`,
never `not-stored`; mapping it to `not-stored` would invent an absence out of a transport failure,
exactly the masking ADR 0005 forbids. The caught object is dropped unread — never logged, interpolated,
or stored. One server's failure is confined to one slot: the sibling reads are independent promises and
neither can be settled by the other's rejection.

### The one-shot guard — one flag over N reads, extracted, not inlined

`startHostLabelLoads(serverIds, invokeFor, setHostLabelFor): () => void` (#1199, replaces
`startHostLabelLoad`) raises **one** `active` flag covering every id, fires one `loadHostLabelFor` per
id with each write gated on that shared flag, and returns the cleanup that lowers it. One flag for all N
reads rather than one each, because they share a lifetime: started by one effect, cancelled by one
cleanup — a per-read flag would let a partially-cancelled mount write half its servers. This remains the
one place the design departs from `ServerInfoData`'s template, which inlines the same flag directly in
the effect: the guarantee here is about a **write**, a real conditional someone can get backwards, where
a subscription bridge's off-handle *is* its own cleanup and structurally cannot be wrong.

The guarantee, precisely: under StrictMode the **invokes** run twice and exactly one **write per server**
is applied — the first mount's cleanup lowers its flag, so its late-resolving writes are dropped and the
second mount's land. The invokes are deliberately not deduped with a module-level flag: that would also
block the re-read on a genuine remount, which is the point of mounting the binding per screen rather than
once at launch. Repeated invokes are cheap by construction — each is an independent local `loadFor()`
main-side, no amplification, no secret returned — and their count is bounded by how many machines the
user has paired.

### The binding — `HostLabelData`, headless, reads WHICH ids off `serverInfoStore`

A headless leaf (`HostLabelData(): null`). `window.pyry` is dereferenced only inside the effect, so it
server-renders to empty markup without a bridge mock — the `ServerInfoData` discipline.
`window.pyry.hostLabelFor` is passed as a bare reference: the preload API is an arrow closing over
`ipcRenderer`, so there is no `this` to bind.

**Which ids, since #1199: the paired-server list off `serverInfoStore`**, filled by the `ServerInfoData`
one-shot the sidebar mounts beside this one (see [Channel List — the host row and its connection
dots](channel-list-host-row.md)). Client-held, never wire-supplied — the rule
`conversationListStore`'s `selectConversationsFor` header states for its own read, applied here because
a daemon-supplied lookup key would let a confused or hostile server put one machine's name onto
another's row.

**Why the effect's dependency is a derived string, not the array.** `selectServers` hands back the held
array by reference, so it changes identity on every `setServers` write — including one that writes an
identical list. Depending on the reference would re-issue N invokes for each such write; the ids are
joined on a NUL separator (`ID_SEPARATOR`) and split back inside the effect, so it depends on a
value-derived key instead, and an identical list is a no-op. A server id containing a NUL — unreachable
through any pairing payload the client accepts — would split into fragments main does not know, each
answering not-stored: the row falls back to the generic word rather than showing a wrong machine's name,
a benign, self-correcting failure mode rather than a crash.

**Shipped dormant in #833; mounted, and given a mount SITE, by
[#834](https://github.com/pyrycode/pyrycode-desktop/issues/834); re-keyed by
[#1199](https://github.com/pyrycode/pyrycode-desktop/issues/1199).** `<HostLabelData />` mounts in the
`ChannelList` container (`ChannelList.tsx`), a sibling of `<ChannelListView />` and, since #1199, of
`<ServerInfoData />` too — the list the latter fills is what tells this binding which ids to read. See
[Channel List — the host row and its connection dots](channel-list-host-row.md) for the consumer and the
remount-triggers-reread argument in full.

### Data flow

```
host-label-store.loadFor(serverId) (main, at rest, #1156/#1157) → hostLabelHandler's keyed arm (#1157)
  → HostLabelResult (3 arms)
    → window.pyry.hostLabelFor(serverId)  [one invoke per paired server, on HostLabelData mount]
      → loadHostLabelFor → mapHostLabel → setHostLabelFor(serverId, …) → hostLabelStore   [4th, pre-settle arm per slot]

serverInfoStore's paired-server list (via <ServerInfoData /> mount, #1199)
  → HostLabelData's effect (keyed off a value-derived id string) → one loadHostLabelFor per id

<HostLabelData /> mount (inside the paired-only tree) → useHostLabelStore(selectHostLabelFor(serverId)) → the host row naming that server
```

## Configuration and usage

- **Import surface:** `import { HostLabelData } from '@renderer/store/hostLabelLoader'` and
  `import { useHostLabelStore, selectHostLabelFor } from '@renderer/store/hostLabelStore'`.
- **Mount point:** `<HostLabelData />` in the `ChannelList` container
  (`src/renderer/src/screens/channels/ChannelList.tsx`), decided by #834, beside `<ServerInfoData />`
  since #1199. One read per paired server, per sidebar mount.
- **Reader:** `HostRowControl` (`ChannelList.tsx`), through `selectHostLabelFor(serverId)` and the pure
  collapse `hostRowLabel` — see [Channel List — the host row and its connection
  dots](channel-list-host-row.md).

## Concurrency

Two per-server resolutions landing in the same tick cannot clobber one another because
`setHostLabelFor`'s mutation happens inside zustand's functional `set((s) => …)` updater, which sees the
latest state rather than a value captured at call time — see § The store above.

## Edge cases and limitations

- **The label outlives an unpair — only within one running app session.** [#827](https://github.com/pyrycode/pyrycode-desktop/issues/827)
  erases the at-rest label alongside the paired-server record (see [Unpair channel § the label
  erase (#827)](unpair-channel.md)), so a relaunch after unpairing sees no stale label. But
  `clearPairingScopedState` does not reset *this* renderer store, so unpairing and re-pairing to a
  different host inside one running session leaves that server's slot holding the previous label until
  the next `hostLabelFor()` load overwrites it. Resolved in practice by #834's mount site: `ChannelList`
  (and therefore `<HostLabelData />` and `<ServerInfoData />`) remounts on the return leg of every path
  that ends a pairing inside one session (`settings` → `pairServer` → `list`), so the next load lands
  before the row is shown again. This store still reports what the channel reports, and adds no
  cross-store consistency check.
- **`error` and over-length both mean "no usable label"**, and the union does not distinguish them — the
  same non-distinction as the channel it consumes. Both call for the same recovery in the row's design.
- **A write that resolves after unmount is dropped**, never applied — the shared `active`-flag cleanup
  in `startHostLabelLoads`.
- **A missing slot and a `null` id both answer the same shared `loading` constant** — see § The held
  value above. Neither is "unknown" in a way the row can tell apart from "not yet read."
- **Never holds a credential.** The value on this path is the operator-typed machine name only; `token`
  and `server_static_pubkey` are structurally absent upstream (#824's union has no field for them). The
  value is never written to `localStorage`, `sessionStorage`, or IndexedDB — it lives only in the zustand
  cell, matching #834's security review ruling that this was also a MUST-NOT for the row that consumes
  it, and confirmed unbroken by the shipped implementation. `serverId` is likewise non-secret and never
  becomes a key, an attribute, a class, a title, or a log line anywhere in this store — see [Channel List
  — the host row and its connection dots](channel-list-host-row.md) for where that discipline is stated
  for the consumer.

## Related

- [Host-label channel](host-label-channel.md) / [#824](https://github.com/pyrycode/pyrycode-desktop/issues/824)/[#1157](https://github.com/pyrycode/pyrycode-desktop/issues/1157) —
  the IPC surface this loader invokes; the three-arm union `mapHostLabel` extends to four, and the keyed
  channel #1199's loader reads through.
- [Host-label store](host-label-store.md) / [#822](https://github.com/pyrycode/pyrycode-desktop/issues/822) —
  the main-process, at-rest counterpart; shares a name-root, not a layer. Its keyed `saveFor`/`loadFor`
  triple (#1155/#1156) is what #1199's `loadFor` bridge call ultimately reads.
- [Server-info store](server-info-store.md) / [#340 codebase notes](../codebase/340.md) — the structural
  template for every layer of this store (DI-factory → singleton → hook → selector, pure map, injected
  load, headless binding); since #1199 also the source of WHICH ids this store reads for.
- [New-folder store](new-folder-store.md) — the other precedent for nesting a discriminated union under
  one store field rather than intersecting it flat, for the identical stale-key reason.
- [Session store](session-store.md) / [#1133](https://github.com/pyrycode/pyrycode-desktop/issues/1133) and
  [conversation list store](conversation-list-store.md) — the sibling keyed-map stores (`statuses`,
  `byServer`) this store's `byServer` shape follows.
- [ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md) — the rule this store must not
  undo: an unreadable record is never masked as never-stored.
- [Channel List — the host row and its connection dots](channel-list-host-row.md) /
  [#834](https://github.com/pyrycode/pyrycode-desktop/issues/834)/[#1199](https://github.com/pyrycode/pyrycode-desktop/issues/1199) —
  the sidebar host row that mounts `HostLabelData` (and, since #1199, `ServerInfoData` beside it) and
  renders the value for the server it names.
