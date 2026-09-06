# 1163 — the composer's Re-pair names its server, and the whole-collection unpair is deleted

## Files read

Production:

- `src/shared/ipc/unpair.ts` → `UNPAIR_CHANNEL`, `UNPAIR_SERVER_CHANNEL`, `UnpairResult`,
  `isUnpairServerRequest` — the two-channel contract. Its header is one of the four sites that
  describe this deletion under the parent's number (#1152), and it carries the rationale for keeping
  the two channels apart rather than merging them.
- `src/main/unpairHandler.ts` → `registerUnpairHandler`, `UnpairHandleTarget` (deleted here) and
  `registerUnpairServerHandler`, `UnpairServerHandleTarget` (untouched survivor). The header records
  that the whole-collection arm is "kept for its one remaining caller … until #1152 migrates it and
  deletes this half", and the listener holds the `hostLabel?.clear()` arm #1156 left standing for
  this ticket.
- `src/main/index.ts` → the `registerUnpairHandler` registration block beside `registerPairingHandler`
  and `registerUnpairServerHandler`. Its comment states the block is "now the NARROWER of two
  registrations" and names #1152 as its deleter.
- `src/preload/index.ts` → the `unpair` bridge method and its `UNPAIR_CHANNEL` import; `unpairServer`
  directly below it is the survivor and the shape the composer moves onto.
- `src/renderer/src/screens/conversation/unpairAction.ts` → `UnpairDeps`, `runUnpair`,
  `UNPAIR_FAILED_ERROR` — the composer's decision helper, and the module this ticket rewrites. Its
  `onUnpaired` is unconditional on `ok`, which is precisely what AC2 makes conditional.
- `src/renderer/src/screens/settings/unpairServerAction.ts` → `UnpairServerDeps`, `runUnpairServer` —
  #1162's sibling. Its header states the rule this ticket must honour on the Re-pair path (refresh the
  collection, flip only when the refreshed list is empty) and states *why* the two helpers are apart
  (`UnpairServerDeps` deliberately carries no `dispatch`). This is the module the composer's helper
  now delegates to.
- `src/renderer/src/screens/settings/ServerRow.tsx` → `ServerRowControl` — the shipped wiring of
  `runUnpairServer` (the `refreshServers` thunk, the `.then` that resets the phase). The composer's
  container mirrors its dep construction.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ComposerErrorSlotControl`,
  `ComposerErrorSlot`, `shouldOfferRepair` — the one remaining `runUnpair` caller. The control renders
  from `selectStatus` + `dispatch` only; `window.pyry` is dereferenced inside the handler, never during
  render, and that stays true here.
- `src/renderer/src/store/conversationListStore.ts` → `ServerConversationSummary.serverId`,
  `ConversationListOrigin`, `selectConversations` — the per-row server stamp this ticket derives the
  Re-pair target from. `ConversationListOrigin` is `string | null | undefined`, so a stamp is not
  necessarily a server id; the resolution must narrow it.
- `src/renderer/src/store/activeConversationStore.ts` → `activeConversationStore`,
  `selectActiveConversation` — which conversation the pane is showing.
- `src/renderer/src/store/conversationLastReadBridge.ts` → `conversationLastReadDeps` — the
  read-at-interaction-time idiom (`selectActiveConversation(activeConversationStore.getState())`) the
  container reuses instead of subscribing.
- `src/renderer/src/clearPairingScopedState.ts` → the thirteen-store set, including
  `clearAllConversations`. That membership is what makes "the surviving server's rows are still
  rendered" a valid detector for "the pairing-scoped clear did not run".
- `src/renderer/src/PairedShell.tsx` → `pairingChangeDeps`, `onUnpaired={() =>
  applyPairingChange(pairingChangeDeps, 'unpaired')}` — the callback `ConversationScreen` receives, and
  the one that must now fire only on the last server.

Tests and fixtures:

- `src/main/unpairHandler.test.ts` → the `registerUnpairHandler` describe (deleted) and the
  `registerUnpairServerHandler` describe (kept), whose first case already asserts the per-server
  registration never handles the whole-collection channel — the assertion AC3 retargets.
- `src/main/daemonConnection.test.ts` → `createDaemonConnection — teardown on unpair (#504)`, which
  composes the composition root's two wiring lines itself via `registerUnpairHandler`. It must move to
  the surviving handler or the #504 property loses its only test.
- `src/shared/ipc/unpair.test.ts`, `src/shared/ipc/attachmentUpload.test.ts` → the channel-string pin
  and the app-wide channel-collision set, both of which name `UNPAIR_CHANNEL`.
- `e2e/fixtures/launchPairedApp.ts` → `secondServer` control, `PairedServerHandle`, `FIRST_SERVER_ID` /
  `SECOND_SERVER_ID`, `SEEDED_ROW` / `SECOND_SEEDED_ROW`. Its header names this ticket's parent as the
  in-scope consumer of the per-server handles. With two servers the fixture finishes on the
  **ChannelList**, not a thread — the second pairing routes to the new server's list — so a two-server
  drive must click the first server's row itself.
- `e2e/settings-per-server-unpair.spec.ts` → #1162's drive. Source of the `.settings__server-row-id`
  array-form `toHaveText` identity assertion this spec reuses, and of the warning that the fixture's
  two ids are substrings of one another so no text filter may address a row.
- `e2e/unpair-repair.spec.ts` → the shipped single-server Re-pair drive, which stays as the
  last-server case.
- `docs/knowledge/features/unpair-channel.md` § Security posture, § Edge cases — records that the
  per-server arm's blast radius is a *reduction*, that the value-free `UnpairResult` collapses guard
  refusal / unknown id / failed erase deliberately, and that `clearServer` reports `error` over a
  corrupt collection where `clear()` did not. All three bear on this ticket's error handling.

## Design source

**Figma:** N/A — the ticket records N/A with justification. This slice is a caller migration plus a
deletion across the IPC bridge, the main process and the shared contract. The Re-pair control's
appearance, copy, class names and geometry are untouched; only the id it names and whether a route
transition follows change. Both destinations (the paired shell, the app-root pairing screen) are
already drawn and already shipped. #1162 took the same posture for the identical conditional-route
rule on the Settings row.

## Context

Since #1069 the paired-server store holds several records and since #1117 a live connection sits
behind each. The original unpair request erases the *whole* collection, so recovering server A's dead
connection today also forgets server B and drops its connection.

#1149 shipped the per-server answer alongside it as a Strangler Fig — its own channel, its own guard,
a `clearServer` that reports what it did — and migrated nothing. #1162 migrated the Settings rows onto
it through a new sibling helper, `runUnpairServer`, and deliberately left `runUnpair` and
`ConversationScreen` alone so this ticket would find no half-changed dep shape to unpick.

This is the final step: migrate the one remaining caller — the composer's Re-pair control — and delete
the old path. The deletion's scope was fixed by #1149's merged spec as "one channel constant, one
register function, one preload method, one registration block — not a refactor of a shared listener",
and #1156 added a fifth piece to it by leaving the whole-collection `hostLabel?.clear()` arm standing
inside the block being deleted.

**Two things this ticket does not do, both named by the ticket body.** It does not scope
`clearPairingScopedState` to the departed server (#1150) — on the surviving-server path this design
clears nothing at all, so #1150 is not needed to make AC2 correct. And it does not delete
`HostLabelStore.clear`'s interface member, which after this ticket has no production caller: that is
out of #1149's enumerated four, and three test object literals pin it, making its removal a tsc-only
cascade for a follow-up.

**A consequence worth stating rather than hiding.** After a Re-pair that leaves other servers paired,
the operator stays on the conversation screen of a server that is no longer paired, and that server's
rows stay in the sidebar until something clears them. That is #1150's territory exactly, and it is the
same gap #1162 accepted on the Settings path ("what this spec deliberately does not assert: the channel
list after the first unpair"). Nothing here narrows or widens it.

**No ADR.** This ticket ships no new decision — it executes a deletion three merged specs already
argued and applies a routing rule #1162 established.

## Design

### The renderer: one rule, two callers

The substance of AC2 is the remaining-count condition. #1162 put it in `runUnpairServer` because that
helper is the only caller that can know the count. Restating it in `runUnpair` would create two
implementations of one rule that could drift; the composer's helper therefore **delegates** to
`runUnpairServer` and adds the single thing that differs.

`unpairAction.ts` after this ticket:

```ts
export interface UnpairDeps extends UnpairServerDeps {
  dispatch: (action: SessionAction) => void
}

export function serverIdForOpenConversation(
  rows: readonly ServerConversationSummary[] | null,
  openConversationId: string | null
): string | null

export function runUnpair(deps: UnpairDeps, serverId: string | null): Promise<'ok' | 'error'>
```

- `runUnpair` short-circuits to the error path when `serverId` is `null` — dispatching
  `UNPAIR_FAILED_ERROR` **without calling `unpairServer` at all**, so an unresolvable server can never
  erase an arbitrary record. Otherwise it awaits `runUnpairServer(deps, serverId)` and dispatches
  `UNPAIR_FAILED_ERROR` on `'error'`.
- The ok-only fail-safe survives by inheritance: `runUnpairServer` already runs nothing downstream of a
  non-`ok` result, so `error` and a rejected invoke still mean no refresh, no route flip, no clear, and
  the operator stays on the conversation screen.
- `onUnpaired` is renamed to `onLastServerUnpaired` (inherited from `UnpairServerDeps`). The rename is
  the point: the name now states the condition AC2 is about.

**Why the widened dep bag does not undo #1162's type-level guarantee.** `UnpairServerDeps` still has no
`dispatch` member and `runUnpairServer`'s parameter is still typed against it, so its body has no name
by which a session-store write could be reached. `UnpairDeps` is a structural superset passed *into*
that parameter; TypeScript gives the callee only what its parameter type declares. The Settings path is
byte-identical and the guarantee is unchanged.

**Resolving the server the composer is looking at.** `serverIdForOpenConversation` is a pure function
over `conversationListStore`'s stamped rows: it selects the row whose `id` equals the open
conversation's and returns its `serverId` **only when that stamp is a string**.
`ConversationListOrigin` is `string | null | undefined`, so an unstamped row resolves to `null` and
takes the fail-safe path rather than naming nothing. It is not derived from `sessionStore`'s flat
`status`, which is documented as last-writer-wins across every connection and can therefore be
describing the other machine.

**It refuses an AMBIGUOUS match rather than taking the first** — `filter` and a length check, never
`find`. The conversation `id` it matches on is the *daemon's*, and the store holds every server's rows
in one flat list; `ChannelList` already keys rows by `c.id` alone, so two servers reporting the same
conversation id is a condition the app does not otherwise prevent. A `find` would then resolve to
whichever row was stamped first and Re-pair would forget a machine the operator is not looking at. The
capability is narrower than the whole-collection erase it replaces and the worst case is an
availability annoyance rather than a leak, but the refusal costs one comparison and turns a
wrong-server erase into a no-op that reports failure. The row's `serverId` **stamp** is client-bound
(`bindServerOrigin`, main-side) and is never the thing being matched on, so a daemon cannot supply the
id that gets erased — only make the lookup ambiguous, which this refuses.

It lives in `unpairAction.ts` rather than in `conversationListStore.ts`: one consumer is an import, two
is a home (`conversationLastReadBridge`'s own rule), and keeping it here puts every decision this
interaction makes in one pure, React-free module that a unit test can drive end to end.

**The container.** `ComposerErrorSlotControl.handleRepair` resolves the id at **interaction time**
through `getState()` — the `conversationLastReadDeps` / `downloadAttachment` idiom — rather than
subscribing to two more stores. The control's render footprint therefore stays exactly what it is
today (`selectStatus` + `dispatch`), and no store read is added to a render path. Its deps mirror
`ServerRowControl`'s: `window.pyry.unpairServer`, the same `loadServerInfo(window.pyry.serverInfo,
serverInfoStore.getState().setServers)` thunk (so the rendered Settings rows and the remaining-count
decision come from one read), and `onLastServerUnpaired: () => onUnpaired?.()` — the prop
`PairedShell` has already bound to `applyPairingChange(deps, 'unpaired')`.

`ConversationScreen`'s own `onUnpaired` prop keeps its name: it is App's route flip, and the shell,
not the screen, decides what a pairing change means.

### The deletion

Five sites, exactly the enumerated set plus #1156's arm:

1. `src/shared/ipc/unpair.ts` — `UNPAIR_CHANNEL` goes; the header's two-arm framing is rewritten to
   describe one channel that carries an untrusted `serverId`.
2. `src/main/unpairHandler.ts` — `registerUnpairHandler` and `UnpairHandleTarget` go, taking the
   `hostLabel?.clear()` arm (#1156's standing arm) and the `ClearablePairedServerStore` / `HostLabelStore`
   imports with them.
3. `src/main/index.ts` — the registration block, its `will-quit` unregister and its import specifier.
4. `src/preload/index.ts` — the `unpair` method and its `UNPAIR_CHANNEL` import. `PyryApi` is inferred
   from the `api` object, so `window.pyry.unpair` disappears from the renderer's type with it.
5. `src/renderer/.../unpairAction.ts` — the last caller, migrated as above.

`HostLabelStore.clear` and `ClearablePairedServerStore` keep their definitions; only this module's use
of them goes.

### State and concurrency

No new async task, no new subscription, no new timer, no new listener. The one long-lived effect on
this path is main-side and unchanged: `onUnpaired: () => registry.reconcile()` is already wired on the
per-server registration, re-reads the store and drops exactly the connection whose record went, leaving
every other connection live and un-handshaken.

Renderer-side the only await chain is `unpairServer → refreshServers`, both one-shot invokes owned by
the click that started them. `runUnpairServer` catches internally and never rejects, so the container
keeps firing it as a bare `void` with no `.then` — no confirm phase and no busy guard, for the reason
already recorded on this control: it appears only in an already-terminal error, and it self-hides on
both outcomes.

The check-then-act shape is worth naming: the id is read from the stores *before* the invoke and the
count *after* it. A conversation switch between those points would erase the server that was open when
the button was pressed, which is the truthful reading of the click and the same semantics
`ServerRowControl` has (it captures the row's id at click time). The count is read after the erase, from
main, so it cannot be stale in the direction that matters.

### Error handling

| Failure | Where classified | Result |
|---|---|---|
| No open conversation, no matching row, or an unstamped row | `runUnpair`, before any invoke | `dispatch failed`, nothing erased, stay put |
| Guard refusal / unknown id / `clearServer` throw / corrupt collection | main handler → `{ result: 'error' }` | `dispatch failed`, no refresh, no flip, stay put |
| Rejected invoke (bridge absent) | `runUnpairServer`'s catch | same as above |
| `ok`, other servers remain | `runUnpairServer` | no flip, no clear; refreshed Settings rows |
| `ok`, last server | `runUnpairServer` | `onLastServerUnpaired` → `applyPairingChange('unpaired')` → clear + route |

`UnpairResult` stays value-free and the per-server channel is unchanged. The renderer's user-facing
error stays the existing synthesized `UNPAIR_FAILED_ERROR` (`code: 'unpair'`), which
`shouldOfferRepair` excludes — so a failed Re-pair shows the plain chip rather than an infinitely
re-clickable button. Nothing on this path is logged, main-side or renderer-side.

### Testing strategy

**Unit (vitest).**

- `unpairAction.test.ts`, rewritten around the new shape: ok with an empty refreshed list flips once
  and dispatches nothing; **ok with one server left does not flip and dispatches nothing** (AC2's
  assertion); `error` and a rejected invoke each dispatch exactly one `failed` with `code: 'unpair'`,
  refresh nothing and never flip; a `null` serverId dispatches `failed` and never calls
  `unpairServer`; the id reaches `unpairServer` verbatim.
- `serverIdForOpenConversation`: picks the stamp of the matching row across a two-server list; `null`
  for no open conversation, an unloaded list, an id matching no row, a row whose stamp is not a
  string, and — the security-review finding — **two rows on different servers sharing the open
  conversation's id**, which must resolve to `null` rather than to either server.
- `unpairHandler.test.ts`: the whole-collection describe is deleted; the surviving describe's
  registration case keeps asserting that the per-server handler never handles `'pyry:unpair'`, now
  against the literal rather than a constant that no longer exists (AC3).
- `unpair.test.ts`: pins that the contract module exports no value equal to `'pyry:unpair'` — an
  export-set walk, so a re-added constant under any name reddens it (AC3).
- `attachmentUpload.test.ts`: the app-wide collision set names `UNPAIR_SERVER_CHANNEL` in place of the
  deleted constant, so the surviving unpair channel stays inside the guard.
- `daemonConnection.test.ts`: #504's teardown-on-unpair describe is re-composed against
  `registerUnpairServerHandler`, preserving the property (an authenticated session cannot outlive the
  record that authorised it) on the surviving path.

**Playwright, fake tier (`e2e/unpair-repair.spec.ts`).** Nothing in this repo can click and renderer
specs are static server renders, so AC1 and AC2's two-server behaviour are only provable here. The
existing single-server drive is unchanged and becomes the last-server case. A second test opts into
`secondServer`, clicks the first server's row by name (the two seeded names share no substring, per the
fixture's own warning), drives `forwarder.closeClientLeg(4401)` on server A only, clicks Re-pair, and
then:

- opens Settings and asserts `.settings__server-row-id` reads exactly `[SECOND_SERVER_ID]` — the
  array-form identity assertion #1162 established, and the **positive, auto-waiting** proof that the
  erase completed and named the right server (AC1);
- asserts the app-root pairing box has count 0 — meaningful only *after* the positive proof above, and
  the AC2 negative;
- returns from Settings and asserts the second server's seeded row is still in the channel list —
  `clearAllConversations` is one of the thirteen pairing-scoped clears and server B's connection sees
  no `connected` rising edge to re-fetch on, so a row that is still there is a clear that never ran.

AC4 needs no new e2e: the whole-collection label erase is deleted with its listener, and #1156's
existing per-server tests already pin that `clearFor` names exactly the unpaired server.

## Open questions

1. **Does the Settings screen keep the sidebar mounted?** It decides whether the "server B's rows
   survived" assertion can be made from the Settings route or needs a return step. Resolved in Phase B
   by reading the shipped navigation; the plan assumes a return step, which is correct either way.
2. **Shape of `daemonConnection.test.ts`'s `unpairable()` fake** under a `clearServer` dep — it must
   report `{ matched: true, remaining: 0 }` and null the record. Mechanical; resolved while editing.
3. **Does `PyryApi` need an explicit edit** or is it wholly inferred from the `api` literal? The
   `index.d.ts` re-export suggests inference; confirmed in Phase B by the build.

Each is recorded in `## Revisions` if its resolution changes the design above.

## Revisions

**2026-09-06 — Open questions resolved.**

1. **The Settings screen replaces the whole shell**, sidebar included (`PairedShell`'s `settings` case
   returns a bare `SettingsScreen`, where `list`/`thread` return the two-pane `paired-shell`). So the
   e2e drive needs the return step the plan assumed: `.settings__back` is clicked before the
   surviving server's channel row is read back. No design change.
2. **`daemonConnection.test.ts`'s `unpairable()` fake** now supplies `Pick<MultiPairedServerStore,
   'clearServer'>` and nulls the record on a matching id, reporting `{ matched: true, remaining: 0 }`
   (and `matched: false` for any other id, so the fixture cannot silently erase on a wrong name). The
   #504 property it proves is unchanged. Mechanical, as expected.
3. **`PyryApi` is wholly inferred** from the `api` object literal, so deleting the `unpair` method
   removed `window.pyry.unpair` from the renderer's type with no separate declaration to edit. The
   build confirms it.

**2026-09-06 — Four comment-only production edits beyond the plan's five deletion sites.** Deleting
the whole-collection arm falsified claims made about it elsewhere, and a comment asserting a caller
that no longer exists is the failure mode the citation discipline exists to prevent. None of these
changes behaviour:

- `src/main/hostLabelStore.ts` — its header said "`clear` keeps its caller — the whole-collection
  unpair arm", and the `clear` body repeated it. `clear` now has **no production caller**; both notes
  say so, and record why the member itself is deliberately not removed here (out of #1149's
  enumerated four; three test object literals pin it, so removal is a tsc-only cascade for a
  follow-up).
- `src/main/index.ts` — the host-label seam comment enumerated "four seams, four disjoint `Pick`s"
  over that store. There are three.
- `src/renderer/src/applyPairingChange.ts` — its `'unpaired'` member doc said the condition applies to
  #1162's caller alone and that `runUnpair` reaches the member on `ok`. Both paths now carry the
  condition, from one copy of the rule.
- `src/renderer/src/PairedShell.tsx` — the `onUnpaired` wiring comment restated the same ok-only
  posture without the remaining-count half.

**2026-09-06 — `rowName` in the e2e spec.** `ConversationSummary.name` is `string | null`, and no
tsconfig includes `e2e/` while Playwright strips types with esbuild, so a `hasText: SEEDED_ROW.name`
type error would have surfaced in no gate at all (caught by an ad-hoc `tsc --noEmit` run by hand). It
is narrowed by a throwing helper rather than `?? ''`: an empty `hasText` matches every row, so a null
seed name would have silently selected both servers' rows — the exact ambiguity the fixture's
non-overlapping seed names exist to prevent.

**2026-09-06 — the new e2e assertion was mutation-checked.** Reverting `runUnpair` to the
pre-#1163 unconditional flip (calling `onLastServerUnpaired` on every `ok`) reddens the two-server
test: the app routes to the pairing screen, `PairedShell` unmounts, and the Settings button detaches
mid-click. The single-server test stays green, correctly — it is the last-server case.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] MUST FIX — addressed in the design above before this plan was committed.**
  The composer resolves the server to erase by matching the open conversation's `id` — a
  *daemon-supplied* value — against a flat list holding every server's rows. A `find` would resolve an
  id collision across two servers to whichever row was stamped first, so a confused or hostile daemon
  on server B could steer a Re-pair pressed on server A into forgetting B. The design now refuses an
  ambiguous match (`filter` + length check → `null` → the fail-safe error path, nothing erased). Note
  what is *not* attacker-controlled: the `serverId` returned is the row's **stamp**, bound main-side by
  `bindServerOrigin` from the connection the event arrived on, never a wire field — so the worst a
  daemon can do is make the lookup ambiguous, which now erases nothing. The main-side boundary is
  unchanged and remains explicit: `isUnpairServerRequest`, the per-server listener's first statement,
  applied before any store call.
- **[Tokens, secrets, credentials] No findings — this ticket is a net reduction.** Nothing on this path
  generates, reads, stores or transmits a credential. Deleting `registerUnpairHandler` removes the one
  handler whose store dep (`ClearablePairedServerStore`) *inherited* `load` and could therefore
  materialise a `PairedServerRecord` — bearer `token`, `server_static_pubkey` — with only a test
  pinning its non-use. The surviving `Pick<MultiPairedServerStore, 'clearServer'>` denies that name at
  the type level. `UnpairResult` stays value-free by construction, so no detail crosses back. Erase
  granularity moves from all-or-nothing to per-device, which is the finer half of the lifecycle
  question, and the device static keypair is under a distinct store name and structurally untouched.
- **[File / storage operations] No findings, and one recovery path retires with the handler — argued,
  not deferred.** No path is constructed anywhere on this route: `serverId` is only ever compared with
  `===` against each decoded record's own `server` field inside `clearServer`/`clearFor`, so an id like
  `__proto__` stays inert, and the deleted arm's `hostLabel.clear()` deleted by its own module-owned
  name constant. The consequence worth naming is that `unpair-channel.md` records **two** recovery
  paths over a collection `pairedServerStore` cannot parse — `clear()` (never reads, always succeeds)
  and re-pairing (`save` overwrites) — and this ticket deletes the first. Recovery survives intact
  because `decodeCollection` treats a malformed collection as absent, so `pairingStatus` answers *not
  paired*, App routes to the pairing screen, and re-pairing is reachable with no unpair needed at all.
  No mitigation is built for a state the app already presents as unpaired.
- **[Inter-process / Electron attack surface] No findings — the surface shrinks.** One
  `contextBridge` method and one `ipcMain.handle` channel are removed and none added; no
  `webPreferences`, protocol handler, navigation guard or window-open policy is touched, and no key,
  socket or Noise code moves toward the renderer. After the deletion an invoke on `'pyry:unpair'`
  reaches no handler and rejects, and the renderer has no bridge method naming it — `ipcRenderer` never
  crosses the bridge. AC3's two tests pin both halves (no exported constant carries the string; the
  surviving registration never handles it). A compromised renderer's remaining capability is strictly
  narrower than what it had: "erase one named, guarded, length-bounded record" in place of "erase every
  record", against a listener that has no name for the whole-collection erase at all.
- **[Cryptographic primitives] Not applicable, by design.** No RNG, no hashing, no key derivation, no
  AEAD, no handshake code is added, moved or read. The `===` compares are on a server id, which is a
  non-secret identifier the renderer can already read back from the `serverInfo` channel, so
  `timingSafeEqual` would guard nothing; no secret is compared anywhere on this path.
- **[Network & I/O] No findings.** No socket, no URL, no TLS decision, no frame parsing. The only new
  I/O is the `serverInfo` invoke `refreshServers` already performs on the Settings path, reused
  verbatim so the rendered rows and the remaining-count decision cannot disagree. It carries no
  deadline of its own: a hung invoke would leave a completed erase without its route flip, which is
  pre-existing on the Settings path, has never been observed, and fails toward *staying in the shell*
  rather than toward a wrongly cleared one. Not instrumented — ADR 0007's content-free rule forbids the
  ids that would make a diagnostic useful here.
- **[Error messages, logs, telemetry] No findings.** Both handler modules stay log-free by
  construction and this ticket adds no `console.*` on either side of the bridge; the untrusted
  `serverId` reaches no log line, no error message and no thrown value. The renderer's user-facing
  error is the pre-existing client-owned `UNPAIR_FAILED_ERROR` constant, whose `message` no surface
  reads — and `shouldOfferRepair` excludes `code: 'unpair'`, so a failed Re-pair degrades to the plain
  chip rather than an endlessly re-armable button. Every collapsed failure (guard refusal, unknown id,
  failed erase, unresolvable server) presents identically, which is the same deliberate
  indistinguishability #1149 argued for the wire result.
- **[Concurrency] No findings; two shapes named rather than left implicit.** No long-lived task,
  timer, listener or subscription is added — the only await chain is `unpairServer → refreshServers`,
  both one-shot invokes owned by the click that started them, and `runUnpairServer` catches internally
  so the container's bare `void` cannot produce an unhandled rejection. (1) *Check-then-act:* the id is
  read from the stores before the invoke and the count from main after it; a conversation switch in the
  gap erases the server that was open when the button was pressed, which is the truthful reading of the
  click and matches `ServerRowControl`'s capture-at-click semantics. (2) *No busy guard,* deliberately
  inherited: a double click's second erase reports `matched: false` → `error` → one dispatch, and on the
  last-server path the first `ok` unmounts the shell, so no double flip and no double clear is
  reachable. Main-side teardown is the already-wired `registry.reconcile()`, which drops exactly the
  connection whose record went.
- **[Threat model alignment] Addressed.** *Hostile daemon response* is the finding in the first bullet,
  now closed by the ambiguity refusal plus the client-bound stamp. *Renderer compromise reaching the
  transport* is strictly reduced (see Electron attack surface). *Token theft from disk* is unchanged —
  this path only ever deletes records, never reads or writes one. *Malicious relay* does not apply: no
  frame is sent or parsed here. **OUT OF SCOPE, named:** scoping `clearPairingScopedState` to the
  departed server is #1150, so after a Re-pair that leaves other servers paired the unpaired server's
  rows stay rendered until something clears them — a stale-display gap, carrying no credential and no
  live connection (`reconcile()` drops it), and the identical gap #1162 accepted on the Settings path.
  Deleting `HostLabelStore.clear`'s now-callerless interface member is likewise deferred, with its cost
  measured in the ticket body (three test object literals, a tsc-only cascade).

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-06
