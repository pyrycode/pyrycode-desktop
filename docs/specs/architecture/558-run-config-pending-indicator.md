# #558 — Run config: show an in-flight settings change as pending, not as settled

**Size:** S (held from PO). 3 files: `RunConfigSections.tsx`, `RunConfigSections.test.tsx`, `conversation.css`.
Production `.ts`/`.tsx` files touched: **1**. New exported symbols: **0**. External call sites for the new
prop: **0** (`RunConfigView`'s only caller is the container in the same file; `ConversationScreen.tsx:209`
renders that container with no props).

## Files to read first

Codegraph is not initialized for this repo (`codegraph_context` → "CodeGraph not initialized"), so this
list is grep/Read-derived.

- `src/renderer/src/screens/conversation/RunConfigSections.tsx:87-115` — `RunConfigView`'s prop list and
  the three per-control callback derivations. This is where the new prop lands.
- `…/RunConfigSections.tsx:117-245` — `ModelSection` / `EffortSection` / `YoloSection`. Note the element
  each one wraps its controls in, and note that the `RunConfigError` `<p>` is a **sibling** of that
  wrapper, never a descendant (load-bearing — see § Design).
- `…/RunConfigSections.tsx:186-196` — `aria-current={isSelected ? 'true' : undefined}`. This is the
  file's attribute idiom: one attribute is both the a11y marker and the CSS hook, and it is **omitted**
  rather than rendered `"false"`. Clone that exact shape.
- `…/RunConfigSections.tsx:321-354` — the container. `writeState` is already the raw whole write state;
  `selectEffectiveSettings` is already called in the render body. The new derivation goes beside it.
- `src/renderer/src/store/runSettingsWriteStore.ts:237-262` — `selectPendingFields`. The source. Its
  return type is the new prop's type; do not restate the shape.
- `…/runSettingsWriteStore.ts:128-173` — the reducer. Confirms all three clearing paths
  (`settingsConfirmed`, `settingsRejected`, `reconnected`) are `pending.delete` / `new Map()`, i.e. one
  representation.
- `src/renderer/src/screens/conversation/LogDataSection.tsx:31-39` — the in-flight precedent:
  `aria-busy={busy}`. It pairs `aria-busy` with `disabled`; **take only the busy half** (AC3).
- `src/renderer/src/screens/conversation/LogDataSection.test.tsx:22-28` — how an `aria-busy` assertion is
  written against `renderToStaticMarkup` output in this codebase.
- `src/renderer/src/screens/conversation/RunConfigSections.test.tsx:13-20` — `NO_USAGE` and the
  `segmentFor` helper. Reuse both; do not add a DOM harness.
- `…/RunConfigSections.test.tsx:203-233, 267-295` — the `#257` interactive-toggle block and the container
  SSR test. The new tests sit alongside these and the container test gains one assertion.
- `src/renderer/src/screens/conversation/conversation.css:1338-1363` — the `aria-current` selection rules;
  `:1442-1469` — the `#257` operable-affordance block (`:focus-visible` uses `outline`, which the pending
  rule must not collide with) and the `.run-config__error` rule (the "reuse an existing role token"
  precedent).
- `src/renderer/src/theme/tokens.css:31-39` — `--color-tertiary`, `--color-error`, `--color-warning`. Read
  `--color-warning`'s comment: it is already the project's "in-progress" amber (#330).
- `e2e/run-config-settings.spec.ts:180-269` — every locator and assertion this ticket must not perturb.
- `e2e/real-daemon-session-settings.spec.ts:65-91` — the second set of locators over the same markup.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-100

The Run configuration sheet: a `20:111` column of three radio rows (filled `--color-primary` ring + dot
for the current model), a `20:130` row of five outlined effort pills (the current one filled
`--color-secondary-container`), and a `20:143` auto-accept row whose `20:147` M3 switch is drawn only in
its off state. Confirmed against the rendered node: **the design draws no pending, in-flight, or
indeterminate variant for any of the three** — every control has exactly two states. The pending
treatment below is therefore an annotation layer added on top of the drawn M3 states using an existing
theme token, not a redraw of them, in the manner of the undesigned `--color-error` rejection line (#257).

## Context

`runSettingsWriteStore` runs an optimistic write machine, and `selectEffectiveSettings` composes the
requested value over the confirmed override over the daemon snapshot. The optimistic overlay renders
**identically to a settled value** — the radio fills, the segment lights, the switch flips, and nothing
says "not yet". The gap is a relay round trip, and the change can still be rejected (#269) or abandoned
by a reconnect (#539). It matters most on the YOLO switch: a switch that reads as settled while in flight
is a wrong belief about the permissions posture, held while claude is running commands.

`selectPendingFields` (`runSettingsWriteStore.ts:238`) has been exported and unit-tested since #256 with
its purpose in its own docstring, and **has no production consumer** — grep finds only its own tests. This
slice is its first consumer. Nothing new is computed; an already-derived truth is finally rendered.

## Design

### The rule

One optional prop carries the three flags; each section renders `aria-busy="true"` on the element that
owns its controls; CSS keys off that attribute. No new state, no new store subscription, no new type.

### 1. The prop

```ts
// added to RunConfigView's props
pending?: ReturnType<typeof selectPendingFields>
```

- **Typed as `ReturnType<typeof selectPendingFields>`, not a restated literal.** The ticket's own warning
  is "do not introduce a parallel pending representation"; pinning the prop to the selector's return type
  makes a parallel representation a compile error rather than a review catch. `selectPendingFields` must
  be imported into the component file anyway (the container calls it), so this costs no extra import and
  adds no exported symbol to the store.
- **Not shaped like `errorField`.** `errorField` is `SettingsChange['field'] | null` because the store
  holds exactly one `error`. `pending` is a `Map` keyed by `changeId` *"so two outstanding changes are
  told apart"*; the three booleans are independent and any two can be `true` at once. A
  `pendingField | null` prop would silently collapse AC3's simultaneous case.
- **Optional.** Omitted ⇒ every section reads `pending?.model` etc. as `undefined` ⇒ falsy ⇒ attribute
  omitted ⇒ AC5 by construction. Each section takes a `busy?: boolean`, mirroring how `error?: boolean`
  is already threaded.
- **Independent of `onChange`.** The view marks whatever it is told, whether or not it is operable. In
  production the combination cannot occur (the container withholds `onChange` until a session id exists,
  and without a session id nothing can be dispatched, so `pending` is empty) — so gating one on the other
  would be logic for an unreachable state. Pinned by a test rather than by code.

### 2. Where the attribute goes

`aria-busy="true"` on **the element that owns the field's controls**:

| Field | Element | Why |
|---|---|---|
| model | `.run-config__model-list` (`:130`) | the field has three controls; the group is the field |
| effort | `.run-config__effort` (`:182`) | same — five segments |
| yolo | `.run-config__switch` (`:230`) | the field has exactly one control, and it *is* the switch; `.run-config__yolo` also wraps the title/caption text |

Three constraints make this placement load-bearing rather than arbitrary:

1. **It must not be an ancestor of the `role="alert"` rejection line.** `aria-busy="true"` on a container
   instructs assistive technology to withhold announcements for the subtree until it clears — which would
   silently suppress #269's rejection alert, the exact opposite of this ticket's purpose. In all three
   sections `RunConfigError`'s `<p>` is emitted **after** the wrapper's closing tag (`:165`, `:203`,
   `:242`), so it is a sibling and is never suppressed. Any future refactor that wraps the alert and the
   controls in a common `aria-busy` element breaks this. State it in the code comment.
2. **Suppression inside the group is the desired behaviour.** The operator's own click already announced
   the new value; withholding further churn until the round trip resolves, then re-reading when the
   attribute clears, is precisely the semantic `aria-busy` exists for.
3. **`aria-busy` contributes nothing to the accessible name or to any existing attribute**, so
   `getByRole('switch', { name: 'Auto-accept tool calls' })`, `[aria-label="Current model"]`,
   `aria-current`, `aria-checked` and `aria-readonly` are all untouched (AC2). This is why the marking is
   an attribute and **not** an appended `aria-label` — appending would break two live e2e locators
   (`run-config-settings.spec.ts:186,189`).

Rendered as `aria-busy={busy ? 'true' : undefined}` — the `aria-current` idiom two functions away.
**Omitted, never `"false"`**: rendering `aria-busy="false"` would change today's markup and fail AC5.

### 3. The visual treatment

A dashed `--color-warning` ring on the marked element. `--color-warning` is already documented in
`tokens.css:34` as the project's in-progress amber (#330) — semantically exact, and no new token, which
the ticket requires.

```css
/* #558 — the in-flight marker. Same attribute is the a11y marker and the CSS hook (the aria-current
   idiom). Gated entirely on [aria-busy='true'], so nothing-in-flight renders exactly as before (AC5). */
.run-config__model-list[aria-busy='true'],
.run-config__effort[aria-busy='true'] {
  border-radius: var(--radius-xs);
  outline: 1px dashed var(--color-warning);
  outline-offset: -1px;
}

/* The switch already has a 2px border and a full radius — recolour and dash it rather than ring it, and
   use `border`, NOT `outline`: :focus-visible owns the switch's outline (:1454) and would hide the
   marker exactly on the control that matters most. Wins over .run-config__switch--on on specificity. */
.run-config__switch[aria-busy='true'] {
  border-color: var(--color-warning);
  border-style: dashed;
}
```

Four properties this treatment must keep, in priority order:

- **Never reads as disabled.** The disabled convention here is muted grey
  (`--color-on-surface-variant` + `cursor: not-allowed`, `log-data__download:disabled`). Amber-dashed is
  categorically different, and no `cursor` change is applied.
- **Zero layout shift.** `outline` is outside the box model; the switch's `border-width` is unchanged.
  A pending marker that nudges the sheet would be worse than none.
- **No collision with the `#257` focus ring.** The focus outlines live on the *children*
  (`.run-config__model-row[role='button']:focus-visible`, `…-segment…`) for model and effort, and on the
  switch element itself — which is exactly why the switch uses `border` and the two groups use `outline`.
  The two channels never land on the same element with the same property.
- **A second, non-colour channel.** `aria-busy` carries the marking to AT (AC2), and the dash carries it
  visually for an operator who cannot separate amber from the surrounding greys.

No animation, no pulse: nothing to reason about under `prefers-reduced-motion`, and the state is not
transient enough to need motion to be noticed.

### 4. Container wiring

Derive beside the existing composition and pass down:

```ts
const effective = selectEffectiveSettings(snapshot, writeState)
const pending = selectPendingFields(writeState)   // new
const errorField = selectError(writeState)
```

**Do not add a second `useRunSettingsWriteStore` subscription for pending.** The container already
selects the raw whole write state (`:327`), and deriving both the displayed value and the marking from
**the same `writeState` reference in the same render pass** is what guarantees they can never disagree —
there is no frame in which the overlay shows the requested value while the marker is absent. That
invariant is the entire security value of this ticket; a separate subscription could tear.

Like `effective`, `pending` is a fresh object each render. That is fine and matches the existing code:
the child is not memoized, and the object is never used as a zustand selector result (the comment at
`:324-326` explains why the raw state is the selector).

### 5. What this ticket does not add

- No timeout on a pending marker. If a reply never arrives, the marker persists — which is the honest
  state, and #539's `reconnected` is the existing escape hatch. No observed failure justifies a timer.
- No second representation of pending state (AC4). The three clearing paths already converge on
  `pending.delete` / `new Map()` in the reducer; the view is a pure function of the resulting map.
- No e2e changes — see § Testing.
- No `window.pyry` read in `RunConfigView`. The pure view must stay bridge-free and
  `renderToStaticMarkup`-able with no mock; the whole test file rests on it.

## Error handling

No new failure modes: the marking is derived from a renderer-local boolean, performs no I/O, and cannot
throw. The interaction with the existing error surface is the one thing to get right, and it is covered
by constraint 1 above (`aria-busy` is never an ancestor of `role="alert"`) plus a negative test.

Failure direction is fail-safe in both directions: a missing marker degrades to today's behaviour, and a
spurious marker overstates uncertainty. Neither can make a settled value look more settled than it is.

## Testing strategy

`npm test` (vitest, `node` env, `renderToStaticMarkup`) — no DOM harness, matching the existing file.
`npm run typecheck` covers the prop's shape.

New `describe('RunConfigView — pending marker (#558)')`:

- **model only** (`{model: true, effort: false, yolo: false}`) — exactly one `aria-busy="true"` in the
  markup, and it is inside the `.run-config__model-list` tag.
- **effort only** — the single `aria-busy="true"` is on `.run-config__effort`, not on a segment.
- **yolo only** — the marker is on the `.run-config__switch` tag; `role="switch"` and the `aria-checked`
  value are unchanged.
- **two fields at once** (`{model: true, effort: false, yolo: true}`) — exactly **two** `aria-busy="true"`
  occurrences, on the model group and the switch, none on the effort row. *This is AC3's simultaneous
  case — the assertion a `pendingField | null` prop would have made unwritable.*
- **nothing in flight** — all-false and prop-omitted both produce markup containing no `aria-busy` at
  all, and the two strings are identical to each other (AC5).
- **stays operable** (AC3) — with `onChange` present and all three pending: `role="button"` and
  `tabindex="0"` still render, `aria-readonly` is still absent, and the markup contains neither
  `disabled` nor `aria-disabled`. This is the negative AC against cloning `LogDataSection`'s pairing.
- **existing markers untouched** (AC2) — with all three pending and `model="opus"`, `effort="high"`:
  `aria-label="Current model"` still occurs exactly once, `aria-label="Auto-accept tool calls"` is
  present, `aria-current="true"` still occurs exactly once, `aria-checked` reflects the passed `yolo`.
- **rejection alert not suppressed** — with `pending` set and `errorField` set for the same field, the
  `role="alert"` line still renders and its `<p>` is not inside the marked wrapper. Assert by isolating
  the wrapper's markup: the alert copy must fall outside it.
- **read-only path** (AC5) — `pending` set with `onChange` absent: still `aria-readonly="true"` and no
  `role="button"`; the marker renders regardless of operability.

New composition test for AC4 (imports `createRunSettingsWriteStore` + `selectPendingFields` from the
store) — the proof that the marker clears through the *existing* deletion and nothing else:

- Seed a store, `changeDispatched` a model change, render `RunConfigView` with
  `selectPendingFields(store.getState())` → marked. Then, once per arm with a fresh store, dispatch
  `settingsConfirmed` / `settingsRejected` / `reconnected` with the same `changeId`, re-derive, re-render
  → no `aria-busy`. One `it`, a loop over the three events.

Extend the existing container test (`:267-295`) with `expect(markup).not.toContain('aria-busy')` — the
opening frame has nothing in flight.

**E2E: no changes, and the existing specs must pass with no assertion edits.** `aria-busy` contributes
to no accessible name and alters no asserted attribute, and every locator in
`run-config-settings.spec.ts` / `real-daemon-session-settings.spec.ts` is either a class+`hasText` row
locator or a role/aria-label query over untouched values. Observing the marker in e2e would mean
asserting a state the fake relay resolves in milliseconds — a flake, not a proof. **Any edit to an e2e
spec in this ticket's diff is a signal that something drifted**, not routine upkeep.

## Open questions

- **Ring vs. recolouring the selected marker.** An alternative treatment tints the *selected* radio /
  segment amber instead of ringing the group. Rejected: it disappears whenever the pending value matches
  no row (unreachable today, since `onSelect` submits a catalog family token that round-trips through
  `matchedFamily`, but the pure view accepts any string), and it overloads the M3 selected state the
  design does draw. The group ring is visible for every input. If visual review prefers the tint, it can
  be layered on later without touching the markup contract.
- **`--color-warning` vs `--color-tertiary`.** Both are unclaimed for this purpose;
  `--color-warning`'s existing comment names it the in-progress colour (#330), which decides it. Flagging
  only because `--color-warning` currently has exactly one consumer (`conversation.css:876`), so this is
  the second use that fixes its meaning.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings — no new boundary, and the marking crosses none. It is derived from
  three renderer-local booleans (`runSettingsWriteStore.ts:238-262`), never from daemon-supplied text: the
  reject arm carries only `changeId` and #269 already strips the daemon message
  (`runSettingsWriteStore.ts:145-151`). Zero attacker-controlled string reaches the DOM, so this ticket
  adds no injection surface at all.
- **[Tokens, secrets, credentials]** Not applicable by design — the change touches no credential, no
  pairing record and no key material. Renderer-only, three files, none of which import from `src/main`.
- **[File / storage operations]** Not applicable by design — nothing is persisted. The marker is
  re-derived from store state every render and touches no `fs`, no `localStorage`, no IndexedDB. A
  pending marker cannot survive a restart, which is correct: an in-flight change does not survive one.
- **[Inter-process / Electron attack surface]** No findings — no IPC channel, no `contextBridge` addition,
  no `window.pyry` dereference. § Design point 5 explicitly forbids adding a `window.pyry` read to
  `RunConfigView`; the container's single existing dereference (`:338`) is unchanged and still constructed
  only when a session id exists. The renderer gains no capability.
- **[Cryptographic primitives]** Not applicable by design — no randomness and no comparison of secrets is
  introduced. Noted for completeness because the marker is keyed off `changeId`, which is minted with
  `crypto.randomUUID()` (`runSettingsControls.ts:20` → `submitSettingsChange`), not `Math.random()` — so
  a correlation id is unguessable from outside the Noise session. That property is pre-existing and this
  ticket depends on it; see the threat-model finding below.
- **[Network & I/O]** No findings — no socket, no frame, no timeout policy is added or changed. The one
  I/O-shaped question is the unbounded lifetime of a pending marker when a reply never arrives:
  **OUT OF SCOPE** for a timeout, and fail-safe in the meantime — the marker persists, which is the
  honest state ("still unconfirmed"), and #539's `reconnected` clears it on the next dial. A timeout would
  be a defence against a failure mode not yet observed.
- **[Error messages, logs, telemetry]** No findings, and this was the one category with a real trap.
  `aria-busy="true"` on a container instructs assistive technology to withhold announcements from its
  subtree — placing it on an element that encloses `RunConfigError` would have **silently suppressed
  #269's `role="alert"` rejection announcement on the very field the operator was told was in flight**,
  inverting this ticket's purpose for screen-reader users. The design places the attribute on the control
  wrapper, of which the alert `<p>` is a sibling (`RunConfigSections.tsx:165, 203, 242`), and pins it with
  a dedicated negative test. No new log calls; nothing daemon-supplied is rendered or logged.
- **[Concurrency]** No findings — no async work, subscription, timer or listener is added; the derivation
  is synchronous in the render body. The check-then-act shape that *would* matter here is explicitly
  designed out: § Design point 4 requires the displayed value and the marking to derive from **the same
  `writeState` reference in one render pass**, so there is no interleaving in which the optimistic value
  shows without its marker. A second `useRunSettingsWriteStore` subscription could tear those two apart
  and is forbidden in the spec.
- **[Threat model alignment]** Addressed, with one pre-existing item named. A **hostile relay** is
  on-path but content-blind: it can delay or drop the correlated reply, which leaves the marker standing —
  fail-safe, since the operator is told the change is unconfirmed, which is true. **Renderer compromise**
  gains nothing new (no capability added). The residual is a **hostile in-session daemon**: replying
  `sessionSettingsUpdated` for a change it never applied clears the marker and commits the optimistic
  value as confirmed, so the sheet would show a lie — including a YOLO posture the daemon never adopted.
  This is **pre-existing** (#256/#261 make the confirm the sole source of truth; #558 only stops
  *unconfirmed* values from looking settled) and it requires the daemon's static key, i.e. being inside
  the Noise session, which is the project's trust boundary. **OUT OF SCOPE** — a client-side defence would
  mean re-reading settings from the daemon after each ack, which daemon ADR 031 makes impossible (the
  change lands on the next session spawn, so `runConfigStore.snapshot` does not move on an ack). No ticket
  filed; belongs upstream in `pyrycode` if the trust model is ever tightened.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-18
