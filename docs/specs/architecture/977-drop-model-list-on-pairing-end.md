# #977 — Drop the published model list when a pairing ends

Give `modelListStore` the lifetime #974 deliberately shipped it without: a nullary, whole-map clear,
reached only through `clearPairingScopedState`'s injected dep set, so both pairing-change paths drop
every conversation's published model menu by construction.

## Files read

- `src/renderer/src/store/modelListStore.ts` → `ModelListStore`, `createModelListStore`,
  `initialModelListState`, `selectModelListFor` — the store this slice grows a clear on; its header
  names the entry point (`clearPairingScopedState`'s dep set) and the four forward-referencing notes
  to retire.
- `src/renderer/src/store/slashCommandListStore.ts` → `clearAllSlashCommandLists`,
  `initialSlashCommandListState` — the shape to mirror verb for verb: nullary, `size === 0` guard,
  returns the shared initial state BY REFERENCE.
- `src/renderer/src/clearPairingScopedState.ts` → `ClearPairingScopedStateDeps`,
  `clearPairingScopedState` — the single place this repo decides what a pairing owns; the
  discriminator ("does a reconnect to the SAME daemon need to clear it?") and the one ordering
  constraint live in its docblock.
- `src/renderer/src/clearPairingScopedState.test.ts` → `spyDeps`, `realDeps`, and the dep-key pin in
  `it('the pairing-scoped set is exactly these eight stores')` — the tripwire this ticket trips.
- `src/renderer/src/PairedShell.tsx` → `clearPairingDeps` — the ONE deps object literal; both call
  sites (in the `onUnpaired` and `onPairServerPaired` wrappers) pass it, so one edit covers both.
- `src/renderer/src/store/modelListBridge.ts` → `subscribeModelList`, `ModelListData` — the file the
  clear must stay UNREACHABLE from; carries a tense-only forward reference.
- `src/renderer/src/store/modelListStore.test.ts`, `src/renderer/src/store/modelListBridge.test.ts`
  → the existing coverage, including the bridge's `a connected edge neither writes nor clears the
  store` case that already pins half of the daemon-unreachability property.
- `docs/knowledge/features/model-list-store.md` § "No clear, no `connected` branch" — names the
  method this ticket must export (`clearAllModelLists`) and the precedent chain; § "Edge cases"
  carries the lesson that the sibling's never-into-a-log EVIDENCE does not transfer to this frame,
  only the rule does.
- `docs/knowledge/features/slash-command-list-store.md` — the sibling package overview, for the
  worked shape of the same wiring at #955 (commit `18ce310`).

## Design source

**Figma:** N/A — no UI is added, moved or restyled. This slice is store lifetime and helper wiring;
AC5 states no render behaviour moves. The store's consumers (`RunConfigSections`' Model, running-model
and Effort sections) are untouched and render from the same selector before and after.

## Context

The published model list is daemon-scoped: it states which model identities claude will accept on the
machine the app is currently paired with. `modelListStore` holds it per conversation and nothing
drops it, so it survives a pairing change — and a stale list is not cosmetic. The run-configuration
sheet would offer rows the new daemon never published, and selecting one sends a model argument the
new daemon rejects.

#974 shipped the store deliberately without a clear, so this slice could add it — the same #954 → #955
sequence the structural twin followed, and the #588 → #593 sequence before that. The clear belongs in
`clearPairingScopedState` rather than at a call site or on the bridge, by that helper's own
discriminator: a reconnect to the SAME daemon leaves a published list correct (so the `connected` edge
must not clear it), and there is no request half on this path to re-fetch one with (so nothing
re-asserts it on a new pairing). Both answers match `slashCommandListStore`'s exactly.

No ADR is warranted: this slice adds no decision, it discharges one already recorded in
`clearPairingScopedState`'s docblock and in the package overview.

## Design

Four production files, one new exported method, no new type.

### 1. `modelListStore.ts` — the clear

`ModelListStore` gains one member beside `setModelList`:

```ts
clearAllModelLists: () => void
```

Nullary by design, and that signature is the security property rather than a style choice: a pairing
ending invalidates EVERY conversation's list at once, so "takes no conversation id at all" is
enforced by `tsc` and no daemon-supplied id can craft a list that survives the boundary. The name
carries `All` for `clearAllSlashCommandLists`' reason — the blast radius is legible at the call site,
which is where it is actually invoked, among the now-nine keys of `ClearPairingScopedStateDeps`.

Body: `set((s) => (s.lists.size === 0 ? s : initialModelListState))`. Two halves, both deliberate and
both inherited from the sibling rather than re-derived:

- It returns `initialModelListState` BY REFERENCE, not `{ lists: new Map() }`, so every cleared state
  holds the same `lists` object. That makes the store's existing copy-on-write LOAD-BEARING: the
  constant is module-shared, so a writer that ever mutated `s.lists` in place would poison it and
  hand one pairing's claude-authored rows to the next, with no type error. Pinned by test, the way
  the sibling pins it, rather than paid for with a fresh `Map`.
- The `size === 0` guard is the `clearAllTimelines` guard, NOT the `clearAllLastRead` one: nothing
  here reaches disk and there is no side effect to suppress. Handing the state OBJECT back makes
  zustand's `Object.is(next, state)` short-circuit fire, so a redundant clear wakes no listener at
  all — strictly more than `set(initialModelListState)` unguarded, which would still allocate a new
  state object and short-circuit only the selectors.

Nothing is logged, not even a content-free count of what was dropped. There is deliberately no
per-conversation drop beside it: nothing has asked for one, and a `conversationDeleted` arm here
would be a second lifetime to keep in agreement with this one.

### 2. `clearPairingScopedState.ts` — the ninth dep

`ClearPairingScopedStateDeps` gains `clearAllModelLists: () => void`; the docblock's numbered effect
list grows to nine and the prose gains the model list beside the published menus.

**Placement: immediately after `deps.clearAllSlashCommandLists()`, before `deps.dispatchSession()`
and therefore before `deps.clearAllLastRead()`.** The constraint the ticket names is the throw:
`clearAllLastRead` is the only effect that reaches outside memory (`localStorage`) and so the only
one that can throw, and anything sequenced after it would be aborted by such a throw — leaving the
ended pairing's model menu live for the sheet to offer. Position is otherwise free among the
in-memory clears, and adjacency to the slash-command clear is the legible choice: the two are the
same fact against two stores, both published-list drops of daemon-relayed text from the same
`initialize` reply. Pinned by an ordering test rather than by trusting this paragraph.

### 3. `PairedShell.tsx` — the one deps literal

Import `modelListStore`; add one entry to `clearPairingDeps`:

```ts
clearAllModelLists: () => modelListStore.getState().clearAllModelLists(),
```

It reaches its store DIRECTLY (the `clearAllSlashCommandLists` / `clearAllLastRead` shape) because
the store method takes nothing at all — there is no sampling or gating branch to keep in one tested
place. Both pairing-change paths pass this same object, so this is a single edit rather than two;
that is the whole reason the clear lives in the shared helper. The module-scope docblock above the
literal gains this slice beside #593, #779 and #955.

### 4. `modelListBridge.ts` — prose only, no behaviour

Its forward reference (`#977 puts its clear` / `is also what will keep it daemon-UNREACHABLE`) moves
to landed tense. **The point it makes stays true and the file's behaviour must not change:** no
import of the clear, no `connected` branch, no arm that could invoke it. AC5 binds here.

### Prose to retire, and prose to leave alone

Retire (they become FALSE once the clear exists) — `modelListStore.ts`'s header sentence saying this
slice ships the shape "and none of the clear itself", and the `ModelListStore` docblock's "There is
deliberately NO clear here yet"; `modelListBridge.ts`'s tense-only sentences in
`subscribeModelList`'s docblock.

Leave exactly as written, per the ticket's enumeration — these describe what the clear DOES and stay
correct: `modelListStore.ts`'s growth-bound sentence in the header and its no-persistence sentence,
`modelListBridge.test.ts`'s `connected`-edge comment, `modelListStore.test.ts`'s shared-initial-state
comment, and `App.tsx`'s per-leaf comment (already in its settled post-landing form; App.tsx needs no
edit at all in this slice). The knowledge base and the specs also reference this ticket and are the
documentation phase's to fold — untouched here.

## State + concurrency model

One store slice (`modelListStore.lists`), one new synchronous whole-value write. No async task, no
timer, no subscription, no promise, so there is no cancellation path to define — the clear is a
synchronous map swap inside a synchronous helper, and `clearPairingScopedState` is already total: no
gate, no return value, no throw path of its own.

Re-render behaviour: on a populated store the clear is one state change that notifies subscribers
once; every `selectModelListFor(id)` then reads `null`. On an already-clear store the guard returns
the state object and zustand wakes no listener. Because the clear runs synchronously on the
renderer's single thread, no observer can see a half-cleared set, and React batches it into the
commit that carries the route change.

Ordering within the helper is the only interaction: after the four clears above it (none of which
reads this store's state) and before `clearAllLastRead`, per § Design 2.

## Error handling

There is no failure mode to handle. The clear performs a `ReadonlyMap` reference swap: it cannot
throw, has no I/O, no parse, no reject branch and no result type. It is idempotent by construction
(the guard), so a double invocation is a no-op reference.

The store's existing "nothing is validated on the way in" posture is unchanged — this slice adds no
input to validate, because the clear has no parameters.

## Testing strategy

All vitest, node environment, no DOM. No Playwright spec: nothing interactive or visual changes, and
the pairing-change paths are already covered by the helper's own suite.

`modelListStore.test.ts` — three cases mirroring the sibling's:

- clears EVERY conversation's list at once; each reads back as ABSENT through `selectModelListFor`
  (not as an observed-empty entry, so the selector's two readings stay apart across the boundary),
  and `lists` is `toBe(initialModelListState.lists)` — the by-reference half.
- clearing an already-clear store notifies NO subscriber: asserted through a raw `store.subscribe`
  counter, which is the only shape that tells the state-object short-circuit apart from a fresh
  state object that only selectors would skip.
- the clear never poisons the shared initial state, and a cleared store stays usable: seed, clear,
  assert `initialModelListState.lists.size === 0`, then a fresh instance is empty and its next frame
  lands only under its own key.

`clearPairingScopedState.test.ts` — the four growth points, which together are AC4:

- `spyDeps()` gains the key in all four places (return-type annotation, const, `deps` literal,
  returned object).
- The all-clears case asserts `clearAllModelLists` called exactly once AND
  `toHaveBeenCalledWith()` — the call-side half of the nullary property, whose `tsc` half is the
  signature.
- The dep-key pin literal grows to nine entries. Not loosened: it stays an exact sorted array.
- A new ordering case: `clearAllModelLists` runs before `clearAllLastRead`, by
  `invocationCallOrder`, mirroring the sibling's.
- `realDeps()` gains a positional store parameter and its wiring; the three call sites pass a store.
  The populated integration case seeds TWO conversations (one with rows and a non-zero drop count,
  one deliberately empty — the case a per-conversation clear would half-solve, since the daemon
  publishes from every conversation's `initialize` reply including ones never opened) and asserts
  `lists.size === 0` plus `null` from the selector for both. The idempotence case asserts the store
  state comes back by reference.

That last one is AC1's "proven against real stores, not only spies".

RED first: the store cases fail on a missing method (and `tsc` on the missing member); the helper
cases fail to compile until the dep is declared, then fail the pin assertion until it is asserted
called — which is exactly the tripwire the ticket names.

## Open questions

1. **Does `realDeps()`'s growing positional parameter list want converting to an options object?**
   Nine positional store parameters is at the edge of legible. Leaning no: it is a pre-existing
   shape this ticket was not asked to touch, and converting it would rewrite three call sites for
   style. Resolve in Phase B; record here if it changes.
2. **Does any consumer typed against `ModelListStore` break when the type gains a member?**
   Expected no — selectors are typed against the state-only `ModelListState`, and
   `RunConfigSections.test.tsx`'s mock derives its selector type from
   `ReturnType<typeof store.getState>`, so it adapts. Confirm at `npm run build`.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] No findings.** This slice adds a REMOVAL path for the highest-trust-tier text
  the renderer holds (claude-authored `resolved_model` / `value` / `display_name` / `effort_levels`,
  which crossed the subprocess boundary and is prompt-injection-reachable in a way workspace-authored
  text is not). It crosses no boundary of its own: `clearAllModelLists` is nullary, so there is no
  input to trust or distrust, and `tsc` enforces that rather than a test. The trigger is a local
  pairing-change decision (`runUnpair`'s `ok` result, then the `onUnpaired` / `onPairServerPaired`
  wrappers in `PairedShell`), never anything a daemon or relay supplies, and the failure direction is
  fail-safe — a spurious clear drops data and can never resurrect it.
  One hazard is real and is answered by construction: because the clear returns the module-shared
  `initialModelListState` BY REFERENCE, a writer that ever mutated `s.lists` in place would poison it
  and hand pairing A's claude-authored rows to every store instance that had cleared, with no type
  error. `setModelList`'s copy-on-write is what prevents it and is therefore load-bearing rather than
  stylistic; the plan pins it with `expect(initialModelListState.lists.size).toBe(0)` after a
  seed-then-clear in `modelListStore.test.ts`.
- **[Tokens, secrets, credentials] Not applicable, with a reason.** The store holds no token, key or
  credential, and this slice adds no lifecycle for one. The structural guarantee is that
  `createModelListStore` takes no storage port at all (unlike `createConversationLastReadStore`), so
  the clear has nothing at rest to reach and nothing to fail to reach.
- **[File / storage] No findings.** The store is memory-only and must stay so. The `clearAllLastRead`
  lesson is the one that applies here: had anything persisted this list, an in-memory-only clear would
  leave the persisted copy to be re-hydrated at next launch, keyed under ids the new daemon may reuse,
  with every in-memory assertion green. The enforcement is the absent constructor parameter, not a
  guard — a persisted copy has no site to exist in.
- **[Inter-process / Electron attack surface] SHOULD FIX.** The clear's second security property is
  that it stays DAEMON-UNREACHABLE: no event arriving on `subscribeModelList` may invoke it, so
  nothing the daemon says can steer which lists survive a pairing change. The design keeps it out of
  `modelListBridge.ts` entirely, and `modelListBridge.test.ts`'s `a connected edge neither writes nor
  clears the store` case already pins half of it. Phase B must not weaken this: the edit to
  `modelListBridge.ts` is tense-only prose and must change no code — no import of the clear, no
  `connected` branch, no new arm — and `npm test` on that spec is the check. No IPC channel,
  `contextBridge` API or `webPreferences` value is touched by this slice.
- **[Cryptographic primitives] Not applicable, with a reason.** No RNG, no key, no comparison against
  a secret. `conversationId` is an outbound routing key and not a nonce, and the clear does not
  compare it at all — being nullary, it has no comparison to make constant-time.
- **[Network & I/O] No findings; this slice improves the category.** A flooding relay can grow the map
  by one bounded entry per distinct conversation id (each frame already capped upstream by
  `MAX_PLAINTEXT_BYTES` inside `parseInboundMessage`, ahead of `decodeEnvelope`). This clear is the
  mechanism that returns that growth to zero at every pairing change — the bound between clears is
  distinct ids × frame cap rather than unbounded.
- **[Error messages, logs, telemetry] No findings.** Nothing on this path may be logged, and the clear
  is no exception — not even a content-free count of what was dropped, because both the store's and
  `clearPairingScopedState`'s no-diagnostic properties have to be total to be worth anything. Phase B
  adds no `console.*` and no logger import to either file. Note the measured-evidence trap the package
  overview records: the sibling argues its never-into-a-log clause from a measured `0x0a` across 51
  workspace-authored entries, and that MEASUREMENT does not transfer to this frame — the rule here
  rests on the contract instead (the daemon bounds and does not sanitize, so a control byte is
  permitted rather than excluded).
- **[Concurrency] SHOULD FIX, plus one OUT OF SCOPE.**
  - SHOULD FIX — the ordering rationale in `clearPairingScopedState`'s docblock names ONE effect that
    can throw (`clearAllLastRead`, the only one reaching `localStorage`), but there is a second path
    to the same disk write: `clearAllTimelines()` synchronously notifies #777's
    `useConversationLastRead` subscriber, which calls `recordLastRead` and persists. A throw from that
    write would abort every effect after `clearAllTimelines` — including this slice's clear and the
    two other clears of daemon-relayed text. My placement (after `clearAllSlashCommandLists`, before
    `clearAllLastRead`) inherits that exposure identically to its structural twin, and the plan's new
    ordering test pins only the constraint the ticket names. Moving pre-existing effects to close the
    wider gap is out of this ticket's scope and defends a failure nobody has observed; recorded here
    so the next reader of that docblock knows the "only one effect can throw" sentence understates the
    set, and so a future ticket can decide deliberately.
  - OUT OF SCOPE — an in-flight-event race. `ModelListData` is mounted app-level and never unmounts,
    so a `modelList` event emitted by the ended pairing but delivered after the clear would write one
    stale entry back. It applies identically to `slashCommandListStore` and `announcedModelStore`, is
    unobserved, and closing it needs a generation/epoch token on the daemon-event channel — a change
    to `src/shared/ipc/events` and `daemonConnection`, not to this store. Named here rather than
    half-defended with a store-local guard that would invent a second lifetime.
- **[Threat model alignment] No findings.** Hostile daemon: cannot steer which lists survive the
  boundary, because the clear is nullary and total — a whole-map clear is strictly safer here than a
  per-conversation one, which would introduce exactly the id-steerable path this signature forecloses.
  Renderer compromise reaching the transport: unchanged — this slice adds no capability, no socket and
  no key access, and everything it touches is renderer-local state. Hostile daemon response: still
  rejected upstream by #972's fail-closed narrower inside `daemonConnection`'s decode guard; this
  slice adds no second, weaker check. Malicious relay: addressed under Network & I/O above.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-03
