# #825 — A host-label field on the pairing screen

## Files to read first

Codegraph is wired for this repo but **not indexed** (`.codegraph/` holds a config and no DB — every
`codegraph_*` call answers `CodeGraph not initialized`, re-probed 2026-08-27). This list was built by
hand; do not spend a turn re-probing it.

- `src/renderer/src/screens/pairing/pairingState.ts:27-96` — the phase union, the event union, and the
  reducer. This is where `label` threads through, alongside `paste`. Read the header comment
  (`:1-11`) too: it states why this module is React-free and what may never cross the bridge.
- `src/renderer/src/screens/pairing/pairingState.ts:104-152` — `PairingBridge`, `runSubmit`,
  `runConfirm`. `runConfirm` is the seam this ticket widens; the "total by contract, never rejects"
  property in its doc comment must survive unchanged.
- `src/renderer/src/screens/pairing/PairingScreen.tsx:14-30` — the file header's SECRET HYGIENE
  paragraph. Everything AC5 protects is written down there; a second field must leave it true.
- `src/renderer/src/screens/pairing/PairingScreen.tsx:136-217` — `EntryPage`'s hero: the M3 filled
  field the new field mirrors, including the `aria-hidden` visual label + `aria-label` on the input
  and the block comment at `:156-177` explaining why the name is an explicit attribute.
- `src/renderer/src/screens/pairing/PairingScreen.tsx:218-250` — the supporting-text slot and its
  load-bearing React keys. **Do not touch this.** The new field sits *below* it and gets no
  supporting line of its own.
- `src/renderer/src/screens/pairing/PairingScreen.tsx:345-381` — the container. `handleConfirm` is
  where the label is read out of state and handed to `runConfirm`.
- `src/shared/ipc/pairing.ts:30-58` — `MAX_HOST_LABEL_LENGTH` (import it; do not restate 128) and
  `PairingRequest`'s optional `label`. The doc on the constant names this ticket as the second
  consumer that must bound against it.
- `src/shared/ipc/pairing.ts:96-120` — `isPairingRequest`. Read the `confirm` case's comment: a
  present-but-`undefined` `label` is *accepted* and means "no label", which is what AC2 rides on.
- `src/preload/index.ts:67-71` — `confirmPairing(label?)`. It omits the key entirely when the
  argument is `undefined`. Already shipped; do not change it.
- `src/main/hostLabelStore.ts:1-33` — the header names this ticket by number: "the input field
  (#825) bounds it on the way in". It also records that the store is AEAD-encrypted at rest and
  log-free, which is the mitigation the security review below leans on.
- `src/main/pairingHandler.ts:101-128` — the sink. It saves the label verbatim when
  `request.label !== undefined`, `''` included. That is why the renderer, not main, is what turns a
  whitespace-only label into no label at all.
- `src/renderer/src/screens/pairing/pairing.css:88-284` — the hero and every `.pairing-field*` rule.
  They are already generic enough for a second instance; the only gap is vertical separation and the
  right inset the code field gets from its 48px trailing slot.
- `src/renderer/src/screens/pairing/pairingState.test.ts` and `PairingScreen.test.tsx` — the two test
  files you extend. Read them before writing: the design below is chosen so **not one existing case
  changes**, and a diff that edits them means the design drifted.
- `CLAUDE.md` § "Build and test" — renderer tests are `renderToStaticMarkup` in a `node` environment.
  Nothing in this repo can click. Typing proof belongs in the reducer tests, not the render tests.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=103-2901

Read against the file on 2026-08-27: the 1280×1024 paste frame is a dark radial-gradient page with a
single M3 *filled* text field ("Pairing code", trailing round `highlight_off` clear glyph, 1px bottom
active-indicator) floated in the vertical centre, and a bottom-pinned stack of a full-width primary
"Pair" pill, a text "Cancel", and the muted open-source footer line. **The frame draws no second
field** — node `103:2901` contains exactly one text-field instance (`103:2904`), confirmed both in the
node tree and visually in the rendered frame. This is a real design gap, not a reading error, and the
visuals for the host-name field below are provisional until Juhana ships an updated frame. Until then
the new field reuses the *same* M3 filled treatment already implemented in `pairing.css`
(`.pairing-field*`), which is the only in-repo reference for what a field on this screen looks like.

## Context

#822 shipped the host-label store, #823 shipped the IPC write path (`PairingRequest`'s optional
`label`, its bound in `isPairingRequest`, `confirmPairing(label?)` in the preload), and #824 shipped
the read path back to the window. Every layer of the label's path exists except the one place the
operator can actually type it. This ticket is that field, and it is **renderer-only** — nothing in
`src/main/` or `src/preload/` changes.

The label is typed on the *paste* phase but sent on *confirm*, two phases later, so it cannot live in
a component-local `useState`: AC4 ("cancelling discards the typed label along with the paste") would
then be split across two mechanisms, one of them untestable at the pure tier. It threads through the
phase union the way `paste` already does, and `cancel`'s existing reset to `initialPairingState`
discards both in one atomic, already-tested move.

## Design

### 1. `label` on the phase union — optional, raw, absent-by-default

Add `label?: string` to the four paste-carrying arms of `PairingState` (`editing`, `submitting`,
`reviewing`, `confirming`). `paired` stays empty — it is terminal and carries nothing.

```ts
| { phase: 'editing'; paste: string; label?: string; error: PairingErrorReason | null }
| { phase: 'submitting'; paste: string; label?: string }
// …reviewing and confirming likewise, keeping their existing fields
```

Three decisions to hold, each of which a reviewer will otherwise question:

- **Optional, not `label: string` defaulting to `''`.** It mirrors `PairingRequest`'s own
  `label?: string` (`src/shared/ipc/pairing.ts:58`) exactly, so state and contract agree on what "no
  label" looks like: an absent key. The two-representations worry (`undefined` = never typed, `''` =
  typed then emptied) does not bite, because exactly one place decides whether a label exists —
  the normaliser in §3 — and it already has to collapse whitespace-only to nothing anyway. The
  practical dividend is that this is a **zero-cascade** change: every existing `PairingState` literal
  in both test files still compiles, and every `toEqual` still passes (vitest's `toEqual` ignores
  `undefined`-valued properties; none of these cases use `toStrictEqual`). A required field would have
  forced ~25 mechanical test-literal edits, which is over the edit-fan-out red line and would have
  split this ticket for no design reason.
- **The stored value is the RAW typed text, never normalised on the way in.** Trimming per keystroke
  would fight the controlled input: typing `my box` would lose the space the moment it is typed,
  because the trimmed value round-trips back into `value`. Normalisation happens once, at the confirm
  boundary.
- **`initialPairingState` is unchanged** — it has no `label` key, which is exactly what AC4 wants and
  what keeps `pairingState.test.ts:16` green.

### 2. `label-changed`

One new member on `PairingEvent`: `{ type: 'label-changed'; label: string }`.

Reducer arm, mirroring `paste-changed`'s phase guard: handled only in `editing`, returning `state`
unchanged elsewhere (so a stray event, including a mid-submit one, is a safe no-op).

**It does not clear `error`.** `paste-changed` clears it because editing the pairing code invalidates
the complaint about that code; typing a host name says nothing about the code, and wiping the
operator's only feedback on an unrelated keystroke would be a regression. This asymmetry is
deliberate and is pinned by a test.

The five arms that already carry `paste` forward — `submit`, `submit-succeeded`, `submit-failed`,
`confirm`, `confirm-failed` — carry `label` forward the same way, verbatim. `confirm-failed`
preserving the label matters: after a `persist-failed` the operator retries with a fresh submit and
must not have to retype the name.

### 3. Normalisation at the confirm boundary

A **module-private** helper in `pairingState.ts` — not exported; `runConfirm` is the tested seam:

```ts
function hostLabelToSend(label: string | undefined): string | undefined
```

Behaviour, one line: returns the label trimmed of surrounding whitespace, or `undefined` when it is
absent or trims to empty. Asserted through `runConfirm`'s `toHaveBeenCalledWith` cases below (AC1,
AC2). Trimming can only shorten, so a value that passed the field's bound cannot exceed the guard's.

Two signatures widen, both backward-compatibly (a zero-arg function stays assignable to a
one-optional-arg type, so no existing `PairingBridge` fake and no existing `runConfirm` call needs an
edit):

```ts
export interface PairingBridge {
  submitPairingPaste(paste: string): Promise<PairingSubmitResponse>
  confirmPairing(label?: string): Promise<PairingConfirmResponse>   // widened
}

export async function runConfirm(bridge: PairingBridge, label?: string): Promise<PairingEvent>
```

`runConfirm` calls `bridge.confirmPairing(hostLabelToSend(label))`. Passing `undefined` explicitly is
indistinguishable from passing nothing at the preload (`src/preload/index.ts:70` branches on
`label === undefined` and omits the key), which is what makes AC2's "no label at all rather than an
empty string" structurally true rather than merely intended. Everything else about `runConfirm` —
total by contract, `try` around the call itself, the caught value discarded unbound — stays exactly
as it is.

### 4. The field

`PairingViewProps` gains `onLabelChange: (label: string) => void`. `PairingView` resolves the
optionality once, passing `label={state.label ?? ''}` down, so `EntryPage` takes a plain `string` and
the input is unconditionally controlled.

The new field renders inside `.pairing-page__hero`, **after** the code field's supporting `<p>`, and
in both paste-phase states (`editing` and `submitting`) since `EntryPage` covers both. It reuses the
existing `.pairing-field` / `__row` / `__content` / `__label` / `__input` classes with one modifier
class for spacing, and mirrors the code field's structure exactly bar two omissions:

- **no clear control** — the code field has one because a few hundred base64url characters are not
  select-and-delete-able; a short name is. Fewer moving parts, and no second accessible name to
  collide with the `exact: true` matchers.
- **no supporting line** — the M3 supporting slot in this hero belongs to the code field, its two
  branches carry load-bearing React keys, and this ticket does not disturb it.

Attributes on the input, all load-bearing:

| Attribute | Value | Why |
|---|---|---|
| `type` | `"text"` | Never `password`; the name is not a secret. |
| `aria-label` | `"Host name (optional)"` | Must match the visible span text (label-in-name). Contains neither the substring `aria-label="Pairing code"` nor the exact name `Pair` nor `Clear pairing code`, so it joins none of the six external match sets. |
| `maxLength` | `{MAX_HOST_LABEL_LENGTH}` | Imported from `@shared/ipc/pairing` — a value import, which the renderer already does elsewhere (`sendInterrupt.ts:10`). Never the literal 128. |
| `autoComplete` | `"off"` | Secret hygiene, §Security review finding 2a. |
| `spellCheck` | `{false}` | Same. Matches the neighbour rather than reasoning about Chromium's spellchecker. |
| `value` / `disabled` / `onChange` | `label` / `busy` / `onLabelChange` | Controlled, dimmed in flight like the code input. |
| `name`, `id` | **absent** | AC5. See finding 2a. |

The visible label is the same `aria-hidden="true"` span idiom as the code field, reading
`Host name (optional)`. The `(optional)` is the only affordance telling the operator they may skip
the field, since there is no supporting line here and the Pair button's enabled condition
(`busy || paste.trim() === ''`) is **unchanged** — the label never gates pairing.

**No `<form>` wrapper.** The two inputs stay siblings under the hero div.

### 5. Container wiring

`handleLabelChange` dispatches `label-changed`. `handleConfirm` captures `const label = state.label`
before dispatching (the same before-the-await discipline `handleSubmit` uses for `paste`) and calls
`runConfirm(target, label)`. No other change.

### 6. CSS

Two small rules in `pairing.css`, keyed off a `.pairing-field--host` modifier on the new field's
container:

- a `margin-top: var(--space-6)` separating the two field groups (the hero is a column flex with no
  `gap`, and adding one there would also widen the 4px gap between the code field and its supporting
  line, whose 20px M3 slot geometry must not move);
- a `padding-right: var(--space-4)` on this field's `__row`, because `.pairing-field__row` ships with
  no right padding — the code field's right inset comes from its 48px trailing clear slot, which this
  field does not have. Without it the value would touch the field's right edge.

## State + concurrency model

No new store, no async task, no subscription, no stream, no teardown surface. The label lives in the
same `useReducer` cell as the paste and dies with it on `cancel` or unmount.

The one race worth naming: `handleConfirm` reads `state.label` before its `dispatch`, so there is no
check-then-act gap across the `await`. It is belt-and-braces rather than a live bug — `label-changed`
is already a no-op outside `editing`, so the label is structurally frozen from the moment `submit`
fires — but it costs nothing and matches the house idiom the file already documents at
`PairingScreen.tsx:353`.

## Error handling

Unchanged. The label has no failure mode of its own in the renderer: it is a string that is either
sent or not.

- A label the operator typed on a pairing that then fails at submit or confirm is **preserved**, not
  cleared — the retry is a fresh submit with the name still filled in.
- A `hostLabel.save` failure in main is deliberately *not* reported as a failed pairing
  (`pairingHandler.ts:118-128`); the confirm response reports on the record. So there is no new
  reject branch, no new `PairingErrorReason`, and nothing new for the supporting slot to show.
- `ERROR_COPY` stays a fixed `Record` with no interpolation. The label must never appear in an error
  message.

## Testing strategy

`npm test` (vitest, `environment: 'node'`) and `npm run typecheck`. **No existing case changes** — if
your diff edits one, the design drifted; come back to §1.

`pairingState.test.ts` — the pure tier, where every behavioural AC lives:

- `label-changed` in `editing` sets the label, preserving the paste **and** an existing `error`.
- `label-changed` outside `editing` (use `submitting`) returns the identical state object.
- `submit` → `submitting`, `submit-succeeded` → `reviewing`, `confirm` → `confirming` each carry the
  label forward.
- `submit-failed` and `confirm-failed` return to `editing` with both the paste and the label intact.
- `cancel` from `reviewing` with a label set returns `initialPairingState` — and assert the result
  has no own `label` key, not merely a falsy one (AC4).
- `runConfirm` with `'  Pyrybox  '` calls `confirmPairing` exactly once with `'Pyrybox'` (AC1).
- `runConfirm` table-driven over `''`, `'   '`, `'\t\n'` and `undefined`, each calling
  `confirmPairing` with `undefined` — not `''`, not omitted-and-unasserted (AC2). Assert the argument
  explicitly; `toHaveBeenCalledTimes(1)` alone would pass for an empty string.
- `runConfirm(bridge)` with no second argument still calls `confirmPairing(undefined)`.

`PairingScreen.test.tsx` — the static-markup tier, for the attribute-shaped ACs only:

- editing: the host field renders, carrying `maxlength` equal to the **imported**
  `MAX_HOST_LABEL_LENGTH` (build the expected substring from the constant, so a change to the
  constant moves the test with it — AC3).
- editing with a label in state: its value appears in the markup (proof the field is controlled off
  reducer state, which is all the static tier can prove; typing is covered above).
- editing: exactly one element carries `aria-label="Pairing code"` — the existing count case at
  `:86-89`, which now also guards the new field out of that match set. Extend its comment; do not
  change its assertion.
- editing: neither input carries a `name` or an `id`, and the render contains no `<form` (AC5). Match
  the attributes with a regex over the `<input` tags rather than a bare `' name="'` substring — the
  accessible name `Host name (optional)` contains the word `name` and a naive substring matcher is a
  trap waiting for the next person who renames the field.
- submitting: the host field renders `disabled` in flight. Note that the two existing
  `not.toContain('disabled')` cases stay green because React omits `disabled={false}` entirely.

Not covered here, by design: clicking, typing, focus. There is no DOM environment in this repo and
adding one is a separate, deliberate decision. An `e2e/` spec for typing a label is not in scope for
this ticket — the paste-phase e2e fixtures (`e2e/fixtures/pairingArrival.ts`) drive the code field
and Pair only, and they keep working untouched because the label field is optional and adds no
required interaction.

## Open questions

- **The Figma frame has no host-name field.** The treatment above is derived from the code field in
  the same hero and is provisional. When the updated frame lands, the label copy, the field order,
  and the `(optional)` affordance are the three things most likely to change. None of them touch the
  reducer.
- **Field order.** Code above, name below — the code is required and gates the Pair button, the name
  is optional garnish, and the supporting slot must stay adjacent to the field it describes. If the
  design update inverts this, it is a JSX move and a CSS modifier swap, nothing more.
- **Editing the label after pairing** is #826/settings territory, not here. This field writes once,
  at confirm.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST FIX. This ticket adds no boundary. The label's only renderer→main
  crossing is the existing `PAIRING_CHANNEL` confirm, validated by `isPairingRequest`
  (`src/shared/ipc/pairing.ts:115-116`), which is the sole enforcement point for the length bound.
  **Invariant to hold:** the field's `maxLength` is a UX affordance, *not* the security bound — a
  compromised or buggy renderer can call `window.pyry.confirmPairing(x)` directly with any string,
  exactly as it could since #823. Nobody may later relax the guard's bound on the grounds that "the
  field already limits it."
- **[Tokens, secrets, credentials]** Two findings, both addressed in the design:
  - *(2a) MUST HOLD (addressed).* Placing a second input beside a bearer-token field is the one new
    exposure this ticket creates. A `<form>` ancestor, or a `name`/`id` on either input, can make a
    password manager read the pair as a credential form and capture the pairing code. The design
    forbids all three on both inputs and sets `autoComplete="off"` / `spellCheck={false}` on the new
    field, and AC5's posture is pinned by a static-markup test. This is why it is a fix in the spec
    rather than a FAIL.
  - *(2b) SHOULD FIX / accepted.* An operator could mis-paste the pairing payload into the Host name
    field. Three things bound the damage: the label is sent only on a *successful* confirm, which
    requires the payload to also be in the code field (a double mistake, and Pair stays disabled on
    the single one); `maxLength` truncates any paste at `MAX_HOST_LABEL_LENGTH`, so a full token
    cannot be stored; and the sink is AEAD-encrypted at rest and log-free by construction
    (`src/main/hostLabelStore.ts:15-33`). Accepted rather than defended against — there is no observed
    occurrence, and a heuristic "that looks like a pairing code" check on a free-text name field
    would be a stochastic guard on a non-observed failure. Code-review should confirm `maxLength`
    is present, since it is the only thing bounding this.
- **[File / storage operations]** N/A with reason. This ticket writes nothing to disk and constructs
  no path. The one sink is `hostLabelStore.save` via `secureStore` (#822, ADR 0005), already audited:
  encrypt-at-rest, fail-closed, no filesystem access of its own. No path ever contains the label — it
  is stored *by a fixed name*, never *as* one.
- **[Inter-process / Electron attack surface]** No findings. No new IPC channel, no new
  `contextBridge` method, no `webPreferences` change, no custom protocol, no navigation surface. The
  two widened signatures (`PairingBridge.confirmPairing`, `runConfirm`) are renderer-internal; the
  preload method they call already accepts the argument and already omits the key when it is
  `undefined`. The renderer gains no capability it did not have after #823.
- **[Cryptographic primitives]** N/A with reason. Nothing in this path touches the Noise session, a
  key, a nonce, or a comparison against a secret. The label has no wire field, never enters #53's
  frozen snapshot, and never reaches `PairedServerRecord` — which is the property that keeps it from
  drifting a wire type (`src/main/hostLabelStore.ts:3-7`).
- **[Network & I/O]** N/A with reason. No socket, no relay URL, no frame, no timeout, no reconnect
  path is opened, read, or configured by this ticket.
- **[Error messages, logs, telemetry]** No findings, one invariant. There is no `console.*` on any
  label path in the renderer and none may be added; `ERROR_COPY` stays a fixed `Record` with no
  interpolation, so no error message can echo the label. The label is never a thrown value, never a
  field of one, and never crosses into a diagnostic channel.
- **[Concurrency]** No findings. No async task is launched, nothing outlives the screen. The only
  await-spanning read (`state.label` in `handleConfirm`) is captured before the dispatch, and
  `label-changed` is a no-op outside `editing`, so the value is frozen from `submit` onward by two
  independent mechanisms. `runConfirm` remains total — it never rejects, and a rejected invoke still
  coerces to `confirm-failed` / `malformed-request` with the caught value discarded unbound.
- **[Threat model alignment]** Renderer compromise reaching the transport: unchanged — process
  isolation holds, and the confirm carries no record, only display text. Hostile daemon: not on this
  path; the daemon never supplies a label, and the read direction is #824's. Malicious relay:
  untouched. **Explicitly out of scope:** rendering the stored label in the sidebar host row, whose
  escaped-text-only requirement (CLAUDE.md, operator ruling 2026-08-20) is #826's to hold.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-27
