# #779 — Clear every last-read mark when the pairing ends

**Size:** S (confirmed; PO's label stands). Four production files, ~200 LOC total including tests.
No new files, no new exported types, ~3 call sites.

## Files to read first

| Path | What to extract |
|---|---|
| `src/renderer/src/store/conversationLastReadStore.ts:259-364` | The state shape, the store type (`ConversationLastReadStore`), `initialConversationLastReadState`, and `recordLastRead`'s **guard-then-persist-inside-the-updater** construction. `:355-362` is the shape the new clear copies. |
| `src/renderer/src/store/conversationLastReadStore.ts:127-147` | The `ConversationLastReadStorage` port. `:140-143` is #776's explicit refusal of a `clear()` method — the constraint this ticket must not re-open. |
| `src/renderer/src/store/conversationTimelineStore.ts:350` | `clearAllTimelines` — the one-line `size === 0 ? s : …` guarded clear. The nearest construction precedent, and the nullary-signature precedent (#757 AC3). |
| `src/renderer/src/store/conversationActivityStore.ts:95-104,226` | `clearAllActivity` — the family's naming convention (`clearAll…` for the whole-map blast radius) and the same guarded-clear body. |
| `src/renderer/src/clearPairingScopedState.ts` (whole file, 108 lines) | The helper this ticket extends. Note **every count word** in both docstrings (`:10`, `:54`, `:62`, `:69`, `:78`) — all say six and all move to seven. |
| `src/renderer/src/clearPairingScopedState.test.ts` (whole file, 205 lines) | The tripwire test at `:95-110`, `spyDeps()` at `:34-65`, and `realDeps()` at `:189-205`. All three take an edit here. |
| `src/renderer/src/PairedShell.tsx:93-100` | `clearPairingDeps` — the single wiring object both pairing-end call sites share. `:325-333` shows both call sites passing it. |
| `src/renderer/src/PairedShell.tsx:61-65` | `activateDeps.markViewed` — the already-documented precedent for reaching a store **directly** rather than through the last-read bridge. Its docstring is the argument this spec reuses. |
| `src/renderer/src/store/conversationLastReadBridge.ts:112-148` | `stampLastReadFor` and `subscribeConversationLastRead`. **The re-mint hazard in § Design lives here** — read the listener body, then read `clearPairingScopedState`'s call order. |
| `src/renderer/src/exitActiveConversation.ts:67` | The stale cross-reference `"FOUR clears, not clearPairingScopedState's six"`. |
| `src/renderer/src/store/conversationLastReadStore.test.ts:1-75` | The `fakeStorage()` helper at `:62-74`. Its docstring already names the AC2 test: *"a SECOND store over the same fake is a simulated restart."* |
| `docs/knowledge/decisions/0007-content-free-diagnostics-by-construction.md` | Why nothing on this path may be logged. |
| `docs/knowledge/features/paired-shell.md`, `docs/knowledge/features/conversation-last-read-store.md` | Current package overviews. **Read-only** — the documentation phase owns them. Do not edit either. |

## Design source

N/A — this slice renders nothing. Per the ticket body: #676 owns the unread dot and carries the Figma
reference. The visual-fidelity check is intentionally skipped.

## Context

`clearPairingScopedState` is the single "this pairing has ended" clear, called from both paths that end a
pairing (the unpair route flip and the pair-another-server transition, which keeps `PairedShell` mounted).
Its discriminator is *"does a reconnect to the SAME daemon need to clear it?"* — yes ⇒ the `connected` edge,
no ⇒ here. Last-read marks must survive a reconnect to the same daemon (that is the point of persisting them)
and must not survive a change of pairing, so they belong here.

This clear carries a hazard the existing six do not: `#776` persists the marks to `localStorage` under
`pyry.conversationLastRead`. Clearing only the in-memory slice leaves the previous pairing's marks on disk to
be re-hydrated at next launch — a failure that **looks correct in memory and is silent**. Reaching the
persisted bytes is what makes persisting the marks defensible at all.

Two seams, because the store has no clear path today: `ConversationLastReadStore` exposes `recordLastRead`
alone, and `conversationLastReadStore.ts:279-280` states outright that this ticket owns the clear.

## Design

### Seam 1 — `conversationLastReadStore.ts`: the store gains a nullary clear

Add one member to `ConversationLastReadStore` (an existing exported type; **no new exported type**):

```ts
export type ConversationLastReadStore = ConversationLastReadState & {
  recordLastRead: (conversationId: string, itemsSeen: LastReadMark) => void
  /** #779: the pairing-boundary clear. Nullary by design. */
  clearAllLastRead: () => void
}
```

**Name.** `clearAllLastRead`, matching `clearAllTimelines` (#757) and `clearAllActivity` (#749): the `All`
prefix puts the blast radius at the call site rather than only in the docstring.

**Nullary is a security property, not a signature detail** — the same one `conversationTimelineStore.ts:139-143`
spells out for `clearAllTimelines`. Taking no `conversationId` means no daemon-asserted id can steer which
marks survive the boundary; `tsc` enforces it rather than a test. Do not add an optional id parameter.

**Body — guard, then persist, then return, all inside the updater.** This is `recordLastRead`'s construction
(`:355-362`) reproduced, and the placement is load-bearing for the same stated reason: with all three inside
one expression, no future edit can hoist the write above the guard without deleting the guard.

- Guard: `if (s.marks.size === 0) return s`.
- Otherwise: `storage.write(initialConversationLastReadState.marks)`, then return
  `initialConversationLastReadState`.

Three properties, none of which is a type error, each of which gets a named test (§ Testing strategy):

1. **The guard must be `s.marks.size === 0`.** A reference check —
   `s.marks === initialConversationLastReadState.marks` — compiles clean and is *wrong on the common path*:
   after construction `s.marks` is whatever `storage.read()` returned, which for an empty store is a **fresh**
   `new Map()`, never the module constant. So a reference guard never fires on a clean install, and every
   unpair performs a redundant `localStorage.setItem`. `size` is the only correct test. (It also stays correct
   after a first clear, where `s.marks` *is* the constant — `size` is 0 either way.)
2. **The already-clear path returns `s` itself**, not the constant. Returning the state object makes zustand's
   own `Object.is` short-circuit fire, so no subscriber wakes at all — the `clearAllTimelines` property
   `clearPairingScopedState.test.ts:181` already asserts with `toBe`. Returning the constant would merge and
   notify.
3. **The cleared path returns `initialConversationLastReadState`**, the named baseline, not a fresh
   `{ marks: new Map() }`. That is the `clearActiveConversation` / `clearSessionId` posture
   (`activeConversationStore.ts:55`, `sessionIdStore.ts:72`), and it gives `marks` a stable reference across
   repeated clears. Zustand shallow-merges, so `recordLastRead` and `clearAllLastRead` survive on the state.

**The persistence route is already decided — do not re-open it.** `conversationLastReadStore.ts:140-143`
(#776) refuses a `clear()` on the `ConversationLastReadStorage` port because `write(new Map())` already serves
this ticket: `encodeLastReadMarks(new Map())` is `'[]'`, and `decodeLastReadMarks('[]')` round-trips to an
empty map. Adding a port method, a `removeItem` path, or a `localStorage.removeItem` call here would ship the
unused seam #776 declined. The key stays present on disk holding `'[]'`; a present-but-empty blob and an
absent one both hydrate to empty, so the two are indistinguishable to every consumer.

Passing `initialConversationLastReadState.marks` (rather than a fresh `new Map()`) to `storage.write` names
the same baseline in both halves of the expression. The port's parameter is `ReadonlyMap` and the encoder
only reads it via `Array.from`, so the constant cannot be mutated through it.

### Seam 2 — `clearPairingScopedState.ts`: the seventh effect, and its one ordering constraint

Add `clearAllLastRead: () => void` to `ClearPairingScopedStateDeps` and one call to the body.

**Placement is NOT free, and this is the sharpest thing in the ticket.** The helper's docstring currently
claims *"No ordering constraint among the six"* (`:78`). With the seventh effect that claim becomes **false**,
and getting it wrong is a silent, on-disk failure of AC1 and AC2 both.

The chain: `useConversationLastRead` (#777, mounted in `PairedShell`) subscribes to
`conversationTimelineStore`. `clearPairingScopedState`'s second effect, `clearAllTimelines()`, is a real state
change whenever any thread is retained, so it **notifies that listener synchronously, from inside the helper**.
At that instant `clearActiveConversation()` has not yet run, so `getOpenConversationId()` still returns the
conversation the operator was in; `getTimelineFor(id)` now returns `null` (just cleared); and
`stampLastReadFor` therefore calls `recordLastRead(oldId, 0)` — **re-minting a mark for the ended pairing's
conversation and persisting `[["oldId",0]]` to `localStorage`**.

So:

> **`deps.clearAllLastRead()` MUST be called after `deps.clearAllTimelines()`, and it goes LAST in the body
> — after `dispatchSession({ type: 'reset' })`.**

Everything else keeps its current order; the new call is appended. The re-minted mark is wiped, in memory and
on disk, before the helper returns, and nothing between `clearAllTimelines()` and the end re-fires the
subscription: the flat `dispatchTimeline({ type: 'reset' })` targets `timelineStore`, which this bridge does
**not** subscribe to (`conversationLastReadBridge.ts:207`), and none of `clearActiveConversation` /
`clearSessionId` / `clearAnnouncedModel` / `dispatchSession` touches `conversationTimelineStore`. By the time
the new call runs, `clearActiveConversation()` has also already run, so no further re-mint is even reachable.

**Why last rather than adjacent to `clearAllTimelines`** — this position was chosen by the security pass
(§ Security review, finding 7) and is not cosmetic. Six of the seven effects are pure in-memory store writes
that cannot throw. `clearAllLastRead` is the only one with an external side effect (`localStorage.setItem`)
and therefore the only one that can. Placed mid-body, a throw from it would abort every clear after it —
including `clearSessionId`, whose clear is the documented security payload that renders the Run configuration
controls inert (`RunConfigSections.tsx:322,333-338`), and `dispatchSession`'s reset. That would leave server
A's session id live and addressable while the operator is on server B. Placed last, a throw aborts nothing.
This is a placement choice, not a defence: it costs no code and adds no handler for an unobserved failure.

Adjacency to `clearAllTimelines` would have read well on its own terms — a mark is a sampled count of a keyed
timeline's items, so the two are one fact against two stores — but the throw-ordering above outranks
legibility. Say so in the docstring so the next reader does not "tidy" it back up next to its sibling.

**Considered and rejected:** hoisting `clearActiveConversation()` to the top of the body, which would make
`getOpenConversationId()` return `null` and remove the re-mint entirely rather than cleaning up after it. It is
structurally tidier and buys no additional correctness, and it reorders pre-existing lines this ticket was not
asked to touch (CLAUDE.md — don't refactor adjacent code while you are there). Record it in the docstring as
the rejected alternative so a later ticket finds it answered.

**Docstring edits.** Every count word moves from six to seven: `:10` (the effect list — add the new bullet),
`:54` ("Five of these six stores latch" → six of these seven), `:62` ("the sixth" → the seventh, for the
session store), `:69` ("All six clears are idempotent"), `:78` (the no-ordering-constraint sentence, which
must now state the one constraint above and why). Also extend `:69-76`'s idempotence paragraph: the new clear
is idempotent by the same by-reference construction, but unlike the other six it has a **side effect** to
suppress, which is why it carries an explicit guard where they do not.

**Nothing is logged.** A diagnostic here would carry the conversation id, which ADR 0007 forbids, and there is
no observed failure to instrument. This matches the store, the bridge and the helper, all three of which are
log-free by construction.

### Seam 3 — `PairedShell.tsx`: one line in `clearPairingDeps`

Add to the module-level `clearPairingDeps` object (`:93-100`), reaching the singleton through `getState()`
inside the arrow body so nothing is dereferenced at module load and `PairedShell` stays server-renderable:

```ts
clearAllLastRead: () => conversationLastReadStore.getState().clearAllLastRead()
```

Add the `conversationLastReadStore` import from `./store/conversationLastReadStore` (the file currently imports
only from `./store/conversationLastReadBridge`).

**Direct to the store, not through `conversationLastReadDeps`.** The bridge's deps object exists so the
*sampling branch* in `stampLastReadFor` lives in one tested place. There is no sampling branch here — the
store method takes nothing at all. `activateDeps.markViewed` (`:61-65`) already makes exactly this argument in
this file for exactly this reason, and widening `ConversationLastReadDeps` with a member the stamp path never
uses would put an unused effect on a tested interface.

Both call sites (`onUnpaired` at `:325-328`, `onPairServerPaired` at `:330-333`) pass this one object, so this
single edit covers AC3 with no call-site change. `onPairServerCancelled` stays unwrapped — cancelling out of
pair-another ends no pairing.

### Seam 4 — `exitActiveConversation.ts:67`: the stale cross-reference

`"FOUR clears, not clearPairingScopedState's six"` → seven. Comment-only, one line. The paragraph's substance
is unchanged and correct: the marks are pairing-scoped, not conversation-scoped, so they do **not** join
`exitActiveConversation`'s set. A conversation being deleted or archived leaves the operator's other chats live
and their marks meaningful; extend the "Stores deliberately left OUT" list at `:80-85` with
`conversationLastReadStore` and that one-sentence reason, so the next ticket need not re-litigate it.

## State + concurrency model

- One store slice (`conversationLastReadStore.marks`), one new whole-value write path. Unidirectional is
  preserved: the store owns the write, `PairedShell` dispatches, nothing two-way-binds.
- **Fully synchronous.** `set` runs its updater once, synchronously, under zustand's own store lock, and
  `localStorage.setItem` is synchronous. There is no `await` anywhere on this path, so the guard's
  check-then-act has no suspension point a concurrent handler can interleave into, and no observer on the
  renderer's single thread can see a half-cleared set. React batches all seven effects into the commit that
  carries the route change.
- **Re-entrancy is bounded and accounted for** — see the ordering constraint in Seam 2. `clearAllLastRead`
  writes a store nothing subscribes back into, so it cannot re-trigger anything.
- No async task, no timer, no teardown, no `AbortController`, no IPC. Nothing to cancel on window close.

## Error handling

There is no failure mode to surface. The clear is total: no gate, no return value, no throw path.

- `storage.write` is deliberately **not** wrapped in try/catch. `localStorageConversationLastRead`
  (`:246-257`) already refuses a defensive catch on the ground that a quota/disabled failure is unobserved in
  the Electron renderer; adding one here would be a defence for an unobserved failure. If it ever surfaces, the
  fix is localized in the port.
- The window guard in the real port makes `write()` a no-op under `node`/`renderToStaticMarkup`, so the clear
  is import-safe and server-render-safe with no extra handling.
- Nothing reaches the UI. No banner, no dialog, no toast — the operator is mid-navigation to a new pairing.

## Testing strategy

All tests are plain vitest under `environment: 'node'`. No DOM, no jsdom, no React effects, no Playwright.
Interaction is out of scope because nothing here is interactive.

### `src/renderer/src/store/conversationLastReadStore.test.ts` (new cases, existing `fakeStorage()`)

- **AC1, in memory.** Seed `fakeStorage` with two marks, construct, `clearAllLastRead()`, assert
  `marks.size === 0` and `selectLastReadFor` returns `null` — not `0` — for both ids.
- **AC2, the simulated restart.** Same seeded store, clear it, then construct a **second** store over the
  **same fake** and assert its `marks` are empty. This is the "restart" the fake's own docstring names, and it
  is the only test that proves the clear reached the persisted bytes rather than the in-memory slice alone.
- **AC2, the persisted payload.** Assert `storage.write` was called once with an empty map. Optionally pin
  `encodeLastReadMarks` of that argument as `'[]'` to tie the round trip to the format the decoder accepts.
- **AC4, no redundant write — the reference-guard trap.** Construct over an **empty `fakeStorage()`** (not
  over a seeded one, and not by clearing first), call `clearAllLastRead()`, assert `storage.write` was
  **never** called. A `s.marks === initialConversationLastReadState.marks` guard fails exactly here and
  nowhere else.
- **AC4, no subscriber churn.** Over the same empty store, capture `store.getState()` before, clear, assert
  `toBe` the same object. Optionally attach a `vi.fn()` via `store.subscribe` and assert zero calls.
- **AC4, the second clear.** Seed, clear (write count 1), clear again, assert write count is still 1 and the
  state object is unchanged by the second call.
- **Hostile keys survive the clear.** Seed marks under `'__proto__'`, `'constructor'` and `''`, clear, and
  read all three back as `null` — the module's `ReadonlyMap` property must hold across the clear as it does
  across the write.
- **The clear does not mutate the previously held map.** Capture `marks` before, clear, assert the captured
  map still reads as it did — the load-bearing form for this store, since the identity assertion the
  object-holding precedents use is degenerate over numbers.

### `src/renderer/src/clearPairingScopedState.test.ts` (existing cases, extended)

- **Update `spyDeps()`** with a seventh `clearAllLastRead` spy, **update the "exactly these" assertion** at
  `:102-109` to the seven-key sorted list, and **assert the new spy called once with no arguments**
  (`toHaveBeenCalledWith()`) — the call-side half of the nullary property, mirroring the `clearAllTimelines`
  assertion at `:87`. Updating this pin is expected; weakening it (dropping the key list, loosening to
  `arrayContaining`) is not.
- **Update `realDeps()`** to take a `createConversationLastReadStore()` instance and wire the seventh effect.
- **Extend the real-stores AC1 case** — seed marks, run the helper, assert the marks store is empty.
- **Extend the already-clear case** — assert the marks store's state object comes back by reference.
- **NEW — the ordering constraint (the re-mint regression).** The one case that catches Seam 2 getting it
  backwards. Wire the real #777 listener without React: call `subscribeConversationLastRead((l) =>
  keyedTimelines.subscribe(l), deps)` where `deps` is a `ConversationLastReadDeps` built from the same
  isolated stores the case already constructs (`getOpenConversationId` off the active-conversation store,
  `getTimelineFor` off the keyed timeline store, `recordLastRead` off the marks store). Seed an active
  conversation, a keyed timeline slice for it, and a mark. Run `clearPairingScopedState`. Assert the marks
  store is empty **and** the fake storage's final value is empty. With `clearAllLastRead` placed before
  `clearAllTimelines`, this fails with a `(id, 0)` entry in both.
  - This is deliberately an integration case in this file rather than a store case: the interaction is between
    two stores and one subscription, and neither module can see it alone. It is also the only place the
    hazard is reachable at all, since `vitest.config.ts` never runs the `useEffect` that mounts the listener
    in production.

### Type-level

`npm run typecheck` covers the tripwire's first half — a seventh dep on `ClearPairingScopedStateDeps` fails to
compile against the test's deps literal and against `clearPairingDeps` until both are updated. `npm run build`
is the salvage gate.

## Open questions

None blocking. Two decisions are recorded above as closed rather than open, so they are not re-litigated
during implementation:

1. **Port `clear()` vs `write(new Map())`** — closed upstream by #776 (`conversationLastReadStore.ts:140-143`).
   `write(empty)` it is.
2. **Bridge deps vs direct store access in `clearPairingDeps`** — closed by the `markViewed` precedent in the
   same file (`PairedShell.tsx:61-65`). Direct it is.

## Security review

**Verdict:** PASS (second pass — the first pass returned FAIL on finding 7; § Design was revised and the
checklist re-run from the top)

**The asset.** Server A's read state, at rest under `pyry.conversationLastRead`. Conversation ids are scoped
to the server that issued them, so a mark surviving a re-pair could be keyed under an id server B later
reuses — the same cross-server misattribution `clearAllTimelines` closes for retained threads
(`conversationTimelineStore.ts:139-143`). The clear is the enforcement, and it is the counterweight that made
persisting the marks defensible at #776 in the first place.

**Findings:**

- **[1 Trust boundaries] No findings.** The new clear takes **no arguments**, so no untrusted value is an
  input to it; the only untrusted data it touches is the set of `Map` keys it discards wholesale. The nullary
  signature is the `tsc`-side enforcement (`ConversationLastReadStore`) and
  `expect(clearAllLastRead).toHaveBeenCalledWith()` is the call-side half — the identical pair #757 uses for
  `clearAllTimelines`. The existing untrusted-input boundary is `decodeLastReadMarks`
  (`conversationLastReadStore.ts:212-232`), a single named function, and this ticket does not touch it. The
  value written back is the client-owned constant `'[]'`, which carries no id.

- **[2 Tokens, secrets, credentials] Not applicable — and one policy point worth recording.** A last-read
  mark is an integer, a client-side fiction with no daemon counterpart; nothing here is a token, key or
  credential, so generation, entropy, rotation, revocation and expiry are all vacuous. The category is
  relevant only in the negative direction: `localStorage` is rejected on sight for tokens, and the marks are
  in `localStorage` precisely because they are *not* secrets. #776 accepted that placement **conditional on
  this clear existing** — this ticket discharges the condition. `conversationActivityStore.ts:51-53` refuses
  persistence for its own store on the same axis ("web storage would survive the pairing boundary"); the
  difference is that this store now has a boundary clear and that one does not.

- **[3 File / storage operations] One finding, SHOULD FIX (deferred by AC4 — see below).**
  - *Path traversal: no findings.* No path is built. One **fixed** client-owned key
    (`CONVERSATION_LAST_READ_KEY`) holds the whole map; the untrusted id is a JSON array element on disk and a
    `Map` key in memory and an object/storage key nowhere. The clear touches only that same fixed key, so
    #776's structural property is preserved rather than re-derived.
  - *Torn write: no findings, and the clear is strictly the safest write on this path.* Chromium flushes
    `localStorage` asynchronously, so a hard kill can truncate a value. Every truncation of `'[]'` — `'['` or
    `''` — is rejected by `decodeLastReadMarks` to an empty map, which is the intended post-clear state
    anyway. The clear cannot leave a partially-cleared readable blob.
  - *Data remanence — SHOULD FIX, deferred.* If the blob on disk is **corrupt** (hand-edited, or torn by a
    kill mid-write of a real map), it hydrates to an empty map, so `s.marks.size === 0`, so the AC4 guard
    fires and `storage.write` is never called — and server A's ids **remain on disk as inert bytes** across
    the re-pair. AC2 still holds literally (nothing from the previous pairing is *hydrated*), and the
    attacker who could read those bytes afterwards could already read them before the unpair, so this does
    not widen exposure — but it does mean the clear is not an erasure guarantee in that one case. Not fixed
    here because the only fix is an unconditional write, which AC4 explicitly forbids ("performs no redundant
    persistence write"), or a port `removeItem`, which #776 explicitly declined
    (`conversationLastReadStore.ts:140-143`). **Flagged for the operator, not silently overridden:** if
    erasure semantics are wanted rather than no-hydration semantics, that is an AC4 change and belongs in its
    own ticket. Developer: implement AC4 as written.
  - *Encryption at rest, atomic rename, userData scoping, TOCTOU:* not applicable — no secret, no file
    handle, no `fs` call, no check-then-open.

- **[4 Inter-process / Electron attack surface] No findings.** The ticket adds no IPC channel, no
  `contextBridge` API, no `ipcMain` handler, no `BrowserWindow` config, no custom protocol, no navigation
  guard change. Process placement is untouched: nothing here reaches a key, a socket or the Noise session,
  and the one new import into `PairedShell.tsx` (`conversationLastReadStore`) transitively imports only
  zustand. The clear is pure renderer state plus web storage, which is exactly where a client-side fiction
  belongs.

- **[5 Cryptographic primitives] Not applicable.** No RNG, no hash, no KDF, no AEAD, no Noise, no nonce. The
  only comparison the new code performs is `s.marks.size === 0`, an integer against a literal — not a
  comparison against a secret, so `timingSafeEqual` does not apply and `===` is correct here.

- **[6 Network & I/O] No findings, and one property worth stating explicitly.** No socket, URL, frame,
  TLS setting, timeout or reconnect. More usefully: **no wire arm can invoke this clear.** It is reachable
  only from the two operator-driven pairing-end transitions, so a hostile relay cannot drive it at all —
  neither to churn `localStorage` writes nor to destroy the operator's read state. Nor can a relay *suppress*
  it in a way that leaves the app in a mixed state: `runUnpair` calls `onUnpaired` only on `result: 'ok'`
  (`unpairAction.ts:61-64`), so a dropped or delayed unpair fails closed — the operator stays on server A,
  and their marks stay valid.

- **[7 Error messages, logs, telemetry] MUST FIX — found on the first pass, fixed in § Design; no residual.**
  - *The finding:* `clearAllLastRead` is the **only** one of the seven effects with an external side effect,
    and therefore the only one that can throw (`localStorage.setItem` under a quota or disabled-storage
    failure). The first draft placed it mid-body, immediately after `clearAllTimelines()`. A throw there
    would abort every subsequent clear — `clearActiveConversation`, `clearSessionId`, `clearAnnouncedModel`
    and `dispatchSession` — leaving server A's **session id live and addressable** while the operator is on
    server B, which is precisely the "inert beats addressing a YOLO write to a session on the daemon you just
    left" payload that three files document. Partial completion of a security clear is worse than the
    unavailability the throw itself causes.
  - *The fix:* move the call to **last** in the body. A throw then aborts nothing. This costs no code and
    adds no try/catch, so it does not ship a defence for an unobserved failure — it is a free ordering
    property, the deterministic half of the belt-and-suspenders pair.
  - *Logging: no findings.* No `console.*` on any branch, matching the store, the bridge and the helper. A
    diagnostic here could carry only the untrusted id or the raw blob containing it, which ADR 0007 forbids,
    and the renderer console is readable by anything that can open DevTools. The guard path and the write path
    are silent **by design**, not swallowed errors. No error text reaches the UI, and no exception message on
    this path can contain an id (`JSON.stringify([])` cannot throw; a `QuotaExceededError` names no key
    contents).

- **[8 Concurrency] One finding, resolved in § Design as a hard ordering constraint with a named test.**
  - *The re-mint (Seam 2).* This is a concurrency finding as much as a correctness one: `clearAllTimelines()`
    synchronously **re-enters** the #777 subscription from inside the helper, at a moment when
    `clearActiveConversation()` has not yet run, so `stampLastReadFor` re-mints `(server-A-id, 0)` into the
    map **and flushes it to disk**. Ordered wrongly, the persisted artifact would contain an id from the
    machine the operator just left, surviving a restart, with every in-memory assertion still green — the
    exact silent-and-looks-correct shape the ticket's own security note warns about. Enforcement is the
    ordering constraint plus the dedicated regression case in `clearPairingScopedState.test.ts` that wires
    `subscribeConversationLastRead` against real isolated stores; without that case the hazard is
    unreachable in this repo's test tiers, since `environment: 'node'` never runs the `useEffect` that mounts
    the listener in production.
  - *Check-then-act: no findings.* Guard, persist and return are one synchronous expression inside the zustand
    updater under the store lock, with no `await` — no suspension point for a concurrent handler, and no way
    for a later edit to hoist the write above the guard without deleting the guard.
  - *Async ownership, cancellation, listener leaks, duplicate connections: not applicable.* The ticket adds no
    task, timer, listener or socket, and removes none. Shutdown mid-write is covered under category 3.

- **[9 Threat model alignment] No findings; residuals named.**
  - *Malicious / compromised relay* — cannot invoke, suppress-into-a-mixed-state, or steer this clear (see
    category 6). Nullary means it cannot choose which marks survive.
  - *Token theft from disk* — no token exists; the disk-read threat that does apply is data remanence, and it
    is finding 3 above.
  - *Hostile daemon response* — nothing is parsed on this path; the decode boundary is pre-existing and
    untouched.
  - *Renderer compromise reaching the transport* — unchanged. A compromised renderer could suppress the
    clear, but it can already read the marks directly, so this ticket neither widens nor narrows that.
  - *Hostile-key surface* — re-asserted rather than assumed. The map stays a `ReadonlyMap`; the clear
    introduces no computed object key, no `Object.fromEntries`, no object spread of a `Map`, no
    `JSON.stringify` of a `Map`. `'__proto__'`, `'constructor'` and `''` stay three unremarkable keys, and a
    named test asserts they read back `null` after the clear.
  - **OUT OF SCOPE, named:** the #777 subscription persists on every changed item count, so a relay flooding
    frames into the *open* conversation drives one synchronous `setItem` per changed count. That is shipped
    #777 behaviour, not introduced here, and the store's own sizing analysis
    (`conversationLastReadStore.ts:57-73`) covers the growth half. No ticket is open for it and none is
    proposed — no such failure has been observed. The pairing gate that decides when
    `onPairServerPaired` fires is likewise out of scope (owned by the pairing-payload-gate work).

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-27
