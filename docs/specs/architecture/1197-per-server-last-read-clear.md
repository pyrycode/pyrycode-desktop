# #1197 — an unpair drops the departed server's last-read marks only

The last open slice of the #1090 family. #1196 built the per-server clear road; this one puts the read
marks on it — the one member of the departed-state set that reaches outside memory.

## Files read

- `src/renderer/src/clearServerScopedState.ts` → `ClearServerScopedStateDeps`, `clearServerScopedState`,
  `serverScopedClearDeps` — the seam this ticket extends. Its docblock's "no effect here that can throw"
  paragraph and its "deliberately does not reach" list both become false when this lands.
- `src/renderer/src/clearServerScopedState.test.ts` → the `deps()` spy factory and the
  `invocationCallOrder` read-before-drop case — the idiom AC4's ordering pin copies.
- `src/renderer/src/store/conversationLastReadStore.ts` → `ConversationLastReadStore`,
  `clearAllLastRead`, `recordLastRead`, `ConversationLastReadStorage`,
  `initialConversationLastReadState` — the store the new write path joins, and the two docblock
  paragraphs that currently argue against this ticket.
- `src/renderer/src/store/conversationLastReadStore.test.ts` → `fakeStorage`, `hostileKeys`,
  `lastReadFor`, the `#779` describe block — the injected-port fake the persisted half is observable
  through, and the assertion shapes (write call count, second-store restart) this ticket reuses.
- `src/renderer/src/clearPairingScopedState.ts` → `clearPairingScopedState` — the whole-app sibling whose
  ordering constraint (the re-mint and the throw) transfers here in LOOP shape, and which AC5 rides
  unchanged.
- `src/renderer/src/clearPairingScopedState.test.ts` → the four "runs BEFORE the one effect that can
  throw" cases — the `invocationCallOrder` form AC4 adopts.
- `src/renderer/src/store/conversationLastReadBridge.ts` → `subscribeConversationLastRead`,
  `stampLastReadFor`, `conversationLastReadDeps` — the re-stamp that fires synchronously on every
  `conversationTimelineStore` emission and records `0` for a slice already gone. The reason the drop must
  follow the loop rather than sit inside it.
- `src/renderer/src/exitActiveConversation.ts` → `ExitActiveConversationDeps`, `exitActiveConversation` —
  the base interface `ClearServerScopedStateDeps` extends, and the second `clearTimelineFor` caller
  inside the loop (idempotent, so its notification is a reference no-op after the loop body's own clear).
- `src/renderer/src/screens/settings/unpairServerAction.ts` → `runUnpairServer` — untouched; it already
  branches to this helper on the per-server arm and to `clearPairingScopedState` on the last-server arm.
- `src/renderer/src/screens/settings/ServerRow.tsx`, `src/renderer/src/screens/conversation/ConversationScreen.tsx`
  → both containers spread `serverScopedClearDeps` and add only `navigateToList`, so a new member on the
  deps interface reaches both with no edit at either site. This is why the edit fan-out is two production
  files rather than four.
- `docs/knowledge/features/conversation-last-read-store.md` § "One clear path" and § "Edge cases" — the
  `size`-guard rationale, and the standing record that `exitActiveConversation` has no re-mint floor of
  its own. That second half is what makes the post-loop placement here load-bearing rather than stylistic.

## Design source

**Figma:** N/A — the ticket carries no `## Figma` section and the work has no rendered surface. After
#1196 the departed server's rows are already gone from the sidebar, so the marks' only remaining
observable is the injected `ConversationLastReadStorage` port. Nothing this ticket changes is visible in
a screenshot, and no new e2e spec is owed (#1196's spec covers the visible half).

## Context

`conversationLastReadStore` persists every conversation's mark to `localStorage` (#776), and #779 made
`clearAllLastRead` the counterweight at the pairing boundary — dropping the marks there is what makes
persisting them defensible, because otherwise a departed pairing's marks survive the unpair AND the
restart after it. Since #1162/#1163 that counterweight stopped firing when the pairing does not fully
end: forgetting one of several servers left the departed machine's marks in memory and on disk
indefinitely.

#1196 landed the per-server road — `runUnpairServer` runs the whole-app clear when the erase empties the
collection and `clearServerScopedState` otherwise — and deliberately held the marks back as a separate
sibling, because they are the only member of the set that reaches outside memory and so the only one
carrying an ordering constraint and a throw path of its own. This ticket is that sibling.

Retaining the SURVIVING server's marks is the point, and it is safe for the reason
`clearPairingScopedState`'s docblock states: the daemon mints conversation ids as UUIDv4 from the system
random source, so a later server cannot reuse an earlier one's ids and no slice can be read under a
stranger's key.

No ADR is owed. This ships one write path on an existing store and one member on an existing deps
interface; every decision it makes is already recorded by #779's and #1196's docblocks, which this
change corrects in place.

## Design

Two production files. No new module, no new exported type, no container edit.

### `conversationLastReadStore.ts` — one new write path

`ConversationLastReadStore` gains one member beside `clearAllLastRead`:

```ts
clearLastReadFor: (conversationIds: ReadonlySet<string>) => void
```

Behaviour: drop the mark of every named id; leave every other mark exactly as held. When the call removes
nothing, return the state OBJECT so zustand's `Object.is` short-circuit fires and the port is never
touched. Otherwise persist the surviving map through `storage.write` exactly once and return the new
state. Built as `recordLastRead` and `clearAllLastRead` are: guard, persist and return are one expression
INSIDE the updater, so no later edit can hoist the write above the guard without deleting the guard.

Four decisions that `tsc` cannot see, each with a named test:

- **The parameter is a `ReadonlySet<string>`, never `Iterable<string>` or `readonly string[]`.** A bare
  `string` satisfies `Iterable<string>`, so a caller passing one id instead of a set would compile clean
  and clear one key per CHARACTER. The `Set` is also what the producer already holds — the deps member
  binds to `selectExclusiveConversationIdsFor`, whose answer is a `ReadonlySet`.
- **The guard asks "did anything actually leave?", not "is the incoming set empty?".** A non-empty set can
  name nothing the store holds — the common case here, since a departed server's conversations need never
  have been opened. The form is: clone, delete each named id, and compare `next.size` against
  `s.marks.size`; deletions only ever shrink and nothing is added, so an unchanged size is exactly "no
  held mark left". `conversationIds.size === 0` is the wrong question and would fire a redundant
  synchronous `localStorage.setItem` on every unpair of a server whose chats were never read.
- **ONE write for the whole set, never one per id.** The whole map is persisted under a single fixed key,
  so a per-id clear called in a loop would fire one synchronous `setItem` per departed conversation.
- **The cleared arm returns `{ marks: next }`, not the named baseline.** `clearAllLastRead` hands back
  `initialConversationLastReadState` for reference stability across repeated whole-map clears; there is no
  equivalent here, because a scoped drop's result is a surviving map. The emptied-everything case needs no
  special arm: a repeat of the same call finds nothing to remove and returns `s` through the ordinary
  guard.

`clearAllLastRead` stays NULLARY and byte-identical (AC5). An optional id parameter bolted onto it would
re-open the property its docblock closes — that no daemon-asserted id can steer which marks survive the
pairing boundary, enforced by `tsc`. A separate write path keeps that enforcement intact.

Two docblock paragraphs on `ConversationLastReadStore` currently argue against this ticket and are
corrected in the same change rather than silently contradicted:

- the refusal of a per-conversation clear ("a mark for a conversation that no longer exists is inert") —
  true when the only boundary was the whole-app one, false on this path, where a departed mark is
  persisted under a fixed key and survives the restart. That is precisely the residue #779 exists to
  prevent.
- the nullary-is-a-security-property paragraph — it SURVIVES this ticket and is amended to say how: the
  ids reaching the new path are the exclusive set (below), `clearAllLastRead` stays nullary, and the two
  paths are separate so `tsc` still enforces the whole-app boundary's guarantee.

### `clearServerScopedState.ts` — one new dep, called after the loop

`ClearServerScopedStateDeps` gains `clearLastReadFor: (conversationIds: ReadonlySet<string>) => void`;
`serverScopedClearDeps` binds it to the store's new path through `getState()` inside the arrow body, the
idiom every other member there uses. Both containers spread that object, so neither is edited.

The call rides the id set the helper has ALREADY computed — `departed`, read before the list slot is
dropped — and takes no fresh read. That set is bound to `selectExclusiveConversationIdsFor`, not to the
shared `selectConversationIdsFor`, and that is a security decision rather than a detail: the ids are the
DEPARTING daemon's own, listed in its `conversationsReceived` reply, so a confused or hostile daemon can
name another machine's conversations and turn "forget machine A" into a destructive drop of machine B's
marks, with no backfill. Marks are destroyed with no backfill exactly as threads are, so the same answer
is owed and the exclusivity filter turns the over-broad claim into a no-op.

**Placement: after the loop, and this is the sharp edge of the slice.** `clearServerScopedState` clears
one departed conversation's thread per iteration, and each `clearTimelineFor` notifies
`conversationTimelineStore`'s subscribers synchronously. Among them is #777's bridge, which re-stamps
whatever conversation is open and, finding the slice gone, records a mark of `0` for it — persisting a
departed conversation's id to disk while every in-memory assertion stays green. Because that fires on
EVERY iteration, a drop placed inside the loop is re-minted by a later iteration. Nothing after the loop
touches `conversationTimelineStore`: `exitActiveConversation`'s own `clearTimelineFor` runs a line after
the loop body's, on a slice already emptied, and returns state by reference so no subscriber wakes.

The second reason transfers from `clearPairingScopedState` unchanged: this is the only effect in the set
that reaches outside memory, so running it LAST means a `localStorage` failure can abort no other clear.

The call is UNCONDITIONAL — no `departed.size > 0` gate here. The guard belongs in the store, which is
the only place that can answer the harder question AC3 asks; a gate here would be a second, weaker copy
of it in the wrong place.

Two paragraphs in the merged helper become false when this lands and are corrected in the same change:
the "every effect is an in-memory store write, so there is no effect here that can throw and therefore no
ordering constraint among the clears beyond the read-before-drop" sentence (both halves change), and the
"deliberately does not reach" list's naming of `conversationLastReadStore` as the separate sibling ticket
(that sentence retires; the three stores it names beside it stay).

## State + concurrency model

One zustand slice (`conversationLastReadStore`) and one injected port. No async task, no timer, no
subscription, no teardown: every path added here is a synchronous store write on the renderer's single
thread. The check-then-act inside the updater has no suspension point — vanilla zustand invokes an updater
exactly once, synchronously, per `set`, and `localStorage.setItem` is synchronous too — so no concurrent
handler can interleave between the size compare and the write.

The one live subscriber that matters is #777's bridge on `conversationTimelineStore`, and it is handled by
ORDERING rather than by a guard, as above. Note the surviving server's open chat is legitimately
re-stamped during the loop with its own honest count — its slice is untouched — and the drop names only
departed ids, so it cannot be reached.

## Error handling

No result type and no throw path of this ticket's own. The one effect that can throw is
`storage.write` → `localStorage.setItem`, and it is not defended: a quota/disabled failure is not an
observed failure mode in the Electron renderer, and the store's port deliberately carries no try/catch
(the decode's catch is a different thing — a required behaviour over untrusted input). The defence that IS
paid for is free: the call is last, so a throw aborts no other clear.

Nothing is logged. The only values a diagnostic here could carry are the untrusted conversation ids being
dropped or a count of them, and both this store's log-free rule and `clearServerScopedState`'s
no-diagnostic posture (ADR 0007) forbid them. Not even a count.

## Testing strategy

Unit tier only, vitest, `environment: 'node'`. No new e2e spec: after #1196 the departed rows are already
gone from the sidebar, so the persisted half has no rendered surface and is observable only through the
injected port.

`conversationLastReadStore.test.ts` — a new describe over `fakeStorage`, mirroring the #779 block:

- drops only the named ids and leaves every other mark reading as held (AC1)
- the persisted value is the SURVIVING map — asserted on `write.mock.calls[0][0]`, and again through a
  second store over the same fake, which is the restart (AC2)
- exactly one `write` for a multi-id drop (the one-write-for-the-set decision)
- a non-empty set naming nothing held: no `write`, no subscriber notification, state returned by
  reference (AC3 — the case a `size === 0` guard would pass and a reference guard would fail)
- an empty set behaves identically, through the same guard rather than a special case (AC3)
- a partially-matching set drops the held ids and leaves the unheld names inert
- the previously held map is not mutated (the load-bearing copy-on-write form for a numeric value, since
  the identity assertion the object-holding precedents use is degenerate here)
- the three hostile keys drop like any other entry

`clearServerScopedState.test.ts` — the new spy in `deps()`, plus:

- **AC4, by call order:** `clearLastReadFor` runs after EVERY `clearTimelineFor`, asserted as
  `Math.max(...clearTimelineFor.mock.invocationCallOrder) < clearLastReadFor.mock.invocationCallOrder[0]`.
  This must be a call-order test, not an end-state one: the production re-stamp lives in a React effect
  and `vitest.config.ts` is `environment: 'node'` globally, so no test in this repo runs that
  subscription. The re-mint cannot be driven end-to-end, and a storage end-state assertion would pass with
  the bug in place.
- called exactly once, with the SAME set `getDepartedConversationIds` returned (not a fresh read)
- a server holding no rows still calls it once, with the empty set — the guard is the store's

AC5 is proven by tests this change does not touch: `clearPairingScopedState.test.ts`'s nullary-call and
ordering cases, and `unpairServerAction.test.ts`'s last-server arm. Adding a duplicate here would ship a
redundant assertion against an unchanged path.

Gates: `npm test` on the two touched test files, then `npm run build` — the latter is mandatory rather
than optional here, because adding a member to `ClearServerScopedStateDeps` cascades to test object
literals that fail type-only, and `npm test` can be green while the wiring is incomplete.

## Open questions

1. **Name of the new write path.** `clearLastReadFor(conversationIds)` reuses the exact name the store's
   docblock refuses in per-id form. Resolved at design time in favour of reuse: the type makes the set
   form unambiguous, and the corrected paragraph explains the shift where a reader will look for it. A
   distinct name (`clearLastReadForAll`) would read as a whole-map clear, which is the one thing it is not.
2. **Whether the emptied-everything case should return `initialConversationLastReadState`.** Answered no
   in the Design section; recorded here because it is the one place this path could have mirrored
   `clearAllLastRead` and deliberately does not.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] Named, inherited, not closed here.** The one untrusted input is the departed
  conversation-id set: daemon-asserted text, listed in the DEPARTING daemon's own `conversationsReceived`
  reply. The boundary is a single named function — `getDepartedConversationIds`, bound in
  `serverScopedClearDeps` to `selectExclusiveConversationIdsFor` rather than the shared
  `selectConversationIdsFor` three reconnect bridges ride. The `serverId` itself is client-held (the id
  `runUnpairServer` just erased from this client's own paired collection), which is what both selectors'
  docblocks require of a caller. Residual risk, inherited verbatim from #1196: an id the hostile daemon
  names that no OTHER server's list slot currently claims — a survivor whose slot is empty because it has
  not listed yet — reads as exclusive and would be dropped. The blast radius is strictly smaller here than
  in the inherited case (a mark is re-earned by opening the chat; a retained thread has no backfill at
  all), and the mitigation is the filter this ticket is required to ride. Re-pointing this path at
  `selectConversationIdsFor` would turn this into a MUST FIX.
- **[Trust boundaries] The scoping premise is inherited, not verified here.** Dropping by conversation id
  is safe only because the daemon mints ids as UUIDv4 from the system random source, so a later server
  cannot reuse an earlier one's. That is `clearPairingScopedState`'s stated ground and #1196 already
  depends on it; nothing in this ticket re-checks it. If it were false the failure would be a survivor's
  mark DELETED (recoverable by re-reading the chat), never a survivor's mark READ under a stranger's key —
  this ticket adds no read path.
- **[Tokens, secrets, credentials] No findings.** No token, key or credential is read, written, logged or
  rendered. A `LastReadMark` is a bare `number`, so there is structurally nowhere in a value for
  daemon-asserted text to land; the untrusted id is used only as a `Map` key in memory and as a JSON ARRAY
  element on disk. Nothing new is added to `localStorage` — the persisted blob can only shrink.
- **[File / storage operations] No findings; one property Phase B must hold.** The drop deletes from a
  `Map` clone and hands a `ReadonlyMap` to `storage.write`. `Map.prototype.delete('__proto__')` performs
  no prototype-chain walk, so `'__proto__'`, `'constructor'` and `''` drop as ordinary entries; a rewrite
  through `Object.fromEntries`, a map-into-object spread, or an `obj[id] = mark` loop re-materialises the
  hazard the `Map` removes with no type error, which is why a hostile-key drop test is named in the
  Testing strategy. No filesystem path is built from untrusted input (no traversal surface), there is no
  check-then-open (no TOCTOU), and the write is a whole-value replace under one fixed key.
- **[Inter-process / Electron attack surface] No findings.** Nothing added crosses `contextBridge` or
  `ipcMain`; no `webPreferences`, protocol handler, navigation guard or window-open path is touched. This
  is renderer-only pure state, and no key, socket or secret moves toward the renderer.
- **[Cryptographic primitives] Not applicable by design.** No randomness, hashing, key material or
  handshake is introduced. The one comparison added is a `Map.size` compare over locally computed
  integers, not a comparison against a secret, so `timingSafeEqual` does not apply.
- **[Network & I/O] Not applicable.** No socket, frame, URL, timeout, TLS setting or reconnect path is
  touched; the clear runs entirely after `unpairServer`'s IPC round trip has already resolved.
- **[Errors, logs, telemetry] No findings; one MUST-NOT for Phase B.** The new path adds no `console.*`
  and not even a content-free COUNT of what was dropped — the shape an implementer instinctively reaches
  for, and the first crack in both modules' log-free-by-construction property. The only values a
  diagnostic could carry are the untrusted ids being dropped or a count of them, both forbidden by ADR
  0007. The single effect that can throw (`localStorage.setItem`) is deliberately undefended, per
  Evidence-Based Fix Selection; its blast radius is bounded instead by running LAST.
- **[Concurrency] No findings.** Nothing async, no timer, no listener, no `AbortSignal`: the updater is
  one synchronous `set` with no suspension point, so the size compare and the write cannot interleave. The
  one live subscriber — #777's bridge on `conversationTimelineStore` — is addressed by ordering rather
  than by a guard, and the ordering was verified to the end of the call chain rather than assumed:
  `clearServerScopedState(serverId)` is the LAST statement of `runUnpairServer`'s per-server arm, so
  nothing after the drop can re-fire that subscription and no re-minted `0` can outlive it.
- **[Threat model alignment] The threat this closes, and what stays open.** The blob under
  `pyry.conversationLastRead` is plaintext in the renderer's web storage, readable by anything running as
  the user, and until now it retained the conversation ids of a machine the operator had explicitly
  forgotten — indefinitely, across restarts. Forgetting a machine now removes its ids from disk. Hostile
  daemon: finding 1. Malicious relay: out of reach, no wire path. Renderer compromise reaching the
  transport: unchanged, nothing moves toward the renderer. **OUT OF SCOPE**, named rather than silently
  left: `queueStore`'s backlogs, `backgroundTaskRosterStore`'s rosters and `modalPrompts`' outstanding
  prompts still hold the departed server's state — the roster is the sharpest, since a held `local_bash`
  task's `description` is the literal command line claude ran. Those are #1090's remaining slices and stay
  listed in `clearServerScopedState`'s "deliberately does not reach" paragraph; this ticket removes only
  its own name from that list.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-07
