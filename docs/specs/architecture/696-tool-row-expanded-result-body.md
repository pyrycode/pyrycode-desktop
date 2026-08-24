# #696 — fork the tool row's render on an expanded flag and draw the result body

**Size:** S (2 production files, 1 test file; 2 new exported symbols; no consumer cascade)
**Split from:** #669. Sibling: #697 (the toggle, the container state, the e2e).

## Files to read first

Codegraph is **not indexed for this worktree** (`.codegraph/` holds `config.json` but no index — `codegraph_context` returns "CodeGraph not initialized"). This list was built by hand from grep + Read; line refs were re-verified on 2026-08-24 against `main` at `c765e82`.

| Path | What to extract |
|---|---|
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:550-576` | The toolCall arm you are replacing. `rowClass` is the whole of today's fork; the chip's inner markup is two `<span>`s. The comment at `:558-563` is the #230 decision this ticket reverses — it must be rewritten, not left standing. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:621-675` | `UnrecognizedRow` — the row-as-its-own-component idiom, the `{expanded && <pre>}` fork (`:663-665`), and the SAFETY note (`:632-636`) whose posture this ticket restates. Copy the shape, not the state. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:677-681` | `UNRECOGNIZED_COPY` / `UNRECOGNIZED_TRUNCATED_COPY` — the exported client-owned-copy constant idiom the empty-state string must follow. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:452-498` | `Timeline` + `TimelineRow`. Read the `now` / `scrollPin` comments (`:442-451`): "OPTIONAL so the existing call sites stay green untouched" is the precedent this spec cites for *not* threading a prop through here. **Neither signature changes.** |
| `src/renderer/src/store/threadTimeline.ts:29-59` | `ToolResult` (`isError`, `resultSummary`) and the `toolCall` member. Note `input?` (#643, `:48-56`) — #645 lands its field list in the same body this ticket creates. **No store change in this ticket.** |
| `src/renderer/src/screens/conversation/conversation.css:920-990` | The `.tool-row*` block. `.tool-row` is `display:flex; justify-content:flex-start` (`:928-932`); `.tool-row__chip` is a single-line `inline-flex; align-items:center; overflow:hidden` pill (`:950-961`); `.tool-row__summary` is `nowrap` + ellipsis (`:980-990`). None of the three fits a stacked body — hence the sibling placement below. |
| `src/renderer/src/screens/conversation/conversation.css:2453-2550` | `.unrecognized-row*`. `.unrecognized-row__raw` (`:2525-2540`) is the treatment to mirror; `.unrecognized-row__truncated` (`:2542-2550`) is the note-line treatment the empty state mirrors. |
| `src/renderer/src/screens/conversation/conversation.css:365-380` | The whitespace rule that decides `pre` vs `pre-wrap`, and the `:369-372` note that `.conversation__thread` is its own scroll region with `.composer` as its sibling. Both are load-bearing below. |
| `src/renderer/src/theme/tokens.css:105-120` | Spacing + radii. `--radius-sm: 12px` (the chip's), `--radius-md: 20px` (the bubble's). No new token is needed. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1-40` | The imports. Eleven sub-components are already imported by name — that is why `ToolRow` is exported rather than reached through `<Timeline>`. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:181-335` | The four tests that must stay green (`:185`, `:259`, `:283`, `:302`) and the one whose comment is now false (`:319-335`). Note `:212`: fixtures avoid apostrophes because `renderToStaticMarkup` escapes `'` → `&#x27;`. |
| `src/renderer/src/screens/conversation/interactiveRoundtrip.test.tsx:66` | A second file asserting `tool-row--resolved`. Collapsed-default keeps it green; do not touch it. |
| `e2e/thread-scroll-pin.spec.ts:276,328,456` | Three specs count `.tool-row`. The wrapper stays exactly one element per row, so they stay green. |

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-28

Node `16-28` is a 380×33 single-line frame: one rounded chip on the thread background holding a monospace tool name in the tertiary tone (`read_file`) followed by a muted sans input summary (`kitchenclaw/db/schema.ts · 184 lines`), separated by an 8px gap. **The collapsed row is already this and does not move** — every declaration under `.tool-row*` (`conversation.css:920-990`) stays as written.

**N/A for the expanded state.** The mock has no expanded tool row, which is exactly the gap #230 recorded when it declined to draw the result. Per the ticket body, the app's own answer for an expanded untrusted body — `.unrecognized-row__raw` — is the visual language to match; this spec does that and invents no second one. If a reviewer wants a design decision beyond it, that is an operator call, not a developer one.

## Context

The daemon's `result_summary` already travels the whole way to the renderer and dies at the last step: `threadTimeline.ts` holds it on the `toolCall` item's `result`, and the render arm at `ConversationScreen.tsx:550-576` draws only `name` and `inputSummary`. The comment at `:558-563` says why — the Figma mock had no result-text slot. The operator's vault note (`second-brain/…/tool-row-subject.md`, 2026-08-21) reverses that: *"the result text already reaches the renderer and is thrown away at the last step, which is what makes #669 unblocked."*

This slice ships the **pure view only**: the toolCall render forks on a flag nobody passes yet. #697 owns the state, the click affordance and the e2e.

Two numbers set the layout requirement, both from the same vault note. Today the daemon caps `result_summary` at 200 runes and only 22% of results survive whole. pyrycode#1680 raises that to 16000 (mean 2579) and stops capping errors entirely; the largest result measured is 64525 characters. **This ticket ships against the 200-character stub and does not wait for pyrycode#1680** — a documented non-blocking dependency — but the body must already hold at the post-#1680 sizes.

## Design

### 1. The component seam — a new exported `ToolRow`

Extract the toolCall arm into its own component and export it:

```tsx
export function ToolRow({ item, expanded = false }: {
  item: Extract<ThreadItem, { kind: 'toolCall' }>
  expanded?: boolean
}): JSX.Element
```

The switch arm collapses to `return <ToolRow item={item} />`, mirroring `case 'unrecognizedMessage': return <UnrecognizedRow item={item} />` (`:617`) exactly.

**Why a component, not a prop threaded through `Timeline`.** `<Timeline` has ~38 render sites across the test suite; `TimelineRow` is constructed only by `Timeline`. Adding `expanded` to either forces a decision about *which* rows are expanded — i.e. #697's state shape — into this ticket, and buys an edit cascade for it. Extraction costs nothing: React components emit no wrapper, so the rendered markup is unchanged, which is what makes AC1's byte-identity survive the refactor. `Timeline` and `TimelineRow` signatures are **untouched**.

**Why exported.** The expanded branch is otherwise unreachable in this repo's test tier — there is no click, so nothing could ever set the flag. Exporting a sub-component for direct server-render is this file's established idiom: the test file already imports `ThinkingIndicator`, `StallIndicator`, `QueuedBacklog`, `StatusSheet`, `RepairPrompt`, `ConnectionBanner`, `WorkspaceChip`, `InterruptButton`, `ThreadOverflowMenuView`, `ChannelInfoSheetView` and `ConnectionStatusIndicator` by name (`ConversationScreen.test.tsx:3-37`). `UnrecognizedRow`'s expanded branch is unexported and correspondingly untested — that is the hole this shape closes.

**`ToolRow` holds no state.** It is props-in / markup-out, so #697 stays free to put a `useState` inside a thin wrapper (the `UnrecognizedRow` pattern) *or* hoist the set of expanded `toolUseId`s into the container. Neither is foreclosed here, and neither is anticipated here.

### 2. One derived boolean drives both new markup facts

```ts
const showBody = expanded && result !== null
```

The wrapper modifier and the body element are gated on this **same** constant, never on `expanded` alone. That makes AC3 structural rather than doubly asserted: a `result === null` row renders `class="tool-row"` and nothing else whatever the flag says, so its pending treatment cannot drift.

### 3. Markup contract

Collapsed (`showBody === false`) — identical to today, element for element and attribute for attribute:

```
<div class="tool-row[ tool-row--resolved[ tool-row--error]]">
  <div class="tool-row__chip" data-thread-role="tool">
    <span class="tool-row__name">{item.name}</span>
    <span class="tool-row__summary">{item.inputSummary}</span>
  </div>
</div>
```

Expanded (`showBody === true`) — the same wrapper and the same chip, with `tool-row--expanded` **appended last** to the class string and one new sibling after the chip:

```
<div class="… tool-row--expanded">
  <div class="tool-row__chip" data-thread-role="tool"> …unchanged… </div>
  <div class="tool-row__body[ tool-row__body--error]">
    <!-- exactly one of: -->
    <pre class="tool-row__result">{result.resultSummary}</pre>
    <p class="tool-row__empty">{TOOL_RESULT_EMPTY_COPY}</p>
  </div>
</div>
```

Three decisions inside that:

- **The body is a sibling of the chip, not a child of it.** `.tool-row__chip` is `inline-flex; align-items: center; overflow: hidden` — a single-line pill (`:950-961`). Nesting a stacked body inside it would force a new wrapper element around the two headline `<span>`s, which changes the collapsed markup and breaks AC1. As a sibling, `.tool-row` becomes a two-item column and the collapsed markup is untouched. This is `.unrecognized-row`'s own shape (`:2459-2464`: a flex column of summary line then expanded payload), so "an extension of the same chip" is honoured visually — the body reads as attached to the pill — without a second React component and without restructuring the pill.
- **`tool-row--expanded` is appended last** so the existing prefix is byte-stable and the test at `:314` (`toContain('class="tool-row"')`) still matches exactly when collapsed. In the stylesheet it goes immediately after `.tool-row--error`, for the source-order reason the `:934-938` comment already records.
- **The body is a container, not a lone text node** (`display: flex; flex-direction: column`). #645 lands its per-input-field list in this element, *above* the result, and must not have to introduce the container itself.

### 4. The untrusted-text posture (AC5) — the three sinks that are forbidden by name

`resultSummary` is daemon-relayed display text with the widest provenance on the timeline: it is whatever a tool returned, so it can be file contents, a fetched web page, or shell output. CLAUDE.md's 2026-08-20 ruling permits rendering it — escaped and length-bounded — and forbids exactly three destinations. This design has **one sink and no others**, and each prohibition below names the concrete mistake it prevents, because each one is a plausible next edit rather than a hypothetical.

- **The only sink is React text children.** `<pre className="tool-row__result">{result.resultSummary}</pre>`. No `dangerouslySetInnerHTML`, no `innerHTML`, anywhere on this path.
- **Never through `AssistantMarkdown`.** That component is imported into this same file and renders the settled assistant bubble two arms up (`:542-543`), so "reuse it for the body" is the obvious-looking move. It is wrong here for a reason stronger than AC5's "no markdown": markdown yields **links and images**, and an `<img src="https://…">` in a daemon-relayed result is an outbound request issued by a privileged renderer — a beacon whose URL the daemon (or whatever produced the tool output) chose. A `<pre>` with text children cannot emit one; Chromium does not auto-linkify text nodes. The body renders no markdown, resolves no links, and interprets no paths.
- **Never an attribute.** Not `title`, not `aria-label`, not `data-*`, not a `key`, not an `id`. `title` is the specific temptation the 240px bound creates ("let them hover to see the rest") — the answer to a clipped body is the scroll container, never a tooltip carrying the untrusted string into an attribute. Note that `Timeline` already keys by array index (`:473`) and explicitly rejected a text-bearing key (`:471`); that stands.
- **Never a filename, cache key or lookup path.** The design reads `resultSummary` in exactly two places: as the `<pre>`'s children, and in the `=== ''` value comparison that selects the empty state. The comparison is against a client-owned literal and drives a branch, not a lookup.
- **Never a log line.** No `console.*` and no logger call on this path. `resultSummary` is a message body, which is the category the content-free logging discipline (#126–#134) exists to keep out of logs; the store does not persist it either (`timelineStore.ts` holds the timeline in memory only). This ticket adds no sink where it could be written down.

Two things that are *not* daemon-controlled here, stated so a reviewer can check them at a glance: `result.isError` is a `boolean`, so every class name in the markup contract is a client-owned literal *selected* by it and never interpolated from daemon text; and `TOOL_RESULT_EMPTY_COPY` is a module constant, so the empty branch renders no daemon string at all.

### 5. Whitespace: `white-space: pre` + scroll, not `pre-wrap`

`conversation.css:365-380` states the rule that picks between the two precedents: prose and source code in a bubble **reflow** (`pre-wrap` + `word-break`), whereas a payload whose exact shape is the content **keeps that shape and scrolls** (`.unrecognized-row__raw`, `white-space: pre` + `max-height` + `overflow: auto`).

Tool result text sits on the payload side. It is machine output — a directory listing, a diff, a stack trace, an aligned table — where column position and line breaks *are* the information; reflowing it at a chip's measure mangles it exactly as it would mangle the raw wire payload. It is not prose in a bubble, and AC5 forbids parsing it as markdown, so the code-block precedent does not reach it either. **No third variant is introduced:** `.tool-row__result` takes `.unrecognized-row__raw`'s treatment.

This also discharges AC2's "preserving the newlines the daemon sent". A `<div>` or `<span>` inherits `white-space: normal` and collapses `\n` to a space — precisely the defect #607 fixed for assistant messages. The `<pre>` element plus the explicit `white-space: pre` declaration is the fix, and the `overflow: auto` that AC5's height bound needs supplies the x-axis for the long unwrapped line for free.

### 6. The empty state (AC4, first half)

```ts
/** Shown in place of an expanded body when the daemon's result carried no text. Client-owned copy. */
export const TOOL_RESULT_EMPTY_COPY = 'No output'
```

Rendered as `<p className="tool-row__empty">` — **not** a `<pre>`. It is chrome in the app's own voice, so per CLAUDE.md's 2026-08-20 ruling it is a client-owned constant and takes the sans body-small note treatment (`.unrecognized-row__truncated`'s), never the mono payload treatment. Exported so the test asserts the constant rather than a duplicated literal — the `UNRECOGNIZED_TRUNCATED_COPY` idiom, already imported by the test file at `:20`.

The trigger is `result.resultSummary === ''`, exactly. **Never `.trim() === ''`** — whitespace-only output is real output the daemon actually sent, and trimming would relabel it as absent. Never a falsy check either: the field is a `string`, so `''` is its only empty value and a falsy test would read as if `undefined` were reachable.

### 7. Error distinguishability (AC4, second half)

The modifier goes on the body **container** — `tool-row__body--error` — driven by `result.isError`.

- **On the container, not the `<pre>`:** one hook styles both children (the result and the empty note), and #645's field list inherits it without a fourth class.
- **As a rendered class, not a descendant selector off the wrapper's existing `tool-row--error`:** the unit tier is a static markup string, so a rendered class is assertable and a CSS descendant rule is invisible to it. The ticket's whole boundary rationale is that this fork is *fully verifiable in the unit tier*; a distinction only CSS can see would forfeit that.
- The two error markers are deliberately separate subjects: `tool-row--error` is the **row's** outcome (it retints the chip border, `:943`) and predates the body; `tool-row__body--error` is the **body's**. Keeping them apart means #697 or #645 can move the body without dragging a `.tool-row--error …` selector along.

### 8. CSS — four new blocks, no `tokens.css` change

All values are existing tokens. Ordered as listed, `.tool-row--expanded` placed immediately after `.tool-row--error` (`:945`) and the rest appended to the end of the `.tool-row*` block before `:992`.

| Selector | Declarations | Why |
|---|---|---|
| `.tool-row--expanded` | `flex-direction: column; align-items: flex-start; gap: var(--space-2)` | Turns the row into a column so the body stacks under the chip. `align-items: flex-start` is required — the flex default `stretch` would blow the hug-width pill out to full width. `--space-2` matches `.unrecognized-row`'s own column gap (`:2462`). |
| `.tool-row__body` | `display: flex; flex-direction: column; gap: var(--space-2); max-width: 100%; min-width: 0` | The container #645 extends. `max-width: 100%` + `min-width: 0` are what keep a 16000-character single line from widening the row instead of scrolling inside it. |
| `.tool-row__result` | `.unrecognized-row__raw`'s treatment (`:2528-2540`) verbatim — `margin: 0; max-height: 240px; overflow: auto; padding: var(--space-3) var(--space-bubble-x); background: var(--color-surface-container-high); color: var(--color-on-surface); font-family: var(--font-mono); font-size: var(--text-body-small-size); line-height: var(--text-body-small-line); white-space: pre` — **with `border-radius: var(--radius-sm)` in place of its `--radius-md`** | One deliberate deviation: `.unrecognized-row__raw` takes `--radius-md` because it sits under a `--radius-md` button; this body sits under the `--radius-sm` chip (`:960`) and takes the chip's radius so the two read as one object. |
| `.tool-row__body--error .tool-row__result` | `border: 1px solid var(--color-error)` | The chip's own error device (`:943`) applied to the body. Descendant form matches `:943`'s shape. |
| `.tool-row__empty` | `.unrecognized-row__truncated`'s treatment (`:2543-2550`): `margin: 0; color: var(--color-on-surface-variant)` + the body-small quartet | The note-line idiom. Restating the quartet per-block is this stylesheet's convention, not duplication to factor out. |

**`max-height: 240px` is copied as a literal**, with a comment naming `.unrecognized-row__raw:2530` as its precedent. There is no max-height token and every other max-height in the file is a percentage; per the ticket, extend `tokens.css` only if a token is genuinely absent *and needed* — a one-off bound shared with its own precedent is neither.

**On AC5's "cannot shove the composer off screen":** that phrasing is inherited from `.unrecognized-row__raw`'s comment, and `conversation.css:371-372` already records that it is structurally impossible — `.conversation__thread` (`:233`) is its own scroll region and `.composer` (`:1029`) is its sibling. The 240px bound is doing a different job: keeping one row from eating the whole thread viewport. Write the comment to say that, rather than repeating a hazard the layout already forecloses.

### 9. Two comments that become false and must be rewritten

Neither is an assertion change; both are edits to prose that would otherwise actively mislead.

- `ConversationScreen.tsx:558-563` — "`resultSummary` is NOT surfaced (the Figma mock has no result-text slot)… keeping the untrusted surface at today's two fields." Rewrite to record that #696 reversed it, why (the vault note's decision of 2026-08-21), and that the collapsed form is still exactly the two fields.
- `ConversationScreen.test.tsx:319-321` — the #230/AC4 sentinel test's comment gives the *old* rationale. Its assertion is now the **collapsed-default guard** and is more valuable than before. Keep the body byte-identical; re-point the comment at #696.

## State + concurrency model

None. `ToolRow` is a pure function of `(item, expanded)`; no store slice, no effect, no subscription, no timer, no async work, no teardown. `Timeline`/`TimelineRow` stay pure props-in/markup-out. The container state that will eventually set `expanded` is #697's.

## Error handling

No I/O and no fallible path, so there is no result type to thread. The two degenerate inputs are handled structurally, not by a catch:

| Input | Behaviour |
|---|---|
| `result === null` (call still pending) | No body, no `tool-row--expanded`, whatever the flag says. AC3. |
| `result.resultSummary === ''` | The client-owned empty note, not a blank `<pre>`. AC4. |

The UI surfaces a failed *tool* (not a failed render) through `tool-row--error` on the row plus `tool-row__body--error` on the body — no banner, no dialog. A daemon-truncated result draws no note: unlike `unrecognizedMessage.truncated`, `ToolResult` carries no truncation flag, and inventing a "possibly truncated" hint from a length heuristic would be a fabricated fact. Out of scope, and it becomes moot when pyrycode#1680 lands.

## Testing strategy

Unit only (`npm test`, vitest, `environment: 'node'`, `vitest.config.ts:27`). Every case is a `renderToStaticMarkup` server render of `<ToolRow …>` — **no DOM environment is added**. If one appears genuinely necessary, stop and say so on the ticket rather than adding jsdom as a side effect. Type coverage rides `npm run typecheck`.

Note on "byte-identical" (AC1): a test cannot diff against yesterday's markup. The assertable form is (a) the four existing tests at `:185`, `:259`, `:283`, `:302` passing untouched — they *are* the guard, by construction — plus (b) exact-string class assertions and explicit absence assertions for every new class. Do not attempt a literal byte-comparison; it is unsatisfiable here.

Scenarios (inputs → expected), added to the existing tool-row `describe`:

1. **Collapsed default, resolved success** — `<ToolRow item={resolved}/>` with no `expanded` prop. Markup contains `class="tool-row tool-row--resolved"`; contains neither `tool-row--expanded` nor `tool-row__body` nor `tool-row__result`; a distinctive `resultSummary` sentinel does not appear anywhere.
2. **Expanded, success** — headline unchanged (`tool-row--resolved` present, `tool-row--error` absent), wrapper gains `tool-row--expanded`, `tool-row__body` present without `tool-row__body--error`, the result text present, and `indexOf(name) < indexOf(inputSummary) < indexOf(resultText)` so the body sits below the headline.
3. **Expanded, error** — wrapper carries both `tool-row--resolved` and `tool-row--error`; body carries `tool-row__body--error`; the result text is present.
4. **Newlines survive** — `resultSummary: 'line one\nline two'` expanded: the literal two-line substring appears intact inside `<pre class="tool-row__result">`. (The `white-space: pre` declaration itself is invisible to this tier; the `<pre>` tag plus the preserved `\n` is the assertable proxy, and the CSS is checked by eye in `npm run dev`.)
5. **Pending row ignores the flag** — `result: null` with `expanded` set: markup contains `class="tool-row"` exactly, and none of `tool-row--expanded` / `tool-row__body` / `tool-row__result` / `tool-row__empty`. AC3.
6. **Empty result** — `resultSummary: ''` expanded: `tool-row__empty` present carrying the imported `TOOL_RESULT_EMPTY_COPY`; no `tool-row__result` element.
7. **Whitespace-only result is not the empty state** — `resultSummary: '\n\n'` expanded: renders `tool-row__result`, not `tool-row__empty`. Pins the `=== ''` decision against a future `.trim()`.
8. **Escaping (AC5)** — `resultSummary: '<img src=x onerror=alert(1)>'` expanded: the escaped form (`&lt;img`) appears and the raw `<img` tag does not. No apostrophes in the fixture (`renderToStaticMarkup` escapes `'` → `&#x27;`; see the test file's note at `:212`).
9. **Still routed through the switch** — `<Timeline items={[toolCall]} />` renders the collapsed row (proves the arm still delegates and passes no flag).

Regression set that must stay green untouched: `ConversationScreen.test.tsx:185`, `:259`, `:283`, `:302`, `:322`; `interactiveRoundtrip.test.tsx:66`; and the three `.tool-row` counts in `e2e/thread-scroll-pin.spec.ts` (unchanged wrapper cardinality — one element per row).

## Out of scope

- **The toggle, the container state, the click affordance and the e2e** — #697. Ship no `useState`, no button, no `aria-expanded` here.
- **The per-input-field list in the body** — #645. This ticket leaves the container it lands in.
- **Extracting a shared collapsible.** `ConversationScreen.tsx:621-623` says the extraction is triggered by a *second* expand-and-collapse; that second one is #697's toggle, not this pure fork. Reuse the visual and structural language; leave the decision to #697.
- **Collapsing consecutive uses of the same tool** — deferred on #645, 2026-08-20.
- **Any truncation hint on the result** — `ToolResult` carries no truncation flag; moot after pyrycode#1680.
- **pyrycode#1680** (result cap 16000, errors uncapped) — a documented non-blocking dependency. This ships against the 200-rune stub; the layout is specified to hold at the post-#1680 sizes.

## Open questions

1. **`TOOL_RESULT_EMPTY_COPY` wording.** `'No output'` is the proposal — terse, matches `UNRECOGNIZED_TRUNCATED_COPY`'s register. An operator may prefer `'The tool returned no output.'`. Either is a one-line change; do not block on it.
2. **240px against a 16000-character result.** The bound is inherited from `.unrecognized-row__raw` and is unverified at post-#1680 sizes (today's stub is 200 runes, so nothing in the app can exercise it yet). Ship the precedent value; revisit when pyrycode#1680 lands and real results arrive.
3. **Whether an expanded row should full-bleed the thread's width.** This spec keeps `align-items: flex-start`, so a short result hugs its content and a long one clamps to the row's width and scrolls. The alternative — stretching the body full-width — reads better for long results but widens the pill too. Verify by eye in `npm run dev`; changing it is one declaration.

## Security review

**Verdict:** PASS (first pass FAILed on two MUST FIXes; both are addressed by § 4, which was written in response and is not part of the original draft.)

**Findings:**

- [Trust boundaries] **MUST FIX — addressed in § 4.** The first draft showed the sink in the markup contract but never stated the prohibition, and the 240px height bound actively invites `title={result.resultSummary}` as a "see the rest on hover" affordance — an untrusted string into an attribute, which CLAUDE.md's 2026-08-20 ruling forbids by name. § 4 now names `title` / `aria-label` / `data-*` / `key` / `id` explicitly. The boundary itself is a single expression (`<pre className="tool-row__result">{result.resultSummary}</pre>`); downstream there is no downstream — `ToolRow` returns markup and holds nothing.
- [Electron attack surface] **MUST FIX — addressed in § 4.** `AssistantMarkdown` is imported into this same file and renders two arms up (`ConversationScreen.tsx:542-543`), so routing the body through it is the obvious-looking reuse. Markdown yields links and images, and an `<img src="https://…">` in a daemon-relayed tool result is an outbound request issued by a *privileged* renderer — a beacon whose URL the daemon chose. AC5 said "no markdown" without saying why; § 4 now states the mechanism, which is what makes the rule survive a developer who thinks they have a better idea. No IPC channel, `contextBridge` API, `BrowserWindow` option, protocol handler or navigation guard is touched by this ticket: `resultSummary` already crosses the bridge today (`src/shared/ipc/events.ts`) and already sits on the store item.
- [Tokens, secrets, credentials] No findings, with one exposure named. `ToolResult` carries `isError: boolean` and `resultSummary: string`; neither is a credential and nothing here reads, stores or rotates one. The real question is that a tool result *can contain* a secret (an env dump, a key file the agent was asked to read), and this ticket makes such content visible where it was not. The exposure is bounded to the screen: § 4 forbids the log sink, and the store does not persist the timeline, so nothing is written down that was not written down before. Screen capture and shoulder-surfing are the residual, and are the user's own agent output on the user's own machine — out of scope for a render fork.
- [File / storage] No findings — by a design decision, not by absence of thought. `resultSummary` is read in exactly two places: as the `<pre>`'s children, and in `=== ''`. That comparison is against a client-owned literal and selects a branch; it constructs no path, no cache key and no lookup. There is no `fs` call, no `path.join`, no temp file and no atomic-write concern on this path.
- [Cryptographic primitives] No findings — nothing random and nothing secret. The one equality comparison in the design (`resultSummary === ''`) compares untrusted text against the empty literal, not against a secret, so `crypto.timingSafeEqual` does not apply and `===` is correct.
- [Network & I/O] No findings — no socket, no fetch, no frame handling, and (per the Electron finding) no subresource load. Worth recording that the size question was checked rather than assumed: post-pyrycode#1680 the result cap is 16000 characters and **error results are uncapped**, but the whole envelope must fit one Noise transport message (65519 bytes), so the renderer structurally cannot receive an unbounded string — the largest result in the operator's 400-session corpus is 64525 characters, i.e. the ceiling *is* the bound. ~64KB of text in a `<pre>` is the same order of magnitude `.unrecognized-row__raw` already renders with no observed problem, so no extra render-side cap is specified: that would be a defense against a failure mode never observed.
- [Error messages, logs, telemetry] No findings — § 4 states the rule. `resultSummary` is a message body, the exact category #126–#134's content-free logging discipline exists to keep out of logs, and this ticket adds no `console.*`, no logger call and no telemetry. Flagged for code-review as a checkpoint, since a debug log added mid-implementation is the plausible way this regresses.
- [Concurrency] No findings — `ToolRow` is a pure function of two props. There is no `await` in the design, hence no check-then-act gap; no timer, listener, subscription or async task is created, hence nothing to cancel on teardown or on window close.
- [Threat model alignment] **Hostile daemon response** is the applicable threat and is addressed on all four vectors: markup injection (defeated by React text-children escaping, with the three alternative sinks forbidden by name in § 4); oversized payload (bounded by the Noise envelope, above); control characters and ANSI escapes (inert in a DOM `<pre>` — a terminal interprets them, a text node does not). **Malicious relay** is unaffected: it is content-blind and on-path, and this ticket adds no relay-reachable surface. **Renderer compromise reaching the transport** is unchanged — no process boundary moves.
- [Threat model alignment] **OUT OF SCOPE — bidi spoofing.** A `resultSummary` containing U+202E (right-to-left override) or its relatives can visually reorder the rendered body, e.g. to make a failed command read as a successful one. Not fixed here, deliberately: the app renders untrusted daemon text with no bidi isolation in `.tool-row__summary`, `.unrecognized-row__raw`, the assistant bubble and the session-boundary cwd, so a defense on this one row would be inconsistent and would leave the wider surface untouched. It has also never been observed. Per the pipeline's evidence-based-fix rule this stays deferred; if it is ever to be fixed it is a repo-wide `unicode-bidi: isolate` pass owned by its own ticket, not a line in this one.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-24
