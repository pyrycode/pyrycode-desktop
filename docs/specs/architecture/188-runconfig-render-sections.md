# Spec #188 — Render the Run-configuration Model / Effort / YOLO sections (read-only)

Render three read-only sections — **Model**, **Effort**, **YOLO** — inside the Run configuration
sheet body, reflecting the session's current `model` / `effort` / `yolo` held in the renderer
store #187 landed (PR #190). Pure renderer, no transport, **not** `security-sensitive`. The
interactive change path is a separate sibling (#183); build these so #183 can wire handlers without
restructuring.

## Files to read first

- `src/renderer/src/store/runConfigStore.ts:21-63` — the **read surface this ticket consumes**:
  `RunConfigSnapshot { model: string; effort: string; yolo: boolean }`, the `useRunConfigStore(selector)`
  hook, and the `selectSnapshot` selector (`snapshot | null`). Import these; do **not** rebuild the store.
- `src/renderer/src/screens/conversation/LogDataSection.tsx` — the per-section **container / pure-view
  split to mirror**: `LogDataView` (props-in / markup-out, server-renderable, no `window.pyry`) + a thin
  container. Each section owns *both* its header and its content. Also note `.status-sheet__section-header`
  reuse (line 29).
- `src/renderer/src/screens/conversation/LogDataSection.test.tsx` — the **test idiom**: no jsdom;
  `renderToStaticMarkup` over the pure view for each visible state, plus one "container server-renders
  without touching `window.pyry`" case. Follow this exactly.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:41-60` — the **mount point** (the
  `{sheetOpen && <StatusSheet>…}` body and its current child order); also `RepairPrompt`/`RepairControl`
  at `:255-291` — the same store-read container + pure-view split, including the **zustand v5
  server-snapshot gotcha** (`useStore` server-renders `getInitialState()`, so a populated state is only
  testable on the pure view, never the container).
- `src/renderer/src/screens/conversation/conversation.css:360-435` — `.status-sheet__section-header`
  (reuse verbatim) and the `.log-data*` block: the **section-body CSS pattern** (token-only, off-grid
  paddings mapped to space tokens with the ±2px convention). Your new section styles live here.
- `src/renderer/src/theme/tokens.css:12-89` — the available theme tokens. This ticket adds exactly one:
  `--color-surface-container-highest: #32353a` (the M3 off-switch track; #182's context-window bar will
  reuse it).
- `src/shared/wire/types.ts:120-136` — `ScreenSnapshotPayload` field semantics: `model`/`effort` `''`
  = inherited daemon default; `yolo: false` = permissions enforced. These are the *values*, held verbatim.
- `src/shared/ipc/events.ts:59` — the `snapshotReceived` event shape the store mirrors (context only;
  this ticket never touches it — #187 owns the subscription).

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-100

A vertical stack of three labelled sections inside the bottom-sheet body, each with a muted
label-large header (`.status-sheet__section-header`). **Model** (`20:111`) is a three-row list — each
row an M3 radio (20px) plus a body-large name over a body-small descriptor; the active row shows a
filled `--color-primary` radio, the others an empty 2px `--color-on-surface-variant` ring. **Effort**
(`20:130`) is a five-segment control (`low/medium/high/xhigh/max`), each an `--radius-xs` pill; the
selected segment is a `--color-secondary-container` fill with `--color-on-secondary-container` text, the
rest a 1px `--color-outline` outline. **YOLO** (`20:143`) is a between-justified row — "Auto-accept tool
calls" over its caption on the left, a 52×32 M3 switch on the right (Figma shows the **off** state:
`--color-surface-container-highest` track, `--color-outline` knob at left).

## Context

The sheet shell (#177, PR #184) gives an empty scrollable body that composes sections via a `children`
prop on the exported `StatusSheet`. #187 (PR #190) added the data path: a headless `RunConfigData`
requests a snapshot on sheet open and writes the session's `{ model, effort, yolo }` into a dedicated
`runConfigStore`, held as `RunConfigSnapshot | null` (`null` until the on-open request resolves). This
ticket adds the *presentation*: three sections reading that store. The Model catalog itself is **static
renderer content** from the design; the snapshot supplies only the current `model` string, which
selects the highlighted row.

The Log-data section (#72) and the Context-window section (#182/#192) are separate, owned by their own
tickets — don't touch them.

## Design

### Module structure

One new file, mirroring `LogDataSection.tsx`'s container / pure-view split:

`src/renderer/src/screens/conversation/RunConfigSections.tsx`
- **`RunConfigView({ model, effort, yolo })`** — exported **pure** view. Renders all three sections
  (headers + bodies) from three primitive props. No store read, no `window.pyry` → server-renderable
  under `renderToStaticMarkup` with no mock. Internally composed of three in-file, non-exported
  sub-components (`ModelSection` / `EffortSection` / `YoloSection`), each taking its own value prop —
  the seam #183 makes interactive by adding an `onChange` per sub-section, no restructuring.
- **`RunConfigSections()`** — exported thin container mounted in the sheet body. Reads the snapshot
  once, coalesces `null` → the default triple, and renders `<RunConfigView … />`:

  ```ts
  const snapshot = useRunConfigStore(selectSnapshot)          // RunConfigSnapshot | null
  const { model, effort, yolo } = snapshot ?? { model: '', effort: '', yolo: false }
  return <RunConfigView model={model} effort={effort} yolo={yolo} />
  ```

  Coalescing here makes AC4's two default cases (`null` first-render **and** a real
  `{ model:'', effort:'', yolo:false }` snapshot) literally the same code path — indistinguishable by
  construction. `useRunConfigStore(selectSnapshot)` selects one narrow slice, so the view re-renders on
  each new snapshot (AC5) and never on unrelated state. No setter is ever called → read-only, no
  two-way binding.

### Model catalog + matching (module-private)

A static three-entry catalog constant (`MODEL_CATALOG`) and a pure matcher:

```ts
interface ModelCatalogEntry { family: string; name: string; descriptor: string }
// [{ family:'opus',   name:'Opus 4.7',   descriptor:'best for complex work' },
//  { family:'sonnet', name:'Sonnet 4.6', descriptor:'faster, cheaper' },
//  { family:'haiku',  name:'Haiku 4.5',  descriptor:'fastest' }]

function matchedFamily(model: string): string | null   // family whose token is a
                                                        // case-insensitive substring of `model`, else null
```

**Why family-substring, not exact-equality.** The daemon's `model` is a `claude --model <value>`
argument (`internal/sessions` `SessionSettings.Model`; empty = inherit daemon default). It may arrive
as a short alias (`"opus"` — the wire fixture value) or a full id (`"claude-opus-4-7"`), and can drift
across model versions. A case-insensitive family match (`opus` / `sonnet` / `haiku`) highlights the
right row for all those forms and degrades to **no highlight** for `''`, `null`, or any unrecognized
model — which is exactly AC4's blessed default, not an error. First match wins.

Effort matches by exact equality (`level === effort`) against the fixed five (`low/medium/high/xhigh/max`
— the daemon's accepted set); `''` / unknown → no segment marked.

### Sub-section render contracts

- **ModelSection** — `.status-sheet__section-header` ("Model") + a column of three rows. Each row: an M3
  radio span + a name/descriptor text column. `matchedFamily(model)` picks at most one selected row.
  - Radio unselected: 20px circle, 2px solid `--color-on-surface-variant` ring, transparent (Figma
    `20:119`/`20:124`). Decorative → `aria-hidden`.
  - Radio selected: 20px circle, 2px `--color-primary` ring + a centred filled `--color-primary` inner
    dot (Figma `20:114`, M3 selected radio). Give it an accessible cue (`role="img"` +
    `aria-label="Current model"`) so a screen reader knows which model is active.
- **EffortSection** — header ("Effort") + a flex row of five segments (`--space-2` gap). Selected
  segment: `--color-secondary-container` fill, `--color-on-secondary-container` text, no border, plus
  `aria-current="true"`. Unselected: 1px `--color-outline` outline, transparent, `--color-on-surface-variant`
  text. Keep segment heights equal across the has-border / no-border split (`box-sizing: border-box`,
  or a transparent 1px border on the selected segment).
- **YoloSection** — header ("YOLO mode") + a between-justified row: a flex-1 text column ("Auto-accept
  tool calls" body-large `--color-on-surface`, then "Claude runs commands without asking for
  confirmation. Use carefully." body-small `--color-on-surface-variant`) and the switch. Render the
  switch as `role="switch" aria-checked={yolo} aria-readonly="true"` with an accessible name (the
  "Auto-accept tool calls" text), so read-only state is honest and #183 flips it live by dropping
  `aria-readonly` and adding an `onClick`.
  - Off (`yolo:false`, the designed state): 52×32 track, `--color-surface-container-highest` fill + 2px
    `--color-outline` border, fully rounded; 16px `--color-outline` knob at left.
  - On (`yolo:true`): `--color-primary` track; knob shifted right, 24px, `--color-surface` (dark) for
    contrast. The Figma pins only the off state; this mirrors M3 on-switch semantics with existing
    tokens (no new on-primary token needed) for the rare `yolo:true` case.

### Wiring — `ConversationScreen.tsx`

Import and mount `<RunConfigSections />` in the sheet body, between the headless `<RunConfigData />`
and `<LogDataSection />` (Figma top-to-bottom order: Model, Effort, YOLO, then Context-window (#192,
lands later) and Log data last):

```tsx
<RunConfigData />
<RunConfigSections />   {/* new */}
<LogDataSection />
```

`RunConfigData` renders `null`, so DOM order relative to it is immaterial; place it first for
readability. This is the sole call site — no edit fan-out.

### CSS — `conversation.css`

New section styles appended to the existing `.status-sheet*` block, token-only (no color/type
literals), reusing `.status-sheet__section-header` for all three headers. Map Figma off-grid paddings
to space tokens with the established ±2px convention (e.g. the segment's `py-6` → `--space-2`, matching
`.status-row`; the segment `rounded-8px` → `--radius-xs` (6px), the 2px delta imperceptible). The 2px
name/descriptor gap is a structural literal (like the sheet handle's 32/4px), not a theme value.

### Tokens — `tokens.css`

Add one custom property beside the surface-container ramp: `--color-surface-container-highest: #32353a`
(M3 dark surface-container-highest — the off-switch track; #182's context-window bar reuses it).

## State + concurrency model

No async, no subscription, no teardown introduced here. `RunConfigSections` is a **pure reader** of the
`runConfigStore` singleton via `useRunConfigStore(selectSnapshot)` (one narrow slice). It re-renders
only when `snapshot` changes (AC5). It never dispatches or sets — read-only, no two-way binding. The
subscription that writes the store is #187's `RunConfigData`, untouched. No `window.pyry`, no
`useEffect`.

## Error handling

No failure surface is added — the sections render held primitives. `null` and empty-string / `false`
fields both coalesce to the same default render (AC4). An unrecognized `model` string produces "no row
selected", which is a correct render, not an error. No network / socket / parse concerns (those belong
to the transport and #187).

## Testing strategy

`npm test` (vitest), server-render only (no jsdom), mirroring `LogDataSection.test.tsx`. Test the
pure `RunConfigView` (props → markup) for state coverage; the container only for null-render + no-crash
(the zustand v5 server-snapshot gotcha means the container always server-renders the initial `null`
state — populated states are unreachable there, exactly like `RepairControl`).

- **RunConfigView — Model:**
  - `model:'opus'` → the Opus row carries the selected radio marker (`aria-label="Current model"`),
    Sonnet/Haiku do not.
  - `model:'claude-opus-4-7'` → still selects Opus (family match, not exact).
  - `model:'sonnet'` and `model:'haiku'` → select the respective row.
  - `model:''` and `model:'some-unknown-model'` → **no** row marked selected.
  - All three names + descriptors ("Opus 4.7"/"best for complex work", etc.) render in every case.
- **RunConfigView — Effort:**
  - each of `low`/`medium`/`high`/`xhigh`/`max` → that segment carries `aria-current="true"`, the
    others do not.
  - `effort:''` and an unknown value → no segment marked.
  - all five labels render in every case.
- **RunConfigView — YOLO:**
  - `yolo:true` → switch is on (`aria-checked="true"`); `yolo:false` → off (`aria-checked="false"`).
  - "Auto-accept tool calls" + the caption render in both.
- **RunConfigSections (container):**
  - server-renders without throwing and without touching `window.pyry` (it only reads the store; no
    bridge deref in render).
  - under server render the store's initial `snapshot` is `null`, so the output is the AC4 default —
    no radio selected, no segment marked, switch off. This asserts the null-first-render path directly
    (server render == the real opening frame before the snapshot arrives).

Type coverage under `npm run typecheck`; the salvage/QA gate is `npm run build`.

## Open questions

- **ON-state switch styling** is not pinned by Figma (only the off state is drawn). The spec prescribes
  M3 on-switch semantics with existing tokens; low-risk because current real data is always
  `yolo:false` (the write path is #183, not yet landed). Revisit if a design reference surfaces.
- **Segment radius** uses `--radius-xs` (6px) for Figma's 8px per the ±2px tokenization convention; if
  visual review wants the exact 8px, that's a new radius token (defer unless flagged).
