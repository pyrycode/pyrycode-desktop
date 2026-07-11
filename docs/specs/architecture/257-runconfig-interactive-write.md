# #257 — Run configuration sheet: change Model / Effort / YOLO (interactive)

The last child of #183. Everything upstream has landed; this slice only wires the three read-only
sections (#188) to the already-built write machine and renders that machine's composed state. It owns
**none** of the optimistic / confirm / reject / rollback logic — that is `runSettingsWriteStore` (#256).

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-100

The Run configuration sheet, column layout: a **Model** radio list (Opus/Sonnet/Haiku rows, filled M3
radio on the selected row — `20:111`), an **Effort** segmented control (`low medium high xhigh max`,
the selected segment filled with `secondary-container #3a4857` / `on-secondary-container #d6e4f7` —
`20:130`), and a **YOLO** row with an M3 switch (`20:143`). The interactive frame is **visually
identical to #188's read-only render** — the same rows/segments/switch, the same selection tokens;
this slice only makes them operable (a click changes the selection). There is **no error-state frame**
in the mobile file (it draws only populated/default states, the #279-banner finding), so the AC4 error
surface is design-doc-sourced — see *Error handling* below.

## Files to read first

- `src/renderer/src/screens/conversation/RunConfigSections.tsx` (whole, 238 lines) — the read-only
  sections to make interactive. Note the container/pure-view split (`RunConfigSections` reads one store
  slice → `RunConfigView` is props-in/markup-out, server-renderable with no mock); `MODEL_CATALOG` +
  `matchedFamily` (case-insensitive family substring); `EFFORT_LEVELS`. **This is the only file this
  slice modifies besides the new helper.**
- `src/renderer/src/store/runSettingsWriteStore.ts:26-40,156-229` — `SettingsChange` union, the
  singleton `runSettingsWriteStore`, `useRunSettingsWriteStore`, and the pure selectors
  `selectEffectiveSettings(snapshot, state)` / `selectError(state)` / `selectPendingFields(state)` this
  slice reads (does not re-derive).
- `src/renderer/src/store/runSettingsWriteBridge.ts:60-109` — `SubmitSettingsChangeDeps` +
  `submitSettingsChange(deps, change)`: mints the `changeId`, dispatches `changeDispatched`
  (record-before-send), sends exactly one `setSessionSettings` command. `sessionId` is typed **non-null**
  here — the gate that turns `string | null` into a call/no-op is this slice's new helper.
- `src/renderer/src/store/sessionIdStore.ts:48-58` — `sessionIdStore`, `useSessionIdStore`,
  `selectSessionId` → `string | null` (`null` until the first `session_transition` marker; AC5 gate).
- `src/renderer/src/store/runConfigStore.ts:60-70` — `runConfigStore`, `useRunConfigStore`,
  `selectSnapshot` → `RunConfigSnapshot | null` (the daemon snapshot base for `selectEffectiveSettings`).
- `src/renderer/src/screens/conversation/modalResolution.ts` (whole, 98 lines) — **the pattern to
  mirror** for the new `runSettingsControls.ts`: React-free click-effects with injected deps
  (`sendCommand`/`dispatch`), plain-spy testable under the `node` env because the view cannot fire clicks.
- `src/renderer/src/screens/conversation/PermissionModal.tsx:185-233` — how the container wires pure
  click-effects into `onClick`/`onSelect`, dereferencing `window.pyry.sendCommand` **only inside the
  handler closure** (interaction time), never during render.
- `src/renderer/src/screens/conversation/modalResolution.test.ts` — the plain-spy test idiom to mirror
  for `runSettingsControls.test.ts`.
- `src/renderer/src/screens/conversation/RunConfigSections.test.tsx` (whole, 221 lines) — the render-test
  idiom to extend: `renderToStaticMarkup` + the `segmentFor` helper, `node` env (no jsdom), and the
  container's "server-renders the default without touching `window.pyry`" test that **must stay green**.
- `src/renderer/src/screens/conversation/conversation.css:832-1020` — the existing `run-config__*`
  classes (`model-row`, `radio--selected`, `effort-segment[aria-current='true']`, `switch` / `switch--on`).
  Add the operable affordance (cursor/focus) and the error accent here. `--color-error` (`#ffb4ab`) **does
  exist** despite the stale comment at css:68 (mobile #279 finding).
- `src/shared/ipc/commands.ts:76` + `src/shared/wire/types.ts:149-157` — the `setSessionSettings` command
  and `SetSessionSettingsPayload` presence contract (absent key = leave unchanged). **Read-only** — the
  command is already built by `submitSettingsChange`; this slice never touches the wire.

## Context

#188 rendered Model/Effort/YOLO read-only and was built to become interactive by adding a change handler
per sub-section (and, for YOLO, dropping `aria-readonly`). The write path is fully landed: the current
`session_id` lives in `sessionIdStore` (#259); the pending → confirm/reject → rollback machine is
`runSettingsWriteStore` (#256) with `submitSettingsChange` as the submit helper and `selectEffectiveSettings`
as the composed display value; `RunSettingsWriteData` is already mounted app-level in `App.tsx` folding the
correlated daemon replies back in. This slice is the renderer glue between the controls and that machine.

## Design

Two production files: one **new** React-free helper, and the **modified** sections file.

### 1. `runSettingsControls.ts` (new — the AC5 gate + submit)

Co-located in `screens/conversation/`, React-free, injected deps — the `modalResolution.ts` shape.
Its whole job is to turn the `string | null` session id into a gated call. Contract:

```ts
export interface RunSettingsControlDeps {
  sessionId: string | null              // sessionIdStore's value; null → not ready
  sendCommand: (command: RendererCommand) => void
  dispatch: (event: RunSettingsWriteEvent) => void
  mintChangeId?: () => string           // test injection; forwarded to submitSettingsChange
}

// AC5 gate: sessionId === null → no-op (no send, no dispatch). Otherwise delegate to the landed
// submitSettingsChange with sessionId narrowed to string.
export function changeSetting(deps: RunSettingsControlDeps, change: SettingsChange): void
```

Behaviour (one branch): if `deps.sessionId === null` return immediately; else call
`submitSettingsChange({ sessionId, sendCommand, dispatch, mintChangeId }, change)`. No new send/dispatch
logic — it forwards to `submitSettingsChange`, which is already unit-tested (#256). The null guard is the
deterministic safety net behind the container's structural gate (below), and the seam that makes AC5
unit-testable under `node`. Invariant pinned by test: `changeSetting` with a null `sessionId` calls
neither `sendCommand` nor `dispatch`.

### 2. `RunConfigSections.tsx` (modified)

**Pure view (`RunConfigView`) — additive optional props.** Keep the existing value props; add:

```ts
onChange?: (change: SettingsChange) => void   // present ⇒ controls operable; absent ⇒ today's read-only markup
errorField?: SettingsChange['field'] | null   // the last-rejected field, or null
```

`RunConfigView` derives three narrow callbacks from the single `onChange` (so the `SettingsChange`
construction lives in exactly one place) and passes them + the matching error flag down:

- `ModelSection` gains `onSelect?: (family: string) => void` and `error?: boolean`. When `onSelect` is
  present each row becomes operable — `role="button"`, `tabIndex={0}`, `onClick={() => onSelect(entry.family)}`
  — the row submits **`entry.family`** (`'opus'`/`'sonnet'`/`'haiku'`), which round-trips: `matchedFamily`
  re-selects the same row from the optimistic overlay, and the family token is a valid `claude --model`
  alias. When `onSelect` is absent the row renders exactly as #188 (no role, no handler).
- `EffortSection` gains `onSelect?: (level: string) => void` and `error?: boolean`. Each segment becomes
  operable when `onSelect` is present, submitting the segment's `level` (exact-match round-trip).
- `YoloSection` gains `onToggle?: (next: boolean) => void` and `error?: boolean`. When `onToggle` is
  present the switch **drops `aria-readonly`** and gains `role="switch"` + `onClick={() => onToggle(!yolo)}`
  (AC3); when absent it keeps `aria-readonly="true"` (#188's read-only markup).

Making the operable affordance key off *handler presence* is the whole AC5 gate at the view layer: no
handler ⇒ the section is literally today's inert markup.

**Container (`RunConfigSections`) — reads three stores, wires at interaction time.** Data flow:

- `sessionId = useSessionIdStore(selectSessionId)` — `string | null`.
- `snapshot = useRunConfigStore(selectSnapshot)` — the daemon base.
- `writeState = useRunSettingsWriteStore(selectWriteState)` and `dispatch = useRunSettingsWriteStore(s => s.dispatch)`.
- Compute in the render body (not inside a zustand selector — see *State*): `effective =
  selectEffectiveSettings(snapshot, writeState)` and `errorField = selectError(writeState)`.
- `ready = sessionId !== null`. Pass `onChange` **only when `ready`**; otherwise pass `undefined`:

```ts
const onChange = ready
  ? (change: SettingsChange) =>
      changeSetting({ sessionId, sendCommand: window.pyry.sendCommand, dispatch }, change)
  : undefined
```

`window.pyry.sendCommand` is dereferenced only inside that closure (interaction time), and the closure is
built only in the `ready` branch — so a server render (sessionId `null` under SSR) never constructs it and
never touches `window.pyry` (the LogDataSection / composer discipline; keeps the container's SSR test
mock-free). Render `<RunConfigView model={effective.model} effort={effective.effort} yolo={effective.yolo}
usedTokens={…} windowTokens={…} onChange={onChange} errorField={errorField} />` — `usedTokens`/`windowTokens`
still come from the snapshot exactly as #188.

### Gate: belt-and-suspenders, both deterministic

1. **Structural (primary):** the container withholds `onChange` when `sessionId === null`, so the rendered
   controls are inert — nothing to click (AC5's "the controls are inert until then").
2. **Runtime (safety net):** `changeSetting`'s null guard no-ops even if a handler were somehow invoked.

Both are deterministic code (not a stochastic rule paired with a stochastic net) — the
[[Belt-and-Suspenders Means Different Fabric]] principle. `sessionIdStore` only ever *sets* the id (never
back to `null`), so branch 2 is pure insurance and the AC5 test seam.

## State + concurrency model

- **Three read-only store slices, one dispatch, one command.** The container reads `sessionIdStore`,
  `runConfigStore`, and `runSettingsWriteStore`; it dispatches only `changeDispatched` (via
  `submitSettingsChange`) and sends only one `setSessionSettings` command per interaction. No component
  writes settings state directly — unidirectional (AC: "a control submits an intent, the store resolves it").
- **The store owns optimism/rollback.** The displayed value is `selectEffectiveSettings` (optimistic
  pending overlay > client-confirmed override > snapshot base). On confirm the store commits the sent value
  and drops the pending marker; on reject it drops the pending marker (the overlay vanishes → the view falls
  back to the last confirmed/snapshot value = the rollback) and records the rejected field. This slice reads
  the composed result; it does not re-derive it. `RunSettingsWriteData` (already mounted) delivers the
  correlated replies regardless of whether the sheet is still open.
- **Re-render correctness.** `selectEffectiveSettings` returns a fresh object each call, so it must **not**
  be the zustand selector (a fresh object every store tick defeats `Object.is` and re-renders needlessly).
  Select the raw `writeState` (and `dispatch`, `sessionId`, `snapshot`) with stable selectors, then call the
  pure `selectEffectiveSettings` / `selectError` in the render body. The container mounts only inside the
  open sheet, so its re-render cost is already scoped.
- **No new subscription / teardown.** No effects, no async iterables, no `AbortController` here — the inbound
  path is `RunSettingsWriteData`'s existing app-level listener. This slice adds only synchronous click → submit.

## Error handling

- **Rollback is automatic** (store-owned): a `settingsRejected` reply deletes the pending marker, so
  `selectEffectiveSettings` immediately stops showing the requested value — "no requested value is left
  standing on failure" (AC4) with zero extra code here.
- **Error surface (new, design-doc-sourced).** `selectError` returns the last-rejected field
  (`'model' | 'effort' | 'yolo' | null`) — #269 strips the daemon message, so the copy is derived from the
  **field**, not daemon text. The container passes `errorField`; `RunConfigView` sets `error` on the matching
  sub-section, which renders a `role="alert"` line styled with the `--color-error` accent (reuse the existing
  token; no new theme token — CLAUDE.md forbids). Suggested per-field copy (keep it **apostrophe-free** —
  `renderToStaticMarkup` escapes `'` → `&#x27;`, the #188/#279 lesson — so the test asserts against clean
  strings): a small `RUN_CONFIG_ERROR_COPY: Record<SettingsChange['field'], string>` map, e.g. `model:
  'Could not change the model — try again.'` (final wording is the developer's; the map is the single source).
  The error auto-clears on the next `changeDispatched` for any field (the reducer sets `error: null` on
  dispatch) — a retry clears it; no manual dismiss is required by the AC. At most one section shows an error
  at a time (the store holds one `error` field).
- **Send failure.** `submitSettingsChange` is fire-and-forget (`sendCommand` is `void`); a bridge throw is
  not a modelled reject and is out of scope here (no daemon reply ⇒ the optimistic overlay simply persists
  until the user retries — the same posture as the composer's send).

## Testing strategy

`npm test` (vitest, `node` env — **no jsdom**, no click firing) + `npm run typecheck`.

**`runSettingsControls.test.ts` (new — plain spies, the `modalResolution.test.ts` idiom):**
- `changeSetting` with `sessionId: null` and any change → neither `sendCommand` nor `dispatch` is called (AC5).
- `changeSetting` with `sessionId: 'sess-1'` and `{ field: 'model', value: 'opus' }` (inject `mintChangeId`)
  → `dispatch` called once with `{ type: 'changeDispatched', changeId, change }`; `sendCommand` called
  **exactly once** with `{ type: 'setSessionSettings', payload: { session_id: 'sess-1', model: 'opus' },
  changeId }` — the same `changeId` on both (delegates to `submitSettingsChange`; AC1 submit path).
- The same for `{ field: 'effort', value: 'high' }` and `{ field: 'yolo', value: true }` (payload carries
  only the single changed key; AC2/AC3 submit path).

**`RunConfigSections.test.tsx` (extend — `renderToStaticMarkup` on the pure `RunConfigView`):**
- With an `onChange` handler present: the YOLO switch markup has **no** `aria-readonly`; the selected
  model row and effort segment expose the operable affordance (`role="button"` / `tabindex`) (AC1/2/3
  operability). Selection markers (`Current model`, `aria-current="true"`, `aria-checked`) still reflect the
  passed values exactly as #188.
- Without `onChange` (absent): the switch keeps `aria-readonly="true"` and rows carry no `role="button"` —
  identical to #188's read-only markup (AC5 inert form).
- `errorField='model'` → the Model section renders the alert copy / `--color-error` hook; `effort`/`yolo`
  sections do not. Repeat per field. `errorField={null}` → no error markup anywhere.
- **Container (keep + extend):** the existing "server-renders the default without touching `window.pyry`"
  test stays green — under SSR `sessionId` is `null` ⇒ no `onChange` ⇒ the switch keeps `aria-readonly` and
  no operable affordance renders; `selectEffectiveSettings(null, initial)` yields the same empty default;
  `errorField` is `null`. Add assertions for `aria-readonly="true"` present and no `role="button"` in the
  default.
- **Do not re-test** `selectEffectiveSettings` / the reducer / `submitSettingsChange` / `matchedFamily` /
  the context-window math — those are covered by #256 and #188. This slice tests only the new wiring seam,
  the operable/inert render toggle, and the error surface.

## Open questions

- **Keyboard activation.** The spec makes rows/segments operable via `role="button"` + `onClick`. Full
  M3 a11y would add `onKeyDown` (Enter/Space) and arguably `role="radio"`/`radiogroup` for the model list.
  The ticket says "add a click … rather than restructuring," so click + `role="button"` is the baseline;
  elevating the model list to a radiogroup is a deliberate non-goal here (flag if the developer wants it).
- **Error copy wording.** No Figma error frame exists; the `RUN_CONFIG_ERROR_COPY` strings above are
  placeholders. Keep them apostrophe-free and field-derived; final wording can be refined without changing
  the contract.
