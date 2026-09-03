# Slash-command-list store

The renderer's held copy of **each conversation's published slash-command menu** — a dedicated,
unidirectional Zustand store fed by an independent, reactive-only headless bridge, so any surface
offering commands reads one live source of truth rather than asking for the list itself.

Introduced in #954, catching #937's dormant `slashCommandList` `DaemonEvent`
arm — see [Slash-command-list wire types](slash-command-list-wire-types.md) for the wire contract
this store holds. Shipped dormant, then read for the first time by
[#940](https://github.com/pyrycode/pyrycode-desktop/issues/940), the slash-command type-ahead's
mount over the message box — see [Conversation shell — composer options
panel](conversation-shell-composer-options-slash-type-ahead.md#slash-command-type-ahead--mount-940). It composes
this store's `selectSlashCommandListFor` with
[#939](https://github.com/pyrycode/pyrycode-desktop/issues/939)'s pure
`slashCommandTypeAheadRows`, joined as `entry?.commands ?? null` so the store's `null`-vs-`[]`
distinction survives into the decision layer.
[#681](https://github.com/pyrycode/pyrycode-desktop/issues/681) is this store's second reader — the
Actions-menu grey-out, gating rather than rendering: it greys out a fixed entry the published list
doesn't carry instead of drawing the list itself. See [Conversation shell — actions menu §
grey-out](conversation-shell-actions-menu-and-reader-cutover.md#grey-out-for-an-absent-command-681).
[#955](https://github.com/pyrycode/pyrycode-desktop/issues/955) landed the store's
pairing-scoped clear — see § The pairing-scoped clear below.

## What it does

Holds each conversation's most-recently-published menu, keyed by `conversationId`, replaced
**wholesale** on every arriving frame — never merged, appended, or reconciled against the previous
one, because the frame states what this session in its working directory will accept right now.
Rows are held **verbatim and by reference**: the array the frame carried, snake_case fields, row
identity and row order preserved, because #936's narrower already stripped each row to its five
known fields and there is nothing left to drop. Because no per-row mapping exists anywhere on this
path, each of the following holds by construction rather than by a guard: a row's own
`truncated_fields: null` ("nothing was cut for this row") is never collapsed into `[]`; no row's
list is hoisted or flattened across rows into a single "something was truncated" flag; `aliases: []`
is never normalised; an empty `argument_hint` is never trimmed away.

`commands: []` is a **positive statement** that claude offered nothing, held exactly like a
populated list — the contrast is `questionShown`, whose empty array is out of contract and means a
producer bug; the two read alike and say opposite things. The frame's own `droppedCommands` is
carried alongside the list, taken unconditionally (`0` is a value, never consulted for truthiness),
and never recomputed from `commands.length` — a menu's true size is `commands.length +
droppedCommands`, and that sum is left for the consumer to compute.

**Absent and empty are different states, through the store's own read surface**, not merely by
inspecting the internal map:

| map state for `c1` | `selectSlashCommandListFor('c1')` | meaning |
| --- | --- | --- |
| key absent | `null` | no frame has arrived for this conversation |
| `{ commands: [], droppedCommands: 0 }` | that entry | claude published an empty menu |
| `{ commands: [c], droppedCommands: 2 }` | that entry | 1 row carried, 3 verbs in the true menu |

`#681` needs exactly this distinction: greying out every fixed entry because no list has arrived
yet would be wrong, while greying them out because claude published an empty list would be right.

## How it works

### The store (`src/renderer/src/store/slashCommandListStore.ts`)

```ts
export interface SlashCommandListEntry { commands: readonly WireSlashCommand[]; droppedCommands: number }
export interface SlashCommandListSnapshot extends SlashCommandListEntry { conversationId: string }
export interface SlashCommandListState { menus: ReadonlyMap<string, SlashCommandListEntry> }
export type SlashCommandListStore = SlashCommandListState & {
  setSlashCommandList: (snapshot: SlashCommandListSnapshot) => void
}

createSlashCommandListStore(init?)      // DI factory, one isolated instance per test
slashCommandListStore                   // app-wide singleton
useSlashCommandListStore(selector)      // narrow-slice React binding
selectSlashCommandListFor(conversationId)(state)   // selector factory, `?? null`
```

Mirrors [background-task-roster-store](background-task-roster-store.md)'s DI-factory → singleton →
hook → selector structure and its copy-on-write `ReadonlyMap` — clone the outer map, set the one
key, return a fresh state, so a write for one conversation leaves every other entry object
identical and a component watching a different id sees `Object.is` true and does not re-render.

The **snapshot extends the entry** rather than restating its two fields, unlike
`BackgroundTaskRosterSnapshot`, which could not: there the write unit carries wire rows while the
entry carries a *held* map, so the two genuinely differ. Here the rows are held verbatim, so the
write unit is exactly the entry plus the routing key, and `extends` is what makes a field added
later land on both by construction. `conversationId` stays off the entry deliberately — the entry
is what the selector hands a consumer that already knows which conversation it asked about, so
carrying the key in the value would be a second copy to keep in agreement with the map key.

**One named setter**, `setSlashCommandList`, unconditional: an empty `commands: []` sets that key to
an entry holding no commands, it does not delete the key, and is never dropped, filtered or
coalesced as "no news". Nothing is validated, coerced, deduped or shape-checked on the way in — a
malformed frame is already rejected upstream by #936's fail-closed narrower inside
`daemonConnection`'s decode guard, so a second, weaker check in the renderer would only invent a
disagreement. A verbatim repeat is written like any other frame: the transport holds no state, so a
consumer sees exactly one event per daemon frame and a repeat is the signal that the menu is still
current.

`selectSlashCommandListFor` returns the **held entry itself**, never a freshly built object or
array, so repeated calls are `Object.is`-stable — `null` is a stable reference by construction, so
unlike `queueStore` this store needs no hoisted `EMPTY_*` constant. There is deliberately no
whole-map read surface: nothing iterates every conversation's menu, so shipping one would ship an
unread path.

**The pairing-scoped clear (#955), and why it is not a `connected` reset.** Copying
`backgroundTaskRosterStore`'s `connected` reset would be wrong on two counts: that branch is the sole
enforcement of *its* AC5, and a reconnect to the same daemon in the same working directory does not
invalidate a published menu — there is no request half to re-fetch it with anyway. The store answers
**no** on both halves of `clearPairingScopedState`'s discriminator ("does a reconnect to the SAME
daemon need to clear it?"), so the whole lifetime lives at the *other* edge: `clearAllSlashCommandLists`,
a nullary, whole-map method on `SlashCommandListStore`, reached only through
`clearPairingScopedState`'s injected dep set (never from a call site or a bridge arm — see
[Paired shell](paired-shell.md)), following the #588 → #593 precedent (ship the holder dormant, add
the clear to the shared helper's dep set). It returns `initialSlashCommandListState` **by reference**
(the `clearAllLastRead` shape, not `clearAllTimelines`'s fresh `Map`), guarded on `menus.size === 0` so
a redundant clear wakes no subscriber at all — the `clearAllTimelines` guard, not `clearAllLastRead`'s:
nothing here reaches disk, so there is no side effect to suppress, only the stronger idempotence that
returning the state object buys. Because `setSlashCommandList` is copy-on-write, the by-reference
return is safe rather than a poisoning hazard, and that property is pinned by a dedicated invariant
test rather than a defensive fresh `Map`.

Growth is one entry per distinct `conversationId` seen since launch, each holding one frame's rows,
dropped wholesale at every pairing change; each frame is already capped upstream by
`MAX_PLAINTEXT_BYTES` before any parse, so the bound between clears is entries × frame cap.
`conversationActivityStore` (#748) and `queueStore` ship the identical posture.

### The data path (`src/renderer/src/store/slashCommandListBridge.ts`)

```ts
translateSlashCommandList(event: DaemonEvent): SlashCommandListSnapshot | null
// slashCommandList → { conversationId, commands, droppedCommands } — a FRESH named-field literal,
// never `return event`, never a spread, so `type` never reaches the store. Unconditional: no
// `if (event.commands.length === 0) return null`. default: null — every other arm, including its
// structural twin `backgroundTaskRoster`, which carries the identical shape (a conversation id, a
// row list, a frame-level drop count) and is the one arm a careless filter could confuse it with.

subscribeSlashCommandList(onDaemonEvent, setSlashCommandList): () => void
// onDaemonEvent(event => { const s = translateSlashCommandList(event); if (s !== null) setSlashCommandList(s) })
// `!== null`, never truthiness and never a content check — a snapshot is truthy even with an empty
// `commands`, and a length check at this guard is exactly how an empty menu would get dropped.
```

**A fifth independent observer, not a new arm on an existing bridge** — the call #937 explicitly
left open. All four exhaustive bridges (`daemonEventBridge`, `timelineBridge`, `modalBridge`,
`questionBridge`) keep their `slashCommandList` no-op cases **permanently**, present only so their
`assertNever` guard makes a *new* arm a compile error — removing one would leak workspace-authored
text into an error message, since those guards `JSON.stringify` the whole event. This is the
[announced-model-store](announced-model-store.md) / `backgroundTaskRosterBridge` shape.

**One arm in, one setter out — deliberately no `connected` branch and no branch of any other kind**,
which is the one thing `backgroundTaskRosterBridge` is the wrong precedent for. That bridge's reset
is the sole enforcement of its own AC5; this store's lifetime is the opposite case, and #955 put its
clear in `clearPairingScopedState`'s dep set instead — none of it reaches this file. Keeping the clear
out of the bridge is what keeps it daemon-unreachable: no event arriving on this subscription can
invoke it, and it takes no conversation id, so nothing the daemon says can steer which menus survive
a pairing change.

`SlashCommandListData(): null` is the thin React glue — a headless component (not a hook), so the
subscription sits in its own leaf and never cascades a re-render into `App`. `window.pyry` is
dereferenced only inside the mount effect, never during render, so it server-renders to `''` without
a bridge mock. Reactive-only: one subscribe effect with `[]` deps, no request effect, no
`useState`/`useRef`, no connected gate. The returned off handle from `onDaemonEvent` is the effect
cleanup, so a StrictMode double-mount nets exactly one live listener.

### `src/renderer/src/App.tsx`

`<SlashCommandListData />` is the **tenth** headless leaf (count the JSX, not the comments —
`RelayLinkData` landed without one). App-level is load-bearing, not conventional: the daemon
publishes the menu from a conversation's `initialize` reply, so a frame can arrive for a
conversation the user has never opened and long before its panel is ever mounted — a
screen-scoped listener would miss exactly the case the store exists for.

### Data flow

```
daemon → slash_command_list frame → #936 parseSlashCommandListPayload (fail-closed) →
  #937 slashCommandList DaemonEvent (fresh literal, IPC carry)
  → window.pyry.onDaemonEvent ─┬─ daemonEventBridge / timelineBridge / modalBridge / questionBridge  (no-op, permanent)
                                └─ SlashCommandListData (NEW, #954)
                                     → translateSlashCommandList → setSlashCommandList
                                     → slashCommandListStore   [that conversation's menu replaced wholesale]

selectSlashCommandListFor(openId) / useSlashCommandListStore
  → entry?.commands ?? null → #939 slashCommandTypeAheadRows → #940 ComposerSlashCommandTypeAhead
```

## Configuration and usage

- `useSlashCommandListStore`/`selectSlashCommandListFor` is read by #940's
  `useSlashCommandTypeAhead` (`ComposerSlashCommandTypeAhead.tsx`) and by #681's
  `ComposerActionsMenu` container, both a `useMemo`-stable selector keyed per conversation id.
- Mounted app-level in `src/renderer/src/App.tsx`, after `<RunConfigLiveData />`.
- `commands` is a **display** array — its shape is not an invitation to iterate it as a work list
  something acts on. Nothing in this store or its bridge iterates it.

## Edge cases and limitations

- **Delivery is best-effort, and a conversation with no menu is a normal, permanent state.** The
  daemon's published delivery window names three loss points: the bootstrap child's menu is dropped
  unconditionally, a busy session can refuse the frame at the fan-in, and a session rotation
  delivers no fresh menu. The connect-time snapshot recovers the ordinary attach case, but there is
  no request half on this path and there must never be one — the daemon pushes the list unsolicited,
  and a client-side retry against a relay that withholds the frame would be a self-inflicted spin.
  The answer to "no frame arrived" is `null` and nothing else: no retry, no poll, no spinner.
- **Every string field, including each alias, is workspace-authored** — a *lower* trust tier than
  the claude-authored text `announcedModelStore` and `questionBatchStore` hold. The daemon bounds
  them without sanitizing them. Held verbatim: never normalised, lowercased, trimmed, allow-listed
  or shape-checked. `name` is **not an identifier** (one measured name is `__remote-workflow`), so
  nothing on this path may key a cache, a memo or a lookup path by it — #940's render keys are the
  row's array index instead, never `name`.
- **Nothing is ever logged on this path.** `0x0a` is the only sub-`0x20` byte across the capture's
  51 entries' four string fields, so the control character that actually occurs is the one that
  splits a log line, and a logged `description` would be a workspace author forging log records.
  There is deliberately no "dropped an unrelated event" or "no menu for this conversation"
  diagnostic anywhere on this path. This is also why the translator uses `default: null` rather than
  `assertNever` — an `assertNever` guard stringifies the whole event into an `Error`.
- **Nothing here is persisted, and nothing may be.** No `localStorage`, `sessionStorage` or
  IndexedDB — a "remember the menu across launches" optimisation would put workspace-authored text
  into renderer web storage that survives an unpair, outliving the pairing that scoped it, and would
  defeat the #955 clear: a persisted copy would survive a clear that ran, so every in-memory
  assertion would stay green while the previous workspace's verbs were re-hydrated at the next
  launch. `createSlashCommandListStore` takes no storage port, unlike
  `createConversationLastReadStore`, so the clear is memory-only because there is nothing else to
  reach.
- **No DOM sink in this slice.** The plain-text-never-HTML discipline (`innerHTML` /
  `dangerouslySetInnerHTML` forbidden, never an attribute, a URL, a filename, a cache key or a
  lookup path) is inherited here and discharged by #940's render slice — which, per #934's product
  decision, renders `name` and `argument_hint` only; `description` reaches no DOM sink at all.
- **The list is rendered, by #940 alone.** #681 reads the same entries to decide, per render, whether
  each of the Actions menu's three fixed commands is present — it never renders a row from `commands`,
  so the list's *rendered* surface is still #940's alone.

## Related

- [Slash-command-list wire types](slash-command-list-wire-types.md) — the wire contract this store
  holds verbatim: `WireSlashCommand`'s trust tier, the `aliases`-collapse trap, and the
  `droppedCommands` sum.
- [Slash command type-ahead](conversation-shell-composer-options-slash-type-ahead.md#slash-command-type-ahead--decision-layer-939)
  — [#939](https://github.com/pyrycode/pyrycode-desktop/issues/939)'s pure `slashCommandTypeAheadRows`/
  `completeSlashCommand`, and [#940's mount](conversation-shell-composer-options-slash-type-ahead.md#slash-command-type-ahead--mount-940)
  that feeds them from this store's `selectSlashCommandListFor`.
- [Conversation shell — actions menu § grey-out](conversation-shell-actions-menu-and-reader-cutover.md#grey-out-for-an-absent-command-681)
  — [#681](https://github.com/pyrycode/pyrycode-desktop/issues/681)'s `composerActionAvailability.ts`,
  this store's second reader, which inverts the type-ahead's cut-`name` asymmetry on purpose.
- [Daemon event channel — the sealed union](daemon-event-channel-sealed-union.md) — #937's
  `slashCommandList` `DaemonEvent` arm and the four permanent bridge no-ops this store's bridge sits
  alongside as a fifth observer.
- [Background-task roster store](background-task-roster-store.md) — the structural precedent for the
  keyed store shape (`ReadonlyMap`, copy-on-write, `?? null` selector) and the one thing deliberately
  **not** copied from it: its `connected` reset branch.
- [Announced-model store](announced-model-store.md) — the closer precedent for the bridge half: one
  owned arm, one injected setter, no reset branch, no request half, App-level headless leaf.
- [Conversation activity store](conversation-activity-store.md) — ships the same dormant-then-cleared
  posture, but answers `clearPairingScopedState`'s discriminator the *other* way and is cleared at the
  `connected` edge instead.
- [Paired shell](paired-shell.md) — `clearAllSlashCommandLists`'s one production wiring, as the sixth
  member of `clearPairingDeps`, and `clearPairingScopedState`'s ordering constraint (must run before
  `clearAllLastRead`) this clear has to respect.
