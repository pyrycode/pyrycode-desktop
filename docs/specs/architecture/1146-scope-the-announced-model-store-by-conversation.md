# #1146 — Scope the announced-model store by conversation

## Files read

- `src/renderer/src/store/announcedModelStore.ts` → `AnnouncedModel`, `AnnouncedModelState`,
  `createAnnouncedModelStore`, `selectAnnouncedModel` — the single app-wide slot this ticket keys, and
  the three docblocks whose "one record" claims the keying retires.
- `src/renderer/src/store/modelListStore.ts` → `ModelListEntry`, `ModelListSnapshot`,
  `ModelListState`, `createModelListStore`, `selectModelListFor` — the template the ticket names, and
  the closest one there is: same store family, `ReadonlyMap` keyed by `conversationId`, a selector
  factory handing back the held entry itself, an entry/snapshot split that keeps the key off the value,
  and the same two consumers.
- `src/renderer/src/store/announcedModelBridge.ts` → `translateModelAnnounced`,
  `subscribeAnnouncedModel`, `AnnouncedModelData` — the sole writer; its fresh named-field literal is
  where the id is dropped today, on purpose and with a docblock saying so.
- `src/renderer/src/screens/conversation/RunConfigSections.tsx` → `RunConfigSections` — reader one. Its
  `selectModels` `useMemo` is the line the announced read is about to become a near-copy of.
- `src/renderer/src/screens/conversation/ComposerModelMenu.tsx` → `ComposerModelMenu` — reader two, plus
  the `ComposerModelLayers` docblock whose #1053 paragraph defers exactly this work.
- `src/renderer/src/store/conversationActivityStore.ts` → the header's `ReadonlyMap`-mandated /
  `Record`-forbidden rule for a daemon-asserted key, and its three consequences.
- `src/renderer/src/store/conversationActivityStore.test.ts` → `hostileKeys` — the `__proto__` /
  `constructor` / `''` reads that are the whole defence for that rule, since a `Record` swap produces no
  type error.
- `src/shared/ipc/events.ts` → the `modelAnnounced` arm — `conversationId` REQUIRED since #714, and the
  rule that an unknown id is an explicit no-match rather than a `?? activeConversation` fallback (AC3).
  Its security paragraph asserts the id "STOPS at the announced-model bridge", which this ticket
  falsifies.
- `src/main/daemonConnection.ts` → the `model-announced` emit — carries the same "stops at the
  announced-model bridge … rebuilds a fresh two-field literal" claim, likewise falsified.
- `src/renderer/src/exitActiveConversation.ts`, `src/renderer/src/clearServerScopedState.ts` → the two
  docblocks the ticket names, each asserting the property being retired.
- `src/renderer/src/clearPairingScopedState.ts` → `clearAnnouncedModel` in `ClearPairingScopedStateDeps`
  — the existing wiring that carries AC4 with no edit.
- `docs/knowledge/features/announced-model-store.md` § "Single current value, not a per-conversation
  map" and § "Cleared on unpair" — the prior tickets' lessons: #714 widened the emit, the id stops at
  the translate, and #1141 reopened #560's staleness for this store alone because it is the one member
  of the pairing set that is neither server- nor conversation-keyed.

## Design source

**Figma:** N/A — no new visual surface. The change is which value two existing controls read; both
already render a designed "no running model" state, reachable today on a freshly launched app that has
received no announcement. Nothing is laid out, styled or tokenised here, so the verifier's
visual-fidelity check has nothing to key on.

## Context

`announcedModelStore` holds one app-wide `announced: AnnouncedModel | null`, keyed by neither server nor
conversation. With two servers paired it holds whichever daemon spoke last, and both readers — the Run
configuration sheet's Running model row and the composer's model menu — attribute it to whatever
conversation is open. #1141 removed `clearPairingScopedState`'s incidental blanking on a pairing *add*,
so the staleness is now reachable from that path too; the underlying defect predates it and needs no
pairing change to reproduce.

This is the sibling of #1145 out of the same defect shape: a store whose scoping did not follow the app
to several live connections. Display-only — the actionable model write reads the correctly-keyed
`modelListStore`.

No ADR is warranted. The keying decision is `modelListStore`'s, already recorded; this ticket applies
it to a second store in the same family rather than deciding anything new.

### Size: one line of the table is exceeded, deliberately

Production source files: **8**, against a ceiling of 5. Four carry real changes (the store, the bridge,
the two readers); four are comment-only corrections of claims this diff falsifies
(`exitActiveConversation.ts`, `clearServerScopedState.ts`, `events.ts`, `daemonConnection.ts`). The
ticket's estimate named the first six and argued the overage: the only available split is the keyed
store from its two readers, and the store half's consumers are exactly those two readers in the same
family — a one-consumer slice, which the floor rule outranks the ceiling for. The last two were found by
a concept sweep during this plan, not named in the ticket: both assert the daemon-asserted
`conversationId` "STOPS at the announced-model bridge, which rebuilds a fresh two-field literal", which
stops being true the moment the id rides into the store. Leaving a false claim about where an untrusted
routing key travels standing in the wire-event contract is worse than the file count. Every other line
of the table holds: one new exported type, two selector call sites and one writer, four criteria, no
reject branches, and total written work at the ceiling rather than over it.

## Design

`modelListStore`'s structure, applied verbatim. The changes are confined to the state's shape, the
write's argument and the selector's arity; the held record, both readers' view props and every view
test stay untouched.

### Types

`AnnouncedModel` is **unchanged** — the same two fields, the same verbatim-hold and untrusted-text
contract. Keeping it is what leaves `RunConfigView`'s and `ComposerModelMenuView`'s props, and their
tests, out of this diff entirely.

A new write unit follows `ModelListSnapshot`'s split, for that docblock's reason — a key carried inside
the value is a second copy to keep in agreement with the map key:

```ts
export interface AnnouncedModelSnapshot extends AnnouncedModel {
  conversationId: string
}
```

`extends` rather than a restatement, so a field added to `AnnouncedModel` later lands on both by
construction.

`AnnouncedModelState.announced` becomes `ReadonlyMap<string, AnnouncedModel>`. The field keeps its name:
it still reads as a collective, and renaming it would churn `clearPairingScopedState.test.ts` for
nothing observable. `initialAnnouncedModelState` becomes `{ announced: new Map() }`.

`ReadonlyMap` is **mandated and `Record<string, …>` forbidden**, on `conversationActivityStore`'s rule
and its three consequences: nothing is keyed into an object literal, the write path uses no computed
object keys, and `Object.fromEntries` / spreading the map / `JSON.stringify` of it are all out. A
`Record` swap produces no type error, so the hostile-key tests below are the whole defence.

### Write

`setAnnouncedModel(snapshot: AnnouncedModelSnapshot)` replaces one conversation's record wholesale and
touches no other key — copy-on-write: clone the outer map inside the `set` updater, set the one key,
return a fresh state. Reading `s.announced` inside the updater rather than through `getState()` outside
it is what stops two frames arriving back-to-back from interleaving. Every existing per-key contract
survives unchanged: a later announcement wholly replaces that id's record with no merge, a verbatim
repeat is written again rather than deduped, `{ model: '', truncated: false }` is a real record and not
collapsed to absent, and `truncated` is a value rather than an absence.

The map is never mutated in place, and that is load-bearing rather than stylistic once the clear returns
the module-shared `initialAnnouncedModelState` by reference: an in-place writer would poison that
constant and hand one pairing's announcements to the next, with no type error. Pinned by a test.

### Clear

`clearAnnouncedModel` keeps its **name and nullary signature**; only the body changes, from "return the
state to the null sentinel" to "drop the whole map", still by returning `initialAnnouncedModelState`.
Renaming it to `clearAllAnnouncedModels` would touch the store method, the `ClearPairingScopedStateDeps`
member, that helper test's sorted-key pin and the `PairedShell` wiring — four edits across two more
production files for nothing observable. `clearPairingScopedState` and `PairedShell` are not touched,
and AC4 is carried by that existing wiring.

It stays unconditional and never branches on held content: a clear gated on an identifier would let a
hostile daemon craft a record that survives a pairing switch and is then attributed to the next daemon.

### Read

`selectAnnouncedModel` becomes a factory, replacing the nullary selector at both call sites:

```ts
export const selectAnnouncedModelFor =
  (conversationId: string) =>
  (s: AnnouncedModelState): AnnouncedModel | null =>
    s.announced.get(conversationId) ?? null
```

`?? null` keeps "no announcement has arrived for this conversation" and a held
`{ model: '', truncated: false }` apart, exactly as the nullable sentinel does today. It returns the held
record itself, never a rebuilt one, so a write for another conversation leaves this one `Object.is`-true
and re-renders nothing. There is deliberately no whole-map read surface — nothing iterates every
conversation's announcement.

AC3 falls out of this by construction: a reader asks only for the open conversation's id, so an
announcement under an id nothing can select is held under its own key and read by nothing. There is no
`?? activeConversation` anywhere on the path, which is the rule the `modelAnnounced` arm states.

### Data flow

`translateModelAnnounced` returns `AnnouncedModelSnapshot | null` and widens its fresh named-field
literal to three fields — still a literal built by name, never a spread, so `type` cannot reach the
store. `subscribeAnnouncedModel`'s injected setter takes the snapshot; its `!== null` record guard is
unchanged, so an empty-identifier announcement still writes with its truncation report. `AnnouncedModelData`
is unchanged beyond the type flowing through.

Each reader gains a `useMemo`-stable selector per id, a near-copy of the `selectModelListFor` line
already beside it — a fresh closure each render would churn the subscription, and a null conversation
selects nothing through the same path with no invented key and no second branch downstream:

```tsx
const selectAnnounced = useMemo(
  () => (conversationId === null ? () => null : selectAnnouncedModelFor(conversationId)),
  [conversationId]
)
const announced = useAnnouncedModelStore(selectAnnounced)
```

Both containers already hold `conversationId` as a prop, so neither gains a subscription or a prop.

`exitActiveConversation` **gains nothing**: a departed conversation's key is inert once nothing can
select it, and the last-server clear still drops the whole map. Scoping a departed *server's* keys is the
migration `clearServerScopedState`'s docblock parks alongside `queueStore`, the background-task roster
and `modalPrompts`, and stays parked.

#1053's layer ordering does not move. Its argument that a confirmed pick outranks an announcement rests
on the announcement carrying no sequence and no timestamp, which stays true per key; only the wording
calling the store one record is corrected.

### Docblock corrections (deliverable, not tidying)

Each of these asserts the property being retired and becomes false:

- `announcedModelStore.ts` — the header's single-slot framing, `AnnouncedModelState`'s
  record-`|`-null paragraph, the factory's "holds exactly one record" memory argument, and the growth
  bound, which becomes one entry per distinct id seen since launch, returned to zero by the pairing clear.
- `exitActiveConversation.ts` — the "the announced model is daemon-scoped, not conversation-scoped"
  sentence and its left-out-stores list entry. The store stays out of that helper, for the new reason
  above rather than the old one.
- `clearServerScopedState.ts` — the paragraph naming this store among app-wide single slots "with no
  server key at all" and citing this ticket as an open bug.
- `ComposerModelMenu.tsx` — the #1053 paragraph deferring this work, and the layer docblock's "holds one
  record" aside.
- `events.ts` and `daemonConnection.ts` — the id no longer stops at the bridge; it reaches the store as a
  map key. What must be restated is what the id is still not: not rendered text, not model-influenced,
  never markup, a filename, a cache key, an attribute, a URL or a log field.

## State + concurrency model

One Zustand store slice, renderer-only — no IPC, no transport, no async task, no timer, no teardown of
its own. The single writer is the bridge's subscription, whose off handle is already its effect cleanup;
this ticket adds no subscription and no cancellation path. The only ordering question is two frames
arriving back-to-back, closed by reading the map inside the `set` updater. React re-render scope
narrows rather than widens: today every announcement re-renders both readers, and after this only the
one whose conversation was announced for.

## Error handling

No new failure mode and no reject branch. There is nothing to validate: a malformed frame is already
rejected upstream by the fail-closed decode inside `daemonConnection`'s guard, so no event is emitted at
all, and a second weaker check here would only invent a disagreement. Nothing throws, and nothing is
logged on any path — not even a content-free count, which would be the first crack in a no-diagnostic
property that has to be total to be worth anything.

## Testing strategy

Vitest only, both suites node-environment and framework-free. **No e2e work** — the deliverable is
unit-testable, renderer specs here are static server renders, and the two-server composition is not
required by any criterion.

`announcedModelStore.test.ts` — migrate every existing case by threading an id through the `announced`
helper and reading back through `selectAnnouncedModelFor`, keeping each contract's assertion intact.
Then add, as bullet-level scenarios:

- two conversations' announcements held at once, each reading back its own identifier and its own
  truncation report, neither replacing the other (AC2)
- a write for one conversation leaves every other entry `Object.is`-identical (the no-re-render property)
- a conversation no announcement has arrived for reads `null`, and an announcement under an
  unselectable id is invisible to a read for the open one (AC1, AC3)
- `__proto__`, `constructor` and `''` as three unremarkable keys — read BEFORE any write (each must be
  `null`), then written, read back and held independently. The pre-write read is the half that matters:
  on a `Record` it walks the prototype chain and `?? null` never fires, so a reader is handed
  `Object.prototype` as an announcement — truthy, with an `undefined` `model` — and branches as though
  one exists. These fail on a `Record` swap and nothing else does.
- the clear drops every key at once, and never poisons the shared initial state — a later write still
  lands and a second instance still starts empty

`announcedModelBridge.test.ts` — thread the id through each existing case, and add: the snapshot carries
the event's `conversationId` verbatim (still a fresh literal, `type` absent), and two conversations'
announcements driven through the real store land under their own keys with neither displacing the other.

`clearPairingScopedState.test.ts` — the two `announced`-is-null assertions become map-emptiness reads.
The dep-set sorted-key pin is untouched, since no name changes.

Neither reader spec mocks this store, and both view components keep their props, so no reader test
changes. The container smoke tests still server-render with an empty map selecting `null`.

RED first: the keyed-store and keyed-bridge cases are written against the new signatures and watched to
fail before either module changes.

## Open questions

- Whether the field should be renamed from `announced` to a plural. Resolved in favour of keeping it:
  the diff it would add is confined to test assertions that already have to change for the shape, so the
  rename buys legibility at the cost of churn in a file the ticket says to leave alone.
- Whether the clear should gain `clearAllModelLists`' `size === 0` short-circuit. Resolved: no — the
  existing body is already correct under the map, the guard only saves a listener wake nothing has asked
  for, and adding it is a behaviour change outside the ask.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings. The design moves a daemon-asserted string across a boundary it did not
  previously cross — `conversationId` now reaches renderer store state as a `Map` key — and the boundary
  is a single named function, `translateModelAnnounced`, which admits it by rebuilding a fresh
  named-field literal rather than spreading the event. The type system carries the distinction rather
  than a comment: `AnnouncedModelSnapshot` carries the id, `AnnouncedModel` (what a reader holds) does
  not, so a reader is structurally incapable of holding the untrusted key. The id has no read-back path
  — the entry has no id field, there is no whole-map read surface, and `Object.fromEntries` / spreading
  the map / `JSON.stringify` are forbidden by the `ReadonlyMap` mandate, so nothing can iterate keys
  back out.
- [Hostile-key handling] MUST FIX, **fixed in this plan before commit**. The `ReadonlyMap` mandate is
  correct, but the Testing strategy asserted only write-then-read for `__proto__` / `constructor` / `''`,
  which leaves the `Record`-swap regression undetected in the direction that actually reaches a reader:
  a pre-write read on a `Record` walks the prototype chain, `?? null` never fires, and the selector hands
  a reader `Object.prototype` as an announcement — truthy, `model` `undefined` — which both views branch
  on as "an announcement exists". Since a `Record` swap produces no type error and breaks no other
  assertion, those reads are the whole defence, and the plan now requires the pre-write read explicitly.
- [Tokens, secrets, credentials] Not applicable, by a design fact rather than by inspection: nothing on
  this path is a credential, and nothing here persists. `createAnnouncedModelStore` takes no storage port
  (unlike `createConversationLastReadStore`), so there is nothing to reach — which matters because web
  storage would outlive the pairing that scoped an announcement and survive the clear with every
  in-memory assertion still green.
- [File / storage operations] No findings. No filesystem path is constructed anywhere on this path. The
  new `conversationId` key is barred from exactly this sink class: it is a `Map` key and nothing else —
  never a filename, a cache key, a lookup path, an attribute or a URL — and the corrected `events.ts` /
  `daemonConnection.ts` docblocks restate that bar in place of the now-false "stops at the bridge" claim.
- [Inter-process / Electron attack surface] No findings. No IPC channel, `contextBridge` API,
  `ipcMain` handler, window or `webPreferences` is added or changed. The `modelAnnounced` arm already
  carries `conversationId` across IPC (REQUIRED since #714); this ticket adds no wire field and no
  preload surface, and moves nothing toward the renderer that was not already there. Keys, sockets and
  the Noise session stay in the background process, untouched.
- [Cryptographic primitives] Not applicable, and one decision worth naming because the category
  superficially trips on it: matching the id wants plain `Map.get` and specifically **not**
  `crypto.timingSafeEqual`. Nothing on this arm is unguessable and nothing is a secret — it is a
  routing/display-scoping key, not a MAC or a token — so a constant-time compare would be ceremony
  claiming a secrecy property the value does not have. `ModelListSnapshot`'s docblock makes the same call.
- [Network & I/O] SHOULD FIX, addressed by the plan's docblock-corrections section. This ticket changes
  the store's memory profile from O(1) to O(distinct conversation ids seen since launch), so a hostile
  relay flooding `model_announced` frames with distinct ids grows the map where today it replaces one
  slot. Bounded per entry — `MAX_PLAINTEXT_BYTES` caps the decrypted envelope before any parse, so both
  the key and the ≤256-byte `model` are bounded per frame — and returned to zero by the pairing clear;
  the cost is one bounded entry per distinct id rather than an unbounded append per frame, which is the
  settled posture of `modelListStore`, `slashCommandListStore`, `conversationActivityStore` and
  `queueStore`. The obligation this creates is that the store header **states** the new growth bound
  rather than leaving the old O(1) claim standing, which the plan requires. No eviction policy is built:
  no such failure has been observed, and speculative eviction would be a second lifetime to keep in
  agreement with the clear.
- [Error messages, logs, telemetry] No findings, with one new temptation to foreclose. Nothing on this
  path logs, throws or reports, and that must stay total — a content-free count would be the first crack.
  Keying newly puts an untrusted id in renderer memory beside the value, which makes a diagnostic of the
  form "announcement for conversation X" newly *writable*; it is barred by the content-free rule, the
  store and bridge stay `console.*`-free by construction, and the id reaches no sink on this leg.
- [Concurrency] No findings; the design closes the one shape and narrows an existing window. Two frames
  arriving back-to-back are a check-then-act only if the map is read outside the updater, so it is read
  **inside** `set`, which zustand runs synchronously against current state. The known window where a
  `modelAnnounced` frame already queued on the IPC channel repopulates the store after the unpair clear
  — `AnnouncedModelData` is an App-level sibling of `AppView`, so the route flip does not unmount its
  listener — gets strictly **narrower** under keying, not wider: the late record lands under the departed
  pairing's conversation id, which no reader can select any more, instead of under the one slot every
  reader reads. No listener, timer or async task is added, so no cancellation path is owed.
- [Threat model alignment] No findings; the change reduces the surface it touches. A hostile daemon
  asserts the id, so it can place a crafted `model` string under any key it names — but today it needs
  no crafting at all: the single app-wide slot is read by every reader on every server, so a hostile
  daemon on server A already attributes its string to a conversation on server B for free. That is the
  defect this ticket removes. The residual is a daemon that already knows *another server's* conversation
  id; no path in this app carries one server's ids to another, the payload is display-only, and both
  sinks render it as escaped plain text at one JSX text position. Accepted and named rather than fixed.
  Malicious relay is covered under Network & I/O above; renderer-compromise reach is unchanged.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
