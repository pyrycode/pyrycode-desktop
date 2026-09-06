# 1138 — scope the queue-backlog reconnect reset to the reconnecting server

## Files read

- `src/renderer/src/store/queueBridge.ts` → `subscribeQueue`, `translateQueueState`, `QueueData` — the
  defect lives in `subscribeQueue`'s `connected` branch, which calls the nullary reset; `QueueData` is the
  composition root that will resolve origin → ids.
- `src/renderer/src/store/queueStore.ts` → `resetBacklogs`, `setBacklog`, `selectBacklogFor`,
  `selectBacklogs` — the whole-map clear this slice replaces, and the `size === 0` same-reference
  short-circuit the scoped form must keep.
- `src/renderer/src/store/queueStore.test.ts` → the four `resetBacklogs` cases that get re-pointed at the
  scoped setter.
- `src/renderer/src/store/queueBridge.test.ts` → `fakeBridge`, the `reconnect reconcile (seam)` block —
  the injected-spy idiom the new reset dep must stay compatible with, and the seam shape the two-server
  tests extend.
- `src/renderer/src/store/conversationListStore.ts` → `ConversationListOrigin`, `byServer`,
  `selectConversationsFor`, `ServerConversationSummary` — the source of "which conversations belong to
  this server", and the type this slice reuses rather than re-declaring.
- `src/renderer/src/store/conversationListBridge.ts` → `originOf` — the precedent this bridge copies (an
  `in`-guarded, `typeof`-checked read of #1068's stamp, never the payload).
- `src/shared/ipc/events.ts` → `ServerOrigin`'s docblock — rules that a consumer indexing by the server
  id uses a `Map`/`Set`, never a bare object, and that the id is client-bound at construction.
- `src/shared/wire/types.ts` → `ConversationSummary.id` — the conversation id the resolution collects.
- `docs/knowledge/features/queue-store.md` — the store's shipped contract, including the #197 reset's
  "clearing the map IS clearing every backlog" argument, which is exactly what stops holding once the
  reset is scoped.
- `e2e/queued-backlog-interrupt.spec.ts` (header fact 2, and the push comment before
  `queueStateFrame`) and `e2e/user-whitespace.spec.ts` (`queueStateFrame`'s docblock, and the AC4 push
  comment) — the two specs that restate "every `connected` resets ALL backlogs" in prose. No assertion
  depends on it; the sentences go stale with this change.

Codegraph was not available (`CodeGraph not initialized` on this repo), so the reading list above came
from grep and direct reads.

## Design source

**Figma:** N/A — store and data-path work with no rendered surface of its own. The visual-fidelity check
is intentionally skipped.

## Context

Since #1117 the background process holds one live connection per paired server and since #1068 every
daemon event carries the id of the server it came from, so `connected` means "**this** server's
connection came back", not "the app's one connection came back". `subscribeQueue`'s `connected` branch
still reads it the older way: it calls `resetBacklogs`, which empties the whole `conversationId`-keyed
map. Server B reconnecting therefore discards server A's queued backlogs, and only B's daemon re-sends,
so A's never come back.

#197's rule is preserved exactly, narrowed: the daemon's connect-time re-sends stay the sole
repopulation truth **for the reconnecting server**. What changes is the blast radius.

This slice also lands, once, the renderer's answer to "which conversations belong to this server", on the
server-keyed conversation list (#1086). #1139 (background-task rosters) and #1140 (outstanding modal
prompts) consume the same resolution, which is why it lands in the list store rather than being restated
in three bridges.

Deliberately not in scope, and unchanged: the other renderer subscribers that clear a whole store on
`connected` — `conversationActivityBridge`, `timelineBridge`, `runSettingsWriteBridge` and
`questionBridge`. Same defect, no ticket; see the note on #1089.

No ADR is warranted. This is a narrowing of one existing setter's blast radius plus one selector, both
inside idioms the store directory already carries.

## Design

### The shared resolution (`conversationListStore.ts`)

One new selector factory beside `selectConversationsFor`, plus the stable empty result:

```ts
export const EMPTY_CONVERSATION_IDS: ReadonlySet<string>
export const selectConversationIdsFor:
  (origin: ConversationListOrigin) => (s: ConversationListState) => ReadonlySet<string>
```

It reads through `selectConversationsFor`, so the "call it with a client-held id, never a daemon-supplied
one" rule that selector's docblock states is carried forward by construction rather than restated.
`selectConversationsFor` answers `null` for a slot holding no list yet and `[]` for a loaded-empty
server; both collapse here to `EMPTY_CONVERSATION_IDS` — none of the three consuming bridges reads a
not-loaded distinction, and exposing one would be a three-state API with no reader.

A `Set`, not an array and not a bare object: `ServerOrigin`'s docblock rules that a consumer indexing by
a daemon-adjacent id uses a `Map`/`Set` (a `__proto__` id would write through `Object.prototype`), and
the consumer's inner loop is a membership test per held backlog key.

Not a `useConversationListStore` read surface. A non-empty result is a fresh `Set` per call, so it has no
referential stability and would churn re-renders if subscribed; the three consumers call it once, inside
an event handler, against `getState()`. Its docblock says so.

### The scoped reset (`queueStore.ts`)

`resetBacklogs` is **replaced**, not joined, by:

```ts
resetBacklogsFor: (conversationIds: ReadonlySet<string>) => void
```

The nullary form has exactly one production caller — `QueueData`'s wiring — so keeping it would leave a
setter with no consumer. It drops every held key that is a member of the set and keeps every other slot
**by reference**, so a component watching a surviving conversation sees `Object.is` true and does not
re-render. Copy-on-write like `setBacklog`: the held map is never mutated in place. It iterates the held
keys, not the id set, so the work is bounded by what the client holds rather than by the server's
conversation count.

It keeps the `size === 0` short-circuit's property, generalised: when **no** held key matches, the state
object is handed straight back so zustand's `Object.is` fires and no listener wakes — the first-connect,
the all-drained reconnect and the "this server has nothing held" reconnect all become silent.

`selectBacklogs`, `selectBacklogFor`, `EMPTY_BACKLOG` and `setBacklog` are untouched.

### The bridge (`queueBridge.ts`)

`subscribeQueue`'s third dep changes from `() => void` to `(origin: ConversationListOrigin) => void`. The
`connected` branch stays a leading check ahead of the translator, so `translateQueueState` stays the pure
`queueState`→snapshot filter (the docblock at the top of the module explains why the reset is not folded
in). The bridge gains a module-private `originOf`, the fourth copy of the idiom after `relayLinkBridge`,
`conversationListBridge` and `daemonEventBridge` — a copy rather than an import for the reason those
three each state: importing one couples two deliberately independent subscribers.

The bridge itself never touches the conversation-list store. It reads the stamp and hands the origin
across, so `queueBridge.test.ts` keeps driving the reset with a plain spy.

`QueueData` is the composition root and the only place the two singletons meet:

```ts
(origin) =>
  queueStore.getState().resetBacklogsFor(
    selectConversationIdsFor(origin)(conversationListStore.getState())
  )
```

The list is read at reset time, not at subscribe time, so it is the list as it stands when the connection
comes back. That matters for the first connect versus a reconnect: on a first connect the server's slot
holds no list yet (the `list_conversations` request rides the same `connected` edge), so the resolution
is empty and nothing is dropped — and nothing is held either. On a reconnect the slot still holds the
previous episode's rows, because only `clearAllConversations` at a pairing boundary empties it, so the
reconnecting server's conversations are known before its re-sends arrive.

### Key domain

The origin is three-valued and that is the reset's key domain: `ConversationListOrigin` is
`string | null | undefined`, and `byServer` is genuinely keyed by all three. Reusing that type rather
than minting a fourth declaration is what makes AC2's unstamped clause fall out of the ordinary lookup
path — a `null`-stamped or unstamped `connected` selects its own slot, which normally holds no list, so
it drops nothing without a special case.

## State + concurrency model

Two renderer stores, no async. The reset is a synchronous read of one store's state inside a
synchronous write to the other, both on the single daemon-event channel's dispatch, which delivers in
arrival order. The transport emits `connected` before any re-sent `queue_state`, so reset-before-
repopulate still needs no ordering logic in the renderer.

`resetBacklogsFor` reads the held map **inside** the zustand `set` updater rather than through
`getState()` outside it, so two events arriving back-to-back cannot interleave — the same closure of the
check-then-act shape `setConversations` documents.

The id set is resolved once, at the top of the reset, from `getState()`. It is a snapshot of the list at
that instant, which is the intended semantic: a `conversationsReceived` that lands later belongs to the
next episode's truth and arrives through `setConversations`, not through this reset.

Cancellation is unchanged: `QueueData`'s single subscribe effect returns the bridge's off handle, so a
StrictMode double-mount still nets exactly one live listener.

## Error handling

No I/O, no IPC, no parsing — nothing on this path can fail. The reset is total over its key domain: an
origin with no slot resolves to the empty set and drops nothing, rather than throwing or falling back to
a wider clear. The bridge's `originOf` is total too: a `serverId` that is neither a string nor `null`
files under the unstamped slot rather than throwing, matching the three precedents.

There is no failure mode to surface in the UI, and nothing here logs.

## Testing strategy

Vitest only — this is store and data-path logic, node environment, static renders. The existing
fake-tier spec is the interaction cover and stays green unchanged (it runs one server and pushes its
snapshot after launch resolves, past the connect edge).

`conversationListStore.test.ts`:
- one server's ids, and only that server's — another server's rows are absent from the result
- a not-loaded slot and a loaded-empty slot both give the same stable `EMPTY_CONVERSATION_IDS` reference
- `null` and `undefined` origins each select their own slot, not each other's and not a string slot's
- the ids are the wire `ConversationSummary.id`, taken through `selectConversationsFor`
- a row whose id is `__proto__` becomes an ordinary set member and writes nothing through
  `Object.prototype`

`queueStore.test.ts` (the four `resetBacklogs` cases re-pointed):
- drops exactly the listed keys and leaves the rest, by reference
- a no-match reset, an empty set and an empty store each hand the state object straight back
- the held map is not mutated in place
- the setter reference stays stable across updates

`queueBridge.test.ts`:
- `connected` calls the reset once with the stamp's origin, for a string, for `null`, for an absent
  stamp, and for a non-string stamp (which files as `undefined`)
- `connected` still writes no snapshot; `queueState` still writes without resetting; unrelated events
  still do neither
- seam, over a real `createQueueStore` + `createConversationListStore` wired the way `QueueData` wires
  them: two servers with a backlog each, `connected` stamped B leaves A's held and drops B's; B's
  re-sends then repopulate in arrival order with A's untouched
- seam: a backlog whose conversation is in no server's list survives a scoped reset (AC3, pinned so a
  later widening is deliberate)
- seam: a `connected` whose `ack.server_id` names a different server than the stamp scopes to the
  **stamp's** server (AC5 — no daemon-supplied field steers the reset)

The two e2e specs get a comment-only correction where they assert in prose that every `connected` resets
ALL backlogs. No assertion, fixture or frame changes; both stay green.

## Open questions

- Whether `selectBacklogs` (the whole-map read that shipped with no production consumer, per the queue
  store overview) should be retired now that the reset is scoped. Left alone: it is adjacent code with
  its own open follow-up, and this ticket does not touch it.
- Whether the three consuming bridges should eventually share one `originOf` rather than four copies.
  The four precedents each argue for the copy; the lift is the same open question
  `docs/specs/architecture/1086-conversation-list-keyed-by-server.md` records for the origin type.

## Security review

**Verdict:** PASS — but only as re-run. The first pass returned PASS while missing the pairing boundary
entirely; that gap is the last three findings below and the design change in Revision 1. Read the two
together: the body of this section audits the server-to-server boundary, and the revision findings audit
the pairing-to-pairing one.

**Findings:**

- [Trust boundaries] The design has two inputs and they have **different provenance**, which is the
  whole point of the review here. The *slot* is chosen by the event's `serverId` stamp, bound main-side
  by `bindServerOrigin` from a paired record this client holds — `ServerOrigin`'s docblock rules it is
  deliberately not `hello_ack.server_id`, so a hostile or confused daemon cannot make its events claim
  another server's slot. AC5's claim holds on that half unconditionally. The *members of the id set*,
  however, are daemon-supplied: they are `ConversationSummary.id` values off that server's own
  `conversations` reply. So a daemon does influence which keys a reset drops.
- [Trust boundaries] OUT OF SCOPE, and the reason it is not a MUST FIX is a monotonicity argument, not a
  judgement call: the reset's scope moves from "every held key" to "the held keys this server's own list
  names", which is a **subset** under every possible input. The worst outcome a hostile daemon on server
  A can force — listing server B's conversation ids so A's reconnect drops B's held backlogs — is
  exactly the behaviour shipped today for every reconnect. A daemon can make this reset drop *less* than
  the status quo, never more, and no content crosses servers: a backlog is only ever rendered under its
  own conversation id, and B's next `queue_state` restores it.
- [Trust boundaries] OUT OF SCOPE — the real defect underneath is that `queueStore.backlogs` is keyed by
  `conversationId` alone, with no server in the key, so `setBacklog` already lets a hostile daemon on A
  push a `queue_state` under one of B's conversation ids and have it render in B's conversation view.
  That is a write-path collision this slice neither introduces nor can fix (fixing it means keying the
  store by `(server, conversation)`, which changes `selectBacklogFor`'s consumer contract). It strictly
  dominates the drop above. Picked up by whichever ticket server-keys the queue store; it belongs to the
  same unfixed family the ticket's Context names under #1089.
- [Trust boundaries] `EMPTY_CONVERSATION_IDS` is a shared singleton handed to every empty read. `Object.
  freeze` does not stop `Set.prototype.add`, so the type is the only guard — mutating it would need an
  in-repo cast past `ReadonlySet`. Accepted: it is exactly `EMPTY_BACKLOG`'s established shape in the
  same store directory, and returning a fresh set instead would forfeit the stability it exists for.
- [Tokens, secrets, credentials] No findings — nothing on this path reads, stores, compares or logs a
  credential. The origin arrives as a `string | null` scalar, never a `PairedServerRecord`, so the
  record's `token` and `server_static_pubkey` are structurally unreachable; the reset deletes map keys
  and never reads a `QueuedItem`'s `text`.
- [File / storage operations] No findings — no filesystem path, no `safeStorage`, no `localStorage`,
  IndexedDB or renderer web storage of any kind is touched. Both stores are in-memory renderer state
  that dies with the window.
- [Inter-process / Electron attack surface] No findings — no new IPC channel, no `contextBridge`
  addition, no preload change, no `webPreferences` touched. The bridge subscribes through the existing
  `window.pyry.onDaemonEvent` and adds no send path; the origin rides #1068's already-shipped stamp.
  Nothing in the diff imports from `src/main/`, so no transport, socket or key surface moves renderer-side.
- [Cryptographic primitives] No findings, and the absence is load-bearing rather than vacuous: the
  membership test is `Set.has` over non-secret routing ids, so the checklist's constant-time-comparison
  rule does not engage — neither operand is a secret or a MAC. No RNG, no key material, no Noise.
- [Network & I/O] No findings — no socket, frame, URL or timeout. The id set is a transient projection
  of rows `conversationListStore` already holds in full, built once per `connected` and not retained, so
  it adds no memory-exhaustion surface beyond the existing uncapped `conversations` reply. A hostile
  relay forcing rapid reconnects pays for one `O(list)` set build per reconnect, dominated by the
  `list_conversations` round trip each reconnect already triggers.
- [Error messages, logs, telemetry] No findings, deliberately: this path emits no log line, and that is
  the secure choice rather than an omission. The only values in hand — the server origin and conversation
  ids — are precisely the daemon-adjacent strings `ServerOrigin`'s docblock forbids from reaching a log,
  and no sibling renderer bridge logs either. There is no error class here to classify.
- [Concurrency] No findings, but one shape needed checking: the id set is resolved from
  `conversationListStore.getState()` **outside** the queue store's `set` updater, which reads as a
  check-then-act across two stores. It is not one — both stores are written from the same synchronous
  daemon-event dispatch on the renderer's single thread, and there is no `await` between the resolve and
  the write, so nothing can interleave. The held-map read is inside the updater, closing the half that
  otherwise could. Subscription lifecycle is unchanged: one effect, one off handle, one live listener.
- [Threat model alignment] Malicious relay — it is on-path and content-blind and can force reconnects;
  under this change each forced reconnect clears strictly less than it does today and leaks no plaintext,
  so the design is better under that threat, not worse. Token theft from disk — not on this path.
  Hostile daemon response — the finding above, named and deferred. Renderer compromise reaching the
  transport — unchanged, no new capability crosses the bridge.
- [Trust boundaries] **Added by Revision 1 — the boundary the first pass missed.** The pass above audits
  only the boundary between two *servers* and never the boundary between two *pairings*, where the state
  that survives belongs to a machine the operator has left. `clearPairingScopedState` excludes
  `queueStore` from the pairing-scoped clear, and states the reason in its header: the store is "cleared
  by the `connected` edge, then repopulated", so a clear there would be dead code. **Scoping the reset
  retires that justification.** After the change, a new pairing's first `connected` resolves an empty
  conversation list, matches no held key, and hands the state object straight back; and the daemon
  re-sends `queue_state` only for a NON-EMPTY conversation, so a conversation that drained while
  unpaired is re-asserted by nothing at all. Its pre-drop backlog then renders indefinitely — #197's
  shipped guarantee, broken at the pairing boundary — and because conversation ids are daemon-side, a
  re-pair to the same box reuses the id the phantom is filed under. The content at stake is a
  `QueuedItem.text`, untrusted daemon-relayed text, so this is the class `clearPairingScopedState`
  already names in security terms: a silent stale-data leak across a pairing boundary. MUST FIX,
  and fixed — see Revision 1. It is narrower than the sibling case that argument was written for
  (`conversationTimelineStore`'s "a slice from the old server could be keyed under an id the new one
  reuses"): a backlog renders only under its own conversation id and `clearAllConversations` means no
  row points at it, so the phantom is reachable rather than cross-attributed. Reachable is enough.
- [Trust boundaries] The fix's own input is audited on the same terms as the reset's, and it is
  strictly safer: `clearAllBacklogs` is NULLARY. It takes no conversation id and no server origin, so
  no daemon-supplied field can steer which backlogs survive a boundary the operator crossed
  deliberately — the property `clearAllConversations` and `clearAllModelLists` are nullary for, against
  a sharper input here, since a queued item's `text` is content the departing daemon authored. The
  clear is total and unconditional, so there is no state in which a backlog legitimately survives.
- [Concurrency] The added clear introduces no new interleaving: it is a synchronous in-memory store
  write inside a function whose ten siblings are the same, on the renderer's single thread. It cannot
  throw (nothing outside memory), so it neither needs nor perturbs the ordering constraint that keeps
  `clearAllLastRead` last. It carries the `size === 0` subscriber short-circuit, so the common case — a
  pairing change with nothing queued — wakes no listener.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-06 (revised 2026-09-06, Revision 1)
</content>
</invoke>

## Revisions

### Revision 1 — 2026-09-06 — `queueStore` joins the pairing-scoped clear

**Driven by:** the two MUST FIX findings on PR #1142 — the code-layer one against `resetBacklogsFor` +
`ClearPairingScopedStateDeps`, and the plan-layer one against `## Security review`.

**What was wrong.** The design above establishes that only `clearAllConversations` at a pairing boundary
empties the server-keyed conversation list, and uses that to argue the reconnect reset behaves correctly
across a re-pairing. It stopped one step short of the consequence. `clearPairingScopedState` excludes
`queueStore` from the pairing-scoped clear set and justifies the exclusion by the property this ticket
removes: while the reconnect reset cleared the WHOLE map, a re-pairing's first `connected` blanked every
latched backlog on its way past, so a clear at the boundary would have been dead code. Scoped, that edge
resolves the new pairing's empty conversation list, matches no held key, and returns the state object
unchanged — and since the daemon re-sends `queue_state` only for a NON-EMPTY conversation, a conversation
that drained while unpaired is re-asserted by nothing. Its stale pre-drop backlog renders indefinitely,
which is exactly the bug #197 shipped to fix, reintroduced at a boundary the original design never
examined.

**The new contract.** `queueStore` gains a nullary `clearAllBacklogs: () => void` and joins
`ClearPairingScopedStateDeps`, wired in `PairedShell`'s `clearPairingDeps` beside `clearAllConversations`.
The two mechanisms now split the work rather than one covering for the other: the `connected` edge drops
the reconnecting server's listed conversations (`resetBacklogsFor`, unchanged by this revision), and the
pairing boundary drops everything. `clearAllBacklogs` returns `initialQueueState` by reference and carries
the `size === 0` subscriber short-circuit, the `clearAllModelLists` shape; it is nullary for the reason its
four siblings are, against a sharper input — a queued item's `text` is untrusted daemon-relayed content,
so an id-taking clear would let the departing daemon choose which of its own messages outlive it.

This is the same sequence `conversationListStore` ran through, and the second instance of it: #531
excluded that store as self-healing, #1086 removed the self-heal and had to add it here. `queueStore` is
now the only member of the set whose store the `connected` edge ALSO clears, which is why
`clearPairingScopedState`'s header gains a paragraph rather than just a list entry — the discriminator it
documents ("does a reconnect to the SAME daemon need to clear it?") answers BOTH for this store, and the
header said such a store does not belong in the set at all.

**Testing added.** `queueStore.test.ts` gains a `clearAllBacklogs` block: it drops every server's
backlogs including the orphan `resetBacklogsFor` is defined to leave alone (AC3's complement), returns
`initialQueueState` by reference, is a same-reference no-op when already clear, does not mutate the map
in place, and takes no arguments. `clearPairingScopedState.test.ts` goes from ten clears to eleven — the
call assertion, the "exactly these N stores" key-set pin, the already-clear no-op case — and gains one
integration case that asserts both halves of the argument: that a new pairing's first `connected` (a
scoped reset with an empty id set) leaves the phantom, and that the pairing clear removes it. Both new
cases were verified to redden with `deps.clearAllBacklogs()` removed.

**Also corrected.** `clearPairingScopedState`'s header no longer lists `queueStore` among the
self-healing stores, and its counts move from ten to eleven. Per the NIT on the same review,
`conversationListStore.test.ts`'s `__proto__` case drops two assertions that could not fail
(`Object.prototype` identity, and an unwritten `polluted` key) in favour of `expect([...ids])`, which
does redden on a bare-object accumulator — assigning `__proto__` there sets the prototype instead of
adding an own key, so the id vanishes from an enumeration.

**Not changed.** `resetBacklogsFor`, `selectConversationIdsFor`, `queueBridge` and its `originOf` are
untouched; the verifier confirmed those as correct. The deferred findings in the Security review above
(the `conversationId`-only keying of `backlogs`, and the daemon's influence over the id set) stay
deferred on the same reasoning — this revision narrows what survives a boundary and widens nothing.
