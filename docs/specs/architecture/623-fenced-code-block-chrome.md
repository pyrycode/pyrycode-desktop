# #623 — a fenced code block's header bar and language label

**Ticket:** https://github.com/pyrycode/pyrycode-desktop/issues/623
**Size:** S (confirmed — see § Scope check)
**Labels:** `security-sensitive` (this spec carries a § Security review)

---

## Files to read first

| Path | What to extract |
|---|---|
| `src/renderer/src/screens/conversation/AssistantMarkdown.tsx:1-64` | The whole file — it is one of the two production files you touch. Lines 3-27 are the module header (two of its three claims are stale; you fix them). Lines 29-50 are the `components` map and its "NEVER spread `{...props}`" rule, which binds the `pre` override you add. Lines 52-61 are the docstring that hands the `language-*` class forward. |
| `src/renderer/src/screens/conversation/conversation.css:343-375` | #609's `.bubble__markdown` container, its `> *` **direct-child** `margin-block: 0` reset (`:361`), and the `.bubble__markdown pre` **descendant** rule (`:373`). Both selectors are load-bearing for this change in opposite directions — read the comment at `:365-372`. |
| `src/renderer/src/screens/conversation/conversation.css:572-615` | `.tool-row__chip` / `.tool-row__name` / `.tool-row__summary` — the file's established treatment for *a bordered token-only surface holding an unbounded untrusted string*. `__chip` is the border/radius/padding shape to clone; `__summary:605-614` is the `overflow: hidden` + `text-overflow: ellipsis` + `nowrap` bound to clone. |
| `src/renderer/src/screens/conversation/conversation.css:1191-1192` and `:1323-1324` | The two off-grid-padding precedents this spec's token choices rest on: `py 10 → --space-3` and `py 6 → --space-2 (±2px)`. Read them before questioning the token map below. |
| `src/renderer/src/screens/conversation/conversation.css:2153-2165` | `.unrecognized-row__raw` — the file's other `<pre>`. Clone its `margin` / `font-family` / `font-size` / `line-height` posture; **do not** clone its `max-height` / `overflow: auto` / `white-space: pre`, which `:369-371` already names the anti-precedent. |
| `src/renderer/src/theme/tokens.css:12-102` | The token names and their dark-scheme values. Every value in the token map below is checked against this file. |
| `src/renderer/src/screens/conversation/AssistantMarkdown.test.tsx:1-20, 44-56, 140-147` | The test file's stated conventions (every negative assertion paired with a positive in the same case; `lines(...)` fixtures, not template literals), the AC1 case whose `'<pre>'` assertion breaks (`:49`), and the language-carrier case whose comment names the wrong ticket (`:140-145`). |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:102-115, 457-477` | `MARKDOWN_SOURCE` (its fence has **no** info string) and the second `'<pre>'` assertion (`:469`). |
| `e2e/assistant-whitespace.spec.ts:60-96, 196-204, 241-262, 311-330` | The existing geometric detector. **Read it, then do not edit it** — § The e2e stays green, untouched explains why it holds and why touching it is out of scope. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:480-529` | The call site: `.bubble__markdown` and the settled/in-progress fork. Context only — this file is **not** modified by this ticket. |

---

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-45

A 302×120 bordered, 12px-radius block filled with `surface` (a step *darker* than the `surface-container-high` bubble it sits in), split by a 1px `outline-variant` divider into a 28px header bar (`16:46`) whose only content is the language label "typescript" (`16:47`, label-small, `on-surface-variant`, x=12) and a code body (`16:48`) holding wrapped monospace at 12px in `on-surface` (`16:49`, x=12, `pre-wrap` + `break-word`, no height bound). The header bar and its label are one visual row with nothing else in it; the block's own two children stack in plain block flow.

> **Hex trap:** `get_design_context` emits the **light**-scheme fallbacks (`#f8f9ff` surface, `#c2c7cf` outline-variant, `#191c20` on-surface). This app is dark-only (`tokens.css:13`). `#c2c7cf` is `outline-variant` in light and `--color-on-surface-variant` in dark — match roles by **variable name**, never by hex.

---

## Context

#609 wired `AssistantMarkdown` into the settled assistant bubble. A fenced block currently arrives as a bare `<pre>` carrying no class: it wraps inside the bubble measure and its UA block margins are reset, but it has no fill, no border, no radius, and no language label. #608 deliberately left react-markdown's `class="language-*"` on the `<code>` element precisely so this ticket would have the language without re-parsing the message source (`AssistantMarkdown.tsx:57-60`).

This ticket adds the mock's chrome. It is `security-sensitive` for one reason: `AssistantMarkdown.tsx:6-7` declares that file the **entire** security boundary for markdown rendering and its `components` map **the contract, not incidental detail**, so adding a `pre` entry is by that file's own terms a security change. The value being surfaced — the fence info string — is untrusted daemon text with no length bound.

---

## Design

### The rendered shape

```html
<div class="code-block">
  <div class="code-block__header">typescript</div>   <!-- present only when a language was read -->
  <pre class="code-block__body"><code class="language-typescript">…</code></pre>
</div>
```

Three decisions are baked into that shape; each is defended below.

- **Figma's `16:46` frame and its `16:47` text node collapse into one element.** The header's only content is the label, and the padding, the type tokens, the `nowrap` and the clip all coexist on one box. A nested `<span>` would carry nothing the parent cannot.
- **`.code-block` is a plain block box** — no `display: flex`. Its two children are block-level and stack in normal flow already, and each fills the content width without a `width` declaration (see § No `width: 100%` below).
- **The `<code>` child is passed through untouched.** `children` is rendered verbatim inside the new `<pre>`, so `class="language-typescript"` still ships — the assertion at `AssistantMarkdown.test.tsx:145` stays green and stays meaningful.

### The `pre` override

A fourth entry in the `components` map (`AssistantMarkdown.tsx:38-50`), subject to that map's existing rules — in particular **NEVER spread `{...props}`**. It destructures `children` and nothing else; every other attribute react-markdown would have supplied is dropped, exactly as `a` and `img` do.

```tsx
pre: ({ children }) => {
  const language = fenceLanguage(children)
  return (
    <div className="code-block">
      {language !== null && <div className="code-block__header">{language}</div>}
      <pre className="code-block__body">{children}</pre>
    </div>
  )
}
```

`language !== null` rather than a bare `&&` on the string: the guard is explicit about the one falsy value the helper can return, and an empty-string language can never render an empty header bar.

`code` stays **not** overridden. Overriding it instead of `pre` would be wrong twice over: react-markdown routes *inline* code through the same component (a fence with no info string is indistinguishable from inline code by `className` alone, which is exactly AC3's case), and inline-code treatment belongs to #624.

### Language extraction — contract

```ts
/** The fence's language, bounded for display, or null when there is none to show. */
function fenceLanguage(children: ReactNode): string | null
```

Module-private (not exported — this module's public surface stays the single `AssistantMarkdown` component). Behaviour, in order:

1. Take the first child via `Children.toArray(children)[0]`. This is **total** over both shapes react-markdown may hand a single-child element (the element itself, or a one-element array) — do not index `children` directly or call `Children.only`. The array `toArray` builds is read only; the `children` that get *rendered* are the originals.
2. Return `null` unless that child satisfies `isValidElement<{ className?: unknown }>(…)` **and** its `className` is a `string`. The explicit type argument is the claim being made about react-markdown's emitted `<code>`; the case in § Testing that asserts `language-typescript → "typescript"` is what pins it.
3. Split the class on whitespace and take the first token beginning with `language-`; the remainder of that token is the language. Token-scan rather than `/^language-(.+)$/` so an additional class on the element cannot silently kill the label.
4. Return `null` if there is no such token, or if its remainder is empty.
5. Otherwise return the remainder truncated to `MAX_LANGUAGE_CHARS`.

**It fails closed.** Every shape that is not "a `<code>` element carrying a `language-…` class" yields `null`, which is the *same* render AC3 specifies for a fence with no info string. There is no third branch and no error path. That degrade also covers a construct the ticket does not mention: an **indented** code block (four spaces, no fence) is a real CommonMark construct that reaches this same override, and it emits `<pre><code>` with no class at all — so it renders as the bordered block with no header, which is the right answer for a block that never declared a language.

**The value never leaves text position.** It is rendered as a React text child and interpolated into nothing — not a `className`, not an `id`, not a `data-` attribute, not a `style`. React escapes it; that is the entire inertness argument, and it is the same one `ConversationScreen.tsx:499-503` already makes for the in-progress tail.

### The bound

```ts
const MAX_LANGUAGE_CHARS = 20
```

A fence may declare an arbitrarily long info string. Two layers, deliberately different fabric:

- **The truncation above** is what the server-render tier can see. Renderer tests are `renderToStaticMarkup` under `environment: 'node'` (`vitest.config.ts`) — a CSS-only bound is geometric and unobservable there, and this slice does not open a new e2e. 20 characters clears every real fence language with room (`restructuredtext` is 16, `objective-c++` is 13, `typescript` is 10).
- **`overflow: hidden` + `text-overflow: ellipsis` + `white-space: nowrap` on the header** is the residual: 20 characters at label-small is ~110px, which still exceeds the block in a narrow window. This is not redundancy — it covers a case truncation cannot. It is a straight clone of `.tool-row__summary:605-614`, whose comment already settled the same question for the tool chip's unbounded untrusted summary ("Figma models a hard overflow-clip; ellipsis is the friendlier desktop degrade").

No JavaScript-side ellipsis glyph. `text-overflow` supplies one where it is visually needed, and adding a second would double up.

### CSS — three rules in `conversation.css`

Placed immediately after the `.bubble__markdown pre` rule (`:373-375`), so the markdown block's styles stay contiguous. Contract, not the finished rule text:

- **`.code-block`** — `background`, `border`, `border-radius`. Nothing else. No `overflow`, no `display`, no `width`, no `margin` (`.bubble__markdown > *:361` already zeroes it, and a `<div>` has none).
- **`.code-block__header`** — padding; `color`; the four `--text-label-small-*` tokens; `border-bottom` (the divider); `white-space: nowrap`; `overflow: hidden`; `text-overflow: ellipsis`. No `font-family` — `--font-sans` inherits from `.conversation`, the `.tool-row__summary:602` precedent. No `min-width: 0` — that is a flex-item remedy and this is a block box.
- **`.code-block__body`** — `margin-block: 0`; padding; `font-family`; the four `--text-body-small-*` tokens; `color`. **No `white-space`** and **no `word-break`** (see § Traps).

Plus one selector-list extension on `font-family`, covering the nested `<code>` — see § Traps.

### Token map

Every value below is checked against `src/renderer/src/theme/tokens.css`.

| Figma | Value | Token | Fit |
|---|---|---|---|
| `16:45` fill | surface | `--color-surface` (#101418) | exact — and deliberately **not** `--color-surface-container-high`, which is the bubble's own fill |
| `16:45` border | 1px outline-variant | `1px solid var(--color-outline-variant)` (#42474e) | exact; `1px` is structural, with seven precedents in this file (`:170`, `:584`, `:800`, …) and sanctioned by the ticket |
| `16:45` radius | 12px | `--radius-sm` | exact |
| `16:46` padding | `6px 12px` | `var(--space-2) var(--space-3)` | px exact; **py 6 → 8** — see § The two off-grid paddings |
| divider | 1px outline-variant | `border-bottom` on `.code-block__header` | see § The divider moves |
| `16:47` colour | on-surface-variant | `--color-on-surface-variant` (#c2c7cf) | exact — **not** `--color-on-surface`, the brighter role the code text uses |
| `16:47` type | 11 / 16 / 0.5 / 500 | `--text-label-small-size` / `-line` / `-tracking` / `-weight` | all four exact |
| `16:48` padding | `10px 12px` | `var(--space-3)` | px exact; **py 10 → 12** — see § The two off-grid paddings |
| `16:49` family | Roboto Mono | `--font-mono` | exact |
| `16:49` size | 12px | `--text-body-small-size` | exact |
| `16:49` leading | 18px | `--text-body-small-line` (16px) | −2px, the file's ±2px convention; `.unrecognized-row__raw:2162-2163` pairs these same two tokens on the file's other `<pre>` |
| `16:49` tracking / weight | — | `--text-body-small-tracking` / `-weight` | completes the quartet, the `.tool-row__name:596-599` and `.session-delimiter__title:634-637` posture for a mono run; without them the body inherits `.bubble`'s body-**medium** tracking |
| `16:49` colour | on-surface | `--color-on-surface` (#e0e2e8) | exact |

### The two off-grid paddings

The ticket asks for "the nearest token". **Neither value has one** — both are exact midpoints (6 is 2 from `--space-1` and 2 from `--space-2`; 10 is 2 from `--space-2` and 2 from `--space-3`). Nearest does not decide; the file's own precedents do, and both round **up**:

- **`py 6 → --space-2`** — `.run-config__effort-segment:1323`: *"px 12 → --space-3, py 6 → --space-2 (±2px)"*. The same 6px, the same decision, already made in this file.
- **`py 10 → --space-3`** — `.log-data__download:1191`: *"Figma py 10 maps to --space-3 (the ±2px-tokenized convention the status-row / pairing styles already use)"*.

Rounding both up also preserves the mock's relationship: Figma's header is 4px tighter than its body (6 vs 10); `--space-2` is 4px tighter than `--space-3`.

There is one apparent counter-precedent — `.channel-info__action:1739-1740` maps a Figma `py-10` **down** to `--space-2`. It does not apply here: that rule carries `min-height: 40px`, which is where the button's geometry actually lives, so its padding rounds down to stay under the min-height. `.code-block__body` has no height bound at all (`:369-371` settled that for this subtree).

Since `10 → 12` and the horizontal is already 12, the body's padding collapses to the single-value `padding: var(--space-3)`. Write it as one value; the comment records that it came from two separate Figma numbers.

### The divider moves from the body's top to the header's bottom

Figma draws it as `border-top` on `16:48`. **Do not port it that way.** AC3 requires that a fence with no language render *"the same bordered block with no header bar, and no empty bar in its place"* — and with the divider on the body, the languageless block renders the body as its only child, putting a 1px line a hair below the block's own 1px top border. A doubled edge is exactly the "empty bar in its place" the criterion forbids.

Hanging it on `.code-block__header`'s `border-bottom` makes the divider appear and disappear **with** the thing it divides — true by construction, no selector needed. The alternative (`.code-block__header + .code-block__body { border-top: … }`) is correct too but buys nothing for an extra selector.

### Traps

**A nested `<pre>` reverts to its UA margin.** `.bubble__markdown > *` (`:361`) is a **direct-child** selector, deliberately so. `.code-block` is now the direct child; the `<pre>` inside it is not, so it takes back its UA `margin-block: 1em` — at the body's 12px font that is 12px of dead space top and bottom inside a box where Figma allows 12. Hence the explicit `margin-block: 0` on `.code-block__body`. It is not decoration; without it the padding is silently doubled. (`.unrecognized-row__raw:2154` zeroes the same thing with `margin: 0`; use `margin-block` here, matching the neighbouring rule and leaving `margin-inline` alone for the same reason `:350-352` gives.)

**`.bubble__markdown pre` (`:373`) is a *descendant* selector and survives the nesting.** That is why `white-space: pre-wrap` still reaches the code body, and why AC5's "code lines keep the wrapping behaviour #609 gave them" holds with no new declaration. **Do not restate `white-space` on `.code-block__body`** — one subject, one rule. Likewise `word-break: break-word` still inherits from `.bubble:298` through the new wrapper (inheritance follows the DOM tree, not selectors); `:368` records that it is deliberately not restated.

**The UA stylesheet re-declares `font-family` on `<code>`.** Blink's `html.css` carries `tt, code, kbd, samp { font-family: monospace }`. A declaration beats an inherited value whatever its origin — the same rule `:365-366` invokes for `white-space` — so setting `--font-mono` on the `<pre>` alone is **inert**: the `<code>` child (which holds every visible character) keeps the platform default. Cover both elements with one selector list (`.code-block__body, .code-block__body code`). This is invisible in the unit tier and in a screenshot taken on a machine where the two fonts resolve alike; it is the one item here most likely to ship broken.

**No `width: 100%` anywhere.** `index.css` sets no global `box-sizing`, so a padded box given an explicit `width: 100%` overflows its parent by the padding. Nothing here needs one: `.code-block` is a stretched flex item of `.bubble__markdown`'s column (stretch sizes the *margin* box, so the border is accounted for), and its two children are block-level boxes whose `width: auto` accounts for their own padding. Leave all three widths unset.

**Do not pre-apply `min-width: 0`.** #609 named it a test-first remedy, not a prophylactic. `.bubble`'s `max-width` (`:296`) clamps the flex automatic minimum size, and the header's own `overflow: hidden` handles the rest.

---

## State, concurrency, error handling

None of this ticket's code holds state, starts a task, subscribes to anything, or can fail. `AssistantMarkdown` remains a pure function of `text`; the `pre` override is a pure function of its children; `fenceLanguage` is a pure function with a single `string | null` return and no throw path. There is no store slice, no IPC, no async, and no teardown.

The only "error handling" in the design is `fenceLanguage`'s fail-closed degrade (§ Language extraction, step 5): an unrecognised child shape renders the block with no header, which is a specified visual state rather than an error surface. Nothing is logged — a fence whose class react-markdown did not emit is not a diagnosable condition, it is markdown with no language.

---

## Testing strategy

All new coverage is `renderToStaticMarkup` markup assertions in `AssistantMarkdown.test.tsx` — the tier that owns this module. Follow the file's stated conventions (`:5-19`): fixtures built with `lines(...)`, and **every negative assertion paired with a positive one in the same case**, so no case can pass by rendering nothing.

**Two existing assertions break.** Both fixtures use a fence with **no** info string, so it is the degrade path that breaks them, not the languaged one:

- `AssistantMarkdown.test.tsx:49` — `expect(markup).toContain('<pre>')`
- `ConversationScreen.test.tsx:469` — `expect(markup).toContain('<pre>')`

Re-point both to the attributed form (`'<pre class="code-block__body">'`); do not delete either — each still discharges "a fence became a real element" for its own tier. **Re-run the grep yourself before editing** (`grep -rn '<pre' src e2e`): a scoped file list says what you edit, never what you break, and this list was built at spec time. The current sweep returns those two assertions plus prose-only hits in `ConversationScreen.tsx:615`, `conversation.css:365`, `shared/ipc/events.ts:341` and four comments in `e2e/assistant-whitespace.spec.ts` — all about the *other* `<pre>` (`.unrecognized-row__raw`) or about wrapping, none needing a change.

**New cases:**

- **A languaged fence renders the header (AC1, AC2).** Fixture: a fence opened ` ```typescript `. Assert the full nesting in one string — wrapper, then header carrying `typescript`, then the attributed `<pre>` — so that "the header exists" and "the header is inside the block, above the body" are one assertion. Assert the code text renders, and assert `class="language-typescript"` still ships (the carrier survived the override).
- **A fence with no language renders no header (AC3).** Fixture: a bare ` ``` ` fence. Positive: the wrapper immediately followed by the `<pre>` as one string — which *is* the proof that nothing sits between them. Negative: `code-block__header` absent anywhere in the markup.
- **A pathological long info string is bounded (AC4).** Fixture: a fence whose info string is a single word well past 20 characters and built so its 20-character prefix is distinguishable from its tail. Positive: the prefix renders. Negatives: the full string is absent, and the 21st-character-onward tail is absent. Do not hard-code `20` twice — derive the expected prefix from the fixture in the test body so the case reads as "bounded", not as "equals this literal".
- **A markup-character info string is inert (AC4).** Fixture: a *short* markup string (under the truncation bound, so the two AC4 halves stay separable) — e.g. a fence opened ` ```<b>x</b> `. Positive: the escaped form (`&lt;b&gt;`) appears, which is what distinguishes "escaped" from "deleted" — the discriminator `:8-12` describes. Negative: no real `<b` element was constructed.

**Re-point, don't rewrite, the carrier case at `:140-146`.** Its assertion is unchanged and now guards more than it did; only its name and comment name the wrong ticket (see § Comment repairs).

**Type coverage** is `npm run typecheck` as usual. Note that it does **not** reach `e2e/` — that directory is outside both tsconfigs.

### The e2e stays green, untouched

`e2e/assistant-whitespace.spec.ts` is the geometric half of AC5 and it already holds. **Do not edit it and do not add a sibling spec.** The analysis, because it must be checked rather than assumed:

- Its `CODE_TEXT` fixture (`:70`) is a fence with **no** info string, so it exercises the no-header degrade for free — and injects no text into `streamTheFiveReplies`'s `toHaveText(LONG_TOKEN_TEXT)` gate (`:261`), which every one of the file's five tests depends on. **Do not add a language to that fixture**; a header label would break all five.
- `readCodeMetrics`'s locator is `.bubble__markdown pre` (`:199`) — a descendant selector, so it still resolves, now to `.code-block__body`. Its `whiteSpace === 'pre-wrap'` still holds (`:373` reaches it), and its `scrollWidth ≤ clientWidth` still holds (the long token wraps on the inherited `word-break`, inside a narrower content box).
- `readRhythmMetrics` (`:224`) measures the RHYTHM bubble, whose fixture has no fence, and its docstring's premise — *"`.bubble__markdown` declares no padding and no border"* — stays true, because the padding and border land on `.code-block`, one level in.
- The thread's no-horizontal-scrollbar check (`:328-329`) holds: the block's 24px of padding and 2px of border sit *inside* a bubble already bounded by `max-width`, and the code wraps within what remains.

---

## Comment repairs

Three source comments make claims this ticket falsifies. All three live in the two files you are already editing, so correcting them is in bounds.

1. **`AssistantMarkdown.tsx:25-27`** — *"Ships dormant: nothing imports this outside its test file. #609 is the consumer and owns the container element, its class, the `white-space: pre-wrap` neutralisation inside it, and the React.memo decision."* Every clause is now wrong. Replace with the settled state: #609 wired the module in at `ConversationScreen.tsx:522` inside `.bubble__markdown`; it chose a **conditional** `bubble--assistant-text` over neutralising `pre-wrap` inside the container; and it **declined** `React.memo` with a stated reason at the call site (`ConversationScreen.tsx:514-521`). Say that this ticket added the `pre` override.

2. **`AssistantMarkdown.tsx:57-60`** — the reason `code` keeps its class is intact, but its forward reference ("forcing *the consumer* to re-parse the source") now points at code in this same file. Re-anchor it to `fenceLanguage`. Keep the decision and its two supporting arguments (React-escaped, mandatory prefix) exactly as they are — this is a re-anchor, not a rewrite, and the class is still deliberately unstripped.

3. **`AssistantMarkdown.test.tsx:140-145`** — names "#609" twice as the label's future consumer. That is this ticket, in this file.

And one addition rather than a correction: **`conversation.css:365-372`**, the `.bubble__markdown pre` comment. Add a sentence recording that the `<pre>` is now `.code-block__body` nested one level inside the wrapper, that this selector is a **descendant** selector (not `>`) and is why it still reaches it, and that `white-space` is therefore deliberately not restated on the new class. A future reader looking at two rules that both target the same element needs to know which one owns what.

**Do not touch `docs/`** beyond this spec file. `docs/knowledge/features/assistant-markdown-renderer.md`, `docs/knowledge/decisions/0010-…`, `docs/knowledge/INDEX.md` and the #608 / #609 specs all carry the same now-stale forward references to "#609 needs the label". They belong to the documentation phase, which writes them from this spec and the merged diff.

---

## Scope check

| Red line | This ticket |
|---|---|
| > 3 new files | **0 new files** — two production files modified (`AssistantMarkdown.tsx`, `conversation.css`), two test files edited |
| > ~600 lines total written | ~170: ~45 TSX (helper, override, comment repair), ~40 CSS (three rules + comments), ~60 test (four cases), ~2 re-points, plus this spec |
| > 5 new exported types / components | **0** — `fenceLanguage` and `MAX_LANGUAGE_CHARS` are module-private; the module's export surface is unchanged |
| > 10 consumer call sites | **0** — nothing imports `fenceLanguage`; the `components` map is internal to one file |
| > 5 acceptance criteria | 5 |
| ≥ 10 reject branches | 1 degrade path, no state machine, no logging |

Production `.ts`/`.tsx` files with new or modified content: **2**, against the § 4 gate of 5. **S confirmed.**

**File-overlap check:** `git fetch origin --prune` then a diff of all twelve live `origin/feature/*` branches against `main` returns **no overlap** on any of the seven files this change reads or writes. No `addBlockedBy` needed.

---

## Open questions

None blocking. Two judgement calls the developer may revisit with evidence, both already decided above so that a revisit is a deliberate act rather than a coin flip:

- **`MAX_LANGUAGE_CHARS = 20`** is chosen to clear the longest real fence language with margin, not measured against the block's rendered width (which is not measurable in this tier). If a real language name is ever seen truncated, the constant moves; the shape does not.
- **The body's `line-height`** is the one −2px token deviation in the map (18px → 16px). It follows `.unrecognized-row__raw`, the file's only other `<pre>`. If the code body reads visibly cramped against the mock, the alternative is not a literal — it is raising the question of whether an 18px mono leading token belongs in `tokens.css`, which would be its own ticket.

---

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. This change adds exactly one new untrusted-to-displayed path: the fence info string, which crosses at `fenceLanguage` — a single named module-private function with one `string | null` return, not a value parsed in three places. Its output reaches the DOM only as a React text child of `.code-block__header`; the spec forbids interpolating it into `className`, `id`, `data-*` or `style` (§ Language extraction), which is the whole inertness argument and matches the posture `ConversationScreen.tsx:499-503` already states for the in-progress tail. The upstream boundary is unchanged: the string was already in the markup before this ticket, as `<code class="language-…">` — #608 reviewed and accepted it there (spec 608 § *Why `code` keeps its `language-*` class*), and this ticket neither widens nor re-crosses it. `fenceLanguage` fails closed, so a hostile or merely unexpected child shape degrades to the no-header render rather than to an error path. One detail is load-bearing and easy to drop while implementing: the `isValidElement<{ className?: unknown }>` type argument is an *unchecked* claim about react-markdown's output, so step 2's runtime `typeof className === 'string'` test is what actually keeps a non-string out of the render — the type parameter is deliberately `unknown`, not `string`, so that the compiler cannot let the guard be skipped.
- **[Electron attack surface]** No findings, and one property worth stating because the ticket's label rests on it: `AssistantMarkdown.tsx:6-19` declares the `components` map the security contract, and the new `pre` entry is bound by its rules. It destructures `children` only and **never spreads `{...props}`** — the failure mode that rule exists for (a spread silently restoring `href`/`src` while the visible text keeps a careless test green) has no analogue here, since `pre` from a fence carries no attributes at all, but the rule is followed for the same structural reason: each override renders its own values and nothing else. No `rehypePlugins`, no `remarkPlugins`, no `skipHtml` — the configuration `:9-19` describes is untouched, so raw-HTML interpretation stays capability-**absent** (it would still require adding `rehype-raw` to `package.json`). Nothing is added to the preload bridge, no IPC channel is created, and no `dangerouslySetInnerHTML` appears anywhere in the design. The renderer gains no new capability.
- **[Error messages, logs, telemetry]** No findings — and specifically, `fenceLanguage`'s degrade path logs **nothing**. That is deliberate rather than an omission: the value that would be logged is untrusted daemon text, and the repo's diagnostics posture (#126) is content-free. A "could not parse language" log line would put attacker-chosen bytes into a log file to record a condition that is not a fault. The absence of a log here is the secure choice; do not add one.
- **[Network & I/O — resource bounds]** No findings after mitigation, and this is the category that actually applies. The fence info string is unbounded on the wire, and an unbounded label is a layout-integrity problem, not merely a cosmetic one: a single very long token with `white-space: nowrap` is precisely the shape that pushes a box past its measure. Two independent bounds are specified — the `MAX_LANGUAGE_CHARS` truncation in TSX (visible to the unit tier) and `overflow: hidden` + `text-overflow: ellipsis` on the header (covering the narrow-window residual the truncation cannot). Neither is load-bearing alone. The complementary claim — that the block cannot widen the bubble — rests on `.bubble`'s `max-width` clamping the flex automatic minimum size, and is asserted geometrically by the untouched `e2e/assistant-whitespace.spec.ts:326-329`. The extraction itself is linear in the string's length and, because § Language extraction mandates a whitespace split rather than a pattern match, there is no regex for an adversarial info string to backtrack — worth keeping that way if the token scan is ever "simplified" into a `RegExp`.
- **[Threat model — hostile daemon response]** Addressed. The relevant desktop threat here is a daemon (or something inside the Noise session) emitting a reply crafted to break the client's rendering: an info string that is very long, that contains markup characters, or that collides with an app CSS class. Length is bounded twice; markup is inert by React escaping, which the spec requires a test to assert on the **escaped form** rather than on absence (`&lt;b&gt;` present, `<b` absent — "escaped" and "deleted" are different outcomes and only one of them is what this path produces); class collision is structurally impossible, and for a sharper reason than "the prefix is mandatory": CommonMark ends the `lang` token at the first whitespace character, and CSS class separators *are* HTML whitespace, so a fence language can never be more than a single class token — there is no second token for an app class name to occupy. That value is in any case never emitted as a class by this ticket's code. A malformed fence yields no header, not a thrown render.
- **[Threat model — untrusted text rendered as chrome]** Considered, bounded, no finding. The header bar is the first place daemon text is drawn as *interface* rather than as message content, which is the shape that usually invites spoofing. It has no affordance: no click target, no href, no handler, no focus, and nothing downstream reads it back — so there is no action for a crafted label to trick the operator into. Bidi control characters (U+202E and friends) could reorder the label's own glyphs, but the header is a block box whose only content is the label, so the reordering cannot reach the code body or any adjacent trusted copy; the visible blast radius is a 20-character muted label inside its own bordered row. Stripping control characters was considered and rejected — it is a defence for a failure mode nobody has observed, and it would silently corrupt legitimate non-Latin language names.
- **[Tokens, secrets, credentials]** Not applicable — no credential, key, or token is read, written, derived, compared or displayed anywhere in this change. Stated rather than skipped because the category's real question ("does this path ever hold a secret?") has a checkable answer: the only data this code touches is one string extracted from already-rendered markdown children.
- **[File / storage operations]** Not applicable — no filesystem, `localStorage`, IndexedDB or disk-cache access is introduced. The change is a pure render.
- **[Cryptographic primitives]** Not applicable — no randomness, hashing, comparison against a secret, or Noise interaction. `fenceLanguage` performs no comparison against any trusted value at all; its only test is a class-name prefix on the client's own emitted markup.
- **[Concurrency]** Not applicable — nothing async is introduced, no task is launched, no listener registered, no timer set, no `AbortController` needed. `AssistantMarkdown` stays a pure function of `text`; the `pre` override is a pure function of its children. There is nothing to cancel on teardown and no shared state to race on.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-21
