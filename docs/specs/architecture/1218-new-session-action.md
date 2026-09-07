# #1218 — a New session action restarts the open chat's claude

## Files read

- `src/renderer/src/screens/conversation/ComposerActionsMenu.tsx` → `COMPOSER_ACTIONS`,
  `ComposerActionsMenuView`, `ComposerActionsMenu` — the entry array, the pure view, the store-bound
  container. Its header carries the standing "THE ID IS THE COMMAND … Do NOT add a `command` field, a
  lookup or a ComposerActionId union" instruction this ticket overrides in writing.
- `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx` → `ComposerOptionsPanelOption`,
  `ComposerOptionsPanel`, `ComposerOptionsMenu`, `COMPOSER_OPTIONS_UNAVAILABLE_NOTE` — the row type
  shared by four menus (one visible field, no description — the #934 product decision), and
  `ComposerOptionsMenu.select`, the single activation gate both the click and the Enter path funnel
  through.
- `src/renderer/src/screens/conversation/composerActionAvailability.ts` → `markUnavailableActions`,
  `slashCommandMenuProvesAbsence`, `isPublished` — the grey-out decision. `isPublished` strips ONE
  leading slash and matches a published `name` or alias exactly, so a non-slash client id can never
  match anything: that is why AC3's failure mode ships looking correct if the new entry is ever handed
  to this function.
- `src/renderer/src/screens/conversation/composerActionAvailability.test.ts` → the empty-published-menu
  case, which asserts that a complete-but-empty list marks **every** `COMPOSER_ACTIONS` id. The ticket
  names it as the one that must not simply be updated; this design leaves it untouched and still true.
- `src/renderer/src/screens/conversation/sendInterrupt.ts` → `sendInterrupt` — the guarded
  fire-and-forget send shape: injected `sendCommand`, no optimistic dispatch, a bridge failure swallowed
  to `console.error`.
- `src/renderer/src/screens/conversation/composerSend.ts` → `submitMessage` — the house precedent for a
  `string | null` conversation id: return early, send nothing, post no echo.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `Composer`'s `sendText`,
  `activeConversationId`, and the `.composer__footer` row that mounts `ComposerActionsMenu`.
- `src/shared/ipc/commands.ts` → `newSessionCommand`, `NewSessionCommandPayload`,
  `isNewSessionPayload` — the command constructor, the `Required<NewSessionPayload>` tightening, and
  the one boundary guard in the file that rejects an empty `conversation_id`, with the reason.
- `src/main/index.ts` → the `newSession` arm of the renderer-command switch — routed by conversation id
  through `router.route`, inert when nothing is connected, no reply awaited.
- `src/main/transport/newSessionEnvelope.ts` → `buildNewSession` — a fresh one-field literal; the wire
  meaning of an absent or empty id (the daemon's process-wide follow-active cursor).
- `docs/knowledge/features/conversation-shell-actions-menu-and-reader-cutover.md` § "Grey-out for an
  absent command (#681)" — the correction that `Reset session` is only a display label and never
  participates in matching, and the reason absence is provable only from a complete list. It is why
  this plan keeps the new row out of the matching path rather than trying to make it match.
- `docs/knowledge/features/conversation-shell-composer-options-panel.md` — the shared surface's
  contract: one visible field per row, `unavailable` optional so four consumers' markup does not move.
- `e2e/composer-actions.spec.ts` → `ROW_LABELS`, `captureOutbound` — the row-label array asserted with
  `toHaveText`, and the decode-and-capture fake-daemon script this ticket's new spec mirrors.
- `e2e/composer-actions-unavailable.spec.ts` → its `toHaveCount(3)` on rendered menu items.
- `e2e/thread-shadow.spec.ts` → `sessionTransitionFrame` — the fake-tier precedent for pushing one
  `session_transition` and counting one `.session-delimiter`.
- `e2e/real-claude-interrupt.spec.ts` → `nonEmptyAssistantCount`, `META_SELECTOR`, `CURSOR_CHAR`, and
  its pair-create-send preamble — the closest live-spec shape, and the source of the
  strip-cursor-and-meta counting this ticket's baseline needs.
- `docs/knowledge/features/live-e2e-runbook.md` § Automated coverage — the
  `PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED` floor, an operator-owned dispatcher environment variable that no
  gate in this repo compares against the spec count on disk.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=121-3879

The composer options overlay: a 6px-radius column of five identical `Option button` rows, each one line
of M3 body-small in `schemes/primary` with 12px horizontal and 6px vertical padding, and no per-row
decoration, description or disabled variant drawn. The menu ships three rows today, so this ticket's
fourth lands inside the drawn frame with **no new visual treatment and no CSS** — the row is the shared
`ComposerOptionsPanel` row it already draws. Because the panel renders exactly one visible field per row
(the #934 product decision, and adding a description field to a surface four menus share is out of scope
here), the whole distinction between Reset session and New session has to live in the label text, which
Figma does not carry: the design draws the row, this ticket writes the words.

## Context

`/clear` clears claude's context in place and the process keeps what it holds; `new_session` throws the
process away, so every stored setting applies at the spawn. The transport half shipped with #1217 —
`newSessionCommand`, the routed `newSession` arm in `src/main/index.ts`, and `buildNewSession` — with no
renderer caller. This ticket is the operator's route to it and the proof the round trip works.

The two actions must not read alike, and the menu that will hold both was built on the standing rule
that an entry's id **is** the slash command sent verbatim as message text. New session is a control
frame, so routing it through that path would send the literal string "New session" to claude. The
ticket grants the widening; the design below spends it on a second client-owned array rather than on a
`command` field, a lookup or an id union.

No ADR is warranted: this adds no cross-cutting decision, only a second kind of entry inside one menu,
and the reasoning fits in that file's own header.

**Stated overage, carried forward from the ticket and re-counted against this plan.** Three production
files, one new exported interface, one new consumer call site, five acceptance criteria and five reject
branches all sit well inside the size-S boundary; total written work is ~840 lines against the 800-line
ceiling. The overage is AC4 and AC5 needing two different tiers, and neither substitutes for the other —
a live claude cannot be made to answer with no `session_transition` on demand, and a scripted fake
cannot prove the turn stream survived a real respawn. Slicing AC5 off would produce a ticket whose only
consumer is this one, which the floor rule refuses more strongly than the ceiling asks for the split.

## Design

### The menu grows a second array, not a widened one

`COMPOSER_ACTIONS` stays **exactly** the three slash commands it holds today, unchanged and still
carrying the property that every id is the command. The control entry is a new sibling constant in the
same file:

```ts
export const NEW_SESSION_ACTION: ComposerOptionsPanelOption   // { id: 'new-session', label: … }
export function composerActionRows(
  menu: SlashCommandListEntry | null
): readonly ComposerOptionsPanelOption[]   // = [...markUnavailableActions(COMPOSER_ACTIONS, menu), NEW_SESSION_ACTION]
```

`ComposerActionsMenuView` renders `composerActionRows(menu)` where it renders
`markUnavailableActions(COMPOSER_ACTIONS, menu)` today.

**This is what makes AC3 structural rather than a carve-out.** The control entry is never an argument
to `markUnavailableActions`, so no published `slash_command_list` — complete, empty, hostile or
truncated — can reach it. There is no "except this one" branch inside the availability module to get
backwards, and `isPublished` is never asked a question it would answer wrong (a non-slash id matches no
published `name`, which is exactly AC3's failure mode).

**It is also what leaves two shipped assertions honest instead of weakened.** The ticket's Technical
Notes expect `ComposerActionsMenu.test.tsx`'s "every entry id starts with `/`" to move and the
availability module's "an empty published menu marks every entry" to need care. Under this design
neither moves: the first keeps guarding exactly the array whose ids *are* commands, and the second
keeps its meaning because `COMPOSER_ACTIONS` still holds only entries the rule applies to. **Recorded
as a deliberate divergence from the ticket's sketch**, and a strictly stronger outcome than editing
either assertion. What does move is the *rendered* row counts (3 → 4, and 2 → 3 in the mixed panel),
which is the honest place for a fourth row to be felt.

**Order: the control row is appended last.** AC1's "beside Reset session" and the Context's "Interim
home: the Actions menu, beside Reset session" both name a *surface*, not a row index — and AC1's own
next sentence puts the burden of the distinction on the label. Keeping the three availability-marked
commands one contiguous block is what makes the composition a single splice-free expression.

**Identity:** the id is `new-session` — no leading slash, and disjoint from every `COMPOSER_ACTIONS`
id. Both properties are pinned by a unit test, and together they are what make the view's two-arm
dispatch total: an id that is not the control id is a slash command by construction.

**Label:** `New session (restarts claude)` — a client-owned constant, and a load-bearing e2e locator on
the day a spec matches it, exactly like `COMPOSER_ACTIONS_LABEL` and `COMPOSER_OPTIONS_UNAVAILABLE_NOTE`.
One visible field is all the panel draws, so the restart is said in the label or nowhere.

**Array identity.** `composerActionRows` returns a fresh array every render, where
`markUnavailableActions` returns its input by reference in the common case. Nothing consumes that
identity: the shared clamp's deps are `[active]` precisely so no effect depends on `options`, and no
component in the chain is memoised. `markUnavailableActions`'s by-reference property is unchanged for
its own callers and its own test.

### Dispatch: two arms in the view, one new prop

`ComposerActionsMenuView` and `ComposerActionsMenu` each gain a required `onNewSession: () => void`
beside `onCommand`, and the view's `onSelect` routes on the picked id: the control id calls
`onNewSession`, everything else calls `onCommand` unchanged. No entry-to-handler table and no union —
one equality test against one constant.

`onNewSession` takes **no argument**. The screen closes over `activeConversationId`, the same value it
already closes over for `sendText`, which is what keeps the send and the restart from ever naming
different chats; the menu reports the pick and nothing more.

### The send

A new `src/renderer/src/screens/conversation/sendNewSession.ts`, the `sendInterrupt` shape:

```ts
export interface SendNewSessionDeps { sendCommand: (command: RendererCommand) => void }
export function sendNewSession(conversationId: string | null, deps: SendNewSessionDeps): void
```

Guarded send only — no optimistic dispatch (the daemon answers this frame with nothing at all, so
there is no state to post and nothing to retract), and a bridge failure swallowed to `console.error`
rather than propagated, which is `sendInterrupt`'s posture and `submitMessage`'s.

It returns early, sending nothing, when the id is `null` **or empty**. The null arm is AC2's added
clause and `submitMessage`'s precedent. The empty arm mirrors `isNewSessionPayload`'s emptiness
clause and exists because on this one verb an empty id is not an unresolvable id but *some other
conversation's* claude killed mid-work. **The main-side guard remains the load-bearing refusal** — a
renderer-side check is defence in depth, not the boundary, and the code comment says so, so that a
later reader cannot conclude the boundary guard is now redundant.

No `canSend` gate. AC2 gates on the conversation, not the connection; the main-process arm is already
inert when nothing is connected or when no connection holds the id; and a second copy of `canSend` in
this menu is precisely the drift `ComposerActionsMenu`'s own header refuses to allow.

### Wiring

`Composer` gains one handler beside `sendText` that dereferences `window.pyry` at interaction time (never
during render — the container smoke tests server-render without the bridge) and calls `sendNewSession`
with `activeConversationId`. The footer's `ComposerActionsMenu` element gains `onNewSession={…}`.

## State + concurrency model

No new store slice, no subscription, no timer, no async work, no listener. The action is one synchronous
fire-and-forget `sendCommand` per user gesture, and the panel closes on pick, so a repeat needs a fresh
open-and-pick. The observable effect — one `session_transition`, when the daemon has a child to rotate —
arrives on the shipped inbound path and is drawn by the existing `.session-delimiter`, including #1192's
cross-conversation filing. Nothing here changes that path.

`activeConversationId` is read from the store the composer already subscribes to, and the handler is
rebuilt on every render, so the id the click sends is the id the last committed render held. The chat
pane is keyed on the conversation id, so a switch remounts rather than leaving a stale closure.

## Error handling

| Failure | Result |
|---|---|
| No conversation open (`null` id) | `sendNewSession` returns; no command, no frame, no error surface. |
| Empty id (unreachable today) | Same early return; and `isNewSessionPayload` still refuses it at the boundary. |
| `sendCommand` throws (bridge) | Caught, `console.error` with the error only — no conversation id, no payload. |
| Not connected / id names no held connection | Main's arm is inert; no frame reaches any wire. |
| Daemon has no child to rotate | No `session_transition`; nothing drawn, no error. AC4's first arm. |

Nothing is retried and nothing is surfaced to the operator, which matches the verb: it answers no
question about which conversation ids exist.

## Testing strategy

**vitest — `sendNewSession.test.ts` (new).** A plain spy for `sendCommand`: one `newSession` command
naming the conversation on the happy path; nothing sent on a `null` id; nothing sent on `''`; a
throwing bridge is swallowed rather than propagated.

**vitest — `ComposerActionsMenu.test.tsx` (extended).** The fourth row renders, last, with its exact
label; the three shipped rows' markup is unchanged beside it. `NEW_SESSION_ACTION.id` does not start
with `/` and is not any `COMPOSER_ACTIONS` id — the disjointness the dispatch's totality rests on. And
the AC3 detector, deliberately deterministic rather than a prose rule: the control row carries no
`unavailable` marking and no `aria-disabled` when the published list is complete and names none of the
entries, and when it is complete and empty. That test is what reddens if a later ticket merges the two
arrays back into one.

**vitest — `composerActionAvailability.test.ts`:** untouched, and still true.

**Playwright fake tier — `e2e/composer-new-session.spec.ts` (new).** Nothing in this repo can click, so
the picking is only provable here. One launch per case, the `captureOutbound` script extended to capture
`new_session` alongside `send_message`: picking the row sends exactly one `new_session` naming the open
conversation, sends **zero** `send_message`, leaves the message box empty and adds no user bubble —
AC2 in full, including that Reset session still sends `/clear` (covered by the shipped sibling spec).
AC4's two arms: with the daemon answering nothing, no `.session-delimiter` is drawn and no `[role=alert]`
appears; with one pushed `session_transition` for the open conversation, exactly one delimiter is drawn.

**Playwright fake tier — shipped specs, moved counts.** `e2e/composer-actions.spec.ts`'s `ROW_LABELS`
gains the fourth label; `e2e/composer-actions-unavailable.spec.ts`'s `toHaveCount(3)` becomes 4, and it
gains AC3's live half — the New session row carries no `aria-disabled` in a workspace whose complete
published list names none of these verbs.

**Playwright real tier — `e2e/real-claude-new-session.spec.ts` (new).** The liveness proof AC5 asks for,
and the reason it cannot be folded into the fake tier: a live claude cannot be made to answer with no
`session_transition` on demand, and a scripted fake cannot prove the turn stream survived a real
respawn. `real-claude-interrupt.spec.ts`'s preamble verbatim (pair, create through the FAB, wait for
Send), then: one real turn to give the daemon a child to rotate; capture a baseline with that spec's
`nonEmptyAssistantCount` **after** the turn quiesces; pick New session; assert exactly one
`.session-delimiter`; send a second message and assert the assistant count rises **above** the baseline.
The count is polled against the captured baseline rather than asserted non-zero — a bare `>= 1` is
vacuous in a chat that already streamed a turn.

**Adding this spec makes the tier's floor stale.** `PYRY_REAL_CLAUDE_GATE_MIN_EXECUTED` is a dispatcher
environment variable no gate in this repo compares against the spec count on disk. On `main` at
`373ae70` there are 14 `e2e/real-*.spec.ts` files against a runbook floor of 13 — already off by one —
and this ticket makes 15. The bump is the operator's; the PR says so.

## Open questions

1. **Does the current daemon binary emit `session_transition` on `new_session` for a messaged
   conversation?** `buildNewSession`'s header states it as the contract ("the observable effect, when
   there is one, arrives … as a `session_transition` marker") and AC4/AC5 are written to it, but the
   real tier is the operator's gate, not this run's. The live spec is written to the contract; if the
   gate run shows otherwise, that is a daemon-side finding rather than a client fix.
2. **Row order.** Resolved above as "append last", on the reading that "beside Reset session" names the
   surface. If Juhana wants it adjacent to Reset session, it is a one-line move in
   `composerActionRows` plus the label arrays in two specs.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] No findings, with one clarification the plan states in code.** Two boundaries
  touch this feature. Renderer→main: `isNewSessionPayload` is the boundary and remains the load-bearing
  refusal of an empty id; `sendNewSession`'s own empty check is defence in depth and is commented as
  such, because the confused-implementer scenario here is a later reader concluding the main-side clause
  is now redundant and relaxing it — which restores the cross-conversation kill silently, since no gate
  in the repo reddens on it. Daemon→renderer: workspace-authored `slash_command_list` text reaches this
  menu only through `markUnavailableActions`, and the control entry is never passed to it, so no
  published row can mark, rebuild, rename or select it. `id` and `label` are frozen module constants.
- **[Tokens, secrets, credentials] Not applicable by design.** The command carries one field, the open
  conversation's id — this app's own state, not network input. No token, key, or byte is read, stored or
  transmitted by any line this ticket adds.
- **[File / storage operations] Not applicable.** No path, no file, no cache key is built from anything
  here; the conversation id reaches exactly `newSessionCommand`, a routing `Map` lookup in
  `conversationRouter.route`, and `buildNewSession`'s fresh literal.
- **[Inter-process / Electron attack surface] No findings — no surface is added.** `newSession` already
  exists in `RendererCommand`, is already exposed through the generic fire-and-forget `sendCommand`
  bridge, and is already guarded and routed in main. This ticket adds a *caller*, not a capability, so a
  compromised renderer gains nothing it did not already have.
- **[Cryptographic primitives] Not applicable.** No randomness, no comparison against a secret, no
  handshake or key material is touched.
- **[Network & I/O] No findings.** No socket, timeout or frame-size concern is introduced; the frame
  rides the existing connection. No client-side throttle is added, deliberately: one frame per user
  gesture, and `ComposerOptionsMenu.select` closes the panel on pick, so a repeat costs a fresh
  open-and-pick. The target is the operator's own daemon and the gesture is theirs.
- **[Error messages, logs, telemetry] No findings.** The one added log is `console.error` with the
  caught error alone — no conversation id, no payload, mirroring `sendInterrupt`. Nothing counts,
  records or reports which action was picked.
- **[Concurrency] No findings.** Nothing async, no listener, no timer, no `await` and therefore no
  check-then-act gap. The handler is rebuilt per render over the store slice the composer already
  subscribes to, and the chat pane is keyed on the conversation id, so the id sent is the open chat's.
- **[Threat model alignment] Addressed, with one named residual.** A hostile relay can drop the frame:
  the action then silently does nothing, which is this fire-and-forget verb's designed outcome. A
  hostile daemon pushing an unsolicited `session_transition` is already filed by #1192's
  cross-conversation handling, untouched here. The empty-id cross-conversation kill (pyrycode#2099) is
  refused twice, at the boundary and before the ask.
- **[SHOULD FIX — AC3's structural property needs a deterministic detector]** The property "no published
  list can grey out New session" holds because the entry is never handed to `markUnavailableActions`.
  A later ticket tidying the two arrays into one would undo it, and the failure — the row greyed out in
  every workspace whose published list is complete — ships looking correct. The prose rule alone is not
  enough (a stochastic rule guarded by another stochastic rule); the safety net is the unit test named
  in the Testing strategy, asserting the control row carries no marking against a complete and against
  an empty published list. Implement it in Phase B; the verifier should check it landed.
- **[OUT OF SCOPE]** A per-row description field on the shared options panel (which would let the
  Reset/New distinction live somewhere other than the label) is named out of scope by the ticket and
  needs Juhana's call first. The eventual home of this action — the channel-settings header — is also
  Juhana's placement call, and this ticket assumes the menu.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-07

## Revisions

**2026-09-07 — two consequences of the fourth row that the plan did not name.**

- `e2e/composer-actions-unavailable.spec.ts` arrows from the greyed row back to `Reset session`, and the
  focus ring wraps: over three rows that was one `ArrowDown`, over four it is two. The extra step is
  added, and it now asserts that the intermediate stop is the control row — arrowing onto a row does not
  activate it, which is worth pinning where the drive already passes over it. The plan named only this
  spec's row count and its new AC3 assertion.
- `ComposerActionsMenu.test.tsx` gained a `viewMarkup()` helper. `ComposerActionsMenuView`'s new required
  prop had to be added at its three shipped smoke renders, and one shared helper is what keeps those three
  identical rather than three copies drifting; no assertion changed.

Neither changes the design. Open question 1 (does the current daemon binary answer `new_session` with a
`session_transition`?) stays open by construction — the real tier is the operator's gate.
