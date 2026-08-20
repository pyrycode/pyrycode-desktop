// The "this pairing has ended" clear — framework-free and React-free, co-located with PairedShell
// beside its other pure helpers activateConversation.ts and pairedRoute.ts, and mirroring
// unpairAction.ts / composerSend.ts: the effects are injected so the helper is a pure, deterministic
// function tested with plain spies (no React, no store, no Electron). PairedShell's two pairing-change
// sites — the unpair route flip and the pair-another-server transition — are thin glue over this.
import type { ThreadEvent } from './store/threadTimeline'
import type { SessionAction } from './store/sessionStore'

/**
 * The five effects clearPairingScopedState performs, injected to keep it pure:
 *  - `dispatchTimeline`        — timelineStore's dispatch; carries #528's `reset` (a full wipe).
 *  - `clearActiveConversation` — activeConversationStore's #529 clear.
 *  - `clearSessionId`          — sessionIdStore's #529 clear.
 *  - `clearAnnouncedModel`     — announcedModelStore's #593 clear.
 *  - `dispatchSession`         — sessionStore's dispatch; carries #166's `reset`.
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
 * the `connected` edge, then repopulated) and `runConfigStore` (re-requested by RunConfigData's
 * id-keyed effect) all self-heal, and adding them would be dead code. Nor does a store the `connected`
 * edge clears for its own reasons — `backgroundTaskRosterStore`, whose bridge branch is the sole
 * enforcement of #573's AC5 (backgroundTaskRosterBridge.ts:118-127). The discriminator between the two
 * mechanisms is "does a reconnect to the SAME daemon need to clear it?": yes ⇒ the `connected` edge,
 * no ⇒ here.
 */
export interface ClearPairingScopedStateDeps {
  dispatchTimeline: (event: ThreadEvent) => void
  clearActiveConversation: () => void
  clearSessionId: () => void
  clearAnnouncedModel: () => void
  dispatchSession: (action: SessionAction) => void
}

/**
 * Drop every piece of renderer state scoped to the pairing that just ended — the thread rows, the
 * active conversation, the daemon session id, claude's announced running model, and the session store's
 * status + coarse message list.
 *
 * Called from BOTH paths that end a pairing, which is the whole design. Unpair flips the App route to
 * `pairing` and unmounts PairedShell; pair-another-server transitions `pairServer` → `list` INSIDE the
 * shell (pairedRoute.ts:62-65), so the shell never unmounts and nothing a remount would have cleared
 * gets cleared. Four of these five stores latch across either switch because nothing on a new pairing
 * re-asserts them: the timeline has no history backfill (its only production writers are the live
 * stream, timelineBridge.ts:206, and the composer's optimistic echo, composerSend.ts:67),
 * `activeConversation` is written only by a nav action, `sessionId` only by a `sessionTransition`
 * marker, and the announced model only by `subscribeAnnouncedModel` (announcedModelBridge.ts:60-70),
 * driven by a turn's init line — so on a fresh pairing nothing writes it until the new daemon's first
 * turn, and until then #560's sheet would show the previous server's identifier. The session store is
 * the fifth and is IN the set rather than beside it: it used to be reset by `runUnpair` alone, and
 * leaving it there would have degraded this into "four clears plus a special case" — exactly the
 * per-path divergence that let the bug exist.
 *
 * Unconditional, unlike activateConversation's id gate. That helper guards because clearing a thread
 * the user is still reading would destroy rows that never come back; here the pairing itself is over,
 * so there is no state in which the rows, the conversation id, the session id or the announced model
 * legitimately survive. All five clears are idempotent by construction — both `reset` arms return their
 * shared `initialTimelineState` / `initialSessionState` BY REFERENCE and the three `clear*` setters
 * return their exported `initial*State` — so clearing an already-clear store is a no-op reference that
 * churns no subscriber (notably no `selectItems` re-render, which a fresh `[]` would cause; for the
 * announced model the cleared value is the `null` sentinel, so a selector's `Object.is` short-circuits
 * structurally). A guard would buy nothing and would be one more thing to get wrong.
 *
 * No ordering constraint among the five: they are independent whole-value writes and none reads
 * another's state. Fully synchronous, so on the renderer's single thread no observer can see a
 * half-cleared set, and React batches all five into the commit that carries the route change. Total —
 * no gate, no return value, no throw path.
 *
 * Nothing is logged, deliberately: a diagnostic here would want the conversation `id` / `name` / `cwd`
 * or the session id to be useful, which ADR 0007's content-free rule forbids, and there is no observed
 * failure to instrument. The announced model is worse than the other four on that axis — it is
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
  deps.clearActiveConversation()
  deps.clearSessionId()
  deps.clearAnnouncedModel()
  deps.dispatchSession({ type: 'reset' })
}
