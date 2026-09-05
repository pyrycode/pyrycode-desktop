# #1061 — hide the Unpair control above the thread

## Files read

Codegraph is not initialised in this repo (`codegraph_status` has failed on every prior run here), so the
reading list below was built with Grep + Read rather than `codegraph_context`. Noted as the gap it is.

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `UnpairControl` (the component to
  delete, the last function in the file), its mount inside `ConversationScreen`'s returned tree, the
  in-file map comment above `selectNothingHeld` that lists it, and the `ConnectionBannerControl` JSX
  comment that positions the banner "below the header row".
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ComposerErrorSlotControl` — the
  **surviving** `runUnpair` caller. It is what keeps the `onUnpaired` prop, `runUnpair`'s import, and
  `window.pyry.unpair` alive after the deletion; nothing about it changes.
- `src/renderer/src/screens/conversation/conversation.css` → `.conversation__header`,
  `.conversation__unpair-prompt`, `.conversation__unpair` (+ `:hover` / `:focus-visible` / `:disabled`)
  and `.conversation__unpair--confirm` — the two non-contiguous blocks to delete.
- `src/renderer/src/screens/conversation/conversation.css` → `.conversation__banner`,
  `.conversation__workspace-chip-change`, `.status-sheet__close`, `.question-panel__label--tab` — four
  surviving rules whose comments cite the deleted row or the deleted recipe.
- `src/renderer/src/screens/conversation/conversation.css` → `.conversation__back` family — **read only
  to stay off it.** It sits between the two blocks being deleted and belongs to #1064.
- `src/renderer/src/screens/conversation/unpairAction.ts` → `runUnpair`, `UnpairDeps` — read to confirm
  the deletion cannot reach it. Byte-unchanged by this ticket (AC3).
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → the `#166` unpair-trigger test
  (dies), the banner-order test (title + comment corrected), and the `ThreadOverflowMenuView` describe's
  header comment (cites `UnpairControl`'s phase transitions as a live example).
- `e2e/unpair-repair.spec.ts` → its file preamble and its two tests. The first loses its subject; the
  second (`re-pair`) is the AC3 regression proof and is untouched.
- `e2e/composer-actions.spec.ts` → the outside-click test's parenthetical "(The header is avoided: its
  only control is Unpair.)".
- `docs/knowledge/features/conversation-shell-chrome.md` → the tree diagram, `## Unpair control (#166)`,
  and the "a future top-app-bar ticket consolidates back + title + overflow + unpair" promise. **Read,
  not written** — the documentation phase owns it. Its promise is stale in two ways and the ticket body
  records why; this plan does not restate that argument in code.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=106-3321

Read via `get_metadata` + `get_screenshot`. The chat screen's `Content` frame is 820×1262 and has
exactly three children: `Message area` (132:4171) at **y = 20**, `Input area` (347:5408) at y = 1126,
and the floating `Options overlay` (121:3879). The message area therefore starts at the frame's own top
inset — there is no header row, no leading affordance, and no trailing control above it of any kind. The
reference is an absence, and that absence is the whole design authority for this ticket.

This ticket draws nothing new: no token, no component, no asset. The screenshot is the negative control
against which the rendered pane is compared — the thread must start where the Unpair row used to.

## Context

`UnpairControl` shipped in #166 as "the minimal unpair escape hatch — a slim header row above the
thread, the seed of the future top app bar". The bar it seeded was never drawn, and the desktop drawing
above says it never will be in this shape: the chat pane's Content frame stacks a message area straight
onto an input area. The row is mobile-era chrome, the same class of residue as `ThreadOverflowMenu`
beside it, which is already marked in-file as awaiting retirement.

Operator call, 2026-09-04: stop drawing it. **This removes the only way to unpair a healthy pairing** —
the composer status row's Re-pair button is the one surviving `runUnpair` caller and is reachable only
on a terminal pairing error. The operator ruled on that consequence in the same pass: hide it now, accept
the gap, and let the successor land later on a host-level surface (unpair is host-scoped, not
conversation-scoped, so the conversation-scoped Channel info sheet is the wrong home for it) to be
settled with #1070. **No replacement entry point is built here**, and this ticket does not wait for one.

The pane is header-less between this ticket and the ticket that draws the desktop header carrying a
channel title and a channel settings button. That is a temporary state, not a design principle — so no
comment or doc this ticket writes may say "the chat pane has no header".

**No ADR is warranted.** This is the execution of an operator ruling already recorded on the ticket, not
a new architectural decision.

## Design

A deletion in three files plus a comment tail. No new module, no new type, no new state, no logic change.

### 1. `ConversationScreen.tsx`

- **Delete the `UnpairControl` function outright** — the whole declaration and its `#166` doc comment,
  the last thing in the file. Not gated, not hidden, not left exported. This repo already carries one
  retired-but-mounted-nowhere component (`MessageBubble`) and pays for it in every ticket that has to
  reason about which call sites a CSS change reaches; a second is not added. Git keeps the code if the
  drawn header wants the phase machine back.
- **Delete its mount** — the `<UnpairControl onUnpaired={onUnpaired} />` element between
  `ThreadOverflowMenu`'s gated block and `ConnectionBannerControl`. Nothing else in that region moves:
  `BackControl`, `ThreadOverflowMenu`, `ConnectionBannerControl` and `WorkspaceChip` keep their present
  order, and the banner simply becomes the first thing under the overflow menu's gate.
- **Keep the `onUnpaired` prop, its doc comment, the `runUnpair` import and `ComposerErrorSlotControl`
  untouched.** The prop has a second consumer — the composer status row's error slot — so the deletion
  cannot orphan it. This is the AC3 seam and it is deliberately not tidied.
- **Two comment corrections in this file** (AC5), both citing the deleted row:
  - the in-file structure comment above `selectNothingHeld`, whose last sentence reads "Composer and
    UnpairControl stay in-file";
  - the JSX comment above `ConnectionBannerControl`, which places the banner "below the header row".
    Restated as "the top of the thread, above the message list" — a phrasing that survives #1064's
    removal of the back arrow as well, and that does not assert the pane is permanently header-less.

### 2. `conversation.css`

Two non-contiguous blocks are deleted, and the gap between them is left alone:

| Block | Contents | Action |
|---|---|---|
| the `.conversation__header` comment + rule | the slim row itself | delete |
| the `.conversation__back` family | #1064's back arrow, incl. its "before the unpair header" comment | **do not touch** — #1064 deletes the whole comment, so re-pointing it here would be churn on a line that is about to disappear |
| `.conversation__unpair-prompt`, `.conversation__unpair` + its three arms, `.conversation__unpair--confirm` | the control's own recipe | delete |

Four surviving rules' comments cite what is being deleted and are re-pointed or restated in place — the
reasoning is preserved, only the dead reference goes. (#780's `.bubble__markdown pre` deletion stranded
four such comments in this same file; that is the failure this AC exists to refuse.)

- `.conversation__banner` — "below the header row, above the message list" → the same restatement used
  in the TSX comment.
- `.conversation__workspace-chip-change` — cites "the `.conversation__unpair` posture". This rule is a
  full copy of that recipe, so after the deletion it *is* the surviving carrier: the posture is
  **restated inline** rather than pointed anywhere.
- `.status-sheet__close` — "mirroring the unpair control / send-button treatment". Re-pointed at the
  send button alone, which survives. Deliberately **not** re-pointed at `.conversation__back`, whose
  hover is the other match: #1064 deletes it, and a re-point at a rule that dies next week is a dead
  reference with a delay.
- `.question-panel__label--tab` — "The `.conversation__unpair` recipe minus its pill". Re-pointed at
  `.conversation__workspace-chip-change`, which now carries the pill form of the same recipe, so the
  "minus its pill" contrast still names something real.

### 3. Comment corrections outside the two production files

- `ConversationScreen.test.tsx` — the `ThreadOverflowMenuView` describe's header cites "UnpairControl's
  phase transitions" as its example of untested reviewed glue. Re-pointed at `Composer.handleKeyDown`,
  which the same sentence already names and which survives.
- `e2e/composer-actions.spec.ts` — "(The header is avoided: its only control is Unpair.)" justified the
  choice of `.conversation__empty-copy` as the outside-click target. The click target is unaffected and
  the test passes as-is; only the sentence is stale, and it is restated as the positive reason (the
  thread's inert copy is genuinely outside the anchor) rather than as an avoidance of a row that no
  longer exists.

**`unpairAction.ts` is left byte-unchanged**, including its header sentence "UnpairControl is thin glue
over this". AC3 states the file is untouched, and that is the more specific instruction; AC5's scope
words are "a rule or a row". Flagging the tension rather than resolving it silently: the sentence does
become a dead reference, and the documentation phase or the successor ticket is where it gets rewritten.

## State + concurrency model

Nothing to model. The deleted `useState<'idle' | 'confirming' | 'unpairing'>` phase machine was
screen-local and ephemeral (ADR 0006); it owned no subscription, no timer, no async task and no listener,
so there is no teardown path to re-home. `runUnpair`'s promise was `void`-ed with a `.then` that only
re-armed the idle phase — deleting the caller deletes the promise with it, leaving nothing floating.

No store slice, selector, or subscription changes. `useSessionStore((s) => s.dispatch)` was read inside
the deleted component; every other reader of that store is untouched, so no component's re-render
behaviour changes. The surviving `runUnpair` caller is `ComposerErrorSlotControl`, which subscribes on
its own and is not edited.

## Error handling

No failure modes are added, removed, or reclassified. The deleted control's only error branch was
"`runUnpair` resolved `error` → set the phase back to `idle`", which is UI-local re-arming, not an error
path: the IPC error itself is handled inside `runUnpair` (it dispatches `UNPAIR_FAILED_ERROR` with
`code: 'unpair'` and never rejects), and that is unchanged. `composerSend`'s `shouldOfferRepair` still
excludes `code !== 'unpair'`, so a failed unpair still does not masquerade as an offer to re-pair.

No new IPC, no new logging, and no log call is deleted (the control emitted none).

## Testing strategy

RED first in both tiers, by deleting assertions that currently pass and adding one that currently fails.

**vitest — `ConversationScreen.test.tsx`:**

- **Delete** `it('renders the unpair trigger (its accessible text is present in the idle-phase markup)')`
  together with its `#166` comment block. Its subject is gone.
- **Add** one negative in its place, over a bare `renderToStaticMarkup(<ConversationScreen />)`:
  `.conversation__header` absent, `>Unpair</button>` absent, `Forget this pairing?` absent. The first
  two are the **reddening detectors** — both strings are in today's markup, so the test fails against
  unmodified `main` and passes only once the component is gone. The third can never redden through this
  route (the confirm phase is unreachable under server render, where zustand reports its initial
  snapshot and no click fires), and its comment says so: it is a guard against a future re-introduction,
  not the proof of AC2. **AC2's actual proof is structural** — the component is deleted rather than
  gated, so no phase of it exists to reach, which is why the ticket forbids leaving it mounted-and-hidden.
- **Correct, do not delete,** `it('renders the banner above the message thread and below the header (top
  of the thread)')`. Its assertion (banner index < empty-state index) still holds and still means
  something; only the title's "below the header" and the comment's "between UnpairControl (the header
  row) and the timeline surface" go stale.

**Playwright — `e2e/unpair-repair.spec.ts`:**

- **Delete** the first test (`unpair: Cancel keeps the session, then Confirm returns to the app-root
  pairing screen`) — deleted, not skipped, because its control no longer ships. With it goes the
  preamble paragraph explaining how the three same-class `conversation__unpair` buttons are
  disambiguated by accessible name, which describes a class that no longer exists.
- **Keep the spec and its second test byte-unchanged.** The `re-pair` test is AC3's regression proof:
  the exit path back to the app-root pairing screen still has coverage through it, which is the property
  the spec exists to protect ("a routing regression could strand the operator on a dead thread"). The
  file preamble is rewritten to describe **one** affordance rather than two.
- No new e2e spec. The absence of a control is not something the fake tier can assert more strongly than
  the renderer negative above already does, and this ticket adds no interaction to drive.

**Gate:** `npm test` scoped to `ConversationScreen.test.tsx`, `npm run build`, and
`npx playwright test e2e/unpair-repair.spec.ts` — that last one because the spec is edited and its
surviving half is the AC3 proof. The full suites are the verifier's gate.

## Open questions

1. **Does deleting `UnpairControl` orphan any import or prop?** — resolved during Phase A by reading
   `ComposerErrorSlotControl`: `runUnpair`, `onUnpaired` and `window.pyry.unpair` all keep exactly one
   renderer consumer. `npm run build` is the confirming check for `useState` / `useSessionStore`, both of
   which have many other readers in the file.
2. **Which surviving rule carries the de-emphasized text-button posture?** — resolved above:
   `.conversation__workspace-chip-change`, which is a full copy of the recipe. The re-points deliberately
   avoid `.conversation__back`, which #1064 removes.
3. **Does `conversation.css`'s "before the unpair header" comment need re-pointing?** — resolved: no.
   #1064 deletes that whole comment block, and touching it here would put this ticket inside #1064's
   diff for no gain.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] No findings.** The renderer→main boundary this ticket touches is the
  `UNPAIR_CHANNEL` invoke, and the change is strictly subtractive: one of two renderer call sites is
  removed and the surviving one (`ComposerErrorSlotControl`, via `runUnpair`) is unedited. No new data
  crosses any boundary, and no parse, cast, or validation is added or relaxed. The channel's own
  contract in `src/shared/ipc/unpair.ts` — a zero-argument request whose granted ability is "trigger an
  unpair", never "read a secret", which is why it ships no request guard — is unchanged and is not
  widened by deleting a caller.
- **[Tokens, secrets, credentials] OUT OF SCOPE — and it is the substantive finding of this pass.**
  Removing the only affordance that unpairs a *healthy* pairing removes the user's ability to
  proactively revoke the stored device token from inside the app: after this ticket the token can be
  replaced (Settings' `Pair another server`) or erased on a terminal error (Re-pair), but a working
  pairing cannot be forgotten. That is a real reduction in user-initiated revocation, not a cosmetic
  one. It is an **explicit operator ruling** (Juhana, 2026-09-04: hide it now, accept the gap), the
  ticket body forbids building a replacement here, and the successor lands on a host-level surface —
  unpair is host-scoped, so the conversation-scoped Channel info sheet is the wrong home — to be settled
  with **#1070**. The erase mechanism itself (`unpairHandler`'s record-first `clear()` over the
  `safeStorage`-backed store, plus the `onUnpaired` teardown) is untouched and still correct; only the
  entry point to it narrows.
- **[File / storage operations] Not applicable by construction.** This ticket deletes JSX and CSS. It
  opens no path, reads no file, and writes none; `unpairHandler`'s erase and its atomicity argument are
  outside the diff.
- **[Inter-process / Electron attack surface] No findings.** No `webPreferences`, no `contextBridge`
  addition, no new `ipcMain` channel, no protocol handler, no navigation guard is touched. The preload's
  `unpair` bridge stays exposed and stays minimal (no arguments, no return payload beyond an
  `ok`/`error` discriminant) and retains a live renderer caller, so this ticket creates no
  caller-less-but-exposed capability. Deleting renderer-side triggers strictly narrows the renderer's
  reach; it cannot widen it.
- **[Cryptographic primitives] Not applicable.** No key, nonce, RNG, comparison, or handshake code is in
  the diff. The Noise variant constant is untouched.
- **[Network & I/O] Not applicable.** No socket, no relay URL, no frame cap, no timeout, no reconnect
  policy is touched. Note that `onUnpaired: () => connection.reconnect()` in the main composition root —
  the teardown that follows a successful erase — is unchanged and still fires from the surviving path.
- **[Error messages, logs, telemetry] No findings.** Every string deleted (`Unpair`, `Forget this
  pairing?`, `Cancel`, `Confirm`, `Forgetting…`) is a client-owned constant; no daemon text, token, key,
  payload, or path was rendered by the deleted subtree, and it emitted no log call. This ticket adds no
  `console.*` and no logger call, so the affected modules stay log-free by construction.
- **[Concurrency] No findings, and the one plausible regression was checked rather than assumed.** The
  deleted phase machine carried a double-click guard (`unpairing` disables both buttons so a second
  `runUnpair` cannot launch). Deleting it does **not** leave the surviving caller unguarded, because
  `ComposerErrorSlotControl` never had that guard: #167 shipped it deliberately with no confirm phase
  and no busy guard, resting on `clear()` being idempotent and on `runUnpair` catching internally and
  never rejecting. So the guard dies with the only control that needed it, and no new check-then-act
  race, listener leak, timer, or teardown path is created. Nothing long-lived is started or abandoned.
- **[Threat model alignment] No findings on the wire-protocol threats; one named consequence.** Hostile
  relay, hostile daemon response, and renderer-compromise-reaching-the-transport are all unaffected —
  the deletion touches no parse and no transport, and moves nothing into the renderer. Token theft from
  disk is unchanged in mechanism (`safeStorage`, OS-keychain-backed) and changed only in the user's
  remediation options, which is the `[Tokens]` finding above, deferred to #1070 by operator ruling.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-05

## Revisions

### 2026-09-05 — a third production file joined the diff (AC5)

The plan's file list named two production files. Implementation found a **third** live citation of the
deleted component that the Phase-A sweep missed, because it lives outside the conversation package and
outside every string the ticket body sends you to grep: `ChannelList`'s container doc comment cites "the
`Composer.handleSubmit` / `UnpairControl` discipline" as its precedent for dereferencing `window.pyry`
only inside a click arrow. AC5 ("no surviving comment in `src/` or `e2e/` cites a rule or a row this
ticket deleted as though it still exists") reaches it, so it is corrected in place — re-pointed at
`Composer.handleSubmit`, which survives and makes the same point on its own.

`src/renderer/src/screens/channels/ChannelList.tsx` is therefore a comment-only edit in this diff: no
markup, no logic, no class. Three production files is still inside the size-S boundary of five, and no
other line of the table moves.

The sweep that found it was `conversation__unpair|conversation__header|UnpairControl` across
`{src,e2e}/**/*.{ts,tsx,css}` with no package filter — worth recording as the shape of sweep this AC
needs, since the ticket body's three named CSS comments and one named test are a subset of the real set.
