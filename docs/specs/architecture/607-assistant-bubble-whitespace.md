# Spec — #607: preserve newlines and paragraph breaks in assistant messages

**Size:** XS (confirmed; PO sized XS). Two production edits — one CSS rule, one className string —
plus one unit-test block and one new e2e spec. Not `security-sensitive` (no parsing, no HTML sink, no
scheme handling), so no security-review pass.

## Files to read first

- `src/renderer/src/screens/conversation/conversation.css:294-336` — the `.bubble` family: the base
  rule (measure, padding, `word-break`, type) and the `--user` / `--daemon` modifiers, then the
  streaming-cursor block. This is where the new rule goes.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:447-466` — `TimelineRow`'s
  `assistantText` arm: the one element the rule must reach, and the cursor `<span>` that shares its
  text run.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:721-728, 750-757, 815-828, 856-862` —
  the four daemon-bubble affordances (thinking / stall / api-retry / compacting). Extract: every one
  of them renders a client-owned single-line constant, and each carries a *third* class beyond
  `bubble bubble--daemon`. Read `:823` in particular — the api-retry counter's leading space lives
  inside a template literal, not in JSX text.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:371-379` — `MessageBubble`, the
  retired coarse path. Extract: its `` `bubble bubble--${message.type}` `` produces a *sixth*,
  dynamic `.bubble--daemon` site that a literal grep does not show (`messageViewModel.ts:14` has
  `type: 'daemon'`). It renders nowhere in the live app; it matters only so the "exactly five sites"
  claim in the ticket body is not taken as complete.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:88-150` — the `Timeline` unit
  idiom (`renderToStaticMarkup` + substring assertions) the new unit block clones. Note `:113`
  asserts `toContain('bubble bubble--daemon')`: the new class must be **appended**, never inserted
  between those two tokens.
- `e2e/thread-scroll-pin.spec.ts` (whole file, ~300 lines) — the pattern for this ticket's e2e:
  spec-local frame builders, a multi-turn `buildReplyFrames`, and `locator.evaluate()` reading real
  DOM geometry. It is the only locator-level DOM measurement in the suite; clone its shape.
  **Its comment at `:57-62` contains a claim this ticket falsifies** — see § Traps.
- `e2e/send-and-stream.spec.ts:26-89` — the minimal single-turn `assistant_delta` + `turn_end`
  builders and the `#448` conversation-id guard, carried into the new spec.
- `e2e/fixtures/launchPairedApp.ts:63-89, 142-166` — `SEEDED_ROW`, `seedConversationsFrame`, and how
  a scripted `buildReplyFrames` takes over seeding on its `default` arm.
- `src/renderer/src/theme/tokens.css:68` — `--text-body-medium-line: 20px`, the line box the height
  assertion measures in. Read it to confirm the token exists; the test reads the *computed* value,
  never this literal.
- `vitest.config.ts:27` — `environment: 'node'`. This is why no unit test can observe the fix.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-8

The daemon bubble (`16:26`, `16:43`, `16:55`) is a left-aligned `surface-container-high` box with
`on-surface` body-medium text, `word-break: break-word`, and the 20/20/20/6 radius — all of which
`.bubble` / `.bubble--daemon` already implement and this ticket leaves untouched. Two things in the
design are worth carrying forward: the mock's one multi-block reply (`16:43`) separates prose → code
block → prose as **stacked children with an 8px gap**, and the code block itself (`16:49`) is drawn
`whitespace-pre-wrap` — so preserved whitespace is the design's own treatment for verbatim daemon
content, and multi-part replies are meant to read as separated blocks rather than as a run-on line.
This ticket reaches that reading through the plain-text route only: a preserved blank line yields a
full 20px line box rather than the design's 8px block gap. Closing that gap needs block-level
parsing, which is #609's markdown work, not this slice's.

## Context

At this ticket's implementation, assistant text rendered as a bare text node inside `.bubble`
(`ConversationScreen.tsx:454`). `.bubble`
sets the measure, padding, `word-break` and type but no `white-space`, so the initial value `normal`
applies: every newline and every run of spaces collapses to a single space. A multi-paragraph reply
arrives as one run-on block. Reported by the operator on 2026-08-20 while using the app as his
day-to-day client.

This was the whitespace half of #598. The markdown siblings (#608/#609/#610) initially
kept the in-progress tail plain while rendering settled messages as markup, so this
rule continued to serve the streaming path. The original expectation that it would
remain necessary permanently was superseded by
[#1751's progressive markdown](1751-progressive-assistant-markdown.md).

Current behavior: both branches render through `AssistantMarkdown` inside
`.bubble__markdown`, whose block rhythm owns whitespace; the assistant-tail `pre-wrap`
modifier is removed, while code bodies retain their own wrapping/preservation rules.
The streaming helper parses only the unfrozen tail, freezing verified independent units
with stable identity and memoized rendering. Any reference definition, including a nested
definition or next-line title, switches to whole-reply parsing/rendering. Pending inline
syntax shows unformatted, untappable text; pending table headers show cells separated by
spaces with partial delimiters hidden until a complete separator establishes a table.
Unclosed fences already render as code through the shared parser. `turn_end` or a following
tool row settles using original `item.text`, so unfinished syntax may become literal again.
The decorative cursor follows the markdown container before metadata and disappears on
settlement. Raw HTML escaping, alt-only images, the GFM table/task-list/strikethrough subset
and `allowedLinkHref`/`markdownLinkPath` allowlists remain unchanged; no `rehypePlugins`,
`skipHtml` or raw markup sink is added. The design and tests below describe #607's historical
plain-text implementation; current usage and limitations are in
[the renderer overview](../../knowledge/features/assistant-markdown-renderer.md#configuration-and-usage).

## Design

### The anchor: a new `.bubble` modifier, not `.bubble--daemon`

Add `bubble--assistant-text` to the assistant-text bubble's className at
`ConversationScreen.tsx:453` and hang the rule on that class alone:

```css
.bubble--assistant-text {
  white-space: pre-wrap;
}
```

Appended, so the string stays `"bubble bubble--daemon bubble--assistant-text"` — the existing unit
assertion at `ConversationScreen.test.tsx:113` matches the substring `bubble bubble--daemon` and must
keep passing untouched. Place the CSS rule immediately after `.bubble--daemon` (`conversation.css`
:312-316), before the cursor block, with a comment in the file's house style. Source order carries no
cascade meaning here — nothing else declares `white-space` on these elements — so placement is purely
for readability.

Three anchors were available and two are worse:

- **`.bubble`** reaches `.bubble--user` (`:306`) and breaks the fifth criterion outright.
- **`.bubble--daemon`** reaches the four affordances plus the dead `MessageBubble` daemon path. It
  would in fact be *visually* inert — all four copies are single-line client-owned constants with no
  newline and no multi-space run, and the api-retry counter's leading space (`:823`) is a single
  space that renders identically under `normal` and `pre-wrap`. But "inert because we read the four
  string literals" is a claim that has to be re-verified every time a fifth affordance is added,
  whereas a modifier makes the fourth and fifth criteria true *by construction*: the rule provably
  cannot reach an element that does not carry the class.
- **`.bubble[data-thread-role='assistant']`** needs no markup change at all, but it would be the
  first `data-*` style hook in the renderer — the existing attribute selectors are all `aria-*`
  (`conversation.css:1359`, `archive.css:116`), where the repo's stated reason is that the ARIA state
  is the single source of truth. `data-thread-role` is an e2e/role marker; styling off it couples the
  stylesheet to a test hook. The `.bubble--<variant>` modifier is the established idiom here
  (`--thinking`, `--stall`, `--api-retry`, `--compacting`).

The name mirrors the timeline item kind it renders (`case 'assistantText'`), so the class says which
row owns it. It is also the seam #609 will need: when markdown lands, the settled path gets its own
container and this class marks what stays plain text.

### The value: `pre-wrap`, uniquely

The three positive criteria form a decision table over the candidate values, and together they leave
exactly one:

| criterion | eliminates |
|---|---|
| a blank line renders as a visible break | `normal` |
| runs of spaces and leading indentation survive | `pre-line` |
| a long unbroken token still wraps, no h-scrollbar | `pre` |

`break-spaces` is deliberately not used: it differs from `pre-wrap` by pushing preserved spaces onto
the next line instead of hanging them, which lets a long run of daemon-supplied spaces contribute to
the box's layout. `pre-wrap` hangs them, so untrusted whitespace cannot affect the measure.

`word-break: break-word` is **already** on `.bubble` (`:298`) and is what carries the third criterion
once wrapping is allowed at all. Confirm it is there; do not re-add it or an `overflow-wrap`
equivalent.

### What changes

1. `src/renderer/src/screens/conversation/conversation.css` — the new rule + its comment.
2. `src/renderer/src/screens/conversation/ConversationScreen.tsx:453` — append the class.
3. `e2e/thread-scroll-pin.spec.ts:60` — amend one clause of a comment that this change falsifies (see
   § Traps). In scope because it is a statement *about the rule being added*, capped at that clause.

Nothing else. No component structure change, no wrapper element around `{item.text}`, no change to
the cursor `<span>`.

## State + concurrency model

None. A declaration in a stylesheet plus a static class token; no store slice, no async work, no
subscription, no teardown. The transport, decode and reducer paths are untouched — daemon text
already carries its newlines intact through the codec and `threadTimeline.appendDelta`; only
rendering discards them today.

## Error handling

None to add. There is no new failure mode: the property either applies or the rule is missing, and
the e2e computed-style assertion is what distinguishes those. No user-facing surface, no result type,
no banner.

## Testing strategy

Two tiers, and they are deliberately different fabric: the unit tier pins **which element carries the
rule** (a markup fact), the e2e tier pins **what the browser does with it** (a layout fact). Neither
tier can do the other's job — vitest runs `environment: 'node'` (`vitest.config.ts:27`) with no DOM
and no stylesheet, so a whitespace-*rendering* assertion is not expressible there at all.

### Unit — `ConversationScreen.test.tsx`, appended to the existing `Timeline` describe

Server-render assertions in the `:109-123` idiom:

- An `assistantText` item's bubble carries `bubble bubble--daemon bubble--assistant-text`, and the
  pre-existing `bubble bubble--daemon` substring is still present (guards the append order).
- A settled (non-tail) `assistantText` item renders its text **immediately** after the opening tag —
  `data-thread-role="assistant">` directly followed by the text, and the text directly followed by
  `</div>`. This is new coverage that only matters after this change: under `pre-wrap`, any stray
  whitespace in the JSX between the tag and `{item.text}` (or between the text and the cursor) would
  become *visible*. The JSX transform strips whitespace-only lines containing a newline, so it is
  already correct — this assertion is what keeps it correct.
- Text containing `\n\n` and a multi-space run survives into the markup byte-for-byte (React escapes
  markup characters, never whitespace) — proves nothing upstream of CSS is normalising.
- The blast-radius guard: `ThinkingIndicator`, `StallIndicator`, `ApiRetryIndicator`,
  `CompactingIndicator` and the `userText` bubble each render markup that does **not** contain
  `bubble--assistant-text`. Five cheap `not.toContain` assertions that make the fourth and fifth
  criteria structural rather than argued.

### e2e — new `e2e/assistant-whitespace.spec.ts`

A new file rather than an extension of `send-and-stream.spec.ts`: that spec's single
`toHaveText(REPLY_TEXT)` assertion targets a bare `.bubble[data-thread-role="assistant"]` locator, so
adding turns to its stream breaks it on strict-mode multiplicity. #601 set the precedent of shipping
the liveness proof as its own spec beside the fix.

**The vacuity trap this spec exists to avoid:** `toHaveText` hardcodes `normalizeWhiteSpace: true` on
both its string and regex branches (`playwright/lib/matchers/expect.js:12478,12483`), and
`useInnerText` does not opt out — the actual text is trimmed and every whitespace run collapsed
before comparison. A multi-line text expectation therefore passes identically against the broken and
the fixed rendering. Every whitespace assertion below is either a computed style or a geometric
measure, read through `locator.evaluate()` in the `thread-scroll-pin.spec.ts:179-184` idiom.

One send, answered with four turns (each an `assistant_delta` + its `turn_end`, distinct `turn_id`,
so each becomes its own bubble and the trailing `turnBoundary` leaves no streaming cursor anywhere to
perturb the measurements). The four texts are chosen so that three of them are *comparisons against
the first*, which removes every magic number:

| turn | text | role |
|---|---|---|
| 1 | `Alpha Beta` | the control: one line, one internal space |
| 2 | `First paragraph.\n\nSecond paragraph.` | the paragraph case |
| 3 | `Alpha` + 24 spaces + `Beta` | the space-run case — identical to the control once collapsed |
| 4 | one ~200-character unbroken token | the long-token case |

Settle gate before measuring: wait for four assistant bubbles, then for the fourth's exact text — the
long token contains no whitespace, so normalization cannot make that wait vacuous, and an exact match
proves the whole stream landed and layout is final.

Scenarios:

- **The rule reaches the element.** The assistant bubble's computed `white-space` is `pre-wrap`. This
  is the decision table above, asserted directly: it fails under `normal` (no rule), `pre-line` (the
  space-run criterion) and `pre` (the wrap criterion) alike, and it proves the class, the stylesheet
  and the cascade all line up in the *built* app.
- **A blank line is a visible break.** Bubble 2 is taller than bubble 1 by more than one line box,
  with the line height read from the element's own computed style, never hardcoded. Under `normal`
  the two bubbles are the same height, since both collapse to one short line. This is the assertion
  that covers the whole path — a daemon-supplied `\n\n` through codec, store and render into layout.
- **Space runs survive.** Bubble 3 is strictly wider than bubble 1. `.bubble` shrink-wraps to its
  content inside the flex `.message-row` (up to `max-width`), and bubbles 1 and 3 differ only in
  collapsed spaces, so equal widths *is* the broken state and no threshold constant is needed.
- **The long token still wraps.** Bubble 4's `scrollWidth` does not exceed its `clientWidth`, and
  `.conversation__thread`'s `scrollWidth` does not exceed its `clientWidth` (no horizontal
  scrollbar). Under `pre` both overflow. Allow at most 1px on each for sub-pixel rounding, and say so
  in a comment. The `max-width` cap itself is `.bubble`'s pre-existing rule and is not restated in
  the test.

Standing spec conventions to carry: the `#448` guard (reply only when the inbound `conversation_id`
is the opened row's), fixed envelope ids and `ts` (no `Date.now()`, no randomness), the `default` arm
seeding via `seedConversationsFrame()`, and secret hygiene — every assertion reads geometry, computed
style, text or counts only; the reply texts and turn ids are non-secret display literals.

Gates: `npm test`, `npm run build`, `npm run e2e`.

## Traps

- **`e2e/thread-scroll-pin.spec.ts:57-62` will be lying.** Its comment justifies streaming separate
  turns rather than newlines with two reasons, the second being "*`.bubble` sets no
  `white-space: pre-wrap`, so a newline buys no height at all*". After this change that clause is
  false. The decision it defends is still correct on its first reason alone (same-turn deltas
  coalesce into one bubble in `threadTimeline.appendDelta`), so amend the clause — do not restructure
  the comment, and do not change what that spec streams.
- **`conversation.css:774`'s comment is a false friend.** It says `.screen-snapshot__screen` reuses
  `.bubble--daemon`. It does not: the JSX at `ConversationScreen.tsx:998` puts only
  `screen-snapshot__screen` on that `<pre>`, which declares its own `white-space: pre` (`:789`) and
  duplicates the fill/radius/padding rather than composing the class. Do not derive blast radius from
  that comment — and do not fix it either; it is out of this ticket's scope.
- **The sixth `.bubble--daemon` site.** A literal grep finds five; `MessageBubble` (`:374`) builds a
  sixth dynamically for `type: 'daemon'`. Under this design the count is irrelevant (the rule hangs
  on a different class), but the ticket body's "exactly five" is worth not trusting as complete.
- **The streaming cursor collides with the feature, by design.** The cursor `<span>` is a sibling of
  `{item.text}` in the same text run. With whitespace preserved, a reply whose text ends in a newline
  now puts the cursor on the following line. That is the rule working; the fifth criterion says so
  explicitly. Do not trim daemon text to avoid it — that is a behaviour change and out of scope.

## Open questions

- **The 8px block gap.** The design separates blocks inside one reply with an 8px gap (`16:43`); a
  preserved blank line gives a 20px line box instead. Deliberately not chased here — it needs
  block-level structure, which is #609. Flagged so code-review does not read it as a fidelity miss.
- **The user bubble collapses whitespace the same way.** Left alone on purpose: the report was about
  assistant replies, and `.bubble--user` carries the operator's own text, which the composer sends as
  typed. If it turns out to matter it is a one-line follow-up on the same anchor pattern, not a
  widening of this slice.
