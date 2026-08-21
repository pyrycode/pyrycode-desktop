# #665 — Pairing screen: restyle the paste phase to the desktop Pair Screen frame (103-2901)

## Files to read first

Codegraph is **not initialized** for this repo (`codegraph_status` → "CodeGraph not initialized"), so this
list was built by hand from greps and direct reads. Every consumer named below was re-verified against
`main` at spec time (2026-08-21, after #664 merged).

| Path | What to extract |
|------|-----------------|
| `src/renderer/src/screens/pairing/PairingScreen.tsx:45-70` | `PairingView` — the root `<div className="pairing">` and the phase branches. The root className is what this ticket makes phase-dependent. |
| `src/renderer/src/screens/pairing/PairingScreen.tsx:72-122` | `EntryCard` — the entire markup this ticket replaces. Note `disabled={busy}` on the field and on Cancel, and `disabled={busy \|\| paste.trim() === ''}` on Pair. |
| `src/renderer/src/screens/pairing/PairingScreen.tsx:124-159` | `ReviewCard` — **do not touch**. It is why `.pairing__title` / `__instruction` / `__accent` / `__actions` / `__button` must survive (AC6). |
| `src/renderer/src/screens/pairing/pairing.css:1-9` | The file header's token-and-literals contract. AC8 says keep that line; extend the header rather than replacing it. |
| `src/renderer/src/screens/pairing/pairing.css:11-27` | `.pairing` today — the card box. This is the class that must keep matching the paste phase (AC7). |
| `src/renderer/src/screens/pairing/pairing.css:99-163` | The fingerprint / success / actions / button rules. All survive untouched. |
| `src/renderer/src/screens/welcome/welcome.css:16-46` | Reference implementation for the frame: `height: 100%`, `space-between`, `--space-7`/`--space-8` padding, the glow. **Read it, restate it — never import it or reach for `.welcome__*`.** |
| `src/renderer/src/screens/welcome/welcome.css:124-208` | Reference for the CTA stack, the pill, the bare text row, and the footer. Same geometry, same tokens. |
| `src/renderer/src/screens/welcome/WelcomeScreen.tsx:19-36` | The module-level copy-constant idiom, and the footer string with its U+00B7 MIDDLE DOT. |
| `src/renderer/src/screens/channels/RenameConversationDialog.tsx:54-64` + `channels.css:568-605` | The stacked label-over-input field chrome. Start here for the field's *shape*; **do not** copy its wrapping-`<label>` naming mechanism (see § Contracts). |
| `src/renderer/src/screens/conversation/conversation.css:1254-1270` | The house rule for translucency: *"a dedicated scrim element so no bare `rgba()`/`color-mix` literal is needed. 40% via opacity (opacity is not a color literal)."* The field's 72% fill follows this. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:1252-1270` | The inline-SVG icon-button idiom: `<button aria-label>` wrapping an `<svg aria-hidden fill="currentColor">`. The renderer ships no `.svg` files. |
| `src/renderer/src/theme/tokens.css:16-37, 74-97, 99-119` | Every token this spec names. All are present on `main`; **this ticket adds none.** |
| `src/renderer/src/screens/pairing/pairingState.ts:26-70` | The phase union and the `paste-changed` out-of-phase guard — the reason the clear control needs no `busy` guard of its own. |
| `src/renderer/src/screens/pairing/PairingScreen.test.tsx:26-53` | The four editing-phase tests. `:29` asserts a heading this ticket deletes; `:31` asserts `<textarea`; `:34`/`:40`/`:52` use `disabled` as a proxy. |
| `src/main/pairingPayload.ts:85-120` | What the pasted value actually **is**: a strict base64url blob, trimmed before parsing. This is what the placeholder decision below rests on. |
| `e2e/unpair-repair.spec.ts:13-27, 42, 58, 65, 73` | The one-binding contract comment that names this ticket, and the vacuous-negative hazard at `:58`. |
| `e2e/smoke.spec.ts:79-95` | The `.pairing` binding: visible at `:86`, count 0 at `:93`. Same one-binding structure. |
| `e2e/fixtures/pairingArrival.ts:20-68` | The shared drive behind ten specs. Note `getByRole('button', { name: 'Pair', exact: true })` at `:59`. |
| `scripts/live-drive.mjs:70-90` | The AC9 one-liner in context. The surrounding secret handling is out of scope. |

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=103-2901

A full-window 1280×1024 page: a blue radial glow over the near-black surface, 28/32 frame padding, a
vertically-centred M3 **filled** text field inset 64px inside the content column (label `Pairing code`
over a single-line input, a 1px bottom active indicator, a 48px trailing clear-glyph slot, and an
empty supporting-text slot below), and a bottom-pinned CTA stack of a full-width `Pair` pill, a bare
full-width `Cancel` text row, and the `Open source · github.com/pyrycode/pyrycode-desktop` footer. It is
the welcome frame's skeleton (`103-744`) with the hero replaced by the field — same glow centre, same
padding, same three-row CTA block.

## Context

The paste phase still wears the mobile "Paste pairing code" dialog (`19-54`) stretched to the window: a
420px centred card with its own `<h1>` and instruction paragraph, floating on an otherwise empty window.
Since #657/#662 the screen it now follows — welcome — is a full-window page, so the first-run flow
currently jumps from a full-bleed page to a small dialog card. `103-2901` is the desktop frame that
closes that seam.

Behaviour does not change. This is a restyle of one component's paste branch, plus one new control
(clear), plus one line in the live-drive script. The reducer, both IPC calls, and every seam
(`onPaired`, `onCancel`, `onPasteChange`, `onSubmit`) are untouched.

## Contracts this ticket must not break

Three deterministic contracts. Each is a single binding in an outside file where the negative half
passes vacuously against a stale selector — so breaking one is silent, not red.

### C1 — exactly one element carries the literal `aria-label="Pairing code"`

Six consumers match the **raw attribute**, not the accessible name:

- CSS attribute selector `[aria-label="Pairing code"]` — `e2e/unpair-repair.spec.ts:42,73`,
  `e2e/paired-shell-navigation.spec.ts:47`, `e2e/fixtures/pairingArrival.ts:54`
- markup substring `aria-label="Pairing code"` — `src/renderer/src/App.test.tsx:22` (used at `:62`, `:87`,
  `:116`), `src/renderer/src/PairedShell.test.tsx:32` (used at `:108`)

So the accessible name **must** come from an explicit `aria-label` attribute on the `<input>`. A wrapping
`<label>` supplies a name but emits no attribute; all six would go dark. See § Design for why this spec
also declines the wrapping `<label>` for the chrome.

`unpair-repair.spec.ts:58` is a `toHaveCount(0)` whose honesty rests entirely on the same `pairingBox`
binding at `:42` being asserted positively at `:65`. The file says so in a comment at `:20-24` and names
this ticket. **Do not inline the selector there and do not split the binding.**

### C2 — `.pairing` stays on the root element in every phase

`e2e/smoke.spec.ts:81` binds `page.locator('.pairing')` once and asserts it visible at `:86` (welcome CTA
landed on pairing) and count 0 at `:93` (Cancel returned to welcome). Renaming the paste phase's root
fails `:86` outright and makes `:93` pass for the wrong reason. `.pairing` is reduced to what both
treatments share; the treatment is an **additional** class, never a replacement.

### C3 — `getByRole('button', { name: 'Pair', exact: true })` still resolves to exactly one button

`e2e/fixtures/pairingArrival.ts:59` (ten drives) and `scripts/live-drive.mjs:84`. The clear control is on
screen at that moment — the drive fills the field before clicking Pair — so its accessible name must not
be `Pair`, and must not be `Pairing code` either (AC3). This spec pins it to `Clear pairing code`.

Also unaffected but worth knowing: `Cancel` is likewise matched with `exact: true`
(`smoke.spec.ts:91`), and the busy label `Pairing…` is exactly why those call sites carry `exact`.

## Design

### Class taxonomy

Three blocks in `pairing.css`. Multiple blocks per stylesheet is house convention
(`conversation.css` carries `.message-row`, `.bubble`, `.status-sheet*`, `.run-config__*`).

| Class | Role |
|-------|------|
| `.pairing` | **Contract class + shared base.** Present on the root in every phase (C2). Holds only what both treatments share: `box-sizing: border-box`, `display: flex`, `flex-direction: column`, `color: var(--color-on-surface)`, `font-family: var(--font-sans)`. |
| `.pairing-card` | The 420px dialog box — everything else that is on `.pairing` today (`gap`, `width`, `max-width`, `margin`, `padding`, `background`, `border-radius`). Applied on `reviewing` / `confirming` / `paired`. Its children keep their existing `.pairing__*` names untouched (AC6; renaming them would be an out-of-scope refactor). |
| `.pairing-page` | The full-window frame. Applied on `editing` / `submitting`. Children are `.pairing-page__*`. |
| `.pairing-field*` | The M3 filled field, its own block so the future confirm-phase lift is a class swap on the root and nothing else. |

`.pairing-card` and `.pairing-page` are **siblings, not overrides** — neither undoes a property the other
sets. That is what keeps the two treatments separable when the confirm frame lands.

Root className is derived from the phase the view already branches on:

```
const isPaste = state.phase === 'editing' || state.phase === 'submitting'
// className={`pairing ${isPaste ? 'pairing-page' : 'pairing-card'}`}
```

Reuse `isPaste` for the existing paste-branch condition at `:49` rather than repeating the comparison.

### Markup contract — the paste branch

`EntryCard` becomes `EntryPage`, same props, same call site. Structure (element → class → note):

```
div.pairing-page__hero          flex:1, centres the field group vertically, 64px side inset
  div.pairing-field             the filled container; ::before carries the 72% fill
    div.pairing-field__row      position:relative (see the painting-order trap below)
      div.pairing-field__content    label above input, flex:1
        span.pairing-field__label   "Pairing code", aria-hidden
        input.pairing-field__input  aria-label="Pairing code"  ← C1
      button.pairing-field__clear   aria-label="Clear pairing code", only when paste !== ''
        svg.pairing-field__clear-icon  aria-hidden, fill="currentColor"
  p.pairing-field__supporting   the instruction OR the error (mutually exclusive; see § Error handling)
div.pairing-page__ctas          bottom-pinned, 12px gaps
  button.pairing-page__pair     "Pair" / "Pairing…"
  button.pairing-page__cancel   "Cancel"
  p.pairing-page__footer        "Open source · github.com/pyrycode/pyrycode-desktop"
```

Attribute contract on the `<input>`:

- `type="text"` — **not** `password` (it would mask a value the operator may need to eyeball, and in a
  browser context invites a manager save-prompt) and not `url` (the payload is base64url, not a URL).
- `aria-label="Pairing code"` — C1, the whole reason the attribute is explicit.
- `autoComplete="off"`, `spellCheck={false}`, **no `name`**, **no `id`**, **no `<form>` ancestor** — AC2's
  autofill / spellcheck / password-manager hygiene. An unnamed, form-less field is not autofill-keyed.
  Vendor manager attributes (`data-1p-ignore` etc.) are deliberately **not** added: browser extensions
  cannot inject into a sandboxed Electron renderer, so they would be dead weight.
- `value={paste}`, `disabled={busy}`, `onChange` → `onPasteChange(e.target.value)` — unchanged.

**No wrapping `<label>`.** The visible label is a `<span aria-hidden="true">`. Two reasons: (a) HTML
forbids interactive content inside a `<label>`, so the clear `<button>` could not live in the field's row
under that idiom; (b) a wrapping label re-introduces the exact hazard #664 avoided — a second element
resolving to the accessible name "Pairing code", which is what makes `unpair-repair.spec.ts:58`'s
`toHaveCount(0)` fragile under `getByLabel`. `aria-hidden` on the visual duplicate keeps exactly one
element in the accessibility tree carrying that name, which is C1 restated for the a11y tree.

Consequence accepted: clicking the label text does not focus the input. Mitigated structurally —
`.pairing-field__input` takes the remaining height of the 48px content box, so most of the field's
surface is the input itself.

### Frame geometry — the values that must not be re-derived

Measured on `103:2901` and `103:2904` at spec time; the derivation is recorded so review can check it.

**The glow.** Fill is `radialGradient(r=10)` under `matrix(88.233 -2.9848 3.0359 89.745 608.93 304.22)`,
stops `rgba(19,74,116,1)` (= `--color-primary-container`) at 0 and alpha 0 at 0.7. Column norms ×10 give
semi-axes 882.8 × 898.0; the 0.7 stop puts full transparency at 617.9 × 628.6 px = 48.3% × 61.4% of the
1280×1024 box, centred at (47.6%, 29.7%). Verbatim, because a typo here is silent:

```css
background:
  radial-gradient(ellipse 48% 61% at 48% 30%, var(--color-primary-container), transparent),
  var(--color-surface);
```

The same arithmetic on welcome's matrix (`88.13 -5.2073 4.8361 81.846`, identical centre) yields
48% × 56% — exactly what `welcome.css:42` already ships, which validates the method against a
known-good result. **The delta from welcome is real and purely vertical: 56% → 61%.** Do not copy
`welcome.css:42`.

**The page frame.** `height: 100%` (rides the `html/body/#root` chain at `index.css:5-9`, exactly as
`.welcome` does — verified: both mount sites render the screen as a bare child with no wrapper, see
§ Mount sites), `box-sizing: border-box`, `justify-content: space-between`,
`padding: var(--space-7) var(--space-8)`.

**The field** (`103:2904`, 1088×56 inside a 1216 content column ⇒ `padding: 0 var(--space-16)` on
`.pairing-page__hero`; `--space-16` is 64px):

| Part | Value | Source / note |
|------|-------|---------------|
| container fill | `--color-surface` at **72%** | Figma `rgba(16,19,26,0.72)`; `--color-surface` is `rgb(16,20,24)`, within 2/255. Alpha via `opacity`, never `rgba()`/`color-mix()` — `conversation.css:1263-1268`. |
| corners | `--radius-xs` on the **top two only** | Figma 4px → 6px, the file's established +2px snap (`pairing.css:54-56`, `channels.css:568-571`). |
| active indicator | `border-bottom: 1px solid var(--color-on-surface-variant)` | The exported SVG strokes `#49454F` = M3 **light** `on-surface-variant`; the dark-scheme role is `--color-on-surface-variant`. 1px is structural geometry (the file's literal carve-out). |
| row padding | `var(--space-1) 0 var(--space-1) var(--space-4)` | Figma State-layer `pl-16 py-4`, no right padding. |
| content box | height 48px, `flex: 1`, column, `justify-content: center`, `padding: var(--space-1) 0` | Figma Content `h-48 py-4`. |
| label | `--text-body-small-*` on `--color-on-surface-variant` | M3 body-small. |
| input | `--text-body-large-*` on `--color-on-surface`, `flex: 1`, borderless, `background: none`, `outline: none`, `padding: 0`, `width: 100%` | M3 body-large. The `.rename-conversation__input` reset (`channels.css:592-605`) is the model. |
| clear slot | button 40×40, `border-radius: var(--radius-full)`, `margin: 0 var(--space-1)`, `flex-shrink: 0` | Figma draws a 48×48 slot flush right holding a 40×40 round state layer and a 24×24 glyph. 4 + 40 + 4 = the 48px slot exactly, with no extra element. |
| clear glyph | 24×24 `<svg>`, `fill="currentColor"`, `aria-hidden="true"` | See § The clear glyph. |
| supporting text | `padding: var(--space-1) var(--space-4) 0`, `--text-body-small-*` on `--color-on-surface-variant` | Figma `I103:2904;52798:24384`: `pt-4 px-16`, 16px line + 4px pad = the drawn 20px. In normal flow below the field, not absolutely positioned — same result, less machinery. |

**Painting-order trap.** An absolutely-positioned `::before` with `z-index: auto` paints **above**
non-positioned in-flow siblings, so a naive `.pairing-field::before { position: absolute; inset: 0 }`
hides the label, the input and the glyph behind the fill. The fix this spec prescribes is one
declaration, not a negative z-index: give `.pairing-field__row` `position: relative` so it paints after
the pseudo in DOM order. `inset: 0` resolves against the padding box, so the pseudo never covers the
bottom border — the active indicator survives. Use `border-radius: inherit` on the pseudo so it picks up
the top-only corners.

**The CTA block** — geometrically identical to welcome's, minus the leading icon: `padding-top:
var(--space-3)`, `gap: var(--space-3)`, rows of 56/56/24+8.

| Part | Value |
|------|-------|
| `Pair` pill | `width: 100%`, `height: 56px`, `border: none`, `border-radius: var(--radius-lg)` (already the drawn 28px), `background: var(--color-primary)`, `color: var(--color-on-primary)`, `--text-label-large-*`, `cursor: pointer` |
| `Cancel` row | `width: 100%`, `height: 56px`, bare (`background: transparent`, `border: none`), `color: var(--color-on-surface)`, `--text-label-large-*`, `border-radius: var(--radius-lg)` for the hover/focus shape |
| footer | `padding-top: var(--space-2)`, centred, `--text-label-small-*` on `--color-on-surface-variant`, `opacity: 0.55` |

The footer's 0.55 is `welcome.css:203`'s already-shipped value for the same footer; the contrast question
was raised and settled there and diverging now would just make the two frames inconsistent. The footer
copy is restated as a local module constant (the `WELCOME_COPY` idiom) — **not** imported from
`WelcomeScreen.tsx`, since cross-screen imports are what § "no shared cross-screen CSS" rules out. The
separator is U+00B7 MIDDLE DOT.

**Interactive states** (none are drawn in the frame; all follow conventions already in these files):

- `:focus-visible` → `outline: 1px solid var(--color-outline)` on Pair, Cancel and clear
  (`pairing.css:156-158`, `welcome.css:191-194`).
- `.pairing-field:focus-within` → `border-bottom-color: var(--color-primary)`. This is the M3 focus
  affordance and preserves today's `.pairing__paste:focus-visible { border-color: var(--color-primary) }`
  behaviour without inventing a 2px-indicator token.
- hover on Cancel and on clear → `background: var(--color-surface-container)` (`pairing.css:152-154`,
  `welcome.css:187-189`). On the round clear button this doubles as M3's state layer.
- `:disabled` on Pair and Cancel → `opacity: 0.38` (the M3 disabled value already at `pairing.css:160-163`).

### The clear glyph

The M3 kit's `cancel` in its unfilled form — an outlined ring with an × (classic Material Icons name
`highlight_off`). Figma exports it as a **20×20** path inset 8.33% inside a 24×24 box, so render it as a
24px `<svg>` with `viewBox="-2 -2 24 24"` (or a 20px svg centred in the slot); do not scale the 20px art
to fill 24px. Path data is in the frame export and reproduces the standard glyph; the developer can lift
it from `get_design_context` on `103-2904` or use the Material `cancel` outline path directly. Inline JSX
per the house idiom — the renderer ships no `.svg` files.

### Clear-control behaviour

- Rendered only when `paste !== ''` (AC3). Literal-empty, not `.trim() === ''`: a field holding only
  whitespace is still worth clearing.
- `onClick` → `onPasteChange('')`. It passes a **constant**, never the current value, so no code path in
  this ticket reads or forwards the pasted secret.
- **Never carries `disabled`** (AC3), including while `busy`. This needs no guard: `pairingReducer`'s
  `paste-changed` arm returns `state` unchanged outside `editing` (`pairingState.ts:64-68`), so a click
  during `submitting` is already a safe no-op. The out-of-phase guard is doing this work; do not add a
  second one.
- Its own accessible name is `Clear pairing code` — distinct from `Pairing code` (AC3) and from `Pair`
  (C3). The exact-match attribute selector `[aria-label="Pairing code"]` does not match it, and neither
  does the substring marker `aria-label="Pairing code"` (the rendered attribute reads
  `aria-label="Clear pairing code"`).
- Accepted consequence: the input's width jumps by 48px as the first character is typed. That is inherent
  to AC3's deliberate divergence from the frame (which draws the control on an empty field) and is not
  worth reserving the slot for.

### Mount sites

Both mount sites get the page treatment and both are fine — verified, not assumed:

- `src/renderer/src/App.tsx:51` — `onCancel={props.onPairingCancelled}` (→ welcome, #662). `AppView`
  returns the screen bare; the sibling `*Data` components render null, so `.pairing`'s `height: 100%`
  resolves against `#root` exactly as `.welcome`'s does.
- `src/renderer/src/PairedShell.tsx:123-129` — the `pairServer` route, `onCancel` → settings, `onPaired` →
  the new server's list. `PairedShell` renders no wrapper element at all (grep for `className` in that
  file returns nothing), so the same chain applies.

## State + concurrency model

Unchanged, and deliberately so. `PairingScreen` still owns `useReducer(pairingReducer,
initialPairingState)`; `PairingView` stays pure (props in, markup out, no hooks); the two IPC calls stay
in interaction handlers with no `useEffect`. The clear control adds no state, no event type, and no
reducer arm — it re-uses `paste-changed`, whose out-of-phase guard is what makes it safe mid-submit.

No async work, no subscription, no timer, and no cancellation surface is added by this ticket.

## Error handling

The failure modes are unchanged: `ERROR_COPY` (`PairingScreen.tsx:28-34`) maps the five value-free
`PairingErrorReason` categories to fixed copy with no interpolation. AC4 requires the mapping stay
exactly as it is.

What changes is where the copy lands. The supporting slot renders **the instruction or the error, never
both, never neither**:

- no error → `<p className="pairing-field__supporting">Run pyry pair --print on your server and paste the
  output here.</p>`
- error → `<p className="pairing-field__supporting pairing-field__supporting--error" role="alert">{ERROR_COPY[error]}</p>`

Two distinct elements, mutually exclusive — **not** one element whose `role` flips. A `role="alert"`
element is announced when it is inserted; flipping `role` on a live element at the same moment its text
changes is unreliable across screen readers. Two elements preserves today's already-working mechanism
(`PairingScreen.tsx:102-106`) verbatim. Because exactly one is always rendered, the 20px slot never
collapses and there is no layout shift on error.

The error colour stays `--color-tertiary`, carried over with the existing rationale at
`pairing.css:86-89` (no error token exists; tertiary is the palette's only attention colour).

## Recorded design calls

Divergences that review should read as intentional, not drift.

1. **No `<code className="pairing__accent">` in the supporting line.** The instruction is flat text. M3
   supporting text is a single 12px type role; a mono accent inside it is a visual invention with no
   frame reference (the frame's supporting slot is drawn empty). `.pairing__accent` survives untouched
   for `ReviewCard` (AC6), and the existing assertion `toContain('pyry pair --print')` still passes
   against the plain string.
2. **The placeholder is dropped.** Two reasons: the frame draws none (persistent label, empty input),
   and the current string `pyry://home.lan:7117?token=…` **misdescribes the actual payload** —
   `parsePairingPayload` requires a strict base64url blob (`src/main/pairingPayload.ts:89,108-110`), not
   a URL. Removing a wrong affordance is strictly better than restyling it. Should this read as
   over-reach, the fallback is one attribute and AC2 is the criterion to amend.
3. **No heading in the paste phase.** The frame draws none, so the `<h1>Paste pairing code</h1>` and its
   instruction paragraph go. The screen is left with no heading element. Not compensated with a
   visually-hidden heading: this renderer has no visually-hidden utility class and adding one is
   unticketed scope. The screen has one named field and two named buttons, which is navigable; if a
   heading turns out to be wanted, it is a follow-up with the confirm frame.
4. **The single-line input will scroll horizontally** on a real payload (a base64url blob of several
   hundred characters against ~110 visible). That is the frame's intent, the operator pastes rather than
   reads, and the trailing clear control is exactly the escape hatch a non-scannable field needs — which
   is why the frame adds it. `<input type="text">` also strips CR/LF from a pasted value, which is
   harmless here since `parsePairingPayload` trims anyway.
5. **The `M3/Elevation Light/3` drop shadow on `103:2903` is not reproduced** — the same call
   `welcome.css:29-32` made for the same shadow on the same canvas: two black shadows at 0.15/0.30 alpha
   behind a near-black background are imperceptible, and reproducing them would mean inventing an
   elevation token family for no visual gain.
6. **Frame names lie; labels are authoritative.** The CTA frames are still named
   `Primary CTA — I already have pyrycode` / `Secondary CTA — Set up pyrycode first` (inherited from the
   welcome frame) while the labels drawn inside read `Pair` and `Cancel`. Same for `Hero container` /
   `Hero`, which here hold nothing but the text field.
7. **The reuse of welcome's design is token-level and visual, never code-level.** This codebase has zero
   shared cross-screen CSS — six per-screen stylesheets whose only shared input is `theme/tokens.css`
   (`index.css:1`). Do **not** import `welcome.css`, do **not** reach for `.welcome__*`, and do **not**
   extract a shared first-run page stylesheet (that is an unticketed architecture change touching #657's
   merged code, guessing an abstraction from one-and-a-half examples). If duplication across
   welcome / pairing / the eventual confirm frame becomes painful once all three exist, that is a
   follow-up with three consumers in hand.
8. **No new tokens.** Every value above resolves to a token already on `main` — re-verified in
   `tokens.css`: `--color-on-primary:26`, `--color-primary-container:25`, `--color-on-surface-variant:23`,
   `--space-7:106`, `--space-8:107`, `--space-16:108`, `--radius-xs:115`, `--radius-lg:118`, and the
   `--text-body-small-*` / `--text-body-large-*` / `--text-label-large-*` / `--text-label-small-*` scales.
   The only bare literals are structural geometry (`100%`, the 56/48/40/24/20px boxes, the 1px indicator,
   the 0.55 footer opacity, the 0.72 fill opacity, the 0.38 disabled opacity and the glow percentages) —
   the carve-out `pairing.css:1-9` and `welcome.css:1-14` already name. Extend the `pairing.css` header
   to cover the new ones; AC8 is that header's line staying true.

## Testing strategy

Renderer tests here are server-render only — `renderToStaticMarkup`, no jsdom, no Testing Library
(`PairingScreen.test.tsx:6-11`). Do not introduce a DOM harness; that is an architecture change this
ticket has no mandate for.

`npm test` (vitest) — `PairingScreen.test.tsx`, updating the four editing-phase tests and adding two:

- **editing, empty paste** — replaces the `Paste pairing code` and `<textarea` assertions at `:29`/`:31`.
  Assert: the supporting instruction (`pyry pair --print`), the marker `aria-label="Pairing code"`,
  `<input`, `Cancel`, `Pair`, and `disabled` (only Pair is disabled here). Assert the clear control is
  **absent** — AC3, and the reason the `:34` `disabled` proxy stays honest.
- **editing, non-empty paste** — keep `not.toContain('disabled')` verbatim; it now also covers the clear
  control never rendering disabled. Add: the clear control **is** present, and carries
  `aria-label="Clear pairing code"`.
- **editing with an error** — unchanged (`valid pairing code`). Add that the instruction copy is **not**
  present, pinning the mutual exclusion the supporting slot promises.
- **coerced infra failure** — unchanged assertions; update the `:51` comment, which says "the textarea".
- **new — the C1 uniqueness guard** — count occurrences of `aria-label="Pairing code"` in the editing
  markup and assert exactly **1**. This is the deterministic net under a stochastic contract: it is what
  catches a future wrapping-`<label>` or a duplicated attribute before six outside consumers go dark.
- **new — the C2 root-class guard** — assert the markup contains `class="pairing ` in the editing markup
  *and* in the reviewing markup, so `smoke.spec.ts`'s single binding has a unit-tier tripwire.
- **reviewing / paired / `PairingScreen` renders-without-throwing** — unchanged.

`pairingState.test.ts` needs **no change**. The clear control's whole behaviour is
`onPasteChange('')`, and the `paste-changed` arm is already covered at `:19`. Adding a second assertion
for the same arm with a different input would be test-for-test's-sake.

**Recorded coverage gap:** nothing executes the clear control's click. The server-render tier cannot
click, and adding an e2e for it would pull new files into a restyle ticket. The seam is one line
(`onClick={() => onPasteChange('')}`) and is visible in review. Named here so review reads it as a
decision rather than an oversight.

`npm run typecheck` and `npm run build` must both pass. `npm run e2e` is the behavioural proof that C1,
C2 and C3 survived — a skipped `real-*` run proves the import graph only, so it is not a substitute.

## Acceptance-check commands

Deterministic, so review need not eyeball:

```bash
grep -rn 'textarea\[aria-label="Pairing code"\]' src/ e2e/ scripts/   # must be 0 after AC9
grep -rn 'aria-label="Pairing code"' src/renderer/src/screens/pairing/  # must be exactly 1
npm test && npm run typecheck && npm run build && npm run e2e
```

## Scope

Four files, no new files, no new exports:

| File | Change |
|------|--------|
| `src/renderer/src/screens/pairing/PairingScreen.tsx` | `EntryCard` → `EntryPage` (markup only); phase-derived root className; local footer/instruction copy constants. `ReviewCard`, `PairingView`'s props, and the container are untouched. |
| `src/renderer/src/screens/pairing/pairing.css` | Split `.pairing` into base + `.pairing-card`; add `.pairing-page*` and `.pairing-field*`; extend the header. `.pairing__title/__instruction/__accent/__fingerprint*/__success/__actions/__button` all survive. `.pairing__paste*` and `.pairing__error` are retired with the `<textarea>` (nothing outside the paste phase uses them — verified). |
| `src/renderer/src/screens/pairing/PairingScreen.test.tsx` | Per § Testing strategy. |
| `scripts/live-drive.mjs:81` | `textarea[aria-label="Pairing code"]` → `[aria-label="Pairing code"]`. **One line.** The `finally` revoke and the no-echo rules from #480 are out of scope and must not be disturbed. |

One production `.tsx`, one stylesheet, one test, one script line — under the file red line. AC9 is not
separable: the selector breaks *because* of AC2's element swap, and a live-relay gate that only fails
when an operator ships is exactly the fix-plus-liveness-proof pairing that belongs in one ticket.

## Open questions

1. **The supporting-line instruction copy.** AC4 turns on a slot the Figma component already has
   (`I103:2904;52798:24384`), toggled on with an empty string in this instance, so the frame does not
   dictate the text. The copy specified is today's instruction paragraph, and mobile routes its pairing
   error through exactly this slot (`PasteCodeDialog.kt:40-45`). If the design intends something else in
   that slot, AC4 is the criterion to change — the structure here does not.
2. **The confirm/success card is left mismatched on purpose.** The flow will look inconsistent between the
   paste page and the fingerprint card until Juhana draws that frame. AC7 states this is expected and
   accepted. `.pairing-card` exists precisely so lifting it later is a class swap on the root plus the
   CTA classes, not a rewrite.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The pasted string crosses exactly one boundary and this ticket does
  not move it: renderer → `submitPairingPaste` over the typed IPC channel (#54), validated in the main
  process by `parsePairingPayload` (`src/main/pairingPayload.ts:101-135`) — a total, throw-free,
  strict-base64url-then-JSON-then-shape pipeline. Nothing in this spec parses, splits, inspects, or
  re-encodes the payload in the renderer; the value is carried opaquely from `<input value>` to that one
  call, exactly as today. The clear control writes a **constant** `''` and never reads `paste`.
- **[Tokens, secrets, credentials]** SHOULD FIX → already addressed in the design, flagged for
  code-review to verify. The field holds a bearer token, and swapping `<textarea>` → `<input>` moves it
  onto surfaces a textarea never attracted. Mitigations are specified above and are testable by grep:
  `type="text"` (never `password` — no manager save-prompt), `autoComplete="off"`, `spellCheck={false}`,
  no `name`, no `id`, no `<form>` ancestor. Note that Electron's spellchecker is local (hunspell), so
  `spellCheck={false}` is hygiene rather than a remote-exfiltration fix; the autofill/manager surface is
  the real one. Storage is unchanged: the paste lives in `useReducer` state only, and `pairingState.ts`
  never writes `localStorage`, `sessionStorage`, or disk. **Net improvement:** the clear control is the
  first affordance that lets an operator purge the token from renderer state without unmounting the
  screen.
- **[File / storage operations]** Not applicable — this ticket performs no filesystem, path, or
  persistence operation. `scripts/live-drive.mjs` writes a throwaway `--user-data-dir`; that code is
  untouched and its `finally` revoke is explicitly out of scope.
- **[Inter-process / Electron attack surface]** No findings. No IPC channel, `contextBridge` API,
  protocol handler, or `webPreferences` value is added or changed. The window keeps `sandbox: true` and
  `contextIsolation: true` (`src/main/index.ts:46-47`). Process placement is untouched: no key, socket,
  or handshake byte enters the renderer, and this is a markup/stylesheet change inside an existing pure
  view.
- **[Cryptographic primitives]** Not applicable — no randomness, hashing, comparison, or Noise surface is
  introduced. The only crypto-adjacent value on screen is the display `fingerprint` in `ReviewCard`,
  which this ticket does not touch.
- **[Network & I/O]** Not applicable — no socket, URL, timeout, or frame-size decision. The one live
  network consumer touched, `scripts/live-drive.mjs:81`, changes a Playwright locator string only; its
  relay and credential handling are untouched.
- **[Error messages, logs, telemetry]** No findings. `ERROR_COPY` stays a fixed `Record` with no
  interpolation, so no error path can render a value derived from the paste. The renderer's content-free
  diagnostic channel (`src/preload/index.ts:30-31`, #126/#131) is **not** called from this screen today
  and this spec adds no call — restated explicitly because a new interactive control is a natural place
  for a developer to add one. **The rule mobile carries verbatim applies: the pasted string and the
  token it carries must never reach a logger, a diagnostic record, or a console.** No test asserts on the
  paste value, so no failure diff can print it — matching the secret-hygiene contract
  `e2e/fixtures/pairingArrival.ts:21-28` already enforces for the same field.
- **[Concurrency]** No findings. No async task, subscription, timer, or listener is added. The one
  concurrency-adjacent question this ticket raises — the clear control firing while a submit is in
  flight — is closed by an existing invariant rather than a new guard: `pairingReducer`'s `paste-changed`
  arm returns `state` unchanged outside `editing` (`pairingState.ts:64-68`), so the click is a no-op and
  cannot mutate the paste captured before the `await` at `PairingScreen.tsx:182`. The check-then-act race
  that comment guards against is unaffected.
- **[Threat model alignment]** *Renderer compromise reaching the transport* — unchanged and still blocked
  by process isolation; the renderer never holds a key or a socket. *Token theft from disk* — not
  reachable from this ticket; the paste never touches disk, and persistence happens in main after
  confirm. *Malicious relay / hostile daemon response* — out of scope; no daemon-supplied value renders
  on the restyled surface (`fingerprint` is on the untouched card). *Autofill/manager exfiltration of a
  bearer token from a single-line input* — the new threat this ticket introduces, addressed under
  [Tokens] above.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-21
