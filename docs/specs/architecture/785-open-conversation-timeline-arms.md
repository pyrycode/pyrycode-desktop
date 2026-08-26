# #785 — the session-boundary and reconnect arms reach the thread on screen

**Size:** S (2 production files, 1 new export, 1 changed signature with **one** production call site, zero new imports in the constrained module)
**Label:** `security-sensitive` — misattributing a row into the wrong thread is a confidentiality bug; the security pass is at the end of this spec
**Family:** the #675 routing family. Directly downstream of #756 (the fan-out) and #784 (`unrecognizedMessage` left the id-less group). Upstream of #758 (the reader).

## Design source

N/A — no rendered surface changes. Both arms already render exactly as they do today (`sessionBoundary`
is an existing `ThreadItem`, `reconnected` draws nothing); this ticket changes only which *store slice*
they are written into, and the flat store the screen reads today is untouched. The visual-fidelity check
is intentionally skipped.

## Baseline — verified at `f0f1529`

| Checked at `f0f1529` (`main` after #784's PR #788 merged) | Result |
| --- | --- |
| Every line reference in this spec | **verified by direct read**, byte-for-byte |
| `useTimelineBridge` production call sites | **1** — `App.tsx:74`. Zero in `src/**/*.test.*`, zero in `e2e/` |
| `subscribeTimeline` call sites | ~23 (`timelineBridge.test.ts`) + 1 (`interactiveRoundtrip.test.tsx`) — **all untouched by this design** |
| `timelineTargetFor` return type | `string | null`; **unchanged by this design** |
| `timelineBridge.ts` import block `:11-15` | 5 imports; **byte-identical after this ticket** — the new code needs no import |
| Overlapping in-flight `origin/feature/*` branches on the four target files | **none** (18 remote feature branches checked against `origin/main...`) |
| codegraph | still unindexed (`.codegraph/` holds `config.json` + `.gitignore`, no DB) — grep/Read throughout |

**Prior-decision search.** QMD (`pyrycode-docs`, `pyrycode-root`) returned only daemon-side
conversation-id routing specs (#1586, #1610, #1125, #1065) — none bears on the renderer seam. The
authoritative sources are local and were read in full: `docs/specs/architecture/756-timeline-bridge-routing.md`
(the fan-out this extends), `784-unrecognized-message-conversation-id-arm.md` (the in-file/out-of-file
convention, applied below) and `764-retire-tooluse-conversation-id-citations.md` (that convention's
statement of record).

## Files to read first

| Path | What to extract |
| --- | --- |
| `src/renderer/src/store/timelineBridge.ts:11-15` | The five imports. **This block must be byte-identical after your change** — the new code needs nothing new. |
| `src/renderer/src/store/timelineBridge.ts:223-263` | `timelineTargetFor`'s docblock — THE ROUTING CONTRACT. `:235-240` is the constraint paragraph you must re-state (§ D3). Note `:227-233`: four other modules cite lines **inside** `translateTimelineEvent`, so nothing above that function's closing brace (`:221`) may move. |
| `src/renderer/src/store/timelineBridge.ts:264-292` | `timelineTargetFor`'s body. `:281-288` is the two-arm `null` group whose comment goes stale (§ D4). The signature and the returned `null` **do not change** (§ D1). |
| `src/renderer/src/store/timelineBridge.ts:294-320` | `subscribeTimeline`. **Do not touch** — `:302-308` records why a third parameter is banned (23-site cascade). |
| `src/renderer/src/store/timelineBridge.ts:322-355` | `useTimelineBridge` — the fan-out composition root, and the only thing whose *behaviour* changes (§ D2). |
| `src/renderer/src/store/conversationTimelineStore.ts:255-316` | `dispatchFor`'s three branches. The KEY-ABSENT branch creating from `initialTimelineState` is what makes AC1/AC2 work with nothing retained yet — no new store vocabulary. |
| `src/renderer/src/store/conversationTimelineStore.ts:160-222` | The eviction invariant + `withNewSliceAtHead`. Read before § State + concurrency — a reconnect can now create a slice at the head. |
| `src/renderer/src/store/threadTimeline.ts:421-440` | The `sessionBoundary` reducer arm: fresh tail-append, always a new `items` array. AC1's row. |
| `src/renderer/src/store/threadTimeline.ts:552-590` | The `reconnected` arm: five chrome scalars reset (Mode B), `items` survives **by reference** (Mode A, `:559-561`), same-reference no-op when nothing is live. AC2 in one arm. |
| `src/renderer/src/store/activeConversationStore.ts:22-38`, `:59-71` | The state shape, the singleton, and `selectActiveConversation`. `activeConversation === null` is the app's "no conversation is open". |
| `src/renderer/src/activateConversation.ts:35-45` and `src/renderer/src/exitActiveConversation.ts:1-5`, `:100` | Why `activeConversationStore` **is** "the conversation on screen" — both helpers say so in their own words. This is the justification AC1/AC2 rest on; cite it, don't re-derive it. |
| `src/renderer/src/App.tsx:1-16`, `:68-80` | The import block and the hook call site you edit (§ D5). |
| `src/renderer/src/store/timelineBridge.test.ts:509-522` | **Design oracle #1** — `timelineTargetFor` returns `null` for both arms. Must stay green **and unedited**. |
| `src/renderer/src/store/timelineBridge.test.ts:582-590` | **Design oracle #2** — `subscribeTimeline` passes `null`, "never a substitute id". Must stay green **and unedited**. |
| `src/renderer/src/store/timelineBridge.test.ts:925-955` | The local `fanOut`/`wired` harness that mirrors the composition root. This is what gains a notion of an open conversation (§ T1). |
| `src/renderer/src/store/timelineBridge.test.ts:1028-1078` | The two tests that invert (§ T2/T3). Read `:1063-1067` in particular — its "would pass for the wrong reason" argument survives in a sharper form. |
| `src/renderer/src/store/conversationActivityBridge.ts:180-186` | The sibling bridge stating the same import ban — this is why § D3 re-states rather than deletes. |
| `docs/specs/architecture/756-timeline-bridge-routing.md` § D3, § D6, § D7 | The fan-out root, the structural AC, and the in-file/out-of-file rule this spec re-applies. |

## Context

`timelineBridge` owns eleven `DaemonEvent` arms. Since #784, nine of them carry the frame's
`conversation_id` and `timelineTargetFor` routes each into its own slice of `conversationTimelineStore`.
Two do not, and neither ever will:

- **`sessionTransition` → `sessionBoundary`** (`timelineBridge.ts:83-98`) tail-appends the `/clear` and
  workspace-change separator the operator sees between sessions. The wire payload has no
  `conversation_id` at all (`src/shared/wire/types.ts:664`: "a session boundary is attributed by the
  connection it arrives on"). Adding one is a daemon + mobile protocol change, out of scope for this repo.
- **`connected` → `reconnected`** (`timelineBridge.ts:140-147`) clears the transient thread chrome so a
  retry or compaction banner whose falling edge was lost to a disconnect does not stick (#538). A
  connection edge has no conversation by nature.

Today that is invisible: both still reach the flat `timelineStore`, and the flat store is what the screen
renders. #758 cuts the screen over to its own conversation's retained slice. At that moment the separator
stops being drawn and a stuck banner goes back to being stuck until restart.

The conversation these two belong to is the one the operator is looking at — which is *precisely* what
the flat store means today. Filing them there preserves what he sees, bit for bit, and it is the model
the wire types already state (`types.ts:665`: desktop "targets the single active conversation").

This lands, like #756 before it, as a **verified no-op on what the operator sees**: both writes run side
by side and the flat store keeps receiving both arms exactly as it does today (AC4).

## Design

Two production files. One new exported pure function, one signature change with one call site, one
comment true-up. No new type, no new store vocabulary, no change to `translateTimelineEvent`,
`timelineTargetFor` or `subscribeTimeline`.

### D1 — the resolution goes at the FAN-OUT, and the two design oracles say why

`timelineTargetFor` keeps its signature (`(event: DaemonEvent) => string | null`) and keeps returning
`null` for both arms. `subscribeTimeline` keeps its two parameters and keeps passing that `null` through
as the second argument. Neither file's test moves.

This is not a stylistic preference; it is what the two green-and-untouched tests enforce:

- `timelineBridge.test.ts:509-522` — a resolution inside `timelineTargetFor` turns `toBeNull()` red. That
  function is a pure function *of the event*; the open conversation is not a property of the event, and
  making it one is the misattribution the whole #675 family exists to remove.
- `timelineBridge.test.ts:582-590` — a resolution inside `subscribeTimeline` needs a third parameter,
  which `timelineBridge.ts:302-308` records as the thing #756 deliberately avoided because "a third
  parameter would have cascaded over all 20 [now ~24] instead". That cascade is above the 10-call-site red
  line and would make this ticket a split.

So the seam is `useTimelineBridge`'s callback, which has **one** production call site.

### D2 — one new exported pure function: `timelineWriteTarget`

Placed immediately **after** `timelineTargetFor` and **before** `subscribeTimeline`'s docblock, so the
two halves of the routing contract read together.

```ts
export function timelineWriteTarget(
  event: ThreadEvent,
  conversationId: string | null,
  getOpenConversationId: () => string | null
): string | null
```

Behaviour, in this order and no other:

1. `conversationId !== null` → return it. **The event's own attribution always wins.**
2. otherwise, an explicit `switch (event.type)` whose only non-default cases are `'sessionBoundary'` and
   `'reconnected'` → `return getOpenConversationId()`.
3. `default:` → `return null`.

Four properties are load-bearing and each belongs in the docblock:

- **The fallback is ENUMERATED, never blanket.** `conversationId ?? getOpenConversationId()` is the
  obvious one-liner and it is **banned here**. A blanket fallback files *any* unattributed owned event
  into the conversation on screen — including a future arm whose author added a `case` to
  `translateTimelineEvent` and forgot one in `timelineTargetFor`. That arm would land silently on the
  wrong thread. With the enumeration, it falls to `default` and is dropped from the keyed path, reaching
  the flat store only — the same safe failure direction `timelineTargetFor`'s own `default` has
  (`timelineBridge.ts:258-262`).
- **Step 1 comes first so a future widening is safe by construction.** If `sessionTransition` ever gains a
  wire `conversation_id` (a daemon + mobile change, out of scope), `timelineTargetFor` returns the real id
  and this function honours it with no edit. Ordering the switch first would silently override it. This
  branch is unreachable in production today and is pinned by a direct unit test anyway (§ T4) — that is
  the whole point of the function being pure.
- **A GETTER, not a value.** Two reasons. (a) It must be read at *dispatch* time: the operator can switch
  chats between two events on one long-lived listener, and a value captured at subscribe time would file
  a boundary into the conversation he left — the same staleness argument `activateConversation.ts:16-23`
  makes for `getActiveConversation`. (b) It kills the positional cross-wire: `string | null` and
  `() => string | null` are not interchangeable, so swapping arguments two and three is a compile error
  rather than a test-only failure (the hazard `conversationActivityBridge.ts:150-165` documents for its
  own deps object).
- **It is called AT MOST ONCE per event, and never for an id-carrying arm.** Step 1 returns before the
  switch, so the nine id-carrying arms never consult the open conversation at all — the strongest
  statement of "no misattribution", and directly assertable on a spy (§ T4).

No `??`, no `||`, no default parameter, no non-null assertion. `if (conversationId !== null)` is an
explicit test, and the switch is exhaustively enumerated.

### D3 — the constraint paragraph at `timelineBridge.ts:235-240` narrows; it does not go away

Today it reads, in part:

> this module imports nothing from `activeConversationStore` and nothing from
> `src/renderer/src/screens/`. With no reference to the open conversation in scope, the
> `?? activeConversation` fallback … is not something to remember to avoid — it is unavailable. There is
> no `??`, no `||`, no default parameter and no non-null assertion anywhere on the routing path.

After this ticket:

- **The import half stays literally true and byte-identical.** `timelineWriteTarget` needs only
  `ThreadEvent`, already imported at `:15`. The open conversation enters as a *parameter*, injected from
  `App.tsx`. Verify with `git diff` on `:11-15`: zero lines changed. State this in the re-written
  paragraph so it stays grep-checkable — the sibling bridge holds the identical ban
  (`conversationActivityBridge.ts:183-184`), so this is a family convention, not a one-off.
- **The `??`/`||`/default-parameter/non-null half stays true verbatim.** D2 uses none of them.
- **The rationale clause "with no reference in scope … it is unavailable" is the one sentence that must
  change.** Replace unavailability with *enumeration and precedence*: the open conversation is now
  reachable, but only through an injected getter, only at the fan-out, only for two named `ThreadEvent`
  arms, and only after the event's own attribution has been found absent. Say which two arms and why each
  can never gain a key.
- **Scope the word "routing path" explicitly.** `timelineTargetFor` remains a pure function of the event
  with no reference to the open conversation *in scope*; `timelineWriteTarget` is the write-key
  resolution downstream of it. Two functions, two sentences — the same split #756 made between
  translation and attribution.

**Do not delete this paragraph and do not move it.** It sits inside `timelineTargetFor`'s docblock
(`:223-263`), which is below `translateTimelineEvent`'s closing brace at `:221`, so re-writing it moves no
line any other module cites *inside the translator*. See § Line drift for what it does move.

### D4 — the census comment at `timelineBridge.ts:283-287` is trued up in this commit

It currently ends "there is nothing to attribute them to, and inventing one is exactly what AC3 bans."
The first half stays true — neither arm carries a routing key, and `timelineTargetFor` still returns
`null` — but "nothing to attribute them to" becomes false the moment the fan-out files them into the
conversation on screen.

Rewrite it to say: neither arm carries a routing key of its own and neither ever will (one reason each,
keep them); `timelineTargetFor` therefore returns `null`, which is the contract that keeps the resolution
out of this pure function; and the fan-out (`timelineWriteTarget`) files them into the conversation on
screen — the conversation the flat store has always meant — or drops them from the keyed path when none
is open. Point at `timelineWriteTarget` by name, not by line number.

**In-file, so it lands in this ticket's own commit** — the family's settled convention
(`docs/specs/architecture/764-…md`; #784's spec § Must-NOT-sweep restates it). Out-of-file citations are
somebody else's ticket; see § Line drift.

### D5 — the injection site: `App.tsx`

`useTimelineBridge` gains one parameter:

```ts
export function useTimelineBridge(getOpenConversationId: () => string | null): void
```

Its body changes by two lines — resolve the target, then guard on it:

```ts
const target = timelineWriteTarget(event, conversationId, getOpenConversationId)
if (target !== null) { conversationTimelineStore.getState().dispatchFor(target, event) }
```

Flat-first is untouched and still unconditional (`timelineStore.getState().dispatch(event)` stays the
first statement) — that is what keeps AC4 true even if the keyed write were to throw
(`timelineBridge.ts:329-331`). The effect's dependency array becomes `[getOpenConversationId]`, which is
honest rather than `[]`; it is correct **because** the caller supplies a module-level constant. State that
requirement in the hook's docblock: an inline arrow would resubscribe on every `App` render.

`App.tsx` adds one import and one module-level constant above the component:

```ts
import { activeConversationStore, selectActiveConversation } from './store/activeConversationStore'

/** The conversation on screen … read through `getState()` at dispatch time, never captured. */
const openConversationId = (): string | null => {
  const open = selectActiveConversation(activeConversationStore.getState())
  return open === null ? null : open.id
}
```

Three points for the comment:

- **Write it as an explicit `null` test, not `open?.id ?? null`.** Both compile; the explicit form is what
  makes "no `??` anywhere on this path" literally true end-to-end, including the injection site, so a
  reviewer greping for the banned shape finds nothing to adjudicate.
- **Module-level, not inline.** Stable identity ⇒ one subscribe for the app's lifetime, matching today.
- **This is NOT the `?? activeConversation` fallback `events.ts:115-117` bans.** Say so in the comment or
  review will read it as exactly that — #756's D4 hit the same trap. That ban is about an arm that *has*
  a routing key being made optional so a consumer papers over a missing one. These two arms carry no key
  on the wire and never will, and the read is enumerated to them.

Nothing else in `App.tsx` moves. The constant dereferences no `window` global, so the `<App/>`
server-render test (`App.test.tsx`) keeps rendering without a bridge stub.

### D6 — what is deliberately NOT built

- **No fan-out of a reconnect across every retained timeline.** It would need a cross-key write path the
  holder does not expose (`dispatchFor` / `markViewed` / the two clears are its whole vocabulary,
  `conversationTimelineStore.ts:151-156`), and routing to the conversation on screen is exactly what
  happens today — so this ticket stays a no-regression change. The fan-out is an improvement that wants
  its own ticket (§ Open questions).
- **No new store vocabulary.** `dispatchFor`'s key-absent branch already creates from
  `initialTimelineState` (`conversationTimelineStore.ts:302-309`).
- **No validation of the open conversation id.** It is renderer-local state the operator's own activation
  put there; the daemon cannot write it.

## State + concurrency model

Unchanged in shape: one app-lifetime listener, one `useEffect` whose cleanup is `subscribeTimeline`'s off
handle, StrictMode double-mount still netting exactly one live listener. Both store writes stay
synchronous zustand `set`s with no `await` between them, so nothing interleaves and no check-then-act gap
opens.

The one genuinely new behaviour is worth pinning:

**A reconnect can now CREATE an empty slice for the open conversation.** `reduceTimeline(initial,
{type:'reconnected'})` has nothing live to clear and returns the same reference, but `dispatchFor`'s
key-absent branch creates unconditionally and inserts **at the head**
(`conversationTimelineStore.ts:194-222`), which is the standing eviction candidate. Three reasons this is
accepted rather than special-cased:

1. It is the holder's deliberate, documented contract ("a fold for an id the client has never opened
   creates that id's slice rather than dropping it" is unconditional,
   `conversationTimelineStore.ts:267-270`) — the same reading the twin store has for a first write of
   `false`.
2. It only fires when nothing is retained for the open conversation. In the common case the slice exists,
   `reconnected` against clean chrome returns the same reference, `folded === held`, and `dispatchFor`
   returns the state object — no clone, no re-order, no subscriber woken.
3. #758 wires `markViewed` at the switch seam, which moves the open conversation to the tail. Until it
   lands every slice is never-viewed anyway, so eviction order is pure creation-recency and this changes
   nothing about who is at risk.

**The open conversation is read per event, not per subscription.** The getter is invoked inside the
listener, so an operator switching chats between two frames gets each frame filed against the chat that
was on screen when it arrived. That is the definition AC1 and AC2 use.

## Error handling

No new failure mode, and no new `try`/`catch`.

- **No conversation open.** `getOpenConversationId()` returns `null`, `timelineWriteTarget` returns
  `null`, the existing `target !== null` guard drops the keyed write. No error, no invented key, no empty
  slice — AC3, and the failure direction is "flat store only", which is today's behaviour exactly.
- **A future owned arm with no `timelineTargetFor` case.** Falls to `timelineWriteTarget`'s `default`,
  returns `null`, dropped from the keyed path. Never routed onto a wrong slice.
- **A throwing getter.** Would propagate out of the listener; so would today's `dispatchFor`. The
  contract on the parameter is "a synchronous read of renderer-local state", and `App.tsx`'s constant is
  exactly that — a property read on a zustand store. No defensive wrapper: nothing has ever thrown here,
  and a `try` would swallow a real bug (evidence-based fix selection).
- **Nothing is logged.** This path stays log-free by construction (ADR 0007, #126): the only values in
  scope are an untrusted `conversationId` and a `ThreadEvent` that may carry assistant text.

## Testing strategy

All in `src/renderer/src/store/timelineBridge.test.ts`. Unit tests only — vitest, `environment: 'node'`,
plain spies, no React, no DOM. Nothing in `e2e/` changes.

### T1 — the local harness gains an open conversation

`fanOut` (`:930-938`) and `wired` (`:940-950`) mirror the composition root and must keep mirroring it:
`fanOut` takes the getter as a third argument and calls `timelineWriteTarget`, so the copy actually
*shrinks* — the only thing left uncovered by these tests is the two-line hook glue, an improvement on
#756's Open question 3.

`wired` holds a mutable `let open: string | null = null`, passes `() => open` as the getter, and returns a
`setOpen(id)` alongside `bridge`/`flat`/`keyed`. A mutable local, not a constructor argument: the
switch-chats-between-events case is a scenario that has to be expressible.

### T2 — `:1028-1048` inverts by becoming explicit

Keep the test, rename it to say **"with no conversation open"**, and keep both assertions exactly as they
are (`selectItems(flat)` is `['sessionBoundary']`; `timelines.size` is `0`). Its AC4 half was always
unconditional; its AC3 half is now conditional and the name has to say so. This is AC3.

### T3 — `:1050-1078` inverts into the sharper probe

Its comment at `:1063-1067` argues that asserting no-fallback against an empty map "would pass for the
wrong reason". That reasoning survives and gets stronger. Replace the test with two:

- **AC1 / no-misattribution.** Hold a slice for `conv-a` (one `assistantDelta`), `setOpen('conv-b')`, emit
  `sessionTransition`. Assert `conv-b`'s slice holds exactly `['sessionBoundary']`, and `conv-a`'s slice is
  `Object.is`-identical to the reference captured before — not merely equal. This is the probe that proves
  the write follows the *screen*, not some other held slice, and `sessionTransition` stays the right
  event for it because it appends a visible row.
- **AC1 / the same-conversation case.** Hold a slice for `conv-a`, `setOpen('conv-a')`, emit
  `sessionTransition`. Assert the boundary is *tail-appended* after the existing row — the separator
  lands in the thread being read, in arrival order.

### T4 — `timelineWriteTarget` in isolation

A new `describe`, direct calls, no bridge:

- an id-carrying `ThreadEvent` (e.g. `assistantDelta`) with `conversationId: 'conv-own'` and a
  `vi.fn()` getter → `'conv-own'`, **and the getter was never called**. The strongest single assertion in
  this ticket.
- `sessionBoundary` with `null` and a getter returning `'conv-open'` → `'conv-open'`; getter called once.
- `reconnected` with `null` and a getter returning `'conv-open'` → `'conv-open'`.
- `reconnected` with `null` and a getter returning `null` → `null`.
- **the precedence pin:** `sessionBoundary` with `conversationId: 'conv-own'` → `'conv-own'`, getter never
  called. Unreachable in production today; it is what makes a future wire widening safe.
- **the default's safe direction:** an arm that is neither (`{ type: 'userText', text: 'x' }`) with `null`
  → `null`, getter never called.

### T5 — AC2, through both stores

With `setOpen('conv-a')` and a slice for `conv-a` holding a row plus live chrome (drive it with a real
`apiRetry` rising edge through the bridge so the fixture is not hand-built), emit `{ type: 'connected' }`.
Assert on `conv-a`'s slice: `apiRetry` is `null` (chrome reconciled, Mode B) **and** `items` is
`Object.is`-identical to the array held before (rows untouched, Mode A). Then the AC3 half: with the same
setup but `setOpen(null)`, the held slice is `Object.is`-identical *as a whole*.

### T6 — AC4 stays proved by tests that do not move

The flat write is unconditional and first. Every existing flat-store assertion in this file — including
`:1045`'s `['sessionBoundary']` and the ~23 `subscribeTimeline` call sites — stays green **unedited**.
Do not add a new AC4 test; a green untouched suite is stronger evidence than a new assertion.

### T7 — the two design oracles

`:509-522` and `:582-590` must be green **and appear in no diff**. If either is edited, the resolution
leaked into the routing function or the subscribe signature (§ D1). Treat an edit to either as a failed
implementation, not a test to update.

**Gates:** `npm run typecheck`, `npm test`, `npm run build`.

## Line drift — read before you commit, and do NOT fix these

Re-writing `:235-240` and inserting `timelineWriteTarget` shifts `useTimelineBridge`'s body down by
roughly the length of the new function plus its docblock. Six out-of-file citations point into this file
by line number. **None of them is in scope**, and pulling them in would put this ticket at five production
files — over the spec's own ≥5 gate.

| Citation | State after this ticket |
| --- | --- |
| `exitActiveConversation.ts:104` — "timelineBridge.ts:347 then :349" | Correct today, drifts. The *claim* (flat first, then keyed) stays true. |
| `clearPairingScopedState.ts:55`, `:100` — same pair | Same: correct today, drifts, claim stays true. |
| `conversationLastReadStore.ts:43` — "routes only the eight id-carrying arms … (timelineBridge.ts:349)" | Already false at #784 (nine, not eight) and further falsified here (all eleven now reach the keyed store, two via the screen). |
| `conversationTimelineStore.ts:11-12` — "the other three … carry no conversation id, so they reach the flat store only" | Already false at #784 (two, not three) and further falsified here. **Owned by #787**, which is open. |
| `PairedShell.tsx:38`, `activateConversation.ts:43` — "timelineBridge.ts:206" | Already stale before this ticket (#756 recorded it); drifts further. |

Also **do not touch** `timelineBridge.ts`'s module header (`:1-10`) or anything above
`translateTimelineEvent`'s closing brace at `:221`. Four modules cite lines inside that translator
(`conversationActivityBridge.ts:7` and `:114`, `announcedModelBridge.ts:11`, `announcedModelStore.ts:12`),
and the header's claims are all still true — `useTimelineBridge` is still the only production caller, and
nothing here touches keys, sockets, `ipcRenderer` or raw frames.

## Security review

Ticket carries `security-sensitive`. Pass run against this spec before commit, adversarially and
category by category.

**Trust boundaries.** No IPC channel, no wire field, no preload surface, no new data crossing
main↔renderer. Two values meet on this path and they have opposite provenance, which is the whole
security story of the ticket:

- `conversationId` — daemon-asserted untrusted text that already cleared the fail-closed decode
  (`events.ts:110-112`). Used only as a `Map` lookup key, exactly as before.
- `openConversationId` — **renderer-local, operator-authored** state. The daemon cannot write
  `activeConversationStore`; only `activateConversation` (a row click or a `conversationCreated` nav) and
  the two clears touch it. So this ticket does *not* widen daemon control over routing — it hands two
  daemon events a key the daemon has no influence over.

1. *Injection / raw-markup sinks.* Neither value is rendered, concatenated, made an attribute, a URL, a
   filename or a cache key. `sessionBoundary`'s already-untrusted `workspaceCwd` is copied by the
   **unchanged** `translateTimelineEvent` and reaches no new sink — the second store holds the same
   `ThreadEvent` the flat store already holds, under the render slice that already owns that DOM sink. No
   `innerHTML`, no `dangerouslySetInnerHTML`, no new sink of any kind. **No finding.**
2. *Prototype pollution.* `openConversationId` becomes a `ReadonlyMap` key. `Map.prototype.get/set` do no
   prototype-chain lookup, and this design introduces no object literal keyed by a string, no computed
   key, no `Object.fromEntries`, no `JSON.stringify` of the map. `''` — reachable if a conversation id is
   ever empty — is an unremarkable key, and the getter's explicit `open === null ? null : open.id` does
   **not** collapse `''` into null the way a truthiness test would. **No finding**, and that last point is
   why § D5 mandates the explicit null test rather than `open?.id ?? null`.
3. *Misattribution — the category this ticket actually moves.* Filing a row into the wrong thread is a
   confidentiality bug. Three defences, and they are structural rather than disciplinary: (a) the
   fallback is **enumerated to two `ThreadEvent` arms**, never blanket, so a future arm cannot inherit it
   by accident; (b) the event's own attribution is checked **first**, so an id-carrying arm never consults
   the open conversation at all — pinned by a spy assertion (§ T4); (c) `default` fails toward "flat store
   only", never toward another conversation's slice. The residual — a boundary filed against the chat on
   screen when the daemon meant another — *is today's behaviour*, unchanged: the flat store the screen
   renders is definitionally the open conversation's. **No finding. This ticket strictly reduces
   ambiguity; it introduces none.**
4. *Resource exhaustion.* One new way to mint a slice: a `connected` edge while a conversation is open
   with nothing retained creates an empty slice at the head. Bounded three ways — the key is
   operator-chosen (a hostile daemon cannot pick it), at most one slice per handshake, and
   `MAX_RETAINED_TIMELINES` plus the head-insert rule still cap the map. A reconnect storm mints and
   re-mints one key, not N. **No finding**; recorded in § State + concurrency.
5. *Electron attack surface / process placement.* Renderer-only, store-to-store. No crypto, socket,
   token, `window` global, `contextBridge` API or `ipcMain` channel is added or touched. The transport
   stays in the background process. **No finding.**
6. *Logging / diagnostics.* No `console.*` on any new branch. Both `timelineBridge.ts` and
   `App.tsx`'s new constant stay log-free; the values in scope are an untrusted id and assistant text,
   both MUST-NOT-log under ADR 0007. **No finding.**
7. *Persistence.* Nothing reaches `localStorage`, `sessionStorage` or IndexedDB. Conversation content
   must not survive the pairing boundary #757 enforces, and this ticket writes nothing durable.
   **No finding.**
8. *Concurrency.* No new async task, timer, listener or `AbortController`. The one added read is a
   synchronous property read inside an existing synchronous listener; no `await` is introduced, so no
   check-then-act gap opens. The effect's cleanup is unchanged. **No finding**, with one design
   requirement already stated in § D5: the injected getter must be a module-level constant, or the effect
   resubscribes per render (a correctness/churn issue, not a security one).
9. *Threat-model alignment.* **Hostile daemon:** can emit `session_transition` and force `connected`
   edges at will. Post-ticket, each lands on the chat the operator is reading — a visible separator row or
   a chrome reset — which is what it already does through the flat store. It cannot aim either at a
   *background* conversation, because the key comes from renderer-local state; that is a reduction in
   daemon reach, not an increase. Denial-of-legibility (spamming separators into the thread on screen)
   is pre-existing, applies identically to the flat store today, and is out of scope. **Malicious relay:**
   content-blind and on-path; it can force disconnects and therefore `reconnected` edges — whose entire
   purpose is to reconcile chrome after exactly that. **Renderer compromise:** already total for renderer
   state; this adds no capability.

**Out of scope, named:** the cross-conversation reconnect fan-out (a stuck banner on a *background*
thread stays stuck) — see § Open questions (1). Validating a daemon-supplied `conversationId` against the
client's known conversations remains #758's cross-cutting call, as #784's review recorded.

**Verdict: PASS.** No MUST FIX and no SHOULD FIX. Two design requirements that a weaker spec would have
left to the developer are stated as requirements rather than findings, because getting either wrong is
the exploitable version of this change: the enumerated-not-blanket fallback (§ D2) and the explicit
null test in the getter (§ D5).

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-26

## Open questions

1. **Fanning a reconnect out across every retained timeline.** Out of scope here by the ticket body's own
   ruling, and it needs a cross-key write path `conversationTimelineStore` does not expose. Worth its own
   ticket once #758 lands and the operator can actually see a background thread's chrome. Flagging for PO.
2. **The line-number citations in § Line drift need an owner.** `conversationLastReadStore.ts:43` and
   `conversationTimelineStore.ts:11-12` are semantically false (both were already false at #784);
   `exitActiveConversation.ts:104` and `clearPairingScopedState.ts:55`/`:100` are correct today and drift
   here. #787 is open and already owns `conversationTimelineStore.ts:10-12` — the natural move is for PO
   to widen #787's body to cover all five, or file a sibling. This is the third ticket in the family to
   step around this class; it is accumulating.
3. **`useTimelineBridge`'s two-line hook body stays untested window glue**, as it was before. The
   mitigation is stronger than #756's: extracting `timelineWriteTarget` moves the decision out of the
   glue, so the local harness copy is now three statements, and § T1 keeps it a faithful mirror. If the
   developer sees a way to make the hook body assertable without adding a file or a second export, take
   it — but not by adding either.
