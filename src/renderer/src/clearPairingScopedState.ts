// The "this pairing has ended" clear — framework-free and React-free, co-located with PairedShell
// beside its other pure helpers activateConversation.ts and pairedRoute.ts, and mirroring
// unpairAction.ts / composerSend.ts: the effects are injected so the helper is a pure, deterministic
// function tested with plain spies (no React, no store, no Electron). PairedShell's two pairing-change
// sites — the unpair route flip and the pair-another-server transition — are thin glue over this.
import type { ThreadEvent } from './store/threadTimeline'
import type { SessionAction } from './store/sessionStore'

/**
 * The seven effects clearPairingScopedState performs, injected to keep it pure:
 *  - `dispatchTimeline`        — timelineStore's dispatch; carries #528's `reset` (a full wipe).
 *  - `clearAllTimelines`       — conversationTimelineStore's #757 whole-map clear; takes NO id.
 *  - `clearActiveConversation` — activeConversationStore's #529 clear.
 *  - `clearSessionId`          — sessionIdStore's #529 clear.
 *  - `clearAnnouncedModel`     — announcedModelStore's #593 clear.
 *  - `dispatchSession`         — sessionStore's dispatch; carries #166's `reset`.
 *  - `clearAllLastRead`        — conversationLastReadStore's #779 whole-map clear; takes NO id, and is
 *                                the only effect here that reaches DISK (see the ordering note below).
 *
 * The dispatches are typed against the real action unions rather than being bare `() => void` thunks,
 * so the dispatched action SHAPE is compile-checked and the test can assert the exact payload.
 *
 * This interface is the contract both pairing-change paths share, and that is the point: the bug this
 * fixes existed because each path decided its own clear set independently. A future pairing-scoped
 * store that nothing re-asserts on the new pairing belongs HERE, not at one call site — which is why
 * the test pins this key set. `announcedModelStore` is the worked example: #588 deferred its clear
 * while the slice was dormant, and #593 added it here rather than at either call site. A store that
 * DOES re-assert itself does not belong here at all: as of #531 `conversationListStore` (a
 * `list_conversations` request on mount), `recentWorkspacesStore` (re-fetched by remounting the
 * picker), `serverInfoStore` (a one-shot mount invoke), `queueStore` and `modalStore` (both cleared by
 * the `connected` edge, then repopulated) and `runConfigStore` (re-requested on the `connected` edge
 * itself, and on each turn-end edge, by `RunConfigLiveData`'s refresh trigger, #810) all self-heal,
 * and adding them would be dead code. Nor does a store the `connected`
 * edge clears for its own reasons — `backgroundTaskRosterStore`, whose bridge branch is the sole
 * enforcement of #573's AC5 (backgroundTaskRosterBridge.ts:118-127). The discriminator between the two
 * mechanisms is "does a reconnect to the SAME daemon need to clear it?": yes ⇒ the `connected` edge,
 * no ⇒ here.
 */
export interface ClearPairingScopedStateDeps {
  dispatchTimeline: (event: ThreadEvent) => void
  clearAllTimelines: () => void
  clearActiveConversation: () => void
  clearSessionId: () => void
  clearAnnouncedModel: () => void
  dispatchSession: (action: SessionAction) => void
  clearAllLastRead: () => void
}

/**
 * Drop every piece of renderer state scoped to the pairing that just ended — the thread rows, EVERY
 * conversation's retained per-conversation thread, the active conversation, the daemon session id,
 * claude's announced running model, the session store's status + coarse message list, and how far the
 * operator had read into each conversation.
 *
 * Called from BOTH paths that end a pairing, which is the whole design. Unpair flips the App route to
 * `pairing` and unmounts PairedShell; pair-another-server transitions `pairServer` → `list` INSIDE the
 * shell (pairedRoute.ts:62-65), so the shell never unmounts and nothing a remount would have cleared
 * gets cleared. Six of these seven stores latch across either switch because nothing on a new pairing
 * re-asserts them: neither timeline has any history backfill (their only production writers are the
 * live stream, timelineBridge.ts:347, and the composer's optimistic echo, composerSend.ts:82) — and
 * the keyed one is worse than the flat one, because it holds EVERY conversation's thread rather than
 * only the open one, and a conversation id is scoped to the server that issued it, so a slice from the
 * old server could be keyed under an id the new one reuses. `activeConversation` is written only by a
 * nav action, `sessionId` only by a `sessionTransition` marker, and the announced model only by
 * `subscribeAnnouncedModel` (announcedModelBridge.ts:60-70), driven by a turn's init line — so on a
 * fresh pairing nothing writes it until the new daemon's first turn, and until then #560's sheet would
 * show the previous server's identifier. The last-read marks (#779) latch HARDER than the other five,
 * because #776 persists them to `localStorage`: they survive not only either switch but the restart
 * after it, so clearing the in-memory slice alone would leave the previous pairing's marks on disk to be
 * re-hydrated at next launch — a failure that looks correct in memory and is silent. Reaching the
 * persisted bytes is what makes persisting them defensible at all, which is why this clear is the
 * counterweight to #776 rather than a tidy-up after it. The session store is the seventh and is IN the
 * set rather than beside it: it used to be reset by `runUnpair` alone, and leaving it there would have
 * degraded this into "six clears plus a special case" — exactly the per-path divergence that let the bug
 * exist.
 *
 * Unconditional, unlike activateConversation's id gate. That helper guards because clearing a thread
 * the user is still reading would destroy rows that never come back; here the pairing itself is over,
 * so there is no state in which the rows, the conversation id, the session id, the announced model or
 * the read marks legitimately survive. All seven clears are idempotent by construction — both `reset`
 * arms return their shared `initialTimelineState` / `initialSessionState` BY REFERENCE and the `clear*`
 * setters return their exported `initial*State` — so clearing an already-clear store is a no-op
 * reference that churns no subscriber (notably no `selectItems` re-render, which a fresh `[]` would
 * cause; for the announced model the cleared value is the `null` sentinel, so a selector's `Object.is`
 * short-circuits structurally; and `clearAllTimelines` hands its state object straight back on an empty
 * map, which is what that guard exists for rather than to save a `Map` allocation). A guard would buy
 * nothing and would be one more thing to get wrong — for those six. `clearAllLastRead` is the exception
 * and carries an explicit `size === 0` guard, because it is the one clear with a SIDE EFFECT to suppress:
 * without the guard every unpair would fire a redundant synchronous `localStorage.setItem`
 * (conversationLastReadStore.ts's clear documents why the guard must test `size`, not a reference).
 *
 * ONE ORDERING CONSTRAINT, and it is the sharp edge of #779: `clearAllLastRead` MUST run AFTER
 * `clearAllTimelines`, and it is placed LAST. Two independent reasons, either sufficient:
 *
 *   - THE RE-MINT. #777's `useConversationLastRead` subscribes to `conversationTimelineStore` for as long
 *     as PairedShell is mounted, so `clearAllTimelines()` — a real state change whenever any thread is
 *     retained — notifies that listener SYNCHRONOUSLY from inside this function. At that instant
 *     `clearActiveConversation()` has not run, so the listener still sees the ended pairing's
 *     conversation as open, finds its slice already gone, and records a mark of `0` for it — persisting
 *     server A's conversation id to disk, where it survives a restart, with every in-memory assertion
 *     still green. Clearing the marks afterwards wipes that re-mint in memory and on disk before this
 *     function returns, and nothing in between re-fires the subscription: the flat `dispatchTimeline`
 *     reset targets `timelineStore`, which that bridge does not subscribe to
 *     (conversationLastReadBridge.ts:207), and none of the remaining effects touches
 *     `conversationTimelineStore`.
 *   - THE THROW. Six of the seven are pure in-memory store writes that cannot throw. `clearAllLastRead`
 *     is the only one with an external side effect, so it is the only one that can. Mid-body, a throw
 *     from it would abort every clear after it — including `clearSessionId`, whose clear is the security
 *     payload below, leaving server A's session id live and addressable while the operator is on server
 *     B. Last, a throw aborts nothing. This costs no code and adds no try/catch for an unobserved
 *     failure; it is a free ordering property.
 *
 * Adjacency to `clearAllTimelines` would have read better on its own terms — a mark is a sampled count
 * of a keyed timeline's items, so the two are one fact against two stores — but the throw ordering
 * outranks legibility, so do NOT tidy it back up beside its sibling. Hoisting `clearActiveConversation()`
 * to the top instead, which would make the open id `null` and remove the re-mint rather than cleaning up
 * after it, was considered and rejected: it buys no additional correctness and reorders pre-existing
 * lines this ticket was not asked to touch.
 *
 * The other six have no ordering constraint among themselves: they are independent whole-value writes
 * and none reads another's state. Fully synchronous, so on the renderer's single thread no observer can
 * see a half-cleared set, and React batches all seven into the commit that carries the route change.
 * Total — no gate, no return value, no throw path of this function's own.
 *
 * Nothing is logged, deliberately: a diagnostic here would want the conversation `id` / `name` / `cwd`
 * or the session id to be useful, which ADR 0007's content-free rule forbids, and there is no observed
 * failure to instrument — and the marks clear is no exception: the only value a diagnostic there could
 * carry is the untrusted conversation id it discards. The announced model is worse than the other six on
 * that axis — it is
 * untrusted, model-influenced daemon-relayed text (announcedModelStore.ts:46-51) that a diagnostic
 * would land verbatim in a log file — so it MUST NOT be logged here either. The one seam that does
 * exist is pre-existing and content-free — the session store's #134 transition observer
 * (sessionStore.ts:162) records the `reset` action's type.
 *
 * One intended consequence, the same one activateConversation documents: clearing the session id makes
 * RunConfigSections' `onChange` `undefined` (RunConfigSections.tsx:322,333-338), so the Run
 * configuration controls render INERT until the newly paired daemon's first `sessionTransition` marker
 * arrives. That is the security payload, not a regression — inert beats addressing a YOLO /
 * auto-approval write to a session that only ever existed on the daemon the user just left.
 */
export function clearPairingScopedState(deps: ClearPairingScopedStateDeps): void {
  deps.dispatchTimeline({ type: 'reset' })
  // Immediately after the flat reset, the dual-write idiom the two row-adding writers already use
  // (composerSend.ts:82 then :88, timelineBridge.ts:347 then :349): one fact expressed against two
  // stores. It also puts the keyed clear where the flat one stands, so retiring the flat store later
  // is a deletion rather than a move.
  deps.clearAllTimelines()
  deps.clearActiveConversation()
  deps.clearSessionId()
  deps.clearAnnouncedModel()
  deps.dispatchSession({ type: 'reset' })
  // LAST, and both halves of that are load-bearing — see the ordering constraint above. After
  // `clearAllTimelines()`, so the #777 listener's synchronous re-mint of the open conversation's mark is
  // wiped rather than left on disk; after everything else, so this one effect that can throw
  // (`localStorage`) can abort no other clear. Not adjacent to its sibling `clearAllTimelines`, however
  // well that would read.
  deps.clearAllLastRead()
}
