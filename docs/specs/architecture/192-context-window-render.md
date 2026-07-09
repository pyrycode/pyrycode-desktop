# #192 — Run configuration sheet: render the session's context-window usage

**Size:** S · **Security-sensitive:** No (pure render of already-decoded, non-secret figures — no inbound parse, no keys, no sockets) · **Split from:** #182 · **Blocked by:** #191 (merged), #188 (merged)

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-151

A one-column section: a `label-large` header "Context window" (node 20:150), then a body frame (20:151, gap 8px) holding — a `body-large` usage line "73% used (146K of 200K tokens)" (20:152), a full-width 8px pill track (`surface-container-highest`, node 20:153) with a proportional-width fill in `success` green `#2fc038` (20:154), and a `body-small` `on-surface-variant` explainer (20:155). Reuses the existing `.status-sheet__section-header` for the header and the sheet's design tokens; the only atmospheric element is the green fill bar whose width encodes `used / window`.

## Files to read first

- `src/renderer/src/store/runConfigStore.ts:18-63` — `RunConfigSnapshot` interface + the DI store/selector. **Extend the interface** with the two usage figures; the store itself needs no logic change (it stores the shape verbatim).
- `src/renderer/src/screens/conversation/runConfigSnapshot.ts:25-32` — `toRunConfigSnapshot`. **Extend the copied object** with the two figures, mapping the event's snake_case → the store's camelCase.
- `src/renderer/src/screens/conversation/RunConfigSections.tsx` (whole, 158 lines) — the read-only section pattern (`RunConfigView` pure view + `RunConfigSections` container that coalesces `null → default`, plus in-file `ModelSection`/`EffortSection`/`YoloSection`). **This is where the new `ContextWindowSection` and the two extra `RunConfigView` props land**; mirror the in-file-component idiom exactly.
- `src/shared/ipc/events.ts:60-67` — the `snapshotReceived` event shape. Source of `used_tokens` / `window_tokens` (both required `number`, added by #191). **Do not edit** — read-only context for the field names/types.
- `src/renderer/src/screens/conversation/conversation.css:371-624` — the `.status-sheet__section-header` rule and the `.run-config__*` section-body rules (`--space-*`, text-body tokens, `--radius-full`). **Add the `.run-config__context-*` rules here**, mirroring `.run-config__yolo-*`.
- `src/renderer/src/theme/tokens.css:20,23,30,32` — confirms the four tokens the bar/explainer need already exist: `--color-surface-container-highest` (#32353a, track), `--color-on-surface-variant` (#c2c7cf, explainer), `--color-outline-variant`, `--color-success` (#2fc038, fill — matches Figma exactly). **No new token.**
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:49-60` — the sheet body: `<RunConfigSections /><LogDataSection />`. Confirms `RunConfigView`'s last child renders immediately before Log-data (satisfies AC1 ordering). **No edit needed here.**
- `src/renderer/src/screens/conversation/RunConfigSections.test.tsx` — the test idiom: `renderToStaticMarkup(<RunConfigView … />)` string assertions, no jsdom. **New `ContextWindow` describe block** goes here.
- `src/renderer/src/store/runConfigStore.test.ts` and `src/renderer/src/screens/conversation/runConfigSnapshot.test.ts` — the fixture cascade (see § Testing strategy). The `snapshotReceived` **event** fixtures already carry the two figures (#191); only `RunConfigSnapshot` literals and `toRunConfigSnapshot` **output** assertions need the two fields added.

## Context

The Run configuration sheet already renders three read-only sections (Model/Effort/YOLO, #188) from a snapshot held in `runConfigStore` (#187). The transport already carries `used_tokens` / `window_tokens` on the `snapshotReceived` event all the way to the renderer (#191, merged) — no new fetch, no transport change. But the run-config store deliberately narrows what it holds to model/effort/yolo; the two usage figures are dropped at both `RunConfigSnapshot` and the `toRunConfigSnapshot` copy. This ticket widens that narrowing by two fields and renders one more read-only section — the **Context window** usage gauge — into the same surface, between YOLO and Log-data (AC1).

`window_tokens == 0` is the daemon's "usage unavailable" signal (foreground session, or no transcript yet). The section must render an unavailable state in that case — never divide by zero, never show NaN/undefined/a broken bar (AC5).

## Design

### 1. Widen the held snapshot by two fields (`runConfigStore.ts`)

Add two required fields to `RunConfigSnapshot`:

```ts
export interface RunConfigSnapshot {
  model: string
  effort: string
  yolo: boolean
  usedTokens: number      // NEW — the session's consumed context tokens (event.used_tokens)
  windowTokens: number    // NEW — the session's context-window size; 0 = usage unavailable (event.window_tokens)
}
```

- Keep them **required**, not optional — this parallels model/effort/yolo (held verbatim, never coerced) and keeps the "absent" state expressed by `windowTokens === 0`, not by `undefined`. The store body (`setSnapshot` replace-whole, selectors) is unchanged.
- Update the interface's doc comment to note the two figures and the `windowTokens === 0` sentinel.

### 2. Copy the two figures through the filter (`runConfigSnapshot.ts`)

`toRunConfigSnapshot` maps the wire snake_case to the store camelCase, explicitly (not spread), consistent with the existing copy:

```ts
case 'snapshotReceived':
  return {
    model: event.model, effort: event.effort, yolo: event.yolo,
    usedTokens: event.used_tokens, windowTokens: event.window_tokens
  }
```

Unconditional copy — `used_tokens: 0` / `window_tokens: 0` flow through verbatim (no coercion), exactly as empty strings do today.

### 3. Render the section (`RunConfigSections.tsx`)

**`RunConfigView` gains two props** (`usedTokens: number`, `windowTokens: number`) and renders a new `<ContextWindowSection>` as its **last child, after `<YoloSection>`** (AC1 — places it between YOLO and the sibling `<LogDataSection>`):

```
<ModelSection … /> <EffortSection … /> <YoloSection … /> <ContextWindowSection usedTokens={…} windowTokens={…} />
```

**`RunConfigSections` container** — extend the null-coalesce default with the two figures so the not-yet-loaded case maps to `windowTokens: 0`:

```ts
const { model, effort, yolo, usedTokens, windowTokens } =
  snapshot ?? { model: '', effort: '', yolo: false, usedTokens: 0, windowTokens: 0 }
```

This is the load-bearing elegance: **the "no snapshot yet" default (`windowTokens: 0`) and the daemon's "usage unavailable" signal (`window_tokens: 0`) collapse into one branch** — `ContextWindowSection` only tests `windowTokens > 0`, mirroring #188's null/empty-snapshot unification. AC5's two cases become one code path.

**`ContextWindowSection({ usedTokens, windowTokens })`** — in-file, unexported (like `ModelSection`). Behavior contract:

- Always renders the header `<p className="status-sheet__section-header">Context window</p>` and the explainer (verbatim Figma 20:155 copy, see below).
- **Available (`windowTokens > 0`):** compute `pct = clamp(Math.round((usedTokens / windowTokens) * 100), 0, 100)`. Render:
  - usage line: `` `${pct}% used (${abbreviateTokens(usedTokens)} of ${abbreviateTokens(windowTokens)} tokens)` ``
  - a track (`.run-config__context-bar`) containing a fill (`.run-config__context-fill`) with inline `style={{ width: \`${pct}%\` }}`. Give the track `role="progressbar"` + `aria-valuenow={pct}` `aria-valuemin={0}` `aria-valuemax={100}` + `aria-label="Context window usage"` — honest a11y, matching the section's radio/switch/aria-current discipline.
- **Unavailable (`windowTokens <= 0`):** render a single muted line (`.run-config__context-unavailable`) "Context usage unavailable" **in place of** the usage-line + bar (no `role="progressbar"`, no division). Header and explainer still render.
- The `<= 0` guard (not `=== 0`) also absorbs a stray negative, defensively.

**Two small pure helpers, in-file and unexported:**

- `abbreviateTokens(n: number): string` — `n >= 1000 ? \`${Math.round(n / 1000)}K\` : String(n)`. Matches Figma's "146K"/"200K"; degrades to a raw count under 1000 (e.g. an early-session "500"). One-liner; covered through render assertions (§ Testing).
- The percentage is a one-line expression inline in the section; no separate export.

Both helpers stay unexported to keep the public surface unchanged (0 new exports). The developer MAY export `abbreviateTokens` for a direct unit test if preferred, but render-level coverage is sufficient and is what this spec requires.

**Exact copy (match verbatim):**
- Header: `Context window`
- Explainer (Figma 20:155): `When full, oldest messages get dropped from claude's view (delimiter still shows; old messages stay in your scroll).` — note lowercase "claude's"; reproduce exactly.
- Unavailable line: `Context usage unavailable` — architect-chosen (Figma pins only the populated state); keep unless an existing empty-state idiom fits better.

### 4. Styling (`conversation.css`)

Add `.run-config__context-*` rules after the `.run-config__yolo-*` block, mirroring their token usage (`--space-*`, `--radius-full`, the `body-large`/`body-small` text-token sets). Contract per element:

| Class | Figma | Key properties |
|---|---|---|
| `.run-config__context` | 20:151 | flex column; `gap: var(--space-2)` (8px); padding ≈ top 4px / sides `var(--space-4)` (16px) / bottom `var(--space-4)` — match Figma pt-4/px-16/pb-16 with nearest tokens |
| `.run-config__context-usage` | 20:152 | `body-large` text tokens; `color: var(--color-on-surface)`; `margin: 0` |
| `.run-config__context-bar` | 20:153 | `width: 100%`; `height: 8px`; `background: var(--color-surface-container-highest)`; `border-radius: var(--radius-full)`; `overflow: hidden` |
| `.run-config__context-fill` | 20:154 | `height: 100%`; `background: var(--color-success)`; `border-radius: var(--radius-full)`; width set inline per render |
| `.run-config__context-explainer` | 20:155 | `body-small` text tokens; `color: var(--color-on-surface-variant)`; `margin: 0` |
| `.run-config__context-unavailable` | — | `body-small` or `body-large` text tokens; `color: var(--color-on-surface-variant)`; `margin: 0` |

Fidelity note (mirrors the existing CSS comment at conversation.css:232-233): **trust the token names over the Figma export's fallback hexes.** The export writes `--schemes/success`/`--schemes/surface-container-highest`; the desktop equivalents are `--color-success`/`--color-surface-container-highest`.

## State + concurrency model

- **Store slice:** the existing `runConfigStore` singleton; the container selects the whole `snapshot` slice via `selectSnapshot` (unchanged). A new `setSnapshot` (fired by the #187 subscription on each `snapshotReceived`) replaces the whole object → the container re-renders with the new figures. **AC4 (reflect a newer snapshot after compaction) needs no new plumbing** — the existing narrow-slice selection already re-renders on replace; the ticket only widens the payload the selector returns.
- **No new effects, no new subscription, no async work.** The data path (`RunConfigData` + `subscribeRunConfig`, #187) already writes snapshots; this ticket only reads two more fields off the held value. No `AbortController`, no teardown change.
- **Unidirectional:** read-only. `ContextWindowSection` calls no setter; no two-way binding. `RunConfigView` remains a pure props-in/markup-out view that server-renders under `renderToStaticMarkup` with no `window.pyry` mock.

## Error handling

Pure render; the only failure modes are arithmetic/format edge cases, all handled deterministically in-component (no result type, no banner — nothing can throw):

- **`windowTokens <= 0`** → unavailable branch; **division never executes** (no NaN, no Infinity, no divide-by-zero). Covers the daemon's "usage unavailable" signal, the not-yet-loaded default, and a stray negative.
- **`usedTokens > windowTokens`** (near/over overflow) → `pct` clamps to 100; the bar cannot overflow its track. Raw abbreviated figures still shown honestly (e.g. "100% used (210K of 200K tokens)").
- **`usedTokens = 0`, `windowTokens > 0`** → "0% used (…)", zero-width fill — valid, not empty.
- No user-controlled or secret data reaches this section (already-decoded ints); nothing to sanitize.

## Testing strategy

`npm test` (vitest) + `npm run typecheck`. Follow the existing `renderToStaticMarkup` string-assertion idiom (no jsdom).

**`RunConfigSections.test.tsx` — new `describe('RunConfigView — Context window')`:**
- Available: `<RunConfigView … usedTokens={146000} windowTokens={200000} />` → markup contains `73% used (146K of 200K tokens)`, `role="progressbar"`, `aria-valuenow="73"`, and the serialized fill width `width:73%` (note `renderToStaticMarkup` emits `style="width:73%"`). Explainer text present.
- Proportionality / newer snapshot (AC4): `usedTokens={20000} windowTokens={200000}` → `10% used (20K of 200K tokens)` and `width:10%`.
- Rounding boundary: `usedTokens={45000} windowTokens={200000}` → `23% used (45K of 200K tokens)` (22.5 → 23).
- Sub-1000 abbreviation branch: `usedTokens={500} windowTokens={200000}` → `0% used (500 of 200K tokens)` (raw count, no "K").
- Over-full clamp: `usedTokens={210000} windowTokens={200000}` → `100% used`, `width:100%` (bar never exceeds track).
- Unavailable (AC5): `windowTokens={0}` (any `usedTokens`) → markup does **not** contain `% used`, `role="progressbar"`, `NaN`, `undefined`, or `Infinity`; **does** contain the header, `Context usage unavailable`, and the explainer.
- Explainer verbatim: assert the exact 20:155 string (including lowercase "claude's").

**`RunConfigSections.test.tsx` — extend the container test:** `renderToStaticMarkup(<RunConfigSections />)` (null snapshot → default) renders the unavailable state (no `% used`, no `NaN`), proving the null-default/`window==0` collapse.

**`runConfigSnapshot.test.ts` — extend output assertions (event fixtures already carry the figures):** the two `toRunConfigSnapshot(...).toEqual({…})` cases (~L33, L45) and the three `subscribeRunConfig` `setSnapshot` expectations (~L113, L146, L147) gain `usedTokens`/`windowTokens` matching each fixture's `used_tokens`/`window_tokens`. Add one assertion that a fixture with `window_tokens: 0` maps to `windowTokens: 0` (the unavailable figure survives the copy). **Do not touch the event inputs** — they already include the two fields.

**`runConfigStore.test.ts` — fixture cascade (mechanical, one file):** every `RunConfigSnapshot` literal / `setSnapshot({…})` arg / `toEqual({…})` expectation (~L21, L28, L29, L30, L35, L38, L44, L50, L62 — ~9 sites) gains `usedTokens` + `windowTokens` to satisfy the now-required fields. Values are immaterial to these store-mechanics tests (use `0`/`0` or any ints); add one assertion that `setSnapshot` holds the two figures verbatim (AC3 for the new fields).

## Open questions

- **Unavailable-state copy.** "Context usage unavailable" is architect-chosen (Figma pins only the populated state). If a live-design follow-up specifies different empty-state copy, it's a one-line change. Not a blocker.
- **Percentage clamp on display.** This spec clamps the **displayed** percentage to 100 (not just the bar), so an over-full session reads "100% used" rather than ">100%". If the PO prefers the raw honest percentage in the text while clamping only the bar width, that's a one-line split of the `pct` value — flag at review if desired. Default: clamp both.
