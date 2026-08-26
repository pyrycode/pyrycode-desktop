# #796 — the status row above the composer, and its turning icon

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=111-3525

A 780×24 fixed-height row (`Status area` `111:3525`). At its left, the `Status` group `112:3530` is a flex
row — `gap: 8px`, `align-items: center` — holding a 14×15.97 vector followed by the label `Thinking...` in
M3 **body/small** (12px / 16px line / 0.4px tracking) coloured `schemes/primary`. The `Error` frame
`112:3529` at x=632 is #797 and renders nothing here.

**The vector is the pyrycode snowflake the repo already ships.** Verified numerically, not assumed: the
Figma path's coordinates are `WelcomeScreen.tsx`'s `PyrycodeMark` path divided by exactly 6.5
(`44.7516/6.5 = 6.8849` ≈ `6.88471`; `103.733/6.5 = 15.959` ≈ `15.9585`), and the viewports match at the
same ratio (`91.002/14 = 103.812/15.9707 = 6.5000`). Same glyph, one scale factor.

**Two things Figma's generated code must NOT contribute to this ticket** (both are security findings, see
§ Security review):

- Its 12 KB exported `<path d>`. Move the shipped one (§ Design, `PyryMark`); do not re-download the
  asset. The Figma asset URL is short-lived third-party content with no provenance guarantee, and the
  shipped path is the parity guarantee against the mobile drawable.
- Its `<img src="https://www.figma.com/api/mcp/asset/….svg">`. **Never** put a remote `<img>` in this
  renderer. The renderer's CSP declares no `img-src` (`index.html:6-9`) precisely so a privileged window
  makes no outbound asset fetches; an inline `<svg>` is DOM, not a fetch, which is why it is the house
  idiom (`WelcomeScreen.tsx:104-106`, `SettingsScreen.tsx:150`).

Two fidelity notes for code review, both deliberate:

- Figma's export wraps the vector in `-scale-y-100`. That is an export transform artifact; render the mark
  **unflipped**, the same orientation as the welcome hero, so the two read as one brand mark. On a glyph
  that spends its visible life rotating, the flip is unobservable anyway.
- Figma's `schemes/primary` fallback hex is `#32628d` — the *light* scheme. Desktop is dark-only
  (ADR 0003). Use the token name `--color-primary` (`#9dcbfc`), never the exported hex. That is the
  standing rule in `.status-row`'s own comment: trust the token names, not the export's fallbacks.

## Files to read first

Codegraph is wired for this repo but **not indexed** (`.codegraph/` holds only `.gitignore` +
`config.json`; every `codegraph_*` call returns *"CodeGraph not initialized"* — probed again 2026-08-27).
This list was built by grep + read; don't spend a turn re-probing.

| Path | What to extract |
|---|---|
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:212-281` | The container's render body. `<ThinkingIndicator>` at :246 is the mount that moves; the new row goes after `<BackgroundTaskTrigger>` (:273), directly above `<Composer>` (:280). |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:1080-1156` | `ThinkingIndicator` — its 54-line comment block, the `state === null` early return, the `bubbleClass` / `label` derivation. Only the returned markup changes; every derivation stays. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:1384-1400` | `isTurnRunning(phase)` — the exported running-turn predicate. Reuse it; do not re-derive the phase test. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:1581-1600` | `StatusSheet({ onClose, children })` — the `children`-slot precedent this row follows. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:1930-1960` | `ComposerSendButton`'s comment: *"takes `isRunning: boolean`, NOT `phase: TurnPhase`"*. The row takes the same shape for the same reason. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:1506-1544` | `StatusRow` — the **collision**. Read it once so you don't reuse its name or class. Unrelated to this row; untouched by this ticket. |
| `src/renderer/src/screens/welcome/WelcomeScreen.tsx:95-125` | `PyrycodeMark` — the path, the viewBox, and the provenance comment that must travel with them. Note the attribute order (`className` first). |
| `src/renderer/src/screens/welcome/WelcomeScreen.test.tsx:33` | `toContain('<svg class="welcome__mark"')` — a shipped assertion on **attribute order**. `PyryMark` must emit `className` first or this breaks. |
| `src/renderer/src/screens/conversation/conversation.css:723-741` | `.bubble__cursor` — the animation + `@media (prefers-reduced-motion: reduce)` guard. Copy this shape exactly. |
| `src/renderer/src/screens/conversation/conversation.css:743-787` | `.conversation__thinking`, `.bubble--thinking`, `.bubble--tool-label` — the three rules this ticket replaces, and the tool-name truncation reasoning that must survive the move. |
| `src/renderer/src/screens/conversation/conversation.css:1183-1198` | `.composer` — the horizontal padding (`--space-3`) the new row aligns to. |
| `src/renderer/src/screens/conversation/conversation.css:1279-1305` | `.status-row` — the **class collision**, plus the "trust token names, not the export's fallback hexes" rule. |
| `src/renderer/src/theme/tokens.css:24,84-87,100-108` | `--color-primary`, `--text-body-small-*`, `--space-1..8`. Every value this row needs already exists. |
| `e2e/fixtures/launchPairedApp.ts:143-235` | The fake-tier fixture. `page` is a real Playwright `Page` from `app.firstWindow()`; the fixture yields at "paired, connected, on the thread, idle". |
| `e2e/queued-backlog-interrupt.spec.ts:96,155-210` | The local `turnStateFrame(state)` helper and the `daemon.pushFrame(turnStateFrame('thinking'))` drive. Two specs each keep their own copy — write a third local copy, don't extract a shared helper. |
| `docs/knowledge/features/conversation-shell.md:78-79, 981-1030` | The shipped indicator-region tree and the working-indicator history. Line 1023 records that "the polished version rolls into the deferred desktop-design pass" — this ticket. **Read-only**; the documentation phase owns it. |

## Context

The desktop layout (board #7, Figma `102-4`) puts a fixed-height status area directly above the message
box. Today the working-indicator text renders as a *bubble* (`.bubble.bubble--daemon.bubble--thinking`) in
the loose region between the thread and the composer, appearing and disappearing — which moves the
composer under the operator's cursor. This ticket builds the row, moves the working-indicator text into
it, and adds the one genuinely new piece: an icon that turns while a turn is running.

**Scope boundary, restated from the ticket.** `ApiRetryIndicator`, `CompactingIndicator` and
`StallIndicator` keep their current mount sites, their bubble treatments, and their precedence rule. Only
the working-indicator text moves. The right-hand error slot stays empty — that is #797.

## Design

### 1. `PyryMark` — the shared brand mark

New file: **`src/renderer/src/theme/PyryMark.tsx`**.

The snowflake path currently lives inline in `WelcomeScreen.tsx`'s module-private `PyrycodeMark`. It is now
needed in two places, and the path is 12 KB — duplicating it is not an option. Move the component (path,
viewBox, and its provenance comment about the mobile drawable and the 2× Figma viewport trap) into a
shared module and parameterise the two things that differ.

```tsx
export function PyryMark(props: {
  className: string
  width: number
  height: number
}): JSX.Element
```

Renders one `<svg>` with attributes in **this exact order** — `className`, `viewBox`, `width`, `height`,
`fill="currentColor"`, `aria-hidden="true"` — wrapping a single `<path>`. The order is load-bearing:
`WelcomeScreen.test.tsx:33` asserts on the literal string `<svg class="welcome__mark"`.

`WelcomeScreen.tsx` deletes its local `PyrycodeMark` and renders
`<PyryMark className="welcome__mark" width={184} height={208} />`. Its markup is byte-identical, so its
tests pass unchanged. **This is the only edit to `WelcomeScreen.tsx`** — do not touch anything else there.

*Why `theme/`, which holds only `tokens.css` today:* the mark is a brand constant consumed by two
unrelated screens, alongside the design tokens. It is not app shell (the top-level `.tsx` files are
`App`/`PairedShell`) and it belongs to no screen. First `.tsx` in that directory, deliberately.

*No `preserveAspectRatio` override:* the default `xMidYMid meet` letterboxes rather than stretches, so
rendering the 0.8766 glyph at `width={14} height={16}` draws it at 14×15.97 centred in a 16px box — the
Figma geometry exactly, with zero distortion. Don't compute a fractional height.

### 2. `ComposerStatusArea` — the row

Lives in **`ConversationScreen.tsx`**, beside its sibling views. No new component file: every other view
on this screen (`Timeline`, `StatusRow`, `Composer`, `QueuedBacklog`, …) lives there, and a separate file
would need to import `ThinkingIndicator` back out of `ConversationScreen.tsx` — a circular import the
`children` slot exists to avoid anyway.

```tsx
export function ComposerStatusArea(props: {
  isRunning: boolean
  children?: ReactNode
}): JSX.Element
```

Always returns an element — never `null`. That is AC2: the row's height is unconditional, so the composer
does not move when the label appears and disappears.

Structure (three elements, no more):

- `.composer-status` — the row. Fixed height, `justify-content: space-between`.
  - `.composer-status__activity` — the left group: flex row, `gap: var(--space-2)`.
    - `<PyryMark className={…} width={14} height={16} />` where the class is
      `composer-status__icon` plus `composer-status__icon--spinning` **iff** `isRunning`.
    - `{children}` — the label slot.

`isRunning: boolean`, not `phase: TurnPhase` — the `ComposerSendButton` precedent (`:1935`): the view
structurally cannot receive the store enum, so `'idle'` is not representable inside the spinning branch.
The container computes `isTurnRunning(phase)`.

`children`, not a `label: string` prop — the `StatusSheet({ onClose, children })` precedent. It keeps the
row independent of where its text comes from, which is exactly what #797 needs when it appends the error
chip on the other side.

**No placeholder element in the right-hand slot.** The row's *height* is what must be reserved, and the
`height` declaration reserves it; the Figma error frame is itself 24 tall, so #797 appending a second
flex child grows nothing. An empty spacer div would be a defence for a failure mode nobody has observed.

The `--spinning` modifier is a **class**, not an inline style: rotation is a CSS animation, and AC3 requires
the running-vs-still distinction to be visible in the static markup a renderer spec asserts on. This is the
ticket's own technical note and it is not negotiable — nothing in this repo can read a resolved style.

### 3. `ThinkingIndicator` — markup only

Everything about this component stays except the element it returns. Unchanged: the name, the
`{ state, toolName }` props, the `state === null` early return, `THINKING_COPY` / `WORKING_COPY` /
`toolWorkingCopy`, the `WorkingIndicatorState` union, the label-choice ternary, the single-text-child rule,
and the `#493`/`#496` supersede posture. Do not reopen any of it.

The bubble wrapper goes away. It returns **one span**:

```tsx
// shape only — the label/ternary derivation is unchanged from :1146-1150
<span className={`conversation__thinking composer-status__label${tool ? ' composer-status__label--tool' : ''}`}>{label}</span>
```

**The daemon tool name reaches the DOM as a text child and nothing else.** No `title`, no `aria-label`, no
`data-*`, no attribute of any kind carrying `label` or `toolName` — CLAUDE.md is flat about this: daemon
text may be rendered escaped and length-bounded, but "never into an attribute or a URL". A `title` tooltip
is the specific temptation here, because `text-overflow: ellipsis` invites one; the shipped
`.bubble--tool-label` deliberately has none, and neither does this. Nor may the label be logged
(same rule: "never … a log") — see § Security review.

**`conversation__thinking` is retained deliberately.** It is not styling any more — it is the shipped
identity hook meaning *"the working indicator is showing"*, and two e2e specs use it as their turn-liveness
gate (`thread-scroll-pin.spec.ts:229,294` — `toHaveCount(0)` / `toBeVisible`; `queued-backlog-interrupt.spec.ts:160`).
Renaming it would churn two Electron-launch specs to no reader benefit. Identity class plus presentation
class on one element is ordinary BEM, not drift — say so in the comment so the next reader doesn't
"clean it up".

Update the component's comment block where it describes the bubble treatment and the "interim treatment for
the absent Figma node" (`:1122-1133`): that node now exists, and this is the pass that consumes it. Keep
the `#649` archaeology about the daemon tool string, which is still exactly true.

### 4. Container wiring

Delete the `<ThinkingIndicator>` mount at `:246-249`. After `<BackgroundTaskTrigger>` (`:273`) and before
`<Composer>` (`:280`), mount:

```tsx
<ComposerStatusArea isRunning={isTurnRunning(phase)}>
  <ThinkingIndicator
    state={workingIndicatorStateWithLocalSend({ phase, apiRetry, compacting }, localSendPending)}
    toolName={openToolName(items)}
  />
</ComposerStatusArea>
```

Both derivations move verbatim — no new subscription, no new store read, nothing new crosses IPC. The
two gates stay deliberately independent: `isRunning` is the raw phase reading, while the label is still
superseded by a live api-retry or compaction. So a turning icon beside no text is a **legal, expected**
render, and AC2 is what makes it look intentional.

### 5. CSS — `conversation.css`

Replace `.conversation__thinking`, `.bubble--thinking` and `.bubble--tool-label` with the
`.composer-status` block. All values come from existing tokens.

| Selector | Substance |
|---|---|
| `.composer-status` | `flex: 0 0 auto`; `height: 24px`; flex row, `align-items: center`, `justify-content: space-between`; horizontal padding `var(--space-3)` only — **no vertical padding**, so the height is exact under the repo's absent global `box-sizing` reset. |
| `.composer-status__activity` | flex row, `align-items: center`, `gap: var(--space-2)`; `color: var(--color-primary)`; **`flex: 1 1 auto; min-width: 0`** — see the bound below. |
| `.composer-status__icon` | `flex: 0 0 auto`; `display: block`. Colour arrives via `currentColor` from the group. |
| `.composer-status__icon--spinning` | `animation: composer-status-spin 1.6s linear infinite`. |
| `@keyframes composer-status-spin` | `to { transform: rotate(360deg) }`. |
| `.composer-status__label` | body-small: `font-size/line-height/letter-spacing/font-weight` from `--text-body-small-*`. Colour inherited. |
| `.composer-status__label--tool` | The unbounded-daemon-name bound, carried over from `.bubble--tool-label`: `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`. |
| `@media (prefers-reduced-motion: reduce)` | `.composer-status__icon--spinning { animation: none }` — `.bubble__cursor`'s shape verbatim. |

Two judgement calls, both stated so they aren't re-litigated in review:

- **`height: 24px` as a literal**, not `var(--space-6)` (which is also 24px). A component height is
  structural geometry, not spacing — the `.conn-dot` / `.run-config__context-bar` precedent. If you prefer
  the token, that is defensible; pick one and comment it.
- **`1.6s linear infinite`** is a client-owned constant. The Figma node is a static vector with no motion
  spec, so there is no token to port. Chosen to read as "working" rather than "loading spinner".

### 5a. The truncation bound — read this before writing the CSS

`.bubble--tool-label`'s comment (`:760-781`) says `nowrap` does the job and that **`min-width: 0` is not
load-bearing**, because "`.bubble` already sets `max-width: min(680px, 75%)`, so the cap holds with or
without this line" — and records the control measurement: *removing `.bubble`'s max-width blew out to
3089px against a 396-char name*.

**This move deletes `.bubble`.** The definite max main size that comment says was doing the work is gone,
so copying the comment across would ship reasoning that is no longer true, on a rule that may no longer
hold. The tool name is daemon-supplied and unbounded; an oversized one that blows the label out widens the
row past the window, overflows the conversation pane horizontally, and breaks AC2's "the composer does not
move" — triggered entirely by remote input. Do not carry that comment verbatim; rewrite it to match the
new chain.

The replacement bound is a chain, and **every link is required**:

1. `.composer-status` is a block-level flex item of the `.conversation` column (`align-items: stretch`),
   so it has a definite width. Do not give it `width: max-content` or float it.
2. `.composer-status__activity` — `flex: 1 1 auto; min-width: 0`. Without `min-width: 0`, the flex item's
   automatic content-based minimum floors at the label's full intrinsic width and the row grows.
3. `.composer-status__label--tool` — `min-width: 0; overflow: hidden; text-overflow: ellipsis;
   white-space: nowrap`. `nowrap` also collapses an embedded newline in a daemon name, so `\n` cannot
   break the line either.

This is `.status-row__summary`'s existing chain (`min-width: 0`, commented "lets it shrink/truncate once
that text lands"), not an invention. **Verify it, don't assume it:** render a long name and confirm the
row's width is unchanged. A renderer spec cannot measure layout, so the check is a manual measurement
during development plus the class-presence assertion in § Testing strategy; if you find the bound doesn't
hold, add an explicit `max-width` on the label rather than shipping a broken one.

## State + concurrency model

None added. No store slice, no effect, no subscription, no async work, no IPC. Both inputs are derived
synchronously from `thread` fields the container already destructures at `:181`
(`items`, `phase`, `apiRetry`, `compacting`, `localSendPending`).

Re-render: the row re-renders exactly when `ConversationScreen` does, which is exactly when it already
does. Rotation is CSS, so a running turn costs zero React renders — the class is set once at the phase
transition and the compositor owns the animation.

Teardown: the animation dies with the element. Nothing to cancel.

## Error handling

No new failure modes — no network, no parse, no permission surface.

The one untrusted input is the daemon-supplied tool name inside `toolWorkingCopy(name)`, and its posture
is unchanged: an auto-escaped React text child, never an attribute, never a URL, never a raw-markup sink,
bounded to one line by `.composer-status__label--tool`. The bound moves with the label; do not let it get
dropped in the move, or a long tool name wraps and grows the row — the exact regression AC2 exists to
prevent.

## Testing strategy

### Renderer specs — `ConversationScreen.test.tsx` (static server renders, no DOM, no clicks)

New `describe` for `ComposerStatusArea`, server-rendering injected props with no store:

- `isRunning: true` → markup contains `composer-status__icon--spinning`.
- `isRunning: false` → markup does **not** contain `composer-status__icon--spinning`, but **does** contain
  `composer-status__icon`. This is AC3's "still, but still rendered" half; assert both halves or the test
  passes on a missing icon.
- With a child → the child's markup appears inside `composer-status__activity`.
- With no child → markup still contains `composer-status`. This is AC2 at the markup level.

Edits to the existing `ThinkingIndicator` describe (`:1049-1130`) — label text, escaping, and `null`
assertions all stand verbatim; only class strings move:

- `:1059, 1071, 1095` — `bubble--thinking` → `composer-status__label`.
- `:1103, 1110, 1113` — `bubble--tool-label` → `composer-status__label--tool`.
- `:1058, 1070, 1094` — `conversation__thinking` unchanged (that is the point of retaining it).

**Three vacuity repoints — do not skip these.** `:1191`, `:1220`, `:1263` assert
`not.toContain('bubble--thinking')` on the stall / api-retry / compacting renders, i.e. *"this problem
state is visually distinct from the working indicator"*. Once `bubble--thinking` exists nowhere, all three
pass against a string no component can emit — they stop testing anything, silently. Repoint each to
`not.toContain('composer-status__label')`. This is the same hazard `.bubble--tool-label`'s naming comment
(`:779-781`) was written to avoid.

Container render (`:2495-2510` neighbourhood): the idle screen contains `composer-status` and does **not**
contain `composer-status__icon--spinning`. `:2505`'s `not.toContain('conversation__thinking')` stands
unchanged.

`WelcomeScreen.test.tsx` needs no edits — verify that, don't assume it.

### Playwright fake tier — new `e2e/composer-status-reduced-motion.spec.ts`

AC4 only. A renderer spec is a static server render and structurally cannot observe a media query; this is
the repo's first reduced-motion coverage anywhere. One spec, its own setup, no fixture change and no new
dependency — Playwright emulates reduced motion natively.

Uses `launchPairedApp()` and a **local** `turnStateFrame` helper (a third local copy — that is the shipped
convention; both existing specs keep their own).

Scenario, in order:

1. Launch. The fixture yields at the connected thread, idle.
2. `page.emulateMedia({ reducedMotion: 'reduce' })`, then **self-verify** the emulation took effect:
   evaluate `matchMedia('(prefers-reduced-motion: reduce)').matches` in the page and assert `true`.
   Without this gate, an emulation that silently no-ops on Electron makes every assertion below pass
   against a page that never entered reduced motion — the repo's own all-skip trap
   (`CLAUDE.md`: *"read the skip reasons, never the exit code"*), reproduced in a new place.
3. Idle arm: the icon locator exists, and its computed `animationName` is `'none'`.
4. Push `turn_state{thinking}`; wait for `composer-status__icon--spinning` to be attached; assert computed
   `animationName` is still `'none'`. This is AC4's "in either state".
5. Control arm: `page.emulateMedia({ reducedMotion: 'no-preference' })`; assert computed `animationName`
   is **not** `'none'` while the spinning class is present. Without this arm the spec cannot fail — it
   would pass on a stylesheet that never declared an animation at all.

Read computed style via `locator.evaluate((el) => getComputedStyle(el).animationName)`. `animationName` is
a discrete string, so there is no timing dependence and no flake surface — never assert on a frame or a
screenshot.

### Gates

`npm run typecheck`, `npm test`, `npm run build`, `npm run e2e`. The e2e tier is not optional here: AC4 is
only observable there, and it is also where the `PyryMark` extraction and the retained
`conversation__thinking` locator get their regression proof.

## Scope check

Recorded so review can verify the sizing rather than trust it.

| Red line | Limit | This spec |
|---|---|---|
| New files | ≤ 3 | **2** — `theme/PyryMark.tsx`, `e2e/composer-status-reduced-motion.spec.ts` |
| Production `.ts`/`.tsx` new-or-modified | < 5 | **3** — `PyryMark.tsx` (new), `ConversationScreen.tsx`, `WelcomeScreen.tsx` |
| New exported symbols | ≤ 5 | **2** — `PyryMark`, `ComposerStatusArea` |
| Total written lines | ≤ ~600 | **~500 projected** (incl. this repo's comment density, both test surfaces, and the e2e spec) |
| Consumer call sites | ≤ 10 | **1** — `ThinkingIndicator`'s single mount site. No signature changes, no type renames, no import flips. The 12 class-string edits are assertions on one component's output in one file, plus 2 `className` expressions; the e2e locator is retained precisely so that count stays at zero there. |
| Acceptance criteria | ≤ 5 | **4** |
| Reject branches | < 10 | **0** |

## Open questions

1. **Does `page.emulateMedia` reach an Electron window?** It should — `app.firstWindow()` returns an
   ordinary Playwright `Page`, and `emulateMedia` is implemented over CDP `Emulation.setEmulatedMedia`,
   which Electron's Chromium supports. Step 2's self-verify gate is what makes this safe to assume: if it
   is inert, the spec **fails loudly at that assertion** rather than passing vacuously. If it does fail
   there, the fallback is Chromium's `--force-prefers-reduced-motion` switch, which needs one extra entry
   in the fixture's `electron.launch({ args })` — a small, additive fixture change. Take the fallback only
   after the gate actually fails; do not pre-build it.
2. **Spin duration** (`1.6s`) has no Figma motion token. Client-owned; change it if it reads wrong on
   screen, and comment whichever value ships.
3. **`role="status"` on the label** is a shipped NIT (`docs/knowledge/features/conversation-shell.md:1050`):
   a screen reader does not announce the working indicator. Out of scope — no AC covers it, and a live
   region beside a rotating icon is its own a11y decision. Leave the NIT standing; do not fix it here.
4. **Vertical rhythm against the composer.** `var(--space-3)` horizontal padding aligns the icon with the
   composer's left edge, which is the load-bearing alignment. Whether the row needs a top border or
   separation from `BackgroundTaskTrigger` above it is a question for #797's slice, once the right-hand
   half exists — do not invent chrome here.

## Security review

**Verdict:** PASS (first pass FAILED on three MUST FIX findings, all now addressed in the spec above;
checklist re-walked from the top against the revised text)

**Findings:**

- **[Trust boundaries]** MUST FIX *(fixed)* — one untrusted datum crosses into this design: the
  daemon-supplied tool name, via `openToolName(items)` → `toolWorkingCopy(name)`. The boundary itself is
  upstream and unchanged, but the spec originally described the new `<span>` without restating the sink
  rules, at the exact moment it asks a developer to re-implement that element. `text-overflow: ellipsis`
  specifically invites a `title` tooltip, which would put an unbounded daemon string into an HTML
  attribute — banned by CLAUDE.md ("never into an attribute or a URL"). § Design now states: text child
  only; no `title`, `aria-label`, `data-*`, or any attribute; no log. The shipped `.bubble--tool-label`
  already has no `title`, so this preserves behaviour rather than tightening it.
- **[Network & I/O / Threat model — hostile daemon]** MUST FIX *(fixed)* — the shipped truncation bound
  rests on `.bubble`'s `max-width: min(680px, 75%)`, and `conversation.css:772-777` records the control
  measurement proving it: *removing that max-width blew out to 3089px against a 396-char name*, with
  `min-width: 0` present. This ticket deletes `.bubble` from the label's ancestry. Unaddressed, a hostile
  or buggy daemon sending an oversized tool name widens the row past the window, overflows the
  conversation pane horizontally, and breaks AC2 — remotely triggered, no exploit needed. § Design 5a now
  specifies the full replacement chain (definite row width → `flex: 1 1 auto; min-width: 0` on the group →
  `min-width: 0` + `overflow`/`ellipsis`/`nowrap` on the label), explicitly forbids copying the now-false
  comment across, and requires the bound be measured rather than assumed.
- **[Electron attack surface — remote content in a privileged renderer]** MUST FIX *(fixed)* — Figma's
  generated code for this node is `<img src="https://www.figma.com/api/mcp/asset/….svg">`. A developer
  implementing from the design context literally would add an outbound asset fetch from a third-party
  host into the renderer that holds IPC access to the transport. The CSP declares no `img-src`
  (`index.html:6-9`) so it would fail closed rather than execute, but shipping it is still a
  privileged-renderer remote-content bug and would silently render no icon. § Design source now bans both
  the remote `<img>` and re-downloading the asset, and points at the inline-`<svg>` house idiom with its
  CSP rationale.
- **[Errors, logs, telemetry]** SHOULD FIX — the label is the one place a daemon string is in easy reach
  of a `console.log` while a developer debugs the truncation bound. The no-log half of CLAUDE.md's rule is
  now stated in § Design. Separately, the new Playwright spec must assert on class names and computed
  `animationName` only — never dump `page.content()` or a screenshot into a failure diagnostic, per the
  fixture's standing discipline (`launchPairedApp.ts:39-43`). Code review should check both.
- **[Tokens, secrets, credentials]** No findings — this ticket adds no credential, no token path, and no
  storage. The e2e spec reuses `launchPairedApp`, whose synthetic `DUMMY_TOKEN` and throwaway
  `--user-data-dir` are unchanged.
- **[File / storage operations]** No findings — the design reads no path, writes no file, and touches no
  web storage. The row is stateless: both inputs are derived per-render from store slices the container
  already holds.
- **[Inter-process / Electron]** No findings beyond the remote-content one above — no `contextBridge`
  addition, no `ipcMain` channel, no `webPreferences` change, no custom protocol, no navigation or
  `window.open` surface. Nothing new crosses IPC (§ State + concurrency model); the transport is untouched
  and no secret moves renderer-ward.
- **[Cryptographic primitives]** Not applicable — no RNG, hashing, key handling, comparison, or Noise
  surface. The spin duration is a literal constant, not a seeded value.
- **[Concurrency]** Not applicable — no async task, timer, listener, subscription, effect, or shared-state
  mutation is added. The CSS animation is compositor-owned and dies with the element, so there is nothing
  to cancel on teardown and no work that can outlive the window.
- **[Threat model alignment]** *Hostile daemon response* is the one applicable desktop threat and is the
  second finding above. *Malicious relay* is content-blind and on-path — it cannot reach the tool name,
  which travels inside the Noise session. *Token theft from disk* and *renderer compromise reaching the
  transport* are unaffected: this ticket adds no storage and no bridge surface.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-27
