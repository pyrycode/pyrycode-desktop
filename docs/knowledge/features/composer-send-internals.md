# Composer send — internals

Part of [Composer send](composer-send.md).

## How it works

The submit helper retains ordinary sends before calling the bridge. The controlled
container clears only the unchanged captured draft after successful submission.
Ack-only reset commands use the same bridge path without local retention.

### 1. The pure submit helper — `composerSend.ts`

`submitMessage` is framework-free and React-free. Its bridge, pending store,
identity, clock, diagnostics and attachment take are injected, so unit tests can
exercise the actual pending inventory without mounting React or Electron.

```ts
export interface ComposerSendDeps {
  serverId: string
  threadSend: {
    store: ReturnType<typeof createThreadSendStore>
    deviceId: string | null
    version?: number
  }
  diagnose?: (record: MessageLifecycleDiagnostic) => void
  sendCommand: (command: RendererCommand) => void
  newMessageId: () => string
  now?: () => number
  takeAttachments?: () => PendingAttachmentTake
}

export function submitMessage(text: string, conversationId: string | null, deps: ComposerSendDeps): boolean
```

The [thread runtime](thread-runtime.md#sending-and-authenticated-identity) supplies
captured ownership; private identity material never reaches this helper.
`submitMessage` follows this contract:

1. Trim `text`. Whitespace-only input, a null conversation ID or a missing host
   returns `false` before minting an ID, taking attachments or reading the clock.
2. Mint `message_id` once and take pending attachments once. Build the payload with
   the captured conversation, trimmed text and attachment IDs in pending-set order.
3. Emit the content-free `message-queued` diagnostic. For ordinary sends, build one
   `userText` event with that ID, optional timestamp and attachments, then call
   `retain(host, conversation, deviceId, event)` before the bridge. Synchronous
   feedback can therefore find the row.
4. Skip only that retention step when trimmed text matches the module-private
   `INTERCEPTED_RESET_COMMAND = /^\/(?:clear|reset)(?:\p{White_Space}|$)/u`.
   Matching is case-sensitive and permits arguments after Unicode whitespace.
   Neither a pending row nor a new `localSendPending` is created. `/clear-cache`,
   `/resetfoo`, `/Clear`, `/compact` and `/clear\u200bargs` remain ordinary sends.
5. Call `deps.sendCommand(sendMessageCommand(payload, deps.serverId))` with the same
   payload for both paths. Clear scoped reports at `threadSend.version ?? 0`, then
   return `true`. The container can clear its submitted draft without waiting for
   a socket write or daemon acknowledgement.
6. On a synchronous bridge exception, emit `message-bridge-failed`, roll back the
   attachment take and send `not-sent` feedback to the pending store. Return
   `false` to preserve the draft. A still-local ordinary row retains its text and
   attachments with Not sent feedback; an accepted item remains authoritative.
   A reset has no retained row to mark, but its draft and attachments remain
   recoverable. Diagnostics never log the caught object or payload text.

### 2. Local delivery status and receipt settlement

The pending store owns local rows and the newest send's feedback, scoped by host
and conversation. Transport feedback can change an ordinary pending row to
Sending, Waiting for connection or Not sent. A socket write or generic ack does
not establish daemon acceptance. The
[bounded transport hold](daemon-connection-disconnected-delivery.md#disconnected-composer-message-delivery)
remains independent of renderer settlement.

Only an authoritative `user_message` with usable matching `content.device_id`
and `content.message_id` settles a retained row. Matching text, an equal message
ID on another device, an ack or a session divider is insufficient. Accepted
queued work can show Waiting for Claude until delivery. The
[overview's data flow](composer-send.md#data-flow) describes epoch ownership,
hidden-item settlement and late-feedback handling.

The daemon intercepts `/clear` and `/reset` and only acknowledges them, so retaining
those submissions would strand Sending and leave a row below later delivered
messages. Skipping retention avoids that state without weakening ordinary
settlement or clearing unrelated pending sends. Later transport feedback for a
reset cannot recreate a row. The native
[regression](composer-send-limits.md#ack-only-reset-regression) keeps ordinary sends
pending after ack alone as a control.

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
- Ordinary sends use the scoped pending-send store; intercepted reset commands skip retention.
  Retained drafts do not change `submitMessage`'s send contract.
- The `<textarea>` gains `value={text}`, `onChange`, and `onKeyDown`; the send `<button>` gains `onClick={handleSubmit}`. Existing `className`/`placeholder`/`aria-label="Send"`/SVG untouched.
- **Since [#678](https://github.com/pyrycode/pyrycode-desktop/issues/678), that button is `ComposerSendButton`, not a bare `<button>`.** `Composer` also takes a required `phase: TurnPhase` prop from the container and derives `isRunning={isTurnRunning(phase)}` on every render; while a turn is running the control swaps to a stop affordance in place, reusing the same `.composer__send` chrome and the same `aria-label="Send"` string only in the idle branch. `onClick={handleSubmit}`/`disabled={!canSend}` still gate the send branch exactly as above — `isRunning` and `canSend` are independent, so the send-gate logic on this page is unchanged by the swap. See [Interrupt envelope § The render affordance](interrupt-envelope.md#the-render-affordance-307-merged-into-the-send-button-by-678) for the stop variant's own contract.
- `handleSubmit` calls `sendText(text)` and clears only the selected draft when it returns `true`,
  then emits the content-free `composer-draft-cleared` diagnostic. This is local submit success,
  without a daemon acknowledgement. A caught bridge exception returns false, marks a still-local
  ordinary row Not sent and preserves draft and pending attachments, including for resets.
  Unavailable-host and whitespace-only rejection leave the draft intact
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
disconnect or handshake gap use the [bounded transport hold](daemon-connection-disconnected-delivery.md#disconnected-composer-message-delivery)
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

`ComposerAvailability` remains a one-field `{ canSend }` record. The caption and
`hint` field retired in #968; #2076 moved their surviving connection explanation
into the [Top overlay](conversation-shell-chrome.md#connection-banner-279).
The send gate reads only `status.type`; the host-qualified `useOpenConnectionStatus`
read supplies both it and the overlay. Its exhaustive `assertNever` switch makes a
new connection arm a compile error. A connection change does not change thread data.

In the container, `Composer` combines connection availability with the
[new-chat model-recall hold](remembered-model.md#eligibility-and-settlement). It selects
whether recall targets this conversation to disable Send, and rechecks the pending
target synchronously in the shared `sendText` path before `submitMessage`. Enter, Actions
and status-area message sends therefore cannot consume drafts or attachments while
recall is pending. The hold ends on correlated settlement or cancellation, not when
the settings command returns; unrelated chats remain available.

### 5. Re-pair gate — `shouldOfferRepair` ([#167](../codebase/167.md))

`shouldOfferRepair` and `shouldOfferReconnect` are pure, disjoint decisions over
`ConnectionStatus`, used by the [Top overlay’s recovery actions](conversation-shell-composer-repair-button.md).
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
every non-connected state retains the explanatory overlay pill. Unit tables assert
both decisions together so an accidental overlap cannot pass as two independently plausible gates.

These recovery gates do not enable sending. `composerAvailability` (§4) still:

- **Guards `handleSubmit`** with `if (!canSend) return` at the top — the authoritative gate, blocking the **Enter** path (`handleKeyDown → handleSubmit`) as well as the button. `submitMessage` is never reached while not connected, so no `sendCommand` and no optimistic `dispatch` fire; the input is **not** cleared.
- **Natively disables** the send `<button>` with `disabled={!canSend}` (a disabled button fires no `onClick` — the visible affordance, platform-blocked in addition to the handler guard).

The `<textarea>` stays **enabled** while not connected — the user may draft while `connecting`; only the send control is gated. Selecting the open host’s `status` makes the control re-enable reactively; it does not reconstruct thread rows.

The old `.composer__hint` live region and CSS remain retired. The overlay now owns
one atomic polite connection/restoration region; recovery buttons add no second
announcement. `.composer` retains its existing 8px top inset independently of
connection state.

### 6. Connection banner gate — `shouldShowBanner` / `CONNECTION_BANNER_COPY` ([#279](../codebase/279.md))

The names remain after #2076 retired the banner view. `shouldShowBanner(status)`
returns `status.type !== 'connected'`; `connectionNotice(status)` uses it to return
`null` when connected and fixed client-owned copy otherwise. Pairing rejection
selects the pairing-expired explanation; daemon `update-required` selects
`DAEMON_UPDATE_REQUIRED_COPY`; all other non-connected states use
`CONNECTION_BANNER_COPY`. Error messages never supply visible or accessible text.
See [the exact copy and saved/loading rules](conversation-shell-chrome.md#connection-banner-279).

Unlike the exhaustive send gate, the notice predicate deliberately defaults any
future non-connected arm to showing an explanation. It does not change sending,
retry policy or pairing storage.

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

\#2076 removed `ComposerErrorChip`, `COMPOSER_ERROR_CHIP_COPY` and
`COMPOSER_ERROR_CHIP_PREFIX_COPY`. Connection feedback now uses the single overlay
announcement described in §6. The remaining `.composer-status__error` styling
still serves other reports and per-message delivery feedback; its presence does
not imply a connection chip.

### 9. Actionable-error button copy — `COMPOSER_REPAIR_BUTTON_COPY` ([#963](https://github.com/pyrycode/pyrycode-desktop/issues/963))

The two client-owned labels live beside the connection explanation copy in
`composerSend.ts`. The corresponding predicate in §5 selects exactly one:

```ts
export const COMPOSER_REPAIR_BUTTON_COPY = 'Pairing error - Re-pair'
export const COMPOSER_RECONNECT_BUTTON_COPY = 'Connection error - Reconnect'
```

Both follow “Type of error - Action” with an ASCII hyphen-minus separator. Their
visible text is their accessible name: no `aria-label`, hidden `Error: ` prefix or
additional live region. The connection/restoration pill announces loss of connectivity.
Both actions render with `top-overlay-pill top-overlay-pill--error` in the Top overlay.

Error fields select the branch but never supply markup, attributes or accessible copy.
Static-render tests use sentinel messages on both buttons and a sentinel code on
Reconnect; repair must retain the real `pairing-rejected` code to exercise its branch.
See [the recovery actions](conversation-shell-composer-repair-button.md) for
host resolution, recovery ownership and interaction coverage.

### 10. Attachments named on the outbound frame — `takeAttachments` ([#1039](https://github.com/pyrycode/pyrycode-desktop/issues/1039), reworked by [#1055](https://github.com/pyrycode/pyrycode-desktop/issues/1055))

`takeAttachments?: () => PendingAttachmentTake` claims the completed uploads for
one submission and returns their rollback together:

```ts
export interface PendingAttachmentTake {
  attachments: readonly MessageAttachment[]
  rollback: () => void
}
```

The take is destructive: it clears the pending set and captures its holder in the
undo closure. Splitting it into separate peek and consume operations would reopen
a double-record window. See [pending attachments](composer-attach-pending.md#pending-attachments-1039).

The take happens after all input/host guards and before payload construction.
One normalized `named` value supplies an ordinary row's attachments and the
payload's ordered `attachment_ids`. An absent or empty take yields `undefined`,
so JSON omits the field rather than sending `null` or `[]`.

Reset commands still take and forward attachment IDs despite omitting the local
row. A throwing bridge calls `take?.rollback()` and returns `false` on both paths,
keeping the draft and pending attachments recoverable. A still-local ordinary row
keeps its attempted attachment presentation. A successful bridge return consumes
the take; later transport feedback does not roll it back.

`ConversationScreen.tsx` wires `attach.takePendingAttachments`, `now: Date.now`
and the captured host. Typed submissions and Actions-menu commands share this
helper. `composerSend.test.ts` covers attachment forwarding and rollback for both
reset commands as well as ordinary sends. See the
[native regression](composer-send-limits.md#ack-only-reset-regression) for the
mounted ack-only contract; no real-provider execution is implied.

**No canonical-shape check on the ids here, by deliberate omission.** Upstream (`pyrycode#2038`) mandates
and enforces the lowercase-UUIDv4 check on the *receiver*; this client's own posture for the identical
value class — `RequestAttachmentPayload` — is *documented, not validated*, and the ids this composer
names were minted by this process's own `randomUUID()` in the first place, never read off the daemon. See
the architecture spec's Security review for the full argument.
