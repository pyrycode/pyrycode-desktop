# #1496 — one Reset session row, and it restarts claude

## Files read

- `src/renderer/src/screens/conversation/ComposerActionsMenu.tsx` → `COMPOSER_ACTIONS`, `NEW_SESSION_ACTION`,
  `composerActionRows`, `ComposerActionsMenuView` — the whole change surface: the array the `/clear` row
  leaves, the control row whose label is renamed, the composition whose order flips, and the two-arm
  dispatch that must stay total across the fold.
- `src/renderer/src/screens/conversation/ComposerActionsMenu.test.tsx` — the pin the ticket names: it
  asserts the array literally, the row count, the control row's label, and that the control id is disjoint
  from every command id. Every one of those moves.
- `src/renderer/src/screens/conversation/composerActionAvailability.ts` → `markUnavailableActions`,
  `isPublished` — unchanged by this ticket, and its docblock's `/clear` examples are what tell me the
  module carries no per-command table, so dropping an entry reaches no branch.
- `src/renderer/src/screens/conversation/composerActionAvailability.test.ts` → its `COMPOSER_ACTIONS`
  import — three cases spell `/clear` as the expected unavailable id and have to be retargeted, not
  renamed.
- `src/renderer/src/screens/conversation/sendNewSession.ts` → `sendNewSession` — the dispatch the row now
  takes. Its null-and-empty refusal is unchanged; only its header, which contrasts itself against "the
  `/clear` the row above it sends", is stale.
- `src/renderer/src/screens/conversation/SystemPromptSection.tsx` → `WRITE_CONFIRMED`, `SESSION_DIFFERS` —
  the two notices AC3 renames.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → the two `markUnavailableActions(COMPOSER_ACTIONS, …)`
  reads. Both `.find(id === '/compact')`, so they are order-independent and entry-count-independent:
  confirmed by reading them, which is why this ticket touches no screen code.
- `src/main/transport/newSessionEnvelope.ts`, `src/main/daemonConnection.ts` → `newSession`,
  `src/shared/ipc/commands.ts` → the `newSession` arm, `src/shared/wire/types.ts` → the `new_session`
  envelope type and `NewSessionPayload` — AC5's tail: four docblocks that contrast `new_session` against
  "the `/clear` the Actions menu's Reset session sends as ordinary message text". Comment-only.
- `e2e/composer-actions.spec.ts`, `e2e/composer-actions-unavailable.spec.ts`, `e2e/composer-new-session.spec.ts`,
  `e2e/offline-conversation-actions.spec.ts`, `e2e/channel-system-prompt.spec.ts`,
  `e2e/real-claude-new-session.spec.ts`, `e2e/real-claude-system-prompt.spec.ts` — the load-bearing
  locators. Two of them need structural work, not a rename; see Design.
- `docs/knowledge/features/development-verification.md` and the root `CLAUDE.md` — the renderer tier is
  `renderToStaticMarkup` under the `node` environment and cannot click, so every "picking it does X" proof
  in this ticket is Playwright's.

Codegraph was unavailable in this worktree — `.codegraph/` carries `config.json` and a `.gitignore` and no
index, and `codegraph_context` answered "CodeGraph not initialized for this project". The reading list
above came from grep and Read.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=121-3879

A 6px-radius column of `Option button` rows on the panel ground, each row 12px horizontal and 6px vertical
padding, body-small type in the `schemes/primary` role on the `schemes/on-primary-fixed` row surface. The
frame draws five generic rows with placeholder copy (`Ultracode`, `Max`, `Extra`…) and carries no Actions
copy and no disabled variant — it is the shared surface `ComposerOptionsPanel` already implements and that
`conversation.css`'s `.composer-options` rules already token-map. **This ticket draws no new pixels**: it
removes one row from a list the panel renders and changes one row's text. No new element, no new class, no
CSS touched.

## Context

Juhana decided on 2026-09-06 that a conversation has exactly one reset path, the cold one. #1218 then
shipped a second row beside the first: `Reset session` sending `/clear` as ordinary message text (clears
claude's context in place, process survives) and `New session (restarts claude)` dispatching the
`new_session` control frame (daemon kills and respawns claude). That is the two-button surface the decision
rejected, and on 2026-09-15 Juhana asked why there are two.

This ticket folds them: one row, labelled `Reset session`, dispatching the control frame. The typed `/clear`
route is untouched and needs nothing from this client — claude intercepts a message whose text begins with
a slash and runs it.

No ADR is warranted. The decision this implements is already recorded on the ticket and in #1218's
decision trail; this is its application, not a new architectural choice.

## Design

### The fold, in `ComposerActionsMenu.tsx`

Three edits, all to data and one expression:

1. `COMPOSER_ACTIONS` drops its `{ id: '/clear', label: 'Reset session' }` member and keeps `/compact` and
   `/knowledge-capture`. The array stays what it was — the client's own slash commands, id-is-the-command,
   never rebuilt from a published list — with one fewer member.
2. `NEW_SESSION_ACTION.label` becomes `'Reset session'`. Its `id` stays `'new-session'`.
3. `composerActionRows` returns `[NEW_SESSION_ACTION, ...markUnavailableActions(COMPOSER_ACTIONS, menu)]`
   — the control row first, per AC1's order. The marked commands stay one contiguous block (now the tail
   rather than the head) and the composition stays a single splice-free expression.

**`NEW_SESSION_ACTION` keeps its name, and that is a decision rather than an oversight.** The label is the
only field this row renames; the id (`new-session`), the view's `onNewSession` prop, the `sendNewSession`
helper, the `newSession` IPC command and the `new_session` wire envelope all keep the verb they have, and
they are one chain. Renaming the option constant alone would leave a single link in that chain speaking the
UI's vocabulary while its own `id` and its own consumer speak the wire's. The constant is separate from
`label` precisely so the two can differ, and AC2's structural property is about which array the row is in,
not what the binding is called.

**What does NOT move, and the reason each is safe:**

- `markUnavailableActions` and `isPublished` — no per-command table, one rule applied to whatever array it
  is handed, so a shorter array reaches no branch of theirs.
- The control row stays out of `markUnavailableActions`'s **argument**, which is the whole of AC2. It is
  never carved out inside the availability module; it is unreachable from it. `new-session` would match no
  published `name` or alias, so folding it into `COMPOSER_ACTIONS` would grey the only reset path out in
  every workspace with a complete published list — a failure that ships looking correct.
- The two-arm `onSelect` — `id === NEW_SESSION_ACTION.id ? onNewSession() : onCommand(id)`. Total before
  and after: the id is disjoint from every remaining command id, and dropping `/clear` widens the gap
  rather than narrowing it. Drawing the control row first changes nothing about the dispatch, which reads
  the id and not the index.
- `ConversationScreen.tsx` — both `COMPOSER_ACTIONS` reads `.find` on `'/compact'`.
- `sendNewSession`'s body, including the `null`/`''` refusal and `isNewSessionPayload` at the IPC boundary.

### `SystemPromptSection.tsx`

`WRITE_CONFIRMED` and `SESSION_DIFFERS` each name `New session`; both become `Reset session`. Both stay
client-owned literals built from no daemon string.

### The two specs that need more than a rename

**`composer-actions-unavailable.spec.ts`.** Its `AVAILABLE_ROW` anchors on `Reset session` — today the
ungreyed `/clear` slash row — and `CONTROL_ROW` on the New session label. After the fold both names resolve
to the same row, so a mechanical rename leaves the spec green for the wrong reason.

- `AVAILABLE_ROW` moves to `'Compact session'`, which the fixture publishes only as an **alias** of
  `compact-conversation`, so the spec's alias-arm proof and its available-row-still-sends proof become the
  same row rather than two.
- `CONTROL_ROW` becomes `'Reset session'`.
- The published `COMMANDS` fixture **drops its `clear` row**. This is the sharper input AC2 asks for: a
  complete list naming neither the row nor `clear`. Keeping `clear` published would leave the spec green
  for an implementation that folded the control row into `COMPOSER_ACTIONS` under the id `/clear` — the
  exact tidy-up AC2 exists to forbid.
- Row count 4 → 3, and the arrow walk survives unchanged: open focuses row 0, two ArrowDowns reach the
  greyed `Knowledge capture` at row 2, one more wraps to the control row at row 0 (still passed over, still
  not activated), one more reaches the available row at row 1. The captured outbound text becomes
  `/compact`.

**`composer-actions.spec.ts`.** Its first test picks row 0 and asserts one `send_message` carrying
`/clear`; after the fold that pick sends a control frame and the capture stays empty, so the test loses its
premise. `composer-new-session.spec.ts` already owns the control row's dispatch drive, and duplicating it
here would be a second copy of the same proof. The first test is re-pointed at `Compact session`, keeping
everything that is this spec's own — open, panel visible, the exact `ROW_LABELS` list, pick, panel hidden,
the optimistic user bubble, one outbound whose `text` is the command verbatim — and the second test, which
exists to prove the mapping is per-row rather than hardcoded to the first, is re-pointed at
`Knowledge capture`. Two slash rows still carry the per-row proof.

The remaining five specs are literal renames of the row label or the notice copy.

### AC5's tail

Four docblocks under `src/main/` and `src/shared/`, plus `sendNewSession.ts`'s own header, contrast
`new_session` against "the `/clear` the Actions menu's Reset session sends as ordinary message text". Each
becomes a one-line correction stating what is still true — `new_session` is a kill-and-respawn, not a
context clear, and the typed `/clear` route still exists — with no logic touched and no file restructured.

## Testing strategy

Vitest (`node` environment, `renderToStaticMarkup`) proves everything that is data or markup:

- `ComposerActionsMenu.test.tsx` — the array holds exactly `/compact` and `/knowledge-capture`, in order;
  a **new** assertion that no entry's id is `/clear` (AC2's first clause, stated directly rather than
  inferred from the array literal); the control row's label is `Reset session`; its id is neither a slash
  command nor any `COMPOSER_ACTIONS` id; `composerActionRows(null)` is `[NEW_SESSION_ACTION, ...COMPOSER_ACTIONS]`
  (AC1's order); the panel draws three rows; and the control row is never marked unavailable by either
  complete published menu — now including one that names neither it nor `clear`.
- `composerActionAvailability.test.ts` — the three cases that spell `/clear` as an expected output are
  retargeted to `/compact`, preserving each one's actual proof (same rule for every entry, exactly one
  leading slash stripped, no case-fold or trim).
- `SystemPromptSection.test.tsx` — the `differs` line names `Reset session`.

Playwright, fake tier (`e2e/`), for everything that needs a click:

- `composer-actions.spec.ts` — the panel's rows exactly, and a picked slash row reaching the wire.
- `composer-actions-unavailable.spec.ts` — as restructured above.
- `composer-new-session.spec.ts` — the control row's dispatch, under its new label: one `new_session`
  naming the open chat, nothing on the message path, no user bubble. Unchanged in shape.
- `offline-conversation-actions.spec.ts` — the #1380 offline gate, which applies to this row as it did to
  the old one.
- `channel-system-prompt.spec.ts` — the `differs` notice copy.

Real-claude tier (`real-claude-new-session.spec.ts`, `real-claude-system-prompt.spec.ts`) — locator and
prose renames only; no new spec, and the real-claude spec floor is unchanged. **The live tier is not run by
this role**; `needs-real-claude` stays on the issue and the dispatcher's configured gate runs it.

No new fakes and no new fixtures. The change adds no state, no async work, no failure mode and no new
error path, so there is nothing for a `State + concurrency model` or an `Error handling` section to say
that `sendNewSession`'s shipped docblock does not already say.

## Sizing

The one-ticket boundary trips on exactly one line: **production source files, 8 against a ceiling of 5.**
Every other line clears with room — ~430 lines of total written work against 800, no new exported type or
component, two consumer call sites, 5 acceptance criteria, no state machine.

Five of the eight files are the AC5 docblock corrections: one-line comment edits carrying no logic, no
call-site cascade and no test of their own. Splitting them out fails the floor rule rather than satisfying
the ceiling — a comment-only child has no deliverable that lands and can be checked on its own (no
behaviour, no contract, no gate that can redden), and between the two tickets the repo would carry
transport docblocks that contradict the code they document, which is precisely what AC5 exists to prevent.
The floor wins over the ceiling: built as one ticket, with the overage stated here.

## Open questions

- Whether `NEW_SESSION_ACTION` should be renamed to match its new label. **Resolved in Design above:** it
  keeps its name, because the id, the prop, the helper, the IPC command and the wire envelope all keep the
  `new_session` verb and the label field exists to differ from them.
- Whether `composer-actions.spec.ts`'s lost first test should be replaced with a control-row drive here.
  **Resolved: no** — `composer-new-session.spec.ts` owns that drive, and a second copy would be one more
  place to update the next time the row changes.

## Documentation handoff

Owned by the documentation stage, not this ticket. Pending:

- `docs/knowledge/features/conversation-shell-actions-menu-and-reader-cutover.md` — § Actions menu (#680)
  and § New session control action (#1218): the menu holds three rows, the first of them a control frame,
  and the two-row distinction #1218 recorded is gone. Replace in place.
- `docs/knowledge/features/live-e2e-runbook.md` — § Current real-claude gate state, where the paragraphs on
  `e2e/real-claude-new-session.spec.ts` and the system-prompt drive name the `New session` row.
- `docs/knowledge/features/conversation-shell-session-and-channel-info.md` — the **Session status copy**
  paragraph, which quotes the `differs` notice naming New session.
- The remaining overviews and `CATALOG.md` repeat the "not the `/clear` the Actions menu's Reset session
  sends as message text" contrast as a wire-level aside; `grep -rn "Reset session" docs/knowledge/` finds
  them.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings, and the property is structural rather than asserted. The only
  untrusted input anywhere near this surface is the daemon's published `slash_command_list`, which reaches
  `markUnavailableActions` and can set exactly one boolean on a row it is handed; `isPublished` compares
  and never rebuilds, and `markUnavailableActions` carries `id` and `label` through untouched (pinned by
  its "carries every id and label through unchanged" case). The control row is not in that function's
  argument at all, so no published `name` or alias — including a hostile workspace publishing `new-session`
  or `clear` — can reach the row's id, its label, or which dispatch arm it takes. The fold removes a row
  from the published-matching path and adds none, so the untrusted surface shrinks.
- **[Electron / IPC attack surface]** No new channel, no new `contextBridge` API, no `webPreferences`
  change, no new IPC payload shape. But the ticket **raises the stakes on an existing guard** and that is
  worth stating rather than assuming: `isNewSessionPayload`'s refusal of `''` is the load-bearing one,
  because on `new_session` an empty `conversation_id` is not an unresolvable id — the protocol gives the
  bare form the meaning "restart whichever conversation the daemon's process-wide follow-active cursor
  points at", i.e. some other conversation's claude killed mid-work. After this ticket the row that reaches
  that guard is the menu's **only** reset path and its **first** row, so it is picked more often than
  before. Both layers (`sendNewSession`'s `null`/`''` defence-in-depth check and `isNewSessionPayload` at
  the untrusted renderer→main boundary) must come through this diff untouched; a command the boundary guard
  rejects is dropped in silence, so a relaxed clause on either side would compile, typecheck and pass every
  gate. No change required — the constraint is "do not touch", and the verifier should confirm the diff
  contains neither file's guard.
- **[Electron / IPC attack surface — dispatch routing]** No findings on the reorder. `onSelect` routes on
  the row's **id** against one client-owned constant, never on the row's index, so drawing the control row
  first cannot misroute a pick. The two arms stay total: `new-session` carries no leading slash and is
  disjoint from every remaining `COMPOSER_ACTIONS` id, and dropping `/clear` widens that disjointness
  rather than narrowing it. Pinned by a test, not left to inspection.
- **[Errors, logs, telemetry]** No findings. `sendNewSession` logs `'new session send failed'` and the error
  alone — no conversation id, no payload — and this ticket changes no log call. The renamed row label and
  both renamed `SystemPromptSection` notices are client-owned module constants assembled from no daemon
  string, so the rename moves no workspace-authored text into copy or into an accessible name.
- **[Concurrency]** No findings. No async work, timer, listener or subscription is added; `sendNewSession`
  stays synchronous and deliberately fire-and-forget (the daemon answers this frame with nothing at all),
  and the observable effect still arrives on the pre-existing inbound `session_transition` path. The menu
  reports the pick and takes no argument, so the restart closes over the same `activeConversationId` the
  send path does and the two cannot name different chats.
- **[Tokens / secrets]**, **[File / storage]**, **[Cryptographic primitives]** — not applicable, and by
  construction rather than by luck: the diff is two renderer constants, one composition expression, one
  copy pair, comment corrections and specs. It reads no token, opens no path, and touches nothing in the
  Noise session, the key schedule or the envelope framing. `daemonConnection.newSession` still shares the
  one monotonic envelope-id counter, so no envelope id is reused.
- **[Network & I/O]** OUT OF SCOPE — repeat-pick rate limiting. A user can reopen the menu and pick the row
  again to emit another `new_session`; each repeat costs a reopen (the panel closes on pick) and the #1380
  offline gate hides the menu when the host is unavailable. This is unchanged by the fold except that the
  row is now first and therefore marginally cheaper to reach. Throttling a control verb belongs to the
  daemon, not to this client; no ticket filed, because nothing observed suggests it is reachable as abuse
  on a single-user desktop client.
- **[Threat model alignment]** OUT OF SCOPE — **no confirmation step in front of a destructive first row**,
  and this is the one finding a reader should not skim. The panel moves focus to row 0 on open, so after
  this ticket a user who opens the Actions menu and presses Enter reflexively kills and respawns claude,
  where before that keystroke cleared context in place. That is a real behaviour change with a destructive
  outcome. It is nevertheless out of scope by decision rather than by omission: AC1 mandates this order,
  Juhana's 2026-09-06 decision is that a conversation has exactly one reset path and it is the cold one,
  and the planned mitigation is upstream — the daemon-side wrap-up turn that writes a handoff note before
  the kill, named in this ticket's Context as landing later without changing this client. Adding a
  client-side confirmation dialog here would be a product decision this ticket was not given.
- **[Threat model alignment — hostile relay / hostile daemon / renderer compromise]** No findings. A hostile
  on-path relay can drop or delay the frame, in which case no restart happens: fail-closed, with no
  plaintext exposed, since the frame travels inside the Noise session. A hostile daemon has strictly less
  reach over this row after the fold than a design folding it into the published-command path would have
  given it. A compromised renderer could already emit any `RendererCommand` including `newSession` before
  this ticket — the menu was never the boundary, `isNewSessionPayload` is, and it is unchanged.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-16
