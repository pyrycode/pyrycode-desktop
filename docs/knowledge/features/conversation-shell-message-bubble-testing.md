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

### Streaming copy input readiness

Visible streaming text and a cursor do not prove that Copy received an activation.
In the [controlled diagnosis](../../specs/architecture/1976-streaming-copy-synchronization.md#revisions)
on unchanged production at `0057a0afe824ae00594ddfd893dac2f26ca87f70`, an ordinary
hover/down, two animation frames and up reproduced stale OS clipboard text “Hi”.
The committed source was “Streaming partial reply” and trusted pointer-down hit
Copy, but attachment-focus/metadata reflow moved its button 28px upward before
release. Trusted pointer-up hit Reply and click targeted the common actions
container, so Copy's handler never activated. The control executed 3 tests:
0 passed, 3 failed, 0 skipped, zero retries. The same press after readiness repair
executed/passed 3, with 0 failed/skipped and zero retries. This isolates an
input/layout synchronization gap; it does not recover the unavailable historical
event schedule. Green reruns alone did not establish a cause. No production change
was justified.

`side copy and row cap retain sizing while metadata expands on hover and focus`
now checks each setup reply's committed text and cursor disappearance, including
the attached send's third assistant reply, before injecting the independent stream.
It requires four assistant rows and one exact streaming source with a visible
cursor, transfers focus to its Copy button before pressing, then hovers and polls
consecutive animation frames for identical button bounds and thread scroll
offset/content height with both focus and hover held. Ordinary `Locator.click()`
must produce a trusted click receipt and replace the real OS clipboard with exactly
“Streaming partial reply”. An earlier OS readback must equal “Hi”, so stale matching
contents from a preceding execution cannot make the final assertion pass.
Row-cap, geometry, metadata hover/focus, attachment, queued/drop and standalone-offer
assertions remain, as do clipboard-project serialization and
[desktop isolation](e2e-harness-desktop-isolation.md#desktop-isolation-default-tier-launches).

The [acceptance receipts](../../specs/architecture/1976-streaming-copy-synchronization.md#acceptance-receipts)
and [verifier review](https://github.com/pyrycode/pyrycode-desktop/pull/1982#issuecomment-6180570070)
record tested source `0406469c8a7402a58b03fea6b314e43e26223d00` on Linux/Xvfb:

- Named case with retries disabled: 20 executed, 20 passed, 0 failed, 0 skipped.
- Complete configured fake tier, without filtering: 395 executed, 395 passed,
  0 failed, 3 skipped. The named case separately executed/passed 1, with
  0 failed/skipped. Every result in both runs has retry index 0.

The focused clipboard project used one worker; the complete tier retained four
configured workers and clipboard serialization. Existing skips were two
`app-badge-count.spec.ts` cases because app icon badges exist only on macOS, and
`window-reopen-converges.spec.ts` because only macOS retains the app after its last
window closes. No new skips or unrelated failures occurred.
Dispatcher verifier gate 6 at `5e18a7014e34587548ae8a3d03c3c9bd9851bbe5`
(2026-10-14, `npx playwright test --reporter=json`) independently recorded
395 executed, 395 passed, 0 failed, 3 skipped; its per-test report confirms the
named case was present and passed. Raw diagnosis and acceptance archives remain
scratch evidence under `/tmp/builder-1976/`; the linked plan preserves the durable
receipt. No real-Claude acceptance was required or claimed.

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
checks after [measured demand positioning and settled Home navigation](development-verification-layout-and-input.md#layout-and-input).
The [final verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1899#issuecomment-6068428336)
also records independent comparison with Figma `132:4225` and `814:12025`: rest/hover/focus
captures at 1280×900 and 800×900 show collapsed rest, shared reveal, unchanged metadata
type/ink and 12px top gap, and complete-item wrapping at minimum width. Bottom-clearance
captures at 1280×800 and 800×800 show the revealed tail above input chrome. Reviewed
copies were retained under `/tmp/verifier-1899/metadata-{rest,hover,focus}-{1280,800}.png`
and `/tmp/verifier-1899/metadata-scroll-{rest,focus}-{1280,800}.png`; these are scratch
evidence paths. This is fake-transport acceptance; no live-Claude run was required or performed.

### Metadata wheel ordering verification

The [diagnosis](https://github.com/pyrycode/pyrycode-desktop/issues/1955#issuecomment-6176137377)
distinguishes input/layout ordering from fixture readiness. At `9fddff32`, all 42 rows
were rendered; a controlled wheel began at offset 0, content height 3109 and viewport
760, then exchanged hovered rows before scroll delivery. Collapsing the old metadata
anchored upward by 28px while the new reveal replaced that height: offset 2321,
unchanged height 3109, bottom distance 28px. Following never resumed, so resize delivery
could not pin. Twenty stable pre-input frames did not prevent the failure.

Geometry reads can force layout during input delivery. Strengthened setup without
diagnostic reads passed 20/20 on unchanged production (20 executed/passed, 0 failed,
0 skipped, four configured/actual workers, zero retries). A one-shot native wheel
listener reading only `scrollHeight` reproduced the first-clearance 28px failure:
3 executed, 0 passed, 3 failed, 0 skipped before repair; the same control executed/passed
3, with 0 failed/skipped after repair. It neither assigns scroll position nor cancels
input. These are controlled interventions; the original gate's exact event schedule
was not recorded.

The original `3bba3878fc` gate used four configured/actual workers and zero retries:
395 executed, 394 passed, 1 failed, 3 skipped. The named test failed attempt 0 at its
first clearance, remaining 28px short throughout the 5000ms poll. Its same-worktree
focused rerun used four configured / one actual worker: 1 executed/passed,
0 failed/skipped, attempt 0. Green repetitions alone therefore did not prove coverage
of the ordering gap. The retained layout read makes that ordering deterministic.

`repeated metadata reveal preserves bottom clearance and held reader position` now
confirms completed history and more than 1500px overflow, settles pointer/focus and
scroll/content/viewport geometry over 20 consecutive frames, and uses trusted upward
input to reach history start. At both 1280×800 and 800×800 Playwright viewports it
retains downward wheel navigation, repeated tail hover/focus reveal/collapse and
≤1px bottom/input clearance. Held setup proves over 1000px upward movement and bottom
distance with positive offset. A 40px downward nudge must move without snapping to
bottom. The test positively checks the focused row is above the viewport and details
appear/disappear before comparing one immutable reference position through
`preventScroll` focus/reveal/collapse with the original `toBeCloseTo(top, 0)` tolerance.

The [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1956#issuecomment-6176558529)
confirms counted evidence at `bf1973fce0f57527110c0ad3584fdc2819ef636c` on
2026-10-14, Linux x64/Xvfb with shown Electron windows. Both runs configured and used
four workers, with retries disabled; every named-test result was attempt 0:

- Focused repetitions: 20 executed, 20 passed, 0 failed, 0 skipped; the named test
  was present and passed all 20 executions, each exercising both widths.
- Dispatcher full default fake-transport gate 6: 395 executed, 395 passed, 0 failed,
  3 skipped. The named test separately executed/passed 1, with 0 failed/skipped.
  Skips were two app-badge cases and window-reopen convergence.

The focused report was `/tmp/builder-1955/final-complete.json`; full-gate evidence was
`verifier-gate_#1955_6.log`. No macOS/Windows execution or live-Claude proof is claimed.

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
5 passed, 0 failed, 0 skipped); see [counted evidence](development-verification-what-each-test-tier-proves.md#equal-id-received-history).
Draft isolation and ordinary offline drafting alone do not prove persistence. SVG decoding and
captures at 1280×800 and 800×800 were accepted against Figma in the earlier review.

**The attachment slots' own coverage (#815, #816, #1045, #869)** is in
[Conversation shell — message bubble attachment slots § Testing](conversation-shell-message-bubble-attachments.md#testing),
alongside the sections that describe what each spec proves.
