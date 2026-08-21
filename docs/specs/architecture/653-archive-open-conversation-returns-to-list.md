# #653 — archiving the open discussion returns to the Channel List

## Files to read first

| Path | What to extract |
|---|---|
| `src/renderer/src/exitActiveConversation.ts` (whole file, 99 lines) | **The decision you are reusing UNCHANGED.** Read the whole docstring — it names this ticket as the intended reuse (`:86-88`), and it already documents the id gate, the clear-then-navigate ordering, the three-not-five clear set, and the session-id security payload. **You add no line to this file.** |
| `src/renderer/src/store/conversationDeletedBridge.ts` (whole file) | **The template for the new bridge.** `translate*` → `subscribe*` → `use*Exit` triple, the ref-held-callback + empty-dep-effect pattern, and the "`window.pyry` only inside the effect ⇒ PairedShell stays server-renderable" constraint. Your new module is this file with a derived signal instead of a wire arm. |
| `src/renderer/src/store/conversationListBridge.ts:16-33` | `translateConversationsEvent` — the `conversationsReceived → rows \| null` filter you **import and reuse**. Its return type is exactly your predicate's first parameter. |
| `src/renderer/src/store/conversationListBridge.ts:35-59, 71-98` | `shouldRefreshList` (why a `conversation_updated` becomes a re-list) and the "INDEPENDENT subscription" doctrine that makes a second listener on the same event correct rather than duplicated. |
| `src/renderer/src/store/conversationListStore.ts:60-72` | `selectConversations` and `selectArchivedCount`. The latter is the existing precedent for the `conversations === null` ⇒ "not loaded, not archived" arm your predicate must reproduce. |
| `src/renderer/src/PairedShell.tsx:58-71` | `exitConversationDeps` — the `Omit<…, 'navigateToList'>` module-scope deps object #652 shipped. **You reuse it as-is; you add no new deps object.** |
| `src/renderer/src/PairedShell.tsx:157-169` | The #652 wiring your new hook call sits directly beneath, and whose shape it repeats verbatim. |
| `src/shared/wire/types.ts:888-897` | `ConversationSummary` — `is_archived: boolean`, always present, never optional. The two fields you read are `id` and `is_archived`. |
| `src/renderer/src/store/activeConversationStore.ts:22-38` | The store holds `ConversationCreatedPayload \| null` — a **5-field** type with **no `is_archived`**. This is why the archived state must be looked up in the list rather than read off the active conversation. |
| `src/renderer/src/screens/channels/channelListViewModel.ts:38-49` | `partitionActive` filters `!is_archived` (#469). Half of "an archived conversation can never be sitting open when the predicate first runs". |
| `src/renderer/src/screens/archive/ArchiveScreen.tsx:55, 66` | The Archive screen's only props are `onBack` and `onRestore` — **no open affordance**. The other half of the same argument. |
| `src/main/transport/inboundMessage.ts:971-988` | `is_archived` is decoded with `requireBoolean` — fail-closed in the main process. A non-boolean never reaches the renderer. |
| `src/renderer/src/store/conversationDeletedBridge.test.ts` | The test idiom for the new suite: a fake `onDaemonEvent` emitter, `vi.fn()` callbacks, off-handle assertions. |
| `src/renderer/src/PairedShell.test.tsx:7-11` | The stated precedent for leaving container glue to composition rather than a DOM harness. Quote it in the new test's header comment. |
| `e2e/conversation-archive-lifecycle.spec.ts:95-115` | The fake-stack archive flow. **Line 105** is the `.conversation__back` click you must delete. |
| `e2e/real-daemon-conversation-lifecycle.spec.ts:113-135` | The real-daemon twin. **Line 125** is the same click. |
| `e2e/conversation-archive-lifecycle.spec.ts:155-166` | #652's non-vacuity idiom — the `.conversation` anchor at `:157` and the 1→0 delta at `:164`. **Reuse this shape; do not invent a second idiom.** |
| `e2e/workspace-picker.spec.ts:143` **and** `:196` | AC4's **two** vacuous closing assertions (see § Corrections — the ticket names only the first). |
| `e2e/fixtures/conversationStateFake.ts:138-170` | The fake's `archive_conversation` and `change_workspace` arms — both answer `conversation_updated`, which is what makes both the AC1 proof and the AC4 pin non-vacuous. |

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-94 (Archive action) · https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=15-8 (Channel List)

Node 20-94 is a single pill-shaped Archive button (186×40, fully rounded) on a dark surface-container fill with centered on-surface label text — the same pill geometry as the Delete action (20-96) beside it in the sheet's Actions section; node 15-8 is the Channel List this returns to. **Both surfaces are already built and are unchanged by this ticket** — no component, token or markup edit is prescribed here.

**N/A for the transition itself** — the design file has no node for the post-archive return, and this ticket introduces no new visual, only navigation between two already-locked screens. Code-review's visual-fidelity check is intentionally scoped to "neither surface changed".

## Context

Archiving the open discussion fires `archive_conversation` and closes the Channel Info sheet, and nothing else happens: `onArchive` is `requestArchiveConversation(...)` then `onClose()` (`ConversationScreen.tsx:1681-1687`), and `onClose` closes the *sheet*, not the thread. The row leaves the Channel List (#469's `partitionActive` filters it), but the thread stays open, rendering rows for a discussion the operator has filed away and still accepting input into it.

#652 already built the expensive half. `exitActiveConversation` is a finished, tested decision whose own docstring names this ticket as the intended reuse. **Only the trigger is new**, and this ticket adds exactly that: a predicate, the subscription that runs it, and one `PairedShell` line.

**Navigate on the daemon's confirmation, not on the click** — the rule `useConversationCreatedNav` and #652 both follow. An archive the daemon never confirms leaves the operator in the thread (AC5).

### Why the signal is the conversation list, not the `conversationUpdated` event

The ticket lays out two options and leaves the choice here. **Option A — derive it from the daemon's authoritative list.** Three facts settle it:

1. **`conversationUpdated` as decoded carries no archive flag.** `ConversationUpdatedPayload` (`types.ts:1132`) is five fields; `inboundMessage.ts:1073` names `is_archived` as a tolerated-but-not-copied key. It fires on promote, rename, archive, unarchive and change-workspace alike, and three of those are reachable on this very conversation from inside this very thread. Gating on its *occurrence* trades this bug for a worse one — that is what AC3 and AC4 exist to fail.
2. **The active conversation record cannot answer the question either.** `activeConversationStore` holds a `ConversationCreatedPayload` — a 5-field type with no `is_archived` (`activeConversationStore.ts:25`). Even when the operator opened the thread from a `ConversationSummary` (which *does* carry the flag), the store's declared type hides it. The lookup has to happen against the list.
3. **`ConversationSummary.is_archived` is always present** (`types.ts:892`, no `omitempty`, `requireBoolean`-decoded), `conversationListStore` holds the daemon's rows verbatim including archived ones, `ConversationListData` is mounted app-level so the store stays live while the thread is on screen, and `shouldRefreshList` already re-requests the list on every `conversationUpdated`. The signal is already flowing; nothing new has to be plumbed.

**Option B is foreclosed harder than the ticket's body says** — see § Corrections. It is out of scope regardless, per the ticket's own "if the architect prefers B, it needs its own wire ticket first".

### The predicate is level-based, and reads the event's rows rather than the store

The predicate is **"the active conversation's row says `is_archived`"** — a level, not an edge. That is what makes AC1 trigger-agnostic for free: it fires on *any* list refresh that reveals the flag, whoever caused it, with no notion of "the operator clicked Archive".

The rows are read **off the `conversationsReceived` event**, not out of `conversationListStore`. Both are written by the same event, so they cannot disagree — but reading the event removes any dependence on whether `conversationListBridge`'s listener happened to run before ours. Two independent subscriptions with no ordering contract between them is exactly the arrangement `conversationListBridge.ts:78-79` already documents; reading the event keeps it that way.

## Design

Two production files: one new bridge, one wired line. `exitActiveConversation.ts` and `ConversationScreen.tsx` are untouched.

### 1. `src/renderer/src/store/conversationArchivedBridge.ts` — NEW, the derived signal

The `conversationDeletedBridge` twin, three exports, each React-free except the last:

```ts
export function archivedActiveConversationId(
  conversations: readonly ConversationSummary[] | null,
  activeConversationId: string | null
): string | null

export function subscribeArchivedActiveConversation(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  getActiveConversationId: () => string | null,
  onArchived: (conversationId: string) => void
): () => void

export function useArchivedActiveConversationExit(
  getActiveConversationId: () => string | null,
  onArchived: (conversationId: string) => void
): void
```

- **`archivedActiveConversationId`** — returns `activeConversationId` when the list holds a row with that id whose `is_archived` is `true`; `null` otherwise. Four ways to get `null`, and each is a required behaviour rather than defensive padding: `conversations === null` (**not loaded is not archived** — the `selectArchivedCount:71-72` posture), `activeConversationId === null` (no thread open), **no row with that id** (a *deleted* conversation is absent, not archived — #652's bridge owns that case and this one must not double-claim it), and a row present with `is_archived: false` (the AC3/AC4 arm: rename and change-workspace leave the flag alone). Reads exactly two fields, `id` and `is_archived`. Returns the id rather than a boolean so the call site has nothing to re-derive.
- **`subscribeArchivedActiveConversation`** — one listener: run `translateConversationsEvent` (imported from `conversationListBridge`), return early on `null`, otherwise run the predicate against `getActiveConversationId()` and invoke `onArchived` when it yields an id. Guard on `!== null`, never truthiness (the `conversationListBridge.ts:82-84` doctrine). Returns the off handle for use as effect cleanup. The listener only invokes the callback — it never throws into React.
- **`useArchivedActiveConversationExit`** — the `useConversationDeletedExit` shape verbatim: the latest `onArchived` held in a ref refreshed by a bare effect, the subscription established once in an empty-dep effect with the off handle as cleanup (a StrictMode double-mount nets exactly one live listener). `window.pyry` is dereferenced **only inside the effect**. `getActiveConversationId` is passed through to the subscription inside that same effect and is **not** a dependency — it is a stable module-scope arrow at the only call site (see § 2), and treating it as a dep would re-establish the subscription on every render.

**Reuse `translateConversationsEvent`; do not re-declare the switch.** This bridge consumes the *same* arm as `conversationListBridge`, unlike the created/deleted bridges which each own a distinct one. Two copies of one `case 'conversationsReceived'` would be two places to update. It is an import of an already-exported pure function, not a refactor of adjacent code.

**Why the store is imported by neither the predicate nor the subscription.** `conversationCreatedBridge` and `conversationDeletedBridge` import no store — bridges are event plumbing, `PairedShell` owns store wiring. `getActiveConversationId` is injected to keep that boundary, which also makes the whole path testable with plain spies.

**Naming.** `conversationArchivedBridge` sits beside its two siblings and reads the same way, but its docstring must say plainly that — unlike them — **it owns no wire arm**: there is no `conversationArchived` event, the signal is derived from `conversationsReceived`. A developer who later greps for a matching `DaemonEvent` member must find that sentence instead of a puzzle.

### 2. `src/renderer/src/PairedShell.tsx` — MODIFIED, the wiring

One import and one hook call, directly beneath the #652 wiring:

```tsx
useArchivedActiveConversationExit(
  () => exitConversationDeps.getActiveConversation()?.id ?? null,
  (conversationId) =>
    exitActiveConversation(
      { ...exitConversationDeps, navigateToList: () => dispatch({ type: 'back' }) },
      conversationId
    )
)
```

**No new deps object.** `exitConversationDeps` (`:66-71`) already holds the four store effects, and its `getActiveConversation` doubles as the id source — so the bridge's gate and the helper's gate read the *same* getter and cannot disagree about which conversation is on screen. The first arrow is module-scope-stable in everything it closes over, and the second is held in the hook's ref and re-read per delivery, so neither needs memoizing and the subscription never re-establishes. **PairedShell still subscribes to no store**, so its "re-renders only on its own nav dispatch" and server-renderable properties hold.

`{ type: 'back' }` reuses the existing absolute `back` arm (`pairedRoute.ts:54-55`). **No new `PairedNav` arm, no `PairedRoute` member, no reducer edit.**

### The double gate is deliberate

The bridge decides "the conversation on screen just showed up archived"; `exitActiveConversation` independently re-checks the id. Redundant, and kept: it is what allows `exitActiveConversation` to ship **unmodified**, and both reads happen inside one synchronous listener body so they cannot observe different state.

### Idempotence, and why a level predicate cannot thrash

An archived conversation stays archived across every subsequent re-list, so a level predicate must not re-fire. It cannot:

- After the first exit, `clearActiveConversation()` makes `getActiveConversationId()` return `null`, so the predicate returns `null` on every later arrival — the bridge never even calls back. `exitActiveConversation`'s own gate is a second, independent stop.
- An already-archived conversation cannot be sitting open when the predicate first runs: `partitionActive` filters archived rows out of the Channel List (`channelListViewModel.ts:44-49`) and the Archive screen exposes only restore and back (`ArchiveScreen.tsx:55, 66`) — there is no affordance that opens one. Verified, not assumed.
- If one ever could, the predicate would evict it immediately, which is the wanted behaviour anyway. The failure direction is safe.

### Not touched

`ConversationScreen.tsx` gets **no edit** — `onArchive` keeps firing the command and closing the sheet; the sheet unmounts with the thread when the route flips. `exitActiveConversation.ts` gets **no edit**. `conversationListBridge.ts` gets **no edit** — its export is imported, not changed. No wire type, no decoder, nothing under `src/main/`.

## State + concurrency model

Read and written entirely through injected effects; the four stores `exitActiveConversation` touches are unchanged from #652 (`activeConversationStore` read-then-clear, `timelineStore` reset, `sessionIdStore` clear, plus the nav `dispatch`). This ticket adds exactly one new **read**: the `conversationsReceived` event's rows, off the event object.

No async work, no cancellation surface, no `AbortController`. The only lifecycle object is the bridge subscription, torn down by the effect cleanup when the shell unmounts on unpair. The listener body spans **no `await`** — translate, predicate, gate, three clears and a dispatch are all synchronous on the renderer's single thread, so the check-then-act cannot interleave and React batches the writes into one commit.

**Listener ordering is a non-issue, in both directions.** `ConversationListData`'s listener (which writes `conversationListStore`) and this one are independent subscriptions on the same event with no ordering contract. Ours reads the event, not the store, so it does not care which ran first — and because both run synchronously inside one event dispatch, React commits a single frame either way. In practice the store write lands first (the app-level component mounts before the shell), which means **there is no stale-row window on this half at all**: the same arrival that triggers the exit has already removed the archived row from `partitionActive`. That is strictly better than #652's delete path, where the nav precedes the re-list by a round trip.

## Error handling

There is no failure mode to surface. The predicate is total, the subscription performs no I/O and sends no command, and the helper is the unchanged total function #652 shipped.

Failure modes that exist *around* it and are deliberately not handled here:

- **An archive the daemon never confirms** — no `conversation_updated`, no re-list, no `conversationsReceived`, no navigation. That is AC5 and it is the designed behaviour, not an unhandled error.
- **A `conversationsReceived` arriving for an unrelated reason while an archive is unconfirmed** — the row still reads `is_archived: false`, so nothing fires. AC5 holds against a reconnect re-list, not just against silence.
- **A malformed `conversations` reply** — already fails closed in the transport (`inboundMessage.ts:984` `requireBoolean`), so no event reaches the renderer.
- **A row missing from the list** — a delete, owned by #652's bridge. Absent is not archived; this predicate returns `null` and does not double-claim the case. (Were both to fire, the second would no-op on the id gate — safe either way.)
- **The archive succeeding on the daemon but its reply being lost** — a later re-list for any reason reveals the flag and the exit runs then. Correct: the discussion *is* archived.

## Testing strategy

Unit (`npm test`, vitest, node env, server-render only — no DOM harness, no clicks, no `@testing-library`).

**Do not re-test `exitActiveConversation`.** It is unchanged and `exitActiveConversation.test.ts` already covers the clears, the ordering and the id gate. Adding a second suite over it is duplicated cost.

**`src/renderer/src/store/conversationArchivedBridge.test.ts`** — the `conversationDeletedBridge.test.ts` fake-emitter idiom:

*`archivedActiveConversationId`:*
- Active id present, its row carries `is_archived: true` → returns that id.
- Active id present, its row carries `is_archived: false` → `null`. **This is the AC3/AC4 arm** — say so in the test name; rename and change-workspace both land here.
- Active id present, **no row with that id** in the list → `null` (the delete case, owned by #652).
- `conversations === null` (not loaded) → `null`, with the active id set.
- `activeConversationId === null`, list containing archived rows → `null`.
- A list holding an archived row for a *different* conversation while the active one is unarchived → `null`. Pins that the lookup is by id, not "any archived row".

*`subscribeArchivedActiveConversation`:*
- A `conversationsReceived` whose active row is archived → `onArchived` invoked exactly once with the id.
- A `conversationsReceived` whose active row is not archived → zero calls.
- A `conversationUpdated` event → zero calls. **The load-bearing bridge test**: it pins that the occurrence of an update is not the signal.
- Other unrelated arms (at minimum `conversationCreated`, `conversationDeleted`) → zero calls.
- Two consecutive archived-row arrivals with the getter returning the id then `null` (simulating the clear the first exit performs) → exactly one call. Idempotence at the bridge.
- The returned off handle stops further delivery.

**Not unit-tested, by precedent:** the `PairedShell` glue. The route transition is proved by composing the separately-tested `nextPairedRoute` (`back → list`, already covered) with the separately-tested predicate and the separately-tested helper — the reasoning `PairedShell.test.tsx:7-11` states. Quote it in the new test file's header comment.

**Type coverage:** `npm run typecheck` covers both projects, but the script is `node && web` and `&&` short-circuits — if the node half fails the web half never runs. Re-run `tsc -p tsconfig.web.json` directly if in doubt. `npm run build` is the gate.

### e2e — two required deletions, two required pins

`e2e/` is outside both tsconfigs, so `npm run typecheck` sees none of this. **Run both configs**: bare `npx playwright test` `testIgnore`s every `real-*` spec (`playwright.config.ts:14`), so editing the real-daemon twin and running only the default config reports a false green. Run `--config playwright.real-claude.config.ts` as well.

**(a) The collision — `e2e/conversation-archive-lifecycle.spec.ts:105` and `e2e/real-daemon-conversation-lifecycle.spec.ts:125`.** Both click `.conversation__back` immediately after the Archive pill to reach the Archive view. Once the app returns on its own, that control is unmounted by the time the click runs, Playwright's auto-wait times out, and both specs fail. **Deleting both lines is mandatory, not optional.** In each spec:

1. **Add a non-vacuity anchor** immediately *before* the Archive pill click: `.conversation` at `toHaveCount(1)`. The Channel Info sheet is open at that point and renders inside `ConversationScreen`, so the thread root is present — the same position #652 uses at `:157`.
2. **Delete** the `await page.locator('.conversation__back').click()` line.
3. **Add the navigation assertion** where it stood: `.conversation` at `toHaveCount(0)` with `ROUNDTRIP_TIMEOUT_MS` (it auto-waits archive → `conversation_updated` → re-list → `conversations` → exit — **two** round trips, not one).
4. Leave the following `.channel-list__archive` click and the Discussions/Channels tab assertions exactly as they are. With the manual navigation gone, that click can only resolve if the app navigated by itself — but per the ticket, **do not let it be the only proof**: the `.conversation` 1→0 delta is the load-bearing assertion, and the anchor in step 1 is what makes it a transition rather than an assertion against a surface that was never mounted. Update the comment to say so.

**(b) AC4's pin — `e2e/workspace-picker.spec.ts`, at BOTH `:143` and `:196`.** Each test closes on `.workspace-picker__row` → count 0, which passes just as well if the app wrongly navigated to the list. In each, after the existing closing assertions:

1. Poll `captured` until a `list_conversations` frame appears **after** that test's `change_workspace` frame. This is the sync point that makes the pin non-vacuous: the re-list request is fired by the very same `subscribeConversations` listener that processes the `conversation_updated`, so its presence proves the renderer has handled the event a wrongly-gated implementation would navigate on.
2. Then assert `.conversation` at `toHaveCount(1)` — the positive "still in the thread" the ticket asks for.

The fake answers both `change_workspace` and the create-folder chain's `change_workspace` with a `conversation_updated` (`conversationStateFake.ts:164-170`), so both tests really do drive a `conversationUpdated` → re-list → `conversationsReceived` cycle with the active conversation present and **not** archived. That is precisely the input that must move nothing.

**AC3 needs no new spec.** `e2e/conversation-create-rename.spec.ts:100` renames the open discussion and *then* clicks `.conversation__back`; an implementation that wrongly navigates on `conversationUpdated` unmounts that control and the click times out. Free detector, already live — leave the file alone.

## Acceptance criteria → where each is proved

| AC | Proof |
|---|---|
| 1 — becomes archived ⇒ returns to the Channel List | Unit: predicate yields the id, `subscribeArchivedActiveConversation` invokes the callback. Composition: `exitActiveConversation` (already tested) calls `navigateToList`; `nextPairedRoute` `back → list` (already covered). e2e: the `.conversation` 1→0 delta in both lifecycle specs. |
| 2 — no row of the archived discussion remains on the thread surface | `exitActiveConversation`'s `dispatchTimeline({ type: 'reset' })`, already covered by #652's integration test. e2e: the whole `.conversation` surface goes to 0. No new production line. |
| 3 — renaming does not navigate | Unit: the `is_archived: false` predicate arm + the `conversationUpdated` → zero-calls bridge test. e2e: the existing free detector at `conversation-create-rename.spec.ts:100`. Zero production lines. |
| 4 — changing the workspace does not navigate | Same two unit arms. e2e: the new positive pins at `workspace-picker.spec.ts:143` and `:196`. Zero production lines. |
| 5 — no daemon confirmation ⇒ no navigation | Structural: nav happens only inside the `conversationsReceived` listener, and an unconfirmed archive leaves the row `is_archived: false` even if an unrelated re-list arrives. Unit: the not-archived and unrelated-arm cases at zero calls. Zero production lines. |

## Scope check

Production source files (`.ts`/`.tsx`, excluding tests and this spec): **2** — one created (`conversationArchivedBridge.ts`), one modified (`PairedShell.tsx`). New exports: **3**. Gate branches: **1** (plus the predicate's four `null` arms, which are one expression, not a state machine). Consumer call sites needing simultaneous update: **0** — purely additive, no existing signature moves, `exitActiveConversation` and `translateConversationsEvent` are consumed unchanged. Projected total written work ≈ 270 lines across production, the bridge test and the four e2e edits.

Well inside every red line, and materially smaller than #652 — which built the decision this ticket only wires up.

## Corrections to the ticket body

Two, both verified, and the first is load-bearing enough to change what AC1 can promise.

**1. `conversation_updated` on archive is a reply to the requester, NOT a broadcast — so no signal delivers the second-client case live.** The Technical Notes say *"A second client archiving the discussion the operator is reading should also return them to the list, and both candidate signals give that for free."* That is false. pyrycode#881's spec settles it explicitly: `dispatch.Conn` exposes `Send` and `Reply` but no `Broadcast`, both producers (rename, archive) deliver `conversation_updated` via `c.Reply` correlated by `in_reply_to`, and *"**Live fan-out to other connected clients is OUT OF SCOPE**… other clients see the change on their next `list_conversations`."* The `ConversationUpdatedPayload` doc-comment calling it a "broadcast" is inaccurate — #881 says so in as many words — and `conversationListBridge.ts:37` inherits the same wrong word. `real-daemon-conversation-lifecycle.spec.ts:117` is the one place in this tree that has it right.

What this does *not* change: the design, or AC1 as literally written. What it changes is the claim's honesty, in three ways worth recording:

- A second client's archive produces **no event at all** on this client, so nothing fires until this client's next `list_conversations` — which it issues on every connect and on every one of its own conversation mutations. The level predicate then picks it up. So the second-client case resolves **eventually, not live**, and that is a daemon fan-out gap, not a client design choice.
- The level predicate is what makes it work at all. An edge/click-based design would never pick it up. This is the strongest argument for AC1's trigger-agnostic phrasing — stronger than the one the ticket gives.
- **It removes an argument for option B.** B could not fix this either: the reply is correlated to the requester, so a second client receives no `conversation_updated` to read `is_archived` off. B buys one round trip on the local path and nothing on the remote one, at the cost of a `src/main/` wire change. Option A is correct on the merits, not merely cheaper.

**2. AC4 has two vacuous e2e sites, not one.** The ticket names `workspace-picker.spec.ts:143`. The create-folder chain test in the same file closes identically at `:196` (`.workspace-picker__row` → count 0, preceded by `.create-folder` → count 0), and it drives the same `change_workspace` → `conversation_updated` → re-list cycle through `CreateFolderDialog.tsx:163`. Both need the pin; § Testing covers both.

## Open questions

- **The `list_conversations` sync point in `workspace-picker.spec.ts`.** The step-1 poll assumes outbound `list_conversations` frames land in that spec's `captured` array (it is a general envelope capture, and the connect-time re-list should already appear there — which is exactly why the assertion must look for one *after* the `change_workspace` index, not merely for one's existence). Confirm on the first run; if the capture turns out to be verb-filtered, fall back to asserting `.conversation` count 1 immediately after the existing closing assertions and note in the comment that the pin then covers only the synchronous path.
- **Inherited limitation, explicitly out of scope: the exit navigates absolutely.** `exitActiveConversation` gates on the id but not the route, and `nextPairedRoute`'s `back` is absolute, so a confirmation landing while the operator has left the thread for Settings, Archive or Pair-server yanks them to the Channel List. This shipped in #652 and is inherited, not introduced — but the window is **wider** here, because the signal costs two round trips and "archive, then go look at the Archive screen" is a natural flow in a way its delete equivalent is not. Unobserved, and every move fails safe (all clears). **Do not fix it here** — a route-aware `back` means a new `PairedNav` arm and would push this past S. If it earns a fix, it is its own ticket covering both halves.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. One boundary applies: the daemon's `conversations` reply. It is narrowed and fails closed in the **main** process — each row is rebuilt field-by-field with `requireBoolean(payload, 'is_archived')` and friends (`inboundMessage.ts:971-988`), so a non-boolean `is_archived` throws `WireDecodeError` and no event reaches the renderer. It then crosses IPC as the already-typed `readonly ConversationSummary[]` (`events.ts:395`). This ticket reads exactly two fields off those rows: `id`, which is **only ever compared** (never rendered, logged, persisted, or sent back), and `is_archived`, a decoded boolean used only as a branch condition. No escaping, sanitisation or length concern applies. The renderer gains **no new data**: these exact rows already populate `conversationListStore` on the app-level subscription, and this ticket adds a second reader of an event it already receives.
- **[Tokens / secrets]** No findings, and this is the ticket's security payload — inherited verbatim from #652 and the reason the `security-sensitive` label is correct on a renderer-only change (the #530/#531/#593 state-clear family). The daemon session id is *cleared*, never read, logged or transmitted. Clearing it makes `RunConfigSections`' `onChange` `undefined`, so the Run configuration controls render **inert** instead of addressing a YOLO / auto-approval write to a session scoped to a discussion the operator has filed away. Verified logging-free: neither `sessionIdStore` nor `timelineStore` has a diagnostics observer, so neither clear emits a record. The new bridge MUST NOT log (ADR 0007 content-free): the conversation `id` is the only field a diagnostic here would want, and there is no observed failure to instrument.
- **[File / storage]** Not applicable by design rather than omission: the change touches in-memory Zustand stores and a `useReducer`. No filesystem path is constructed, nothing is persisted, nothing reaches `localStorage` / IndexedDB / the renderer disk cache. `cwd` — the one untrusted path-shaped field on `ConversationSummary` — is **not read by this ticket at all**.
- **[Electron attack surface]** No findings. No `webPreferences` change, no new `contextBridge` API, no new `ipcMain` channel, no new `RendererCommand`, no custom-protocol or deep-link handler, and no navigation-affecting code (the "navigation" here is an internal React route flip, not a `will-navigate`). The new bridge subscribes through the existing `window.pyry.onDaemonEvent` and **sends nothing** — strictly narrower than both `conversationListBridge` and `conversationCreatedBridge`, which also send commands. `window.pyry` stays dereferenced only inside effects, so no privileged handle is read during render. Keys, sockets and the Noise session remain wholly in the main process; **nothing in this ticket moves toward the renderer, and nothing crosses into `src/main/` or the wire contract** — which is precisely why option B was refused rather than merely deferred.
- **[Cryptographic primitives]** Not applicable — no RNG, no comparison against a secret, no key or nonce, no handshake code. The comparisons (`row.id === activeConversationId`, and the helper's own `?.id !== conversationId`) are between two non-secret conversation identifiers, so `===`/`!==` are correct and `timingSafeEqual` would be cargo-culting.
- **[Network & I/O]** No findings. The bridge performs no I/O: no command is sent, no socket is opened, no frame is written, and it adds no new inbound path — the frame it reacts to is already decoded and capped upstream by the existing `MAX_PLAINTEXT_BYTES` check. It cannot introduce an unbounded read, a missing timeout, or a reconnect loop.
- **[Errors, logs, telemetry]** No findings. The predicate is total, the listener has no throw path, and there is no log line, no user-facing error string, and no telemetry. Deliberate silence, not an omission (see Tokens). A developer adding a `console.log` carrying the id during implementation would be an ADR 0007 violation; code-review should check for it.
- **[Concurrency]** No findings, and two properties are worth naming as *why*. First, the listener body spans **no `await`**: translate → predicate → gate → three clears → dispatch are synchronous on the renderer's single thread, so nothing can change the active conversation between the bridge's read and the helper's re-read, and React batches the writes into one commit. Both gates read through the *same* injected getter, so they structurally cannot disagree. Second, subscription lifetime is the established off-handle-as-effect-cleanup idiom (exactly one live listener under a StrictMode double-mount), torn down when the shell unmounts on unpair — an arrival while unmounted reaches no listener, which is right, because `clearPairingScopedState` has already cleared everything this path would clear.
- **[Re-entrancy / repeated firing]** No findings — the one category genuinely new versus #652, because a **level** predicate re-evaluates on every list arrival where a discrete event fires once. Closed by construction at two independent layers: after the first exit `clearActiveConversation()` makes the getter return `null`, so the predicate short-circuits and the callback is never invoked again; and `exitActiveConversation`'s own id gate stops anything that somehow got through. No flag, no guard, no `useRef` latch. The reachability question behind it was verified rather than assumed: no affordance can open an already-archived conversation (`partitionActive` filters them from the Channel List, `ArchiveScreen` exposes only restore and back), and if one ever could, the predicate would evict it immediately — the safe direction.
- **[Threat model — hostile relay]** No findings; relay-hostile-safe in both directions. The relay is content-blind and on-path: it cannot **forge** a `conversations` reply (that requires producing an AEAD-sealed frame inside the Noise session), only **drop**, **delay** or **reorder**. A dropped reply ⇒ no arrival ⇒ no navigation, which is AC5 and the fail-safe direction. A delayed reply landing after the operator opened a different discussion ⇒ the id lookup finds a different active id and the predicate returns `null`, which is AC4's shape. **Reordering two `conversations` replies is safe in both orders**: stale-then-fresh fires correctly on the fresh one; fresh-then-stale has already cleared the active conversation, so the stale reply's `is_archived: false` row cannot "un-exit" anything — the exit is not reversible by a later arrival, and no code path re-opens a thread from a list reply. All three hostile-relay behaviours land on an AC this ticket already pins.
- **[Threat model — hostile / buggy daemon]** SHOULD FIX (documented, no code change) — the same finding #652 records, restated for this trigger. A daemon that reports `is_archived: true` for the conversation on screen evicts the thread, whether or not the operator archived anything. Impact is bounded to availability/UX: no secret is disclosed and no privileged action is enabled, because **every state move is a clear** (rows dropped, active conversation cleared, session id cleared ⇒ Run config inert, no id left to send). The only actor able to produce such a frame is the peer inside the Noise session — the daemon — which can already archive the conversation for real and serves all its content anyway, so no client-side check raises the bar against that adversary. The requirement this pass imposes is honesty, not code: the predicate means *"the daemon's authoritative list says the conversation on screen is archived"*, **not** *"my archive request succeeded"*. No comment may claim otherwise.
- **[Threat model — stale-row window]** No findings, and this half is **strictly better than #652's**, which is worth recording so code-review does not re-derive the delete path's caveat here. #652 navigates one round trip *before* its re-list, briefly leaving the deleted row clickable on the Channel List. This ticket navigates **on** the re-list arrival, and the same arrival has already written `conversationListStore`, from which `partitionActive` filters the archived row. The operator therefore lands on a list that already excludes it. Even were the two independent listeners to run in the other order, both execute synchronously within one event dispatch, so React commits a single frame and no intermediate state is observable.
- **[Threat model — renderer compromise reaching the transport]** No findings. Nothing new crosses `contextBridge`; a compromised renderer gains no reach it did not already have, and the net effect on that adversary is *negative surface* — one fewer live conversation id and one fewer live session id held in renderer memory after an archive.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-21
