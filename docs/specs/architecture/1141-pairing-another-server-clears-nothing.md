# #1141 — pairing another server clears nothing

## Files read

- `src/renderer/src/PairedShell.tsx` → `PairedShell`, `PairedShellView`, `clearPairingDeps` — the
  container holding the three pairing-change wirings; `onUnpaired` and `onPairServerPaired` both run
  the clear today, `onPairServerCancelled` runs nothing. This is the file the deliverable edits.
- `src/renderer/src/clearPairingScopedState.ts` → `clearPairingScopedState`,
  `ClearPairingScopedStateDeps` — the thirteen-effect helper. Not edited beyond its prose; its
  docblock argues "both paths clear the same set", which this ticket makes false.
- `src/renderer/src/clearPairingScopedState.test.ts` → the thirteen-key `Object.keys` pin, the four
  call-order cases, the real-store integration cases — all stay green untouched; the pin's *stated
  motive* goes stale.
- `src/renderer/src/exitActiveConversation.ts` → `exitActiveConversation`,
  `ExitActiveConversationDeps` — the closest precedent for the lift: injected effects, a nav effect
  supplied at the call site because it needs the container's `dispatch`, spies in the unit test.
- `src/renderer/src/activateConversation.ts` → `activateConversation` — the second precedent, and it
  carries one stale sentence of its own (`clearActiveConversation` "belongs to #531 (unpair /
  pair-another-server)").
- `src/renderer/src/screens/conversation/unpairAction.ts` → `runUnpair` — the third precedent, and
  the site whose single-owner rule is argued from "the pair-another path would silently lose its
  clear". Also the fail-safe: `onUnpaired` fires only on `result: 'ok'`, so the clear inherits it.
- `src/renderer/src/screens/conversation/unpairAction.test.ts` → the `dispatch` not-called case,
  whose comment repeats that same reason.
- `src/renderer/src/pairedRoute.ts` → `PairedRoute`, `nextPairedRoute`, `assertNever` — the
  reducer the three transitions dispatch into; the local-`assertNever`-per-module idiom the new
  helper follows (ten copies across the renderer, one per switch).
- `src/renderer/src/PairedShell.test.tsx` → the composition-posture comment and the reducer
  assertions — the reason the negative cannot land here (no DOM, no handler ever invoked).
- `src/main/index.ts` → the `onCommand` switch's `answerModal` and `setSessionSettings` arms —
  the routing evidence behind the "is it sound?" question the ticket asks. Both are
  content-addressed (`correlations.routeModal`, `correlations.routeSession`), not
  most-recently-paired.
- `src/main/connectionRegistry.ts` → `createConnectionRegistry`, `ActiveConnection` — one live
  connection per paired record since #1117; its header's "until then they reach the most recently
  paired server" caveat is about the members #1118/#1119/#1120 had not yet routed, and both members
  this ticket depends on are now routed.
- `src/renderer/src/store/sessionIdStore.ts` → `SessionIdState` — confirms the held id is *the open
  conversation's* session, not "the pairing's".
- `docs/knowledge/features/paired-shell.md` § Edge cases — carries the residual this lift closes:
  *"the 'clear runs before the route flips' ordering has no executable assertion after #531 removed
  the one `unpairAction.test.ts` case that pinned it … worth restoring the moment a jsdom harness
  lands"*. A jsdom harness is not needed; lifting the wiring into a pure helper restores it.
- `docs/knowledge/features/paired-shell-pair-server-route.md` — the pair-another route's own
  overview, which transcribes both wrapped call sites.
- `e2e/paired-shell-navigation.spec.ts`, `e2e/unpair-repair.spec.ts` — the two specs that drive
  these routes; neither reaches `onPaired` (no second server stands up in `launchPairedApp`), so
  neither observes the clear.

Codegraph was not used: every `mcp__codegraph__*` call in this repo fails with "CodeGraph not
initialized" (a hard error, not an empty result). Reading list built with Grep + Read.

## Design source

**Figma:** N/A — no visual surface changes. This ticket deletes a state-clearing call and lifts three
existing wirings into a pure helper; it adds no component, no layout, no token and no copy. What the
operator sees is the app *not* blanking screens it already renders, so there is no node to compare a
render against.

## Context

`PairedShell` runs `clearPairingScopedState` on two transitions: unpair, and pair-another-server. The
helper performs thirteen effects, from the flat timeline through every server's conversation rows to
the persisted last-read marks. That symmetry was right while the app held one pairing at a time,
because pair-another then meant leaving one machine for another. Since #1117 and #1084 the background
process holds one live connection per paired server, and the end state is several servers connected
at once — so adding a third machine must not touch the first two.

The wipe's stated rationale is also false. `clearPairingScopedState`'s docblock argues that a
conversation id is scoped to the server that issued it, so a retained thread could be keyed under an
id the new server reuses. The daemon mints conversation ids as UUIDv4 from the system random source
(`internal/conversations/id.go` in the pyrycode repo, at `7304b79b`), so a second server cannot reuse
the first server's ids.

Unpair is untouched: it genuinely ends a pairing, there is no per-server unpair in the renderer yet
(#1090 lands one), and the helper's whole-app boundary is already pinned by its own real-store test.

No ADR is warranted. This changes no architectural decision — it withdraws one call site from a
helper whose contract, membership rule and ordering constraints all stand. The membership arguments
(#1086, #1138, #1139, #1140) survive verbatim against the path that remains; they are restated, not
deleted.

## Design

### The lifted helper — `src/renderer/src/applyPairingChange.ts`

The negative ("pairing another server clears nothing") needs somewhere observable to land. Today the
wiring is three inline arrows inside `PairedShell`'s JSX, and no test in this repo can invoke them:
`vitest.config.ts` is `environment: 'node'`, so renderer specs are static server renders with no DOM,
no effects and no event handlers. The lift follows the `activateConversation` /
`exitActiveConversation` / `unpairAction` / `composerSend` precedent exactly — a framework-free,
React-free pure function with injected effects, tested with plain spies.

```ts
export type PairingChange = 'unpaired' | 'pairedAnotherServer' | 'cancelledPairAnotherServer'

export interface PairingChangeDeps {
  clearPairingScopedState: () => void   // PairedShell's clearPairingDeps, applied
  navigateToPairingScreen: () => void   // App's route flip; unmounts this shell
  navigateToNewServerList: () => void   // dispatch pairServerPaired → `list`
  returnToSettings: () => void          // dispatch pairServerCancelled → `settings`
}

export function applyPairingChange(deps: PairingChangeDeps, change: PairingChange): void
```

One function over a three-member union rather than three exported functions, and the union is the
point: a `switch` with the module-local `assertNever` default makes "does this pairing change clear?"
a **compile-forced decision at every future member**, which is the same tripwire shape
`ClearPairingScopedStateDeps`' thirteen-key pin uses one layer down. Three separate helpers would let
a fourth transition be added beside them with the question never asked.

Arms:

- `unpaired` → `clearPairingScopedState()` **then** `navigateToPairingScreen()`. Clear-then-navigate,
  unchanged, and now assertable by call order for the first time.
- `pairedAnotherServer` → `navigateToNewServerList()` only. **This is the deliverable.**
- `cancelledPairAnotherServer` → `returnToSettings()` only. Behaviour identical to today; routing it
  through the same helper turns "cancelling clears nothing" from an absence of code into a positive
  assertion, which is what AC3 asks for.

No gate, no return value, no throw path of its own, nothing logged — the surrounding helpers'
posture. A diagnostic here would carry only a static change label and there is no observed failure to
instrument, so `clearPairingScopedState`'s total no-diagnostic property extends to its caller.

### The call sites — `PairedShell`

`clearPairingDeps` stays module scope and unchanged; it is now reached through exactly one member of
the new deps object. The `PairingChangeDeps` object is built **inside the container**, because three
of its four members close over per-render values (`onUnpaired`, `dispatch`) — the
`exitConversationDeps` precedent, which supplies `navigateToList` at the call site for the same
reason. The per-render allocation is free: `PairedShell` subscribes to no store and re-renders only
on its own nav dispatch, so it stays server-renderable and that invariant is untouched.

The three JSX props each become one `applyPairingChange(pairingChangeDeps, '<change>')` call.

### What is deleted

Exactly one thing: the `clearPairingScopedState(clearPairingDeps)` call under `onPairServerPaired`.
`clearPairingScopedState` itself is not edited beyond its prose — no effect added, removed or
reordered.

### The prose sweep

The helper is ~300 lines of comment arguing "both paths clear the same set", which this ticket makes
false. Confirmed-stale sites, each restated against the one path that remains (never deleted, since
the *arguments* survive — only their scope narrows):

- `clearPairingScopedState.ts` — the file header's "PairedShell's two pairing-change sites"; the
  docblock's "Called from BOTH paths that end a pairing" and the `pairServer` → `list` argument
  beneath it; "Twelve of these thirteen stores latch across **either** switch"; the last-read
  paragraph's "survive not only either switch"; the two #1086 paragraphs; the #1138 / #1139 / #1140
  membership paragraphs; and the conversation-id-reuse rationale this ticket disproves (replaced by
  the UUIDv4 fact and its source, not merely dropped).
- `PairedShell.tsx` — the `#531` block above the wirings and the `#531` docblock over
  `clearPairingDeps`, which makes the both-paths argument a second time.
- `clearPairingScopedState.test.ts` — the thirteen-key pin's comment. The assertion is unaffected and
  the pin's *value* survives (it still forces a fourteenth store to be declared, wired and asserted);
  its stated motive — divergence between two independent call sites — is restated against one.
- `unpairAction.ts` and `unpairAction.test.ts` — both argue the single-owner rule from "the
  pair-another path would silently lose its clear". The rule survives on a different reason (the
  helper is where the set is enumerated and tested); that reason does not.
- `activateConversation.ts` — one sentence: `clearActiveConversation` "belongs to #531 (unpair /
  pair-another-server)". Now unpair alone.

Three sites that stay TRUE and must not be churned: `conversationActivityBridge.ts` and
`conversationActivityBridge.test.ts` (the `connected` edge does still cover both pairing-change
paths — the handshake fires on both), and `clearPairingScopedState.test.ts`'s pre-existing stale
"its seven effects" count, which predates this ticket. The `docs/knowledge/features/` overviews are
the documentation phase's, not this ticket's.

## State + concurrency model

No store changes, no new state, no async, no subscription, no teardown. `applyPairingChange` is
synchronous and total; on the renderer's single thread no observer can see a half-applied change, and
React batches the unpair arm's thirteen writes into the same commit as the route flip, exactly as
today. The only ordering constraint is intra-arm: on `unpaired`, clear precedes navigate, so no
observer sees the pairing screen against the ended pairing's rows.

**What now survives a pair-another, and why each is sound.** Server A is still paired, still
connected, and still the owner of everything retained:

- The **conversation rows** are keyed by server (`byServer`); the new pairing's reply fills its own
  slot and the app-wide read unions across slots. #1086's residue was a *departed* server's slot never
  being written again — no server departs here.
- The **queued backlogs**, **background-task rosters**, **outstanding prompts**, **published menus**
  and **retained threads** are keyed by conversation id, and ids are UUIDv4 (see Context), so server
  C cannot collide with server A's keys.
- The **session id** holds *the open conversation's* current daemon session. Pairing another server
  does not change the open conversation, so the id still names a live session on a connected daemon.
  Its security payload — the Run configuration controls going inert so no auto-approval write can
  address a session on a daemon the operator has left — is not weakened: the operator has not left.
  And `setSessionSettings` is routed main-side **by session id** (`correlations.routeSession`,
  #1119), so the write reaches the daemon that owns that session, never "the most recently paired".
- The **outstanding permission prompts** stay answerable, and that is the *correct* outcome rather
  than a tolerated one: the prompt is a live control on a live daemon that is still waiting for it.
  #1140's residue was answering a prompt whose `modalId` the currently paired daemon never issued;
  `answerModal` is routed **by modal id** (`correlations.routeModal`, #1119) to the connection that
  raised it, so the answer reaches server A. Clearing here would be the defect — it would drop a
  genuine prompt the operator must answer, leaving the daemon blocked with no affordance to unblock
  it.

## Error handling

Unchanged everywhere. The unpair arm inherits `runUnpair`'s fail-safe posture verbatim: `onUnpaired`
fires only on `result: 'ok'`, so a failed unpair reaches neither this helper nor the clear.
`clearAllLastRead` remains the one effect that can throw (`localStorage`) and remains last inside
`clearPairingScopedState`; this ticket adds no try/catch and no new throw path. The pair-another and
cancel arms perform one nav effect each and cannot fail.

## Testing strategy

Vitest only (node environment, plain spies) — `src/renderer/src/applyPairingChange.test.ts`, new:

- **unpair clears the pairing-scoped set exactly once, then flips the App route** — and the ordering
  is pinned by `mock.invocationCallOrder`, which closes the residual the paired-shell overview has
  carried since #531 ("no executable assertion … worth restoring the moment a jsdom harness lands").
  No harness needed once the wiring is pure.
- **pairing another server never calls the clear** and navigates to the new server's list exactly
  once — AC1 and AC4's "fails if the call is put back". Restoring the deleted call reddens this.
- **cancelling out of pair-another never calls the clear** and returns to settings — AC3.
- **each arm drives exactly one of the three nav effects**, the other two untouched — so a future
  edit cannot silently cross-wire two transitions onto one destination.
- **an exhaustiveness pin**: a `Record<PairingChange, { clears: boolean }>` table driving the loop, so
  a fourth union member fails to compile until it declares whether it clears — the thirteen-key pin's
  shape, one layer up.

Unchanged and expected green: `clearPairingScopedState.test.ts` in full (including the thirteen-key
pin, the four call-order cases and the whole-app-boundary real-store case, which drives the helper
directly rather than through a call site), `unpairAction.test.ts`, `PairedShell.test.tsx`,
`pairedRoute.test.ts`. E2E: `e2e/paired-shell-navigation.spec.ts` (pair-another as far as Cancel) and
`e2e/unpair-repair.spec.ts` both stay green — neither reaches `onPaired`, since no second paired
server stands up in `launchPairedApp` (that is #1091's subject, and standing one up here is
explicitly out of scope).

No e2e spec is added. Proving the negative there would need a second paired server in the fixture,
which is unproven and a far larger change than this ticket.

## Open questions

1. **Is leaving the session id and the retained prompts live actually sound?** Resolved before the
   plan commit, in State + concurrency above: yes, both, and the routing evidence
   (`correlations.routeSession` / `correlations.routeModal` in `src/main/index.ts`) is what makes it
   more than an assertion. Nothing to report back on the ticket.
2. **`announcedModelStore` after a pair-another.** It is a single app-wide slot, not keyed by server
   or conversation, and nothing re-asserts it until the next turn — so after this change the Run
   configuration sheet can show server A's announced model while a server C conversation is open.
   This is *not* introduced here: the same staleness is already reachable with two servers paired
   from a previous launch, by switching between an A conversation and a C conversation (nothing
   clears it on a conversation switch, by design — the model is daemon-scoped, not
   conversation-scoped). This ticket removes an accidental mitigation, exactly the shape #1145
   records for `conversationActivityStore`. Filed as **#1146** rather than widened into here; it is
   display-only (the *actionable* surface, #975's model sheet, reads the per-conversation
   `modelListStore`, which is not affected).
3. **`sessionStore`'s app-wide connection status** is likewise single-valued and now survives a
   pair-another. Benign: the new server's own `connected` edge writes it moments later, and no
   auto-approval or wire write reads it. No action.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. This change crosses no process boundary — it is renderer-local
  state lifecycle, with no IPC channel added, widened or re-shaped. The untrusted-data question it
  *does* raise is attribution: thirteen stores hold daemon-supplied text and this ticket lets it
  outlive a pairing *addition*. Every one of them is either keyed by server
  (`conversationListStore`'s `byServer`) or keyed by conversation id, and conversation ids are UUIDv4
  minted from the daemon's system random source, so server C cannot address server A's slice. The
  single-valued exceptions (`announcedModelStore`, `sessionStore`'s status, `sessionIdStore`) are
  walked individually in State + concurrency and Open Questions 2–3; none reaches a wire write.
- **[Tokens, secrets, credentials]** No findings. The renderer holds no token, key or credential —
  they live in main behind `safeStorage` and never cross the bridge. Nothing in the thirteen-store set
  is a secret; the sharpest content is untrusted daemon-relayed text.
- **[File / storage operations]** No findings. One effect reaches disk — `clearAllLastRead`'s
  `localStorage` write — and this ticket neither moves it, reorders it, nor changes what it writes; it
  simply is not invoked on the pair-another path. The retained bytes are conversation ids for
  conversations on a server that is *still paired*, i.e. exactly the data #776 already persists across
  restarts. No new path is constructed, no untrusted string reaches a filesystem path.
- **[Inter-process / Electron attack surface]** No findings. No `contextBridge` API, no
  `ipcMain` handler, no protocol registration, no `BrowserWindow` option is touched. The new module is
  React-free and Electron-free, imports no store and no bridge, and cannot reach main.
- **[Cryptographic primitives]** Not applicable — no randomness, no comparison against a secret, no
  key or nonce handling anywhere in this change. The one cryptographic fact it *relies* on is
  external and read-only: the daemon's UUIDv4 conversation ids come from the system random source,
  cited to `internal/conversations/id.go` at `7304b79b` rather than assumed.
- **[Network & I/O]** Not applicable — no socket, no frame, no relay URL, no timeout and no reconnect
  path is touched. The change cannot put a byte on any wire.
- **[Error messages, logs, telemetry]** No findings. `applyPairingChange` logs nothing, deliberately,
  extending `clearPairingScopedState`'s total no-diagnostic property to its caller. The one thing a
  diagnostic here *could* carry safely is a static change label, and there is no observed failure to
  instrument — so writing one would be the first crack in a property that currently holds absolutely.
  No error message, no thrown value, no new string reaches a log.
- **[Concurrency]** No findings. The helper is synchronous and total: no `await`, no timer, no
  listener, no `AbortController`, nothing to cancel and nothing that can outlive the shell. There is
  no check-then-act — no arm reads store state at all. The one intra-arm ordering constraint
  (clear before navigate, on unpair) is now pinned by an executable call-order assertion rather than
  by a comment, which is strictly stronger than what shipped.
- **[Threat model alignment]** The adversarial case for this change is: *can pairing a hostile
  server C cause an action to be taken against server A's retained state?* Two live controls survive
  the transition — an outstanding permission prompt and the Run configuration write — and both are
  routed main-side by a **content-addressed** key learned from the frame that created them
  (`correlations.routeModal` off the stamped `modalShown`; `correlations.routeSession` off the
  stamped `runConfigReceived`), never by "the most recently paired connection". A hostile C cannot
  make itself the target of A's modal answer, and cannot make A's session id address its own daemon.
  The inverse case — state surviving a server the operator has actually *left* — is unpair, whose
  clear is untouched and whose whole-app boundary stays pinned by the helper's own real-store test.
  MUST NOT regress, and does not: a **departed** server's prompts, rows, rosters and marks still all
  go.
- **[Threat model — deferred]** OUT OF SCOPE, both named with owners: `conversationActivityStore`
  still blanks every server's turn state on any server's `connected` edge (#1145, a scoping change of
  the #1138/#1139/#1140 shape, explicitly carved out by this ticket), and the single-valued
  `announcedModelStore` staleness in Open Question 2 (filed as #1146; display-only, reaches no wire
  write).

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-06

## Revisions

### 2026-09-06 — the prose sweep found two more sites than the plan listed

Implementing the sweep the ticket asks for ("sweep for it rather than working from a list") turned up
two stale claims the plan's own list did not name, both restated rather than deleted:

- `PairedShell.tsx` — four of `clearPairingDeps`' member comments (#977, #1086, #1139, #1140) each end
  *"Adding it to THIS object is what makes both pairing-change paths below drop it; neither call site
  needed an edit."* One call site now. The #1140 member additionally gained the reason its residue
  argument does not reach a still-paired server: `answerModal` routes by modal id to the connection
  that raised the prompt.
- `src/renderer/src/store/sessionStore.ts` — the `reset` action's comment says the clear set is *"owned
  by `clearPairingScopedState.ts`, which both pairing-change paths run"*.

**Production-file count: 6, one over the size table's 5.** The sixth is `sessionStore.ts`, and the edit
is a single comment sentence — no behaviour, no signature, no consumer. Stated rather than avoided:
suppressing a known-false sentence to protect a file count would invert what that count is for (it
bounds edit cost and cascade risk, and a comment correction carries neither), and the ticket makes the
sweep part of the deliverable precisely because the helper's prose is load-bearing. The other five
lines of the table hold as planned.

### 2026-09-06 — how RED was reached

The lift landed first with the pair-another clear carried over *verbatim*, so the suite reddened on
exactly the two cases that forbid it (`pairing another server clears NOTHING` and the table pin)
while the unpair and cancel cases passed. Deleting the one call turned both green. That sequence is
AC4's "a test that fails if the call is put back", executed rather than asserted.
