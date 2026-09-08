# 1145 — scope the conversation-activity reconnect reset to the reconnecting server

## Files read

- `src/renderer/src/store/conversationActivityStore.ts` → `createConversationActivityStore`,
  `clearAllActivity`, `dropConversation`, `writeEntry`, `selectActivityFor` — the store the scoped
  reset is added to; `dropConversation`'s copy-on-write removal is the shape the new reset generalises.
- `src/renderer/src/store/conversationActivityBridge.ts` → `subscribeConversationActivity`,
  `ConversationActivityDeps`, `ConversationActivityData` — the `connected` branch that must gain the
  origin, the dep set that must gain the scoped member, and the composition root that resolves it.
- `src/renderer/src/store/queueStore.ts` → `resetBacklogsFor`, `clearAllBacklogs` — the setter pair
  this slice copies verb for verb: iterate the HELD keys, `size === 0` same-reference short-circuit.
- `src/renderer/src/store/queueBridge.ts` → `originOf`, `subscribeQueue`, `QueueData` — the whole
  shape of the change, including the composition-root comment stating that the list is read at reset
  time rather than at subscribe time.
- `src/renderer/src/store/backgroundTaskRosterBridge.ts` → `originOf`, `subscribeBackgroundTaskRoster`
  — the second precedent, and the closer one: a keyed store whose `connected` branch was likewise the
  sole enforcement of a pairing boundary before it was scoped.
- `src/renderer/src/store/conversationListStore.ts` → `selectConversationIdsFor`,
  `EMPTY_CONVERSATION_IDS`, `ConversationListOrigin`, `selectExclusiveConversationIdsFor` — the shared
  resolution this consumes as its fourth consumer, and the stricter sibling it must NOT ride.
- `src/renderer/src/clearServerScopedState.ts` → `getDepartedConversationIds` — the second boundary
  helper, out of scope here; its docblock already lists the conversation-keyed stores it deliberately
  does not reach.
- `src/renderer/src/clearPairingScopedState.ts` → `ClearPairingScopedStateDeps`,
  `clearPairingScopedState` — the thirteen-member set gaining a fourteenth, and the `clearAllLastRead`
  throw-ordering constraint the new member must sit ahead of.
- `src/renderer/src/PairedShell.tsx` → `clearPairingDeps` — the module-scope literal the new member is
  wired in.
- `src/renderer/src/clearPairingScopedState.test.ts` → `spyDeps`, the `Object.keys(deps).sort()` pin,
  the real-store integration block — three sites that must move together, only the pin failing legibly.
- `src/renderer/src/store/conversationActivityBridge.test.ts` → the `connected` cases, the seam block,
  the re-armability test — the file whose `connected` coverage is rewritten around the origin.
- `src/renderer/src/store/backgroundTaskRosterBridge.test.ts` → `connectedFrom`, `seam(lists)`,
  `twoServers` — the test idiom for a stamped edge and a two-server seam, adopted rather than invented.
- `src/renderer/src/store/conversationActivityStore.test.ts` → the hostile-key and `clearAllActivity`
  blocks — where the scoped reset's own store-level cases go, beside the read-before-write discipline
  they must preserve.
- `docs/knowledge/features/conversation-activity-store.md` — the package overview; its "How it works"
  section documents the whole-map clear at the `connected` edge, which this ticket narrows.

## Design source

N/A — no `## Figma` section on the ticket, and the change is renderer state with no visual surface of
its own. The visible effect is an existing dot (`ChannelList`'s `.conversation-status-dot`) no longer
disappearing; no pixel moves.

## Context

Since #1117 the background process holds one live connection per paired server, and since #1068 every
daemon event carries the id of the server it came from, so `connected` means "**this** server's
connection came back". `subscribeConversationActivity`'s `connected` branch still reads it the older
way and calls the nullary `clearAllActivity()`, so server B's reconnect blanks server A's
`turnRunning` / `stalled` / `apiRetrying` / `compacting` for every conversation. Nothing re-asserts a
blanked fact until that conversation's next `turnState`, which for a running turn is the turn's end.

This is the fourth instance of the shape #1138 (queue backlogs), #1139 (background-task rosters) and
#1140 (modal prompts) each fixed. All three are worked precedents, and this slice inherits their
shared resolution, their `originOf` idiom and their fourteenth-member precedent three times over.

**Size overage, stated deliberately.** The written work lands over the 800-line line of the one-ticket
table. The floor outranks the ceiling here, on the argument that section licenses: the scoped reset's
only consumer is this bridge and the pairing-set membership's only consumer is that helper, so either
cut alone mints a slice nothing can observe. Worse, shipping the scoped edge without the membership
would knowingly leave a re-pair to the same box showing a finished turn's working dot with all five
criteria green — the trap #1138 hit. The file (4), new-exported-name (0), call-site, criteria (5) and
reject-branch lines all hold.

No ADR is warranted: every decision here is an application of #1138's, already recorded.

## Design

### `conversationActivityStore` — one new setter, `clearAllActivity` untouched

Add `resetActivityFor: (conversationIds: ReadonlySet<string>) => void` to `ConversationActivityStore`,
shaped exactly like `resetBacklogsFor` and `resetRostersFor`:

- Iterate the HELD keys and filter by membership, so the work is bounded by what this store holds
  rather than by the server's conversation count.
- No held key listed ⇒ hand the state OBJECT back, so zustand's `Object.is(next, state)` fires and no
  subscriber wakes. That covers a first connect, a reconnect of a server holding nothing here, and an
  already-empty map in one branch — the generalisation of `dropConversation`'s absent-key guard.
- Copy-on-write on the outer `Map`, never `s.entries.delete`, so every survivor is
  `Object.is`-identical to the entry object held before and a component watching another conversation
  does not re-render. That is AC1's referential half.
- A `ReadonlySet` membership test keeps the `Record`-forbidden property of the header intact: no
  computed object key is introduced and `__proto__` / `constructor` / `''` stay three unremarkable
  keys on both sides of the test.

`clearAllActivity` is unchanged. It already exists, is already nullary and already carries the
`size === 0` short-circuit the pairing set wants; it needs moving, not writing.

### `conversationActivityBridge` — origin in, ids resolved at the root

- A local `originOf(event): ConversationListOrigin` over `'serverId' in event`, copied rather than
  imported, matching all six existing precedents (`relayLinkBridge`, `conversationListBridge`,
  `daemonEventBridge`, `queueBridge`, `backgroundTaskRosterBridge`, `modalBridge`). Reads the stamp
  only, never `event.ack`.
- `ConversationActivityDeps` swaps `clearAllActivity: () => void` for
  `resetActivityForServer: (origin: ConversationListOrigin) => void`. The bridge stays store-free and
  drivable with plain spies; turning an origin into conversation ids is the caller's job.
- The `connected` branch keeps its shape — a separate early return ahead of the translator, beside
  `conversationDeleted` — and becomes `deps.resetActivityForServer(originOf(event))`.
- `ConversationActivityData` is the composition root and the only place the two singletons meet:
  `resetActivityForServer: (origin) => …resetActivityFor(selectConversationIdsFor(origin)(conversationListStore.getState()))`.
  The list is read at reset time, not at subscribe time — the `QueueData` property verbatim.

**A deliberate reading of one technical note.** The ticket's dep-docblock note describes the new
member as "a reset taking a `ReadonlySet<string>`". What lands takes a `ConversationListOrigin`,
because the adjacent note ("where the origin becomes conversation ids is the caller's job") and all
three precedents put the resolution at the root. The cross-wire argument still improves, one notch
less than the note claims and in one direction rather than both: a two-parameter setter cannot be
assigned into the new one-parameter slot at all, so the total collapse the docblock's argument rests
on is now partial and the named-object choice is over-determined. The docblock will say that, not the
stronger claim.

### `clearPairingScopedState` — the fourteenth member

`clearAllActivity: () => void` joins `ClearPairingScopedStateDeps` and the call body, placed after
`dispatchModal` so the four cross-server siblings stay adjacent (backlogs, rosters, prompts,
activity), before `dispatchSession`, and well ahead of `clearAllLastRead`, which stays last for the
throw-ordering reason its header gives. `PairedShell`'s module-scope `clearPairingDeps` wires it
directly to the singleton, the `clearAllBacklogs` / `clearAllRosters` shape.

The count is spelled in words across that file, its test and `PairedShell`: "thirteen" → "fourteen",
"Twelve of these thirteen" → "Thirteen of these fourteen", "the twelve in-memory clears" → "the
thirteen in-memory clears". Found by grepping the number words, not the identifier.

### Docblocks rewritten, not extended

Four assertions become false and are part of the deliverable:

1. `subscribeConversationActivity`'s `connected` bullet — "THE SOLE ENFORCEMENT of the pairing
   boundary … Gating it would kill that property silently". Gating it is what this slice does.
2. `conversationActivityStore`'s header paragraph ("Nothing is registered in
   `clearPairingScopedState`, and that is the DECIDED answer") **and** the factory docblock's
   growth-bound paragraph, which argues boundedness from `clearAllActivity` emptying the map on every
   `connected` edge — after this it empties only at a pairing boundary, and the scoped reset collects
   the reconnecting server's keys.
3. The comment over `clearAllActivity` ("The pairing boundary, wired at the `connected` edge").
4. The re-armability test's comment in `conversationActivityBridge.test.ts`, which argues re-armability
   from the branch covering BOTH pairing-change paths. The property survives — the reset must still not
   be one-shot — but #1141 established that pairing another server ends nothing, so the stated motive
   does not. #1141 listed this comment as one that stays true; that was correct then and stops being
   correct here.

## State + concurrency model

No new async work, no timer, no teardown, no IPC. Both stores are read and written from one
synchronous daemon-event dispatch under zustand's own store lock, with no `await` between the list
read and the activity write, so nothing can interleave. The bridge's app-lifetime subscription and its
single-listener teardown are unchanged.

## Error handling

No new failure mode. `originOf` is total: a stamp that is neither a string nor `null` selects the
unstamped slot rather than throwing, which is what keeps the read safe inside a listener. A reset
naming ids the store never held is a same-reference no-op, not an error. The path stays log-free by
construction — the only values a diagnostic could carry are the untrusted conversation and server ids.

## Testing strategy

All vitest, all `environment: 'node'`. No e2e work: `e2e/sidebar-row-geometry.spec.ts` and
`e2e/sidebar-tree-geometry.spec.ts` read `.conversation-status-dot`, run one server, and must stay
green unchanged.

`conversationActivityStore.test.ts` — a `resetActivityFor` block beside the `clearAllActivity` one:
drops exactly the listed held keys and leaves the rest `Object.is`-identical; re-armable across two
resets; an empty set, an all-unheld set and an already-empty map each notify nobody (with a held-key
reset as the negative control); `__proto__` / `constructor` / `''` reset as ordinary keys, read before
write so a `Record` cannot pass.

`conversationActivityBridge.test.ts` — the spy-level `connected` cases move onto the origin: the edge
calls `resetActivityForServer` alone with the origin off the stamp; the three-valued origin passes
through unchanged (a real id, `null`, an absent stamp, and a value no producer can emit); the stamp
beats a disagreeing `ack.server_id`; an unowned arm resets nothing. The seam block gains a
`lists`-seeded two-store fixture (the `backgroundTaskRosterBridge` seam idiom): with activity held for
a conversation on each of two servers, a `connected` stamped with B leaves all four of A's facts and
resets B's (AC1, AC3); a server with no list yet drops nothing and hands back the same state object
(AC2); an unstamped and a null-stamped edge each select their own slot and nothing wider (AC2); an
entry whose conversation appears in no server's list survives every scoped reset (AC2, pinned so a
later widening is deliberate); the reset stays re-armable (AC3). The existing "keeps both removals OUT
of the translator" pin stays as-is — `connected` still translates to `[]`.

`clearPairingScopedState.test.ts` — `clearAllActivity` into `spyDeps`, the called-once and
called-with-nothing assertions, the `Object.keys` pin, and an ordering assertion against
`clearAllLastRead`. Its real-store integration block gains a conversation-activity store holding both
a listed and an orphan entry, so AC4 is proven end to end: after the clear neither is readable and the
drop took no daemon-supplied id.

## Open questions

- Whether `PairedShell.test.tsx` asserts the dep set independently of `clearPairingScopedState.test.ts`
  — if it does, it is a fourth site to move. Resolved during implementation; recorded under
  `## Revisions` if it changes anything.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings, and the boundary is worth stating because this slice ADDS a
  daemon-influenced input to a decision that had none. Two untrusted values meet in the new reset.
  The conversation ids are daemon-supplied on BOTH sides — the held keys came from event
  `conversationId`, the resolved set from a `conversationsReceived` reply's `row.id` — and both stay
  `Map` / `Set` operations: `Set.prototype.has('__proto__')` performs no prototype-chain lookup, no
  computed object key is introduced, and the store header's `Record`-forbidden property is preserved
  unchanged. The server origin comes from the client-bound stamp, and that boundary was VERIFIED in
  code rather than assumed: `bindServerOrigin` builds `{ ...event, serverId }`, spreading the decoded
  event FIRST, so a `serverId` field the daemon puts in its own payload cannot overwrite the stamp.
  `originOf` reads only that stamp and never `event.ack.server_id`, which is AC5, and it is total —
  a value no producer can emit selects the unstamped slot rather than throwing inside a listener.
- [Tokens, secrets, credentials] Not applicable, by construction rather than by omission: the store
  holds four booleans per conversation id and nothing else, reaches no credential, and persists
  nothing. The header already rules out web storage for this slice precisely because it would outlive
  the pairing boundary; this ticket moves that boundary's enforcement and must not add persistence.
- [File / storage] No findings, and one ordering requirement that is security-relevant rather than
  cosmetic: `clearAllActivity` must precede `clearAllLastRead` in `clearPairingScopedState`, because
  that is the one member reaching `localStorage` and so the only one that can throw. Placed after it,
  a throw would abort the activity clear and leave a departed pairing's dots on screen with every
  in-memory assertion still green. The plan places it after `dispatchModal`; the test pins call order.
- [Inter-process / Electron attack surface] No findings — no new IPC channel, no new `contextBridge`
  API, no window options touched. The bridge consumes the existing `window.pyry.onDaemonEvent` and
  the whole change is renderer-side state; no secret, socket or key moves.
- [Cryptographic primitives] Not applicable — no randomness, no comparison against a secret, no
  handshake surface touched.
- [Network & I/O] Not applicable — no socket, URL, frame or timeout is introduced or altered. The
  `connected` arm is consumed, never produced.
- [Error messages, logs, telemetry] No findings, and the constraint is inherited rather than new:
  both modules are log-free by construction, and the only values a diagnostic on the new branch could
  carry are the untrusted conversation id and the server id. No `console.*` may appear on any new
  path, and `assertNever` keeps stringifying the discriminant alone.
- [Concurrency] No findings. The composition root reads `conversationListStore.getState()` and writes
  `conversationActivityStore` inside one synchronous daemon-event dispatch with no `await` between, so
  there is no check-then-act gap — the three precedents' property, not a new claim. One accepted
  consequence, named because it is a real behaviour change: unlike the queue and prompt stores, NOTHING
  re-asserts an activity fact until that conversation's next `turnState`, so after its own reconnect a
  genuinely running turn on the reconnecting server shows no dot until it ends. That is AC3's explicit
  requirement (no fact from the previous connection may be readable) and it is strictly narrower than
  today's whole-map clear, so it is a reduction in blast radius rather than a regression.
- [Threat model — hostile daemon steering an over-broad reset] SHOULD FIX. The reset rides the SHARED
  `selectConversationIdsFor`, so a hostile or confused server B that lists server A's conversation ids
  in its own reply can make its reconnect drop A's entries for those ids. Riding the shared selector is
  correct and the ticket rules on it: the stricter `selectExclusiveConversationIdsFor` belongs to
  `clearServerScopedState`, where an over-broad answer destroys retained threads with no backfill,
  whereas the worst outcome here is a missing dot that self-heals at the next turn boundary — nothing
  is destroyed and nothing is unrecoverable. What the plan does not yet do is NAME that residual, so a
  later reader cannot mistake the shared selector for an unconsidered default. Phase B states it in the
  bridge docblock beside the `originOf` argument; the verifier checks it landed.
- [Threat model — growth bound widens] SHOULD FIX. The store's growth-bound paragraph argues the map
  is bounded by the ids named SINCE THE LAST HANDSHAKE, because `clearAllActivity` empties it on every
  `connected` edge. After this change the whole-map clear fires only at a pairing boundary and the
  scoped reset collects only the reconnecting server's LISTED ids, so an entry for a conversation in no
  server's list latches for the life of the pairing — reachable, since a `turnState` can arrive for a
  conversation whose list has not landed. The rewritten paragraph must state that widened bound
  honestly rather than repeat the false one; it is already deliverable 2 of the docblock work, and this
  finding is what makes it non-negotiable. An actual cap is OUT OF SCOPE and stays where the header
  already assigns it — #676, the first reader — on the precedent of all three siblings, which widened
  identically while holding far larger per-entry payloads (message text, command lines, patches)
  against this store's four booleans plus one bounded id string.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
