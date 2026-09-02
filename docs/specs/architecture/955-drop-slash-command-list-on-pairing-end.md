# #955 — drop the published slash-command list when a pairing ends

## Files read

- `src/renderer/src/store/slashCommandListStore.ts` → `SlashCommandListStore`,
  `createSlashCommandListStore`, `initialSlashCommandListState`, `setSlashCommandList`,
  `selectSlashCommandListFor` — the store this slice grows a clear on. `setSlashCommandList`'s
  copy-on-write body is what makes returning the exported constant safe, so it is load-bearing here
  rather than incidental.
- `src/renderer/src/clearPairingScopedState.ts` → `ClearPairingScopedStateDeps`,
  `clearPairingScopedState` — the single shared helper both pairing-change paths call. Its docstring
  carries the discriminator this store is measured against and the `clearAllLastRead`-runs-last
  ordering constraint the new call must not disturb.
- `src/renderer/src/clearPairingScopedState.test.ts` → the pinned key-set assertion and `realDeps` —
  the tripwire that makes a store declared in the interface but never invoked a test failure.
- `src/renderer/src/PairedShell.tsx` → `clearPairingDeps` — the one production construction of the
  deps interface, shared by both pairing-change callbacks, which is why joining the set is one edit.
- `src/renderer/src/store/conversationTimelineStore.ts` → `clearAllTimelines` — the whole-map,
  nullary clear this one is shaped after, and the file that records why its `size === 0` guard exists
  (subscriber short-circuit, not a `Map` allocation saved).
- `src/renderer/src/store/conversationLastReadStore.ts` → `clearAllLastRead` — the one clear in the
  set that returns its exported `initial*State` **by reference** rather than a fresh `Map`. The direct
  precedent for this slice's return value.
- `src/renderer/src/store/conversationActivityStore.ts` → `clearAllActivity` — the deliberate
  *counter*-example: it refuses to hand back its exported constant because that constant holds a
  module-shared mutable `Map`. That hazard is real here too and is what the invariant test below pins.
- `src/renderer/src/store/announcedModelStore.ts` → `clearAnnouncedModel` — the `#588 → #593`
  precedent this ticket repeats: ship the holder dormant, add the clear to the helper's dep set.
- `src/renderer/src/store/slashCommandListBridge.ts` → `subscribeSlashCommandList`,
  `SlashCommandListData` — carries the other half of the contract (no `connected` branch, ever) and
  one of the deferral notes this ticket falsifies.
- `src/renderer/src/store/conversationActivityBridge.ts` → the `connected` → `clearAllActivity`
  branch — the worked application of the helper's discriminator that lands on the *other* answer,
  read to confirm this store lands on ours.
- `src/renderer/src/App.tsx` → the `SlashCommandListData` leaf comment — the second deferral note.
- `docs/knowledge/features/slash-command-list-store.md` § "No clear, no reset, no eviction in this
  slice" — the overview's own statement that the lifetime question is this ticket's, and the source of
  the `0x0a`-in-51-entries measurement the no-logging rule rests on.
- `docs/knowledge/features/announced-model-store.md` — how the sibling family documented the same
  dormant-then-cleared sequence.

## Design source

**Figma:** N/A — no `## Figma` section on the ticket, and correctly so. This slice renders nothing:
the store has no reader until #940 and #681, so there is no visual surface to check fidelity against.

## Context

#954 shipped the per-conversation slash-command store and its reactive bridge dormant and
deliberately without a lifetime. This slice adds the lifetime, and only that.

The mechanism is settled by `clearPairingScopedState`'s own discriminator — *"does a reconnect to the
SAME daemon need to clear it?": yes ⇒ the `connected` edge, no ⇒ here.* This store answers **no** on
both halves:

- **A fresh pairing must clear it.** Nothing re-asserts a published menu on a new pairing (the path is
  push-only from a conversation's `initialize` reply), so a retained list latches and attributes one
  machine's workspace verbs to another. Worse than the announced model on the same axis: #681's
  Actions-menu grey-out would grey or un-grey entries against a workspace the operator has left, which
  steers behaviour rather than merely showing a stale label.
- **A reconnect to the same daemon must not clear it.** The retained list still describes that daemon,
  and there is no request half to re-fetch with — `subscribeSlashCommandList` documents that no
  connected-edge fetch exists and none may be added — so a `connected`-edge clear would blank a
  correct value *permanently*.

That is the exact inverse of `conversationActivityStore`, whose four liveness facts answer **yes** and
are therefore cleared at the `connected` edge and registered nowhere in this helper.

Both pairing-change paths must run the clear and they are not symmetric: unpair flips the App route
and unmounts `PairedShell`; pair-another-server transitions `pairServer` → `list` *inside* the shell,
so nothing a remount would have cleared gets cleared. Joining the shared dep set is the whole of the
work, because both callbacks pass the same `clearPairingDeps` object — a store in the set is dropped
on both paths by construction, and a store outside it on neither.

No ADR is warranted: this applies an existing, documented decision rather than making one.

## Design

**One new store method, one new dep, one new call, and five note retirements.** No new exported type,
no new module, no new component.

### The store method — `clearAllSlashCommandLists`

Added to `SlashCommandListStore` (the store shape, not `SlashCommandListState`, so
`initialSlashCommandListState` stays assignable and `selectSlashCommandListFor` still cannot see it).

Contract: `clearAllSlashCommandLists: () => void`.

**Nullary by design**, the `clearAllTimelines` / `clearAllLastRead` property: a pairing ending
invalidates every conversation's menu at once, so no conversation id is taken and therefore no
daemon-supplied string can steer which menus survive the boundary. `tsc` enforces the signature half;
a `toHaveBeenCalledWith()` assertion enforces the call half.

**Naming.** `All` is carried for the reason `clearAllActivity` documents — the blast radius is legible
at the call site rather than only in the docstring — and the noun is the store's, so the eight-key deps
literal reads unambiguously beside `clearAllTimelines` and `clearAllLastRead`.

Body: a guarded return of the exported initial state.

```ts
clearAllSlashCommandLists: () =>
  set((s) => (s.menus.size === 0 ? s : initialSlashCommandListState))
```

Two halves, each doing something the other cannot:

- **`initialSlashCommandListState` by reference**, not `{ menus: new Map() }` — the
  `clearAllLastRead` return, not the `clearAllTimelines` one. Every cleared state therefore holds the
  *same* `menus` object, so a `menus`-level selector is `Object.is`-true across two clears from
  different starting states. A fresh `new Map()` per clear cannot give that.
- **The `size === 0` guard.** The ticket rejects a guard on `clearAllLastRead`'s rationale — there is
  no side effect to suppress, and that rejection is correct: nothing here reaches disk. The guard is
  kept for `clearAllTimelines`'s *separate*, documented rationale, which the ticket's AC4 restates:
  returning `s` itself makes zustand's `Object.is(next, state)` short-circuit fire, so a redundant
  clear notifies **no** listener at all, not merely no selector. Without it, `set(initialState)`
  still allocates a new state object and would wake a bare `store.subscribe(fn)`. Both whole-map
  clears already in this dep set carry the guard; the one unguarded clear (`clearAnnouncedModel`)
  holds a scalar, not a map. This is a deliberate departure from the ticket's "needs no `size` guard"
  sentence, scoped to the reason that sentence does not address — flagged here because the plan is
  where a departure has to be visible.

**The shared-constant hazard, and why it is answered by test rather than by a defensive copy.**
`initialSlashCommandListState.menus` is a module-shared `Map`. `clearAllActivity` refuses to hand its
constant back for exactly this reason: a writer that mutated held state in place would poison the
constant, and every store instance that ever cleared would then hand back the poisoned map. Here that
would be a cross-pairing leak of workspace-authored text with no type error and no failing test.
`setSlashCommandList` is copy-on-write (`new Map(s.menus)` then `set`), so the hazard is closed by
construction today — which is precisely the kind of claim #573's overview records as ceasing to hold
the moment someone edits the writer. It therefore gets an explicit invariant test rather than a
defensive `new Map()` that would cost the by-reference property above.

### The helper — `clearPairingScopedState`

`ClearPairingScopedStateDeps` gains an eighth key, `clearAllSlashCommandLists`, declared after
`clearAnnouncedModel` — adjacent to the other clear of untrusted daemon-relayed text.

The call is inserted in the same position in the body. **Placement constraint:** anywhere strictly
before `deps.clearAllLastRead()`. That clear is last for a documented reason (it is the only effect
with an external side effect and therefore the only one that can throw); putting the new call after it
would move the throwing effect off the end, and a `localStorage` throw would then abort the
slash-command clear — leaving server A's menu live and readable while the operator is on server B.
That ordering gets a call-order assertion rather than being left to the reading of a comment.

The helper's docstring is updated from seven effects to eight, with the new entry stating what it
drops and that it takes no id.

### The wiring — `PairedShell`

`clearPairingDeps` gains one line:
`clearAllSlashCommandLists: () => slashCommandListStore.getState().clearAllSlashCommandLists()`.

It reaches its singleton directly, the `clearAllLastRead` shape, for the same reason: there is no
sampling or gating branch to keep in one tested place — the store method takes nothing at all. Module
scope, `getState()` inside the arrow body, so nothing is dereferenced at module load and `PairedShell`
still subscribes to no store and stays server-renderable.

Both callbacks already pass this object; neither call site is edited.

### Note retirements

Five deferral notes become false the moment this lands and are retired in the same commit, the way
#593 retired its equivalents:

- `slashCommandListStore.ts` header — the "no entry in `clearPairingScopedState` … belongs to #955"
  paragraph, the GROWTH paragraph's "#955 lands the clear", and the SECURITY paragraph's "defeat
  #955's clear before it is written". Each becomes a statement of what now *is*, and the security
  clause becomes stronger, not weaker: persisting would now outlive a clear that exists.
- `slashCommandListBridge.ts` — `subscribeSlashCommandList`'s "belongs to #955" clause, comment-only.
- `App.tsx` — the `SlashCommandListData` leaf's "its pairing-scoped clear is #955's, not this leaf's",
  comment-only.
- `slashCommandListBridge.test.ts` — the `connected`-edge test's deferral comment, test-file-only.

**Deliberately not touched:** `exitActiveConversation.ts` states "FOUR clears, not
clearPairingScopedState's seven" and that count goes stale. Editing it would put this ticket at six
production files, over the size table's ceiling of five, to change one word. It is left alone and
raised in the PR body instead.

## State + concurrency model

Renderer-local, fully synchronous, no async task, no timer, no listener, no subscription added or
removed. One store slice (`menus`) is replaced; nothing is read across an `await` because there is no
`await`. No cancellation path is required because nothing long-lived is started.

Teardown ordering inside the helper is the only sequencing that exists, and it is stated above.

## Error handling

The clear has no failure mode: it is a `Map`-size read and a reference return, with no I/O, no parse,
no allocation that can fail meaningfully, and no reject branch. It cannot throw, so the helper's
"no throw path of its own" property is preserved and no result type is introduced at any layer.

Nothing is surfaced to the UI, because nothing renders this store yet.

**Nothing is logged.** The strings dropped here are workspace-authored, bounded-but-unsanitized text,
and `clearPairingScopedState` already logs nothing deliberately. No logger is imported into either
edited file, so a diagnostic is *unavailable* rather than merely avoided.

## Testing strategy

vitest only, node environment, no DOM. Nothing in the unit tier can invoke either pairing-change
callback and none may be faked into existence: `PairedShell.test.tsx` closes its nav seams by
composing the separately-tested reducer with the separately-tested view, and #593 and #779 both landed
this identical wiring without a per-path test. The property they relied on — both callbacks pass one
deps object to one helper — is what the pinned key-set test protects. No `jsdom`, no `happy-dom`, no
`@testing-library`. No Playwright spec: nothing renders the list until #940 and #681.

`slashCommandListStore.test.ts`:

- Clearing a store holding menus for more than one conversation empties the map, and
  `selectSlashCommandListFor` reads each id back as `null` (absent), not as an observed-empty entry.
- The cleared `menus` is `Object.is`-identical to `initialSlashCommandListState.menus`.
- Clearing an already-clear store returns the state **object** itself, so zustand wakes no subscriber
  (asserted with a real `store.subscribe` spy, which is the only shape that can tell this apart from
  the weaker selector-level no-op).
- The shared-constant invariant: after write → clear on one instance, a second, independent instance
  still starts and clears empty, and `initialSlashCommandListState.menus` is still size 0.
- A clear followed by a fresh write for one conversation lands only that conversation's entry — the
  clear leaves the store usable rather than wedged on a frozen constant.

`clearPairingScopedState.test.ts`:

- The eight-clear spy case grows an assertion that the new effect is called exactly once and
  `toHaveBeenCalledWith()` — the nullary property's call-side half.
- The pinned key-set assertion grows the eighth key.
- The call-order assertion: `clearAllSlashCommandLists` runs before `clearAllLastRead`, via
  `mock.invocationCallOrder`. Pins the throw-ordering finding rather than trusting a comment.
- The real-store integration case seeds a real `createSlashCommandListStore()` with the ended
  pairing's menus for **two** conversations and asserts neither survives — AC3, wired through
  `realDeps` beside the other seven stores.
- The already-clear integration case asserts the state object comes back by reference, beside the
  keyed-timeline and marks stores making the same claim.

## Open questions

1. Does the `size === 0` guard belong here, given the ticket's sentence rejecting one? Resolved in
   Design above: the ticket rejects it on the side-effect rationale, which does not apply; AC4's
   literal reading needs the subscriber short-circuit the guard buys. Recorded as a departure.
2. Should the stale "seven" in `exitActiveConversation.ts` be corrected? Resolved: no — the file
   ceiling forbids it and the note is a drifting count, not a false ownership claim.

## Security review

**Verdict:** PASS

**Findings:**

**1. Trust boundaries — no new crossing; the boundary this adds is the pairing boundary itself.**
The store holds workspace-authored strings (`name`, `argument_hint`, `description`, every string in
`aliases`) — a strictly lower trust tier than the claude-authored text `announcedModelStore` holds.
This slice moves that data in the destroying direction only: nothing is parsed, narrowed, copied or
re-emitted. The boundary it *creates* is the pairing boundary, and it is enforced in exactly one
place — the dep set of `clearPairingScopedState` — so it cannot be enforced at one of the two
pairing-change paths and not the other. The key-set test is what keeps that from regressing.

**2. Tokens, secrets, credentials — not applicable, structurally.** The store holds no credential and
has no at-rest surface: `createSlashCommandListStore` takes no storage port, unlike
`createConversationLastReadStore`, so there is no disk half of this clear to forget. That is a
checkable structural property of the factory signature, not an assurance. It also means the clear
carries none of `clearAllLastRead`'s persistence-ordering obligation.

**3. File / storage operations — not applicable, and the reason is worth stating.** No path, key,
filename or cache key is built here. `name` is not an identifier (one measured name is
`__remote-workflow`) and the map stays keyed by `conversationId` and nothing else, so the clear
introduces no lookup that workspace text could steer. Nothing is persisted and nothing may be — web
storage would outlive the pairing the menu was scoped to and defeat this clear.

**4. Inter-process / Electron — SHOULD FIX, designed in: the clear must not become
daemon-reachable.** No IPC channel, `contextBridge` API or preload surface is added, and — the part
that matters — **no bridge arm is added**. `slashCommandListBridge` keeps exactly one arm in and one
setter out, so no daemon event can invoke the clear, and `clearAllSlashCommandLists` takes no
argument, so no daemon-supplied string can steer which menus survive. The nullary signature is the
`tsc`-side half of that and the `toHaveBeenCalledWith()` assertion is the call-side half. A future
`connected`-edge clear here would be a regression on both counts and is banned in the bridge's prose.

**5. Cryptographic primitives — not applicable.** No RNG, no hash, no comparison of any kind. The
clear compares one `number` to `0` and nothing else; no attacker-controlled value is compared to a
secret anywhere on this path.

**6. Network & I/O — OUT OF SCOPE, named: the in-flight-frame window.** A `slashCommandList` event
already queued on the IPC channel when the clear runs repopulates the store afterwards, because
`SlashCommandListData` is an App-level leaf the unpair route flip does not unmount. Here that is
sharper than the announced model's version of the same window: this store is keyed, so a late frame
inserts an entry under **server A's** conversation id, which server B may reuse. It is nonetheless
out of scope and stays out. The identical window is documented and deliberately accepted by
`sessionIdStore`, inherited verbatim by `announcedModelStore` at #593, and lives unfixed in the two
other keyed stores this same helper clears (`conversationTimelineStore` at #757,
`conversationLastReadStore` at #779). Closing it needs a pairing-generation guard threaded through
the bridges and applied to all four stores at once — a lifecycle-level mechanism, not a store-level
one, and not this slice's to invent for one of the four. Not filed as a bug: it is a known accepted
property with a written rationale, not a newly found defect.

**7. Errors, logs, telemetry — the sharpest category, and the one the design answers structurally.**
A logged `description` is a workspace author forging log records in a file readable by anything
running as the user, and `0x0a` is the only sub-`0x20` byte across the measured 51 entries — the
control character that actually occurs is exactly the one that splits a log line. The tempting
diagnostic here is content-free — "cleared N menus" — and it must still not be written, because the
helper's no-log property is total and a count is the first crack in it. The design makes this
structural rather than disciplinary: no logger is imported into `slashCommandListStore.ts` or
`clearPairingScopedState.ts`, so no diagnostic is available to write. The clear also produces no error
object and cannot throw, so there is no message, no stack and no telemetry payload that could carry
workspace-authored text.

**8. Concurrency — SHOULD FIX ×2, both discharged in Phase B.**
*(a) Ordering.* `clearAllLastRead` must stay last: it is the only effect with an external side effect
and the only one that can throw, and a throw from it after the new call would abort nothing, while a
throw before it would abort the slash-command clear and leave server A's menu live while the operator
is on server B. The new call is placed before it and the order is pinned by
`mock.invocationCallOrder`, not by a comment.
*(b) The shared mutable constant.* Returning `initialSlashCommandListState` hands every cleared
instance the same `Map`. A writer that ever mutated held state in place would poison it, and every
store instance that had cleared would then hand back workspace-authored rows across a pairing
boundary — with no type error and no failing test. `clearAllActivity` names this hazard and pays a
fresh `Map` to avoid it; this design keeps the by-reference return and pays a test instead, asserting
the constant is still empty after a write-and-clear cycle on an independent instance. No async
ownership, cancellation, listener or shutdown concern exists: nothing here is asynchronous.

**9. Threat model alignment.** The threat this ticket closes is **cross-pairing attribution**: server
A's workspace-authored verb menu offered while the operator is connected to server B. It is a
behaviour-steering surface rather than a stale label, since #681 greys entries by it. Against a
malicious or compromised relay: it is content-blind and on-path, and can flood or withhold frames —
flooding costs one bounded entry per distinct conversation id and this clear now drops all of them at
once, while withholding is a normal permanent state the selector already reports as `null`. The relay
can neither trigger this clear (no daemon event reaches it) nor steer it (nullary). Against a hostile
daemon response: malformed frames are rejected upstream by #936's fail-closed narrower inside
`daemonConnection`'s decode guard, so nothing malformed reaches the store and the clear parses
nothing. Token theft from disk is not applicable — nothing on this path is persisted. Renderer
compromise reaching the transport is unchanged by this slice: it adds no renderer capability, and the
store holds no key, socket or token.
