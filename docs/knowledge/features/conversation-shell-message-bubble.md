# Conversation shell — message bubble

The desktop text message bubble, its reserved timestamp and optional turn stats, and copy/reply controls
beside it. Text rows are centred within a 900px outer cap, with a 40px far-side inset.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its
edge cases and its links. The bubble's original shipped shape and its `assistantText`/`userText` render
arms are narrated in [Conversation shell — conversation surfaces and
modals](conversation-shell-conversation-and-modals.md#the-interactive-flip--thread-cutover-179).

## The restyle (#969)

Every other part of the desktop chat screen's message area — the tool rows, the fenced code block, the
session-reset separator, the thumbnail, the file row — had already been redrawn from the desktop
Figma (node 102-4, drawn 2026-08-21). The bubble itself still wore the mobile thread's shape (Figma
16-22 / 16-23): three corners at `--radius-md` and one clipped to `--radius-xs`, 12/14 padding, the
mobile fills, body-medium type. `#969` redrew it as the desktop `Message` component (Figma 132:4477
assistant / 132:4508 user) and added the row it draws at the bubble's foot.

**`.bubble`** now carries one shape for both sides: `border-radius: var(--radius-xs)` on all four
corners (the two side modifiers, `.bubble--user` / `.bubble--daemon`, no longer carry a radius line at
all), `padding: var(--space-4) var(--space-5)` (16/20, replacing the mobile 12/14 — and *not* by
repurposing `--space-bubble-x`, which still reads 14px for its two other consumers,
`.tool-row__result`/`.tool-row__input-value` and `.unrecognized-row__raw`, untouched by this ticket),
and the `title-small` emphasized type below in place of body-medium — reversed by [#1113](#type-retuned-to-body-medium-1113)
below, once the drawing itself moved back. Text-message sizing now belongs to the row, as revised by
[#1778](../../specs/architecture/1778-message-side-copy.md) for Figma `Message area` 132:4225.
`.message-row--text` is a centred, 100%-wide border box capped at 900px **including padding**.
Assistant rows reserve 40px on the right; user rows reserve 40px on the left. Delivered rows have a
13px actions column and 12px gap, so a long bubble uses the row's width minus 65px, while short bubbles
hug their content and remain left-aligned for assistant text and right-aligned for user text. The
bubble's 16/20 padding is inside that remaining width. At the 800px minimum window width the row
shrinks with the thread and `.message-row--text > .bubble { min-width: 0; max-width: 100% }` allows
content to wrap beside the actions. The off-grid 900px and 13px values are scoped CSS variables;
40px and 12px use the existing spacing scale.

Apply the modifier only to `TimelineRow`'s `assistantText` and `userText` arms, including the streaming
tail and queued users. The base `.bubble` cap, `min(680px, 75%)`, still serves standalone file offers
and the retired `MessageBubble` path. Changing that base rule would also resize non-text offers that
share `.message-row` and `.bubble`; their chrome and the tool, reset and refusal rows stay as before.

**`.bubble` is deliberately not a flex column**, even though the drawing's `Message` is one with a 12px
gap. The in-progress assistant branch renders `{item.text}` and the streaming cursor `<span>` as sibling
direct children of `.bubble`; a flex column would make each its own flex item and drop the cursor onto
its own line. The drawn rhythm is instead `margin-top: var(--space-3)` on `.bubble__meta`, the only new
sibling this ticket adds and so the only place the rhythm needs to appear.

**Fills and text roles** move from the mobile pair to the desktop one: `.bubble--user` from
`--color-primary-container` / `--color-on-primary-container` text to `--color-on-primary` fill (text
role unchanged); `.bubble--daemon` from `--color-surface-container-high` / `--color-on-surface` to
`--color-on-primary-fixed` fill / `--color-on-secondary-container` text. The drawing types the
assistant bubble's second paragraph in `--color-on-secondary-container` too and its first in
`--color-on-primary-container` — a drawing slip; the ticket picked the first paragraph's role for the
whole bubble since it is the one on the main text node, and the app does not draw the two paragraphs
differently.

**`title-small` — a token family added by this ticket, not written at the call site.** The theme
(`tokens.css`) carried display, headline, title-large/medium, body-large/medium/small and every label
step, but no `title-small` at any weight. Five tokens landed between the title-medium and body-large
blocks, keeping the scale's display→headline→title→body→label order:

| Token | Value |
| --- | --- |
| `--text-title-small-size` | `14px` |
| `--text-title-small-line` | `20px` |
| `--text-title-small-tracking` | `0.1px` |
| `--text-title-small-weight` | `500` (M3's base weight for the step — Figma exposes the emphasized weight only, so this one is not read off the file; ships with no consumer today, on `--text-label-medium-weight`'s precedent that shipping three quarters of a quartet would surprise the next consumer of the step) |
| `--text-title-small-weight-emphasized` | `600` (M3 SemiBold — read from the Figma **variable**, not the export's fallback) |

`.bubble` used the emphasized weight from #969 until [#1113](#type-retuned-to-body-medium-1113) moved
the bubble onto body-medium instead, following the drawing's own reversal; both title-small tokens now
ship with no consumer at all, kept in place rather than removed. **`--text-label-large-*` reads 14/20/0.1
too and is deliberately not borrowed** — the `--text-label-medium-weight-emphasized` token (added by
[#721](../codebase/721.md)) has a comment ruling out exactly that reach and predicting this ticket by
name ("the same node already uses title-small-emphasized, so more are coming"). A bubble typed from the
label vocabulary would be wearing another step's name for a coincidence in the numbers.

### The meta row

`.bubble__meta` is the row every text message bubble now ends in (Figma `Meta row`, 132:4446 assistant /
132:4435 user): `display: flex`, `align-items: center`, `gap: var(--space-2)`, the body-small type
quartet, and `color: var(--color-inverse-primary)` — read from the Figma **variable**, not the export's
fallback hex (`#9dcbfc`), which is the light/dark transposition trap `tokens.css:25-33` already warns
about. `.bubble__meta--user` adds `justify-content: flex-end` (the drawing's `justify-end` on 132:4435;
the assistant row carries none, so the base rule's `flex-start` is already right).

**`min-height: var(--text-body-small-line)` is load-bearing, not decorative.** The row holds
`bubble__meta-time` and optional assistant turn stats; actions are siblings of the bubble. #970 split
into a data slice
([#1013](https://github.com/pyrycode/pyrycode-desktop/issues/1013) — gives the `assistantText`/`userText`
[timeline items](thread-timeline-internals.md#types) an optional `createdAt`) and a render slice
([#1014](https://github.com/pyrycode/pyrycode-desktop/issues/1014) — formats it into this slot), both
shipped. An empty inline element generates no line box, so without the `min-height` the row would collapse
when `createdAt` is absent. The slot keeps its drawn 16px height even then.

**Timestamp visibility follows the whole text row (#1778).** `.bubble__meta-time` uses
`visibility: hidden` at rest and `visibility: visible` under `.message-row--text:hover` or
`:focus-within`. Hovering empty row space or focusing copy, reply, a file button or an image button therefore
reveals the timestamp beneath the text in its existing position. Visibility reserves both width and
height, so revealing or hiding it changes neither bubble nor row dimensions; an absent stamp retains
the empty slot. Using `display: none` here would lose that reservation. Turn stats keep their separate
meta-row hover trigger, described below.

**The time itself is `formatMessageTime(epochMs)` in `messageTime.ts` (new, beside the bubble, the
`copyMessageText.ts` module-plus-spec shape again — 46 + 98 lines).** Pure: `new Date(epochMs)` read with
**local** `getDate`/`getMonth`/`getFullYear`/`getHours`/`getMinutes`, `padStart`-assembled into
`DD.MM.YYYY - HH:MM` (Figma 132:4477/132:4508's `Meta data` node — the full string on every bubble, no
relative or same-day short form). No `toLocaleString`/`toLocaleDateString`/`Intl`: those introduce locale
variation the drawing doesn't call for, and would make an exact-string assertion machine-dependent — one
of the formatter's own unit cases proves this by deleting those methods from `Date.prototype` and `Intl`
out from under the call and asserting the same string still comes back. This is the mirror image of
[`channelListViewModel.formatLastActivity`](channel-list.md)'s **UTC** getters: that formatter
dodges TZ-dependence because a relative-activity label reads the same everywhere, but the drawing's
timestamp is the viewer's own wall clock, so UTC would show the wrong time to everyone outside it. Local
getters are correct here and the flakiness risk moves to the *test* side instead — every expected string in
`messageTime.test.ts` is built from `new Date(y, m, d, h, min)` (never a hardcoded epoch constant), the
exact inverse of local getters, so each case yields the same string in any zone the suite runs in. No
`NaN`/non-finite branch: the only producer of `createdAt` is `Date.now`, so a non-finite epoch is not a
reachable input.

**The render slot: `createdAt === undefined ? null : formatMessageTime(createdAt)`, never `'createdAt' in
item`.** `BubbleMeta` gained one optional prop, `createdAt?: number`, threaded from the `assistantText` and
`userText` arms of `TimelineRow` only — no other row kind gained a call (the tool rows aren't bubbles, the
session-reset separator draws its own timestamp, and the `userText` arm still renders no `BubbleMeta` at
all while a row is queued — see [Conversation shell — conversation surfaces and modals § Queued rows
folded into the
thread](conversation-shell-conversation-and-modals.md#queued-rows-folded-into-the-thread-1214-was-294-drop-since-296-echo-removal-since-1213)).
React renders a `null` child as no children, so the absent case is byte-identical to what #969 always
emitted (`<span class="bubble__meta-time"></span>`) — #1013's contract fixes the read as `=== undefined`
because the reducer assigns the field unconditionally on every arm that carries it, so the key is always
present and only its value distinguishes a stamped item from an unstamped one.

**Timestamp contrast on the bubble fills.**
`--color-inverse-primary` on the two new bubble fills measures 2.67:1 (assistant) and 2.04:1 (user),
against the 4.5:1 AA wants for 12px text — both message texts
are fine (13.3:1 / 10.1:1). Substituting a colour here would put the app and the
Figma out of step, which is the exact failure this redraw exists to unwind; the fix is a Figma-side
change on nodes 132:4446 / 132:4435 and a one-token edit afterwards. Copy now sits outside these fills
and retains inverse-primary ink in every pointer state.

### The copy control

`.bubble__copy` is a `<button type="button">` holding a bare inline `<svg fill="currentColor"
aria-hidden="true">` with the single Font Awesome `copy-solid-full` path (the drawing's `clipPath` is a
full-bleed 11×12 rect and is dropped as the no-op it is). It inherits `--color-inverse-primary` from
`.message-actions` through `currentColor`, retaining the same ink in every pointer state. The background
is transparent at rest; hover adds the layer below. `:focus-visible` draws `outline: 1px solid var(--color-outline)`;
the accessible name remains `Copy message`. There is no confirmation after a copy.

**Reply sits below copy (#1779).** It is a native `<button type="button">` named `Reply to message`,
reachable with Tab and activated by Enter, Space or pointer. Its `bubble__copy bubble__reply` classes
reuse copy's hover layer and visible keyboard outline. The supplied
`reply-solid-full.svg` draws a 13×12px mask on the aria-hidden `.bubble__reply-icon` span, tinted through
`currentColor` with `--color-inverse-primary` (#32628d). Both controls are always visible.

**The hit areas are bigger than the glyphs without growing the row.**
`padding: var(--space-1) var(--space-2)` (4px vertical, 8px horizontal) plus matching negative margins
gives copy a **27×20px** target around its 11×12px glyph and reply a **29×20px** target around its
13×12px glyph. The `--space-3` gap is 12px between glyph margin boxes and leaves 4px between the
targets. Restoring the old 28px target height would make them overlap.

**Hover paints around the glyph, not the full target (#1864).** `.bubble__copy` uses
`position: relative; isolation: isolate`; only the hovered button generates `::before`, with
`position: absolute; inset: 0 var(--space-1)`, `--color-state-hover` fill and `--radius-xs` (6px)
corners. The existing 4px vertical/8px horizontal padding means this inset reaches exactly 4px
past each glyph: a 19×20px copy layer or 21×20px reply layer. Painting the whole target would
extend 8px horizontally. `z-index: -1` keeps the layer behind the glyph within the isolated
button; `pointer-events: none` leaves activation alone. Padding, margins, borders and sizes
stay fixed. Keyboard focus retains its 1px solid `--color-outline` outline and `--radius-full`
button radius; focus alone generates no layer, and leaving hover removes it.

Module-local `MessageActions({ text, role, onReply })` in `ConversationScreen.tsx` is a **direct sibling
of the bubble**: after assistant bubbles (actions on the right), before delivered user bubbles (actions
on the left), including bubbles with code blocks or attachments. `.message-actions` is a fixed 13px
flex column stretching to the bubble's height and vertically centring the whole copy/reply stack,
separated from the bubble by 12px. Queued rows render neither action nor the column.

`BubbleMeta({ side, createdAt, turnStats })` remains the bubble's **last child**, after markdown or the
inline streaming cursor on the assistant side and after user text and attachments on the other. It
contains neither action. Keeping `.bubble` out of flex-column layout preserves the inline cursor;
the existing 12px meta margin supplies the spacing below content.

**Both actions read the same current `item.text`.** Copy calls `copyMessageText` directly; reply uses
`Timeline`'s optional `onReply(role, text)` callback through `TimelineRow`. The streaming tail supplies
its partial source at activation, and later activations see subsequent deltas. Settled assistant text
retains Markdown source; attachment names and bytes are excluded. Reply appends the full literal source
to the pane's retained host/conversation draft; see [the controlled composer](composer-send-internals.md#3-the-controlled-composer--conversationscreentsx)
for format, offline drafting and focus consumption. Copy's clipboard path stays independent.

**Small SVGs must load under the renderer CSP.** Vite would inline the reply asset as a data URL,
which this renderer rejects. The mask URL uses the intrinsic viewport fragment
`reply-solid-full.svg#svgView(viewBox(0,0,13,12))` so Vite emits the unchanged asset as an app-local file
without widening CSP or changing build configuration. A non-`none` computed mask URL alone can pass
while the icon is invisible; browser coverage also decodes that URL and checks its 13×12 intrinsic size.

**Both accessible names are client-owned strings**, `COPY_MESSAGE_LABEL = 'Copy message'` and the
literal `Reply to message`, never interpolated with the message text.
`aria-label={`Copy: ${text}`}` would put relay-peer-authored text
into an attribute, which CLAUDE.md's 2026-08-20 ruling forbids outright — "the control needs an
accessible name" is exactly the requirement that invites that mistake.

### `copyMessageText.ts` (new)

```ts
export async function copyMessageText(text: string): Promise<boolean>
```

A pure-ish helper beside `composerSend.ts` / `dropQueuedMessage.ts`, for the same reason those exist:
the renderer test tier is static server renders with no DOM and no click, so an effect reachable only
from an `onClick` needs its own unit-testable seam. Guards `navigator.clipboard` being absent (returns
`false` without throwing — an insecure origin or a non-browser context), awaits `writeText` inside a
`try`, and on rejection logs `console.error('message copy failed')` — the event name alone, never the
text and never the caught error object. That is `questionResolution.ts`'s posture (event name only)
rather than `composerSend.ts`'s `console.error(msg, error)`: the value in flight is relay-peer-authored
text, and a `DOMException`'s message not carrying that text today is not something to depend on holding
across Chromium versions. Never throws and never propagates — a failed copy must not crash the thread,
and the drawing shows no confirmation on either outcome so none is added.

The text copied is `item.text` — the string the store coalesced from the daemon's `assistant_delta`
frames, upstream of `AssistantMarkdown` — so "the markdown source, not the rendered DOM" (the assistant
side) and "the text as sent" (the user side) both fall out of *where* the helper is called, not from any
un-rendering step inside it. Length is already bounded upstream by `parseInboundMessage`'s
`MAX_PLAINTEXT_BYTES` cap on the decrypted envelope, so no second cap was added here.

`TimelineRow` passes `item.text` to `MessageActions`; its call site is
`onClick={() => void copyMessageText(text)}` — an explicitly voided promise. Native button activation
keeps pointer and keyboard copying on the same path.

**[#1630](https://github.com/pyrycode/pyrycode-desktop/issues/1630) added a sibling,
`copyRichText({ html, text })`, beside this function** — [the markdown reader](conversation-shell-markdown-reader.md#note-actions-menu)'s
Copy as HTML. It writes one `ClipboardItem` carrying both `text/html` and `text/plain` through
the async `navigator.clipboard.write`, under the same posture: feature-checked, never throws,
a failure logs an event name alone. This is a materially different grant than `writeText`
above — an HTML flavour on the clipboard — and § The clipboard permission below now reflects
what that ticket measured, not what this ticket originally documented.

### The clipboard permission (`src/main/index.ts`)

`session.defaultSession.setPermissionRequestHandler` denied every renderer permission unconditionally
before this ticket. Electron routes a user-gesture `navigator.clipboard.writeText` through that same
handler as `clipboard-sanitized-write` — **measured, not assumed**: `e2e/message-copy.spec.ts` seeded
the OS clipboard with a sentinel, clicked the control, and read the clipboard back through the main
process to find the sentinel still there. The write was refused with no exception the renderer could
see; the control was a silently working-looking no-op.

The handler now reads `callback(permission === 'clipboard-sanitized-write')` — **an allowlist of
exactly one string, not a denylist.** A denylist would grant every permission Chromium adds in a future
version by default, the opposite of the posture this handler exists to hold. The allowlist shape also
falls out for free: `clipboard-read` / `clipboard-sanitized-read` stay denied by the same comparison —
read is a categorically worse capability than write (it exfiltrates whatever the user last copied,
routinely a password-manager secret), and nothing in this app needs it. The e2e's second half proves the
negative: it drives `Notification.requestPermission()` (routed through the same handler, not on the
list) and asserts it still comes back denied. Granting the write directly, rather than routing it
through a new `ipcMain` channel in the `shared/ipc/unpair.ts` request/response shape, was a deliberate
choice — that idiom grants the same capability through more code and would have pushed the ticket over
its file-count boundary.

**Correction ([#1630](https://github.com/pyrycode/pyrycode-desktop/issues/1630), measured in
the built app):** `clipboard-sanitized-write` is **not** text/plain only. The async
`navigator.clipboard.write` with a `text/html`-carrying `ClipboardItem` is routed through the
same permission string and is granted by the same `callback(permission ===
'clipboard-sanitized-write')` line — Electron does not distinguish the plain-text `writeText`
call this ticket introduced from the richer `write` call #1630 added. `copyRichText` above is
that second call; the permission handler itself needed no change, since the allowlist is
already scoped to the one string rather than to a flavour.

## Whitespace (#1057)

`.bubble` declares no `white-space`, so it always took the initial `normal` — every newline and every
run of spaces collapsed to a single space. [#607](../codebase/607.md) had already fixed this for the
assistant side, hanging `pre-wrap` on `.bubble--assistant-text` specifically *because* a rule on
`.bubble` would have reached the user bubble too, and never said the user bubble wanted the same
treatment. It stayed unfixed until this ticket: Shift+Enter's newline survives `composerSend`'s
`trim()` all the way to the daemon and back, and the bubble threw it away at paint — a pasted stack
trace or a two-paragraph instruction drew as one run-on line.

The fix is two declarations on `.bubble--user`: `white-space: pre-wrap` (the value #607 already
reasoned out — `normal` loses the break, `pre-line` still collapses runs, `pre` stops wrapping past
the bubble's `max-width` measure, `break-spaces` would widen the box with a trailing run rather than
letting it hang past the edge), plus `.bubble--user > * { white-space: normal }` to stop the
inheritance at the bubble's own bare text node. The reset was not optional: `.bubble__file-name`
([message bubble attachment slots](conversation-shell-message-bubble-attachments.md)) deliberately
ships with no `white-space` rule of its own (#815's measured answer to its own wrapping criterion), so
before the reset landed the inherited `pre-wrap` was its only value and
`e2e/attachment-file-row.spec.ts`'s computed-`normal` assertion went red on the first build. `> *`
rather than a list of today's two filename classes, so a child added to the bubble later inherits the
reset without anyone remembering to add it.

`.bubble--user` reaches every site that draws the user's own words in one declaration — the delivered
`userText` row, the same row while queued (`.message-row--queued`, dimmed via that modifier since
[#1214](https://github.com/pyrycode/pyrycode-desktop/issues/1214) folded the once-separate `QueuedBacklog`
into it, but otherwise the same markup), and the retired `MessageBubble`'s user branch — so all three keep
whitespace with no markup change and no unit-tier edit. An unmatched queued row's text is daemon-supplied
(`QueuedItem.text` over `queue_state`, not a local echo), so this preserves whitespace a hostile daemon
chose; two existing bounds already cover it — `pre-wrap` hangs a trailing run past the line's end rather
than widening the box, and `.bubble`'s `max-width` caps it regardless.

Proven in `e2e/user-whitespace.spec.ts`, a new sibling to `assistant-whitespace.spec.ts` rather than an
extension of it (that file's harness is the assistant delta/turn-end frame builder, unneeded here, and
the ticket demanded it stay unedited). Every whitespace claim is a computed style or a measured box
read through `locator.evaluate()`, never a `toHaveText`/`toContainText` expectation — both hardcode
`normalizeWhiteSpace: true`, so a multi-line text expectation passes identically against the broken and
the fixed build. Six fixtures (control, a long interior space run, three short lines, a blank line
between two paragraphs, a second-line indent, a ~200-character unbroken token) each differ from the
control only in the whitespace the assertion is testing, so *equal is the broken state* rather than the
pass condition:

- The overflow read for the long token is the bubble's own `scrollWidth` against its `clientWidth`, not
  `boundingBox().width` — `.bubble`'s `max-width` caps the box whatever `white-space` says, so a width
  read can never redden. Redden-checked for real: built once with `white-space: pre`, the long-token
  bubble measured `scrollWidth` 1765 against `clientWidth` 486.
- `Range.getClientRects()` does not return one rect per line box under `pre-wrap` — Blink splits the
  range at the preserved newline, so a two-line text reports three rects. The indent assertion uses
  per-character ranges (`setStart`/`setEnd` at one offset) instead, which say *which* line moved rather
  than just how many there are.
- Playwright's `toHaveText` does not normalise a `RegExp`'s *received* text against a multi-line
  string, contrary to `assistant-whitespace.spec.ts`'s own header comment — the collapsed expectation
  failed, reporting a string that still carried the newlines. Costs the existing tier nothing (every
  other `toHaveText` over a user bubble reads a single-line text) but a spec asserting a multi-line
  bubble's text must expect the raw `\n`.

No ADR: the value (`pre-wrap`) was already settled by #607; this ticket only extended where it is
stated. See [architecture spec](../../specs/architecture/1057-user-bubble-whitespace.md) for the full
design and its `## Revisions`, where these three measurements were recorded.

## Type retuned to body-medium (#1113)

The drawing itself reversed: `Message area` 132:4171 now types every message text node at M3
body-medium (Roboto 14/20, tracking 0.25, weight 400) rather than the title-small emphasized step
\#969 read off it on 2026-09-03 — the self-predicted reversal #969's own comment named ("if the thread
reads too heavy in use, the fix is a Figma-side change and a one-line restyle here"). `.bubble`'s four
type declarations swap from the `--text-title-small-*` tokens to `--text-body-medium-*`: size and line
hold at 14/20 in both families, so only tracking (0.1 → 0.25) and weight (600 → 400) move. No markup,
no new token, no geometry change — the streaming tail, the queued row and the retired `MessageBubble`
take the new type by the same inheritance that gave them the old one, and `e2e/user-whitespace.spec.ts`
/ `e2e/attachment-file-row.spec.ts` (`ROW_TOP_IN_BUBBLE_PX = 48`) keep their numbers because both are
geometry reads, not weight or tracking reads.

The `title-small` family (§ above) stays in `tokens.css`, now with zero consumers — kept in place
rather than removed, per the ticket. `--text-title-small-weight-emphasized`'s comment records that: it
is still tied for the heaviest weight in the scale (`--text-label-medium-weight-emphasized` is also
600), with no consumer today.

**Two comments changed for reasons other than the token name.** `.bubble__markdown th, td`'s "NO
font-weight" paragraph had argued the omission from a fact that stopped being true: the scale topped
out at `.bubble`'s own 600, so a token-sourced weight would have *erased* the header/body distinction.
At 400 that argument inverts — an emphasized token would now read heavier than the body around it — so
the comment was rewritten on the new footing even though the decision (no declaration, `<th>`'s UA
`bold` still carries the distinction) didn't move. `.bubble__markdown h1`'s heading-ladder comment, by
contrast, needed no edit: it states `.bubble`'s type as body-medium and justifies h5/h6 by their
500/0.1 sitting *lighter* than the bubble's 400/0.25 — a claim #969's title-small window had silently
made false (title-small-emphasized's 600 outweighed h5/h6's 500, reading the ladder upside down at its
bottom two rungs) and #1113 made true again by accident, with nobody touching that comment.

**A token-name grep alone misses that fourth comment.** It never writes `--text-title-small-*` as a
string, only the step's name in prose. The sweep that finds it is a grep for the step's *name* across
the stylesheet, not for the token — the token-only sweep turned up the three premise-comments that
name it directly (`.bubble`, `.bubble__file`, `.bubble__markdown th, td`); the name sweep is what
confirms the heading comment needed nothing.

No new proof, per the ticket: the change is four token references with no new logic and no geometry,
and the two guarding e2e specs above already read the bubble's live line box and a measured row offset
rather than the swapped tokens, so a wrong token is unobservable in this suite unless it also moves the
geometry.

## The shadow (the 2026-09-05 shadow fix)

Every element of the desktop message area casts one drop shadow (Figma "Content" 132:4012 / "Message
area" 132:3959): X 0, Y 4, blur 5, spread 0, black at 20%. The bubble had none until now; nor did the
tool row or the session-reset separator, which took theirs in the same fix (see
[tool row box](conversation-shell-tool-row-box.md#the-shadow-the-2026-09-05-shadow-fix) and
[session boundaries](conversation-shell-session-and-channel-info.md#session-boundary-delimiter-286-redrawn-690)).
The value is one new token, `--shadow-thread` in `tokens.css`, because four rules in one stylesheet
share it — where the FAB's M3 level-3 shadow stays an inlined literal with a single consumer and a
different value. `.bubble` takes it as `box-shadow`: the design draws the effect on the message
*container* frame, which has no fill and hugs the bubble, so the container's shadow is the bubble's, and
a box-shadow follows the 6px corner. The queued row inherits it through `.bubble--user`, dimmed with the
rest of the row by `.message-row--queued`'s 50% opacity (the region's, before
[#1214](https://github.com/pyrycode/pyrycode-desktop/issues/1214) moved it onto the row).

**The blur is 5, not 2.5.** The design's export prints this one effect two ways:
`shadow-[0px_4px_5px_0px_…]` on the filled tool row and `drop-shadow-[0px_4px_2.5px_…]` on the unfilled
wrapper frames around the bubbles and the separator. A CSS filter's drop-shadow takes its blur as a
standard deviation and box-shadow's blur radius is twice that, so the two numbers are the same effect.
The token records the box-shadow form and its comment says why; reading the filter's number into a
box-shadow halves the design's blur.

**Testing.** `e2e/thread-shadow.spec.ts`, one launch: a real send raises the user bubble and a scripted
one-turn reply, then a pushed `tool_use` and `session_transition` raise the row and the separator. Every
assertion is a computed `box-shadow` or `text-shadow` built from the Figma numbers in Chromium's own
serialisation, so a swapped token or an un-doubled blur reddens. Proved red first against the unpatched
build (`none` on the user bubble). Nothing in the unit tier can observe a computed shadow, and the markup
is byte-identical, so no unit test changed.

## Turn stats on hover (#1566)

Hovering the meta row of a turn's *last* assistant bubble reveals that turn's tokens and wall time —
`12.4k in · 800 out · 41s` — as one more `.bubble__meta` child, never inline in the bubble body. The
numbers ride on `turnBoundary`'s `TurnEndMetrics` (#1565), which a saved offline thread never carries
(`DurableThreadItem` has no such field), so a saved thread's turns show nothing on hover — expected, not
a gap.

**Formatting — `turnStats.ts` (new, beside `messageTime.ts`).** `formatTurnStats(metrics)` builds up to
three segments joined by ` · `, each independently omitted when its value is non-positive or absent (a
duration under one second counts as non-positive too); all three omitted returns `null`. `in` is the
turn's *whole* input — `inputTokens + cacheReadTokens + cacheCreationTokens`, each part counted as 0
unless it is a finite number above 0 — never `inputTokens` alone, which measured between 2 and 18 on
every captured turn and would badly understate the turn by itself. Counts under 1000 print as a rounded
whole number; from 1000 up, `(Math.round(n / 100) / 10).toFixed(1)} + 'k'` — rounding to the nearest
hundred before dividing, so `999` stays `999` and `1000` becomes `1.0k`. Duration is `Math.floor(ms /
1000)` seconds; under 60 it's `Ns`, from 60 up `Mm Ss` with minutes uncapped (`4503000` → `75m 3s`).

**Selection — `turnStatsByItemIndex(items)`, a single forward pass that tracks the index of the last
`assistantText` item seen and resets that tracker on `turnBoundary` only.** The obvious-looking
alternative — reset on `userText` too, since a new user message reads like "the previous turn is over" —
is wrong: a message sent while a turn is still running echoes into `items` *before* that turn's own
boundary arrives, so resetting there would silently drop the running turn's stats out from under it
(recorded as a Lesson learned on the PR). Tool rows between the bubble and the boundary touch neither the
tracker nor the reset, so they never change which bubble the stats attach to. A turn still open when the
timeline renders has no boundary yet and never maps; a boundary following a turn with no assistant text
maps nothing either.

**Render and reveal.** `Timeline` computes the map once per render and threads
`turnStats={map.get(group.index)}` through `TimelineRow` to `BubbleMeta`, which appends it as
`<span className="bubble__turn-stats">` after the timestamp slot — a React text child only, never an
attribute (not even `title`) and never logged, per CLAUDE.md's daemon-text rule. `.bubble__turn-stats {
display: none }`, flipped to `inline` by `.bubble__meta:hover` — `display: none` rather than
`visibility: hidden` because the latter would still reserve the span's width and could widen a short
bubble's meta row while nothing is hovered. Hovering the rest of the message row or focusing copy, reply or
an attachment reveals the timestamp only; it does not reveal stats. Selection and formatting remain
unchanged when copy moves outside the bubble.

**Testing.** `turnStats.test.ts` covers the format's count and duration boundaries and the selection's
tracker behaviour directly; `ConversationScreen.test.tsx` adds one static-render case for a two-bubble
turn. `e2e/turn-stats-hover.spec.ts` is the only place that can prove the hover transition itself (the
unit tier is `renderToStaticMarkup` and cannot hover): it pushes one turn whose `turn_end` carries every
number and one whose carries none, and asserts the meta row's `boundingBox()` height is identical hovered
and not — proving the stats reveal preserves height, not just that the text appears.
For a metrics-free turn, compare **`textContent`**, then assert timestamp visibility separately:
`innerText` omits a hidden timestamp and changes when row hover reveals it, so visible-text equality
would reject the expected timestamp reveal instead of proving that no stats were added.

## What stays untouched

- **The queued row** (a `userText` `TimelineRow` while `queued !== null`, folded off the deleted
  `QueuedBacklog` view since [#1214](https://github.com/pyrycode/pyrycode-desktop/issues/1214) — see
  [Conversation shell — conversation surfaces and modals § Queued rows folded into the
  thread](conversation-shell-conversation-and-modals.md#queued-rows-folded-into-the-thread-1214-was-294-drop-since-296-echo-removal-since-1213))
  reuses `.bubble--user` and `.message-row--text`, taking the centred 900px outer cap and 40px left inset
  while retaining row dimming, attachments and the leading drop control's placement and behavior.
  The delivered row's 12px actions gap does not apply to queued rows. They render no `BubbleMeta`,
  copy, reply or actions column: a queued message has no timestamp and nothing sent yet to copy or quote.
  Its `data-thread-role="queued"` distinguishes it from a
  delivered row's `"user"`, so the two are distinguishable in a markup assertion that counts meta rows
  rather than greping for a class.
- **`MessageBubble`** — the retired, unmounted residue of the coarse `MessageThread` path
  [#179](../codebase/179.md) cut over from (still exported, still unit-tested, never rendered in the
  app) — emits `bubble bubble--user` / `bubble bubble--daemon` and so inherits the original CSS restyle
  and whitespace treatment (#1057) passively. It has no text-row modifier, so it keeps the base width
  cap and gains no `BubbleMeta` or actions. Its tests
  still pin the message text as the bubble's sole child (`data-message-role="user">text m1</div>`).
- **The tool rows and the fenced code block** are untouched by the #969 restyle: they are not bubbles. The
  file row and the image thumbnail — both instances of the same `Message` component's `Slot` — inherit the
  restyle around them but drew no content of their own at the time; both have since shipped. See
  [Conversation shell — message bubble attachment slots](conversation-shell-message-bubble-attachments.md),
  split out to its own document once the two sections' own growth (#816, #1045, #869) pushed this
  overview over the size cap.
- **`.bubble__markdown`** ([Assistant markdown
  renderer](assistant-markdown-renderer.md)) is unaffected structurally: `.bubble__meta` is appended as
  its *sibling* inside `.bubble`, never as its child, so the markdown container's own flex column and 8px
  block-rhythm gap never reach the meta row.
- **Standalone attachment offers** use the base message-row and bubble classes without the text-row
  modifier, actions or meta row. Their old width cap and chrome remain. Tool, session-reset, refusal
  and other non-text rows likewise retain their existing widths. Code-block copy remains inside its
  own code chrome and still copies code independently of the sibling message action.
- **`e2e/assistant-whitespace.spec.ts`** reads `.bubble`'s padding at runtime and asserts inequalities
  against it rather than a literal value, so the 14px → 20px change needed no edit there.

## Testing

**vitest** (static server renders, no DOM): `copyMessageText.test.ts` mocks
`navigator.clipboard.writeText` as a global and asserts the exact string reaches it, a resolved write
returns `true`, a rejected write returns `false` without throwing, and a missing `navigator.clipboard`
returns `false` untouched. `ConversationScreen.test.tsx` asserts the assistant bubble (settled and
in-progress) and the user bubble each end in `.bubble__meta` as the bubble's *last* child (index
ordering against the message text and against `.bubble__markdown`), the user meta row carries
`bubble__meta--user` and the assistant meta row does not. Copy is a `<button type="button">` with
`COPY_MESSAGE_LABEL` inside a direct `.message-actions` sibling: before the user bubble and after
settled or streaming assistant bubbles, including file/image children and fenced code. The meta row
contains no button. Reply follows copy as a second native named button on both sides, including the
streaming tail and attached bubbles; its icon introduces no focus stop. Queued rows carry the text-row
modifier but have no actions, copy, reply or meta;
standalone offers have none of that text-row treatment. The queued row / `MessageBubble` residue
render **zero** `.bubble__meta` (a count assertion over the whole markup, not a per-string absence).
`messageTime.test.ts` covers the
formatter alone — the drawing's own moment verbatim, a single-digit day/month/hour/minute together
(proving all four `padStart`s at once), midnight and 23:59 (24-hour, no meridiem), a sub-minute component
that must not leak into the string, a sub-four-digit year, and the `toLocaleString`/`Intl`-removal case
above. #1014 also added stamped `assistantText`/`userText` cases to the #969 meta-row `describe` in
`ConversationScreen.test.tsx` alongside an absent-stamp case; the 39 pre-existing stamp-free item literals
in that file were left unedited — #1013's optional field is what keeps them compiling, and they remain the
coverage for the empty-slot path. **#1057's whitespace fix gained no unit test** — `vitest.config.ts`
runs the `node` environment, every renderer spec is a `renderToStaticMarkup` string with no stylesheet
and no layout, and the markup is byte-identical before and after; see § Whitespace above and
`e2e/user-whitespace.spec.ts` below.

**Playwright** (`e2e/message-copy.spec.ts`, fake-transport tier): the clipboard-permission measurement
above; the keyboard path (focus + Enter, same clipboard read-back); and the restyle's geometry as
computed style — all four `border-radius` corners equal, `padding` 16/20, and the meta row's
`justify-content` differing between the two sides. Its copy locator now starts from the message row.
`assistant-whitespace` keeps its inert-markdown check inside markdown but counts working controls
at the row, naming both `Copy message` and `Reply to message`; saved-history and offline copy locators
likewise use the row.
Filling the slot broke thirteen *other* specs' bubble text assertions across the fake tier plus four
raw `textContent` reads in the real-claude tier — see
[E2E test harness — scenario history](e2e-harness-scenarios.md) and [Real-claude liveness
e2e](real-claude-liveness-e2e.md#assertions--content-agnostic-two-turn-liveness) for the fix and the sweep
method that finds the next one.

**Side-actions geometry and reveal** (`e2e/message-side-actions.spec.ts`, fake transport): both sides
with long and short text at 800/1280/1800 window widths, centred 900px outer cap, 40px insets,
13px stretching actions column, 12px row gap, centred copy/reply stack, both glyph sizes, 12px glyph
spacing, separate targets and thread overflow containment. Centring copy alone would reject the
correct two-control stack.
It checks unchanged inverse-primary ink on hover/press, a visible keyboard outline, and timestamp
reveal over empty row space and on copy/file-button focus with identical bubble and row dimensions.
It also copies a streaming partial reply through the OS clipboard, verifies queued sizing/dimming
and drop activation without actions/meta, and guards standalone-offer sizing. Static tests establish
the image-button markup; the row's `:focus-within` rule applies to image buttons too.

**Side-actions hover** (same spec): both message roles at 800px and 1280px, token fill,
6px corners and measured 4px glyph-relative bounds for each action. It checks no sibling
layer, identical row/bubble/actions/button/glyph boxes during hover and after leaving,
then real Tab transitions with the existing outline style, width, colour and button radius
and no layer. Static renders cannot establish these paint or interaction claims.

**Hover acceptance evidence (#1864).** Dispatcher gate 6 at `39c71b161b924eaf8af079028390b3523d36bf62`
executed 340 tests: 340 passed, 0 failed, 4 skipped. The [verifier's counted review](https://github.com/pyrycode/pyrycode-desktop/pull/1870#issuecomment-6044032161)
confirms both side-actions scenarios were present and passed (2 executed, 2 passed, 0 failed,
0 skipped), including `copy and reply hover layers surround only the pointed glyph without changing layout or keyboard focus`.
It also confirms all eight assistant-row copy/reply hover/focus captures at 800×800 and
1280×800 matched Figma 840:16132. Live Claude was not required or run for this CSS change.

**Recorded acceptance evidence (#1778).** The dispatcher browser gate on `10d57f51` executed 287
tests: 287 passed, 0 failed, 4 skipped. The [verifier's counted runtime review](https://github.com/pyrycode/pyrycode-desktop/pull/1799#issuecomment-6008316736)
confirms that the named `message-copy`, `user-whitespace`, `assistant-whitespace`, `thread-shadow`
and `turn-stats-hover` regression specs were present, executed and passed with their behavioral
checks preserved. Along with `message-side-actions`, `chat-history-recording` and
`offline-conversation-actions`, that group executed 28 tests: 28 passed, 0 failed, 1 platform skip.
The skipped case is not a pass. No live-Claude evidence is required for this presentation change.

**Reply acceptance evidence (#1779).** On `986c9845`, the dispatcher browser gate executed 314 tests:
314 passed, 0 failed, 5 skipped. The [verifier's counted review](https://github.com/pyrycode/pyrycode-desktop/pull/1812#issuecomment-6027306207)
confirms all four active `e2e/message-reply.spec.ts` scenarios were present and passed, covering
pointer/keyboard append and outgoing text, covered-composer focus, equal-ID host draft isolation and
reopened saved/offline drafting. It also confirms the named side-actions geometry test and task-list
test passed, with all 13 assistant-whitespace scenarios passing. Equal-ID history persistence was
skipped in that run; it is now enabled and checks both protected timelines before reopening the
first host offline and quoting its own reply. All five reply scenarios executed and passed at
`0b0bfe73` (full gate: 322 executed, 322 passed, 0 failed, 4 skipped; reply spec: 5 executed,
5 passed, 0 failed, 0 skipped); see [counted evidence](development-verification.md#equal-id-received-history).
Draft isolation and ordinary offline drafting alone do not prove persistence. SVG decoding and
captures at 1280×800 and 800×800 were accepted against Figma in the earlier review.

**The attachment slots' own coverage (#815, #816, #1045, #869)** is in
[Conversation shell — message bubble attachment slots § Testing](conversation-shell-message-bubble-attachments.md#testing),
alongside the sections that describe what each spec proves.

## Related

- [#1864 architecture spec](../../specs/architecture/1864-message-actions-hover.md) — hover paint geometry and focus preservation.
- [#1779 architecture spec](../../specs/architecture/1779-message-reply.md) — reply wiring, permission
  coverage and the SVG/CSP revision; [composer send](composer-send-internals.md#3-the-controlled-composer--conversationscreentsx)
  owns quote assembly and retained drafts.
- [#1778 architecture spec](../../specs/architecture/1778-message-side-copy.md) — sibling copy,
  text-row sizing and reserved timestamp reveal; includes the saved-history/offline locator sweep
  and the `innerText` versus `textContent` testing revision.
- [#1566 architecture spec](../../specs/architecture/1566-turn-stats-hover.md) — the hover-stats design,
  and [thread timeline internals](thread-timeline-internals.md#types) for `TurnEndMetrics`'s fields on
  `turnBoundary` (#1565), which this ticket reads and never writes.
- [Channel info — session running cost](conversation-shell-session-and-channel-info.md#session-running-cost-as-claudes-estimate-1567) —
  the other consumer of `turnBoundary.costUsdTotal`, showing the session's latest running total rather
  than this section's per-turn figures.
- [#1113 architecture spec](../../specs/architecture/1113-bubble-body-medium-type.md) — the body-medium
  retune, the Figma variable read confirming title-small was withdrawn from the message nodes, and the
  comment sweep that found the three premise-comments naming the token plus the one that only names the
  step.
- [#1057 architecture spec](../../specs/architecture/1057-user-bubble-whitespace.md) — the
  `white-space: pre-wrap` / `> *` reset design, the redden-check evidence, and the `## Revisions`
  where the "inert on the other children" assumption was measured false.
- [#607 codebase notes](../codebase/607.md) — the assistant-side `pre-wrap` fix #1057 extends, and
  the written-out value rationale (`normal`/`pre-line`/`pre`/`break-spaces`) #1057 cites rather than
  re-derives.
- [#969 architecture spec](../../specs/architecture/969-message-bubble-redraw-with-meta-row.md) — full
  design, the clipboard-permission open question and its resolution, and the security review.
- [Conversation shell — markdown reader § Note actions menu](conversation-shell-markdown-reader.md#note-actions-menu) —
  `copyRichText`'s one caller, and the #1630 measurement that corrected this document's
  `clipboard-sanitized-write` claim above.
- [#970](https://github.com/pyrycode/pyrycode-desktop/issues/970) — the parent ticket this meta row's
  timestamp slot was reserved for; split into [#1013](https://github.com/pyrycode/pyrycode-desktop/issues/1013)
  (shipped — gives `assistantText`/`userText` [timeline items](thread-timeline-internals.md#types) an optional
  `createdAt`, no visible change) and [#1014](https://github.com/pyrycode/pyrycode-desktop/issues/1014)
  (shipped — `messageTime.ts` and the render slot, covered in full above), both blocked on this ticket.
- [Conversation shell — message bubble attachment slots](conversation-shell-message-bubble-attachments.md) —
  the file row (#815, #816) and the image thumbnail (#1045, #869) that fill the same `Slot` this bubble's
  restyle passes through untouched; #815/#816/#1045/#1044/#869 architecture specs, #686/#868 split
  history, and the #1028/#1039 record they read are all linked from there.
- [#721 codebase notes](../codebase/721.md) — the code-block redraw that introduced
  `--text-label-medium-weight-emphasized` and the "more `title-small` consumers are coming" comment this
  ticket's tokens fulfil.
- [Conversation shell — conversation surfaces and modals](conversation-shell-conversation-and-modals.md#the-interactive-flip--thread-cutover-179) —
  the bubble's original shipped shape and the queued row's reuse of it.
- [Assistant markdown renderer](assistant-markdown-renderer.md) — `.bubble__markdown`, the sibling
  container this ticket's meta row is appended alongside, not inside.
- [ADR 0003 — M3 theme tokens](../decisions/0003-m3-theme-tokens-css-custom-properties.md) — the
  off-grid-value-gets-a-named-token rule `--space-bubble-x` set the precedent for, which this ticket's
  `title-small` family follows again.
