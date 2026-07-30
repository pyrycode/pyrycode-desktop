# #530 — clear per-conversation context on a conversation switch

**Size:** S · **Labels:** `bug`, `security-sensitive` · Split from #508 · Blockers #528, #529 both landed.

## Files to read first

- `src/renderer/src/PairedShell.tsx:83-125` — the container and its **three** `{ type: 'open' }` dispatchers. `:91-94` created-event nav, `:99` notification nav (no conversation), `:112-115` row click. This is the only production file modified.
- `src/renderer/src/screens/conversation/unpairAction.ts:1-60` — **the shape to copy.** A co-located, React-free action helper: a `Deps` interface of injected effects, one total function, a docstring that states the ordering invariant ("the store is reset BEFORE the route flips"). `activateConversation` is the same thing for the nav seam.
- `src/renderer/src/screens/conversation/composerSend.ts:10-70` — the second instance of that idiom (`ComposerSendDeps` + `submitMessage(text, id, deps)`), and `:67` — one of the timeline's only two production writers.
- `src/renderer/src/store/threadTimeline.ts:434-441` — the `reset` arm (#528). It returns the shared `initialTimelineState` **by reference**, which is what makes a redundant reset churn zero subscribers. Do not hand-write a literal.
- `src/renderer/src/store/timelineStore.ts:21-47` — `dispatch` is the sole write path; `useTimelineStore` is the stable-reference hook.
- `src/renderer/src/store/sessionIdStore.ts:34-59` — `clearSessionId` (#529), and the header comment explaining the store is per-conversation state.
- `src/renderer/src/store/activeConversationStore.ts:31-65` — `setActiveConversation`, `clearActiveConversation` (**not used here** — #531 owns it), and the singleton.
- `src/renderer/src/store/conversationCreatedBridge.ts:81-95` — `useConversationCreatedNav` holds the caller's callback in a **ref refreshed by a bare effect**. This is why the previous conversation is read through a getter, not closed over from render state (see § Design).
- `src/renderer/src/screens/conversation/RunConfigSections.tsx:310-330` — the sole production consumer of `sessionId`, and the reason this ticket is `security-sensitive`: `onChange` is built **only** when `sessionId !== null`, and it addresses an outbound `set_session_settings` write to that id.
- `src/renderer/src/PairedShell.test.tsx:1-30,113-127` — the existing test file's posture: SSR markup + reducer composition, **no jsdom harness**. Read before assuming a callback can be driven here (see § Testing strategy).
- `src/shared/wire/types.ts:618-626,673-689` — `ConversationSummary` (7 fields) vs `ConversationCreatedPayload` (5); the former is a structural superset.
- `docs/knowledge/decisions/0004-renderer-session-store-reducer-wire-types.md` — the single-active-conversation model. Thread events carry no conversation id **by design**; this is why navigation, not filtering, has to do the separating.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-8

The Conversation Thread screen: a dark scrolling column of alternating right-aligned user bubbles and left-aligned assistant cards, with inline tool-use chips and a session-boundary rule, under a back-arrow/title/overflow top bar and above the run-config strip and composer. **No new visual is introduced.** The node anchors what a correctly switched-into thread must look like at the moment it opens — the empty state (`ConversationScreen.tsx:502,524`, `EMPTY_THREAD_COPY = 'Send a message to get started'`), not the previous conversation's rows.

## Context

Thread rows live in an app-lifetime store and the events that fill it are conversation-id-free (ADR 0004, `threadTimeline.ts:86-88`). Opening B therefore shows A's rows with B's stream appended, and if A is still streaming its deltas keep landing in the thread the user is reading as B.

`sessionIdStore` has the same lifetime and the same per-conversation meaning, but a worse consequence. It is not display-only: `RunConfigSections.tsx:322,333-338` builds the Run configuration `onChange` from it and feeds the id into an outbound `set_session_settings`. A session id captured under A that survives into B means a settings change made while looking at B — **including the YOLO / auto-approval toggle** — is addressed to A's still-running session. That is a misreported and misapplied permission posture, and it is why this ticket carries `security-sensitive`.

Both clear paths already exist: #528's `reset` arm on `ThreadEvent`, and #529's `clearSessionId`. This ticket is the wiring and the decision of *when*.

## Design

### The decision must key off the id, not the nav event

Three sites dispatch `{ type: 'open' }`; only two carry a conversation:

| Site | Carries | Today |
|---|---|---|
| `PairedShell.tsx:91-94` created-event nav | `ConversationCreatedPayload` | `setActiveConversation` + `open` |
| `PairedShell.tsx:112-115` row click | `ConversationSummary` | `setActiveConversation` + `open` |
| `PairedShell.tsx:99` notification nav (#393) | **nothing** | `open` only — deliberately no `setActiveConversation` |

A reset wired to the `open` dispatch would wipe the thread on every notification click for the conversation the user is already reading, and on every re-click of the already-active row. Both are worse than the bug being fixed, since the timeline has no history backfill — its only production writers are `timelineBridge.ts:206` and `composerSend.ts:67` (verified by grep over `src/renderer/src`; the click-driven `requestScreenSnapshot` feeds the separate screen-snapshot store). Cleared rows do not come back.

So: **clear iff `previous?.id !== next.id`.**

### New module — `src/renderer/src/activateConversation.ts`

Co-located with `PairedShell.tsx` beside its other pure helper `pairedRoute.ts`, following `unpairAction.ts` / `composerSend.ts`: React-free, store-free, effects injected, unit-tested with plain spies.

```ts
export interface ActivateConversationDeps {
  getActiveConversation: () => ConversationCreatedPayload | null
  setActiveConversation: (conversation: ConversationCreatedPayload) => void
  dispatchTimeline: (event: ThreadEvent) => void
  clearSessionId: () => void
}

export function activateConversation(
  deps: ActivateConversationDeps,
  conversation: ConversationCreatedPayload
): void
```

Behaviour, in order: read the previous via `getActiveConversation()`; when `previous?.id !== conversation.id`, `dispatchTimeline({ type: 'reset' })` and `clearSessionId()`; then — unconditionally, on both branches — `setActiveConversation(conversation)`. Total, synchronous, no return value, no throw path. Asserted by the ordering test in § Testing strategy.

Four design points, each load-bearing:

1. **A getter, not a value.** The previous conversation must be read at *invocation* time. Threading it in as a value would mean `PairedShell` reads it during render and the created-event callback closes over it — and `useConversationCreatedNav` refreshes its callback ref in a bare effect (`conversationCreatedBridge.ts:84-87`), i.e. after commit. Two `conversationCreated` events landing before that effect runs would both compare against the same stale previous, and the second would skip a clear it owed. The getter closes that gap by construction. It also keeps `PairedShell` from subscribing to `activeConversation` at all — a subscription that would re-render the whole paired subtree on every switch.

2. **`previous === null` takes the clear branch.** `previous?.id` is `undefined` on the first activation and never equals a real id. This is correct and free: `reset` returns `initialTimelineState` by reference (zero subscriber churn) and `clearSessionId` sets `initialSessionIdState`. No state exists in which rows legitimately belong to a conversation that was never made active, so clearing on the first open is the safe direction and earns no special case.

3. **`setActiveConversation` stays unconditional.** #448's most-recent-wins contract is untouched: a same-id re-open still refreshes the stored payload, which matters because a row click carries a `ConversationSummary` with fresher `last_message_ts` / `is_archived` than the held `ConversationCreatedPayload`. Making the set conditional would be an out-of-scope behaviour change.

4. **The parameter is `ConversationCreatedPayload`.** `ConversationSummary` is a structural superset (`types.ts:618-626` vs `:683-689`), and `PairedShell.tsx:113` already passes one into `setActiveConversation` today. Both call sites pass a variable, never a fresh object literal, so excess-property checking does not bite — no cast, no union, no widening of the store's type.

`clearActiveConversation` (#529) is **not** called on this path. It belongs to #531 (unpair / pair-another-server); calling it here would wipe the value this path is in the middle of setting.

### `PairedShell.tsx` wiring

Drop the `useActiveConversationStore` hook read at `:88` and build the deps from the three store singletons, each read through `getState()` inside the arrow bodies — the wiring idiom already used by `timelineBridge.ts:206`, `sessionIdBridge.ts:68`, and, inside components, `CreateFolderDialog.tsx:154` / `SaveAsChannelDialog.tsx:256`. The object closes over nothing per-render, so module scope is fine.

Both carrying sites become `activateConversation(deps, conversation)` followed by the existing `dispatch({ type: 'open' })`. `:99` is untouched.

Two consequences worth stating:

- **`PairedShell` ends with zero store subscriptions** (it had one). It re-renders only on its own `useReducer` nav dispatch. Server-renderability is preserved — `getState()` is called from callbacks, never during render — and the existing `:114` SSR test is the regression guard.
- **AC5 is structural, not a runtime guard.** The notification path cannot reach `activateConversation` because there is no conversation to pass; `back` / `openSettings` / `openArchive` dispatch nav actions and touch no store. There is no call site to get wrong.

### State and concurrency model

All three store writes happen synchronously in one callback, so React 18 batches them into a single commit. Independently of batching, the clear-then-set order means no observer can ever see the new active conversation against the previous conversation's rows. There is no `await` between the read and the writes, so the check-then-act sequence cannot interleave.

Re-render seams:

- `selectItems` subscribers (`ConversationScreen.tsx:96`) see `items: []` after a real switch, and — because a no-op reset returns the same state reference — nothing at all on a redundant one (`Object.is` bails out in the selector).
- `sessionId → null` makes `RunConfigSections`' `onChange` `undefined`, so the Run configuration controls render **inert** from the switch until the new conversation's `sessionTransition` marker arrives. This is intended, not a regression: inert beats addressed-at-the-wrong-session. Call it out in the module docstring so a future reader does not "fix" it.

### Error handling

No failure modes to handle. No I/O, no async, no network, no parsing. The three injected effects are synchronous zustand `set` calls that cannot throw, and the helper has no branch that can fail. Nothing surfaces to the UI; nothing is logged (adding a diagnostic here would be a content-free-logging hazard for zero observed benefit — ADR 0007).

## Testing strategy

`npm test` (vitest) + `npm run typecheck`.

**`src/renderer/src/activateConversation.test.ts` (new)** — plain spies for the unit cases, real isolated store instances (`createTimelineStore` / `createSessionIdStore` / `createActiveConversationStore`) for the integration cases. Scenarios:

- Previous `{ id: 'a' }`, next `{ id: 'b' }` → `dispatchTimeline` called once with `{ type: 'reset' }`, `clearSessionId` called once, `setActiveConversation` called once with the next payload. **(AC1)**
- Previous `null`, next `{ id: 'b' }` → clears both, then sets. **(AC2, first activation)**
- Previous `{ id: 'a' }`, next a *different object* also with `id: 'a'` → `dispatchTimeline` and `clearSessionId` **never called**; `setActiveConversation` still called with the next payload. **(AC3)**
- Call-order assertion: with the real active-conversation store seeded to `{ id: 'a' }` and the real setter wired into deps, activating `{ id: 'b' }` still clears, and both clears are recorded **before** the set. This is the test that pins the ordering constraint — a re-read after the write would make the comparison see `'b' === 'b'` and clear nothing. **(AC3's precondition)**
- Integration, real stores: timeline seeded with items, `sessionId` seeded to `'s1'`, active `{ id: 'a' }`; activate `{ id: 'b' }` → timeline `toMatchObject(initialTimelineState)`, `sessionId` is `null`, active is the new payload. Use `toMatchObject`, not `toEqual` — the store state object carries `dispatch` / the setters. **(AC1, AC4)**
- Integration, same id: seeded items survive **by reference** and `sessionId` stays `'s1'`. **(AC3, AC4's converse)**
- A `ConversationSummary`-shaped argument (all 7 fields) is accepted and recorded verbatim — the structural-superset seam both call sites depend on.

**`PairedShell.test.tsx` — no new tests, deliberately.** The ticket names it as the natural home, but the file has no jsdom harness (`:7-11`): it renders SSR markup and asserts `nextPairedRoute` transitions, so it cannot drive `onOpen` or the created-event callback at all. Its existing `:125` / `:164` / `:168` cases are reducer assertions, not callback invocations. Adding a test there would be theatre. The behaviour lives in the pure helper where it is directly testable — the same posture `:120-124` already documents for #242's nav, and the same split `composerSend` / `unpairAction` use. The residual gap is the two one-line call sites, held by `typecheck` and by both paths now funnelling through one helper. The existing `:114` SSR test guards the hook removal.

## Open questions

- **Other per-conversation stores survive a switch too.** `runConfigStore` (model / effort / yolo / token counts), `runSettingsWriteStore` (pending settings), `modalStore` (outstanding permission prompts from A), and the screen-snapshot store are all in the same position, and none has a clear path — #528/#529 landed exactly the two this ticket consumes. Out of scope here; recommend PO file a follow-up. Note #539 already covers pending settings on **reconnect**, which is a different trigger and does not cover a conversation switch.
- **A late `sessionTransition` for the previous conversation can re-stale the id.** See § Security review, finding 6/9. Needs a PO follow-up; not fixable at this altitude.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No finding. The helper consumes one daemon-supplied field, `id`, and uses it *only* as an equality key — never as an index, a path, a selector, or an interpolated string, and it renders nothing. A hostile daemon that forges a colliding `id` gets a clear that should have happened suppressed (the original bug returns for that switch); a forged differing `id` gets an extra clear (local rows lost, no daemon-side data). Both are strictly cheaper for a daemon that already drives the whole stream, so no new authority is granted. Related: `id: ''` for two conversations would compare equal and suppress the clear — accepted deliberately, because the same unvalidated `id` already addresses `send_message` (`composerSend.ts:52`), and rejecting it here alone would be incoherent.
- **[Tokens, secrets, credentials]** No finding. Nothing here is a credential. `sessionId` is a daemon routing id that authorises nothing on its own — the Noise session does. The change strictly *shortens* its lifetime. No secret is read, stored, compared, or logged.
- **[File / storage operations]** No finding — by construction. All three stores are in-memory zustand singletons; this path performs no filesystem, `localStorage`, or IndexedDB access, and writes nothing to disk. Cleared rows are therefore unrecoverable from disk, which is the desired direction.
- **[Inter-process / Electron attack surface]** No finding. Zero files under `src/main` or `src/preload` change; no `contextBridge` API, `ipcMain` channel, `webPreferences`, or navigation guard is added or altered. The created-event path consumes the existing `window.pyry.onDaemonEvent` subscription (`conversationCreatedBridge.ts:90`) with its surface unchanged. No key, socket, or raw frame is reachable from this code — CLAUDE.md's process-placement rule holds by construction.
- **[Cryptographic primitives]** Not applicable, stated concretely: no RNG, no hashing, no key material, no AEAD. The `!==` on `id` compares two daemon-supplied non-secrets; `timingSafeEqual` would be inapplicable, since a timing oracle over a routing id the daemon already knows grants nothing.
- **[Network & I/O]** No finding — and this is the ticket's security payload. Clearing `sessionId` makes `RunConfigSections`' `onChange` `undefined` (`:322-329`), so the change strictly *reduces* the outbound command surface: it closes the path where a YOLO / auto-approval toggle made while looking at B lands on A's still-running session. Fail-closed residual: the controls are inert between the switch and the new `sessionTransition` marker, which is the correct direction.
- **[Errors, logs, telemetry]** No finding. The helper logs nothing and surfaces nothing. Stated as a MUST-NOT for the developer: do not add a diagnostic carrying the conversation `id`, `name`, or `cwd` — ADR 0007's content-free-by-construction rule, and there is no observed failure to instrument.
- **[Concurrency]** No finding — actively addressed. The read-then-write is fully synchronous with no `await`, so the check-then-act sequence cannot interleave on the renderer's single thread. The getter-not-value design (§ Design, point 1) exists precisely to close the one real race in this shape: closing over a render-time previous would let two `conversationCreated` events arriving before `useConversationCreatedNav`'s ref-refresh effect commits both compare against the same stale value, and the second would skip a clear it owed. No timer, listener, or `AbortController` is added; the created-event subscription's lifetime is unchanged (`conversationCreatedBridge.ts:88-94`).
- **[Threat model alignment]** OUT OF SCOPE, named: **a late `sessionTransition` for the previous conversation re-stales the id.** A is still streaming (the ticket's own failure description); its marker arrives after the switch; `sessionIdBridge` is conversation-id-free per ADR 0004, so the renderer *cannot* tell A's late marker from B's first one and will write it. That reopens the misdirected-write window this ticket narrows. Not fixable at this altitude — it needs either the daemon tagging `sessionTransition` with a conversation id (a wire change, upstream repo) or main-process suppression of non-active-conversation events. The clear here still narrows the exposure from "the entire time the user is in B" to "only if a late marker arrives", so it is a real improvement rather than a false sense of security. **Recommend PO file a follow-up.** Hostile relay: no wire change, not applicable. Renderer compromise: unchanged — a compromised renderer already holds `window.pyry`. Token theft from disk: no token on this path.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-30
