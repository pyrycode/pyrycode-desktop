// The "this pairing has ended" clear — framework-free and React-free, co-located with PairedShell
// beside its other pure helpers activateConversation.ts and pairedRoute.ts, and mirroring
// unpairAction.ts / composerSend.ts: the effects are injected so the helper is a pure, deterministic
// function tested with plain spies (no React, no store, no Electron). PairedShell's two pairing-change
// sites — the unpair route flip and the pair-another-server transition — are thin glue over this.
import type { ThreadEvent } from './store/threadTimeline'
import type { SessionAction } from './store/sessionStore'

/**
 * The twelve effects clearPairingScopedState performs, injected to keep it pure:
 *  - `dispatchTimeline`        — timelineStore's dispatch; carries #528's `reset` (a full wipe).
 *  - `clearAllTimelines`       — conversationTimelineStore's #757 whole-map clear; takes NO id.
 *  - `clearActiveConversation` — activeConversationStore's #529 clear.
 *  - `clearSessionId`          — sessionIdStore's #529 clear.
 *  - `clearAnnouncedModel`     — announcedModelStore's #593 clear.
 *  - `clearAllSlashCommandLists` — slashCommandListStore's #955 whole-map clear; takes NO id.
 *  - `clearAllModelLists`      — modelListStore's #977 whole-map clear; takes NO id.
 *  - `clearAllConversations`   — conversationListStore's #1086 whole-map clear; takes NO id.
 *  - `clearAllBacklogs`        — queueStore's #1138 whole-map clear; takes NO id.
 *  - `clearAllRosters`         — backgroundTaskRosterStore's #1139 whole-map clear; takes NO id.
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
 * while the slice was dormant, and #593 added it here rather than at either call site.
 * `slashCommandListStore` (#954 dormant, #955 cleared) repeated that sequence verb for verb, and
 * `modelListStore` (#974 dormant, #977 cleared) a third time. A store that
 * DOES re-assert itself does not belong here at all: as of #531 `recentWorkspacesStore` (re-fetched by
 * remounting the picker), `serverInfoStore` (a one-shot mount invoke), `modalStore`
 * (cleared by the `connected` edge, then repopulated) and `runConfigStore` (re-requested on the
 * `connected` edge itself, and on each turn-end edge, by `RunConfigLiveData`'s refresh trigger, #810)
 * all self-heal, and adding them would be dead code. The discriminator between the two mechanisms is
 * "does a reconnect to the SAME daemon need to clear it?": yes ⇒ the `connected` edge, no ⇒ here — and
 * as `queueStore` and `backgroundTaskRosterStore` show, a store can answer YES to that question and
 * still belong here, because the two mechanisms cover different boundaries once the edge is scoped per
 * server. `backgroundTaskRosterStore` USED TO BE this paragraph's counter-example, cited by name as a
 * store the `connected` edge cleared for its own reasons; #1139 moved it into the set, so that
 * sentence is gone rather than softened.
 *
 * `conversationListStore` USED TO BE the first name on that self-healing list, and #1086 moved it into
 * the set — the only member here that arrived because a later ticket REMOVED its self-heal rather than
 * because its slice woke up. #531's argument was sound while the store held one array: a
 * `list_conversations` request on mount re-listed and the whole-array replace overwrote everything, so
 * a clear here would have been dead code. Keying the list by server retires that argument in full.
 * The new pairing's reply now lands in the NEW server's slot; the departed server's slot is never
 * written again, and the app-wide read is a UNION across slots, so those rows go on rendering — a
 * silent stale-data leak across a pairing boundary, of untrusted daemon-supplied text attributed to a
 * machine the operator has left. Re-run against the discriminator above, the answer flipped: a
 * reconnect to the SAME daemon needs no clear (its own slot is simply rewritten), so this is the
 * mechanism, not the `connected` edge — and blanking it there would blank a healthy second server's
 * rows every time the first one reconnected.
 *
 * `queueStore` (#1138) is the SECOND name to move off that self-healing list, and it moved for the same
 * structural reason as the first: a later ticket removed the self-heal. #531's argument was sound while
 * #197's reconnect reset cleared the WHOLE backlog map — a re-pairing's first `connected` blanked every
 * latched backlog on its way past, so a clear here would have been dead code. Scoping that reset to the
 * reconnecting server's own conversations retires the argument. The new pairing's first `connected`
 * resolves an empty conversation list (its slot is not filled until the `list_conversations` reply
 * lands), matches no held key, and hands the state object straight back; and nothing else evicts a
 * backlog, because the daemon re-sends `queue_state` only for NON-EMPTY conversations. A conversation
 * that DRAINED while unpaired therefore gets no re-send and shows its stale pre-drop backlog
 * indefinitely — the exact bug #197 shipped to fix, reintroduced at the pairing boundary. Unlike the
 * conversation rows this is not a cross-attribution leak in general (a backlog renders only under its
 * own conversation id, and #1086's clear means no row points at it), but conversation ids are
 * daemon-side and a re-pair to the SAME box reuses them, so the phantom is reachable and untrusted
 * daemon-supplied text outlives the pairing that produced it. Re-run against the discriminator, the
 * answer here is BOTH mechanisms rather than a flip: the `connected` edge covers a reconnect's listed
 * conversations, which this clear must not usurp (blanking at the edge would blank a healthy second
 * server's backlogs, #1138's whole point), and this covers the pairing change, which the edge no longer
 * reaches.
 *
 * `backgroundTaskRosterStore` (#1139) is the THIRD name to move off that self-healing list, and it is
 * the one the paragraph above used to cite BY NAME as the counter-example — a store the `connected`
 * edge cleared for its own reasons, whose bridge branch was the sole enforcement of #573's AC5. Scoping
 * that branch to the reconnecting server ended both claims, by exactly the `queueStore` argument one
 * notch harsher. The new pairing's first `connected` resolves an empty conversation list, matches no
 * held key, and hands the state object back; and where a DRAINED conversation was the queue's only
 * stale case, NOTHING re-asserts a roster ever — no frame in that family is in the daemon's
 * reconcile-on-connect set and this app advertises no `last_event_id` (#569 owns that gap) — so every
 * held roster latches, not merely an unlucky one. The content is the sharpest this set handles: a held
 * task's `description` for `taskType: local_bash` IS the literal command line claude ran, and its
 * `latestUpdate.patch` is the same class of untrusted, model-influenced text under a structured-looking
 * shape, both left on screen attributed to a machine the operator has left. Scoping also leaves a
 * roster held under a conversation NO server's list carries untouched by every scoped reset — reachable
 * rather than theoretical, because a background task can start for a conversation whose list has not
 * arrived — and this clear is the only thing that ever collects one. Re-run against the discriminator,
 * the answer is BOTH mechanisms, the same split as `queueStore`: those two are why the membership rule
 * above no longer reads "a store the `connected` edge clears does not belong here".
 */
export interface ClearPairingScopedStateDeps {
  dispatchTimeline: (event: ThreadEvent) => void
  clearAllTimelines: () => void
  clearActiveConversation: () => void
  clearSessionId: () => void
  clearAnnouncedModel: () => void
  clearAllSlashCommandLists: () => void
  clearAllModelLists: () => void
  clearAllConversations: () => void
  clearAllBacklogs: () => void
  clearAllRosters: () => void
  dispatchSession: (action: SessionAction) => void
  clearAllLastRead: () => void
}

/**
 * Drop every piece of renderer state scoped to the pairing that just ended — the thread rows, EVERY
 * conversation's retained per-conversation thread, the active conversation, the daemon session id,
 * claude's announced running model, EVERY conversation's published slash-command menu, EVERY
 * conversation's published model menu, EVERY server's conversation rows, EVERY conversation's queued
 * backlog, the session store's status + coarse message list, and how far the operator had read into
 * each conversation.
 *
 * Called from BOTH paths that end a pairing, which is the whole design. Unpair flips the App route to
 * `pairing` and unmounts PairedShell; pair-another-server transitions `pairServer` → `list` INSIDE the
 * shell (pairedRoute.ts:62-65), so the shell never unmounts and nothing a remount would have cleared
 * gets cleared. Eleven of these twelve stores latch across either switch because nothing on a new pairing
 * re-asserts them: neither timeline has any history backfill (their only production writers are the
 * live stream, timelineBridge.ts:347, and the composer's optimistic echo, composerSend.ts:82) — and
 * the keyed one is worse than the flat one, because it holds EVERY conversation's thread rather than
 * only the open one, and a conversation id is scoped to the server that issued it, so a slice from the
 * old server could be keyed under an id the new one reuses. `activeConversation` is written only by a
 * nav action, `sessionId` only by a `sessionTransition` marker, and the announced model only by
 * `subscribeAnnouncedModel` (announcedModelBridge.ts:60-70), driven by a turn's init line — so on a
 * fresh pairing nothing writes it until the new daemon's first turn, and until then #560's sheet would
 * show the previous server's identifier. The published slash-command menus (#955) latch the same way and
 * for a sharper reason: the path is PUSH-ONLY — the daemon publishes each menu unsolicited from a
 * conversation's `initialize` reply and there is no request half — so nothing on a new pairing re-asserts
 * one, and a retained menu is a list of VERBS attributed to a workspace the operator has left. #681's
 * Actions-menu grey-out reads it, so a stale one steers behaviour rather than merely showing a stale
 * label. That same absent request half is why the `connected` edge must NOT clear it: a reconnect to the
 * same daemon leaves the menu correct, and blanking it there would blank it permanently.
 * The published model menus (#977) latch for exactly those reasons — same push-only `initialize` lane,
 * same absent request half, same `connected`-edge answer — and are sharper again on two axes. Their
 * rows are CLAUDE-authored rather than workspace-authored, a HIGHER trust tier; and a retained list is
 * not merely attributed to the wrong machine but ACTIONABLE against it, because #975's sheet offers
 * those rows and picking one sends a model argument the newly paired daemon validates and rejects.
 * The conversation rows (#1086) latch for a DIFFERENT reason from all of those, and it is the reason
 * this store was excluded here until now: its request half exists and fires on mount, so it used to
 * overwrite itself. Since the list is keyed by server, the new pairing's reply fills the new server's
 * slot instead and leaves the departed server's untouched, while the app-wide read unions across both
 * — so the rows latch not for want of a re-assertion but because the re-assertion no longer reaches
 * them.
 * The queued backlogs (#1138) latch for the CLOSEST reason to those rows and by the same mechanism
 * turned one notch further: their re-assertion exists, is push-only like the two menus, and arrives on
 * the `connected` edge — but the daemon re-sends `queue_state` only for a NON-EMPTY conversation, so a
 * conversation that drained while unpaired is re-asserted by nothing at all. Until #1138 the edge's own
 * whole-map reset covered that gap incidentally; scoping the reset to the reconnecting server's
 * conversations means the new pairing's first `connected` resolves an empty list and drops nothing. The
 * residue is a queue rail showing messages the operator's new server never queued and has no way to
 * retract — and because conversation ids are daemon-side, re-pairing to the same box reuses the id the
 * phantom is filed under.
 * The background-task rosters (#1139) latch for the SAME reason as those backlogs, with that notch
 * turned as far as it goes: their re-assertion does not exist at all. No frame in the family is in the
 * daemon's reconcile-on-connect set and this app advertises no `last_event_id` (#569 owns that gap), so
 * where a drained conversation was the queue's unlucky case, EVERY held roster is stale after a pairing
 * change and none of them ever refreshes. Until #1139 the edge's own whole-map reset covered that gap
 * incidentally, the same accident #1138 removed next door. The residue is the sharpest content this set
 * handles: a held task's `description` for `taskType: local_bash` IS the literal command line claude
 * ran, and its `latestUpdate.patch` is the same class of untrusted, model-influenced text under a
 * structured-looking shape, both presented as live work on a machine the operator has left. And this
 * clear reaches one thing no scoped reset can: a roster held under a conversation NO server's list
 * carries, which happens whenever a background task starts for a conversation whose list has not
 * arrived.
 * The last-read marks (#779) latch HARDER than the other eight,
 * because #776 persists them to `localStorage`: they survive not only either switch but the restart
 * after it, so clearing the in-memory slice alone would leave the previous pairing's marks on disk to be
 * re-hydrated at next launch — a failure that looks correct in memory and is silent. Reaching the
 * persisted bytes is what makes persisting them defensible at all, which is why this clear is the
 * counterweight to #776 rather than a tidy-up after it. The session store is IN the
 * set rather than beside it: it used to be reset by `runUnpair` alone, and leaving it there would have
 * degraded this into "ten clears plus a special case" — exactly the per-path divergence that let the
 * bug exist.
 *
 * Unconditional, unlike activateConversation's id gate. That helper guards because clearing a thread
 * the user is still reading would destroy rows that never come back; here the pairing itself is over,
 * so there is no state in which the rows, the conversation id, the session id, the announced model or
 * the read marks, either kind of published menu, a queued backlog or a background-task roster
 * legitimately survive. All twelve clears are idempotent by
 * construction — both `reset` arms return their shared `initialTimelineState` / `initialSessionState` BY
 * REFERENCE and the `clear*` setters return their exported `initial*State` — so clearing an already-clear
 * store is a no-op reference that churns no subscriber (notably no `selectItems` re-render, which a fresh
 * `[]` would cause; for the announced model the cleared value is the `null` sentinel, so a selector's
 * `Object.is` short-circuits structurally). Where a clear DOES carry a `size === 0` guard, the guard is
 * doing one of two DIFFERENT jobs, and they must not be conflated:
 *
 *   - THE SUBSCRIBER SHORT-CIRCUIT, which `clearAllTimelines`, `clearAllSlashCommandLists`,
 *     `clearAllModelLists`, `clearAllConversations`, `clearAllBacklogs` and `clearAllRosters` carry.
 *     Handing the state OBJECT straight back on an empty map makes zustand's `Object.is(next, state)`
 *     fire, so a redundant clear wakes NO listener at all rather than only sparing the selectors. That
 *     is what those guards exist for, rather than to save a `Map` allocation.
 *   - THE SIDE EFFECT, which only `clearAllLastRead` has: without its guard every unpair would fire a
 *     redundant synchronous `localStorage.setItem` (conversationLastReadStore.ts's clear documents why
 *     that guard must test `size`, not a reference). Nothing else here reaches outside memory.
 *
 * The remaining clears need neither job done and stay unguarded, where a guard would buy nothing and be
 * one more thing to get wrong.
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
 *   - THE THROW. Eleven of the twelve are pure in-memory store writes that cannot throw.
 *     `clearAllLastRead` is the only one with an external side effect, so it is the only one that can.
 *     Mid-body, a throw from it would abort every clear after it — including `clearSessionId`, whose
 *     clear is the security payload below, leaving server A's session id live and addressable while
 *     the operator is on server B; including `clearAllSlashCommandLists`, leaving server A's
 *     workspace-authored verb menu live for #681 to grey entries against; including
 *     `clearAllModelLists`, leaving server A's claude-authored model identities live for #975's sheet
 *     to offer against server B; and including `clearAllRosters`, leaving server A's literal
 *     `local_bash` command lines and patch text on screen as live background work, which nothing else
 *     could ever overwrite. Last, a throw aborts nothing. This costs no code and adds no try/catch for
 *     an unobserved failure; it is a free ordering property, and the test pins it by call order rather
 *     than trusting this paragraph.
 *
 * Adjacency to `clearAllTimelines` would have read better on its own terms — a mark is a sampled count
 * of a keyed timeline's items, so the two are one fact against two stores — but the throw ordering
 * outranks legibility, so do NOT tidy it back up beside its sibling. Hoisting `clearActiveConversation()`
 * to the top instead, which would make the open id `null` and remove the re-mint rather than cleaning up
 * after it, was considered and rejected: it buys no additional correctness and reorders pre-existing
 * lines this ticket was not asked to touch.
 *
 * The other eleven have no ordering constraint among themselves: they are independent whole-value writes
 * and none reads another's state. Fully synchronous, so on the renderer's single thread no observer can
 * see a half-cleared set, and React batches all twelve into the commit that carries the route change.
 * Total — no gate, no return value, no throw path of this function's own.
 *
 * Nothing is logged, deliberately: a diagnostic here would want the conversation `id` / `name` / `cwd`
 * or the session id to be useful, which ADR 0007's content-free rule forbids, and there is no observed
 * failure to instrument — and the marks clear is no exception: the only value a diagnostic there could
 * carry is the untrusted conversation id it discards. The announced model is worse than most of the rest
 * on that axis — it is
 * untrusted, model-influenced daemon-relayed text (announcedModelStore.ts:46-51) that a diagnostic
 * would land verbatim in a log file — so it MUST NOT be logged here either, and the published menus are
 * WORSE STILL: `name`, `argument_hint`, `description` and every string in `aliases` are
 * WORKSPACE-authored, a lower trust tier again, and `0x0a` is the only sub-`0x20` byte across the
 * measured capture — the one control character that actually occurs is the one that splits a log line,
 * so a logged `description` is a workspace author forging log records. Even a content-free count of
 * what was dropped stays unwritten: this function's no-diagnostic property is total, and a count is the
 * first crack in it. The one seam that does
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
  // Beside the announced model, the other clear of untrusted daemon-relayed text, and the only one that
  // reaches WORKSPACE-authored strings. Nullary like the two whole-map clears around it, so no
  // daemon-supplied conversation id can steer which workspace's verbs survive the boundary. Position is
  // free among the eleven in-memory clears; what is NOT free is that it must precede
  // `clearAllLastRead`.
  deps.clearAllSlashCommandLists()
  // Beside its structural twin, because the two are one fact against two stores: both drop a menu the
  // daemon published unsolicited from the same `initialize` reply. Nullary for the same reason and a
  // sharper one — these rows are CLAUDE-authored, so an id-taking clear would let a daemon-supplied
  // conversation id steer which machine's model identities survive the boundary. Position is free
  // among the eleven in-memory clears; what is NOT free is that it must precede `clearAllLastRead`.
  deps.clearAllModelLists()
  // #1086: every server's conversation rows, dropped as one. Nullary like the three whole-map clears
  // above, and for the same argument applied to a sharper input — the ids it declines to take are
  // conversation ids from a list the DEPARTING daemon itself supplied. Unlike its neighbours this one
  // is not here because a dormant slice woke up: keying the list by server removed the self-heal that
  // kept it out (see the header), so this call is the fix for the one regression that keying
  // introduces. Position is free among the eleven in-memory clears — it reaches nothing outside memory
  // and so cannot throw — but it must precede `clearAllLastRead` like the rest.
  deps.clearAllConversations()
  // #1138: every conversation's queued backlog, dropped as one. Beside `clearAllConversations` because
  // the two are one fact against two stores — scoping the `connected` reset to the conversations the
  // list holds for the reconnecting server is what removed this store's self-heal, so the same ticket
  // that keys the reset by that list must clear this at the boundary the list is cleared at. Nullary
  // like the four whole-map clears above, and against the sharpest input yet: the ids it declines to
  // take are conversation ids, and a queued item's `text` is untrusted daemon-relayed content, so an
  // id-taking clear would let the departing daemon choose which of its own messages outlive it.
  // Position is free among the eleven in-memory clears — it reaches nothing outside memory and so cannot
  // throw — but it must precede `clearAllLastRead` like the rest.
  deps.clearAllBacklogs()
  // #1139: every conversation's background-task roster, dropped as one. Beside `clearAllBacklogs`
  // because the two are the same fact against two stores — scoping a `connected` reset to the
  // conversations the list holds for the reconnecting server is what removed each store's self-heal,
  // so the same ticket that keys the reset by that list must clear the store at the boundary the list
  // is cleared at. Nullary like the five whole-map clears above, and against the sharpest input in the
  // set: a held task's `description` for `taskType: local_bash` IS the literal command line claude ran
  // and its `latestUpdate.patch` is the same class of text, so an id-taking clear would let the
  // departing daemon choose which of its own command lines outlive it. Position is free among the
  // eleven in-memory clears — it reaches nothing outside memory and so cannot throw — but it must
  // precede `clearAllLastRead` like the rest.
  deps.clearAllRosters()
  deps.dispatchSession({ type: 'reset' })
  // LAST, and both halves of that are load-bearing — see the ordering constraint above. After
  // `clearAllTimelines()`, so the #777 listener's synchronous re-mint of the open conversation's mark is
  // wiped rather than left on disk; after everything else, so this one effect that can throw
  // (`localStorage`) can abort no other clear. Not adjacent to its sibling `clearAllTimelines`, however
  // well that would read.
  deps.clearAllLastRead()
}
