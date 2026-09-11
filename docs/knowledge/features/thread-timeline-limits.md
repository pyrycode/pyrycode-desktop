# Thread timeline — edge cases and limitations

Part of [Thread timeline](thread-timeline.md).

## Edge cases and limitations

- **Uncorrelated or duplicate `tool_result` is a silent no-op, not a surfaced error.** Evidence-based:
  the structured stream wasn't receivable before [#179](../codebase/179.md) flipped `interactive`, so
  no orphan had been observed in practice at design time. This absorbs a mid-turn-reconnect orphan (the
  `tool_use` fell before a replay cursor) without killing the timeline, but revisit if #202's
  reconnect replay is shown to actually produce them now that the stream carries live traffic. The
  transport → bridge chain that can now feed a real `tool_result` is wired as of #229; the no-op
  behavior itself is unchanged.
  - No corresponding test currently is left uncovered — both the orphan and duplicate cases are
    unit-tested with `toBe` reference assertions (`timelineBridge.test.ts`, #229, driving a real store
    end to end).
- **`seq` is not consulted.** It's carried on `assistantDelta` for wire fidelity and a possible
  future monotonicity guard, but the reducer trusts arrival order — no reordering has been
  observed from the ordered Noise/WS transport.
- **Conversation routing precedes reduction.** `ThreadEvent` is conversation-id-free;
  the [keyed holder](conversation-timeline-holder.md) owns separate timelines and the
  bridge selects the destination. A live denial with an empty conversation id is ignored,
  never assigned to whichever conversation happens to be open.
- **No stable per-item `id`.** `turnId` alone isn't unique (a tool call can split one turn into
  two `assistantText` items) — [#203](../codebase/203.md) resolved the React-key question at
  render time by keying on array index instead: the list is append-only with tail-mutation and never
  reorders or inserts mid-list (`appendDelta` grows the tail in place, every other arm appends a new
  tail, `fillResult` replaces a `toolCall` at its own index), so index identity is stable per logical
  item without needing a dedicated `id` field on `ThreadItem`. **That premise is scoped to
  `reduceTimeline`'s own array and does not extend to a consumer that inserts at the head rather than
  the tail.** The [keyed holder](conversation-timeline-holder.md)'s `prependHistoryFor`
  ([#1223](../codebase/1223.md)) does exactly that, and array-index keys broke under it —
  [#1260](https://github.com/pyrycode/pyrycode-desktop/issues/1260) gave the render layer its own
  origin-relative key for this reason; see [Conversation timeline store § Edge
  cases](conversation-timeline-store.md#edge-cases-and-limitations).
- **`stalled` is onset-only with no daemon "cleared" signal** ([#317](../codebase/317.md)) — the daemon
  sends a one-shot `stall` frame and never repeats it or clears it, so the reducer derives the clear
  entirely client-side on the next turn-activity arm. A stall with no following activity stays shown
  indefinitely; this is by design, mirroring mobile's ADR-025 Phase 2 self-clear contract.
- **`apiRetry` clears only on its own explicit falling edge — turn activity never clears it**
  ([#493](../codebase/493.md)), the deliberate inverse of `stalled`. The daemon's `api_retry` frame
  re-fires the rising edge as the attempt count climbs with no wire-side dedup (a repeated identical
  frame is a same-reference no-op, never a re-render), and `current: 0, total: 0` is a legitimate
  "retrying, count unknown" state — a **present** `ApiRetryStatus` with both fields zero, not `null`.
  The falling edge discards any counter it carries; the state's `| null` shape makes that true by
  construction rather than a convention to maintain.
- **`compacting` clears only on its own explicit falling edge — turn activity never clears it**
  ([#496](../codebase/496.md)), `apiRetry`'s clearing inversion again. Unlike `apiRetry`, the wire
  carries no progress data at all — banner-only, no counter, no percentage — so the state is a plain
  `boolean` rather than a `| null` record; there is nothing for a falling edge to discard.
- **`thinkingTokens` is a reading, never a value to compare against a maximum** ([#1314](https://github.com/pyrycode/pyrycode-desktop/issues/1314)) — the daemon's own docs call it "approximate progress for
  spinners/pills, not the authoritative billed output_tokens", and it restarts near zero at every
  inference-request boundary (observed four times inside one committed single-turn capture). A monotonic
  filter or an accumulator would silently eat that ordinary traffic and freeze the label at the first
  request's peak; the arm assigns rather than compares. `estimated_tokens_delta` does not cross the IPC
  boundary and is not accumulated here — the payload's own contract states the deltas do not sum to the
  turn's total.
- **`requireNumber` proves only `typeof value === 'number'`** ([#1314](https://github.com/pyrycode/pyrycode-desktop/issues/1314)) — NaN, `Infinity` and negatives all decode and cross the contextBridge
  intact (ADR 0002 drift forbids a range check at the decode boundary), so this module carries the value
  unvalidated by design. The render-side `thinkingLabel` formatter is the actual boundary — see
  [Conversation shell § Thinking / working indicator](conversation-shell-turn-status.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967).
- **`reset` had no dispatch site as of [#528](../codebase/528.md); [#530](../codebase/530.md) shipped
  the first, [#531](../codebase/531.md) the second, [#652](../codebase/652.md) the third.** A
  conversation switch clears the timeline via `activateConversation`, gated on the active conversation's
  id actually changing — a re-open of the already-active conversation clears nothing, since the timeline
  has no history backfill and a redundant reset would destroy rows that never come back. A pairing ending
  (unpair — pair-another-server stopped clearing anything at
  [#1141](https://github.com/pyrycode/pyrycode-desktop/issues/1141)) clears it via
  `clearPairingScopedState`, unconditionally — there the pairing itself is over, so no id gate applies. The open discussion being deleted clears it via
  `exitActiveConversation`, gated on the id like #530's — a `conversationDeleted` naming any other
  conversation clears nothing.
- **A retry or compaction genuinely still live across a reconnect shows no banner until the daemon's
  next edge** ([#538](../codebase/538.md)), an accepted residual, not a bug to engineer around. The
  daemon's connect-time re-assertion set is the outstanding modal (#877) and the queued backlog (#878)
  only — never `api_retry`/`compacting`/`turn_state` — so `reconnected`'s clear has nothing to
  re-populate from. A briefly-missing banner (until the next rising edge, or for a compaction possibly
  only the closing falling edge, landing as a no-op) trades against a permanently-stuck one, which is
  the worse failure this arm exists to fix.
- **A late `sessionTransition`/timeline delta for the previous conversation is not suppressed by
  [#530](../codebase/530.md)'s clear.** `ThreadEvent` carries no `conversation_id` (single-active model,
  ADR 0004), so if the previous conversation is still streaming when the switch happens, its in-flight
  deltas keep landing in the timeline the user now reads as the new conversation — the clear empties the
  *accumulated* rows at the moment of the switch, it cannot stop an ongoing stream from the conversation
  just left. Named as an open PO follow-up by the architect's security review on #530 (same root cause
  and remedy as the equivalent gap on [`sessionIdStore`](session-id-store.md#edge-cases-and-limitations)),
  not yet its own ticket. Unaffected by [#531](../codebase/531.md)'s pairing-ended clear: unpair tears
  the transport down before any late delta could arrive, and the pair-another path's exposure window is
  a microtask gap the daemon connection replaces almost immediately — see #531's spec § Open questions.
- **Strangler Fig, cut over in [#179](../codebase/179.md).** `sessionStore`, `messageViewModel.ts`,
  and the coarse `message`/`message_chunk` path were completely untouched by this module through
  #199–#230. #179 retired the coarse render path (`MessageThread` unmounted, kept as dead-but-tested
  residue) and made this module's store the conversation's single thread surface — `sessionStore`
  itself (and its `messages` slice) is untouched code-wise but its render consumer is gone.
- **`createdAt` is `undefined` on any `assistantText`/`userText` item whose producer was given no
  clock** ([#1013](https://github.com/pyrycode/pyrycode-desktop/issues/1013)) — this is a legal item, not
  a defect: every one of the 135 pre-existing fixture sites across 17 test files produces exactly this,
  since none injects a clock, and [#1014](https://github.com/pyrycode/pyrycode-desktop/issues/1014) draws
  it as the meta row's empty slot. Test presence with `=== undefined`, never `'createdAt' in item` — the
  reducer assigns the field unconditionally on every arm that carries it, so the key is always present;
  only its value distinguishes a stamped item from an unstamped one. No seam this field crosses
  (`translateTimelineEvent`, `subscribeTimeline`, `ComposerSendDeps.now`) defaults to `Date.now` — a
  defaulting seam would silently stamp events built by a spec that injects no clock, and those are exactly
  the fixtures `toEqual` asserts hold no defined `createdAt`.
- **The two production wirings of the clock (`useTimelineBridge`'s `Date.now` argument,
  `ConversationScreen.tsx`'s `now: Date.now` deps field) are not compile-enforced** — both parameters are
  optional, which is what keeps every pre-#1013 call site compiling unedited, but it also means a
  forgotten wiring at either site is silent rather than a type error. Each has its own regression spec
  pinning the wiring instead (`timelineBridge.test.ts` for the assistant side, `composerSend.test.ts` for
  the echo). If a wiring is ever found missing in practice, that observed failure — not the theoretical
  gap — is what would justify a compile-time guard.
- **`attachments` only ever describes files this window's own operator attached**
  ([#1039](https://github.com/pyrycode/pyrycode-desktop/issues/1039)) — a file the *assistant* produced
  reaches the window as nothing at all (`MessagePayload` has no attachment field and there is no list
  verb), so an inbound direction is unbuildable until a `pyrycode/pyrycode` wire change exists. Recorded
  verbatim, with no non-emptiness guard: an empty `filename` is representable and unreachable (`basename`
  answers `''` only for a path the read guard already refuses), so no guard for it is added where nothing
  in this module draws it — that obligation, like the layout bound for a long name, passed through to
  #815, which took it on: an unbounded name wraps rather than truncates, bounded only by the operator's
  own filesystem's 255-byte path-component cap. #868 still owes it for the image case. `SendMessagePayload`
  gains no matching field in this slice, so the association is local to this client's timeline only and is
  not sent to the daemon with the message.

- **A `dropUserText` removal is not the `userText` arm's inverse, and must not be read as one**
  ([#1213](https://github.com/pyrycode/pyrycode-desktop/issues/1213)). `userText` opens
  `localSendPending`'s local window on the grounds that the arm firing and the composer accepting a
  submit are the same fact; the tempting symmetry — a removal closes what an append opened — is wrong,
  because the window belongs to whatever message is currently pending, not to the one just dropped.
  `dropUserText` carries `localSendPending` through unchanged, same as every other chrome scalar, and
  leaves the daemon's next `turn_state` to close it. **Only `items` changes on this arm** — the sole
  removal arm in the reducer; every other arm appends or coalesces.
- **A drop issued by another paired client is out of scope, by construction rather than by a guard.**
  `queue_state` fans out to every interactive connection, so this window can observe an item leave the
  backlog because a *different* client dropped it — but this window's timeline holds no `userText` echo
  for a message it never sent, so `removeUserEcho` simply finds nothing to remove. There is no local
  concept of "another device's drop" to build a heuristic for; pyrycode#2092's own doc criterion states
  the daemon-side half of the same rule ("an item whose `message_id` matches no local echo renders as a
  plain queued row and is never dropped").
- **An echo with no `messageId` can never be removed by a drop**, on the same "absent correlates with
  nothing" rule the field's own paragraph states above (§ Types). Nothing in this module manufactures a
  fallback key for it. [#1223](https://github.com/pyrycode/pyrycode-desktop/issues/1223)'s history-drawn
  `userText` rows are not this case in practice — a stored `message` always carries the wire's
  `message_id` — but the reducer draws no distinction: a row is a row, whatever folded it.
- **The `userText` arm's "exactly one production writer" comment predates a second one and is now
  stale** ([#1223](https://github.com/pyrycode/pyrycode-desktop/issues/1223), still open as a verifier
  SHOULD FIX on PR #1229). A served history page also folds `userText` events through this reducer — but
  against a scratch state that is discarded and never reaches the *held* one this arm's `localSendPending`
  side effect writes into, so the arm's invariant ("firing this arm on held state is the composer's own
  accept signal") is intact in practice even though the comment's producer count is not. See [Conversation
  timeline store](conversation-timeline-store.md) for the fold.

