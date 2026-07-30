# #531 — clear the ended pairing's thread, conversation id and session id

**Size:** S · **Labels:** `bug`, `security-sensitive` · Split from #508 · Blockers #528, #529, #530 all landed.

## Files to read first

- `src/renderer/src/PairedShell.tsx:22-36,102-145` — **the only wiring site.** `:30-36` is #530's module-scope deps bag (the shape to copy); `:139` passes `onUnpaired` straight through; `:141` is `onPairServerPaired`. Both lines are the two edits.
- `src/renderer/src/activateConversation.ts:1-80` — **the shape to copy.** A React-free, store-free helper with an injected `Deps` bag, one total function, a docstring that states the ordering invariant. `:25-26` explicitly reserves `clearActiveConversation` for this ticket.
- `src/renderer/src/screens/conversation/unpairAction.ts:15-19,42-60` — `UnpairDeps` and the two-branch body. `:52-54` is the ok branch whose `dispatch({ type: 'reset' })` this ticket **removes** (see § Design). `:36-40` documents the fail-safe posture AC3 rides on.
- `src/renderer/src/screens/conversation/unpairAction.test.ts:11-35` — the two ok-branch tests that change. `:37-67` (the error tests) are the ones that already carry AC3 and must stay green untouched.
- `src/renderer/src/store/sessionStore.ts:52-55` — **the stale comment AC5 fixes.** `:125-128` — the `reset` arm returns the shared `initialSessionState`, so a redundant reset is a no-op reference. `:162` — the singleton's dispatch is observed by the `#134` diagnostics logger.
- `src/renderer/src/store/threadTimeline.ts:442-451` — #528's `reset` arm; returns `initialTimelineState` **by reference**, so `items` keeps the same reference and a no-op reset churns zero `selectItems` subscribers. Do not hand-write a literal.
- `src/renderer/src/store/activeConversationStore.ts:31-60` — `clearActiveConversation` (#529) and the singleton. `src/renderer/src/store/sessionIdStore.ts:34-59` — `clearSessionId` (#529).
- `src/renderer/src/pairedRoute.ts:61-65` — `pairServerPaired → 'list'`. The pair-another path stays **inside** `PairedShell`; only the view beneath swaps.
- `src/renderer/src/screens/pairing/PairingScreen.tsx:189-194` — `onPaired?.()` fires from `confirm-succeeded` inside a `.then()`, i.e. a microtask, not a React event handler. Relevant to batching (§ State and concurrency model).
- `src/renderer/src/screens/conversation/RunConfigData.tsx:20,36-37` — the one `useEffect` keyed on `activeConversation?.id`. Read it before assuming a clear-to-null is inert; `runConfigSnapshot.ts:41-48` is why it is.
- `src/renderer/src/PairedShell.test.tsx:1-31,113-160` — SSR markup + `nextPairedRoute` assertions, **no jsdom harness**. Read before assuming a callback can be driven there (§ Testing strategy).
- `docs/specs/architecture/530-clear-per-conversation-context-on-switch.md` — the sibling that landed the pattern this ticket reuses, and its § Open questions, which this spec closes out.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-8

The Conversation Thread screen: a dark scrolling column of right-aligned user bubbles and left-aligned assistant cards with inline tool-use chips and a workspace-change rule, under a back-arrow/title/overflow top bar, above the run-config strip (`Opus 4.7 · high · 73% used`) and the composer. **No new visual is introduced.** The node anchors what the *first* thread opened on a freshly paired server must look like — the empty state, and a run-config strip that is inert until the new daemon's first `sessionTransition` marker, not server A's rows and not server A's session.

## Context

Two paths end a pairing and neither clears the state scoped to it. Unpair (`unpairAction.ts:52-54`) resets only `sessionStore`; pair-another-server (`PairedShell.tsx:141`) resets nothing at all and only navigates.

Three stores latch across the switch because nothing on a new pairing re-asserts them: `timelineStore` (no history backfill — its only production writers are `timelineBridge.ts:206` and `composerSend.ts:67`), `activeConversationStore` (written only by a nav action), `sessionIdStore` (written only by a `sessionTransition` marker). The ticket's out-of-scope argument for the *other* pairing-scoped stores holds, and is verifiable rather than asserted: `conversationListBridge` requests on mount, `recentWorkspacesBridge` re-fetches by remount, `serverInfoLoader` is a one-shot mount invoke, `queueStore` is reset by the `connected` edge and repopulated by the daemon's re-sends (`queueBridge.ts:36-38,79-84`), `modalStore` likewise clears on `connected` (`modalBridge.ts:61-65`, #415), and `runConfigStore` is re-requested by `RunConfigData`'s id-keyed effect the moment a conversation is opened on the new server. Those six self-heal. The three above do not.

`sessionId` is the reason for the `security-sensitive` label, and the reason is unchanged from #530: it is not display-only. `RunConfigSections.tsx:322,333-338` builds the Run configuration `onChange` from it and feeds the id into an outbound `set_session_settings` write. An id captured under daemon A that survives into daemon B means a settings change — **including the YOLO / auto-approval toggle** — composed while looking at B is addressed to a session that only ever existed on A.

All four clear primitives already exist (#528's timeline `reset` arm, #529's two store clears, `sessionStore`'s `reset`). This ticket is purely the wiring, plus the decision of *where the single seam lives*.

## Design

### The set: four clears, one owner

| Store | Clear | Why it latches |
|---|---|---|
| `timelineStore` | `dispatch({ type: 'reset' })` (#528) | no history backfill |
| `activeConversationStore` | `clearActiveConversation()` (#529) | written only by a nav action |
| `sessionIdStore` | `clearSessionId()` (#529) | written only by a `sessionTransition` marker |
| `sessionStore` | `dispatch({ type: 'reset' })` (#166) | today cleared on the unpair path **only** |

`sessionStore` is in the set, not beside it. AC2 says the pair-another path clears "that same set **including the session store**", and if the session reset stayed on the unpair path the shared helper would degrade into "three clears plus a special case" — exactly the divergence the seam exists to prevent, and exactly the shape that let this bug exist for two paths in the first place.

### New module — `src/renderer/src/clearPairingScopedState.ts`

Co-located with `PairedShell.tsx` beside `activateConversation.ts` and `pairedRoute.ts`. React-free, store-free, effects injected, unit-tested with plain spies — the `activateConversation` / `unpairAction` / `composerSend` idiom.

```ts
export interface ClearPairingScopedStateDeps {
  dispatchTimeline: (event: ThreadEvent) => void
  clearActiveConversation: () => void
  clearSessionId: () => void
  dispatchSession: (action: SessionAction) => void
}

export function clearPairingScopedState(deps: ClearPairingScopedStateDeps): void
```

Behaviour: call all four, unconditionally, synchronously. No gate, no return value, no throw path. `ThreadEvent` and `SessionAction` are imported as types (`./store/threadTimeline`, `./store/sessionStore`) rather than the deps being bare `() => void` thunks, so the dispatched action *shape* is compile-checked and the test can assert the exact payload.

Three points, each load-bearing:

1. **No conditional, unlike #530.** `activateConversation` gates on `previous?.id !== conversation.id` because clearing a thread the user is still reading would destroy rows that never come back. Here the pairing itself is ending, so there is no state in which the rows, the conversation id or the session id legitimately survive. All four clears are idempotent by construction — `reset` returns `initialTimelineState` / `initialSessionState` **by reference**, the two `clear*` setters return their exported `initial*State` const — so clearing an already-clear store is a no-op reference and churns no subscriber. A guard would buy nothing and would be one more thing to get wrong.
2. **No ordering constraint among the four.** They are four independent whole-value writes; none reads another's state. The test asserts each is called exactly once, not a sequence.
3. **Nothing is logged.** ADR 0007's content-free rule: a diagnostic here would want the conversation `id`/`name`/`cwd` to be useful, and there is no observed failure to instrument. The `sessionStore` dispatch is already observed by the `#134` logger (`sessionStore.ts:162`), which is the one seam that exists.

### Both call sites live in `PairedShell.tsx` — the deviation from the ticket's Technical Notes

The ticket proposes threading a new effect into `UnpairDeps` and wiring it at `runUnpair`'s two call sites (`ConversationScreen.tsx:1512`, `:1805`). This spec instead wraps the `onUnpaired` prop where `PairedShell` hands it to `PairedShellView`, which is strictly better on the ticket's own stated criterion — "both paths must clear the same set from one place":

- **Two call sites, not three, and they are adjacent lines.** `onUnpaired` (`:139`) and `onPairServerPaired` (`:141`) sit two lines apart in one JSX block. Under the proposed shape the unpair wiring lives in `ConversationScreen`, ~300 lines apart from itself and one file away from the pair-another wiring, and the deps bag has to be built twice (once at module scope in each file) or exported from the pure helper, which would make it import the store singletons.
- **AC3 becomes structural rather than a new branch.** `runUnpair` calls `onUnpaired` **only** on `result: 'ok'` (`unpairAction.ts:52-55`); an error or a rejected invoke returns without it. Wrapping `onUnpaired` therefore inherits the existing fail-safe posture verbatim — no new gate to test, no new branch to get wrong — and the existing error tests (`unpairAction.test.ts:37-67`, both already asserting `onUnpaired` was never called) become AC3's regression guard for free.
- **The ordering invariant is preserved.** The clear runs before `onUnpaired()` reaches App's `setRoute('pairing')`, so nothing observes the pairing screen against the ended pairing's state. `App.tsx:85-89`'s note — that the *stored* pairing is erased before the flip, in `runUnpair` — is about `window.pyry.unpair` and is untouched.
- **Three production files instead of four, and `ConversationScreen.tsx` (1850 lines) is not touched at all.**

Wiring, mirroring `:30-36`:

```ts
const clearPairingDeps: ClearPairingScopedStateDeps = {
  dispatchTimeline: (event) => timelineStore.getState().dispatch(event),
  clearActiveConversation: () => activeConversationStore.getState().clearActiveConversation(),
  clearSessionId: () => sessionIdStore.getState().clearSessionId(),
  dispatchSession: (action) => sessionStore.getState().dispatch(action)
}
```

Module scope is right for the same reason it is for `activateDeps`: each effect reaches its singleton through `getState()` inside the arrow body, so nothing is dereferenced at module load and nothing is read during render. `sessionStore` is a new import here; the other three are already imported. `PairedShell` keeps zero store subscriptions and stays server-renderable.

`:139` becomes `clearPairingScopedState(clearPairingDeps)` then the existing `onUnpaired()`; `:141` becomes the same call then the existing `dispatch({ type: 'pairServerPaired' })`. `onPairServerCancelled` (`:142`) is **untouched** — that is AC4, and it is satisfied by not writing a line, which is the strongest form.

### `unpairAction.ts` — remove the ok-branch reset

`deps.dispatch({ type: 'reset' })` at `:53` goes; `dispatch` remains in `UnpairDeps` for the `failed` action on both error paths. The two `runUnpair` call sites are unchanged (no signature change, no new dep), so `ConversationScreen.tsx` is not edited.

This is deliberate, not incidental. Leaving it would mean the session store is reset from two places on the unpair path — harmless at runtime (`sessionStore.ts:125-128`: idempotent by reference) but a live divergence trap: a later reader who removes the session reset from the helper because "`runUnpair` already does it" silently breaks the pair-another path with every test still green. One owner, one test.

The docstring at `:33-41` must be updated to say where the clear went: the ok branch's contract is now "flip the route via `onUnpaired`, whose `PairedShell` wrapper performs the pairing-scoped clear before App re-routes"; the fail-safe half of the paragraph is unchanged and still correct.

### `sessionStore.ts:52-55` — the comment AC5 fixes

Today it claims `reset` "clears BOTH facets so a later re-pair never shows the previous pairing's conversation." The first clause is true (`status` and `messages`); the consequence clause stopped being true at the #179 cutover, when the visible thread moved off `sessionStore.messages` onto `timelineStore.items`. Rewrite to state what the action actually covers — the connection status and the coarse `messages` list — and to point at `clearPairingScopedState.ts` as the owner of the full pairing-scoped clear set, of which this action is one member. Comment-only; no code, no type change.

### State and concurrency model

No new async, no new subscription, no new listener, no timer, no `AbortController`. Four synchronous zustand `set` calls in one callback.

Both entry points are microtask continuations, not React event handlers: unpair arrives via `runUnpair`'s `await deps.unpair()`, pair-another via `PairingScreen.tsx:192`'s `.then()`. React 18 auto-batches both, so the four store writes and the subsequent route change land in one commit.

Re-render seams worth naming:

- **Unpair.** `ConversationScreen` is mounted when the clear fires. Every `activeConversation` consumer already reads `?.id ?? null` or self-gates (`ConversationScreen.tsx:125,895,991,1405`, `RunConfigData.tsx:20`) — `null` is the pre-first-open state, so null-tolerance is pre-existing, not new. The one effect keyed on the id is `RunConfigData.tsx:36-37`, and `requestRunConfigSnapshot` no-ops on a null id (`runConfigSnapshot.ts:41-48`), so even if the commit ordering let it run before the unmount it emits no wire traffic. `QueuedBacklogControl` (`:991-996`) re-memoises `selectBacklogFor('')`, which selects an empty backlog.
- **Pair-another.** The route is `pairServer` when the clear fires, so `ConversationScreen` is not mounted at all and the transition lands on `list`.
- The timeline `reset` returns the same state reference when already clear, so a redundant clear churns no `selectItems` subscriber.

**Ordering against the new server's connection.** `onPairServerPaired` fires from `confirm-succeeded` — the pairing record being persisted, not the Noise handshake to daemon B completing — so the session reset normally lands before any connection event for B. It is self-correcting if it does not: the daemon-event bridge is app-level and unconditional, so a subsequent `connecting`/`connected` for B repopulates the status regardless. The `sessionId` half has the same property in reverse — it refills from B's first `sessionTransition` marker.

### Error handling

None to add. No I/O, no async, no network, no parsing, no user-visible surface. The four injected effects are synchronous zustand `set` calls that cannot throw, and the helper has no branch that can fail. The unpair path's failure handling is unchanged and untouched (`unpairAction.ts:46-50,58-59`).

## Testing strategy

`npm test` (vitest) + `npm run build` (typecheck + build).

**`src/renderer/src/clearPairingScopedState.test.ts` (new)** — plain spies for the unit cases, real isolated store instances (`createTimelineStore` / `createSessionIdStore` / `createActiveConversationStore` / `createSessionStore`) for the integration cases. Scenarios:

- All four deps are called exactly once each, and `dispatchTimeline` receives exactly `{ type: 'reset' }` and `dispatchSession` exactly `{ type: 'reset' }`. **(AC1, AC2)**
- Integration, real stores, everything populated: timeline seeded with items and a non-idle phase, `sessionId` seeded, `activeConversation` seeded, session store seeded with a `connected` status and messages → afterwards the timeline `toMatchObject(initialTimelineState)`, `sessionId` is `null`, `activeConversation` is `null`, and the session state is `initialSessionState`. Use `toMatchObject`, not `toEqual` — the store state objects carry `dispatch` / the setters. **(AC1, AC2)**
- Integration, already-clear stores: calling it on four freshly created stores leaves each at its initial state and the timeline `items` at the **same reference** — pinning the idempotence the no-guard design rests on.
- The set is exactly four: assert the deps object's own keys, so adding a fifth pairing-scoped store to the interface without wiring it into the body fails a test rather than silently clearing three of four. (Cheap; the interface is the contract both paths share.)

**`src/renderer/src/screens/conversation/unpairAction.test.ts` (edited)** —

- `:12-23` becomes: ok → `dispatch` is **never** called, `onUnpaired` called exactly once, resolves `'ok'`. This is the test that pins the non-duplication — the session reset is the helper's, not `runUnpair`'s.
- `:25-35` (the reset-then-onUnpaired ordering test) is removed: there is no longer a reset here to order against, and the surviving ordering constraint (clear before route flip) lives in the `PairedShell` wrapper, which this file cannot reach.
- `:37-67` (both error cases) stay **exactly as they are**. They assert `onUnpaired` was never called on `result: 'error'` and on a rejected invoke, which is precisely AC3 under this design: no `onUnpaired`, no wrapper, no clear.

**`PairedShell.test.tsx` — no new tests, deliberately.** The file has no jsdom harness (`:1-31`): it renders SSR markup and asserts `nextPairedRoute` transitions, so its `:152` / `:156` pair-server cases are reducer assertions, not callback invocations, and it cannot drive `onUnpaired` or `onPairServerPaired` at all. Adding a test there would be theatre — the same posture #530 documented and the same split `composerSend` / `unpairAction` / `activateConversation` use. The residual gap is two one-line call sites, held by `typecheck` and by both paths funnelling through one helper. The existing `:114` SSR test guards the new module-scope import.

**AC4 (cancel clears nothing)** is covered by construction and by the existing `:152` test: `onPairServerCancelled` is not edited, so no clear can reach it.

## Scope check

Production `.ts`/`.tsx` files (excluding tests and the spec): `clearPairingScopedState.ts` (new), `PairedShell.tsx`, `unpairAction.ts`, `sessionStore.ts` (comment only) — **4**, under the ≥5 gate. Test files: one new, one edited. No new call sites beyond the two wrapper lines, no signature changes, no fan-out. 5 acceptance criteria. Projected total written work ~180 lines including doc comments and tests.

Not split along the unpair / pair-another seam, on purpose and as the ticket says: the second half would be a handful of lines, and splitting would reintroduce the exact path divergence the shared seam exists to prevent.

## Open questions

- **A late `sessionTransition` after an unpair is harmless here, unlike on #530's switch.** Unpair tears the transport down, so no marker follows. On the pair-another path a marker from A could in principle be in flight when B's pairing is confirmed; the connection to A is replaced, so the exposure window is the microtask gap and shrinks to nothing in practice. The general form of the hazard — `sessionTransition` is conversation-id-free per ADR 0004 — remains #530's open follow-up, unchanged by this ticket.
- **This closes #530's "other per-conversation stores" question for the pairing-ended trigger only.** `queueStore` and `modalStore` self-heal on the `connected` edge; `runConfigStore` self-heals on the id-keyed re-request. The conversation-*switch* trigger for `runSettingsWriteStore` / the screen-snapshot store is still open and still wants a PO follow-up; nothing here changes that.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No finding. The helper consumes **no** input at all — no parameters beyond the injected effects, no daemon field, no renderer message, no user string. Unlike #530 it does not even read an `id` to compare. There is no data crossing a boundary in this change, and no new value reaches a wire command, a path, an index, or a rendered string. The two things it *is* triggered by, `result: 'ok'` from `window.pyry.unpair` and `confirm-succeeded` from the pairing flow, are existing boundaries with unchanged validation (`unpairAction.ts:42-51`, `PairingScreen.tsx:189-194`).
- **[Tokens, secrets, credentials]** No finding, and the change is net-positive. Nothing here is a credential — `sessionId` is a daemon routing id that authorises nothing on its own (the Noise session does), and the pairing secret itself lives in main and is erased by `window.pyry.unpair` before this code runs. The change strictly *shortens* the renderer-side lifetime of every pairing-scoped value. No secret is read, stored, compared, or logged.
- **[File / storage operations]** No finding, by construction. All four stores are in-memory zustand singletons; this path performs no filesystem, `localStorage`, `sessionStorage`, or IndexedDB access and writes nothing to disk. Cleared thread rows are therefore unrecoverable from renderer-side storage, which is the desired direction for content belonging to a pairing the user just ended.
- **[Inter-process / Electron attack surface]** No finding. Zero files under `src/main` or `src/preload` change; no `contextBridge` API, `ipcMain` channel, `webPreferences` flag, or navigation guard is added or altered. No key, socket, or raw frame is reachable from this code — CLAUDE.md's process-placement rule holds by construction.
- **[Cryptographic primitives]** Not applicable, concretely: no RNG, no hashing, no key material, no AEAD, and — unlike #530 — not even an equality comparison, so there is no value for `timingSafeEqual` to be weighed against. The Noise session for the ended pairing is torn down by main's unpair handler, outside this change.
- **[Network & I/O]** No finding, and this is the ticket's security payload. Clearing `sessionId` makes `RunConfigSections`' `onChange` `undefined` (`:322,333-338`), so the change strictly *reduces* the outbound command surface: it closes the path where a YOLO / auto-approval toggle composed on daemon B lands on a session that only ever existed on daemon A. Clearing `activeConversation` closes the same class for `send_message`, both snapshot requests, archive, delete, workspace-change and dequeue, all of which address `activeConversation.id` and all of which no-op on `null`. Verified fail-closed rather than assumed: `RunConfigData.tsx:36-37` is the one effect that re-fires on the clear-to-null, and `requestRunConfigSnapshot` no-ops on a null id (`runConfigSnapshot.ts:41-48`), so the clear emits no wire traffic of its own.
- **[Errors, logs, telemetry]** No finding. The helper logs nothing and surfaces nothing. The one diagnostic on this path is pre-existing and content-free: `sessionStore`'s `#134` transition observer (`sessionStore.ts:162`) records the `reset` action type. **Stated as a MUST-NOT for the developer:** do not add a diagnostic carrying the conversation `id`, `name`, or `cwd`, or the session id — ADR 0007's content-free-by-construction rule, and there is no observed failure to instrument.
- **[Concurrency]** No finding — actively addressed. All four writes are synchronous with no `await` between them, so nothing can interleave on the renderer's single thread and no observer can see a half-cleared set. No timer, listener, subscription, or `AbortController` is added, and none is removed; the helper owns no async work and so has nothing to cancel. The one ordering question that matters — the clear versus the new server's first connection event — is analysed in § State and concurrency model and is self-correcting in the losing case, because the app-level daemon-event bridge repopulates status unconditionally. The one ordering question on the unpair path — clear versus route flip — is guaranteed by sequential statements in the wrapper, both inside the same batched commit.
- **[Threat model alignment]** Addressed for the ticket's threat, one residual named. The threat this closes is a **cross-pairing** one: state captured under daemon A being used to address objects on daemon B, which is a stronger version of #530's cross-conversation case because A and B are different trust domains rather than two objects in one. Hostile relay: no wire change, not applicable. Hostile daemon: a daemon cannot trigger or suppress this path — both entry points are local user actions, and neither reads a daemon-supplied value. Renderer compromise: unchanged; a compromised renderer already holds `window.pyry`. Token theft from disk: the pairing record is erased by main before this runs. **Residual, named and accepted:** the *other* pairing-scoped stores (`conversationListStore`, `recentWorkspacesStore`, `serverInfoStore`, `queueStore`, `modalStore`, `runConfigStore`) still hold A's data for the interval between the pairing change and their own re-assert. Each was verified to have a re-assert path (§ Context) and none of them addresses an outbound command by a latched id, so the residual is a display-staleness window, not a misdirected-write window. Not a MUST FIX; if a future store is added with no re-assert path and an outbound consumer, it belongs in `ClearPairingScopedStateDeps` — which is why the test pins the interface's key set.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-30
