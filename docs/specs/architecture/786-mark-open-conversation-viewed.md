# #786 — Stamp the conversation the operator opens as most recently viewed

**Size:** S (PO's `size:s` confirmed — 3 production files, ~200 LOC total, 0 new files, 0 new exported types, 3 deps-construction sites)
**Labels:** `security-sensitive` — see § Security review at the end.

## Design source

N/A — no `## Figma` section in the ticket body, and correctly so: this ticket adds no markup, no style and no
rendered value. Its whole observable is the iteration order of a `ReadonlyMap` that nothing renders from yet
(#758 is the reader cutover). The visual-fidelity check is intentionally skipped.

## Files to read first

- `src/renderer/src/activateConversation.ts:29-51` — `ActivateConversationDeps`. The **required-field + cross-wire-note** idiom #777 established for `stampLastRead`; the sixth member copies its shape exactly.
- `src/renderer/src/activateConversation.ts:86-104` — the function body. Where the id-change gate is, and the comment at `:98-102` explaining why `stampLastRead` sits **outside** it.
- `src/renderer/src/PairedShell.tsx:49-61` — `activateDeps`. The **one** production construction site; the `getState()`-inside-the-arrow-body idiom that keeps the container server-renderable.
- `src/renderer/src/PairedShell.tsx:80-95` — `exitConversationDeps` / `clearPairingDeps`. `conversationTimelineStore` is already imported (`:31`) and already reached this exact way at `:83` and `:90` — copy that line shape verbatim; no new import.
- `src/renderer/src/store/conversationTimelineStore.ts:14-18` — the header sentence this ticket falsifies. Correcting it is in scope.
- `src/renderer/src/store/conversationTimelineStore.ts:160-192` — THE EVICTION INVARIANT and its security paragraph. Read `:183-187` carefully: this ticket makes one sentence there untrue. See § Security review.
- `src/renderer/src/store/conversationTimelineStore.ts:255-293` and `:317-327` — `markViewed`'s three branches, its no-churn guard, and the create-on-absent rationale AC2 rests on. `:279` carries the second stale pointer.
- `src/renderer/src/store/conversationLastReadBridge.ts:91-115` — `stampLastReadFor`. Its docstring at `:95-98` names #786 by number and states why the two seam-mates are order-independent as to the value recorded.
- `src/renderer/src/store/conversationLastReadBridge.ts:117-148` and `:203-212` — `subscribeConversationLastRead` / `useConversationLastRead`. This is the subscriber `markViewed` newly wakes; the ordering rule below is derived from it.
- `src/renderer/src/store/conversationLastReadStore.ts:355-362` — `recordLastRead`'s `===` guard, placed **ahead of** `storage.write`. This is why the newly-woken listener costs neither a subscriber wake nor a `localStorage` write.
- `src/renderer/src/activateConversation.test.ts:36-60`, `:109-129`, `:213-244` — `spyDeps`, the effect-order test, and `realDeps`. The three existing places to extend; do not restructure them.
- `src/renderer/src/store/conversationTimelineStore.test.ts:181-261` and `:324-340` — the store-level eviction and no-churn tests. Read these to know what **not** to re-assert (see § Testing strategy).
- `src/renderer/src/store/conversationCreatedBridge.ts:52-95` — the ungated daemon-event path into `activateConversation`. Load-bearing for the security review, not for the code.
- `CLAUDE.md` § Build and test — renderer tests are `renderToStaticMarkup` under `environment: 'node'`. There is no DOM, no effect and no click in this repo's unit tier. Nothing in this ticket needs one.

## Context

`conversationTimelineStore` retains one whole timeline per conversation, bounded at `MAX_RETAINED_TIMELINES = 10`
and evicted **least recently viewed**. The word "viewed" is enforced by exactly one write path — `markViewed(id)`,
the only path that can move a key to the map's tail — and that path **ships with no production caller**
(`conversationTimelineStore.ts:16-18`; the only callers in the tree are the store's own tests).

Until something calls it, every slice is never-viewed, the map's iteration order is pure creation recency, and
eviction silently degrades to first-write order. That discards exactly the thread the operator stepped away from
— the failure the word "viewed" exists to prevent. There is no type error and no failing test on `main` to catch
it, because the store's own eviction tests drive `markViewed` directly and all pass today.

This ticket adds the one production call site. It is also what **arms the bound in production** for the first
time: today's degraded ordering is not a latent bug that happens to be unreachable, it is the shipped behaviour.

## Design

One new injected effect, one new call, one new wiring line, three stale comments corrected. No new file, no new
exported type, no new import in `PairedShell.tsx` (`conversationTimelineStore` is already imported at `:31`).

### 1. `ActivateConversationDeps` gains a sixth member

```ts
/** #786: stamp the conversation being opened as the most recently viewed one — conversationTimelineStore's
 *  markViewed. REQUIRED, not optional. */
markViewed: (conversationId: string) => void
```

**Required, never optional.** The single production construction site (`PairedShell.tsx:49-61`) means a required
field costs no edit cascade, and it makes "forgot to wire it" a compile error under `npm run typecheck` rather
than a silent `undefined`. This is the only deterministic guard available: `activateDeps` is module-private and
unexported, `vitest.config.ts` is `environment: 'node'` globally so no test in this repo ever runs a React
effect, and the wiring is therefore structurally uncoverable by test. `tsc` is the safety net, and it is
deterministic code rather than a second stochastic reviewer.

**The docblock must carry a cross-wire note**, mirroring the one `stampLastRead` already carries at `:44-48`, and
the hazard is sharper this time. `markViewed` and `stampLastRead` now have **identical** signatures
(`(conversationId: string) => void`), so swapping them at a deps site compiles and — at spy level — every
`toHaveBeenCalledWith(conversation.id)` assertion still passes for both. What catches a swap is that the two
land in **different stores**: in `realDeps` the union of #777's two existing mark tests (`:177`, `:194`) and this
ticket's AC1 tests fails on a swap, because one store ends up empty and the other unmarked. State that in the
docblock and rely on it; do not invent branded types for a two-member wiring object.

Residual, named honestly: a swap inside `PairedShell.tsx`'s `activateDeps` is not covered by any test. It is
defended by the two arrow bodies being visibly different (`conversationTimelineStore.getState().markViewed(id)`
vs `stampLastReadFor(conversationLastReadDeps, id)`) and by the member name matching the store method name
exactly. No further machinery — the failure has not been observed, and the cost of a swap is degraded eviction
ordering, not a correctness or safety break.

### 2. The call goes OUTSIDE the id-change gate, LAST

```
previous = getActiveConversation()
if (previous?.id !== conversation.id) { dispatchTimeline({type:'reset'}); clearSessionId() }
setActiveConversation(conversation)
stampLastRead(conversation.id)      // #777, unchanged
markViewed(conversation.id)         // #786, new — outside the gate, last
```

**Why outside the gate.** The ticket calls this a design call; it is decided here, and the deciding fact is in
the store rather than in taste. `markViewed`'s first branch — "ALREADY THE MOST RECENTLY VIEWED (the tail) →
the state object itself, no churn" — is documented at `conversationTimelineStore.ts:274-276` as **the common
case, not an edge one**, justified by exactly this seam: "`onOpen` fires for every row click including a
re-click of the already-active row". Inside the gate, that branch becomes **unreachable**: `markViewed` would
only ever run when the id actually changed, and after a real switch the tail is always the *previous*
conversation, never the one being opened. That would leave a shipped, tested branch dead and its docstring
false. Outside the gate is also free (the guard returns the state object, no map cloned, no subscriber woken —
that is AC3) and self-healing: it does not depend on the unenforced invariant "the active conversation is always
the tail".

**Why after `setActiveConversation`.** This is the one real ordering constraint and it is not cosmetic.
`markViewed` can **create** a slice, and creating one notifies `conversationTimelineStore`'s subscribers —
among them #777's `useConversationLastRead`, which reads `getOpenConversationId()` and re-stamps that
conversation. Running `markViewed` before the set would fire that listener while the **previous** conversation
is still open, writing an unrequested mark for it. After the set, the listener stamps the conversation just
opened with the count it just sampled — identical to what `stampLastRead` wrote a line earlier, so
`recordLastRead`'s `===` guard (`conversationLastReadStore.ts:357`) returns the state object, wakes nobody, and
performs no `storage.write`. The chain terminates at depth 2, synchronously, with no `await` anywhere.

**Why after `stampLastRead` specifically.** Nothing forces it, and that is the point: `stampLastReadFor` takes
the id explicitly and never reads the open conversation, precisely so that #786's placement cannot affect it
(`conversationLastReadBridge.ts:95-98` says so, naming this ticket). Both orders record the same mark — an
absent slice and a present empty slice both map to `0`. Appending rather than inserting is chosen because it
leaves #777's line and its comment byte-unchanged and turns the existing effect-order test into an append.

### 3. `PairedShell.tsx` — one line in `activateDeps`

```ts
markViewed: (conversationId) => conversationTimelineStore.getState().markViewed(conversationId)
```

Same `getState()`-inside-the-arrow-body shape as `clearTimelineFor` at `:83` and `clearAllTimelines` at `:90`.
Nothing is dereferenced at module load, nothing is read during render, the object closes over no per-render
value, and `PairedShell` still subscribes to no store and stays server-renderable. No new import.

Unlike `stampLastRead`, this one reaches the store **directly** rather than through a bridge's production wiring
object: there is no sampling branch to keep in one tested place — the store method takes the id and nothing else.

### 4. Comment corrections (in scope, not adjacent refactoring)

Three sentences make the same claim — that #758 wires `markViewed` — and this ticket makes all three false.
#758 now depends on this ticket rather than performing it.

| Site | What is false | Correction |
|---|---|---|
| `conversationTimelineStore.ts:16-18` | "`markViewed` is the one path still shipping unwired; #758 wires it at the switch seam (activateConversation.ts:74-77) … Until then every slice is never-viewed" | #786 wires it at the activation seam; #758 remains the reader cutover. The "until then" consequence is now history, not current state. |
| `conversationTimelineStore.ts:279` | "at the #758 seam the operator opens a conversation BEFORE any event for it has arrived" | Same sentence, `#786` seam. This is the load-bearing rationale for the create-on-absent branch AC2 depends on, so a reader must land on the ticket that actually exercises it. |
| `conversationTimelineStore.ts:183-187` | "ONLY THE OPERATOR CAN MOVE A KEY TO THE TAIL — `markViewed` … reachable only from the operator's own activation. The protected region is populated by operator action alone." | Falsified by this ticket. See § Security review — the correction is required and its wording is specified there. |

Also correct `conversationTimelineStore.test.ts:240` ("The #758 seam") — the same fact, one token, in the file
whose test that comment explains. This is the only edit to that file (see § Testing strategy).

**Out of scope, deliberately:** `docs/knowledge/features/conversation-timeline-holder.md:192` ("Dormant until
#758. `markViewed` has no caller yet") and its siblings under `docs/knowledge/`. Those are owned by the
documentation phase, which folds this ticket's lessons in after code review. Do not edit them. The other `#758`
references in `conversationTimelineStore.ts` (`:362`, `:365`, `:385`) stay — all three are about the **reader**
cutover and remain true.

## State + concurrency model

Renderer-local and fully synchronous throughout. No IPC, no async task, no timer, no teardown, no new
subscription. `activateConversation` runs on the renderer's single thread with no `await` between its reads and
its writes, so the check-then-act on `previous?.id` cannot interleave.

One new synchronous cascade, walked in full:

```
markViewed(id)
  → conversationTimelineStore.set(...)            (zustand reassigns state, THEN notifies)
    → useConversationLastRead's listener
      → stampLastReadFor(deps, openConversationId)
        → recordLastRead(id, count)                (a DIFFERENT store — no re-entrancy)
          → `===` guard hits, returns the state object; no write, no notify
```

Depth 2, terminating, no re-entrancy (the write targets a different store than the one subscribed —
`conversationLastReadBridge.ts:40-41` already states this property). Zustand's vanilla `setState` reassigns state
before calling listeners, so the listener's read-back sees the value just written.

**Re-render impact: none, by audit.** `markViewed` creating a slice where none was held changes what
`selectTimelineFor(id)` returns from `null` to a present empty slice. The production readers of that selector
are exactly two, and neither changes behaviour:

- `conversationLastReadBridge.ts:171-172` (`getTimelineFor`) — `stampLastReadFor` maps `null` and an empty slice
  onto the same honest count, `0`.
- `ConversationScreen.tsx:1947` — imports `useConversationTimelineStore` but selects only `s.dispatchFor`, a
  write path. It renders from the flat `timelineStore`, untouched by this ticket.

So this ships as a **no-op from the operator's side** except for the one thing it exists to change: eviction
ordering.

## Error handling

No failure modes are added. `markViewed` is total — no return value, no throw path, no result type. A miss and an
eviction are both silent by design (`conversationTimelineStore.ts:67-68`), not swallowed errors. Nothing is
surfaced to the UI, because nothing the operator can see changes.

Log-free by construction: no `console.*` on any new path. The only values in scope on this path are a
daemon-asserted `conversationId` and, one frame down, assistant message text — ADR 0007's content-free
diagnostics rule keeps both out of a file, and the renderer console is readable by anything that can open
DevTools.

## Testing strategy

`npm test` (vitest) and `npm run typecheck`. No new test file: everything lands in
`src/renderer/src/activateConversation.test.ts`.

**The binding constraint, restated from the ticket:** every criterion is about the **wiring**. Each new test must
drive through `activateConversation(deps, conversation)` and must **never** call
`store.getState().markViewed(...)` directly. The store's eviction policy is already proven at store level and
those tests pass on `main` — `conversationTimelineStore.test.ts:181` is AC4's shape invoked directly, `:236` is
AC2's, `:324` is AC3's. Re-asserting them against `markViewed` would leave this ticket green with zero
production call sites added. **Each new test must fail on `main`**; where a criterion is negative (AC3), the test
must carry a positive precondition that fails on `main` so the file does.

Extend the three existing helpers, do not restructure them:

- `spyDeps` (`:36-60`) — add a `markViewed` spy, returned alongside the others.
- `realDeps` (`:217-244`) — wire `markViewed` to the already-threaded `timelines` store's real method. This is
  what makes the cross-wire with `stampLastRead` catchable (§ Design 1).
- the effect-order test (`:109-129`) — append `'markViewed'`, giving
  `['reset', 'clearSessionId', 'set', 'stamp', 'markViewed']`.

New scenarios, as bullet points — the developer writes them in the file's existing idiom:

- **AC1, spy level, outside the gate.** Extend the existing "same id clears nothing" test (`:89`): assert
  `markViewed` was called exactly once **with `next.id`**, beside the identical `stampLastRead` assertion. Never
  a bare `toHaveBeenCalled()` — the argument is what survives a cross-wire. Fails on `main` (never called).
- **AC1, no retained timeline.** With real stores and an empty timeline map, activate `'b'`. Expect
  `selectTimelineFor('b')` to be a present, empty slice — not `null`. Fails on `main` (`null`).
- **AC1, timeline already retained.** Seed via `dispatchFor('b', …)` then `dispatchFor('a', …)` — head-insert
  puts the map in order `['a', 'b']`. Activate `'a'`. Expect `[...timelines.getState().timelines.keys()]` to
  equal `['b', 'a']`: the opened conversation moved to the tail. Fails on `main` (order unchanged). Assert the
  key **order** here rather than an eviction — this is the criterion's own shape, and it says "whether or not a
  timeline is already retained".
- **AC2, the slice is there for the next event.** Activate `'b'` against an empty map, assert the slice is
  present (this is the assertion that fails on `main`), then `dispatchFor('b', …)` and assert the map size is
  still 1 and the slice now carries that one item — the event folded into the slice that already existed rather
  than minting a second one at the head.
- **AC3, re-opening the open conversation churns nothing.** Real stores, with `activeConversationStore` genuinely
  wired so the second call sees `previous?.id === 'b'`. Subscribe a notification counter to the timeline store
  **before** the first activation. Activate `'b'`; expect the counter to read exactly 1 (**fails on `main`** —
  zero). Capture `timelines.getState()`. Activate `'b'` again; expect the counter still 1 and
  `timelines.getState()` to be `Object.is`-identical to the captured object. No new slice, no re-ordering, no
  subscriber woken.
- **AC4, the bound.** Fill the map to `MAX_RETAINED_TIMELINES` via `dispatchFor` for `c1`…`c10` — all
  never-viewed, so head-insert leaves `c10` (the newest) as the standing eviction victim at the head. Activate
  `c10`. Then `dispatchFor('cNoise', …)` — a different, never-opened conversation receiving events. Expect
  `selectTimelineFor('c10')` non-null and `selectTimelineFor('c9')` null: the opened chat was taken out of the
  eviction line and its former neighbour took the hit. Fails on `main` (`c10` is evicted). Assert against the
  exported `MAX_RETAINED_TIMELINES` name, never a bare `10`.

`npm run typecheck` is itself a required check for this ticket, not just hygiene: it is the whole coverage story
for "the production deps object wires the new field".

## Open questions

None blocking. Two things settled here that a reader might expect to be open:

- **Inside or outside the gate** — decided outside, on the store's own documented common case (§ Design 2).
- **Order relative to `stampLastRead`** — decided last, on the subscriber-cascade argument (§ Design 2). Both
  orders record the same mark; the constraint that does bind is *after* `setActiveConversation`.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] SHOULD FIX, addressed in-spec.** This ticket makes `markViewed` — the store's only
  tail-writer — reachable from a **daemon event**. `useConversationCreatedNav`
  (`conversationCreatedBridge.ts:61-69`) invokes `activateConversation` on every `conversationCreated` frame,
  ungated. That falsifies a specific sentence in the store's own security docstring
  (`conversationTimelineStore.ts:183-187`): "THE DAEMON CAN ONLY EVER INSERT AT THE HEAD, AND ONLY THE OPERATOR
  CAN MOVE A KEY TO THE TAIL … The protected region is populated by operator action alone." After this ticket a
  compromised paired daemon emitting N `conversationCreated` frames mints N tail entries, each evicting the
  head, and can therefore displace **every** viewed slice rather than the "AT MOST ONE" that paragraph
  guarantees.

  Not a MUST FIX, and the spec deliberately adds no gate: the criteria require the created-event path to stamp
  (AC1 names "landing in one the moment it is created"), and the same actor already achieves strictly more
  damage on that same path today — each `conversationCreated` already resets the flat `timelineStore` the screen
  actually renders, clears the session id, and re-keys the pane. The relay is content-blind and outside the
  Noise session, so the actor here is the paired daemon, which already owns the entire content stream. The
  incremental exposure is bounded by what it already has.

  **Addressed:** § Design 4 makes correcting `:183-187` part of the change. The corrected wording must (a) keep
  the head-insert rule and its "hostile ids displace at most one viewed slice" reasoning for the `dispatchFor`
  path, which is unchanged and still true, and (b) state plainly that `markViewed`'s call site is the
  activation seam, that two of its three trigger paths are the operator's own (row click, re-click) and the
  third is the daemon's `conversationCreated` confirmation, and that the tail is therefore **not** an
  operator-only region. A false claim in a security docstring is worse than no claim, because the next ticket
  reasons from it.

- **[Trust boundaries] No findings, second half.** The `conversationId` crossing into `markViewed` is
  daemon-asserted untrusted text used as a `Map` key and nothing else — never rendered, concatenated, logged,
  normalised, compared against a secret, or used as a filename, attribute or URL. Both the source
  (`ConversationCreatedPayload.id` / `ConversationSummary.id`, already held in renderer state) and the sink
  (`ReadonlyMap.set`) are pre-existing and already hostile-key-safe by construction
  (`conversationTimelineStore.ts:51-63`). This ticket introduces no new boundary, no new key space, and no
  computed object key. `'__proto__'`, `'constructor'` and `''` remain three unremarkable keys.

- **[Tokens, secrets, credentials] N/A.** No token, key or credential is read, written, derived or compared on
  any path this ticket touches. Nothing new reaches disk.

- **[File / storage operations] No findings.** One indirect storage interaction exists and it is a
  non-write: the cascade in § State + concurrency reaches `recordLastRead`, which backs onto `localStorage`.
  `recordLastRead`'s `===` guard sits **ahead of** `storage.write` (`conversationLastReadStore.ts:357-360`) and
  the value re-recorded is byte-identical to the one `stampLastRead` wrote a line earlier, so no write occurs.
  No path traversal, no TOCTOU, no new persisted key, and — critically — conversation **content** still never
  reaches renderer-side web storage: the timeline map is in-memory only and this ticket does not persist it.

- **[Inter-process / Electron attack surface] N/A.** Renderer-only. No `contextBridge` API, no `ipcMain`
  channel, no `webPreferences`, no custom protocol, no navigation handler. Nothing crosses the preload bridge;
  `window.pyry` is not dereferenced on any new line. Process placement is untouched — no key, socket or
  handshake byte comes near this code.

- **[Cryptographic primitives] N/A.** No RNG, no hash, no KDF, no comparison against a secret, no Noise state.

- **[Network & I/O] N/A.** No socket, no frame, no URL, no timeout, no reconnect. `markViewed` is a synchronous
  in-memory map rebuild at a bound of ten.

- **[Error messages, logs, telemetry] No findings.** No `console.*` is added on any branch, and the rule bites
  here: the values in scope are the untrusted id and, one frame down, assistant message text (ADR 0007, #126).
  Nothing new is surfaced to the UI, so no error string exists to leak. The silent miss and the silent eviction
  are by design, not swallowed errors.

- **[Concurrency] No findings.** Fully synchronous, single-threaded, no `await` between any read and any write,
  so no check-then-act gap opens across a suspension point. The one new cascade is walked to termination in
  § State + concurrency: depth 2, no re-entrancy (the second write targets a different store than the one
  subscribed). No listener is added, none removed, no timer, no `AbortController`, nothing to tear down. A
  window close mid-activation leaves no partial state — nothing is persisted on this path.

- **[Threat model alignment] Addressed above.** *Malicious relay:* content-blind and outside the Noise session;
  it can drop, delay or reorder but cannot mint a `conversationCreated`, so it cannot reach `markViewed`.
  *Hostile daemon response:* the finding above, accepted and documented. *Token theft from disk / renderer
  compromise reaching the transport:* untouched — nothing in this ticket moves a secret or widens renderer
  reach. *Memory exhaustion:* strictly improved rather than worsened — this ticket is what makes the ten-slice
  bound's stated policy actually hold, and it adds at most one slice (an empty `initialTimelineState` reference)
  per activation within an already-enforced bound.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-26
