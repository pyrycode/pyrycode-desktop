# #1559 — Route the session reset separator by the frame's conversation id

## Files read

- `src/renderer/src/store/timelineBridge.ts` → `timelineTargetFor`, `timelineWriteTarget`, `joinKeyToRecord`, `subscribeTimeline`, `useTimelineBridge` — the whole routing contract; the two edits live here.
- `src/renderer/src/store/timelineBridge.test.ts` → the `timelineTargetFor` / `timelineWriteTarget` describes, the `the dual write into both stores (#756)` describe (`fanOut`, `wired`), and `subscribeTimeline — the join key reaches the dispatch (#1225)` — every test pinning the old screen-routing.
- `src/renderer/src/store/historyPageBridge.ts` → `withoutLiveEntries`, `reduceHistoryPage` — the page half of the join; the "`sessionTransition` also ends the run" paragraph is now false.
- `src/renderer/src/store/conversationTimelineStore.ts` → `dispatchFor` (creates a missing slice, records the join key only when the fold changed something), `selectLiveJoinKeysFor` — why the change needs no store edit.
- `src/shared/ipc/events.ts` → the `sessionTransition` arm's docblock ("Its one renderer consumer … never stored") and `DaemonEventTimestamp` / `WithDaemonTs` (every arm type-admits `daemonTs`, so a stamped `connected` is expressible in a test).
- `src/main/daemonConnection.ts` → the `sessionTransition` emit copies `conversation_id` by name and stamps `daemonTs: inbound.ts` — so the arm already carries a live join key.
- `src/main/transport/inboundMessage.ts` → the `session_transition` decode `requireString`s `conversation_id` — required, same as the eleven id-carrying arms.
- `e2e/session-transition-cross-conversation.spec.ts` → the #1192 drive (seed A, create B, push a marker naming A); the new test joins this file and reuses its framing.
- `e2e/composer-new-session.spec.ts` → how the fake tier drives Reset session (Actions → `Reset session`, captured `new_session`, `resetting` frames, `.composer-status .conversation__thinking` label).
- `e2e/model-refusal.spec.ts`, `thread-shadow.spec.ts`, `thread-scroll-pin.spec.ts`, `composer-permission-mode-menu.spec.ts` — every other fake spec pushing `session_transition` names the chat on screen, so none changes behaviour.
- `e2e/real-claude-new-session.spec.ts` — already asserts exactly one delimiter in the reset chat; no edit, the dispatcher runs it.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=119-3843

A full-width, single-line divider: a thin hairline rule either side of the centred muted label "Session reset" on the dark thread background. Nothing about it changes here — no markup, class or token is touched; only the thread it is filed into changes.

## Context

Observed live 2026-09-22: Reset session in Home, switch to Pyry setup during the wrap-up turn, and the separator lands in Pyry setup, never in Home. `timelineTargetFor` returns `null` for `sessionTransition` by choice, and `timelineWriteTarget` then files the `sessionBoundary` into `getOpenConversationId()`. The frame has carried a required `conversationId` since #1192, which named routing by it as a second deliverable. This is that deliverable. Mobile routes the boundary strictly by `conversation_id` (mobile #336).

No ADR needed: this applies the #675-family rule (route by the frame's own key, never the screen) to one more arm.

## Design

Three production files; two of them comment-only.

1. **`timelineTargetFor`** — move `case 'sessionTransition':` out of the `connected` group into the id-carrying group, so it returns `event.conversationId` like the other eleven arms (now twelve of thirteen). The second group keeps `connected` alone; its comment is rewritten to say a connection edge is the only owned arm with no conversation. No `''` special case: the decode requires the field, like its eleven siblings, which get none either.
2. **`timelineWriteTarget`** — drop `sessionBoundary` from the enumerated fallback. Only `reconnected` reads the open conversation now; an unattributed `sessionBoundary` (unreachable in production) falls to `default` and resolves to `null` without calling the getter. The attributed-first check is unchanged, which is the precedence the old docblock predicted "with no edit here".
3. **`joinKeyToRecord`** — no code change. Its guard (`conversationId === null ⇒ no key`) now covers `connected` only; `sessionTransition` is attributed, so `subscribeTimeline` hands `dispatch` its `liveJoinKeyFor` key, and `dispatchFor` records it against A's slice (a boundary always appends a row, so the fold always changes state). Docblock corrected.
4. **Docblock corrections, not deletions** — `timelineTargetFor` (the #785 "four conditions" list names two fallback arms → one), `timelineWriteTarget`, `joinKeyToRecord`, `useTimelineBridge` ("the two arms that carry none" → `reconnected`), the translator's `sessionTransition` case comment where it describes routing, `withoutLiveEntries`' "`sessionTransition` also ends the run" paragraph (it now joins like any stamped arm; no code change there), and the `sessionTransition` arm in `events.ts`, whose "one renderer consumer … never stored" line becomes false — the id is now also a `Map` key in the keyed timeline store.

`App.tsx`, `useTimelineBridge`'s signature, the flat `timelineStore` write, `sessionIdStore`, the wire and the daemon are untouched (ticket's out-of-scope list).

## State + concurrency model

No new state or async work. One synchronous listener per app lifetime is unchanged; the only difference is which `Map` entry `dispatchFor` writes. `dispatchFor` already creates a missing slice (`withNewSliceAtHead`), so a boundary naming a chat never opened this run creates that slice, subject to the existing `MAX_RETAINED_TIMELINES` eviction.

## Error handling

No new failure modes. A marker naming an id no chat uses creates an unread slice — the same outcome the eleven sibling arms already have for a stray id.

## Testing strategy

Unit (`timelineBridge.test.ts`, updating the pinned tests in place, not duplicating):
- `timelineTargetFor`: the "returns null for sessionTransition" test becomes "returns the frame's own conversationId"; the `connected` null test stays.
- `timelineWriteTarget`: "files a sessionBoundary into the conversation on screen" becomes "an unattributed sessionBoundary resolves to null and never reads the open conversation"; the precedence pin's comment is corrected (now the production path).
- Dual-write describe: `fanOut` gains the third `joinKey` argument so it stays a faithful copy of `useTimelineBridge`. The three screen-routing tests are rewritten: a boundary naming A lands in A while B is on screen, B's slice untouched by reference; a boundary naming the open chat still appends there in arrival order; with nothing open, the boundary creates its own slice and `connected` creates none. The flat store still receives both arms.
- AC2: a stamped boundary naming A while B is open records `joinKeyFor('sessionTransition', ts)` in A's `selectLiveJoinKeysFor`, not B's, and `reduceHistoryPage` over a page holding the same entry with those keys draws no `sessionBoundary`.
- The ⭐ join-key test switches its example to a stamped `connected` (still no key); a sibling asserts a stamped `sessionTransition` now passes its id and key.

E2E (new test in `e2e/session-transition-cross-conversation.spec.ts`): reset A from the Actions menu (captured `new_session` names A), push `resetting` naming A and see the label, create and open B (positive signal: B's `request_session_settings` is captured), push `session_transition` naming A, then an `assistant_delta` naming B as the ordering barrier — its bubble text visible in B proves the marker was consumed. Then B has zero `.session-delimiter`; click A's row and A has exactly one, and its reset label has cleared (the boundary reached A's slice).

Real-claude (`e2e/real-claude-new-session.spec.ts`): unchanged; the dispatcher's live gate runs it (`needs-real-claude`).

## Documentation handoff

Pending for the documentation stage. The ticket names no doc, but these overviews state the old behaviour and go stale:
- `docs/knowledge/features/conversation-timeline-store-internals.md` — the `timelineWriteTarget` sketch (`case 'sessionBoundary': case 'reconnected': return getOpenConversationId()`) and the paragraph saying `sessionTransition` contributes no live key.
- `docs/knowledge/features/conversation-timeline-store-history.md` — the lines saying the open-conversation fallback serves `sessionTransition` and that its live key is withheld (duplicate divider).

## Open questions

- Does the barrier bubble render in B with no preceding `turn_state`? `assistant-whitespace.spec.ts` pushes bare deltas for the seeded chat and they draw, so yes; resolve in the run.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings. `conversation_id` is daemon-asserted and crosses one boundary, the `session_transition` decode in `inboundMessage.ts`, which `requireString`s it. The `sessionTransition` emit in `daemonConnection.ts` copies it by name. In the renderer it becomes what the eleven sibling arms' ids already are: a key into `conversationTimelineStore`'s `timelines` `Map`, never a bare-object property, so a `__proto__`-shaped id cannot write through `Object.prototype`. A hostile daemon can now file a separator into any chat it names. That is no new authority: it can already put `assistantDelta` text into any chat by the same key. The authority that goes away is worse: filing the marker into whatever chat the operator is looking at.
- [Trust boundaries] No findings for `''`. The decode accepts an empty string, which creates a slice under `''` that no chat row opens. That matches the eleven sibling arms, which carry no `''` guard either. The daemon drops transitions it cannot bind, so production never sends one. Adding a guard here alone would make this the only id-carrying arm with one.
- [Tokens / secrets] No findings. No token, key or credential is read, stored or moved. The routing id and the `ts` join key are non-secret comparands.
- [File / storage] No findings. The id is never a filename, path or cache key. Nothing touches disk.
- [Electron surface] No findings. No IPC channel, preload API, `webPreferences` or navigation handler changes. The change stays in renderer store glue that already receives typed events.
- [Crypto] No findings. No cryptographic code is touched.
- [Network & I/O] No findings. No transport change. The frame cap and decode are unchanged.
- [Logs] No findings. ADR 0007 holds. The routing key is compared and used as a `Map` key only. It is never rendered, and no log line is added: `emitDaemonEvent` and the bridges are log-free. The new e2e reads DOM counts and text plus a captured `new_session` payload the app built itself.
- [Concurrency] No findings. There is one app-lifetime synchronous listener, as before. The open-conversation getter is still read at dispatch time for `reconnected` only. No async work is added, so there is no new teardown path.
- [Threat model — join key as a suppression primitive] No findings. The key used to be withheld because the slice was inferred from the screen: a key recorded against B could suppress B's own page entry. The slice is now the one the frame names, so the key is recorded only where the daemon asserted the boundary belongs. The existing bounds are unchanged: `MAX_JOIN_TS_CHARS`, `seen.get(key) !== 1`, stop-at-first-miss, and recording only on a fold that changed state. A daemon that forges a matching `ts` could already omit the page entry outright.
- [Threat model — slice eviction by id spray] OUT OF SCOPE. A hostile daemon naming fresh ids creates slices and can push held ones past `MAX_RETAINED_TIMELINES`. Every id-carrying arm already allows this. This ticket adds one more arm to the same bounded path and no new capability. No ticket tracks it; it belongs with the retention policy if it is ever observed.
- [Threat model — id mismatch between daemon and app] If the daemon's `conversation_id` ever differed from the id this app files a chat under, the separator would draw in no visible chat. It fails toward a missing cosmetic row, never toward the wrong chat. The live gate (`real-claude-new-session.spec.ts`, AC4) is the check.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-22
