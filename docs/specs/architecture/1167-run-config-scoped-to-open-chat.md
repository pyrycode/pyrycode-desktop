# #1167 — The run-configuration state is scoped to the open chat

## Files read

- `src/renderer/src/store/runConfigStore.ts` → `RunConfigState`, `createRunConfigStore`, `selectSnapshot` —
  the held snapshot half. A single-setter store today; its header states "there is exactly one mutation",
  which this ticket falsifies.
- `src/renderer/src/store/runSettingsWriteStore.ts` → `RunSettingsWriteEvent`,
  `reduceRunSettingsWrite`, `selectEffectiveSettings` — the durable half. The `reconnected` arm is the
  structural template *and* the deliberate contrast: it preserves `confirmed`/`error` where this arm must
  not.
- `src/renderer/src/activateConversation.ts` → `ActivateConversationDeps`, `activateConversation` — the
  id gate (AC2 is already its same-id branch) and #1166's documented clear-before-ask ordering.
- `src/renderer/src/exitActiveConversation.ts` → `ExitActiveConversationDeps`, `exitActiveConversation` —
  the delete/archive path; its "Stores deliberately left OUT" list is where a reader will look for why
  this one is now in.
- `src/renderer/src/PairedShell.tsx` → `activateDeps`, `exitConversationDeps` — the two production dep
  sites, both module-scope objects that reach their singletons through `getState()` inside the arrow body.
- `src/renderer/src/clearPairingScopedState.ts` → `ClearPairingScopedStateDeps` — read to confirm AC4 by
  inspection: thirteen members, and its self-healing-store paragraph names `runConfigStore` by name. Not
  edited.
- `src/renderer/src/screens/conversation/ComposerEffortMenu.tsx` → `composerEffortMenuModel` — returns
  `null` on `effort === ''`, which is how AC3's not-known rendering is reached by construction rather than
  by new code.
- `src/renderer/src/store/sessionIdStore.ts` → `clearSessionId` — the set/clear-pair precedent
  `clearSnapshot` copies, including "source the exported initial constant, not a fresh literal".
- `e2e/run-config-cross-conversation.spec.ts` — the two-conversation drive shape the ticket names.
- `e2e/composer-effort-menu.spec.ts` — the frame templates for seeding a snapshot, publishing a model
  list, and confirming a `set_session_settings`; the effort label's locator.
- `docs/knowledge/features/run-settings-write-store.md` § "The reducer" and § "Edge cases" — records
  "**No reset when a fresh snapshot arrives** … Deferred — add clearing only if a real divergence
  surfaces." This ticket is that divergence surfacing, and the deferral is what it retires.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=115-3660

Node 115-3660 is the composer footer's control row — a single 328×16 line of small primary-coloured
labels, each with an up-chevron: `Actions ⌃  Auto ⌃  Opus ⌃  Max ⌃  Context: 84%`. This ticket authors
**no markup and no CSS**: every control in that row already has a shipped not-known rendering (the effort
and permission-mode controls draw nothing at `''`, the context reading unmounts with no snapshot), and the
change is to make those renderings reachable on a chat that has not answered yet. The screenshot is the
reference for what the row looks like when it *is* populated; no design-context token data is consumed
because no style is authored. The visible consequence is a shorter row on a freshly opened chat until its
reply lands.

## Context

`runConfigStore.snapshot` and `runSettingsWriteStore`'s `pending`/`confirmed`/`error` are app-wide
singletons keyed by nothing, and no path resets them when the open chat changes. The snapshot half is
already bounded by two siblings that landed 2026-09-06 — #1166 asks on open, #1176 refuses a reply that
names a different chat — so it goes stale for one round trip. The write store has no such bound at all: a
`set_session_settings` ack carries only `session_id` and never rewrites the snapshot, so an override
confirmed in chat A composes over every later chat's snapshot permanently, through
`selectEffectiveSettings`. That is the durable half and the one the detector is built on.

This is a lifetime fix, not a new mechanism: both stores gain a clear, and the two existing
conversation-lifetime helpers call it.

No ADR is warranted. The decision this records — conversation-scoped renderer state is cleared by the
`activateConversation` / `exitActiveConversation` dep sets rather than by the store or the call site — is
the settled idiom those two helpers already embody for the timeline and the session id; this ticket adds
a fifth and sixth store to it without changing the rule.

## Design

### `runConfigStore` — a second named mutation

```ts
export type RunConfigStore = RunConfigState & {
  setSnapshot: (snapshot: RunConfigSnapshot) => void
  clearSnapshot: () => void          // new
}
```

`clearSnapshot` sets the store back to `initialRunConfigState` — the exported constant, not a fresh
`{ snapshot: null }` literal, for the reason `sessionIdStore`'s `clearSessionId` states in its own
docstring: it keeps resetting everything if the state ever gains a second field. Unconditional, so
clearing an already-clear store is a no-op by construction rather than by a guard. `selectSnapshot` is the
only read surface and `null → null` is not a slice change, so no subscriber re-renders on a redundant
clear.

A named setter rather than converting this store to a reducer: it has exactly one existing mutation, and
`sessionIdStore`'s set/clear pair is the precedent for a second independent whole-value write that reads
no prior state. The ticket's Technical Note prescribes a reducer arm only for the write store, whose
mutations are already a sealed union.

The header comment's "there is exactly one mutation, so a discriminated-union action set would be ceremony
without benefit" and `selectSnapshot`'s "there is no exposed setter beyond `setSnapshot`; it is the sole
mutation path" both go false with this change and are rewritten in the same commit.

### `runSettingsWriteStore` — a fifth arm

```ts
| { type: 'conversationSwitched' }   // new, uncorrelated
```

It clears `pending`, `confirmed` **and** `error`. That is the whole of what distinguishes it from
`reconnected`, and the reason is the one the ticket states: a reconnect abandons correlations for a
session that is still the one being described, while a switch changes which session is being described at
all. A standing rejection and a confirmed override are both statements about the chat being left.

Two deliberate departures from `reconnected`, each documented at the arm:

- **It returns a fresh whole-state literal, not `{ ...state, … }`.** `reconnected` spreads `state` so an
  unknown future field is preserved by default, matching its "clear only the thing that strands" posture.
  This arm's posture is the inverse — every field of this store is conversation-scoped — so it returns
  `{ pending: new Map(), confirmed: {}, error: null }`, which is a compile error the moment a required
  field is added. Forcing that decision is the point.
- **The same-reference early-out widens to all three fields.** `reconnected` returns `state` when
  `pending` is empty; this arm returns `state` when `pending` is empty *and* `confirmed` has no keys *and*
  `error` is `null`. Load-bearing for `reconnected`'s stated reason: `RunConfigSections`' container selects
  the whole raw write state, so without it every switch on a chat that never wrote anything would re-render
  the sheet.

`selectEffectiveSettings` and `selectPendingFields` are untouched — clearing the layers is all that is
needed; the composition rule does not change.

### The two helpers — one injected member each

Both dep interfaces gain:

```ts
clearRunConfig: () => void   // both stores, one member
```

**One member for two stores, not two members** — #1166's `requestConversationConfig` precedent verbatim:
the two are one act ("drop the run configuration of the chat being left"), they always fire together,
neither is meaningful alone, and it holds each interface at one new nullary member rather than two.
Required, not optional, for the reason both helpers already state for their other members: `activateDeps`
is module-private and `vitest.config.ts` is `environment: 'node'` globally, so the wiring itself is
structurally uncoverable and `tsc` is the whole safety net.

**Cross-wire hazard, and it is worse here than at three members.** `clearRunConfig` is nullary, so on
`ActivateConversationDeps` it is swappable with `clearSessionId`, and on `ExitActiveConversationDeps` with
`clearSessionId`, `clearActiveConversation` and `navigateToList` — every swap compiles, and a bare
`toHaveBeenCalled()` passes for both halves. The defence is the existing one and it must be extended
rather than assumed: the `realDeps` integration cases wire the real isolated store instances, so a swap
leaves one store uncleared and another wrongly cleared and the cases fail together. Both helpers' test
files get their `realDeps` widened with real `createRunConfigStore` / `createRunSettingsWriteStore`
instances for exactly this.

**Placement in `activateConversation`:** inside the id gate, after `clearSessionId()`. Inside is AC2 —
the same-id branch that already preserves the timeline and the session id preserves the run configuration
too. Being inside the gate also puts it ahead of `requestConversationConfig`, which sits last and outside;
that ordering is the one #1166 documents for `clearSessionId` and it applies here unchanged — ahead of the
clear, a reply landing in the same tick would be blanked by the clear sent to repair it.

**Placement in `exitActiveConversation`:** after `clearSessionId()`, before `navigateToList()`. The
existing clears are order-independent among themselves; only the nav is pinned last, and this joins the
set rather than changing that rule. Delete and archive both route through this one helper
(`useConversationDeletedExit` and `useArchivedActiveConversationExit`), so AC1's archive half needs no
second site.

### `clearPairingScopedState` — untouched, on purpose (AC4)

It keeps its thirteen members and the write store keeps `reconnected` as its only other reset arm. The
ticket's own rule: an unpair leaves the write store held, but no footer renders until a chat is opened and
that open clears it by construction, so a member here would guard state nothing can read. Its
self-healing-store paragraph, which names `runConfigStore` and the `connected`/turn-end refresh that heals
it, stays true as written — this ticket adds a second healing mechanism, it does not falsify the one
described. No edit, which also keeps this ticket at five production files.

### Falsified prose, corrected in the same commit

Only in files this ticket already modifies: `runConfigStore.ts`'s "exactly one mutation" and "sole
mutation path"; `runSettingsWriteStore.ts`'s "four transitions" and "four arms";
`exitActiveConversation.ts`'s "six effects", "four clears" (twice) and its stale "clearPairingScopedState's
seven" (thirteen since #1086/#1139/#1140/#779);  `activateConversation.ts`'s "seven effects"; and
`PairedShell.tsx`'s "it clears the timeline and session id, not screen-local state".

## State + concurrency model

Two Zustand stores, both renderer-only, both mutated synchronously on the renderer's single thread inside
the two helpers. No async work, no subscription, no cancellation path: every call is a synchronous store
write inside a React event handler or a bridge callback, and React batches the whole helper into one
commit. Nothing here can throw and nothing returns a value.

The one lifetime interaction that matters is the ordering against #1166's in-flight request, and it is
handled by placement rather than by state: the clear precedes the ask on the activate path, and #1176's
correlation gate independently refuses a reply that names a chat other than the open one, so a reply
crossing a switch reaches neither store regardless of arrival order.

Consequence, intended and already documented on both helpers for the session id: clearing the snapshot
also drops `usedTokens`/`windowTokens`, so the footer's context reading unmounts until the new chat's
reply lands. That is the same widened window the session-id clear already carries.

## Error handling

No new failure mode. Both clears are total nullary writes over local state with no I/O, no parse, no
wire contact and no throw path. Nothing is logged: a diagnostic here would want the conversation id to be
useful, which ADR 0007's content-free rule forbids, and there is no observed failure to instrument — the
`activateConversation` / `exitActiveConversation` posture, unchanged.

The only failure this ticket can introduce is a mis-wired dep member, which is a silent one; it is answered
by the `realDeps` integration cases above, not by a runtime check.

## Testing strategy

**vitest (node, pure — no React, no DOM):**

- `runConfigStore.test.ts` — `clearSnapshot` returns a populated store to `initialRunConfigState`;
  clearing an already-clear store leaves `snapshot` null; a cleared store still accepts a later
  `setSnapshot`; DI isolation (one instance's clear does not touch another's).
- `runSettingsWriteStore.test.ts` — a new describe beside the `reconnected` one:
  `conversationSwitched` drops pending, confirmed and error together; the contrast case asserts
  `reconnected` on the same seeded state still preserves confirmed and error (the two arms pinned against
  each other, so a future edit cannot collapse them); the same-reference early-out on an untouched store;
  and `selectEffectiveSettings` composed over a *foreign* snapshot after the arm returns that snapshot's
  own values rather than the cleared overrides — the assertion that would catch a `case` that clears
  `pending` only.
- `activateConversation.test.ts` — spy cases: a different id calls `clearRunConfig`; the same id does
  not; `clearRunConfig`'s invocation order precedes `requestConversationConfig`'s. `realDeps` widened with
  real run-config and write stores: after a switch both are back at their initial states; after a re-open
  of the active conversation both are untouched *by reference*.
- `exitActiveConversation.test.ts` — spy cases: a matching id calls `clearRunConfig`; a mismatched id
  and a null active conversation do not. `realDeps` widened the same way.

**Playwright, fake tier — `e2e/run-config-scoped-to-conversation.spec.ts` (new file):**

Its own spec for `run-config-cross-conversation.spec.ts`'s stated reason: every other run-config spec
drives one seeded row, and what this needs is a second chat with a *confirmed override* held across the
switch. The drive, one launch, one continuous sequence:

1. Chat A open (the fixture navigates by clicking the seeded row). The fake answers A's
   `request_session_settings` with a baseline effort and pushes A's model list, so the effort control is
   operable.
2. Pick a different level; the fake confirms it. `confirmed.effort` now holds a value no snapshot can
   displace — the durable half of the defect, seeded.
3. Switch to B through the FAB's real create round trip. The fake captures B's `request_session_settings`
   and **answers nothing**, so the drive owns when B's reply lands.
4. Assert the effort label's count goes to 0 — a 1 → 0 mutation, not an opening absence, so it cannot
   pass vacuously. With the clear deleted the confirmed override survives and the label stays mounted.
5. **Mutation check last**: push B's own correlated reply carrying a third, non-substring effort value.
   The label must read *B's* value. This is a second independent detector — with the clear deleted the
   confirmed override would beat B's snapshot and the label would read the value picked in A.

Seed values share no substring with one another (`hasText`/name matching is substring-based), and the
three efforts are invented rather than the measured vocabulary, per the sibling specs' rule.

No spec supplies an input production does not produce: every frame is a correlated reply to a request this
app actually sent, or an unprovoked `model_list` / `turn_state` the daemon really pushes. Only the timing
is the test's, and the timing is the defect.

**Not tested here:** the `PairedShell` dep-object glue, by the precedent `PairedShell.test.tsx` states —
it is reviewed rather than tested, and the e2e drive is its end-to-end proof.

## Open questions

1. Does the effort control need a published model list for B, or is the label absent purely on
   `effort === ''`? Read of `composerEffortMenuModel` says the latter — `effort === ''` returns `null`
   before the list is consulted — so B needs no `model_list` at all and the drive can withhold both of B's
   replies. To be confirmed by the drive going red with the clear deleted and green with it.
2. Whether the same-reference early-out is observable in the e2e tier. Expected not — it is a re-render
   count, not a rendering — so it stays a store-level assertion only.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings, and the change moves the boundary in the safe direction. Both stores
  hold daemon-authored values (`RunConfigSnapshot`'s `model`/`effort`/`permissionMode` are claude-authored
  strings, trusted in shape only) plus client-authored ones (`confirmed`). This ticket only *deletes* held
  values; it parses nothing, accepts no new input, and adds no code path that reads a wire field. The
  inbound boundary is unchanged and still sits at #1176's correlation gate in the session-settings reply
  path.
- **[Tokens, secrets, credentials]** Not applicable by construction, and stated rather than assumed:
  neither store has ever held a token, a key or a credential — `RunConfigSnapshot` is
  `{model, effort, yolo, permissionMode, usedTokens, windowTokens}` and the write store holds requested
  setting values. Nothing is written to disk, `localStorage` or `safeStorage` on this path.
- **[File / storage operations]** No findings — no filesystem access, no path construction, no persistence.
  Both stores are in-memory renderer state.
- **[Inter-process / Electron attack surface]** No findings, and this is the category the change most
  touches. It adds **no** IPC channel, no `contextBridge` member and no `ipcMain` handler; the new
  `clearRunConfig` dep member calls two `getState()` methods on renderer singletons and dereferences
  `window.pyry` nowhere, so `PairedShell.tsx` keeps its server-renderable invariant. The one adjacent
  member that does touch the bridge (`requestConversationConfig`) is unmodified.
- **[Cryptographic primitives]** Not applicable — no randomness, no comparison against a secret, no key
  or nonce handling. The one id minted anywhere near this path (`changeId`, `crypto.randomUUID` in
  `submitSettingsChange`) is untouched.
- **[Network & I/O]** No findings — nothing is sent, no socket, no timeout, no frame is constructed. The
  clear is strictly local. It does *not* cancel or abandon an in-flight `set_session_settings`: the
  envelope stays outstanding in main and its reply arrives to a cleared `pending`, where the existing
  fail-closed no-match arm drops it. That is the intended resolution and matches `reconnected`'s residual
  2, already accepted in the package overview.
- **[Error messages, logs, telemetry]** No findings — nothing new is logged, thrown or surfaced. Both
  clears are total and silent, which is the deliberate posture: a useful diagnostic would carry the
  conversation id and breach ADR 0007's content-free rule.
- **[Concurrency]** No findings. No async work, no timer, no listener, no `AbortController`, nothing
  long-lived to own or cancel. No check-then-act across an `await` — the helpers are fully synchronous, so
  the read of the active conversation and the writes that follow cannot interleave on the renderer's
  single thread. The one ordering constraint (clear before ask) is enforced by statement order inside one
  synchronous function.
- **[Threat model alignment]** The change is a **net reduction** in one desktop-specific exposure the
  ticket names indirectly and this review makes explicit. `RunConfigSections`' write controls address the
  session id, and both helpers already clear that so a YOLO / permission-mode write cannot be addressed to
  the chat the operator left. Until this ticket the *displayed* value those controls read was still the
  previous chat's — so the operator could read "yolo off, mode `default`" against a chat whose real
  posture was neither, and a stale confirmed override made that state permanent rather than one round trip
  long. Making the not-known rendering reachable means the controls say nothing rather than something
  false about a permission posture. Explicitly **out of scope**, named so the next ticket need not
  re-derive it: the announced running model is a third app-wide store on the same axis and remains #1146's;
  and an unpair still leaves the write store held, deferred by AC4 on the stated ground that no footer can
  read it before an open clears it.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-06
