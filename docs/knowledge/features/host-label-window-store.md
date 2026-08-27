# Host-label window store

The window's held copy of the operator-typed **host label** — a dedicated Zustand store fed by a
one-shot fetch of the [host-label channel](host-label-channel.md), so a sidebar host row can name the
machine the conversations live on instead of showing a generic word, **including while disconnected**,
since the label is at-rest state.

Introduced in [#833](https://github.com/pyrycode/pyrycode-desktop/issues/833), split off
[#826](https://github.com/pyrycode/pyrycode-desktop/issues/826) alongside
[#834](https://github.com/pyrycode/pyrycode-desktop/issues/834) (the sidebar row that consumes it).
Shipped **dormant** in #833 — no screen mounted the binding that ticket — mirroring
[server-info store](server-info-store.md) / [#340](../codebase/340.md)'s split from its consumer
([#334](../codebase/334.md)). #834 gave it its mount site and its first reader; see § Configuration
and usage below. This is the renderer-side counterpart of the main-process
[host-label store](host-label-store.md); the two share a name-root but not a layer — one persists to
disk, the other holds the read-back value in window state.

## What it does

Retains the host-label channel's three-arm outcome in a read-only store, populated by exactly one
`window.pyry.hostLabel()` invoke per mount ([#824](https://github.com/pyrycode/pyrycode-desktop/issues/824)).
Like [server-info store](server-info-store.md), there is no daemon event behind this value — the
main-process source is disconnected-safe at-rest state — so a **one-shot invoke**, not a subscription,
is the correct shape.

The one structural difference from `server-info store`: the held value carries **four** arms, not an
object-or-null. `HostLabelResult` deliberately keeps never-stored and unreadable apart per
[ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md) — `ServerInfo` collapses the
equivalent pair into one `unavailable` arm, so its store can use `null` for "nothing yet". This store
needs a fourth, pre-settle arm distinct from all three settled ones.

## How it works

| File | Role |
|---|---|
| `src/renderer/src/store/hostLabelStore.ts` | `HostLabelValue`, `HostLabelState`, DI factory, singleton, hook, selector — pure renderer state. |
| `src/renderer/src/store/hostLabelLoader.ts` | `mapHostLabel`, `loadHostLabel`, `startHostLabelLoad`, `HostLabelData` — the data path. |

### The held value — four arms, nested under one field

```ts
export type HostLabelValue =
  | { status: 'loading' }                  // pre-settle; the one-shot has not landed yet
  | { status: 'stored'; label: string }    // a label was read — '' IS a stored label
  | { status: 'not-stored' }               // never stored; the ONLY absence path
  | { status: 'error' }                    // unreadable: over-length, malformed, decrypt failure, or a rejected invoke

export interface HostLabelState { hostLabel: HostLabelValue }
```

`loading` is the created-in state; the loader leaves it exactly once and nothing ever returns to it.
Reusing `not-stored` for the pre-settle state would make the row claim absence during the round trip;
reusing `error` would flash a recovery affordance before anything failed.

**The union is nested under `hostLabel`, never intersected flat into the store object.** `stored`
carries `label`; the other three arms do not. Zustand's `set` shallow-merges at the top level, so a flat
`{ status, label?, setHostLabel }` shape would leave a stale `label` key behind on a
`stored → not-stored` transition — an absent label rendering as the previous host's name. Nesting swaps
the whole union object wholesale, so no key survives a transition — the same reason
[`newFolderStore`](new-folder-store.md) and [`serverInfoStore`](server-info-store.md) nest. A test
asserts the transition leaves no `label` key.

### The store — single setter, not a reducer

Same surface as `serverInfoStore`, with `HostLabelValue` in place of `ServerInfoValue | null`:
`createHostLabelStore(init?)` (DI factory over `zustand/vanilla`), `initialHostLabelState`,
`hostLabelStore` (app-wide singleton), `useHostLabelStore(selector)`, `selectHostLabel` (the only read
surface), `setHostLabel` (the sole mutation, invoked only by the loader wiring).

A single setter rather than a reducer: there is exactly one mutation ("record what the loader mapped"),
so a sealed action union would be a one-member union — ceremony without benefit. The *value* is a
discriminated union; the *mutation* is not. The setter's parameter type includes `loading`, but nothing
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
for an empty or absent label is not decided here** — that is [#834](https://github.com/pyrycode/pyrycode-desktop/issues/834)'s
call, under CLAUDE.md's escaped-text-only rule (operator ruling 2026-08-20).

### The load — always resolves, never `not-stored` on failure

`loadHostLabel(invoke, setHostLabel): Promise<void>` resolves `invoke()`, writes `mapHostLabel(res)`,
and on a rejection writes `{ status: 'error' }`. The returned promise **always resolves** — it never
rejects into the caller, so a late-arriving handler failure cannot surface as an unhandled rejection in
React. A rejected invoke means the handler is absent or the main process died mid-query — that is "the
stored label could not be read," which is `error`, never `not-stored`; mapping it to `not-stored` would
invent an absence out of a transport failure, exactly the masking ADR 0005 forbids. The caught object is
dropped unread — never logged, interpolated, or stored.

### The one-shot guard — extracted, not inlined

`startHostLabelLoad(invoke, setHostLabel): () => void` is five lines pulled out of the effect: raise an
`active` flag, kick off `loadHostLabel` with the write gated on it, return the cleanup that lowers the
flag. This is the one place the design departs from `ServerInfoData`'s template, which inlines the same
flag directly in the effect. The reason: the guarantee here is about a **write**, a real conditional
someone can get backwards, where a subscription bridge's off-handle *is* its own cleanup and structurally
cannot be wrong. Pulling the flag into a React-free function turns StrictMode's effect → cleanup → effect
sequence into a deterministic three-call test with no DOM, which is what this repo's
`environment: 'node'` renderer tests need to prove AC4 rather than assert it in a comment.

The guarantee, precisely: under StrictMode the **invoke** runs twice and exactly one **write** is
applied — the first mount's cleanup lowers its flag, so its late-resolving write is dropped and the
second mount's lands. The invoke is deliberately not deduped with a module-level flag: that would also
block the re-read on a genuine remount, which is the point of mounting the binding per screen rather than
once at launch.

### The binding — `HostLabelData`, headless, dormant

A headless leaf (`HostLabelData(): null`) whose effect is
`startHostLabelLoad(window.pyry.hostLabel, (v) => hostLabelStore.getState().setHostLabel(v))`, empty
deps, the returned cancel as cleanup. `window.pyry` is dereferenced only inside the effect, so it
server-renders to `''` without a bridge mock — the `ServerInfoData` discipline. `window.pyry.hostLabel`
is passed as a bare reference: the preload API is an arrow closing over `ipcRenderer`, so there is no
`this` to bind.

**Shipped dormant in #833; mounted by [#834](https://github.com/pyrycode/pyrycode-desktop/issues/834).**
`<HostLabelData />` now mounts in the `ChannelList` container (`ChannelList.tsx`), a sibling of
`<ChannelListView />` — the `serverInfoLoader` mount-point argument this ticket's own note left as
guidance: an app-level one-shot at launch runs before pairing and never re-runs, leaving the row stale
after a same-session pair, so the paired-only tree that renders the row is where a fresh read per open
comes from. See [Channel List § The host row](channel-list.md#the-host-row-channellisttsx-added-by-710-the-operators-label-by-834)
for the consumer and the remount-triggers-reread argument in full.

### Data flow

```
host-label-store.load() (main, at rest) → hostLabelHandler (#824) → HostLabelResult (3 arms)
  → window.pyry.hostLabel()  [invoked once, on HostLabelData mount]
    → loadHostLabel → mapHostLabel → setHostLabel → hostLabelStore   [4th, pre-settle arm added here]

<HostLabelData /> mount (#834, inside the paired-only tree) → useHostLabelStore(selectHostLabel) → sidebar host row
```

## Configuration and usage

- **Import surface:** `import { HostLabelData } from '@renderer/store/hostLabelLoader'` and
  `import { useHostLabelStore, selectHostLabel } from '@renderer/store/hostLabelStore'`.
- **Mount point:** `<HostLabelData />` in the `ChannelList` container
  (`src/renderer/src/screens/channels/ChannelList.tsx`), decided by
  [#834](https://github.com/pyrycode/pyrycode-desktop/issues/834). One read per sidebar mount.
- **Reader:** `HostRowControl` (`ChannelList.tsx`), through `selectHostLabel` and the pure collapse
  `hostRowLabel` — see [Channel List § The host row](channel-list.md#the-host-row-channellisttsx-added-by-710-the-operators-label-by-834).

## Edge cases and limitations

- **The label outlives an unpair — only within one running app session.** [#827](https://github.com/pyrycode/pyrycode-desktop/issues/827)
  now erases the at-rest label alongside the paired-server record (see [Unpair channel § the label
  erase (#827)](unpair-channel.md)), so a relaunch after unpairing sees no stale label. But
  `clearPairingScopedState` does not reset *this* renderer store, so unpairing and re-pairing to a
  different host inside one running session leaves this store holding the previous label until the
  next `hostLabel()` load overwrites it. Resolved in practice by [#834](https://github.com/pyrycode/pyrycode-desktop/issues/834)'s
  mount site: `ChannelList` (and therefore `<HostLabelData />`) remounts on the return leg of every
  path that ends a pairing inside one session (`settings` → `pairServer` → `list`), so the next
  `hostLabel()` load lands before the row is shown again. This store still reports what the channel
  reports, and adds no cross-store consistency check.
- **`error` and over-length both mean "no usable label"**, and the union does not distinguish them — the
  same non-distinction as the channel it consumes. Both call for the same recovery in #834's design.
- **A write that resolves after unmount is dropped**, never applied — the `active`-flag cleanup in
  `startHostLabelLoad`.
- **Never holds a credential.** The value on this path is the operator-typed machine name only; `token`
  and `server_static_pubkey` are structurally absent upstream (#824's union has no field for them). The
  value is never written to `localStorage`, `sessionStorage`, or IndexedDB — it lives only in the zustand
  cell, matching #834's security review ruling that this was also a MUST-NOT for the row that consumes
  it, and confirmed unbroken by the shipped implementation.

## Related

- [Host-label channel](host-label-channel.md) / [#824](https://github.com/pyrycode/pyrycode-desktop/issues/824) —
  the IPC surface this loader invokes; the three-arm union this loader's map extends to four.
- [Host-label store](host-label-store.md) / [#822](https://github.com/pyrycode/pyrycode-desktop/issues/822) —
  the main-process, at-rest counterpart; shares a name-root, not a layer.
- [Server-info store](server-info-store.md) / [#340 codebase notes](../codebase/340.md) — the structural
  template for every layer of this store (DI-factory → singleton → hook → selector, pure map, injected
  load, headless dormant binding), differing only in arm count and the extracted one-shot guard.
- [New-folder store](new-folder-store.md) — the other precedent for nesting a discriminated union under
  one store field rather than intersecting it flat, for the identical stale-key reason.
- [ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md) — the rule this store must not
  undo: an unreadable record is never masked as never-stored.
- [Channel List § The host row](channel-list.md#the-host-row-channellisttsx-added-by-710-the-operators-label-by-834) /
  [#834](https://github.com/pyrycode/pyrycode-desktop/issues/834) — the sidebar host row that mounts
  `HostLabelData` and renders the value, resolving the mount-site question and the staleness edge case
  this doc used to leave open.
