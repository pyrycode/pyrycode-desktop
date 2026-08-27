# #811 — the input footer row and its context percentage

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=110-3497

`Context: 84%` (`110:3497`) is a 75×16 M3 **body/small** text run (12px / 16px line / 0.4px tracking)
coloured `schemes/primary`, sitting inside the `Input footer` row `110:3494` — a 780×20 row that is the
third and last child of the `Input area` symbol `134:5013`, below `Status area` `111:3525` (#796/#797) and
`Message input` `107:3475`. The row holds two children: a left group `Info and buttons` `115:3660` inset
`x=16`, `y=4`, 328×16, and the `Attachment` glyph `115:3654` at `x=753` (#685). The left group is four
`Input footer button` instances at x=0 / 76 / 135 / 197 — #680 Actions, #682 permission mode, #683 model
and effort — followed by this reading at x=253. **Only the reading is in scope; the row renders it and
nothing else.**

Three measurements the design settles, so they are not re-litigated in review:

- **The row's left inset is 16px, not 12px.** `Info and buttons` starts at `x=16`, which is exactly where
  `Message input`'s own text starts (`Content` `107:3478` at `x=16` inside a `Text field` at `x=0`). So the
  footer aligns with the **input's text start**, the `.composer__hint` treatment (`padding: 0 var(--space-4)`)
  — *not* with the composer's box edge, which is where `.composer-status` aligns (`Status` `112:3530` at
  `x=0`). The two rows are deliberately inset differently in the design; do not "fix" one to match the other.
  `Attachment`'s right edge lands at 764 of 780, i.e. the same 16px on the other side.
- **The row is 20 tall, not 24.** `.composer-status` is 24; this one is `var(--space-5)` worth. Its content
  is a single 16px line at `y=4`.
- **The inter-row gap is 8px.** `Message input` ends at y=84, `Input footer` starts at y=92 — the same 8 that
  separates `Status area` from `Message input`.

`schemes/primary`'s exported fallback is `#32628d`, the **light** scheme. Desktop is dark-only (ADR 0003):
use `--color-primary` (`#9dcbfc`), never the export's hex. Standing rule, recorded in `.status-row`'s and
`.composer-status`'s own comments.

Figma's generated code for this node is a bare `<p>` with no asset reference, so #796's remote-`<img>`
hazard does not recur here. Verified by reading the generated output, not assumed.

## Files to read first

Codegraph is wired for this repo but **not indexed** — `.codegraph/` holds only `.gitignore` +
`config.json`, and every `codegraph_*` call returns *"CodeGraph not initialized"* (probed 2026-08-24,
re-probed for #796 on 2026-08-27). This list was built by grep + read; don't spend a turn re-probing.

| Path | What to extract |
|---|---|
| `src/renderer/src/screens/conversation/RunConfigSections.tsx:382-442` | `abbreviateTokens` + `ContextWindowSection`. **:406-409 is the computation this ticket extracts**, and :389-398's comment is the reasoning that travels with it. `abbreviateTokens` stays where it is — the sheet is its only consumer. |
| `src/renderer/src/screens/conversation/RunConfigSections.tsx:456-500` | The container. :492-493 is the `snapshot?.usedTokens ?? 0` coalescing the new container clones verbatim. |
| `src/renderer/src/store/runConfigStore.ts:18-33, 61-71` | `RunConfigSnapshot` (both figures are required `number`s under a nullable `snapshot`), the app-singleton, `useRunConfigStore`, `selectSnapshot`. The whole read surface. |
| `src/renderer/src/screens/conversation/runConfigLive.ts:1-37` | Why the store is filled app-wide and stays live (#810). Read the header comment only; this ticket adds nothing to that path. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:2117-2223` | `Composer` — the component that grows a third child. :2184-2222 is the return body; the new row goes after `.composer__row` closes at :2220. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:2300-2347` | `ComposerErrorChip` / `ComposerErrorChipControl` — **the exact pure-view + store-bound-container pair this ticket clones**, including why the container exists instead of a prop threaded from the screen, and why there is no live region. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:1227-1260` | `ComposerStatusArea` — the sibling row. Read it so you copy its posture (unconditional element, held height) and *don't* copy its 24px/`--space-3` geometry. |
| `src/renderer/src/screens/conversation/conversation.css:744-768` | `.composer-status` — the held-height rationale, the "no vertical padding under this repo's absent global box-sizing reset" rule, and the height-as-a-literal precedent. All three carry over. |
| `src/renderer/src/screens/conversation/conversation.css:867-925` | `.composer-status__error` — why a hard-height row needs `white-space: nowrap` and why `<p>`'s UA margin is a layout hazard there. Same two facts apply to this row. |
| `src/renderer/src/screens/conversation/conversation.css:1323-1352` | `.composer`, `.composer__row`, `.composer__hint`. The column's `gap: var(--space-1)`, its `padding: var(--space-2) var(--space-3) var(--space-3)`, and `__hint`'s `padding: 0 var(--space-4)` alignment — the three numbers the new row's geometry is derived against. |
| `src/renderer/src/screens/conversation/conversation.css:2141-2200` | `.run-config__context*` — the sheet's gauge styling, for reference only. Untouched by this ticket. |
| `src/renderer/src/theme/tokens.css:24, 88-91, 106-110` | `--color-primary`, `--text-body-small-*`, `--space-1`/`--space-4`/`--space-5`. Every value this row needs already exists; add no token. |
| `src/main/transport/inboundMessage.ts:525-536` | `parseSessionSettingsPayload` — both figures are bare `requireNumber` (a `typeof === 'number'` test, nothing more). This is why § Error handling's finiteness guard exists. |
| `src/main/transport/inboundMessage.ts:611-622` | The shipped ruling that wire integers are deliberately **not** range-checked at the parse boundary and *"the render slice formats the counter defensively instead"*. That is this ticket's licence to guard at the clamp. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1978-2010` | The `ComposerErrorChip` describe — the pure-view test shape, including `toBe('')` for the returns-null arm. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:2702-2752` | The container block's `composer-status` assertions **and the `vi.spyOn(store, 'getInitialState')` seam at :2726-2752**. That seam is the only way a renderer spec reaches a non-initial store arm, and :2731-2735 records why (`setState` before a server render is invisible). This ticket needs it. |
| `src/renderer/src/screens/conversation/RunConfigSections.test.tsx:210-262, 700-707` | The shipped percentage assertions. They must stay green **unedited** — that is the proof the extraction preserved behaviour. |
| `docs/specs/architecture/796-composer-status-area.md` | The sibling row's spec. Same shape, same posture, one ticket earlier. **Read-only.** |

## Context

The desktop layout (board #7, Figma `102-4`) puts a fixed-height footer row beneath the message box
carrying five affordances. Four of them — #680 Actions, #682 permission mode, #683 model and effort, #685
attach — are blocked on daemon work that does not exist. This one is not, so it lands first and builds the
row the others will occupy, exactly as #796 built the status row together with its first occupant and left
the second slot for #797.

The percentage itself already exists once, inline at `RunConfigSections.tsx:406-409`, behind a
`windowTokens > 0` guard. This slice is a **second surface for the same number**, so the computation
becomes one shared pure function both surfaces call. A second clamp that can drift from the first is the
thing this ticket exists to avoid.

The figures are already live app-wide: #810 landed `runConfigLive.ts` and mounted `RunConfigLiveData` in
`App.tsx` as the ninth headless leaf, so `runConfigStore` is filled whether or not the run-configuration
sheet has ever been opened. **This slice adds no store, no subscription, no event and no IPC.** It renders
what that store already holds.

**Scope boundary.** The other four slots stay genuinely empty — no placeholder controls, no disabled
buttons, no spacer elements standing in for the blocked tickets. The sheet's own gauge rendering is
untouched apart from the one call it now makes.

## Design

### 1. `contextUsagePercent` — the one computation

New file: **`src/renderer/src/screens/conversation/contextUsage.ts`**. React-free, dependency-free, one
export — the `composerSend.ts` idiom (a pure module beside the screen with its own `.test.ts`).

```ts
/** The session's context-window usage as a whole-number percentage, or null when no real window size
 *  is known. Total over its inputs: every `number` pair returns either null or an integer in [0, 100]. */
export function contextUsagePercent(usedTokens: number, windowTokens: number): number | null
```

The body is `RunConfigSections.tsx:406-409`'s expression plus one term, and nothing else:

- **Guard:** `Number.isFinite(windowTokens) && windowTokens > 0`, else `null`.
- **Value:** `Math.min(100, Math.max(0, Math.round((usedTokens / windowTokens) * 100)))`.

Three decisions, stated so they are not re-derived:

- **It returns `number | null`, not a number beside a separate `available` boolean.** That is what makes
  AC1 structural rather than conventional: the *guard* is shared, not merely the arithmetic. Two surfaces
  cannot disagree about whether a reading exists, because there is one predicate and it is the return type.
- **`Number.isFinite(windowTokens)` is the one added term**, and it is the fix for a real hole, not
  defensive decoration — see § Error handling. Do **not** add a matching term for `usedTokens`: with
  `windowTokens` finite and positive, `usedTokens = Infinity` clamps to `100` and `-Infinity` clamps to `0`,
  both honest readings, and `NaN` is not producible by `JSON.parse`. A second guard would be an unreachable
  branch and an untestable one.
- **`> 0` also absorbs a negative window**, and `Math.min`/`Math.max` clamp an over-full session to `100`
  and a negative used count to `0`. Carry `RunConfigSections.tsx:392-398`'s comment across (it is still
  exactly true), extended with the finiteness sentence.

`ContextWindowSection` then calls it and derives nothing itself: `const pct = contextUsagePercent(...)`,
and its `available ? … : …` ternary becomes `pct !== null ? … : …`. Everything else in that component —
`abbreviateTokens`, the `% used (… of … tokens)` string, the `role="progressbar"` triple, the inline fill
width, the explainer, the unavailable line — stays byte-identical. **This is the only edit to
`RunConfigSections.tsx`.** Its existing tests must pass unedited.

*Why a new module rather than a helper in `runConfigStore.ts`:* the store's own docstring scopes it to
state plus read-only selectors, and this is a view derivation consumed by two screens' components. A leaf
module with no imports also cannot participate in the import cycle `runConfigLive.ts:20-27` documents.

### 2. `ContextUsageReading` — the pure view

Lives in **`ConversationScreen.tsx`**, beside `ComposerErrorChip` (append after
`ComposerErrorChipControl`, ~`:2348`). No new component file: every view on this screen lives there, and
the container half must sit next to it.

```tsx
export function ContextUsageReading(props: {
  usedTokens: number
  windowTokens: number
}): JSX.Element | null
```

Returns `null` when `contextUsagePercent` does — **not** an empty element (AC2 is explicit that the slot is
not held by an empty node; the row's own height is what holds it). Otherwise it returns exactly one
element:

- A `<span className="composer__context">` whose only child is the single template literal
  `` `Context: ${pct}%` ``.

Five properties of that one element, each load-bearing:

- **A `<span>`, not a `<p>` or a `<div>`.** The row sets a hard height and this repo ships no global
  box-sizing/margin reset, so a `<p>`'s UA margin is a live layout hazard against AC4 for no semantic gain
  — `ComposerErrorChip`'s ruling verbatim (`ConversationScreen.tsx:2312-2314`).
- **No attribute beyond `className`.** No `onClick`, no `tabIndex`, no `role`, no `title`, no `aria-*`, no
  `data-*`, no `href`. That is AC3, and it is provable in one assertion because the emitted markup is short
  enough to pin exactly — see § Testing strategy.
- **No live region.** No `role="status"`, no `aria-live`. `ComposerErrorChip`'s ruling
  (`ConversationScreen.tsx:2316-2321`) applies and is stronger here: after #810 this figure updates on every
  connect and every turn end, so a polite region would announce a percentage after every turn.
- **A SINGLE text run.** One template literal, not `Context: {pct}%` split across JSX children. The
  `.composer-status__label` discipline: one run has one predictable serialisation, which is what makes the
  exact-markup assertion in § Testing strategy stable.
- **The prefix is a client-owned literal and the only interpolated value is an integer in [0, 100].** No
  daemon-supplied *string* reaches this surface at all — see § Security review.

*No copy constant.* One call site, and the only variable part is a clamped integer; the repo's copy
constants (`COMPOSER_ERROR_CHIP_PREFIX_COPY`, `CONNECTION_BANNER_COPY`) exist for strings asserted across
files or that must be provably free of daemon text. Neither applies. If review disagrees, a constant is a
one-line change with no design consequence.

### 3. `ContextUsageControl` — the store-bound container

Module-private, immediately after the view — the `ComposerErrorChipControl` shape (`:2336-2347`).

```tsx
function ContextUsageControl(): JSX.Element | null
```

Reads `useRunConfigStore(selectSnapshot)` and renders
`<ContextUsageReading usedTokens={snapshot?.usedTokens ?? 0} windowTokens={snapshot?.windowTokens ?? 0} />`
— `RunConfigSections.tsx:492-493` verbatim, so the two surfaces coalesce the not-yet-loaded state
identically. `snapshot === null` and the daemon's `window_tokens: 0` collapse into the same path, which is
why AC2's two absent states need one branch and not two.

**A container, not a prop threaded down from `Composer` or `ConversationScreen`.** `Composer` subscribes to
sessionStore, timelineStore, conversationTimelineStore and activeConversationStore already; adding a fifth
read for a figure that now ticks on every turn end would re-render the textarea and the send button on
every tick. `ConversationScreen` is worse — it would re-render the whole screen, timeline included. This is
`ComposerErrorChipControl`'s reasoning (`:2336-2340`) with a live-updating value behind it.

**One `selectSnapshot` read, not two narrow field selectors.** Both figures come out of the same object in
the same render pass, so the numerator and denominator can never be read from different store ticks. Two
selectors could tear across an update and produce a percentage of two unrelated snapshots. Do not split it.

### 4. The row — `Composer`'s third child

`Composer`'s return grows one sibling **after** `.composer__row` closes (`:2220`), keeping the column's
DOM order `{hint}` → `.composer__row` → `.composer__footer`:

```tsx
<div className="composer__footer">
  <ContextUsageControl />
</div>
```

**Not a component.** `.composer__hint` and `.composer__row` are inline BEM children of `.composer` and this
is the third; `ComposerStatusArea` is a component because it is a *sibling* of `.composer` in the
conversation column with props and two slots. Consistency with the composer's own sub-rows wins, and it
keeps the ticket's new exported surface at two symbols.

**Exactly one child today, and no wrapper for the future group.** The `Info and buttons` sub-frame in Figma
exists to hold four controls that do not exist; emitting an empty wrapper for them is precisely the
placeholder the ticket forbids, and `ComposerStatusArea`'s own comment (`:1204-1206`) already rules on this
shape: *"a spacer would be a defence for a failure nobody has observed."* #680/#682/#683 prepend siblings;
#685 right-aligns with `margin-left: auto`.

### 5. CSS — `conversation.css`

Two new rules, appended beside the existing `.composer__*` block (~`:1352`). Every value is an existing
token or a measured structural literal; add no token.

| Selector | Substance |
|---|---|
| `.composer__footer` | `flex: 0 0 auto`; `height: 20px`; `display: flex`; `align-items: center`; `gap: var(--space-5)`; `padding: 0 var(--space-4)`; `margin-top: var(--space-1)`. |
| `.composer__context` | The four `--text-body-small-*` declarations; `color: var(--color-primary)`; `white-space: nowrap`. |

Each non-obvious declaration, with its reason — put these in the comment block, not just in review:

- **`height: 20px` as a literal**, matching Figma `110:3494`, not `var(--space-5)` (also 20px): a
  component's own height is structural geometry, not spacing. The `.composer-status` / `.conn-dot` /
  `.run-config__context-bar` precedent, stated at `conversation.css:753-755`.
- **No vertical padding.** This repo has no global box-sizing reset, so the 20px is the exact box only
  while nothing pads it. `.composer-status`'s rule verbatim (`:748-751`).
- **`align-items: center`** centres the 16px line in the 20px row. Figma's own inset is asymmetric (`y=4`
  above, 0 below); centring is 2px off that and one declaration instead of two — the same trade
  `.composer-status` took against its node's `py-[4px]`.
- **`padding: 0 var(--space-4)`, not `--space-3`.** See § Design source: this row aligns with the input's
  *text* start (`.composer__hint`'s treatment), not with the composer's box edge (`.composer-status`'s).
- **`margin-top: var(--space-1)`.** `.composer` is a column with `gap: var(--space-1)`; Figma's
  `Message input` → `Input footer` gap is 8px. 4 + 4 = 8. A margin rather than widening the column's gap,
  because the gap also separates `.composer__hint` from `.composer__row` and that spacing is settled.
- **`gap: var(--space-5)`** is the design's measured 20px item gap (x=0→76→135→197→253 across items of
  56/39/42/36). **Inert today** — one child — and recorded now so #680/#682/#683 inherit the row's rhythm
  instead of each re-deriving it. It is a declaration, not a placeholder element; if review prefers it
  deferred, dropping the line changes nothing observable in this ticket.
- **`white-space: nowrap`.** The row has a hard height, so a wrapped reading would overflow it rather than
  grow it (`.composer-status__error`'s ruling). Unlike `.composer-status__label--tool` this needs **no**
  truncation chain: the string is client-owned and at most 13 characters (`Context: 100%`), so it cannot
  blow the row out. Do not copy the ellipsis machinery here.
- **`color: var(--color-primary)` on the reading, not on the row.** The design colours every footer item
  `schemes/primary`, but hoisting the colour onto `.composer__footer` would pre-decide the treatment for
  four controls that will each read their own node. Scoped to the one element that exists.

**AC4 is structural, not a measurement.** `.composer__footer` renders unconditionally with an explicit
height and no vertical padding, and its occupant is a 16px inline child of a 20px flex row — so a null
reading cannot change the row's height and therefore cannot move `.composer__row` above it. That is the
same guarantee `.composer-status` ships (`conversation.css:748-751`) and it is why no e2e layout
measurement is added; see § Testing strategy.

## State + concurrency model

None added. No store, no slice, no reducer, no event, no subscription, no effect, no async work, no timer,
no `AbortController`, no IPC. `window.pyry` is not dereferenced anywhere in this ticket's code — which is
also what keeps the container server-renderable with no bridge stub (the `LogDataSection` / `Composer`
invariant).

The one read is `useRunConfigStore(selectSnapshot)` inside `ContextUsageControl`. Re-render scope: that
leaf alone, on a snapshot replace. `setSnapshot` replaces the whole object, so every arrival is a fresh
identity and re-renders it with identical output when nothing moved — anticipated by the store
(`runConfigStore.ts:50-53`) and cheap enough that memoising would be ceremony.

Teardown: React unmount. Nothing outlives the leaf; the app-lifetime subscription and the refresh trigger
belong to #810's `RunConfigLiveData` and are untouched.

## Error handling

No new failure mode is *introduced* — but the design closes one that ships today, and this is the reason
`Number.isFinite(windowTokens)` is in § Design rather than a nice-to-have:

**The shipped clamp is not total.** `used_tokens` and `window_tokens` cross the wire boundary through bare
`requireNumber` (`inboundMessage.ts:533-534`), a `typeof === 'number'` test with no range check — and
`inboundMessage.ts:617-621` rules that deliberately, because a client-invented bound would drop valid
future frames, and says explicitly that *"the render slice formats the counter defensively instead"*. A
daemon frame carrying `used_tokens: 1e999, window_tokens: 1e999` parses to `Infinity` for both
(`JSON.parse` maps overflow to `Infinity`; `typeof Infinity === 'number'`), and
`Math.min(100, Math.max(0, Math.round(Infinity / Infinity)))` is `NaN`. Today the sheet would render
`NaN% used` with a `width: NaN%` fill; copied verbatim, this row would render `Context: NaN%` — the exact
class of garbage AC2 forbids, remotely triggered. The finiteness term routes it to the same "unavailable"
path as `window_tokens: 0`.

Beyond that, `contextUsagePercent` is total and cannot throw: the only partial operation is the division,
and it runs solely inside the guard. There is no result type to thread, no catch, no banner, no dialog, and
no silent-failure branch — the absence of a reading **is** the failure surface, and it is the same one a
foreground session or a not-yet-loaded store produces.

`ContextUsageReading` and `ContextUsageControl` have no error paths of their own: no bridge call, no parse,
no network, no permission surface.

## Testing strategy

Renderer specs are static server renders (`vitest.config.ts` is `environment: 'node'`; no DOM, no effects,
nothing can click). Every assertion below is on markup or on a pure function.

### `contextUsage.test.ts` (new)

Plain function tests, no React:

- `146000 / 200000 → 73` — deliberately the same figures `RunConfigSections.test.tsx:218` already pins, so
  the two files agree on one arithmetic (AC1).
- `168000 / 200000 → 84` — the design's own reading.
- `20000 / 200000 → 10` and `45000 / 200000 → 23` — the sheet's shipped rounding cases.
- `500 / 200000 → 0` — a **real** early-session zero, which must be a number and not `null`. This is the
  case that gives AC2's "never a misleading `0%`" its teeth: `0` and "no reading" are different answers and
  the tests must distinguish them.
- `250000 / 200000 → 100` — clamped, never 125.
- `-5 / 200000 → 0` — clamped from below.
- `windowTokens: 0 → null`, with a non-zero `usedTokens`, so the guard is proven to be on the window.
- `windowTokens: -1 → null`.
- `Infinity / Infinity → null` — the § Error handling case. Without this test the added term is untested
  and a future "simplification" deletes it.
- `usedTokens: Infinity, windowTokens: 200000 → 100` — the deliberately *un*-guarded numerator.
- Every non-null return satisfies `Number.isInteger` — one assertion over the table above, so no case can
  quietly start returning a float.

### `ConversationScreen.test.tsx` — a new `ContextUsageReading` describe

Pure view, props injected, no store:

- `usedTokens: 146000, windowTokens: 200000` → the markup **equals** `<span class="composer__context">Context: 73%</span>`.
  A `toBe`, not a `toContain`: the exact-markup assertion is what proves AC3 structurally — no `tabindex`,
  no `onclick`, no `role`, no `<button>`, nothing else can be present in a string that short. State that in
  the test comment so the next reader doesn't relax it to a substring check.
- `windowTokens: 0` (with a non-zero `usedTokens`) → the markup is `''`. That is AC2's whole surface: no
  reading, no `0%`, no `Infinity%`, and no empty element holding the slot.
- `usedTokens: 250000, windowTokens: 200000` → contains `Context: 100%` and does **not** contain `Infinity`.

### `ConversationScreen.test.tsx` — additions to `describe('ConversationScreen — store binding')` (`:2655`)

- **The row mounts unconditionally and holds no reading at the initial store.** Contains
  `class="composer__footer"`; does **not** contain `composer__context`. AC4's held-empty arm at markup
  level, plus AC2 through the shipped tree.
- **The row follows the message box.** `markup.indexOf('composer__footer') > markup.indexOf('composer__row')`
  — the design's DOM order, and cheap insurance against it being dropped in above the textarea.
- **The reading mounts INSIDE the row once the store's initial snapshot carries real figures.** Use the
  `vi.spyOn(runConfigStore, 'getInitialState').mockReturnValue({ ...initial, snapshot: { model: '', effort: '', yolo: false, usedTokens: 168000, windowTokens: 200000 } })`
  seam, restored in a `finally`. Assert `Context: 84%` is present and that `composer__context`'s index is
  greater than `class="composer__footer"`'s.

  **Do not skip this test and do not try to reach it with `setState`.** zustand v5's `useStore` reads
  `getInitialState()` under `renderToStaticMarkup`, so a `setState` before the render is invisible —
  `ConversationScreen.test.tsx:2726-2736` records that this exact assumption cost #797 a correction
  measured on 2026-08-27. It is also the *only* test that proves `ContextUsageControl` is actually mounted
  in the row: an unwired control passes every pure-view assertion above.

### `RunConfigSections.test.tsx` — no edits

`:210-262` and `:700-707` must pass **unedited**. That is the behaviour-preservation proof for the
extraction, and editing them to accommodate the refactor would destroy it. If any of them goes red, the
extraction changed behaviour — fix the extraction, not the test.

### Not covered here, deliberately

- **A layout measurement of AC4.** The held height is structural (§ Design 5) and `.composer-status`
  shipped the identical guarantee without one. Driving the reading in the fake e2e tier would require the
  fake daemon to answer `requestSessionSettings`, which is real scope for a property no assertion could
  make stronger than "the element is unconditional and its height is declared".
- **No new e2e spec.** Nothing here needs a DOM: no interaction, no media query, no computed style.
  `npm run e2e` runs as a regression check — this ticket adds a sibling row and changes no existing
  locator, so it must stay green untouched.

### Gates

`npm run typecheck`, `npm test`, `npm run build`, `npm run e2e`.

## Scope check

Recorded so review can verify the sizing rather than trust it.

| Red line | Limit | This spec |
|---|---|---|
| New files | ≤ 3 | **2** — `contextUsage.ts`, `contextUsage.test.ts` |
| Production `.ts`/`.tsx` new-or-modified | < 5 | **3** — `contextUsage.ts` (new), `ConversationScreen.tsx`, `RunConfigSections.tsx` |
| New exported symbols | ≤ 5 | **2** — `contextUsagePercent`, `ContextUsageReading` (`ContextUsageControl` is module-private, the `ComposerErrorChipControl` precedent) |
| Total written lines | ≤ ~600 | **~300 projected**, at this repo's comment density: ~40 in `contextUsage.ts`, ~60 in its spec file, ~55 in `ConversationScreen.tsx`, ~80 in `ConversationScreen.test.tsx`, ~35 in `conversation.css`, ~5 net in `RunConfigSections.tsx` |
| Consumer call sites | ≤ 10 | **2** — `ContextWindowSection` and the new reading. No signature change, no type rename, no import flip, no test-fixture cascade (`RunConfigSections.test.tsx` is edited zero times, by design) |
| Acceptance criteria | ≤ 5 | **4** |
| Reject branches | < 10 | **1** — the single unavailable path, which is the point of the shared guard |

## Open questions

1. **`gap: var(--space-5)` on a one-child row.** Included as the design's measured item rhythm so
   #680/#682/#683 inherit it; inert until the second child lands. If review reads it as pre-deciding those
   tickets' layout, delete the line — nothing else in this spec depends on it.
2. **The 2px centring difference.** Figma insets the row's content 4px from the top and 0 from the bottom
   inside a 20px frame; `align-items: center` gives 2/2. Taken deliberately (one declaration instead of
   two, `.composer-status`'s trade). If it reads wrong beside the message box on screen, the fix is
   `align-items: flex-end`, not vertical padding — padding would grow the box under this repo's absent
   box-sizing reset.
3. **Whether `--color-primary` should move to `.composer__footer`.** Every item in the design's row is
   `schemes/primary`. Left on the reading here because the four future controls will each read their own
   node; whichever of them lands first is the natural place to hoist it, if it is right for all five.
4. **`ContextWindowSection`'s `NaN` fill width.** The finiteness guard closes the reading; the sheet's
   `width: ${pct}%` inline style is fed from the same `pct`, so it is closed by the same change. No separate
   work, noted so review knows it was considered rather than missed.

## Security review

**Verdict:** PASS (first pass FAILED on one MUST FIX, now addressed in § Design and § Error handling above;
checklist re-walked from the top against the revised text)

**Findings:**

- **[Trust boundaries]** MUST FIX *(fixed)* — two untrusted daemon-supplied numbers cross into a render
  surface: `usedTokens` / `windowTokens`, parsed at `inboundMessage.ts:533-534` by bare `requireNumber`
  (a `typeof` test with **no** range or finiteness check, ruled deliberate at `:617-621`). The spec
  originally extracted `RunConfigSections.tsx:406-409` verbatim, and that clamp is **not total**: a frame
  carrying `used_tokens: 1e999, window_tokens: 1e999` parses both to `Infinity`
  (`typeof Infinity === 'number'`, so the parser passes it), `Infinity / Infinity` is `NaN`, and `Math.min`
  / `Math.max` / `Math.round` all propagate it — yielding `Context: NaN%` on the new row and `NaN% used`
  with a `width: NaN%` fill on the shipped gauge. Remotely triggered, no exploit needed, and precisely what
  AC2 forbids. § Design now specifies `Number.isFinite(windowTokens) && windowTokens > 0` as the shared
  guard, § Error handling records the reachability path and the house precedent that authorises defending
  at the render slice, and § Testing strategy pins the case so the term cannot be deleted as dead code.
  Making the boundary a single named function with a `number | null` return — rather than a number beside a
  duplicated boolean — is what keeps the two surfaces from disagreeing about it; that is the ticket's own
  premise and it is now also the security property.
- **[Trust boundaries — no daemon string reaches the DOM]** No findings — the only value rendered is an
  integer in `[0, 100]` interpolated into a client-owned literal. There is no daemon-supplied text on this
  path at all, so the questions #796 had to answer (escaping, attribute sinks, `title` tooltips, newline
  collapsing, length bounds, truncation chains) do not arise: there is nothing to escape and nothing to
  bound. § Design forbids every attribute other than `className` anyway, so the sink surface is closed
  structurally rather than by convention. No object is constructed from daemon input either — the snapshot
  is built upstream — so there is no `obj[key] = value` and no prototype-pollution surface.
- **[Errors, logs, telemetry]** SHOULD FIX — the design is log-free by construction: no `console.*` on any
  branch of any of the three units, and no error path exists to tempt one (`contextUsagePercent` cannot
  throw). The residual risk is a developer adding a diagnostic while chasing the `Infinity` case; the
  figures are daemon-asserted, and `runConfigLive.ts:33-37` records that the renderer console is readable
  by anything that can open DevTools (#126). Code review should check that no `console.*` landed. The new
  Playwright surface is nil, so the fixture's no-`page.content()`-dump discipline is not engaged.
- **[Inter-process / Electron]** No findings — no `contextBridge` API, no `ipcMain` channel, no
  `webPreferences` change, no custom protocol, no `will-navigate` / `setWindowOpenHandler` surface, and
  nothing new crossing IPC (§ State + concurrency model). `window.pyry` is not dereferenced anywhere in
  this ticket's code. No remote content: the design adds no `<img>`, no font, no stylesheet and no URL —
  and Figma's generated code for `110:3497` is a bare `<p>` with no asset reference, so #796's
  privileged-renderer remote-`<img>` hazard is verified absent here rather than assumed. The transport is
  untouched and no secret moves renderer-ward.
- **[Tokens, secrets, credentials]** No findings — no credential, no token path, no storage, no lifecycle.
  The design reads two non-secret counters out of an existing renderer store.
- **[File / storage operations]** No findings — no path is built, no file read or written, no `localStorage`
  / `sessionStorage` / IndexedDB touched. No traversal, TOCTOU, atomicity or at-rest-encryption question
  arises. The reading is derived per render and persisted nowhere.
- **[Cryptographic primitives]** Not applicable — no RNG, hashing, key handling, nonce, or Noise surface.
  The single arithmetic operates on two non-secret counters, so there is no value to compare against a
  secret and no timing channel worth naming.
- **[Network & I/O]** No findings — no socket, no frame, no URL, no timeout, no reconnect. The
  `requestSessionSettings` cadence, its refresh edges and its reply parsing all belong to #810 and
  `inboundMessage.ts` and are untouched; this slice adds no outbound message of any kind.
- **[Concurrency]** No findings — no async task, timer, listener, subscription, effect, or shared-state
  mutation is added, so there is nothing to cancel on teardown and no work that can outlive the window.
  One race *was* available and is designed out: reading `usedTokens` and `windowTokens` through two narrow
  selectors could tear across a store tick and produce a percentage of two unrelated snapshots. § Design 3
  requires the single `selectSnapshot` read for exactly that reason, and both figures are then passed to
  one total function in one call.
- **[Threat model alignment]** *Hostile daemon response* is the applicable desktop threat and is the first
  finding above; beyond the arithmetic, the rendered string is bounded at 13 client-owned characters, so no
  oversized daemon value can widen the row or overflow the pane — the failure mode `.composer-status__label--tool`
  needed a whole truncation chain for cannot occur here. *Malicious relay* is content-blind and on-path: it
  cannot forge `session_settings` inside the Noise session, and dropping or delaying it only leaves the
  reading absent, which is AC2's designed arm. *Token theft from disk* and *renderer compromise reaching
  the transport* are unaffected — this ticket adds no storage and no bridge surface.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-27
