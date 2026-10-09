# Conversation shell — message bubble testing

Static and browser coverage for [message bubbles](conversation-shell-message-bubble.md),
their copy/reply actions and collapsible metadata.

## Testing

**vitest** (static server renders, no DOM): `copyMessageText.test.ts` mocks
`navigator.clipboard.writeText` as a global and asserts the exact string reaches it, a resolved write
returns `true`, a rejected write returns `false` without throwing, and a missing `navigator.clipboard`
returns `false` untouched. With stamped fixtures, `ConversationScreen.test.tsx` asserts the assistant bubble (settled and
in-progress) and the user bubble each end in `.bubble__meta` as the bubble's *last* child (index
ordering against the message text and against `.bubble__markdown`), the user meta row carries
`bubble__meta--user` and the assistant meta row does not. Copy is a `<button type="button">` with
`COPY_MESSAGE_LABEL` inside a direct `.message-actions` sibling: before the user bubble and after
settled or streaming assistant bubbles, including file/image children and fenced code. The meta row
contains no button. Reply follows copy as a second native named button on both sides, including the
streaming tail and attached bubbles; its icon introduces no focus stop. Queued rows carry the text-row
modifier and queued actions column but have no copy, reply or meta;
standalone offers have none of that text-row treatment. The queued row / `MessageBubble` residue
render **zero** `.bubble__meta` (a count assertion over the whole markup, not a per-string absence).
`messageTime.test.ts` covers the
formatter alone — the drawing's own moment verbatim, a single-digit day/month/hour/minute together
(proving all four `padStart`s at once), midnight and 23:59 (24-hour, no meridiem), a sub-minute component
that must not leak into the string, a sub-four-digit year, and the `toLocaleString`/`Intl`-removal case
in [the meta-row reference](conversation-shell-message-bubble.md#the-meta-row). #1014 also added stamped
`assistantText`/`userText` cases to the #969 meta-row `describe` in
`ConversationScreen.test.tsx`. An unstamped user or assistant with no stats emits no metadata;
an unstamped assistant with available stats keeps the details row but omits the time span.
The tests preserve timestamp ordering and last-completed-assistant association.
**#1057's whitespace fix gained no unit test** — `vitest.config.ts`
runs the `node` environment, every renderer spec is a `renderToStaticMarkup` string with no stylesheet
and no layout, and the markup is byte-identical before and after; see
[Whitespace](conversation-shell-message-bubble.md#whitespace-1057) and `e2e/user-whitespace.spec.ts`.

**Playwright** (`e2e/message-copy.spec.ts`, fake-transport tier): the
[clipboard-permission measurement](conversation-shell-message-bubble.md#the-clipboard-permission-srcmainindexts);
the keyboard path (focus + Enter, same clipboard read-back); and the restyle's geometry as
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
reveal over empty row space and on copy/file-button focus with increased bubble and row heights.
Geometry specs reveal metadata before measuring its boxes or text-to-meta spacing;
hidden details have no box.
It also copies a streaming partial reply through the OS clipboard, verifies queued sizing/dimming
and Cancel activation without copy/reply/meta, and guards standalone-offer sizing.
Queued geometry, fixture setup and counted browser/visual evidence are in
[queued-action testing](conversation-shell-conversation-and-modals.md#queued-action-testing). Static tests establish
the image-button markup; the row's `:focus-within` rule applies to image buttons too.

### Metadata collapse verification

[`turn-stats-hover.spec.ts`](../../../e2e/turn-stats-hover.spec.ts) checks collapsed
content-plus-padding height, simultaneous time/stats reveal from empty row space and
focus, persistence while either hover or focus remains, and contraction after both leave.
It covers user timestamps and metrics-free turns at 1280px and 800px. Repeated tail
reveal/collapse and downward wheel navigation through changing metadata must retain
bottom clearance; focusing a row above a held reader with `preventScroll` must retain
the reference row's viewport position through reveal and collapse.

Dispatcher verifier gate 6 at `abef223a1736029cd94967c1019c38561af0dc59`
(2026-10-08, `npx playwright test --reporter=json`) executed 377 tests: 377 passed,
0 failed and 3 skipped. The supplied per-test report confirms both named cases were
present, executed and passed (2 executed, 2 passed, 0 failed, 0 skipped):

- `repeated metadata reveal preserves bottom clearance and held reader position`
- `protected restoration joins partial pages while retaining an expanded tool and content anchor`

The latter retains join, DOM identity, expansion, content-anchor, cursor and request-count
checks after [measured demand positioning and settled Home navigation](development-verification.md#layout-and-input).
The [final verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1899#issuecomment-6068428336)
also records independent comparison with Figma `132:4225` and `814:12025`: rest/hover/focus
captures at 1280×900 and 800×900 show collapsed rest, shared reveal, unchanged metadata
type/ink and 12px top gap, and complete-item wrapping at minimum width. Bottom-clearance
captures at 1280×800 and 800×800 show the revealed tail above input chrome. Reviewed
copies were retained under `/tmp/verifier-1899/metadata-{rest,hover,focus}-{1280,800}.png`
and `/tmp/verifier-1899/metadata-scroll-{rest,focus}-{1280,800}.png`; these are scratch
evidence paths. This is fake-transport acceptance; no live-Claude run was required or performed.

### Action sizing regression

`e2e/message-side-actions.spec.ts` compares bubble heights, row heights and gaps from the
previous bubble at 800×1000 and 1280×1000 window sizes. Three sends produce six delivered
rows, with short/wrapped/short text for both user and assistant roles. The fixture uses
each outbound `message_id` as the reply's turn ID rather than a text-dependent ID,
keeping repeated short sends distinct for the neighbour comparison.

Normal controls fit within a short bubble, so a normal-versus-hidden
comparison would pass without the fix. The test additionally sets each button's
`min-height` to 60px: before containment, short bubbles and rows grew to 116px. It
compares normal, enlarged and hidden buttons with the action columns still present,
requires identical heights/gaps, requires row height to equal bubble height, and checks
that each role's wrapped row is taller than its short rows. The overrides are removed
before screenshots; production dimensions stay as drawn. Static renders cannot prove
these intrinsic-sizing or spacing claims.

**Acceptance evidence (#1896).** Dispatcher verifier gate 6 at
`fd2eb1e8ffaba883c9e872351257aa7b5dcee41d` executed 376 tests: 376 passed, 0 failed,
3 skipped. The [verifier's counted review](https://github.com/pyrycode/pyrycode-desktop/pull/1897#issuecomment-6065682495)
confirms all three side-actions tests were present and passed (3 executed, 3 passed,
0 failed, 0 skipped), including
`copy and reply do not increase short or multi-line bubble heights or neighbour gaps`.
Existing centring, target separation, hover/focus and queued checks passed. The review
also accepted short and wrapped row captures against Figma `808:12242` in `132:4225`;
renderer captures are 800×973 and 1280×973 for the window sizes above. Live Claude was
not required or run for this CSS change.

### Hover and earlier acceptance evidence

**Side-actions hover** (same spec): holds copy focus to reveal metadata before taking boxes,
isolating action paint from metadata reflow. Both message roles at 800px and 1280px, token fill,
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
