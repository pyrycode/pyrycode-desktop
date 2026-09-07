# Composer send (optimistic echo)

The **renderer half of the send flow**: the user types a message in the conversation composer, submits it, and sees it appear in the thread **immediately** — before the daemon confirms it. Typing drives controlled input state; a submit mints a `message_id`, emits a `sendMessage` command over the existing bridge, and appends the just-sent message to the [session store](session-store.md) optimistically. This is the counterpart to the [outbound send path](outbound-send-path.md), which turns that command into an encrypted `send_message` envelope on the relay ([#65](../codebase/65.md)).

Introduced in [#66](../codebase/66.md). Entirely `src/renderer/` — no keys, sockets, Noise handshake, or preload internals; the composer only calls the typed `window.pyry.sendCommand` bridge and dispatches into the store.

## What it does

Wires the previously-inert composer (an uncontrolled `<textarea>`, a click-less send button in the [conversation shell](conversation-shell.md)) into a working send:

- The input is **controlled** — typing updates the composer's own ephemeral state; the input clears after a successful submit; whitespace-only input does nothing.
- **Submit** (the send button or Enter) mints a `message_id` via `crypto.randomUUID()`, assembles a `SendMessagePayload` for the active conversation, and emits `window.pyry.sendCommand(sendMessageCommand(payload))`.
- The just-sent message is appended to the store **optimistically** as a wire `MessagePayload { role: 'user' }`, carrying the **same `message_id`** sent on the wire — so the store's existing `message_id` dedupe drops the daemon's later echo instead of double-posting.
- A failure of the send bridge does not crash the window; the echo still posts.

The optimistic echo only becomes *visible* because [#69](../codebase/69.md) bound the thread to the store. #66 owns the store append (verifiable at the store level); #69 owns the render (`role: 'user'` → a `user` bubble). The two share the store as their seam.

## How it works

Two production changes plus a controlled container.

### 1. The pure submit helper — `composerSend.ts`

Framework-free and React-free, co-located with the screen and mirroring `pairingState.ts` / `messageViewModel.ts`: the effects are **injected**, so the helper is a pure, deterministic function tested with plain spies (no React, no store, no Electron).

```ts
// src/renderer/src/screens/conversation/composerSend.ts — RENDERER ONLY
export interface ComposerSendDeps {
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
the three existing `toHaveBeenCalledWith({ type: 'userText', text })` assertions in
`composerSend.test.ts`, since every deps literal would then supply a clock and every echo would carry a
defined `createdAt` those assertions name none of. So `now` is optional with **no `Date.now` fallback** —
absent clock means no stamp, the same rule [conversation timeline store](conversation-timeline-store.md)'s
`translateTimelineEvent`/`subscribeTimeline` follow for the assistant side. The cost: the wiring at `ConversationScreen.tsx`'s `Composer.sendText` — the one production call site
that builds a `ComposerSendDeps` literal and now includes `now: Date.now` — is not compile-enforced; a
forgotten `now` there would silently ship unstamped echoes. `composerSend.test.ts` pins the wired
behavior with its own spec instead of relying on the type system. See [Thread timeline §
Types](thread-timeline.md#types) for the full field-pair contract and why the clock rides the event
rather than a `reduceTimeline` parameter.

`submitMessage` contract:

1. Trim `text`. If empty (whitespace-only) → return `false`, **no effects**.
2. Mint `message_id` via `deps.newMessageId()` **once**; reuse it for both the wire payload and the store echo.
3. Build `SendMessagePayload { conversation_id: MILESTONE_CONVERSATION_ID, message_id, text: trimmed }` (**no `role`** — that field is `MessagePayload`-only).
4. **Guarded send (AC4):** `try { deps.sendCommand(sendMessageCommand(payload)) } catch { console.error(...) }` — a bridge failure is swallowed, never propagated.
5. Dispatch `{ type: 'messageSent', message: { conversation_id, message_id, role: 'user', text: trimmed } }` — the optimistic echo, a wire `MessagePayload` carrying the **same `message_id`** as step 3.
6. Return `true` (the container clears the input on `true`).

The echo (step 5) and the clear happen **regardless** of the send outcome in step 4 — "optimistic" means show-immediately, and this milestone has no send-failure UI surface.

`MILESTONE_CONVERSATION_ID = 'default'` is the single active conversation for this milestone — the one place a future conversation-selection ticket replaces. There is no pre-existing conversation id in the renderer (`HelloAckPayload` carries `server_id`/`conn_id`, not a conversation), so a stable constant is the correct source; the daemon treats `conversation_id` as opaque and echoes back whatever it is sent.

### 2. The store action — `messageSent`

A small additive arm on the sealed `SessionAction` union in the [session store](session-store.md):

```ts
| { type: 'messageSent'; message: MessagePayload }   // a local optimistic echo
```

```ts
case 'messageSent':
  return { status: state.status, messages: appendUnique(state.messages, [action.message]) }
```

A **distinct name** from `messageReceived` documents intent (a local echo, not a daemon delivery) even though the reducer body is identical — the append routes through the same `appendUnique` (dedupe by `message_id`, added in #27), so the daemon's later echo of the same id drops. `messageSent` is dispatched **only** by the composer; the [daemon-event bridge](daemon-event-bridge.md) produces a subset of `SessionAction` from wire events and needs no change.

### 3. The controlled composer — `ConversationScreen.tsx`

`Composer` becomes a thin controlled container (stays in-file; the logic lives in `composerSend.ts`):

- `const [text, setText] = useState('')` — ephemeral single-value screen-local state (ADR 0006), never the store.
- `const dispatch = useSessionStore((s) => s.dispatch)` — `dispatch` identity is stable, so selecting it adds no re-render churn.
- The `<textarea>` gains `value={text}`, `onChange`, and `onKeyDown`; the send `<button>` gains `onClick={handleSubmit}`. Existing `className`/`placeholder`/`aria-label="Send"`/SVG untouched.
- **Since [#678](https://github.com/pyrycode/pyrycode-desktop/issues/678), that button is `ComposerSendButton`, not a bare `<button>`.** `Composer` also takes a required `phase: TurnPhase` prop from the container and derives `isRunning={isTurnRunning(phase)}` on every render; while a turn is running the control swaps to a stop affordance in place, reusing the same `.composer__send` chrome and the same `aria-label="Send"` string only in the idle branch. `onClick={handleSubmit}`/`disabled={!canSend}` still gate the send branch exactly as above — `isRunning` and `canSend` are independent, so the send-gate logic on this page is unchanged by the swap. See [Interrupt envelope § The render affordance](interrupt-envelope.md#the-render-affordance-307-merged-into-the-send-button-by-678) for the stop variant's own contract.
- `handleSubmit` builds `deps` **inside the handler body** (so `window.pyry` is dereferenced only at interaction time, never during render — this keeps the server-rendered container smoke test crash-free), calls `submitMessage(text, { sendCommand: window.pyry.sendCommand, dispatch, newMessageId: () => crypto.randomUUID() })`, and `setText('')` when it returns `true`.
- `onKeyDown`: reads `key`, `shiftKey`, and `nativeEvent.isComposing` off the event into one shared `ComposerKeyEvent`, and asks two predicates in turn (§7) — `shouldInterruptOnKeyDown` first, since [#1072](https://github.com/pyrycode/pyrycode-desktop/issues/1072) added it beneath the type-ahead's own claim, then `shouldSubmitOnKeyDown`. A `true` from the interrupt predicate calls `sendInterrupt` and returns with no `preventDefault()`; otherwise `shouldSubmitOnKeyDown`'s `false` returns without touching the event, and `true` does `preventDefault()` + `handleSubmit()`.

### 4. Connection-status gate — `composerAvailability` ([#31](../codebase/31.md))

The send control is gated on the live connection status: while the session is not `connected`, sending is disabled, instead of silently swallowing a keystroke that goes nowhere. This is a **UX affordance, not a safety net** — the deterministic no-throw safety on a disconnected send already lives in [#65](../codebase/65.md)'s `daemonConnection.send()` and #66's guarded `sendCommand`; no second guard is added.

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

Through [#968](../codebase/968.md), `ComposerAvailability` also carried `hint: string | null` — a short "why unavailable" caption (`Connecting…` / `Not connected` / `Connection error`), rendered directly above the message box as `<p className="composer__hint" role="status">`. #968 retired the caption and the field: the connection state is said by [the banner](conversation-shell-chrome.md#connection-banner-279) (#279) in every non-connected arm and by [the status row's chip or button](conversation-shell-composer-status.md#composer-error-chip-797) (#797/#963) in the `error` arm, so the caption was a third read in `error` and a second read in `connecting`/`disconnected` — the banner is what survives in every arm. `ComposerAvailability` stays a one-field record rather than collapsing to a bare boolean: the call site already destructures from it, and the ruling was "drop the caption," not "redesign the gate." The function now reads `status.type` and nothing else, so there is no string on this path to leak — the docblock paragraph that used to reserve `ConnectionError.message` for the banner's exclusive use went with the field it was reserving.

Both facts (`canSend` and, before #968, `hint`) derive from the single `selectStatus` read, so there is one source of truth. A `default: assertNever(status)` arm makes a new `ConnectionStatus` arm a compile error — unchanged by #968.

In the container, `Composer` selects `status`, derives `{ canSend }`, and:

### 5. Re-pair gate — `shouldOfferRepair` ([#167](../codebase/167.md))

A second pure predicate beside `composerAvailability`, over the same `ConnectionStatus`: whether the
conversation screen should proactively surface a re-pair escape hatch. Through #167 that was a bare
`Re-pair` text button beneath the composer; since
[#963](https://github.com/pyrycode/pyrycode-desktop/issues/963) it is the filled button that takes the
composer status row's error slot in place of [the chip](conversation-shell-composer-status.md#composer-error-chip-797)
— see [Conversation shell — composer § Actionable-error
button](conversation-shell-composer-status.md#actionable-error-button-and-the-row-that-grows-to-fit-it-963) for
the current surface and [Conversation shell — chrome § Re-pair
control](conversation-shell-chrome.md#re-pair-control-167-folded-into-the-composer-status-rows-error-slot-by-963)
for the retired one. This predicate itself is unchanged by that move, reused byte-for-byte.

```ts
export function shouldOfferRepair(status: ConnectionStatus): boolean {
  return status.type === 'error' && !status.error.retryable && status.error.code !== 'unpair'
}
```

Unlike `composerAvailability`, this is a boolean over the single `error` arm, not a total mapping over
all four — no `assertNever` exhaustiveness switch is needed for a one-arm gate. `!retryable` is the
primary gate (a terminal transport/handshake failure is always non-retryable; a retryable daemon
wire-error like `server.binary_offline` is excluded); `code !== 'unpair'` is a self-loop guard excluding
the synthetic error `runUnpair` ([unpair channel](unpair-channel.md), #166) itself dispatches on a
failed clear — without it, a failed re-pair would immediately re-satisfy the predicate and re-offer
itself. A transient transport drop never reaches `error` at all (the relay supervisor absorbs and
re-dials it), so it is out of scope for this predicate by construction.

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
it is now argued distinct from the status row's two remaining strings instead (`COMPOSER_ERROR_CHIP_COPY`
§8, `COMPOSER_REPAIR_BUTTON_COPY` §9), so the banner and the row directly above the message box never read
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

A second binding lives outside this module, on `ComposerSendButton`'s running variant itself — see [Interrupt envelope § The render affordance](interrupt-envelope.md#the-render-affordance-307-merged-into-the-send-button-by-678) for why that binding exists (the mouse-send path leaves focus there) and how ordering against the screen's seven other Escape claimants needed no coordination at all.

### 8. Error chip copy — `composerSend.ts` (#797)

Two of the three strings this module now owns about the single `ConnectionStatus` fact (with
`CONNECTION_BANNER_COPY` §6 and `COMPOSER_REPAIR_BUTTON_COPY` §9 — [#968](../codebase/968.md) retired the
three `composerAvailability` captions that used to sit beside them, so the set shrank from five to three),
but unlike §4–§7 these are plain constants, not predicates — no `shouldShowErrorChip` was added beside
them. The gate is already the discriminant of the one arm the [composer status row's error chip](conversation-shell-composer-status.md#composer-error-chip-797)
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
comparison between all four reviewable in one place.

### 9. Actionable-error button copy — `COMPOSER_REPAIR_BUTTON_COPY` ([#963](https://github.com/pyrycode/pyrycode-desktop/issues/963))

The third string in the lexical-distinctness family `COMPOSER_ERROR_CHIP_COPY`'s docstring argues for
(`CONNECTION_BANNER_COPY` and this one — [#968](../codebase/968.md) retired the three `composerAvailability`
hints that used to share this set) — the label of the button that takes the chip's slot whenever
`shouldOfferRepair` (§5) is true:

```ts
export const COMPOSER_REPAIR_BUTTON_COPY = 'Pairing error - Re-pair'
```

The design's pattern is "Type of error - Action", and both halves are load-bearing: the type is what
lets this occupant drop the chip's visually-hidden `Error: ` prefix (the label already says it's an
error), and the action is what makes the control read as a button rather than a status. It leads with
"Pairing", sharing no leading word with `Host connection down!` or `Cannot reach pyrybox…`. Apostrophe-free,
ASCII hyphen-minus separator, same reason as its siblings (`renderToStaticMarkup` escapes `'` → `&#x27;`).

**Unlike every string above it, this one is also the accessible name** — the button carries no
`aria-label`, so the visible text is the whole of what a screen reader announces. And unlike the chip's
copy, its zero-daemon-substring guarantee needs a sharper statement: `ComposerErrorChip` narrows on
`status.type` alone and never touches the error arm, while this button's gate (`shouldOfferRepair`)
*reads* `status.error.retryable` and `.code`. Those reads are confined to that predicate's boolean and
reach no markup — see [Conversation shell — composer § Actionable-error
button](conversation-shell-composer-status.md#actionable-error-button-and-the-row-that-grows-to-fit-it-963) for
the structural argument and the sentinel test that pins it.

### 10. Attachments named on the outbound frame — `takeAttachments` ([#1039](https://github.com/pyrycode/pyrycode-desktop/issues/1039), reworked by [#1055](https://github.com/pyrycode/pyrycode-desktop/issues/1055))

`ComposerSendDeps` carries a fifth optional field, `takeAttachments?: () => PendingAttachmentTake` — the
files this message is being sent with, i.e. the uploads that completed since the last send. It follows
`now`'s (§1) trade for the same two reasons: this deps object has thirteen call sites in
`composerSend.test.ts` (above the ten-call-site boundary this pipeline splits at), so requiring the field
would cost thirteen mechanical edits to buy a compile error; and an unwired take means no attachments
rather than a fallback to some other source. It differs from `now` in the one way that decides where it
sits in `submitMessage`: **the take is destructive.** [Composer attach § Pending
attachments](composer-attach.md#pending-attachments-1039)'s implementation, `drainPendingAttachments`,
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

`submitMessage`'s shape, current as of #1055:

```ts
const message_id = deps.newMessageId()
const take = deps.takeAttachments?.()
const named = take !== undefined && take.attachments.length > 0 ? take.attachments : undefined

const payload: SendMessagePayload = {
  conversation_id: conversationId,
  message_id,
  text: trimmed,
  attachment_ids: named?.map((attachment) => attachment.attachmentId)
}

let sent = true
try {
  deps.sendCommand(sendMessageCommand(payload))
} catch (error) {
  console.error('composer send failed', error)
  sent = false
  take?.rollback()
}

const echo: ThreadEvent = {
  type: 'userText',
  text: trimmed,
  createdAt: deps.now?.(),
  attachments: sent ? named : undefined
}
```

**What survives from the pre-#1055 ordering, verbatim: the take is still read exactly once, and still
below both of `submitMessage`'s early `false` returns.** A whitespace-only submit and a submit with no
active conversation each return `false` before `deps.takeAttachments?.()` runs, so neither takes
anything — the operator's attached file survives untouched for the next send. **What no longer survives:
"the echo and its attachments show regardless of the wire outcome."** That was true before #1055 because
attachments were display-only; now that their ids are the very thing the frame names, a throw means the
frame named nothing, so the echo must record nothing too — recording them while also rolling back would
duplicate them on the retry. The echo itself still posts on a throw (`sent` only gates `attachments`, not
the event), and `now`'s "optimistic means show-immediately" still holds for the text.

**One `named` value feeds both the frame and the echo — that is what makes the second acceptance
criterion structural rather than conventional.** It is normalised by one rule (empty or unwired ⇒
`undefined`, the same `taken !== undefined && taken.length > 0` test as before #1055) and gated by one
boolean (`sent`), so the frame and the echo cannot disagree on any path, including the throwing one.
`SendMessagePayload.attachment_ids` is assigned unconditionally from `named?.map(...)` — the `createdAt`
idiom this module already runs — so `JSON.stringify` drops the key entirely when `named` is `undefined`;
a message sent with nothing pending carries **no `attachment_ids` key at all**, never `null` or `[]`. See
[`SendMessagePayload`](../wire/types.ts) and [command channel](command-channel.md) for the wire type and
the `isAttachmentIdList` boundary guard that widened alongside it.

Wired at the one production call site, `ConversationScreen.tsx`'s `Composer.sendText`, beside `now:
Date.now`: `takeAttachments: attach.takePendingAttachments`. `sendText` has two callers — the composer's
own submit and `ComposerActionsMenu`'s picked slash command — and both reach this read, which is correct:
a picked command is a message that was sent, so it records and consumes the pending set exactly as a typed
one does. Like `now`, the wiring is **not compile-enforced** (the field is optional); `composerSend.test.ts`
pins it with its own spec — `takeAttachments` is asserted uncalled for a whitespace-only or null-conversation
submit, called exactly once on a real send, its ids named on the frame in the pending set's order, and a
throwing `sendCommand` both calling `rollback` and leaving the echo without attachments.

**No canonical-shape check on the ids here, by deliberate omission.** Upstream (`pyrycode#2038`) mandates
and enforces the lowercase-UUIDv4 check on the *receiver*; this client's own posture for the identical
value class — `RequestAttachmentPayload` — is *documented, not validated*, and the ids this composer
names were minted by this process's own `randomUUID()` in the first place, never read off the daemon. See
the architecture spec's Security review for the full argument.

## Data flow

```
type in textarea ─▶ setText (local useState)
click Send / Enter ─▶ handleSubmit
                        ├─ !canSend (status ≠ connected)? ─▶ return, no effects (#31 gate)
                        └─▶ submitMessage(text, deps)
                              ├─ trim; empty? ─▶ return false (no effects)
                              ├─ id = newMessageId()          (crypto.randomUUID)
                              ├─ sendCommand(sendMessageCommand(SendMessagePayload))  [guarded]  ──▶ main/#65 ──▶ relay ──▶ daemon
                              ├─ dispatch(messageSent: MessagePayload{ role:'user', same id })     ──▶ sessionStore ──▶ thread (#69)
                              └─ return true ─▶ setText('')
                                                        │
daemon later echoes same message_id ──▶ messageReceived ──▶ appendUnique drops the duplicate
```

## Edge cases and limitations

- **Not connected** ([#31](../codebase/31.md); the caption retired by [#968](../codebase/968.md)) — while `selectStatus` is not `connected`, the send button is `disabled` and the `handleSubmit` early-return inerts the Enter path. No `sendCommand`, no echo, input not cleared. The textarea stays enabled (drafting allowed); the control re-enables reactively on connect. `composerAvailability` never touches `status.error`, so no daemon-supplied string reaches this gate at all; the same non-connected state shows the prominent [connection banner](conversation-shell-chrome.md#connection-banner-279) (#279), which is now the sole announcement of the transition, and in the `error` arm the status row directly above the message box carries [the chip or the re-pair button](conversation-shell-composer-status.md#composer-error-chip-797) (#797/#963).
- **Whitespace-only / empty input** — early `return false`; no send, no dispatch, no clear (AC1).
- **Send-bridge failure** — `try/catch` swallows it (`console.error`); the process does not crash and the optimistic echo still appends (AC4). There is deliberately **no** send-failure UI (no banner, retry, or echo rollback) — the store has no per-message delivery state this milestone. Since #1055, one thing **is** rolled back on this path: a `takeAttachments` take is undone via its own `rollback()`, and the echo's `attachments` field — unlike its `text` — is withheld, because a frame that never reached the bridge named no ids (§10).
- **Daemon re-echoes the sent message** — the same-`message_id` copy is dropped by `appendUnique`; the thread shows one bubble (AC3).
- **DOM interaction is untested.** Only the pure `submitMessage` and `shouldSubmitOnKeyDown` are unit-tested (spies/plain values + a stub id). `onChange`, clear-on-success, and `handleKeyDown`'s own three-statement wiring have no test, because the render harness is `renderToStaticMarkup` (node env), not jsdom — the same deferral [#69](../codebase/69.md) carries, and the one carved out by [#512](../codebase/512.md) is that the IME-vs-plain-Enter *decision* no longer has to live in that untested surface.
- **`auto-grow` on the textarea shipped in #1056** — `field-sizing: content` plus a `max-height` on `.composer__input`, no TSX change; the box grows a line at a time to a five-line ceiling, then scrolls. See [Composer message box § the auto-grow](conversation-shell-composer-message-box.md#the-box-grows-with-the-draft-to-a-five-line-ceiling-1056). *(The "single active conversation, `MILESTONE_CONVERSATION_ID`" limitation this bullet used to name was closed by #448, which added the `conversationId` parameter documented above; the rest of this page's narrative sections still describe the pre-#448/#179 shape and are due a fuller pass — flagged here rather than silently left contradicting the current signature.)*
- **A submit refused by `submitMessage`'s two early `false` returns reads no clock at all**
  ([#1013](https://github.com/pyrycode/pyrycode-desktop/issues/1013)) — `deps.now?.()` sits below both the
  whitespace-only and null-conversation guards, alongside the echo it stamps, so a refused submit performs
  neither the wire send nor the clock read. `now` omitted entirely (as every pre-#1013 test literal is)
  produces an echo whose `createdAt` is `undefined` — a legal item, not a defect; [#1014](https://github.com/pyrycode/pyrycode-desktop/issues/1014)
  draws it as the [thread timeline](thread-timeline.md#edge-cases-and-limitations) meta row's empty slot.
- **A submit refused by `submitMessage`'s two early `false` returns takes no attachments either**
  ([#1039](https://github.com/pyrycode/pyrycode-desktop/issues/1039)) — `deps.takeAttachments?.()` sits at
  the same guarded position as `now`, so a refused submit neither sends nor drains the pending set; the
  files the operator attached survive for the next send attempt. An unwired `takeAttachments`, or one that
  answers an empty array, both produce `echo.attachments === undefined` — the store never sees `[]`. See §
  10 above.

## Related

- [#1039](https://github.com/pyrycode/pyrycode-desktop/issues/1039) — added `takeAttachments` to
  `ComposerSendDeps`, covered in full above (§ 10). Producer: [Composer attach § Pending
  attachments](composer-attach.md#pending-attachments-1039)'s `drainPendingAttachments`, bound to
  `takePendingAttachments` on `useAttachmentUpload`. Consumer: [Thread
  timeline](thread-timeline.md#types)'s `userText.attachments` field.
- [#1055](https://github.com/pyrycode/pyrycode-desktop/issues/1055) — reworked #1039's take into a
  `PendingAttachmentTake` (set + `rollback`), moved the read above the guarded send, and named the taken
  ids on the outbound frame as `SendMessagePayload.attachment_ids` (§10) — the leg that makes an attached
  file actually reach claude, closed on the daemon side since `pyrycode#2036`/`pyrycode#2038`. Boundary
  guard: [command channel](command-channel.md)'s `isAttachmentIdList`. Live proof:
  [real-claude liveness e2e](real-claude-liveness-e2e.md)'s `e2e/real-claude-attachment.spec.ts`.
- [Outbound send path](outbound-send-path.md) / [#65](../codebase/65.md) — the **main/transport half** this drives: the `sendMessage` command becomes an encrypted `send_message` envelope on the live Noise relay session. Together #65 + #66 are the two halves of sending a message.
- [Session store](session-store.md) / [#2](../codebase/2.md) — hosts the `messageSent` action and the `appendUnique` dedupe (added #27) this relies on; #66 closes its "No optimistic send" limitation.
- [Conversation shell](conversation-shell.md) / [#1](../codebase/1.md) — the screen whose inert `Composer` this wires.
- [Command channel](command-channel.md) / [#17](../codebase/17.md) — the `sendCommand` bridge + pure `sendMessageCommand` constructor (which deliberately does **not** mint the id — the composer does).
- [Pairing input screen](pairing-input-screen.md) / [#55](../codebase/55.md) — the pure-logic / thin-container split (`pairingState.ts`) `composerSend.ts` mirrors.
- [ADR 0006 — ephemeral screen-local state](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) · [ADR 0004 — renderer session store / wire types](../decisions/0004-renderer-session-store-reducer-wire-types.md)
- [#66 codebase notes](../codebase/66.md) — implementation summary, patterns, lessons.
- [#31 codebase notes](../codebase/31.md) — the connection-status gate on this composer: `composerAvailability` + the disabled control. The inline "why" caption it originally shipped with was retired by [#968](../codebase/968.md).
- [#968 codebase notes](../codebase/968.md) — drops the `composer__hint` caption and the `hint` field: the connection state is said once, by the banner (#279) and, in the `error` arm, by the status row (#797/#963).
- [#167 codebase notes](../codebase/167.md) — the `shouldOfferRepair` predicate beside `composerAvailability`, and the original `Re-pair` affordance it gated (retired as a separate surface by #963, see below).
- [Conversation shell § Actionable-error button](conversation-shell-composer-status.md#actionable-error-button-and-the-row-that-grows-to-fit-it-963) / #963 — `shouldOfferRepair`'s current surface: a button in the composer status row's error slot, using `COMPOSER_REPAIR_BUTTON_COPY` (§9 above), replacing #167's block beneath the composer.
- [#279 codebase notes](../codebase/279.md) — the `shouldShowBanner`/`CONNECTION_BANNER_COPY` pair beside `composerAvailability`/`shouldOfferRepair`, and the [connection banner](conversation-shell-chrome.md#connection-banner-279) it gates.
- [#512 codebase notes](../codebase/512.md) — the `shouldSubmitOnKeyDown` keystroke-intent predicate: the Enter that commits an IME composition no longer submits or suppresses the commit.
- [#1072](https://github.com/pyrycode/pyrycode-desktop/issues/1072) — added the sibling `shouldInterruptOnKeyDown` predicate (§7) and its two bindings; see [Interrupt envelope § The render affordance](interrupt-envelope.md#the-render-affordance-307-merged-into-the-send-button-by-678) for the second binding and the ordering argument against the screen's other Escape claimants.
- [Conversation shell § Composer error chip](conversation-shell-composer-status.md#composer-error-chip-797) / #797 — the fourth read of `ConnectionStatus`, using `COMPOSER_ERROR_CHIP_COPY`/`COMPOSER_ERROR_CHIP_PREFIX_COPY` (§8 above) in the composer status row's `trailing` slot.
- [Conversation timeline holder](conversation-timeline-holder.md) / [#756 codebase notes](../codebase/756.md) — `dispatchFor`'s target: the keyed store the echo folds into, dual-write alongside the flat `dispatch`, still unread until #758.
- [#1013](https://github.com/pyrycode/pyrycode-desktop/issues/1013) — the optional `now` clock on `ComposerSendDeps`, implementation summary above. [Thread timeline § Types](thread-timeline.md#types) has the full `createdAt` contract; [conversation timeline store](conversation-timeline-store.md) has the mirror wiring for the assistant-side echo.
- [Interrupt envelope](interrupt-envelope.md) — since [#678](https://github.com/pyrycode/pyrycode-desktop/issues/678), the send button this page describes is one component with two variants: `ComposerSendButton` renders send at idle and the stop affordance (that page's subject) while a turn is running. `Composer` is the one render site for both.
