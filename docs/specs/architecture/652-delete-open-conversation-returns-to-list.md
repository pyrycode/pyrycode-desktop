# #652 — deleting the open discussion returns to the Channel List and clears its thread state

## Files to read first

| Path | What to extract |
|---|---|
| `src/renderer/src/activateConversation.ts` (whole file, 80 lines) | **The template for the new helper.** Injected-effects interface, the `previous?.id !== conversation.id` gate idiom, the clear-then-act ordering rule, and the session-id-clear security note you must carry over verbatim in spirit. |
| `src/renderer/src/clearPairingScopedState.ts:35-97` | The five-clear set and, crucially, *why each store is in or out*. You are NOT reusing this function — read it to understand which two of its five clears must **not** fire here. |
| `src/renderer/src/store/conversationCreatedBridge.ts` (whole file, 95 lines) | **The template for the new bridge.** `translate*` filter → `subscribe*` → `use*Nav` hook, the ref-held-callback + empty-dep-effect pattern, and the "`window.pyry` only inside the effect ⇒ PairedShell stays server-renderable" constraint. |
| `src/renderer/src/PairedShell.tsx:28-59` | The two module-scope deps objects (`activateDeps`, `clearPairingDeps`) — the `getState()`-inside-the-arrow idiom your new deps object must follow. |
| `src/renderer/src/PairedShell.tsx:126-145` | The container: `useReducer(nextPairedRoute, 'list')` plus the three existing hook wirings. Your hook call goes beside `useConversationCreatedNav`. |
| `src/renderer/src/store/conversationListBridge.ts:35-59, 71-98` | The *other* consumer of `conversationDeleted` (the re-list). Read the "creator-only by construction" and "INDEPENDENT subscription" notes — they explain why a second subscription is correct and still fires exactly one re-list. |
| `src/renderer/src/pairedRoute.ts:37-69` | `nextPairedRoute`'s `back` arm is absolute and already lands on `list`. No new arm, no reducer change. |
| `src/shared/ipc/events.ts:414-424` | The `{ type: 'conversationDeleted'; id: string }` arm — a bare string id, no payload object. |
| `src/renderer/src/store/activeConversationStore.ts:28-57` | `clearActiveConversation` returns `initialActiveConversationState` by reference — clearing an already-clear store churns no subscriber. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:1616-1627, 1689-1703` | `requestDeleteConversation` + the sheet's `onDeleteConfirm`. **Confirm for yourself that this file needs no edit** — the click stays exactly as it is. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:1275-1300` | The queued-backlog selector: with no active conversation the `''` sentinel yields the stable empty backlog. This is why the queue store is *not* in the clear set. |
| `src/renderer/src/screens/conversation/composerSend.ts:41-49` | `submitMessage` returns `false` on a `null` conversation id — the send half of AC3 needs no new guard. |
| `src/renderer/src/activateConversation.test.ts:1-60` | The test idiom: a `spyDeps()` factory of `vi.fn()`s, then integration cases wiring real isolated `create*Store()` instances. |
| `src/renderer/src/PairedShell.test.tsx:7-11` | The stated precedent for leaving container glue to composition — quote it in your new test's header comment. |
| `e2e/conversation-archive-lifecycle.spec.ts:142-174` | The fake-stack delete flow. Line 161 is the `.conversation__back` click you must delete. |
| `e2e/real-daemon-conversation-lifecycle.spec.ts:164-196` | The real-daemon delete flow. Line 185 is the same click. |

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-96 (Delete action) · https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=15-8 (Channel List)

Node 20-96 is a single pill-shaped Delete button on a dark surface-container fill with centered on-surface label text; node 15-8 is the Channel List — the Pyrycode header with its settings gear, a "Channels" section of avatar rows, a "Recent discussions" section of title+preview rows, the "See all discussions (n)" link and the create FAB. **Both surfaces are already built and are unchanged by this ticket** — no component, token or markup edit is prescribed here.

**N/A for the transition itself** — the design file has no node for the post-delete return; this ticket introduces no new visual, only navigation between two already-locked screens. Code-review's visual-fidelity check is intentionally scoped to "neither surface changed".

## Context

Deleting the open discussion fires `delete_conversation` and closes the Channel Info sheet, and nothing else happens: `onDeleteConfirm` is `requestDeleteConversation(...)` then `onClose()` (`ConversationScreen.tsx:1699-1700`), and `onClose` closes the *sheet*, not the thread. The row leaves the Channel List (the `#376` re-list works), but the thread stays open, rendering rows for a discussion the daemon no longer holds.

Underneath sits the second-order defect: `activateConversation` clears the previous conversation's rows and session id **only when the id changes** (`activateConversation.ts:74`). A delete changes no id, so the destroyed discussion stays recorded as the active conversation, and the two thread actions that carry a conversation id keep addressing it. There is no send-failure surface, so the daemon's `conversation.not_found` is silent.

Everything the fix needs already exists — the confirmation event, the back nav, and both clears. This is a wiring gap, and the whole change is three production files: one pure decision helper, one event bridge, and the PairedShell line that joins them.

**Navigate on the daemon's confirmation, not on the click.** `useConversationCreatedNav` sets the precedent in the opposite direction: a create the daemon never confirms simply does not navigate (`PairedShell.tsx:119-122`). The symmetric rule here is that a delete the daemon never confirms leaves the operator where they are.

## Design

### 1. `src/renderer/src/exitActiveConversation.ts` — NEW, the pure decision

A framework-free, React-free helper co-located with `PairedShell` beside `activateConversation.ts`, `clearPairingScopedState.ts` and `pairedRoute.ts`, with every effect injected so it is a total function testable with plain spies.

```ts
export interface ExitActiveConversationDeps {
  getActiveConversation: () => ConversationCreatedPayload | null
  dispatchTimeline: (event: ThreadEvent) => void
  clearActiveConversation: () => void
  clearSessionId: () => void
  navigateToList: () => void
}

/** If `conversationId` is the active conversation, drop its thread state and return to the list.
 *  A mismatch (or no active conversation) is a total no-op. */
export function exitActiveConversation(
  deps: ExitActiveConversationDeps,
  conversationId: string
): void
```

Behaviour, in one paragraph:

- **The gate is the id**, read through the getter at invocation time — `deps.getActiveConversation()?.id !== conversationId` returns immediately. The `?.` handles the null-active arm with no special case, exactly as `activateConversation.ts:74` does. A getter rather than a threaded value, for `activateConversation`'s documented reason: PairedShell's bridge callback is held in a ref refreshed in a bare (post-commit) effect, so a callback closing over a render-time value could compare against a stale previous.
- **On a match: clear, then navigate — in that order.** `dispatchTimeline({ type: 'reset' })`, `clearActiveConversation()`, `clearSessionId()`, then `navigateToList()`. The three clears are independent whole-value writes with no ordering constraint among themselves; the nav is strictly last, the ordering both existing clear helpers document — no observer may see the Channel List rendered against the deleted discussion's thread state. All four are synchronous, so on the renderer's single thread nothing can interleave and React batches them into one commit.
- **Total.** No return value, no throw path, no logging. A diagnostic here would want the conversation id to be useful, which ADR 0007's content-free rule forbids, and there is no observed failure to instrument (`activateConversation.ts:60-61`).
- **Idempotent by construction.** After a successful exit `activeConversation` is `null`, so a second delivery of the same id fails the gate. No flag, no guard.

**Why `navigateToList` is an injected effect rather than a returned boolean.** AC4 and AC5 are both statements about navigation *not happening*. Putting the nav inside the gated body makes both directly assertable on a spy in the unit suite; returning a boolean would push "did it navigate?" into the container glue, which is reviewed rather than tested (see § Testing).

**Why the name is `exitActiveConversation` and not `exitDeletedConversation`.** The decision — "if this id is the one on screen, leave it" — is the seam #653 (the archive half) reuses verbatim; only the triggering event differs. A neutral name costs nothing now and saves a rename cascade then. This does **not** mean building the archive path here: nothing archive-shaped is in scope.

**Clear set — three, not five, and not `clearPairingScopedState`.** Do not reuse `clearPairingScopedState`: it additionally does `dispatchSession({ type: 'reset' })` and `clearAnnouncedModel()`. The pairing has *not* ended — the daemon connection is alive and the operator lands on a working Channel List — so resetting the session store would blank a live connection status into a false disconnected state, and clearing the announced running model would drop daemon-scoped, not conversation-scoped, state. The correct precedent is `activateConversation`'s clear branch (timeline `reset` + `clearSessionId`) **plus** `clearActiveConversation`, which that helper deliberately excludes only because it immediately re-sets the value (`activateConversation.ts:25-27`). Here there is no successor conversation, so the clear is the point.

**Stores deliberately left out, with the reason** (record these in the doc comment so the next ticket does not re-litigate them):

- `queueStore` — the backlog is selected by matching the active conversation id, and a `null` active id yields the stable empty backlog via the `''` sentinel (`ConversationScreen.tsx:1283-1284`). No stale queued row can render, so none can be dropped.
- `announcedModelStore`, `sessionStore` — pairing-scoped, not conversation-scoped; `activateConversation` clears neither on a conversation switch.
- `conversationListStore` — the `#376` re-list already re-authors it.

### 2. `src/renderer/src/store/conversationDeletedBridge.ts` — NEW, the event seam

The `conversationCreatedBridge` twin, three exports, each React-free except the last:

```ts
export function translateConversationDeleted(event: DaemonEvent): string | null
export function subscribeConversationDeleted(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  onDeleted: (conversationId: string) => void
): () => void
export function useConversationDeletedExit(onDeleted: (conversationId: string) => void): void
```

- `translateConversationDeleted` — `switch` with one `case 'conversationDeleted': return event.id` and `default: return null`. A plain `default: null`, **not** an `assertNever`: ignoring every other arm is the intended permanent behaviour here, mirroring `translateConversationCreated`. Returns the bare `id` field directly (`events.ts:424` carries a `string`, not a payload object).
- `subscribeConversationDeleted` — one listener; guard on `!== null`, never truthiness (the `conversationListBridge.ts:82-84` doctrine). Returns the off handle so the React binding can use it as effect cleanup. The listener only invokes the callback — it never throws into React.
- `useConversationDeletedExit` — the `useConversationCreatedNav` shape verbatim: latest callback in a ref refreshed by a bare effect, subscription established once in an empty-dep effect with the off handle as cleanup (a StrictMode double-mount nets exactly one live listener). `window.pyry` is dereferenced **only inside the effect**, so PairedShell stays server-renderable.

**A second subscription on the same event is correct, not a duplicate.** `conversationListBridge` already consumes `conversationDeleted` app-level to re-request the list. That listener sends a command; this one does not — so a delete still fires exactly one re-list. This is the exact arrangement `conversationListBridge.ts:78-79` already documents for `conversationCreated` ("consumes the same event on an INDEPENDENT subscription but only navigates, it sends no command"). The two listeners touch disjoint state (`conversationListStore` vs. timeline / active-conversation / session-id), so their delivery order is irrelevant and neither needs to know about the other.

**Lifetime.** The subscription lives in `PairedShell`, so it exists only while the paired shell is mounted — unpair unmounts it and the off handle tears it down. A `conversationDeleted` arriving while unmounted reaches no listener, which is right: `clearPairingScopedState` has already cleared everything this helper would clear.

### 3. `src/renderer/src/PairedShell.tsx` — MODIFIED, the wiring

Module scope, beside `activateDeps` and `clearPairingDeps`, and typed to make the missing field explicit:

```ts
const exitConversationDeps: Omit<ExitActiveConversationDeps, 'navigateToList'> = { /* four getState() arrows */ }
```

The four arrows follow the existing idiom exactly — each reaches its singleton through `getState()` *inside* the arrow body, so nothing is dereferenced at module load and nothing is read during render. `navigateToList` is the one effect that cannot live at module scope (it needs the container's `dispatch`), hence the `Omit`.

Inside the container, beside `useConversationCreatedNav`:

```tsx
useConversationDeletedExit((conversationId) =>
  exitActiveConversation(
    { ...exitConversationDeps, navigateToList: () => dispatch({ type: 'back' }) },
    conversationId
  )
)
```

The per-render object allocation is free — the hook holds the caller's inline arrow in a ref and re-reads it each delivery, so nothing needs memoizing and the subscription never re-establishes. `dispatch` from `useReducer` has stable identity. **PairedShell still subscribes to no store**, so its "re-renders only on its own nav dispatch" and server-renderable properties hold.

`{ type: 'back' }` reuses the existing absolute `back` arm, which already lands on `list` (`pairedRoute.ts:54-55`). **No new `PairedNav` arm, no `PairedRoute` member, no reducer edit.**

### Not touched

`ConversationScreen.tsx` gets **no edit**. `onDeleteConfirm` keeps firing the command and closing the sheet; the sheet unmounts with the thread when the route flips. `requestDeleteConversation`, `submitMessage`, `dropQueuedMessage`, `requestRunConfigSnapshot` and `interruptCommand` are all unchanged. The stale four-way framing in the comment at `PairedShell.tsx:151` is **out of scope** — leave it exactly as it is (correcting it here would be adjacent-code refactoring).

## State + concurrency model

Four stores are read or written, all through injected effects:

| Store | Operation | Why |
|---|---|---|
| `activeConversationStore` | read (`getState().activeConversation`), then `clearActiveConversation()` | The gate's left-hand side, then AC3's "no longer recorded as active". |
| `timelineStore` | `dispatch({ type: 'reset' })` | AC2 — no row of the deleted discussion survives. |
| `sessionIdStore` | `clearSessionId()` | AC3's security payload (see below). |
| — nav — | `dispatch({ type: 'back' })` | AC1. `useReducer` state, ADR 0006 screen-local. |

No async work, no cancellation surface, no `AbortController`. The only lifecycle object is the bridge subscription, torn down by the effect cleanup. The check-then-act on the active conversation cannot interleave: it is one synchronous function body on the renderer's single thread.

**The security payload of the session-id clear**, the same one `activateConversation` and `clearPairingScopedState` document: it makes `RunConfigSections`' `onChange` `undefined`, so the Run configuration controls render **inert** rather than addressing a YOLO / auto-approval write to a session that belonged to a conversation the daemon has destroyed. State this in the helper's doc comment — it is the reason the clear is not merely cosmetic.

## Error handling

There is no failure mode to surface. The helper performs no I/O, sends no command, and cannot throw: three store writes and a reducer dispatch, all total.

Failure modes that exist *around* it and are deliberately not handled here:

- **A delete the daemon never confirms** — no event, no listener call, no navigation. That is AC5, and it is the designed behaviour, not an unhandled error: the operator stays in the thread, which is honest.
- **A malformed `conversation_deleted`** — already fails closed in the transport (`inboundMessage.ts:1096-1099` throws `WireDecodeError`), so no event reaches the renderer.
- **A second client deleting the discussion you are reading** — the daemon sends `conversation_deleted` as a correlated reply and never broadcasts it, so you receive nothing and your thread stays open. Pre-existing property of the wire contract (the "creator-only by construction" note at `conversationListBridge.ts:47`); unfixable renderer-side, out of scope.
- **An *unsolicited* `conversation_deleted`** — note carefully that the correlation above is a property of what the daemon *sends*, **not a check this client performs**. `daemonConnection.ts:923-932` emits the event unconditionally on decode, with "NO outstanding-request / correlation state threaded here" (#375's deliberate decision, because the `id` is self-sufficient). So the gate this ticket adds is *"this id names the conversation on screen"*, **not** *"this reply answers a delete I issued"*. Do not write a comment claiming otherwise. The fail-direction is safe — see § Security review.
- **`conversation.not_found` on a send** — there is no send-failure UI surface in this milestone (`composerSend.ts:37-39`). This ticket removes the *cause* (no id is sent at all once cleared); it does not add the surface.

## Testing strategy

Unit (`npm test`, vitest, node env, server-render only — no DOM harness, no clicks).

**`src/renderer/src/exitActiveConversation.test.ts`** — a `spyDeps(active)` factory of five `vi.fn()`s, plus integration cases wiring real isolated `createTimelineStore` / `createSessionIdStore` / `createActiveConversationStore` instances (the `activateConversation.test.ts` structure at :25-45):

- Matching id → `dispatchTimeline` called once with exactly `{ type: 'reset' }`, `clearActiveConversation` once, `clearSessionId` once, `navigateToList` once.
- Matching id → **call order**: `navigateToList` fires after all three clears (assert via `vi.fn().mock.invocationCallOrder`, or a shared recording array — pick whichever reads cleaner in this repo's idiom).
- Mismatched id, with a *different* conversation active → all five effects untouched, zero calls (AC4).
- `getActiveConversation` returns `null` → zero calls (AC4's degenerate arm).
- Integration: seed a timeline store with items, a session-id store with an id, an active-conversation store with the conversation; run with the matching id; assert the timeline is back to `initialTimelineState`, the session id is cleared, and `activeConversation` is `null`.
- Integration: invoke twice with the same id against those real stores → the second call navigates nothing (idempotence; the gate now reads `null`).

**`src/renderer/src/store/conversationDeletedBridge.test.ts`** — the `conversationCreatedBridge.test.ts` fake-bridge idiom:

- `translateConversationDeleted` returns the `id` for a `conversationDeleted` event.
- It returns `null` for a sample of other arms — at minimum `conversationCreated`, `conversationsReceived`, `conversationUpdated` (the near-miss arms most likely to be mis-cased).
- `subscribeConversationDeleted` invokes `onDeleted` exactly once with the id on a matching event.
- Unrelated events invoke `onDeleted` zero times — the bridge half of AC5.
- The returned off handle stops further delivery.

**Not unit-tested, by precedent:** the `PairedShell` glue. The route transition is proved by composing the separately-tested `nextPairedRoute` (`pairedRoute.test.ts` already covers `back → list`) with the decision tested above — the reasoning `PairedShell.test.tsx:7-11` states for the create path. Quote it in the new test file's header comment. Do **not** add a DOM harness or `@testing-library` to reach for a click.

**Type coverage:** `npm run typecheck` (both projects — the script is `node && web` and `&&` short-circuits, so if the node half fails the web half never runs; re-run `tsc -p tsconfig.web.json` directly if in doubt). `npm run build` is the gate.

### e2e — a required edit, and the free proof of AC1

Two specs click Back immediately after the delete confirm, and this fix removes the control they click. Once the app returns on its own, `.conversation__back` is gone from the DOM by the time the click runs, Playwright's auto-wait times out, and both specs fail. **Removing those lines is mandatory, not optional.**

For each of `e2e/conversation-archive-lifecycle.spec.ts` (:161) and `e2e/real-daemon-conversation-lifecycle.spec.ts` (:185):

1. **Delete** the `await page.locator('.conversation__back').click()` line.
2. **Add a non-vacuity anchor** immediately before the second (confirming) `Delete` click: assert the thread surface root is present — `.conversation` (`ConversationScreen.tsx:167`; a class selector matches that token only, so `.conversation__back` and friends do not match it) — with `toHaveCount(1)`.
3. **Add the navigation assertion** immediately after the confirming click: `.conversation` at `toHaveCount(0)`, with `ROUNDTRIP_TIMEOUT_MS` (it auto-waits the delete → `conversation_deleted` → exit round trip).
4. Leave the existing row-count and row-identity assertions exactly as they are — but update the comment above them: **the row count alone does not prove the navigation** (it is driven by the delete re-list, which already works today). The `.conversation` 1→0 delta is the nav proof; the anchor in step 2 is what makes that delta non-vacuous rather than an assertion that could pass against a surface that was never there.

`e2e/` is outside both tsconfigs, so `npm run typecheck` will not see these edits — run the specs.

## Acceptance criteria → where each is proved

| AC | Proof |
|---|---|
| 1 — returns to the Channel List | `exitActiveConversation` unit test (`navigateToList` called) + `nextPairedRoute` `back → list` (already covered) + the `.conversation` 1→0 delta in both e2e specs. |
| 2 — no row of the deleted discussion remains | Unit: `dispatchTimeline({ type: 'reset' })`; integration: the real timeline store is back to `initialTimelineState`. |
| 3 — not recorded as active, session id cleared, both id-carrying actions have no id, Run config inert | Unit + integration: `clearActiveConversation` / `clearSessionId`. `submitMessage` already returns `false` on a `null` id (`composerSend.ts:48`); the queued backlog renders empty on a `null` id so no drop control exists (`ConversationScreen.tsx:1283-1284`); `RunConfigSections`' `onChange` goes `undefined` on a cleared session id. No new guards needed — read those three sites and confirm rather than adding code. |
| 4 — a delete naming a different conversation changes nothing | Unit: mismatched-id and null-active cases, all five spies at zero calls. |
| 5 — no confirmation ⇒ no navigation | Structural (nav only happens in the listener) + bridge unit test: unrelated events invoke the callback zero times. |

## Scope check

Production source files (`.ts`/`.tsx`, excluding tests): **3** — two created, one modified. New exports: **5** (`ExitActiveConversationDeps`, `exitActiveConversation`, `translateConversationDeleted`, `subscribeConversationDeleted`, `useConversationDeletedExit`). Gate branches: **1**. Consumer call sites needing simultaneous update: **0** — the change is purely additive, and no existing signature moves. Projected total written work ≈ 375 lines across production, tests and the two e2e edits.

## Open questions

- **Call-order assertion style.** The repo has no established idiom for "A fired before B" across separate `vi.fn()`s. `invocationCallOrder` and a shared recording array both work; pick the one that reads better beside `activateConversation.test.ts` and note the choice in a comment.
- **#653's reuse.** The archive half is wired to land after this and reuses `exitActiveConversation` unchanged, supplying a different triggering event. Do not build any part of it here, and do not generalise the bridge — the archive confirmation is a different `DaemonEvent` arm.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. One boundary applies: the daemon's `conversation_deleted` reply. It is narrowed and fails closed in the **main** process (`inboundMessage.ts:1096-1099` throws `WireDecodeError` on a non-record payload or a non-string `id`), then crosses IPC as the already-typed `{ type: 'conversationDeleted'; id: string }` (`events.ts:424`) built as a fresh single-field literal, never a spread of the decoded payload (`daemonConnection.ts:928-932`), so a decoder that grew a field could not smuggle it across. Downstream, the `id` is **only ever compared** — never rendered, never logged, never persisted, never sent back on the wire — so no escaping, sanitisation or length concern applies to it. The renderer gains no new capability: it already receives this exact event on `conversationListBridge`'s app-level subscription.
- **[Tokens / secrets]** No findings, and this is the ticket's actual security payload. The daemon session id is *cleared*, never read, logged or transmitted. Clearing it makes `RunConfigSections`' `onChange` `undefined`, so the Run configuration controls render **inert** instead of addressing a YOLO / auto-approval write to a session belonging to a conversation the daemon has destroyed — the same posture `activateConversation.ts:63-66` and `clearPairingScopedState.ts:85-89` document. Verified logging-free: `sessionIdStore` has no diagnostics observer and `timelineStore.ts:10` states it has none either, so neither clear emits a record. The helper itself MUST NOT log (ADR 0007 content-free): the conversation `id` is the only field a diagnostic here would want, and there is no observed failure to instrument.
- **[File / storage]** Not applicable, by design decision rather than omission: the change touches three in-memory Zustand stores and a `useReducer`. No filesystem path is constructed, no data is persisted, nothing reaches `localStorage` / IndexedDB / the renderer disk cache. There is no path to traverse and no write to make atomic.
- **[Electron attack surface]** No findings. No `webPreferences` change, no new `contextBridge` API, no new `ipcMain` channel, no new `RendererCommand`, no custom-protocol or deep-link handler, no navigation-affecting code (the "navigation" here is an internal React route flip, not a `will-navigate`). The new bridge subscribes through the existing `window.pyry.onDaemonEvent` and **sends nothing** — it is strictly narrower than `conversationCreatedBridge`, which also sends a command. `window.pyry` stays dereferenced only inside effects, so no privileged handle is read during render. Keys, sockets and the Noise session remain wholly in the main process; nothing in this ticket moves toward the renderer.
- **[Cryptographic primitives]** Not applicable — no RNG, no comparison against a secret, no key or nonce, no handshake code. The one comparison (`activeId !== conversationId`) is between two non-secret conversation identifiers, so `!==` is correct and `timingSafeEqual` would be cargo-culting.
- **[Network & I/O]** No findings. The exit performs no I/O: no command is sent, no socket is opened, no frame is written. It cannot introduce an unbounded read, a missing timeout or a reconnect loop, and it adds no new inbound path (the frame it reacts to is already decoded and capped upstream by the existing `MAX_PLAINTEXT_BYTES` check).
- **[Errors, logs, telemetry]** No findings. The helper is total — no throw path, no user-facing error string, no log line, no telemetry. Deliberate silence, not an omission (see Tokens above). A developer adding a `console.log` carrying the id during implementation would be an ADR 0007 violation; the spec says so explicitly and code-review should check for it.
- **[Concurrency]** No findings, and one property is worth naming as *why*. The check-then-act (`getActiveConversation()` → compare → clear → navigate) spans **no `await`**: four synchronous calls on the renderer's single thread, so nothing can change the active conversation in the gap and React batches them into one commit. Reading through a **getter** rather than a threaded value is load-bearing here for the reason `activateConversation.ts:16-23` documents — the bridge callback is held in a ref refreshed by a bare (post-commit) effect, so an event landing before that refresh runs the previous render's arrow; a getter makes a stale arrow harmless, a captured value would not. Subscription lifetime is the established off-handle-as-effect-cleanup idiom (one live listener under StrictMode double-mount), torn down when the shell unmounts on unpair. Re-entrancy is closed by construction: after an exit `activeConversation` is `null`, so a duplicate delivery of the same id fails the gate — no flag, no guard.
- **[Threat model — hostile relay]** No findings; the design is relay-hostile-safe in both directions. The relay is content-blind and on-path: it cannot **forge** a `conversation_deleted` (that requires producing an AEAD-sealed frame inside the Noise session), it can only **drop**, **delay** or **reorder**. A dropped confirmation ⇒ no event ⇒ no navigation, which is AC5 and the fail-safe direction (the operator stays put rather than being stranded on a list). A delayed confirmation landing after the operator opened a different discussion ⇒ the id gate no-ops, which is AC4. Both hostile-relay behaviours land on an AC this ticket already pins.
- **[Threat model — hostile / buggy daemon]** SHOULD FIX (documented, no code change). Because no `in_reply_to` correlation is enforced client-side (`daemonConnection.ts:923-932`, #375's explicit decision), **any** inbound `conversation_deleted` naming the active conversation evicts the thread — solicited or not. Impact is bounded to availability/UX: no secret is disclosed and no privileged action is enabled, because every state move is in the safe direction (rows dropped, session id cleared ⇒ Run config inert, no id left to send). The only actor able to produce such a frame is the peer inside the Noise session, i.e. the daemon, which can already delete the conversation for real and serves all content anyway — so a correlation check would not raise the bar against that adversary, while adding one means threading outstanding-request state through the main-process transport, outside this renderer-only ticket. The requirement this pass imposes is honesty, not code: the spec now states the gate is *"this id names the conversation on screen"*, not *"this reply answers my request"* (§ Error handling), and no comment may claim otherwise.
- **[Threat model — stale-row window]** SHOULD FIX (documented, no code change). The navigation this ticket adds lands the operator on the Channel List one round trip *before* the `#376` re-list reply removes the deleted row, so the dead row is briefly clickable — and clicking it re-records a destroyed conversation as active. Reachable, but not exploitable: `activateConversation` takes its clear branch (the ids differ), the session id stays `null` because no `sessionTransition` marker can arrive for a destroyed conversation, so Run config remains inert and the only consequence is a silent `conversation.not_found` on a send. That silence is the pre-existing "no send-failure surface" gap the ticket body already scopes out (`composerSend.ts:37-39`), not something this change creates. Noted so code-review does not re-derive it; closing the window belongs to a send-failure-surface ticket, not here.
- **[Threat model — renderer compromise reaching the transport]** No findings. Nothing new crosses `contextBridge`; a compromised renderer gains no reach it did not already have, and the ticket's net effect on that adversary is *negative surface* — one fewer live conversation id and one fewer live session id held in renderer memory after a delete.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-21
