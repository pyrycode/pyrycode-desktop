# Model-list store

The renderer's held copy of **each conversation's published model menu** — a dedicated,
unidirectional Zustand store fed by an independent, reactive-only headless bridge, so the four
surfaces offering models read one live source of truth rather than each subscribing to the daemon
channel themselves.

Introduced in #974, catching #973's dormant `modelList` `DaemonEvent` arm — see [Model-list wire
types](model-list-wire-types.md) for the wire contract this store holds. Shipped dormant at #974;
the first consumer landed at [#975](https://github.com/pyrycode/pyrycode-desktop/issues/975), which
deleted `MODEL_CATALOG` and built the run-configuration sheet's Model rows (and re-anchored the
running-model lookup) straight off this store — see [Conversation shell — workspace and run
configuration § Run configuration Model section, daemon-published rows](conversation-shell-workspace-and-run-config.md#run-configuration-model-section-daemon-published-rows-975).
[#976](https://github.com/pyrycode/pyrycode-desktop/issues/976) followed, deleting the sheet's other
hardcoded vocabulary — `EFFORT_LEVELS` — and building the Effort section's segments off the same held
entry, joined by the same `value`-equality rule (renamed `publishedRowFor`) — see [§ Run configuration
Effort section, daemon-published levels](conversation-shell-workspace-and-run-config.md#run-configuration-effort-section-daemon-published-levels-976).
Two consumers remain queued — the input footer's model and effort menus
([#683](https://github.com/pyrycode/pyrycode-desktop/issues/683)) and the permission-mode menu
([#682](https://github.com/pyrycode/pyrycode-desktop/issues/682)), which reads each row's
`supports_auto_mode` to grey out a mode the running model refuses. The pairing-scoped clear is not in
this slice — see § The pairing-scoped clear below.

## What it does

Holds each conversation's most-recently-published model menu, keyed by `conversationId`, replaced
**wholesale** on every arriving frame — never merged, appended or reconciled against the previous
one, because the frame states which models claude will accept for that conversation right now.
Rows are held **verbatim and by reference**: the array the frame carried, snake_case fields, row
identity and row order preserved, because #972's narrower already rebuilt each row as a fresh
six-field literal and there is nothing left to drop. Because no per-row mapping exists anywhere on
this path, each of the following holds by construction rather than by a guard: a row's own
`truncated_fields: null` ("nothing was cut for this row") is never collapsed into `[]`; no row's
list is hoisted or flattened across rows into a single "something was truncated" flag;
`effort_levels: []` is never normalised away; no string is trimmed or lowercased.

**One frame states three different positions on empty, and a reader who assumes one rule gets two
of them wrong.** `models: []` is a **positive statement** that claude offered nothing — the same
posture `slashCommandList`'s `commands: []` carries — held exactly like a populated list. A row's
`effort_levels: []` is a **collapse** of absent/`null`/empty into one wire value, not a positive
statement — deliberately not the same argument. A row's `truncated_fields` is exempt from
normalisation entirely, so `null` and `[]` are distinct there. Carrying all three faithfully is
what let #976 build the effort segments without re-deriving them, and specifically what lets it
read a `truncated_fields` naming `effort_levels` as *unknown* rather than as *none* — the only
signal separating a cut list from a model that exposes no effort control.

The frame's own `droppedModels` is carried alongside the rows, taken unconditionally (`0` is a
value, never consulted for truthiness), and never recomputed from `models.length` — a menu's true
size is `models.length + droppedModels`, and that sum is left for the consumer to compute. The
producer's ten-entry cap is a daemon-side cap, not a wire constant: nothing here hardcodes it,
treats a list of exactly ten as a signal, or derives truncation from anything but this field. The
committed fixture does not even satisfy the producer's own invariant (five rows beside
`dropped_models: 2`), because it pins shape rather than live traffic — trust the field, not the
length.

**Absent and empty are different states, through the store's own read surface**, not merely by
inspecting the internal map:

| map state for `c1` | `selectModelListFor('c1')` | meaning |
| --- | --- | --- |
| key absent | `null` | no frame has arrived for this conversation |
| `{ models: [], droppedModels: 0 }` | that entry | claude published an empty menu |
| `{ models: [m], droppedModels: 2 }` | that entry | 1 row carried, 3 models in the true menu |

The distinction is load-bearing for every consumer: a sheet that greys out or empties its model
rows because no frame has arrived would be wrong, while doing so because claude published an empty
list would be right — and #682 reads `supports_auto_mode` per row, so it must know whether it has
any rows to reason from at all.

## How it works

### The store (`src/renderer/src/store/modelListStore.ts`)

```ts
export interface ModelListEntry { models: readonly WireModelOption[]; droppedModels: number }
export interface ModelListSnapshot extends ModelListEntry { conversationId: string }
export interface ModelListState { lists: ReadonlyMap<string, ModelListEntry> }
export type ModelListStore = ModelListState & {
  setModelList: (snapshot: ModelListSnapshot) => void
}

createModelListStore(init?)      // DI factory, one isolated instance per test
modelListStore                   // app-wide singleton
useModelListStore(selector)      // narrow-slice React binding
selectModelListFor(conversationId)(state)   // selector factory, `?? null`
```

Mirrors [slash-command-list-store](slash-command-list-store.md)'s DI-factory → singleton → hook →
selector structure and its copy-on-write `ReadonlyMap` — clone the outer map, set the one key,
return a fresh state, so a write for one conversation leaves every other entry object identical
and a component watching a different id sees `Object.is` true and does not re-render. `lists` is
read **inside** the `set` updater rather than through `getState()` outside it, so two frames
arriving back-to-back cannot interleave — zustand runs the updater synchronously against current
state, closing the only check-then-act shape on this path.

The **snapshot extends the entry** rather than restating its two fields, the same shape
`SlashCommandListSnapshot` uses for the same reason: the rows are held verbatim, so the write unit
is exactly the entry plus the routing key. `conversationId` stays off the entry deliberately — the
entry is what the selector hands a consumer that already knows which conversation it asked about.

**One named setter**, `setModelList`, unconditional: an empty `models: []` sets that key to an
entry holding no rows, it does not delete the key, and is never dropped, filtered or coalesced as
"no news". Nothing is validated, coerced, deduped or shape-checked on the way in — a malformed
frame is already rejected upstream by #972's fail-closed narrower inside `daemonConnection`'s
decode guard, so a second, weaker check in the renderer would only invent a disagreement.

`selectModelListFor` returns the **held entry itself**, never a freshly built object or array, so
repeated calls are `Object.is`-stable — `null` is a stable reference by construction, so this store
needs no hoisted `EMPTY_*` constant unlike `queueStore`. There is deliberately no whole-map read
surface: nothing iterates every conversation's list, so shipping one would ship an unread path.

**No clear, no `connected` branch — and neither belongs here.** A reconnect to the same daemon does
not invalidate a published list, and there is no request half to re-fetch one with, so this store
answers no on both halves of `clearPairingScopedState`'s discriminator the same way
`slashCommandListStore` does. The pairing-scoped clear is
[#977](https://github.com/pyrycode/pyrycode-desktop/issues/977)'s, following the #588 → #593 and
\#954 → #955 precedent: it lands in `clearPairingScopedState`'s injected dep set, not at either call
site and not in this store. This slice ships the store shape that clear will attach to
(`clearAllModelLists`, nullary and total, is #977's export to add) and none of the clear itself.

Growth is one entry per distinct `conversationId` seen since launch, each holding one frame's rows,
dropped wholesale at the next pairing change (once #977 lands); each frame is already capped
upstream by `MAX_PLAINTEXT_BYTES` before any parse, so the bound between clears is entries × frame
cap. `slashCommandListStore`, `conversationActivityStore` and `queueStore` ship the identical
posture.

**Exported symbols and `renderToStaticMarkup`.** Seeding a zustand singleton is invisible to a
server render — the server renderer reads `getServerSnapshot()`, which zustand wires to the state
captured at store creation — so #975/#976 will need `vi.mock` on this module with only the
`useModelListStore` binding overridden onto a per-file `createModelListStore()` instance, keeping
`...importActual` for the selectors. That workaround is possible only because the DI factory, the
hook and the selector are three separate exports rather than one bundled hook.

### The data path (`src/renderer/src/store/modelListBridge.ts`)

```ts
translateModelList(event: DaemonEvent): ModelListSnapshot | null
// modelList → { conversationId, models, droppedModels } — a FRESH named-field literal, never
// `return event`, never a spread, so `type` never reaches the store. Unconditional — no
// `if (event.models.length === 0) return null`. default: null — every other arm, including its two
// structural twins, `slashCommandList` and `backgroundTaskRoster`, which carry the identical shape
// (a conversation id, a row list, a frame-level drop count) and are what a careless filter could
// confuse it with.

subscribeModelList(onDaemonEvent, setModelList): () => void
// onDaemonEvent(event => { const s = translateModelList(event); if (s !== null) setModelList(s) })
// `!== null`, never truthiness and never a content check — a snapshot is truthy even with an empty
// `models`, and a length check at this guard is exactly how an empty list would get dropped, taking
// its drop count with it.
```

**A fifth independent observer, not a new arm on an existing bridge** — the posture #973's arm
docblock already committed to. All four exhaustive bridges (`daemonEventBridge`, `timelineBridge`,
`modalBridge`, `questionBridge`) keep their `modelList` no-op cases **permanently**, present only
so their `assertNever` guard makes a *new* arm a compile error — removing one would leak
claude-authored row text into an error message, since those guards `JSON.stringify` the whole
event. This is the [announced-model-store](announced-model-store.md) /
[slash-command-list-store](slash-command-list-store.md) shape.

**One arm in, one setter out — deliberately no `connected` branch and no branch of any other
kind.** A reconnect to the same daemon does not invalidate a published list, so clearing on
`connected` would blank a correct value that nothing on this path can re-fetch. Keeping the clear
out of this file is also what keeps it daemon-unreachable: no event arriving on this subscription
can invoke it, so nothing the daemon says can steer which lists survive a pairing change.

`ModelListData(): null` is the thin React glue — a headless component (not a hook), so the
subscription sits in its own leaf and never cascades a re-render into `App`. `window.pyry` is
dereferenced only inside the mount effect, never during render, so it server-renders to `''`
without a bridge mock. Reactive-only: one subscribe effect with `[]` deps, no request effect, no
`useState`/`useRef`, no connected gate. The returned off handle from `onDaemonEvent` is the effect
cleanup, so a StrictMode double-mount nets exactly one live listener.

**`default: null` here is a security control, not a style choice.** Every `assertNever` guard in
this repo stringifies the whole event into an `Error`; using one on a path carrying
claude-authored `display_name` / `value` / `effort_levels` text would put that text into an error
message. The same reason the four exhaustive bridges keep their permanent no-op cases: removing
one is a leak, not a tidy-up.

### `src/renderer/src/App.tsx`

`<ModelListData />` is the **eleventh** headless leaf, mounted directly after
`<SlashCommandListData />`. App-level is load-bearing, not conventional: the daemon publishes the
list from a conversation's `initialize` reply — the same reply `slash_command_list` rides — so a
frame can arrive for a conversation the operator has never opened and long before any of the four
consumers is mounted. A screen-scoped listener would miss exactly the case the store exists for.

### Data flow

```
daemon → model_list frame → #972 parseModelListPayload (fail-closed) →
  #973 modelList DaemonEvent (fresh literal, IPC carry)
  → window.pyry.onDaemonEvent ─┬─ daemonEventBridge / timelineBridge / modalBridge / questionBridge  (no-op, permanent)
                                └─ ModelListData (NEW, #974)
                                     → translateModelList → setModelList
                                     → modelListStore   [that conversation's menu replaced wholesale]

selectModelListFor(openId) / useModelListStore
  → #975 model rows (shipped) / #976 effort segments (shipped) / #683 footer menus / #682 permission-mode menu
```

## Configuration and usage

- Mounted app-level in `src/renderer/src/App.tsx`, after `<SlashCommandListData />`.
- `useModelListStore`/`selectModelListFor` are read since #975/#976, by `RunConfigSections`
  (`src/renderer/src/screens/conversation/RunConfigSections.tsx`), which takes the active
  conversation id as a prop rather than reading `sessionIdStore` — a session id keys nothing in
  this store's map. #683 and #682 remain queued readers.

## Edge cases and limitations

- **Delivery is best-effort, and a conversation with no list is a normal, permanent state.** The
  daemon pushes the list unsolicited from a conversation's `initialize` reply on two lanes — see
  [Model-list wire types § Delivery window](model-list-wire-types.md#delivery-window-two-lanes) —
  and there is no request half on this path and there must never be one: a client-side retry
  against a relay that withholds the frame would be a self-inflicted spin. The answer to "no frame
  arrived" is `null` and nothing else: no retry, no poll, no spinner. No consumer may block a model
  menu on this frame.
- **Every string field, plus every entry in `effort_levels`, is claude-authored** — a *higher*
  trust tier than `slashCommandListStore`'s workspace-authored strings, reachable by prompt
  injection in a way workspace text is not. Held verbatim: never normalised, lowercased, trimmed or
  shape-checked. `value` in particular **is not parseable** (measured entries: `default`,
  `opus[1m]`, `claude-fable-5[1m]`, `sonnet`, `haiku`) — nothing may split it to derive a family or
  present it as a version. **Copying a neighbouring frame's security prose copies its evidence, and
  the evidence does not transfer here**: `slashCommandList`'s never-into-a-log clause argues from a
  measured `0x0a` across 51 workspace-authored entries; this frame's short claude-authored labels
  have no measured control byte, so the clause rests on the *contract* instead — the daemon bounds
  and does not sanitize, so a control byte is *permitted* rather than excluded, not excluded by
  measurement.
- **Nothing is ever logged on this path.** There is deliberately no "dropped an unrelated event" or
  "no list for this conversation" diagnostic anywhere here — see `default: null` above.
- **If any later slice indexes rows by a string, the index must be a `Map`.** The rows stay an
  array rather than an index built from row text on this path, so the `__proto__` hazard
  (`index[row.display_name] = row` writing through to `Object.prototype`) has no site to occur in
  here; a `display_name`-keyed lookup added downstream inherits the obligation. #975 discharged this
  for the Model section's own rows by keying its React `key` on the array index instead — no index
  built from row text at all — and its running-model lookup joins on `value` via `Array.find`, not
  an index.
- **Nothing here is persisted, and nothing may be.** `createModelListStore` takes no storage port,
  unlike `createConversationLastReadStore`. Web storage would outlive the pairing that scoped the
  list, so a persisted copy would survive #977's future clear with every in-memory assertion still
  green.
- **No DOM sink in this slice.** The inert-escaped-length-bounded render discipline is inherited
  here; #975 discharged it for the Model rows and the running-model lookup, #976 discharged it for
  the effort segments. #683 and #682 still owe it.
- **The store's held list renders since #975/#976** (`ModelSection`, `RunningModelSection` and
  `EffortSection` in `RunConfigSections.tsx`). #683 and #682 remain unbuilt.

## Related

- [Model-list wire types](model-list-wire-types.md) — the wire contract this store holds verbatim:
  `WireModelOption`'s trust tier, the three-positions-on-empty rule, and the `droppedModels` sum.
- [Daemon event channel — the sealed union](daemon-event-channel-sealed-union.md) — #973's
  `modelList` `DaemonEvent` arm and the four permanent bridge no-ops this store's bridge sits
  alongside as a fifth observer.
- [Slash-command-list store](slash-command-list-store.md) — the exact local precedent this store
  and bridge mirror structurally: same DI-factory → singleton → hook → selector shape, same
  copy-on-write `ReadonlyMap`, same `?? null` selector, same fifth-observer bridge posture, same
  App-level mount rationale. The differences are the row shape and the trust tier of its strings.
- [Announced-model store](announced-model-store.md) — the closer precedent for the bridge half: one
  owned arm, one injected setter, no reset branch, no request half, App-level headless leaf.
- [Background-task roster store](background-task-roster-store.md) — the structural precedent for
  the keyed store shape (`ReadonlyMap`, copy-on-write, `?? null` selector).
- [Conversation shell — workspace and run configuration § Run configuration Model section,
  daemon-published rows](conversation-shell-workspace-and-run-config.md#run-configuration-model-section-daemon-published-rows-975)
  / [Run configuration store § Running model section](run-config-store.md#running-model-section-560-resolved-onto-the-published-rows-by-975)
  — the first consumer, #975: deleted `MODEL_CATALOG`, built the Model rows off this store's held
  entry, and re-anchored the running-model lookup onto a row's `value`. [§ Run configuration Effort
  section, daemon-published levels](conversation-shell-workspace-and-run-config.md#run-configuration-effort-section-daemon-published-levels-976)
  — the second consumer, #976: deleted `EFFORT_LEVELS` and built the Effort segments off the same
  held entry, joined by the same `value`-equality rule.
- `docs/specs/architecture/974-model-list-store.md` — the full architecture spec, including the
  self-review (verdict: PASS) with two SHOULD FIX findings mitigated by construction (no per-row
  mapping exists) and by design decision (never logged).
