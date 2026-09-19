# Conversation shell — composer status row and error slot

The status row directly above the message box: its activity/thinking display, its error chip, that chip's fold into an actionable repair or reconnect button, and the retry/compacting/stall statuses folded into its label. Split from [Composer](conversation-shell-composer.md) 2026-09-05, once this ticket's message-box growth would have pushed the combined document over the size cap.

Part of [Composer](conversation-shell-composer.md); see that document for the message box and footer row, and [Conversation shell](conversation-shell.md) for the screen overall.

This page holds the row's own geometry and the five small, connected-only occupants of its trailing
slot's precedence chain. The four largest occupants live on their own pages, linked from their stub
headings below: [Composer status row](conversation-shell-composer-status-row.md) (#796),
[Composer error chip](conversation-shell-composer-error-chip.md) (#797),
[Actionable-error button](conversation-shell-composer-repair-button.md) (#963), and
[The usage-limit notice](conversation-shell-composer-usage-limit-notice.md) (#1321).

## Composer status row (#796)

Split out to its own page: [Composer status row](conversation-shell-composer-status-row.md) — the
desktop layout's own fixed-height status area above the message box (Figma `111:3525`), its
activity/thinking display, the turning `PyryMark` icon, the truncation chain that bounds a daemon tool
name, and the retry/compacting/stall statuses folded into the label by #967.

## Composer error chip (#797)

Split out to its own page: [Composer error chip](conversation-shell-composer-error-chip.md) — the row's
`trailing` slot filled with a red pill reading `COMPOSER_ERROR_CHIP_COPY` in the `error` connection arm
and no other, and why it never destructures `status.error`.

## Actionable-error button, and the row that grows to fit it (#963)

Split out to its own page: [Actionable-error button, and the row that grows to fit it](conversation-shell-composer-repair-button.md) —
the `Pairing error - Re-pair` button for explicit non-retryable pairing rejection and
`Connection error - Reconnect` for other terminal failures except `unpair` and `not-paired`, the
row's growth from 24 to 32px to fit it, and the retired `RepairPrompt`/`RepairControl`/`.composer__repair`
block this retires.

## Stopped-turn recovery

`ComposerErrorSlotControl` reads the open conversation's `timeline.latestTurnEnd`.
Only a stop that passes [the boundary formatter](conversation-shell-timeline-render.md#stopped-turn-records)
can offer recovery. `terminalReason: 'prompt_too_long'` shows “Context too long.
Compact or reset the session.” with Compact. Otherwise `billing_error` shows
“Claude reported a billing error. Check Claude billing on this server.” and
`authentication_failed` shows “Claude reported an authentication failure. Check
Claude sign-in on this server.” These are reports about Claude on the affected
server; Desktop settings cannot repair that account and are not an action here.

Compact sends the client-owned `/compact` through the same `sendText` path as the
[Actions menu](conversation-shell-actions-menu-and-reader-cutover.md#grey-out-for-an-absent-command-681).
`markUnavailableActions` checks the published command list at render and again at
click time: a complete list proving absence disables it; unknown or incomplete
availability does not. The click also rechecks the open conversation id, and
`sendText` retains its connection/conversation guards. A command never clears the
typed draft. **Reset session is the Actions menu's `new_session` control action, not a
slash command**, as of [#1496](https://github.com/pyrycode/pyrycode-desktop/issues/1496) — it dispatches
outside `sendText` entirely; see [New session control
action](conversation-shell-actions-menu-and-reader-cutover.md#new-session-control-action-1218-folded-to-the-menus-only-reset-row-by-1496).

Recovery has priority after re-pair, reconnect and connection errors, before refusal recovery,
model-settings rejection, Claude reports and usage notices; it is visible only while connected. The
next local submitted message or daemon turn activity clears recovery while preserving the
boundary; the stopped turn's trailing idle does **not** clear it. Session boundaries,
reset and reconnect also clear the reading. A timeline reset or eviction drops the
retained rows too. [The reducer lifecycle](thread-timeline-internals.md#stopped-turn-state)
defines the exact events; scratch history folds cannot restore recovery, and each
conversation owns its own reading.

The recovery text wraps within a shrinkable status group. Compact needs both
`button-small` and `button-small--error`: the base class supplies typography and
shape only, so omitting the status-action variant leaves native button styling.
See [browser evidence](e2e-harness.md#stopped-turn-evidence) for draft preservation,
availability, slot priority and the 800px layout check.

## Refusal Switch back

`ComposerErrorSlotControl` reads only the active conversation's live refusal offer.
The latest fallback qualifies only with exact `scope: 'session'` and nonempty original
and fallback identifiers. Local/unknown scopes and no-fallback records create no
offer; history cannot create or revive one. The button requires a connected state
and an addressable session id (neither `null` nor `''`).

Switch back uses `changeSetting`, the same path as [ComposerModelMenu](composer-model-menu.md),
with the original identifier unchanged. It preserves the draft and sends one
`setSessionSettings` command, with no `/model` chat message. The handler rechecks
the active conversation, exact offer object, connection, session id and pending-model
guards at click time. The button stays visible but disabled while the offer has a
`changeId` or the settings store has a pending model write.

A correlated rejection retains the offer and shows “Could not change the model —
try again.” beside the retry button. Retry clears that feedback; confirmation retires
the matching offer while retaining its [thread row](conversation-shell-turn-status.md#model-refusal-records).
Navigation clears the settings-write store, so pending/rejected presentation also
reads the offer's conversation-owned `changeId` and `rejected` flag. This keeps a
held write disabled across A → B → A and preserves rejection received while away.
See [offer lifetime and regression coverage](conversation-timeline-store.md#refusal-offer-lifetime)
for retirement and stale-reply rules. Styling reuses `button-small button-small--error`.

## Model settings rejection

`ComposerErrorSlotControl` reads `useRunSettingsWriteStore(selectError)`. When the last
correlated settings rejection is for `model`, it supplies “Could not change the model —
try again.” as the slot's `notice`, above Claude reports and usage notices (#1252). The message is
fixed client copy in a `role="alert"` element. It is available both with the ordinary
composer and while the [questionnaire's model footer](composer-model-menu.md#availability-during-question-batches)
is visible; rejection leaves the question answerable and rolls back the optimistic label.

The single-occupant priority is repair button → reconnect button → connection-error chip → stopped-turn
recovery → refusal Switch back (with any rejection feedback) → model rejection → Claude
stopping report → usage notice → history failure → task count. Recovery and notices require `connected`;
disconnected and connecting states hide them without clearing held reports.
`.composer-status__error--settings` retains the error treatment but uses
`flex: 0 1 auto`, `min-width: 0` and `white-space: normal` so the sentence can wrap at the
800px minimum window width.

Clearing follows the existing [settings write lifecycle](session-settings-send.md), with
no timer or question-specific reset. Any new settings dispatch clears the stored error;
`conversationSwitched` clears it with the other write state. Reconnect clears pending
writes but preserves the error, so it can reappear once connected. A confirmation does
not clear a standing error, and an unmatched rejection changes nothing. A later correlated
rejection replaces the stored field; non-model errors do not use this status message.
Closing the question or the model menu does not clear it. Refusal recovery also retains
its own rejection across navigation, as described above.

Static slot tests cover connection priority. The fake question-answer drive holds the
settings response, checks rollback on rejection, verifies that rejection outranks an
existing usage notice, and checks that a fresh dispatch restores that notice while the
original question remains answerable.

## Claude stopping reports

`ComposerErrorSlotControl` selects the open conversation's `timeline.stoppingBanner`.
The latest `stops_turn: true` report occupies the connected-only slot at the priority
above, regardless of level; even `info`, hidden in the timeline, appears here.
Higher-priority messages hide the report without retiring it.

`ComposerBannerReport` reuses the error treatment with `role="status"` and the shared
`Claude:` plain-text formatter. Terminal escapes/non-layout controls are removed;
line breaks and tabs survive, markup and URLs stay inert, and `…` is appended only
when the producer reports truncation. No second text cap applies. Its shrinkable
`pre-wrap`/`overflow-wrap: anywhere` styling lets the row grow at the 800px minimum.

The next accepted typed or slash send inserts an optimistic user row and clears
only this transient report. Empty/blocked attempts, daemon activity, trailing idle,
reconnect and navigation preserve it; reset, clear or eviction drops it with the
timeline. See [routing and lifetime](conversation-timeline-store.md#claude-banner-routing-and-lifetime).
The flag changes no turn or permission state and triggers no action.

Claude's shipped producer subtype is `informational`, distinct from the payload
level. The multiline `/cost` example in `e2e/banner-reports.spec.ts` is synthetic
client coverage; it does not establish a `local_command_output` or `notification`
producer.

## History page failure and Retry

A settled failure shows “Could not load older messages” with `role="status"` only
for the displayed conversation's exact owning host while connected, behind every
occupant in the priority above. An unowned slice, another host's equal conversation
id, or another conversation cannot supply it. `ComposerHistoryFailure` uses the
existing recovery layout and `button-small button-small--error`; Retry appears
only for `retryable: true`. Daemon failure text never supplies the copy.

`retryHistoryPage` rechecks the captured displayed conversation object, connected
host, exact held failure object and retryability at activation. Navigation (even
to a new object with the same id), disconnect or a new settlement invalidates the
action. A local read in progress or completed coverage also prevents dispatch.
It delegates to the [existing history request path](request-history-send.md#the-one-fact-that-shapes-every-piece),
preserving the failed cursor, limit, rows and successful coverage. Starting a retry
removes the settled message and button while pending; correlated success clears
failure, and a new failure supplies its new retryability. No automatic retry is
introduced. Fresh upward input can still ask again after either classification.

`historyRetry.test.ts` covers state and stale actions; `historyRetry.test.tsx`
covers ownership, pending disappearance and priority through the real container.
`e2e/history-retry.spec.ts` compares the full retry payload and fresh correlation
id, holds the reply to prove one pending request and retained rows, then releases
success. Immediate replies could conceal duplicate-demand bugs. It also delivers
a nonretryable error and proves fresh upward demand remains available.

## The usage-limit notice, the slot's third occupant (#1321)

Split out to its own page: [The usage-limit notice, the slot's third occupant](conversation-shell-composer-usage-limit-notice.md) —
the per-conversation [usage-limit store](usage-limit-store.md) reading drawn in the trailing slot,
`usageLimitNotice.ts`'s three-run copy composition (lead, window, reset clause), and the layout
hazard the first review cleared, wrongly, when a client-owned string (not a daemon one) blew the row
past the pane.

## Background-task count pill, the slot's last occupant (#1435)

The daemon's live background tasks were readable in exactly one place — the `BackgroundTaskPanel`
behind the More actions menu — so a turn that ended with several tasks still running looked finished.
This ticket adds the count as the trailing slot's **last** reading, appended to the end of the existing
`??` chain: `recovery ?? refusal ?? notice ?? history ?? taskCount ?? null`, still gated inside the
`status.type === 'connected'` arm. Every occupant documented above outranks it; it is visible only when
nothing else in the chain is.

**The count is the true roster size**, `roster.tasks.size + roster.droppedTasks` from
[`backgroundTaskRosterStore`](background-task-roster-store.md), read via `selectRosterFor(open.id)` the
same shape as the usage-limit read beside it — a fresh selector identity per render costs a
re-subscribe and never a loop, since `selectRosterFor` returns the held entry itself or `null`, both
stable references. `roster === null` ("no frame has ever arrived") and an entry holding nothing alive
are distinct store readings kept apart by the store, but both collapse to `count === 0` here, which is
the reading this surface is entitled to make and the panel is not.

**`ComposerTaskCount({ count, onOpen })`** is a new pure, exported view in `ConversationScreen.tsx`,
`ComposerUsageLimitNotice`'s shape verbatim: a prop, not a store read, because zustand v5's `useStore`
reads `getInitialState()` under `renderToStaticMarkup`, so a container test can otherwise reach only one
arm. Returns `null` at `count <= 0` (`<=` rather than `===`, since `droppedTasks` decodes through a plain
`requireNumber` and a hostile or buggy daemon can drive the sum negative); otherwise a real
`<button type="button" className="composer-status__tasks">` holding `'1 task running'` or
`` `${count} tasks running` `` — a two-way conditional over two client-owned literals, no copy module
(unlike #1321's `usageLimitNotice.ts`: one number and one word need no pinning module of their own). No
`aria-label`, no live region — the visible text is already the accessible name, and a count that moves
every turn would announce on each one. Activating it calls `onOpen`, which the screen wires to the same
`setPanelOpen(true)` the More actions item already calls, so the panel and its menu entry are untouched.

**The count is a plain `number` all the way to the DOM**, which is the whole trust boundary: the roster
also holds untrusted, model-influenced task `description` and `latestUpdate.patch`, and this slice reads
neither. `ComposerErrorSlotControl` checks `taskCount === 0` before constructing the element (an absent
occupant must reach the `??` chain as actual `null`, never as a non-null element whose component renders
nothing — the standing rule #1321 also states, restated here because this is the chain's new tail).

**`.composer-status__tasks`** takes the neutral Pill treatment `.composer__attachment-name` already
implements (`--space-2`/`--space-1` padding, `--radius-xs`, `--text-body-small-*` at regular weight,
`--color-primary-container`/`--color-on-primary-container` — read by token name, never the Figma export's
light-scheme hex fallback). No `height` — 16px of line plus 4px twice already sums to the row's 24px rest
height. Unlike the two error occupants' `flex: 0 0 auto`, this element ships `flex: 0 1 auto; min-width: 0`
with an ellipsis chain — the #1321 rework leg's layout-hazard lesson applied in advance rather than
re-learned. It costs little (the widest reachable string is ~37 characters, since JS `Number`→`String` is
bounded around 24 digits and fits the 640px pane unshrunk) but means this occupant yields to the row before
the row yields to the window, the way the unshrinkable usage-limit notice did not the first time.

**Lessons learned (from the PR's own retrospective):**

- **A `{/* … */}` comment is a syntax error in a JSX *expression* slot**, not merely unsupported style.
  `trailing={…}` and `statusArea={(sendText) => (…)}` are expression positions, not children, so the JSX
  comment form fails to parse there while a plain `/* … */` works. `tsc --noEmit` reported unrelated type
  errors first; esbuild was the tool that actually named it.
- **A static capture inherits nothing.** A first screenshot rendered the pill in the UA serif because the
  fixture omitted `.conversation`, the ancestor that resolves `--font-sans` — it would have passed a glance
  and every markup assertion while proving nothing about typography. Include any caller wrapper that
  supplies inherited fonts, per [the visual-review recipe](visual-review.md).
- `backgroundTaskRosterStore` is keyed by conversation id **alone**, with no server origin, so two paired
  servers issuing the same conversation id would share an entry — pre-existing, not this ticket's to fix.
  `BackgroundTaskPanel` has the identical exposure and shows task *descriptions* where this pill shows only
  a number, so this ticket strictly reduces what's reachable rather than widening it.

Tested in `ConversationScreen.test.tsx` (vitest only — nothing under `e2e/` sends roster frames): the
count copy and its singular/plural split, the exact-empty absence at zero and at "never observed", the
markup carrying `composer-status__tasks` and never `composer-status__error`, and the full `ComposerErrorSlot`
precedence matrix with the pill yielding to every occupant above it in both directions. See
[#1435](https://github.com/pyrycode/pyrycode-desktop/issues/1435).
