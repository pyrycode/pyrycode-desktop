# Conversation shell — message bubble

The later redraw of the text message bubble: from the mobile thread's clipped-corner shape to the
desktop drawing's `Message` component, plus the meta row and copy control the mobile bubble never had.

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
and the `title-small` emphasized type below in place of body-medium. `max-width: min(680px, 75%)`
stands unchanged — the drawing's one measured width (680px in a 780px column at 1280px) is exactly what
that rule already yields, so there was no drawn constant to switch to.

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

`.bubble` uses the emphasized weight; the base ships dormant. **`--text-label-large-*` reads 14/20/0.1
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

**`min-height: var(--text-body-small-line)` is load-bearing, not decorative.** The row holds two
children: `bubble__meta-time` and the copy control. #970 split into a data slice
([#1013](https://github.com/pyrycode/pyrycode-desktop/issues/1013) — gives the `assistantText`/`userText`
[timeline items](thread-timeline.md#types) an optional `createdAt`) and a render slice
([#1014](https://github.com/pyrycode/pyrycode-desktop/issues/1014) — formats it into this slot), both
shipped. An empty inline element generates no line box, so without the `min-height` the row would collapse
to the glyph's 12px height rather than the drawn 16px whenever `createdAt` is absent — see below.

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
session-reset separator draws its own timestamp, `QueuedBacklog` still renders no `BubbleMeta` at all).
React renders a `null` child as no children, so the absent case is byte-identical to what #969 always
emitted (`<span class="bubble__meta-time"></span>`) — #1013's contract fixes the read as `=== undefined`
because the reducer assigns the field unconditionally on every arm that carries it, so the key is always
present and only its value distinguishes a stamped item from an unstamped one.

**Accepted consequence: the row fails WCAG AA, built as drawn anyway.**
`--color-inverse-primary` on the two new bubble fills measures 2.67:1 (assistant) and 2.04:1 (user),
against the 4.5:1 AA wants for 12px text and the 3:1 it wants for an icon control — both message texts
are fine (13.3:1 / 10.1:1), it is only this row. Substituting a colour here would put the app and the
Figma out of step, which is the exact failure this redraw exists to unwind; the fix is a Figma-side
change on nodes 132:4446 / 132:4435 and a one-token edit afterwards. The control's hover state
(`--color-primary`) incidentally clears both thresholds.

### The copy control

`.bubble__copy` is a `<button type="button">` holding a bare inline `<svg fill="currentColor"
aria-hidden="true">` with the single Font Awesome `copy-solid-full` path (the drawing's `clipPath` is a
full-bleed 11×12 rect and is dropped as the no-op it is). It inherits its resting colour from the row
through `currentColor`; hover brightens to `--color-primary` and `:focus-visible` draws `outline: 1px
solid var(--color-outline)` — `.queued-row__drop`'s existing treatment, since the drawing has no hover,
focus or pressed state of its own and shows no confirmation after a copy.

**The hit area is bigger than the glyph without growing the row.** The glyph is 11×12, far under the
app's 48px target convention, but the row's height is drawn at 16px. `padding: var(--space-2)` plus an
equal negative `margin` gives a 27×28 border box (what the pointer and focus ring get) inside an 11×12
margin box (what the layout gets) — the M3 icon-button container trick, expressed through the spacing
scale with no pixel literal. The negative margin reaches 8px into the row's own gap, stopping at the
timestamp slot rather than overlapping it.

Rendered by a module-local `BubbleMeta({ text, side })` in `ConversationScreen.tsx`, appended as the
bubble's **last child** on both the `assistantText` and `userText` arms of `TimelineRow` — after the
markdown container or the in-progress cursor on the assistant side, after the plain user text on the
other. Append-not-prepend is a hard constraint, not a preference:
`interactiveRoundtrip.test.tsx` pins the byte string `data-thread-role="assistant"><div
class="bubble__markdown"><p>` as the bubble's opening content, and the still-open attachment slots
(#691/#686) will insert themselves above this row simply by being written before it. The in-progress
tail gets the row too — omitting it would reflow the bubble the instant a turn settles, and a partial
reply is exactly as copyable as a finished one.

**No prop threading.** The copy source is the row's own `item.text`, so the click handler is a closure
over that one value calling `copyMessageText` directly — no conversation id, no store read, no
`onDrop`-style injected effect. That is deliberately *not* `QueuedBacklog`'s shape: that injection
exists because a queued row cannot see the conversation id its send needs, which is not this control's
situation. `Timeline`'s prop surface is unchanged, so the ~30 existing `<Timeline` render sites needed
no edits.

**The accessible name is a client-owned constant, `COPY_MESSAGE_LABEL = 'Copy message'`, never
interpolated with the message text.** `aria-label={`Copy: ${text}`}` would put relay-peer-authored text
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

The call site is `onClick={() => void copyMessageText(item.text)}` — an explicitly voided promise.

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
`userText` row, `QueuedBacklog` (dimmed but otherwise the same markup), and the retired
`MessageBubble`'s user branch — so all three keep whitespace with no markup change and no unit-tier
edit. The queued row's text is daemon-supplied (`QueuedItem.text` over `queue_state`, not the local
echo), so this preserves whitespace a hostile daemon chose; two existing bounds already cover it —
`pre-wrap` hangs a trailing run past the line's end rather than widening the box, and `.bubble`'s
`max-width` caps it regardless.

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

## What stays untouched

- **The queued row** (`QueuedBacklog`, [queued backlog + drop
  affordance](conversation-shell-conversation-and-modals.md#queued-backlog--drop-affordance-294-drop-since-296))
  reuses `.bubble--user` with no CSS of its own, so it inherits the new geometry, fill and type, and
  (#1057) the whitespace treatment too — but it renders no `BubbleMeta`: a queued message has no
  timestamp and nothing sent yet to copy. Its `data-thread-role="queued"` distinguishes it from a
  delivered row's `"user"`, so the two are distinguishable in a markup assertion that counts meta rows
  rather than greping for a class.
- **`MessageBubble`** — the retired, unmounted residue of the coarse `MessageThread` path
  [#179](../codebase/179.md) cut over from (still exported, still unit-tested, never rendered in the
  app) — emits `bubble bubble--user` / `bubble bubble--daemon` and so inherits the CSS restyle and the
  whitespace treatment (#1057) passively, but gained no `BubbleMeta` and no code change. Its tests
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
- **`e2e/assistant-whitespace.spec.ts`** reads `.bubble`'s padding at runtime and asserts inequalities
  against it rather than a literal value, so the 14px → 20px change needed no edit there.

## Testing

**vitest** (static server renders, no DOM): `copyMessageText.test.ts` mocks
`navigator.clipboard.writeText` as a global and asserts the exact string reaches it, a resolved write
returns `true`, a rejected write returns `false` without throwing, and a missing `navigator.clipboard`
returns `false` untouched. `ConversationScreen.test.tsx` asserts the assistant bubble (settled and
in-progress) and the user bubble each end in `.bubble__meta` as the bubble's *last* child (index
ordering against the message text and against `.bubble__markdown`), the user row carries
`bubble__meta--user` and the assistant row does not, the control is a `<button type="button">` with
`COPY_MESSAGE_LABEL`, and the queued row / `MessageBubble` residue render **zero** `.bubble__meta` (a
count assertion over the whole markup, not a per-string absence). `messageTime.test.ts` covers the
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
`justify-content` differing between the two sides. Filling the slot broke thirteen *other* specs' bubble
text assertions across the fake tier plus four raw `textContent` reads in the real-claude tier — see
[E2E test harness](e2e-harness.md#edge-cases-and-limitations) and [Real-claude liveness
e2e](real-claude-liveness-e2e.md#assertions--content-agnostic-two-turn-liveness) for the fix and the sweep
method that finds the next one.

**The attachment slots' own coverage (#815, #816, #1045, #869)** is in
[Conversation shell — message bubble attachment slots § Testing](conversation-shell-message-bubble-attachments.md#testing),
alongside the sections that describe what each spec proves.

## Related

- [#1057 architecture spec](../../specs/architecture/1057-user-bubble-whitespace.md) — the
  `white-space: pre-wrap` / `> *` reset design, the redden-check evidence, and the `## Revisions`
  where the "inert on the other children" assumption was measured false.
- [#607 codebase notes](../codebase/607.md) — the assistant-side `pre-wrap` fix #1057 extends, and
  the written-out value rationale (`normal`/`pre-line`/`pre`/`break-spaces`) #1057 cites rather than
  re-derives.
- [#969 architecture spec](../../specs/architecture/969-message-bubble-redraw-with-meta-row.md) — full
  design, the clipboard-permission open question and its resolution, and the security review.
- [#970](https://github.com/pyrycode/pyrycode-desktop/issues/970) — the parent ticket this meta row's
  timestamp slot was reserved for; split into [#1013](https://github.com/pyrycode/pyrycode-desktop/issues/1013)
  (shipped — gives `assistantText`/`userText` [timeline items](thread-timeline.md#types) an optional
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
