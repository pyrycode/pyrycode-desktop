# Composer send — internals

Part of [Composer send](composer-send.md).

## How it works

The submit helper publishes the echo, then sends through the bridge; the controlled
container clears its draft only when that bridge call returns successfully.

### 1. The pure submit helper — `composerSend.ts`

Framework-free and React-free, co-located with the screen and mirroring `pairingState.ts` / `messageViewModel.ts`: the effects are **injected**, so the helper is a pure, deterministic function tested with plain spies (no React, no store, no Electron).

```ts
// src/renderer/src/screens/conversation/composerSend.ts — RENDERER ONLY
export interface ComposerSendDeps {
  serverId?: string   // attribution of main routing refusal; outside the wire payload
  diagnose?: (record: MessageLifecycleDiagnostic) => void
  sendCommand: (command: RendererCommand) => void
  dispatch: (event: ThreadEvent) => void
  dispatchFor: (conversationId: string, event: ThreadEvent) => void   // #756
  newMessageId: () => string
  now?: () => number   // #1013 — optional, no Date.now fallback
  takeAttachments?: () => PendingAttachmentTake   // #1039, reworked #1055 — optional, destructive read + undo
}

export function submitMessage(text: string, conversationId: string | null, deps: ComposerSendDeps): boolean
```

Current signature — see [conversation timeline holder § Configuration and usage](conversation-timeline-holder.md)
for `dispatchFor`'s target. `dispatch` writes the same `ThreadEvent` into the flat `timelineStore` this
section originally described as `sessionStore`/`SessionAction`; that retarget happened in
[#179](../codebase/179.md) and the active-conversation `conversationId` parameter was added in #448 (see
[conversation timeline store](conversation-timeline-store.md) for the current bridge-side model). [#756](../codebase/756.md)
added `dispatchFor`, **required** rather than an arity widening of `dispatch` — unlike
`subscribeTimeline`'s 20 call sites, this deps object had only 6, so requiring the field cost six
mechanical test edits and buys a compile error for "forgot to wire it." `submitMessage` builds the
`userText` echo once and hands the same `ThreadEvent` reference to both `dispatch` and `dispatchFor(conversationId, echo)`,
under the conversation the message was sent to — safe because `reduceTimeline` is pure and always builds
fresh arrays.

[#1013](https://github.com/pyrycode/pyrycode-desktop/issues/1013) added `now?: () => number` — the echo's
clock, read once as `createdAt: deps.now?.()` when the `userText` `ThreadEvent` is built, so the stamp
that reaches `dispatch` and `dispatchFor` is the same value in both (the "built once" property above,
now also true of the timestamp). It goes the **opposite** way from `dispatchFor`'s own #756 precedent, and
for a reason that precedent did not face: `dispatchFor`'s six call sites made *requiring* it cheap (six
mechanical test edits for a compile error on "forgot to wire it"); requiring `now` here would not merely
cost edits — this deps object now has thirteen call sites, not `dispatchFor`'s six — it would **redden**
every whole-object `toHaveBeenCalledWith` assertion on the echo in `composerSend.test.ts`, since every
deps literal would then supply a clock and every echo would carry a defined `createdAt` where those
assertions name none. ([#1213](https://github.com/pyrycode/pyrycode-desktop/issues/1213) paid exactly
that price for `messageId` below, which *is* required in this deps object as `newMessageId` and so is
always defined: five such assertions gained the field. That cost was accepted because the id is not
optional at the producer — the wire frame needs it either way — whereas a clock genuinely may be
absent.) So `now` is optional with **no `Date.now` fallback** —
absent clock means no stamp, the same rule [conversation timeline store](conversation-timeline-store.md)'s
`translateTimelineEvent`/`subscribeTimeline` follow for the assistant side. The cost: the wiring at `ConversationScreen.tsx`'s `Composer.sendText` — the one production call site
that builds a `ComposerSendDeps` literal and now includes `now: Date.now` — is not compile-enforced; a
forgotten `now` there would silently ship unstamped echoes. `composerSend.test.ts` pins the wired
behavior with its own spec instead of relying on the type system. See [Thread timeline §
Types](thread-timeline-internals.md#types) for the full field-pair contract and why the clock rides the event
rather than a `reduceTimeline` parameter.

**`message_id` is minted once and used twice — the wire command and the echo**
([#1213](https://github.com/pyrycode/pyrycode-desktop/issues/1213)). [#179](../codebase/179.md) had
retired the original "reuse the id so the daemon's re-echo dedupes" rationale, and that stays retired: in
interactive mode the daemon streams no user-message event, so the echo is the sole source of the user
message and needs no dedup key. #1213 puts the id back on the echo (`ThreadEvent.userText.messageId`) for
an unrelated purpose — **correlation** with the queued row the daemon draws when it parks this message
mid-turn (`QueuedItem.message_id`, pyrycode#2092) — so a later cancel
([dequeue message envelope](dequeue-message-envelope.md)'s `dropQueuedMessage`) can find this exact echo
again. It also correlates local delivery status. Both the ID and attachments survive a bridge
exception on the failed echo; its Not sent label makes the outcome explicit without claiming
daemon delivery. See [Thread timeline §
Types](thread-timeline-internals.md#types) for the full field-pair contract.

`submitMessage` contract:

1. Trim `text`. Whitespace-only input or a null conversation ID returns `false` with no effects, including no attachment take or clock read.
2. Mint `message_id` once and take pending attachments once. Build the payload with the selected conversation, trimmed text and any attachment IDs.
3. Publish one `userText` event with the same ID, original timestamp and attachments to both the active timeline and `dispatchFor(conversationId, echo)` before calling the bridge. This ordering lets synchronous delivery status find the echo in both stores.
4. Call `deps.sendCommand(sendMessageCommand(payload, deps.serverId))`. A successful return yields `true`, so the container clears only the selected draft. This means bridge acceptance, not socket write or daemon acknowledgement.
5. On a synchronous bridge exception, swallow the exception, roll back the attachment take and dispatch `messageDelivery{messageId,status:'not-sent'}` to both stores. Return `false` so the draft and pending attachments remain available for resubmission. The existing echo keeps its text and attachments and shows Not sent; no ordinary sent echo is added. Diagnostics use fixed categories and never log the caught object.

### 2. Local delivery status and receipt settlement

`userText` creates durable content plus a `localEchoes` identity sidecar. Delivery
presentation stays in that sidecar (`delivery?: 'waiting' | 'not-sent'`, `held?: true`),
preserving message object identity and the saved-history row contract. Main's typed
`messageDelivery` event carries conversation/message IDs and `waiting | not-sent | written`,
with its host stamp; there is no payload text, raw error, key or frame byte.

Waiting shows “Waiting for connection” and participates in `foldQueuedRows`' pending
placement without inventing a daemon `queued_msg_id` or showing queue controls.
Not sent preserves the failed message. Written clears only the transport label:
a socket write is not daemon acknowledgement, and main never retries a written
message merely because its receipt has not arrived. The main-memory hold and
unchanged-pairing Reconnect rules live in [connection lifecycle](daemon-connection-lifecycle.md#disconnected-composer-message-delivery);
holds end on pairing replacement/removal, disposal or app shutdown and do not survive restart.

`timelineTargetFor` routes delivery events to their own conversation. The mounted
bridge updates the active flat store only for the open conversation and matching
retained host; `dispatchFor` updates an existing host-owned slice even when inactive.
A host mismatch or missing slice is a no-op, rather than replacing another host's
timeline. The reducer also requires an unsettled local echo with the same message ID
and no daemon queue ID; late statuses cannot overwrite queue admission or settlement.

A matching queue snapshot clears delivery status and binds the existing echo to the
daemon's real queue ID. A user receipt clears status and settles that same row through
the [queue correlation rules](thread-timeline-internals.md#queued-own-echo-settlement),
retaining original text, timestamp and attachments and placing it before its reply.
A locally held echo uses delivery placement even if no daemon queue ID was observed.
Duplicate/replayed receipts neither duplicate nor move a settled row.

### 3. The controlled composer — `ConversationScreen.tsx`

`Composer` becomes a thin controlled container (stays in-file; the logic lives in `composerSend.ts`):

- Text lives in the renderer singleton `composerDraftStore`, in nested maps keyed by server ID then
  conversation ID. `selectDraft` returns the exact string, including whitespace and blank lines;
  missing entries read as empty. Emptying the input removes only that entry. Null coordinates read
  empty and the composer does not write an anonymous draft. The narrow string selector keeps edits
  to another draft from re-rendering this composer.
- `ConversationScreen` passes its retained `selectedHost` through `ComposerSlot`, alongside the
  conversation ID. Sidebar selection and the creating host stamped on `useConversationCreatedNav`
  establish ownership; later conversation-list refreshes cannot transfer it. See
  [pane identity](paired-shell-routing.md#the-conversation-switch-remount-bug-and-the-panekey-fix).
- Drafts survive channel/chat switches, newly created chats and visits to other in-app screens for
  the app session. They have no restart persistence. Attachments are not retained by this text store;
  menus and other transient pane state still reset on remount.
- Typing and slash-command completion use the same coordinate-bound `setText` setter. Restoration
  feeds the existing controlled textarea and its sizing, so a multiline draft expands on return.
- The optimistic echo uses the flat timeline dispatch and host-owned held-timeline dispatch; input
  retention does not change `submitMessage`'s send contract.
- The `<textarea>` gains `value={text}`, `onChange`, and `onKeyDown`; the send `<button>` gains `onClick={handleSubmit}`. Existing `className`/`placeholder`/`aria-label="Send"`/SVG untouched.
- **Since [#678](https://github.com/pyrycode/pyrycode-desktop/issues/678), that button is `ComposerSendButton`, not a bare `<button>`.** `Composer` also takes a required `phase: TurnPhase` prop from the container and derives `isRunning={isTurnRunning(phase)}` on every render; while a turn is running the control swaps to a stop affordance in place, reusing the same `.composer__send` chrome and the same `aria-label="Send"` string only in the idle branch. `onClick={handleSubmit}`/`disabled={!canSend}` still gate the send branch exactly as above — `isRunning` and `canSend` are independent, so the send-gate logic on this page is unchanged by the swap. See [Interrupt envelope § The render affordance](interrupt-envelope.md#the-render-affordance-307-merged-into-the-send-button-by-678) for the stop variant's own contract.
- `handleSubmit` calls `sendText(text)` and clears only the selected draft when it returns `true`,
  then emits the content-free `composer-draft-cleared` diagnostic. This is local submit success,
  without a daemon acknowledgement. A caught bridge exception returns false, marks the echo
  Not sent and preserves draft and pending attachments. Unavailable-host and whitespace-only
  rejection leave the draft intact
  through subsequent switches. Actions-menu commands call `sendText` directly and leave typed text
  alone. Bridge dependencies are built inside `sendText`, at interaction time, so server rendering
  never dereferences `window.pyry` through this send path.
- `onKeyDown`: reads `key`, `shiftKey`, and `nativeEvent.isComposing` off the event into one shared `ComposerKeyEvent`, and asks two predicates in turn (§7) — `shouldInterruptOnKeyDown` first, since [#1072](https://github.com/pyrycode/pyrycode-desktop/issues/1072) added it beneath the type-ahead's own claim, then `shouldSubmitOnKeyDown`. A `true` from the interrupt predicate calls `sendInterrupt` and returns with no `preventDefault()`; otherwise `shouldSubmitOnKeyDown`'s `false` returns without touching the event, and `true` does `preventDefault()` + `handleSubmit()`.

**Reply appends to this same draft (#1779).** The [message actions](conversation-shell-message-bubble.md#the-copy-control)
pass role and current `item.text` to the pane callback. Pure `appendMessageQuote` in `copyMessageText.ts`
preserves the draft exactly, adding one `\n` separator only for a nonempty draft without a final `\n`.
It then appends `User:\n"<source>"\n` or `Assistant:\n"<source>"\n`: a role label on its own line,
straight double quotes around the full source, and an empty line after the closing quote. Markdown,
embedded quotes and line breaks remain literal; attachments are excluded and long sources are never
truncated. The streaming tail quotes the partial source available at activation.

The callback synchronously reads `composerDraftStore.getState()` with retained `selectedHost` and
`openConversationId`, then calls `setDraft`. Repeated replies append in order, preserving drafts for
other chats and hosts even when conversation IDs match. Null coordinates do not write. Saved/offline
chats can quote and edit while Send remains unavailable. Editing and sending use the existing controlled
path: submission still trims outer whitespace, including the quote's final newline, while its label
and literal content remain intact. The append diagnostic contains only a static event and role code.

**Focus requests belong to the pane, not retained drafts.** Each reply increments a counter passed
through `ComposerSlot`. After the value commits, `Composer`'s layout effect focuses the existing
type-ahead textarea ref and collapses selection at `textarea.value.length`, on the empty line below
the quote. Permission coverage keeps the latest request pending; consuming it while hidden would
lose focus on reveal. When coverage clears and the textarea is available, repeated covered replies
focus the final draft once. Later typing or permission cycles do not replay it. Switching chats
remounts the pane and discards pending focus while retaining the quoted draft.

Equal-ID draft isolation is separate from the history writer's ownership rejection tracked in
[#1811](https://github.com/pyrycode/pyrycode-desktop/issues/1811). Its persistence regression remains
skipped; active draft-isolation and ordinary saved/offline reply coverage do not establish equal-ID
history persistence.

### 4. Connection-status gate — `composerAvailability` ([#31](../codebase/31.md))

The send control is gated on the live connection status: while the session is not
`connected`, sending is disabled. Accepted submissions that encounter a main-process
disconnect or handshake gap use the [bounded transport hold](daemon-connection-lifecycle.md#disconnected-composer-message-delivery)
and visible delivery status; the offline Send gate is unchanged.

The decision lives in `composerSend.ts` as a pure, React-free predicate — a *total* mapping over the store's `ConnectionStatus` (from [session store](session-store.md)):

```ts
export interface ComposerAvailability {
  canSend: boolean   // true only when status.type === 'connected'
}
export function composerAvailability(status: ConnectionStatus): ComposerAvailability
```

| `status.type` | `canSend` |
|---|---|
| `connected` | `true` |
| `connecting` | `false` |
| `disconnected` | `false` |
| `error` | `false` |

Through [#968](../codebase/968.md), `ComposerAvailability` also carried `hint: string | null` — a short "why unavailable" caption (`Connecting…` / `Not connected` / `Connection error`), rendered directly above the message box as `<p className="composer__hint" role="status">`. #968 retired the caption and the field: the connection state is said by [the banner](conversation-shell-chrome.md#connection-banner-279) (#279) in every non-connected arm and by [the status row's chip or button](conversation-shell-composer-error-chip.md#composer-error-chip-797) (#797/#963) in the `error` arm, so the caption was a third read in `error` and a second read in `connecting`/`disconnected` — the banner is what survives in every arm. `ComposerAvailability` stays a one-field record rather than collapsing to a bare boolean: the call site already destructures from it, and the ruling was "drop the caption," not "redesign the gate." The function now reads `status.type` and nothing else, so there is no string on this path to leak — the docblock paragraph that used to reserve `ConnectionError.message` for the banner's exclusive use went with the field it was reserving.

Both facts (`canSend` and, before #968, `hint`) derive from the single `selectStatus` read, so there is one source of truth. A `default: assertNever(status)` arm makes a new `ConnectionStatus` arm a compile error — unchanged by #968.

In the container, `Composer` combines connection availability with the
[new-chat model-recall hold](remembered-model.md#eligibility-and-settlement). It selects
whether recall targets this conversation to disable Send, and rechecks the pending
target synchronously in the shared `sendText` path before `submitMessage`. Enter, Actions
and status-area message sends therefore cannot consume drafts or attachments while
recall is pending. The hold ends on correlated settlement or cancellation, not when
the settings command returns; unrelated chats remain available.

### 5. Re-pair gate — `shouldOfferRepair` ([#167](../codebase/167.md))

`shouldOfferRepair` and `shouldOfferReconnect` are pure, disjoint decisions over
`ConnectionStatus`, used by the [composer's actionable-error slot](conversation-shell-composer-repair-button.md).
Since [#1510](https://github.com/pyrycode/pyrycode-desktop/issues/1510), terminal failure alone
cannot offer re-pairing:

```ts
export function shouldOfferRepair(status: ConnectionStatus): boolean {
  return status.type === 'error' && !status.error.retryable && status.error.code === 'pairing-rejected'
}

export function shouldOfferReconnect(status: ConnectionStatus): boolean {
  return (
    status.type === 'error' && !status.error.retryable &&
    status.error.code !== 'pairing-rejected' &&
    status.error.code !== 'unpair' && status.error.code !== 'not-paired'
  )
}
```

A sealed `auth.invalid_token` frame establishes `pairing-rejected`. A bare fatal close,
including 4421 or 4401, establishes only a connection failure and offers Reconnect.
Transport, handshake and unknown terminal error codes therefore take the reconnect arm.
`unpair` is excluded to avoid the failed-removal self-loop; `not-paired` has no saved
host to dial. Both predicates reject retryable errors and every non-error status;
remaining errors retain the chip. Unit tables assert both decisions together so an
accidental overlap cannot pass as two independently plausible gates.

These recovery gates do not enable sending. `composerAvailability` (§4) still:

- **Guards `handleSubmit`** with `if (!canSend) return` at the top — the authoritative gate, blocking the **Enter** path (`handleKeyDown → handleSubmit`) as well as the button. `submitMessage` is never reached while not connected, so no `sendCommand` and no optimistic `dispatch` fire; the input is **not** cleared.
- **Natively disables** the send `<button>` with `disabled={!canSend}` (a disabled button fires no `onClick` — the visible affordance, platform-blocked in addition to the handler guard).

The `<textarea>` stays **enabled** while not connected — the user may draft while `connecting`; only the send control is gated. Selecting `status` re-renders `Composer` when it changes, so the re-enable is reactive; the thread (which selects only `selectMessages`) doesn't re-render on status change.

Through [#968](../codebase/968.md), a third bullet rendered the hint above the input/button row as `<p className="composer__hint" role="status">` — a polite live region so a screen reader announced the status change without stealing focus. That element and its rule (`conversation.css`'s `.composer__hint`) are retired; the announcement isn't lost, since [the connection banner](conversation-shell-chrome.md#connection-banner-279) (#279) is the polite live region for the same transition in every non-connected arm and was already written to avoid double-announcing with the caption. Deleting the caption *is* the 8px between the status row and the message box: `.composer`'s `padding-top` (`--space-2`) was always the caption's own inset, `ComposerStatusArea` renders unconditionally as `.composer`'s sibling, and `.composer__row` is now `.composer`'s first child — so that gap is identical in all four connection states with no new CSS rule.

### 6. Connection banner gate — `shouldShowBanner` / `CONNECTION_BANNER_COPY` ([#279](../codebase/279.md))

A third pure predicate beside `composerAvailability`/`shouldOfferRepair`, over the same
`ConnectionStatus` — whether the conversation screen should render the prominent, disconnected-only
banner across the top of the thread (see
[Conversation shell → Connection banner](conversation-shell-chrome.md#connection-banner-279)).

```ts
export function shouldShowBanner(status: ConnectionStatus): boolean {
  return status.type !== 'connected'
}
```

Unlike `composerAvailability`, this is not an exhaustive per-arm switch: every non-connected arm
(`disconnected`/`connecting`/`error`) maps to the identical behavior (show the banner), so `!==
'connected'` is the honest shape — and its fail-mode is correct, since a hypothetical future 5th
`ConnectionStatus` arm defaults to *showing* the not-connected banner rather than silently hiding it.

`CONNECTION_BANNER_COPY` ships alongside it — a single client-owned string constant. Through [#968](../codebase/968.md)
it was lexically distinct from all three `composerAvailability` hints; those retired with the caption, and
it is now argued distinct from the status row's chip and button strings instead (`COMPOSER_ERROR_CHIP_COPY`
§8, `COMPOSER_REPAIR_BUTTON_COPY` and `COMPOSER_RECONNECT_BUTTON_COPY` §9), so the banner and the row directly above the message box never read
as the same string stacked twice. One constant, not a per-arm map: every non-connected arm is a state
where pyry is unreachable, so one sentence covers all three honestly.

### 7. Keystroke-intent gates — `shouldSubmitOnKeyDown` ([#512](../codebase/512.md)) and `shouldInterruptOnKeyDown` ([#1072](https://github.com/pyrycode/pyrycode-desktop/issues/1072))

A fourth pure predicate in `composerSend.ts`, but on a different axis from `composerAvailability`/`shouldOfferRepair`/`shouldShowBanner` (all of which read `ConnectionStatus` — *may* the composer send): this one reads the keydown itself — *did this keystroke ask* to send. Placed directly after `submitMessage`, not beside the `ConnectionStatus` cluster.

```ts
export interface ComposerKeyEvent {
  key: string
  shiftKey: boolean
  isComposing: boolean   // event.nativeEvent.isComposing — not on React's synthetic event
}
export function shouldSubmitOnKeyDown(event: ComposerKeyEvent): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing
}
```

Plain Enter (no shift, no composition) → `true`; Shift+Enter, a non-Enter key, or — the fix — **the Enter that commits an in-progress IME composition** → `false`. That commit keydown fires with `key === 'Enter'` and `shiftKey === false`, indistinguishable from an ordinary Enter except for `isComposing`; before #512 it both sent the half-composed text and suppressed the commit itself.

The `return` on `false` **precedes** `preventDefault()` — calling `preventDefault()` first and declining to submit second would still break the IME commit, since the candidate never lands. This ordering, not the predicate, is the actual fix; it's why AC1's "no `preventDefault`" is a separate clause from "no wire command."

The predicate deliberately does **not** absorb the `canSend` gate (§4) — that stays authoritative in `handleSubmit`, preserving #31's contract that a disconnected Enter is *swallowed*, not turned into a newline. It also doesn't read the legacy `keyCode === 229`; `isComposing` is the one signal used, since Electron `^33.2.1` is Chromium-only and doesn't need a WebKit fallback.

**`shouldInterruptOnKeyDown`, a fifth pure predicate ([#1072](https://github.com/pyrycode/pyrycode-desktop/issues/1072)), sits directly after this one — same record, same axis (*did this keystroke ask for something*), a different question:**

```ts
export function shouldInterruptOnKeyDown(event: ComposerKeyEvent, turnRunning: boolean): boolean {
  return turnRunning && event.key === 'Escape' && !event.isComposing
}
```

True iff a turn is running, the key is Escape, and the keystroke is not an IME composition. It **reuses `ComposerKeyEvent`** rather than minting a second record — one destructure at each call site answers both questions. `turnRunning` is a second positional argument rather than a field of that record: the record models the keystroke, this models the app's state, and folding them would make `ComposerSendButton`'s call site (where the value is `true` by construction — that variant only renders while a turn runs) read as if the button knew something about the keydown it does not. Both call sites pass `isTurnRunning(phase)`, never `localSendPending`: that scalar opens the working-indicator window while `phase` is still the daemon-owned `idle` (#650), which would arm an interrupt before the daemon has actually started a turn — the same reason the stop button itself ignores it.

`shiftKey` is **deliberately unread** — Escape has no meaningful shifted variant, and `composerSend.test.ts` pins a Shift+Escape case so a later "tidy" that adds a `!shiftKey` clause for symmetry with `shouldSubmitOnKeyDown` reddens instead of shipping unnoticed. `isComposing` is not decorative symmetry either: the slash type-ahead's own handler (`ComposerSlashCommandTypeAhead.tsx`) returns `false` on a composing keystroke *even while its panel is open*, so the Escape that cancels a half-typed IME candidate falls through to this predicate — without the clause, a CJK operator cancelling a candidate mid-turn would stop the turn.

`handleKeyDown` now has three key-bearing branches, not the `shouldSubmitOnKeyDown`-era one: the type-ahead's own claim (`typeAhead.handleKeyDown(event)`, returns first and unconditionally consumes a resolved Escape), then `shouldInterruptOnKeyDown`, then `shouldSubmitOnKeyDown`. The two composer predicates are disjoint by key (`Escape` vs `Enter`), so their relative order is a reading convenience, not a behavioural dependency — Enter's send path is untouched either way. No `preventDefault()` on the interrupt branch: Escape has no default action in a textarea to suppress, and if one is ever added it must sit below a `false` return, the rule this section's IME paragraph above already states for the submit predicate.

A second binding lives outside this module, on `ComposerSendButton`'s running variant itself — see [Interrupt envelope § The render affordance](interrupt-envelope.md#the-render-affordance-307-merged-into-the-send-button-by-678) for why that binding exists (the mouse-send path leaves focus there), how ordering against the screen's other Escape claimants needed no coordination at #1072, and how [#1634](https://github.com/pyrycode/pyrycode-desktop/issues/1634) had to arbitrate explicitly once the background-task panel stopped taking focus.

### 8. Error chip copy — `composerSend.ts` (#797)

The chip's visible copy and hidden prefix share this module with the connection banner
(§6) and both recovery buttons (§9). These are plain constants, not predicates — no
`shouldShowErrorChip` was added beside them. The gate is already the discriminant of the one arm the [composer status row's error chip](conversation-shell-composer-error-chip.md#composer-error-chip-797)
belongs to (`status.type === 'error'`), so a named predicate would only restate that in an export and a
test matrix.

```ts
export const COMPOSER_ERROR_CHIP_COPY = 'Host connection down!'
export const COMPOSER_ERROR_CHIP_PREFIX_COPY = 'Error: '
```

Both carry `CONNECTION_BANNER_COPY`'s three-part contract: a client-owned constant, lexically distinct
from the banner copy (`COMPOSER_ERROR_CHIP_COPY` leads with "Host", sharing no leading word with `Cannot
reach pyrybox…`; its distinctness from the button that replaces it in the same slot is argued in §9's own
docblock), and zero daemon-supplied substring — structural here, not conventional, since the chip view
narrows on `status.type` and never destructures `status.error`. Apostrophe-free like every string in this
module (`renderToStaticMarkup` escapes `'` → `&#x27;`, so a `toContain` only matches verbatim without one).

`COMPOSER_ERROR_CHIP_PREFIX_COPY`'s **trailing space is load-bearing** — it is the separator between the
hidden prefix and the visible copy when a screen reader concatenates them into `Error: Host connection
down!`; an editor's trim would silently degrade the announcement. `composerSend.test.ts` pins it.

These two live here, beside `CONNECTION_BANNER_COPY`, rather than as module-level constants in
`ConversationScreen.tsx` (where `THINKING_COPY`/`STALL_COPY`/`EMPTY_THREAD_COPY` live): every string that
speaks about `ConnectionStatus` lives in this one module, which is what makes the lexical-distinctness
comparison reviewable in one place.

### 9. Actionable-error button copy — `COMPOSER_REPAIR_BUTTON_COPY` ([#963](https://github.com/pyrycode/pyrycode-desktop/issues/963))

The two client-owned labels live beside the connection banner and error-chip copy in
`composerSend.ts`. The corresponding predicate in §5 selects exactly one:

```ts
export const COMPOSER_REPAIR_BUTTON_COPY = 'Pairing error - Re-pair'
export const COMPOSER_RECONNECT_BUTTON_COPY = 'Connection error - Reconnect'
```

Both follow “Type of error - Action” with an ASCII hyphen-minus separator. Their
visible text is their accessible name: no `aria-label`, hidden `Error: ` prefix or
additional live region. The connection banner already announces loss of connectivity.
Both render with `button-small button-small--error` in the same trailing slot.

Error fields select the branch but never supply markup, attributes or accessible copy.
Static-render tests use sentinel messages on both buttons and a sentinel code on
Reconnect; repair must retain the real `pairing-rejected` code to exercise its branch.
See [the actionable-error slot](conversation-shell-composer-repair-button.md) for
host resolution, recovery ownership and interaction coverage.

### 10. Attachments named on the outbound frame — `takeAttachments` ([#1039](https://github.com/pyrycode/pyrycode-desktop/issues/1039), reworked by [#1055](https://github.com/pyrycode/pyrycode-desktop/issues/1055))

`ComposerSendDeps` carries a fifth optional field, `takeAttachments?: () => PendingAttachmentTake` — the
files this message is being sent with, i.e. the uploads that completed since the last send. It follows
`now`'s (§1) trade for the same two reasons: this deps object has thirteen call sites in
`composerSend.test.ts` (above the ten-call-site boundary this pipeline splits at), so requiring the field
would cost thirteen mechanical edits to buy a compile error; and an unwired take means no attachments
rather than a fallback to some other source. It differs from `now` in the one way that decides where it
sits in `submitMessage`: **the take is destructive.** [Composer attach § Pending
attachments](composer-attach-pending.md#pending-attachments-1039)'s implementation, `drainPendingAttachments`,
removes the pending set from its holder *and* hands back the means to put it back:

```ts
export interface PendingAttachmentTake {
  attachments: readonly MessageAttachment[]
  rollback: () => void
}
```

**#1055 moved the read above the guarded send, and that is what forced the shape above.** The taken ids
now ride the outbound `SendMessagePayload.attachment_ids`, so they must be known *before* that payload
literal is built — the read can no longer sit below the send the way `now`'s precedent originally did.
But a send whose `deps.sendCommand` throws named nothing on the wire, so the files it took must still be
attached for the retry (the third acceptance criterion); `rollback` is what makes that possible without
splitting the take into a peek/consume pair, which would reopen the exact double-record window
`drainPendingAttachments`'s "take and clear cannot be split" rule closes. Handing the undo back *with*
the take, rather than as a second optional dep, means a caller cannot hold one without the other and
cannot restore into the wrong holder — the closure captures its own holder.

The take remains below both early `false` returns and above payload construction.
Whitespace-only input or a null conversation takes nothing. One normalized `named`
value feeds the echo's attachments and the payload's `attachment_ids`, preserving
pending-set order. Empty or unwired means `undefined`; JSON encoding omits
`attachment_ids` entirely, never sending `null` or `[]` for a message with none.

The echo is now published to both stores before the bridge call, with `messageId`,
`createdAt` and `attachments: named`. A bridge exception calls `take?.rollback()`,
marks that echo Not sent and returns `false`. Its attachment presentation survives,
while the pending set and draft are restored for resubmission. A failed echo records
what the operator attempted, rather than claiming those files reached the daemon.
Dropping attachments from it would lose the failed message's original presentation.
A bridge call that returns successfully consumes the take even if main subsequently
holds or rejects delivery; that outcome updates the same echo through typed status.

The production call site, `ConversationScreen.tsx`'s `Composer.sendText`, wires
`takeAttachments: attach.takePendingAttachments`, `now: Date.now` and the retained
host ID. Both typed submissions and picked Actions-menu commands reach this helper.
`composerSend.test.ts` checks no take on either early rejection, one take on a real
submission, ordered IDs on the command, and a throwing bridge that rolls back,
retains echo attachments and returns false. `localMessageDelivery.test.ts` exercises
synchronous status reporting after both echo writes and inactive-host isolation.
See [delivery verification](daemon-connection-lifecycle.md#delivery-verification) for
recorded mounted fake-daemon evidence; no new real-Claude acceptance is required.

**No canonical-shape check on the ids here, by deliberate omission.** Upstream (`pyrycode#2038`) mandates
and enforces the lowercase-UUIDv4 check on the *receiver*; this client's own posture for the identical
value class — `RequestAttachmentPayload` — is *documented, not validated*, and the ids this composer
names were minted by this process's own `randomUUID()` in the first place, never read off the daemon. See
the architecture spec's Security review for the full argument.
