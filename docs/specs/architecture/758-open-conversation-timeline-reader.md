# #758 — Switching chats keeps both threads (the reader cutover)

Size: **S**. One production file (`ConversationScreen.tsx`), one test file, no new module, no new
exported symbol.

> Codegraph note: `.codegraph/` in this repo holds only `.gitignore` + `config.json` — no index database
> — so every `codegraph_*` call errors with "CodeGraph not initialized". The reading list below and the
> call-site counts were built with `grep` + `Read` instead. Re-check when the index lands.

## Files to read first

| Path | What to extract |
|---|---|
| `src/renderer/src/store/conversationTimelineStore.ts:40-73` | The hard import constraint and the **read-site ban** on `selectTimelineFor(id) ?? initialTimelineState`. This is the rule this ticket has to satisfy. |
| `src/renderer/src/store/conversationTimelineStore.ts:377-413` | `useConversationTimelineStore` + `selectTimelineFor` — the whole read surface. Note the three-way reading and that the selector hands back **the held slice itself**. |
| `src/renderer/src/store/conversationTimelineStore.ts:206-234` | `withNewSliceAtHead` — why every survivor is copied by reference, i.e. why a write for another conversation does not re-render this screen. |
| `src/renderer/src/store/threadTimeline.ts:190-215, 609-624` | `TimelineState`'s six fields and `initialTimelineState`. The six field names are exactly the six local names the screen already uses. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:20-34` | The import block being edited. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:94-137` | The six reads plus the `activeConversation` read at `:137`. This block is the whole production diff. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:1402-1418` | `InterruptControl` — the seventh read, and the `window.pyry`-at-interaction-time discipline that must survive. |
| `src/renderer/src/screens/conversation/BackgroundTaskPanel.tsx:324-355` | **The structural precedent** for binding a selector factory to the open conversation's id — the `useMemo`-stable selector and the "nothing wraps, copies, or derives the result" rule. Copy the idiom; do **not** copy its `?? ''` sentinel (see § The `null` branch). |
| `src/renderer/src/store/conversationLastReadBridge.ts:100-115` | `stampLastReadFor` — the in-repo precedent for handling the absent slice as an explicit `=== null` branch with the reasoning written out, never `??`. |
| `src/renderer/src/store/conversationLastReadBridge.ts:156-164` | Why `open?.id ?? null` is spelled as an explicit `null` test elsewhere, and the standing note that a third consumer of "the open conversation's id" earns a selector. Read it, then read § What this deliberately does not do. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:2328-2410` | The `ConversationScreen — store binding` describe. Its `beforeEach` and its `renderToStaticMarkup(<ConversationScreen />)` shape are the vehicle for every new test here. |
| `src/renderer/src/screens/conversation/composerSend.test.ts:100-117` | AC4's existing coverage — `dispatchFor` is already asserted to receive the echo under the sent-to conversation's id. No production work is owed for AC4. |
| `src/renderer/src/PairedShell.tsx:164-183, 271-275` | Why `ConversationScreen` remounts per conversation (`paneKey`), and the nullary notification `open` that makes "route is `thread`, no conversation active" reachable in production. |
| `CLAUDE.md` § Conventions, § Don't | Test-first; unidirectional state; **renderer tests are static server renders and nothing in this repo can click**; don't refactor adjacent code. |

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4171

The chat pane's message area: a single vertical column on the dark thread background — left-aligned
assistant bubbles and right-aligned user bubbles each carrying a timestamp and copy affordance, a centred
`Session reset` separator with hairline rules, image and PDF attachment rows, and full-width tool rows
(`read_file`, and a collapsed/expanded "Listed assistant docs…" row with a code block). **Nothing here is
redrawn.** Every one of those shapes is already shipped and rendered by the existing `Timeline` view and
its children; this ticket changes only which store the values feeding them are read from. The empty
thread AC3 asks for is the shipped `conversation__empty` state, not a new one. No token, no spacing and
no component changes.

## Context

The per-conversation timeline holder exists, is written by both row-adding writers (#756), is cleared at
the pairing and deletion edges (#757), and since #786 has its eviction bound armed by a real `markViewed`
caller. It has no reader. `ConversationScreen` still reads the flat, single-conversation `timelineStore`
in seven places, and because that store holds one thread, `activateConversation.ts:117` resets it on every
switch — so the thread the operator stepped away from is gone.

Pointing those seven reads at the open conversation's own slice is the whole change. The reset still
fires; it fires into a store nothing reads any more.

The three prerequisites are closed: #784 (the parser-gap arm carries its `conversation_id`), #785 (the
session-boundary and reconnect arms reach the conversation on screen), #786 (the least-recently-*viewed*
bound is armed). Without them this cutover would drop diagnostic rows, stop drawing the session-reset
separator, strand retry/compaction banners, and evict exactly the thread being protected.

## Design

### One binding, at the top of the container

Replace the six `useTimelineStore(selectX)` calls at `ConversationScreen.tsx:100,108,113,120,126,132`
with a single subscription to the open conversation's slice, then destructure it. The six local names
(`items`, `phase`, `stalled`, `apiRetry`, `compacting`, `localSendPending`) are exactly `TimelineState`'s
six field names, so **every line of JSX below stays untouched** — the diff is the read block and the
import block.

Contract of the new block, in order:

1. `const activeConversation = useActiveConversationStore(selectActiveConversation)` moves **up**, above
   the timeline read, because the timeline read now needs its id. Same hook, same selector, same single
   subscription — only its position in the hook list changes, which is stable across renders and
   therefore safe.
2. `const openConversationId = activeConversation?.id ?? null` — the spelling this file already uses at
   `:281` and `:1955`. `??` is correct here and `||` is not: an empty-string id must survive as an
   ordinary key rather than collapse into "nothing open".
3. A `useMemo`-stable selector, the `BackgroundTaskPanel.tsx:342` idiom, annotated so inference does not
   widen:

   ```ts
   const selectOpenTimeline = useMemo<(s: ConversationTimelineState) => TimelineState | null>(
     () => (openConversationId === null ? selectNothingHeld : selectTimelineFor(openConversationId)),
     [openConversationId]
   )
   const openTimeline = useConversationTimelineStore(selectOpenTimeline)
   ```

   `selectNothingHeld` is a module-level `const selectNothingHeld = (): null => null` in this file — a
   stable identity, and see § The `null` branch for why it is a distinct selector rather than a sentinel id.
4. The `null` branch and the destructure — see below.

**Nothing wraps, copies, maps or derives `openTimeline` inside the subscription.** That is what keeps the
selector's return `Object.is`-stable, and it is the whole of the cheap-switch property: a write for
another conversation rebuilds the outer map but copies every survivor by reference
(`conversationTimelineStore.ts:214-217`), so `get(openId)` returns the same slice object and this screen
does not re-render.

### The `null` branch

`selectTimelineFor` returns `TimelineState | null`, and
`conversationTimelineStore.ts:44-49` bans `?? initialTimelineState` at every read site. Handle it as an
explicit comparison, with the reasoning written out at the branch — the `stampLastReadFor`
(`conversationLastReadBridge.ts:112-115`) posture:

```ts
const thread = openTimeline === null ? initialTimelineState : openTimeline
const { items, phase, stalled, apiRetry, compacting, localSendPending } = thread
```

Be straight about what this branch is and is not, in the comment above it:

- `null` here means **no conversation is open** — not "the open one has no rows". #786 creates the open
  conversation's slice at the activation seam before this ever renders, so an open conversation always
  has a slice. The reachable `null` cases are the nullary notification `open` before any conversation was
  activated (`PairedShell.tsx:275`) and a bare `<ConversationScreen />` in a test.
- Both readings put the **same** shipped empty thread on screen, and that resolution is a decision, not an
  accident: with no conversation open there is no thread to be about, and the honest render is exactly
  today's behaviour against an empty flat store. Nothing regresses for the existing tests in the
  `store binding` describe, all of which render against empty stores.
- What the ban actually buys here is that the nullable type **forced this branch to be written and
  reasoned about**. A reviewer should know that no test can distinguish the two readings at this site,
  because both render identically — so the comment, not an assertion, is what carries it. The test that
  *can* fail is the fifth one in § Testing strategy, and it pins the thing that matters.

**Do not use `BackgroundTaskPanel`'s `?? ''` sentinel.** That panel substitutes an empty-string id for "no
conversation open" and relies on `''` matching no key. In this store `''` is an ordinary key that
`dispatchFor('')` can mint if the daemon ever asserts an empty `conversation_id`, and the sentinel would
then render that slice's rows as "the open conversation's thread" while nothing is open. Branching to
`selectNothingHeld` performs **no map lookup at all** when nothing is open, which makes the
misattribution unavailable rather than merely unlikely.

### The seventh read — `InterruptControl`

`InterruptControl` (`:1410-1418`) holds its own `useTimelineStore(selectPhase)`. It takes `phase` as a
required prop instead:

```ts
function InterruptControl({ phase }: { phase: TurnPhase }): JSX.Element | null
```

and its single mount at `:233` becomes `<InterruptControl phase={phase} />`. `TurnPhase` is already
imported at `:37`; the component is in-file and not exported, so the edit fan-out is exactly one call
site.

This is not an adjacent refactor — it is one of the seven reads the ticket enumerates. Giving it its own
conversation-scoped subscription instead would duplicate the id derivation and the memoised selector in a
second component for no gain; passing the value the container already holds is both smaller and one
subscription fewer.

**Do not collapse `InterruptControl` into `InterruptButton` at the mount site.** Once `phase` is a prop it
will look like a pointless wrapper, and it is not: it is the seam that dereferences
`window.pyry.sendCommand` inside the click closure and never during render (`:1404-1406`). Inlining it
would put that dereference in the container's render path, where `window.pyry` does not exist under
`renderToStaticMarkup`. See the Electron finding in § Security review.

### What is *not* changed

- **The flat `timelineStore` stays standing.** Its writers (the bridge fan-out, the composer echo at
  `:1943`, the three `PairedShell` reset wirings) and its six selector re-exports are untouched. Retiring
  it is its own ticket, per the ticket body and CLAUDE.md.
- **`useTimelineStore` stays imported** — the composer still reads `s.dispatch` from it at `:1943`. Drop
  only the six now-unused selector imports (`selectItems`, `selectPhase`, `selectStalled`, `selectApiRetry`,
  `selectCompacting`, `selectLocalSendPending`) from the `../../store/timelineStore` import at `:20-28`.
- **`activateConversation`'s timeline reset and `clearSessionId` stay.** The reset becomes unread, which is
  the mechanism of the fix, not an oversight.
- **No new module and no new exported symbol.** The binding has exactly one consumer, and this repo's own
  rule is "one consumer is an import, two is a home"
  (`conversationLastReadBridge.ts:162-164`). Five lines inline beat a file.
- **No `selectOpenConversationId` on `activeConversationStore`.** `conversationLastReadBridge.ts:156-164`
  offers that home to a third consumer, but this site needs a React *selector* over the payload the
  container already holds, not a `getState()` getter — and taking it would mean editing `App.tsx` and
  `conversationLastReadBridge.ts` for zero behavioural gain. Left for the ticket that retires the flat
  store, which will be in both files anyway.
- **No fetch, no backfill, no new IPC arm.** AC3's empty thread is the ordinary first-open case.

## State + concurrency model

Reads only; this ticket adds no write path. Two store subscriptions in the container, both already
present in some form: `activeConversationStore` (unchanged, moved) and `conversationTimelineStore`
(replacing six subscriptions to `timelineStore` with one). Net subscriber count on the container falls by
five, and `InterruptControl` loses its own.

Re-render behaviour, stated because the six narrow reads are being collapsed into one whole-slice read:
the container already re-rendered on every items delta, and its own comments at `:106`, `:112`, `:118`,
`:124` and `:130` each record that the scalar beside it "adds no meaningful re-render churn beyond the
items delta already here". Subscribing to the whole slice is therefore neutral — the same renders, from
one subscription instead of six. Cross-conversation churn is bounded by the store's by-reference survivor
copy, not by selector narrowness.

No async, no effect, no timer, no teardown, no cancellation surface. Every read is synchronous during
render; the memoised selector is rebuilt only when `openConversationId` changes, and in production the
pane remounts on that change anyway (`PairedShell.tsx:179`).

## Error handling

There are no failure modes to surface. No network, no socket, no parse, no permission boundary is touched.
The two branches that exist are readings, not errors:

- `openConversationId === null` — no conversation open. Renders the shipped empty thread. Silent by design.
- `openTimeline === null` — no slice held. Same render. Silent by design.

Neither is logged, and neither may be: a diagnostic here could carry the untrusted conversation id and, via
the slice, assistant message text — both barred by ADR 0007's content-free rule, restated at
`conversationTimelineStore.ts:67-73`. No `console.*` on any path in this diff.

Nothing throws. There is no `try`, no non-null assertion, no optional-chain-into-a-default anywhere on the
new path.

## Testing strategy

Test-first. All coverage is `vitest` + `renderToStaticMarkup`; the repo has no DOM and cannot click, so
interaction stays out of scope and AC4's send path is covered where it already is
(`composerSend.test.ts:111-116` asserts `dispatchFor('conv-b', { type: 'userText', … })`).

Everything below goes in the existing `ConversationScreen — store binding` describe in
`ConversationScreen.test.tsx`.

**Extend its `beforeEach` first.** It currently resets `sessionStore` only. It must also reset
`activeConversationStore` and `conversationTimelineStore`, and seed-and-reset the flat `timelineStore`, or
the new fixtures leak into the ten existing tests in that block, which all assume empty stores. Reset the
timeline map with a **fresh** `new Map()`, never `initialConversationTimelineState` — that exported
constant holds a module-shared mutable map, the trap its own store documents at
`conversationTimelineStore.ts:340-349`.

Scenarios, as behaviour:

1. **AC1 — rows come from the open conversation's own slice.** Hold slices for `conv-a` (a `userText` row
   reading `alpha`) and `conv-b` (one reading `beta`); seed the flat `timelineStore` with a third row
   reading `gamma`; make `conv-a` active. The markup contains `alpha` and contains neither `beta` nor
   `gamma`. This is the ticket's central assertion and it fails two distinct ways on today's code: `gamma`
   appears if the read still goes to the flat store, `beta` appears if the selector is mis-keyed.
2. **AC1 — the chrome scalars come from the open slice.** `conv-a`'s slice carries `phase: 'thinking'`,
   `stalled: true`, `compacting: true`, a populated `apiRetry` and `localSendPending: true`. The working
   indicator, the stall indicator, the retry and compaction chrome and the interrupt control all render —
   the last of these is the proof that `InterruptControl`'s prop cutover landed.
3. **AC1 — chrome from the shared store does not leak.** The inverse of 2: the flat `timelineStore` carries
   `stalled: true`, `compacting: true` and `phase: 'thinking'`; `conv-a`'s slice is at rest. None of that
   chrome renders, and no interrupt control renders.
4. **AC2 — leaving and returning shows the thread as it now stands.** Three renders over one store: with
   `conv-a` active, `alpha` shows; make `conv-b` active and dispatch `{ type: 'reset' }` into the flat
   `timelineStore` (what `activateConversation` does on a switch), `beta` shows and `alpha` does not;
   append a row to `conv-a`'s slice while `conv-b` is on screen, make `conv-a` active again — both
   `alpha` and the row that arrived while it was away show. The middle step is what proves the reset now
   fires into a store nothing reads.
5. **AC3 / the `null` branch — nothing open shows nothing borrowed.** No active conversation, with slices
   held under `conv-a` **and** under the empty-string key `''`. The markup is the empty thread
   (`conversation__empty`) and carries neither slice's rows. This is the test that fails under the
   `?? ''` sentinel spelling, and it is the reason § The `null` branch rejects it.
6. **AC3 — an open conversation with no retained slice.** `conv-c` active and unheld, while `conv-a`'s
   slice and the flat store are both populated. The empty thread renders and neither other thread's rows
   appear.
7. **The existing ten tests in the describe stay green unmodified.** They render against empty stores,
   which is the `null` branch; if any needs editing, the branch resolved to something other than the
   shipped empty thread.

`npm run typecheck` covers what the tests cannot: `InterruptControl`'s required `phase` prop makes a
forgotten wire a compile error, and `selectTimelineFor`'s nullable return makes an unbranched read one.

Gates: `npm test`, `npm run typecheck`, `npm run build`. The default `npm run e2e` tier exercises the
thread against the fake transport and must stay green; no e2e spec is added — nothing in this ticket
changes what a click does.

## Open questions

- **None blocking.** One judgement call is recorded rather than asked: `selectOpenConversationId` is not
  landed on `activeConversationStore`, though `conversationLastReadBridge.ts:162-164` offers it to a third
  consumer. This site needs a selector over a payload the container already holds, and taking the home
  would drag two unrelated files into the diff. The flat-store retirement ticket touches both and is the
  natural place.
- If the developer finds a test in the `store binding` describe that needs editing to stay green, that is
  a signal the `null` branch resolved to something other than the shipped empty thread — stop and re-read
  § The `null` branch rather than adjusting the assertion.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] MUST FIX — fixed in the design; do not regress it.** One untrusted value crosses
  into this diff: `conversationId`, daemon-asserted text arriving as `activeConversation.id`, used for
  exactly one thing — a `Map` lookup key in `selectTimelineFor` (`conversationTimelineStore.ts:409-412`).
  The boundary is that single bare `Map.prototype.get`, and the store header at `:53-65` pins why `Map`
  rather than `Record` makes `__proto__`, `constructor` and `''` unremarkable keys by construction. **The
  finding:** the obvious way to write this read is `BackgroundTaskPanel.tsx:342`'s
  `selectTimelineFor(conversationId ?? '')`, which substitutes `''` for "no conversation open" and relies
  on `''` matching no key. That assumption is not load-bearing for the roster store but is false here —
  `dispatchFor` mints a slice for whatever id the daemon asserts, `''` included — so a hostile or buggy
  daemon emitting one frame with `conversation_id: ''` plants a slice the sentinel then renders as the
  open conversation's thread **while no conversation is open**. Fixed by branching to `selectNothingHeld`,
  which performs no lookup at all on that path (§ The `null` branch). Test scenario 5 fails if the
  sentinel is reintroduced. Downstream callers hold `TimelineState | null`, and the nullable type is the
  type-system signal that the value may not exist.
- **[Trust boundaries] No further findings.** The id is never rendered, concatenated, interpolated into an
  attribute or URL, used as a filename, cache key or lookup path, logged, or compared against a secret
  anywhere in this diff. No sort, comparison, normalisation, lowercasing, trimming or length check is
  performed on it, so its *value* cannot influence which conversation is shown or evicted. No object key
  is materialised from it.
- **[Tokens, secrets, credentials] Not applicable — no token, key or credential is in scope.** This diff
  reads two renderer-side in-memory Zustand stores during render and touches nothing else. No RNG, no
  token lifecycle, no credential storage. The `ConversationCreatedPayload` this screen already holds
  carries `id`, `name` and `cwd`; this diff reads only `id`, and adds no new sink for the other two.
- **[File / storage operations] Not applicable — this ticket performs no storage operation.** No path is
  constructed, no file opened, no `localStorage` / `sessionStorage` / IndexedDB access is added. Worth
  naming because the ticket's own framing ("switching costs me nothing") invites a developer to make the
  retained threads survive a restart: that is already refused at `conversationTimelineStore.ts:70-73` —
  persisting a slice would write conversation **content** to renderer-side web storage and survive the
  pairing boundary #757 exists to enforce. This ticket adds no persistence and must not.
- **[Inter-process / Electron attack surface] SHOULD FIX — a render-safety invariant the diff puts within
  one edit of breaking.** No IPC channel, `contextBridge` API, `webPreferences` value, protocol handler or
  navigation guard is added or changed; the transport, keys and Noise session stay in the main process
  untouched. But moving `phase` to a prop makes `InterruptControl` look collapsible into `InterruptButton`
  at the mount site, and that would lift `window.pyry.sendCommand` out of the click closure and into the
  container's render path (`ConversationScreen.tsx:1404-1406` states the discipline). `window.pyry` does
  not exist under `renderToStaticMarkup` in this repo's node environment, so the whole `store binding`
  describe would throw — which is the deterministic safety net here, not a review checklist. **Keep
  `InterruptControl` as a component**; change only its signature and its one mount.
- **[Cryptographic primitives] Not applicable — no cryptographic operation is in scope.** No randomness,
  no hashing, no key derivation, no AEAD, no Noise surface. `crypto.timingSafeEqual` does not apply: the
  three comparisons on the new path are `openConversationId === null`, `openTimeline === null` and the
  `Map` key lookup, none of which compares an attacker-controlled value against a secret.
- **[Network & I/O] Not applicable — no socket, frame, URL or timeout is in scope.** The nearest live
  exposure is inherited and unchanged: a hostile daemon inside the Noise session can grow one thread
  without bound via `assistantDelta`, and the ten-slice bound multiplies that worst case by at most ten
  (`conversationTimelineStore.ts:109-113`). A reader does not widen it — this screen renders one slice and
  retains no reference past render. A per-slice byte cap remains out of scope and belongs to its own
  ticket, as that comment already records.
- **[Error messages, logs, telemetry] No findings.** Zero `console.*` on the new path, and it must stay
  zero: a diagnostic here would carry the untrusted id and, through the slice, assistant message text —
  both barred by ADR 0007's content-free rule, restated at `conversationTimelineStore.ts:67-73`. The two
  branches (`no conversation open`, `no slice held`) are silent readings, not swallowed errors; § Error
  handling records that. Nothing new reaches the renderer console, a log file or telemetry.
- **[Concurrency] No findings.** This ticket launches no async task, registers no listener, sets no timer
  and owns no cancellable work, so there is nothing to abort and nothing that can outlive the window. It
  *removes* seven subscriptions and adds one; all tear down with the component under zustand's own
  unsubscribe. There is no check-then-act gap: every read is synchronous during render on the renderer's
  single thread with no `await` between the id read, the selector build and the slice read. The memoised
  selector is rebuilt only when `openConversationId` changes, and in production the pane remounts on that
  change anyway (`PairedShell.tsx:179`), so a stale closure cannot outlive its conversation.
- **[Threat model alignment] No findings beyond the two above.** *Malicious relay:* content-blind and
  outside the Noise session, so it cannot mint a frame that reaches this store at all; dropping, delaying
  or reordering costs rows, not correctness, and this diff adds no hang path. *Hostile daemon inside the
  session:* the actor behind the `''` finding, and separately the accepted `conversationCreated` eviction
  exposure already reasoned and accepted at `conversationTimelineStore.ts:189-199` — unchanged here, since
  a reader neither mints nor promotes a slice. *Renderer compromise reaching the transport:* unchanged —
  this diff adds no capability, no bridge surface and no new import into the renderer. *Token theft from
  disk:* not applicable; nothing is written to disk.
- **[Cross-conversation misattribution — the ticket's own threat] No findings.** Two structural defences,
  both covered: the selector is a single-key `Map.get` that can only resolve onto the requested id, and
  the nothing-open path performs no lookup. Scenarios 1, 5 and 6 assert the three readings.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-26
