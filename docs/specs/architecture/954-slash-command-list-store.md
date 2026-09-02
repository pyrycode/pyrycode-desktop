# #954 — hold the workspace's slash-command list per conversation

Store + bridge + App-level mount for the `slashCommandList` daemon-event arm #937 landed dormant.
Three production files. Nothing renders the list when this lands; #940 (type-ahead) and #681
(Actions-menu grey-out) are its first readers.

## Files read

- `src/shared/ipc/events.ts` → the `slashCommandList` arm — the contract this slice consumes, and the
  SSOT for every rule below: snapshot-not-delta, `commands: []` is a positive statement, per-row
  `truncated_fields` never hoisted, `droppedCommands` never recomputed, the workspace-authored trust
  tier and its never-log clause.
- `src/shared/wire/types.ts` → `WireSlashCommand` — the row type held verbatim; its docblock carries
  the cut-`aliases`-is-unknowable rule and the `name`-is-not-an-identifier rule.
- `src/renderer/src/store/backgroundTaskRosterStore.ts` → `BackgroundTaskRosterEntry`,
  `BackgroundTaskRosterSnapshot`, `createBackgroundTaskRosterStore`, `selectRosterFor` — the keyed
  store shape this one follows: copy-on-write `ReadonlyMap`, entry-vs-absent distinction, `?? null`
  in the selector rather than an `EMPTY_*` constant.
- `src/renderer/src/store/backgroundTaskRosterBridge.ts` → `translateBackgroundTaskRoster`,
  `subscribeBackgroundTaskRoster`, `BackgroundTaskRosterData` — the structural relative for the
  translator (fresh named-field literal, `default: null`, unconditional on an empty list). Its
  `connected` branch is the part this slice must **not** copy.
- `src/renderer/src/store/announcedModelBridge.ts` → `translateModelAnnounced`,
  `subscribeAnnouncedModel`, `AnnouncedModelData` — the closer read for the bridge half: one owned
  arm, one injected setter, no reset branch, no request half.
- `src/renderer/src/store/announcedModelBridge.test.ts` → its `fakeBridge` helper and the
  server-render sanity block — the test shape this slice's bridge test follows.
- `src/renderer/src/App.tsx` → the numbered headless-leaf comment block and the JSX fragment — nine
  leaves mount today, so this one is the tenth.
- `src/renderer/src/App.test.tsx` → it renders `<App/>` with no `window.pyry` stub and asserts a
  neutral paint; a leaf that dereferenced `window.pyry` during render would redden it.
- `docs/knowledge/features/slash-command-list-wire-types.md` § "Bounds — deliberately not modelled"
  and § "Configuration and usage" — the lesson that no client may model an entry cap, cache a count,
  or treat a small list as an error, and that the frame is already capped by `MAX_PLAINTEXT_BYTES`.
- `docs/knowledge/features/announced-model-store.md`, `.../background-task-roster-store.md` — the two
  package overviews whose stores this one is shaped from.

## Design source

**Figma:** N/A — store and bridge only, no rendered surface. The visual-fidelity check is
intentionally skipped; #940 owns the first render of this data.

## Context

#937 landed the renderer-facing `slashCommandList` arm and nothing holds it: all four exhaustive
bridges no-op it, so the event arrives and is dropped. This slice is the renderer data path that
catches it, so that any surface offering commands reads one live source of truth instead of asking
for the list itself — there is no request half on this path and there must never be one.

Two consumers ride the store: #940's type-ahead render slice and #681's Actions-menu grey-out. Both
need the absent-versus-empty distinction to be readable, which is why it is a store-shape decision
here rather than a convention each consumer re-invents.

No ADR is warranted. The store follows `backgroundTaskRosterStore`'s already-recorded keyed-store
shape and `announcedModelStore`'s already-recorded independent-subscriber posture; nothing here is a
new architectural position. The documentation phase should fold this slice into a new package
overview, `slash-command-list-store.md`, alongside its two structural relatives.

### Size

Over the 800-line guidance, deliberately, and not split. The floor rule decides it: the only
available seam is store-versus-bridge, and a store with no writer has nothing observable to verify —
it would ship a child whose sole consumer is its own sibling. The refiner recorded the same reading
and measured the nearest analogue exactly (#573: 1132 lines across the same three production files).
Independently, the split-depth gate closes the question — `gh api graphql` confirms parent 938,
grandparent 694, so this ticket is a grandchild and does not get split again.

A **second** boundary line trips that the ticket body did not measure: exported types, interfaces,
React components and stores comes to **6** against a limit of 5 — four types
(`SlashCommandListEntry`, `SlashCommandListSnapshot`, `SlashCommandListState`,
`SlashCommandListStore`), one component (`SlashCommandListData`), one store singleton
(`slashCommandListStore`). None is droppable: the entry must not carry `conversationId` (see Open
Questions), the state-only interface is what keeps the selector blind to the mutations, and the
component and the singleton are two of the three production files. #573 shipped 7 by the same count
and landed clean. Recorded on the ticket under `needs-human:sizing` with the split that would
otherwise have been proposed; the depth gate is why it was not. The remaining lines are inside their
limits: 3 production files, 0 consumer call sites needing simultaneous update (the arm ships
dormant), 4 acceptance criteria, 0 reject branches.

## Design

Three production files, mirroring the `announcedModelStore` / `announcedModelBridge` /
`App.tsx` triple with `backgroundTaskRosterStore`'s keyed map in place of the single slot.

### `src/renderer/src/store/slashCommandListStore.ts`

Pure renderer state — no IPC, no preload bridge, no transport. Four exported types plus the
DI-factory → singleton → hook → selector structure both precedents use.

```ts
interface SlashCommandListEntry { commands: readonly WireSlashCommand[]; droppedCommands: number }
interface SlashCommandListSnapshot extends SlashCommandListEntry { conversationId: string }
interface SlashCommandListState { menus: ReadonlyMap<string, SlashCommandListEntry> }
type SlashCommandListStore = SlashCommandListState & {
  setSlashCommandList: (snapshot: SlashCommandListSnapshot) => void
}
createSlashCommandListStore(init?: SlashCommandListState)   // DI factory, one instance per test
slashCommandListStore                                        // app-wide singleton
useSlashCommandListStore<T>(selector: (s: SlashCommandListStore) => T): T
selectSlashCommandListFor(conversationId: string): (s: SlashCommandListState) => SlashCommandListEntry | null
```

The snapshot **extends** the entry rather than restating its two fields, unlike
`BackgroundTaskRosterSnapshot`, which could not: there, the write unit carries wire rows while the
entry carries a held map, so the two genuinely differ. Here the rows are held verbatim, so entry and
write unit are the same pair of fields plus the routing key, and `extends` is what makes a future
field land on both by construction.

**Keyed by `conversationId`, replaced wholesale.** One setter, `setSlashCommandList`. It is
unconditional: `commands: []` writes an entry holding no commands, it does not delete the key and is
never dropped or coalesced as "no news". Copy-on-write — clone the outer map, set the one key,
return `{ menus: next }` — so a write for one conversation leaves every other entry object identical
and a component watching a different id sees `Object.is` true and does not re-render. Nothing merges,
nothing appends, nothing reconciles against the previous list: the frame is a snapshot of what this
session in this working directory will accept.

**Absent and empty are different states, through the read surface.**
`selectSlashCommandListFor` is a selector factory bound to one id returning `?? null` — never
`?? EMPTY_MENU`. Three readings:

| map state | selector returns | meaning |
|---|---|---|
| key absent | `null` | no frame has arrived for this conversation |
| `{ commands: [], droppedCommands: 0 }` | that entry | claude published an empty menu |
| `{ commands: [c], droppedCommands: 2 }` | that entry | 1 row carried, 3 verbs in the true menu |

`null` is a stable reference by construction, so this slice needs no module-scope `EMPTY_*` constant
the way `queueStore` does, and the nullable return type forces #681 to branch — greying out every
entry because no list has arrived is exactly the wrong answer the distinction exists to prevent. The
selector returns the **held entry itself**, never a freshly built object or array, so repeated calls
are `Object.is`-stable.

**Rows held verbatim, by reference.** `commands` is the array the arm carried, passed through
untouched — snake_case fields, row identity and row order preserved. That is the settled house rule
for a nested array (four precedents: `queueState`, `conversationsReceived`, `backgroundTaskRoster`,
`questionShown`), and #936's narrower already stripped each row to its five known fields, so there is
nothing to drop and no mapping to write. Because **no per-row mapping exists**, `truncated_fields:
null` cannot be collapsed into `[]`, no list can be hoisted or flattened across rows, `aliases: []`
cannot be normalised, and `argument_hint: ''` cannot be trimmed away — each by construction rather
than by a guard. #573's overview records that a "holds by construction" claim stops being true the
moment a mapping appears; the defence against that regression here is a test asserting the held row
is the **same object** the event carried, which reddens if anyone introduces one.

**`droppedCommands` held alongside the list**, taken from the snapshot unconditionally. `0` is a
value, never consulted for truthiness; nothing recomputes it from `commands.length` or reconciles the
two. The menu's true size is `commands.length + droppedCommands`, and that sum belongs to the
consumer — the store carries both numbers so the consumer *can* compute it, and computes nothing
itself.

**No clear, no reset, no eviction.** `resetMenus` / `clearSlashCommandLists` is #955's slice and is
deliberately absent here; the store is likewise not added to `clearPairingScopedState`. Copying
`backgroundTaskRosterStore`'s `connected` reset would be wrong on both counts (that branch is the
sole enforcement of *its* AC5, and this store's lifetime question is a different one), and building
the clear here is what would push this slice past three production files.

### `src/renderer/src/store/slashCommandListBridge.ts`

An **independent fourth-family subscriber** in the `announcedModelBridge` / `backgroundTaskRosterBridge`
posture, not a new write on an existing bridge. #937's four no-op cases in `daemonEventBridge`,
`timelineBridge`, `modalBridge` and `questionBridge` stay exactly as they are — each exists only so
the `assertNever` guard makes a *new* arm a compile error, and those guards stringify the whole event
into an `Error`, so removing one would leak workspace-authored text into an error message.

```ts
translateSlashCommandList(event: DaemonEvent): SlashCommandListSnapshot | null
subscribeSlashCommandList(
  onDaemonEvent: (l: (e: DaemonEvent) => void) => () => void,
  setSlashCommandList: (snapshot: SlashCommandListSnapshot) => void
): () => void
SlashCommandListData(): null
```

- **The translator** maps the one owned arm to a fresh named-field literal
  `{ conversationId, commands, droppedCommands }` — never `return event`, never a spread, so the
  `type` tag never reaches the store and the store shape stays immune to the arm gaining an unrelated
  field later. `default: null`, not `assertNever`: ignoring the rest is this path's intended permanent
  behaviour, and a `default: null` also cannot stringify an event into an error. **Unconditional** —
  there is deliberately no `if (event.commands.length === 0) return null`, because an empty menu is a
  positive statement.
- **The subscriber** guards on `snapshot !== null`, never `if (snapshot)` and emphatically never on
  the list's contents: a snapshot object is truthy even when its `commands` are empty, so the way an
  empty menu would get dropped is a `length` check at the translator, which is why the translator
  stays unconditional. **No `connected` branch and no other branch of any kind** — one arm in, one
  setter out. It returns the off handle from `onDaemonEvent` so the React binding can use it as its
  effect cleanup.
- **`SlashCommandListData`** is the thin React glue: a headless component (not a hook) so the
  subscription sits in its own leaf and never cascades a re-render into `App`. `window.pyry` is
  dereferenced only inside the effect, never during render, so it server-renders to `''` without a
  bridge mock. Reactive-only: one subscribe effect, no request effect, no `useState`/`useRef`, no
  connected gate.

Both helpers are React-free and injected, so the whole path is unit-testable with plain spies.

### `src/renderer/src/App.tsx`

`<SlashCommandListData />` joins the fragment as the **tenth** headless leaf (count the JSX, not the
comments — `RelayLinkData` landed without one), with its entry appended to the numbered comment
block. Rationale recorded there: a menu can arrive for a conversation the user has never opened, and
before #940 or #681 is ever mounted, so a screen-scoped listener would miss exactly the case the
store exists for. Reactive-only, no gate, ships dormant. Unlike `BackgroundTaskRosterData` it has no
`connected` branch, and unlike `AnnouncedModelData` its clear is not yet in
`clearPairingScopedState` — both belong to #955.

The mount rides AC3 rather than convention because every other criterion is provable against an
injected subscribe function: without it this slice goes fully green while nothing ever writes the
store.

## State + concurrency model

One store slice, `menus`, written by one setter from one subscription. The listener is
app-lifetime: subscribed in `SlashCommandListData`'s mount effect with `[]` deps, torn down by the
returned off handle, so a StrictMode double-mount nets exactly one live listener. No async task, no
timer, no `AbortController` — nothing on this path awaits anything.

No check-then-act gap: the setter is a single synchronous `set((s) => …)` with no `await` inside, and
every event is dispatched synchronously in arrival order on the one listener, so no concurrent
handler can interleave between reading and writing the map.

Frames are best-effort and their absence is a normal, permanent state. The daemon's published
delivery window names three loss points — the bootstrap child's menu is dropped unconditionally, a
busy session can refuse the frame at the fan-in, and a session rotation delivers no fresh menu — so
the store must be correct when nothing arrives, and it is: the conversation reads `null`. There is no
retry, no poll, no spinner and no request half, and none may be added.

**Growth**, stated rather than defended: one entry per distinct `conversationId` seen since launch,
each holding one frame's rows, and no clear in this slice. Each frame is already capped by
`MAX_PLAINTEXT_BYTES` before any parse (14,277 bytes of compact UTF-8 for the whole measured 51-entry
menu), so the bound is entries × frame cap. `conversationActivityStore` (#748) and `queueStore` ship
the identical posture; #955 lands the clear. No speculative eviction policy is built for a failure
nobody has observed.

## Error handling

No failure mode exists on this path to handle. A malformed frame is rejected upstream by #936's
fail-closed narrower inside `daemonConnection`'s decode guard, so no event is emitted at all and
nothing malformed reaches the translator; `null` from the translator means "not our arm", never "bad
data". The store performs no parse, no `JSON.parse`, no coercion and no validation, so it has no
reject branch and throws nothing. The listener only translates and dispatches — it never throws into
React.

Deliberately **silent**: there is no "dropped an unrelated event" or "no menu for this conversation"
diagnostic anywhere on this path. See the security review — a log line here is the one place
workspace-authored text would reach a file.

## Testing strategy

All vitest, node environment, `renderToStaticMarkup` for the one render assertion. Fixtures are
hand-built `WireSlashCommand` rows carrying the measured shapes the wire overview records: an empty
`argument_hint` (33 of 51 entries), an empty `aliases` (42 of 51), a `truncated_fields: null` beside
a row reporting a cut `description`, a `truncated_fields: ['aliases']` row, and a name with a leading
underscore (`__remote-workflow`) so nothing may assume an identifier charset.

`slashCommandListStore.test.ts`:

- an arriving snapshot is readable through `selectSlashCommandListFor` for its own id, and other
  conversations are untouched (AC1);
- a second snapshot for the same id **replaces** wholesale — a row present only in the first is gone,
  nothing merged (AC1);
- absent reads `null`; a snapshot carrying `commands: []` reads a present entry with an empty list,
  and the two are asserted as distinct in one test so neither can be satisfied vacuously (AC2);
- the held rows are the **same array and the same row objects** the snapshot carried — the regression
  test against a future per-row mapping (AC4);
- `truncated_fields: null` reads back as `null` and not `[]`; a row's own list is not visible on any
  other row and no flattened list exists on the entry (AC4);
- `droppedCommands` is held for `0` and for a non-zero value, and an empty-list snapshot with a
  non-zero count round-trips both fields (AC4);
- copy-on-write: a write for conversation B leaves A's entry `Object.is`-identical, and the state
  object itself is replaced rather than mutated.

`slashCommandListBridge.test.ts`, with the `fakeBridge` capture-the-listener helper:

- the translator maps the owned arm to the four named fields, returns a fresh literal with no `type`,
  and is not the event object;
- the translator is unconditional on `commands: []` — returns a snapshot, not `null`;
- the translator returns `null` for a sample of unrelated arms **including `backgroundTaskRoster`**,
  its structural twin, which also carries a conversation id, a row list and a drop count and is the
  one arm a careless filter could confuse it with;
- `subscribeSlashCommandList` subscribes exactly once, writes the translated snapshot on the owned
  arm, does not write on an unrelated arm, and returns the off handle as its cleanup;
- **`connected` neither writes nor clears** (AC3) — pinned specifically, driven through a real store
  seeded with an entry, asserting the entry survives the edge byte-for-byte;
- a real-store seam: absent → an entry after one event, and a second event replaces it;
- `SlashCommandListData` server-renders to `''` without touching `window.pyry`.

No e2e spec. Nothing renders and nothing is clickable in this slice; #940 owns the first interaction
tier. No test asserts an entry-count or per-field byte bound — nothing enforces one and such a test
would pin a fiction.

Gate: `npm test -- src/renderer/src/store/slashCommandListStore.test.ts
src/renderer/src/store/slashCommandListBridge.test.ts src/renderer/src/App.test.tsx` and
`npm run build`.

## Open questions

1. **Independent subscriber, or a new write on an existing bridge?** #937 explicitly left this to this
   ticket. Resolved in this plan: independent subscriber, following #588 and #573, with the four
   existing no-op cases untouched. Recorded here rather than left open because it changes the file
   list.
2. **Does `SlashCommandListEntry` need a `conversationId` field for #940's iteration convenience**, the
   way `HeldBackgroundTask` carries its own `taskId`? Answered no in this plan — nothing iterates the
   whole map, the selector is bound to one id, and there is deliberately no whole-map read surface, so
   shipping one would ship an unread field. If #940 turns out to need a whole-map read, it adds one
   with a caller.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** The untrusted→structurally-trusted boundary is upstream and explicit:
  `parseSlashCommandListPayload` in the main process (#936) is the single narrowing point, and
  `daemonConnection`'s decode guard drops the frame on a reject, so no malformed payload can reach
  this slice. What crosses **into** this slice is structurally trusted and **content-untrusted**: five
  string-typed row fields plus every string in `aliases`, all workspace-authored — a *lower* trust tier
  than the claude-authored text `modelAnnounced` and `questionShown` carry. No finding, with one design
  decision recorded: this repo has no branded-string convention (`announcedModelStore` and
  `backgroundTaskRosterStore` both signal the tier by docblock), so the store and the bridge each carry
  the tier and the never-log clause in their header comments. That is the only mechanism the reader
  gets; a `readonly WireSlashCommand[]` in a signature carries no such signal.
- **[Tokens, secrets, credentials]** No findings — nothing on this path is a secret. `conversationId`
  is an outbound routing/scoping key and explicitly not a nonce (unlike `questionShown`'s batch id);
  no token, key or raw frame can ride the arm. **Design decision, not a vacuous N/A: nothing here is
  persisted.** No `localStorage`, `sessionStorage` or IndexedDB, and none may be added — a
  "remember the menu across launches" optimisation would put workspace-authored text into renderer web
  storage that survives an unpair, outliving the pairing that scoped it, and would defeat #955's clear
  before it is written.
- **[File / storage operations]** No filesystem access on this path. The applicable rule is the
  adjacent one and it *is* a live decision here: `name` **is not an identifier** (one measured name is
  `__remote-workflow`), so nothing may key a cache, a memo or a lookup path by it. The store keys by
  `conversationId` and by nothing else; the row list is an array, never an index built from `name`, so
  no map is ever constructed from workspace-authored text. #940 inherits the rule for its render keys —
  it must not use `name` as a React `key` without a scheme that survives a duplicate or an empty name.
- **[Inter-process / Electron attack surface]** No findings. This slice adds **no** IPC channel, no
  `contextBridge` surface, no `ipcMain` handler and no preload API; it consumes exactly one existing
  read-only capability, `window.pyry.onDaemonEvent`, which #937 already carries. No `ipcRenderer` or
  Node primitive is touched. `window.pyry` is dereferenced only inside the mount effect, never during
  render, so the leaf cannot break `App.test.tsx`'s no-stub server render. No `BrowserWindow` option,
  navigation guard or protocol handler is in scope.
- **[Cryptographic primitives]** Not applicable by process placement, which is the design decision
  rather than an absence: the Noise session, the relay socket, the frame codec and every key stay in
  the main process, and this slice sees only an already-typed event. No randomness is generated here
  and no comparison against a secret is performed, so neither the RNG nor the `timingSafeEqual` rule
  has a site to apply to.
- **[Network & I/O]** No findings, and the **absence of a request half is itself the security-relevant
  decision**. The daemon pushes the frame unsolicited; adding a request, a retry or a poll for a
  missing menu would turn a hostile-or-degraded relay withholding the frame into a client-side spin,
  and delivery is documented best-effort with three named loss points. The plan's answer to "no frame
  arrived" is `null` and nothing else — no retry, no backoff to tune, no timeout to leak. Frame size is
  already capped upstream by `MAX_PLAINTEXT_BYTES` before any parse; a second bound here would be a
  second one to keep in agreement, and stricter-than-wire would fail-close a valid frame.
- **[Error messages, logs, telemetry]** The one category with teeth on this path, and the constraint
  is **binding on the implementation**: zero log calls anywhere in the store or the bridge — no
  `console.*`, no structured logger call, no "dropped an unrelated event" or "no menu for this
  conversation" diagnostic, and no error message that embeds a row. The reason is measured, not
  precautionary: `0x0a` is the only sub-`0x20` byte across the capture's 51 entries' four string
  fields, so the control character that actually occurs is the one that splits a log line, and a
  logged `description` lets a workspace author forge log records in a file readable by anything
  running as the user. Two consequences the design already reflects: the translator uses `default:
  null` rather than `assertNever` (an `assertNever` guard `JSON.stringify`s the whole event into an
  `Error`), and #937's four existing exhaustive-bridge no-op cases must stay — removing one turns the
  same guard into exactly that leak. Nothing here reaches the renderer console either.
- **[Concurrency]** SHOULD FIX, discharged by statement rather than by code. One app-lifetime
  subscription, off-handle as cleanup, no async task, no timer, no listener stacking, and no
  check-then-act race (a single synchronous copy-on-write `set`, no `await` in the critical section).
  The residual is unbounded key growth: one entry per distinct `conversationId` seen since launch with
  no clear in this slice, so a flooding relay costs one bounded entry per distinct id rather than an
  unbounded append per frame. `conversationActivityStore` (#748) and `queueStore` ship the identical
  posture and #955 lands the pairing-scoped clear. Stated in the store's header, deferred to #955, and
  no speculative eviction policy is built for a failure nobody has observed.
- **[Threat model alignment]** Walked, three desktop-specific threats. *Malicious / compromised relay*
  — content-blind but on-path: it can drop, delay, reorder or flood. Dropping yields `null`, which is
  a correct permanent state here rather than an error or a spinner; reordering is harmless because each
  frame is a wholesale snapshot with no merge and no sequence to violate; flooding is bounded as above.
  *Hostile daemon response* — parsed defensively upstream and rejected before emission, so this slice
  never sees a malformed frame; it also never re-derives a field it was given (`droppedCommands` is
  taken, never recomputed), so a hostile count cannot be laundered into a plausible one. *Renderer
  compromise reaching the transport* — process placement is unchanged: no key, socket, token or raw
  byte enters the web layer, so a renderer bug reaches only workspace-authored text it could already
  read. **Out of scope, named:** the pairing-scoped clear that stops one pairing's menus from being
  attributed to the next → **#955**; escaping this text at a DOM sink, and never keying a React `key`
  or a memo by `name` → **#940** (render) and **#681** (Actions-menu match). Neither is deferrable
  silently: both are stated in the store's header so the constraint travels to the reader.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02
