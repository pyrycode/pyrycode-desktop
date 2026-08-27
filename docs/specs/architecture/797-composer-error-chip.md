# #797 — the error chip in the composer status row

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=111-3525

The `Error` frame `112:3529` is a rounded pill at the right of the 780-wide status area: `px-[8px]
py-[4px]`, `border-radius: 6px`, a filled `Schemes/Error Container` background carrying one line of M3
**body/small** (12px / 16px line / 0.4px tracking) in `Schemes/Error`, `white-space: nowrap`, reading
`Host connection down!`. 8px inset around a 16px line is exactly the 24px the row already reserves, and
132px of text plus two 8px insets is the frame's 148px — so the chip is content-sized, not fixed-width.

**Use the resolved dark values, never the export's fallback hexes.** `get_design_context` emits
`#ffdad6` / `#ba1a1a`, which are the **light** scheme; desktop is dark-only (ADR 0003).
`get_variable_defs` on the same node resolves the real ones, inlined here so nobody has to re-fetch:

| Figma variable | Resolved (dark) | Repo token |
|---|---|---|
| `Schemes/Error` (text) | `#ffb4ab` | `--color-error` — **already exists**, `tokens.css:40` |
| `Schemes/Error Container` (fill) | `#93000a` | `--color-error-container` — **new**, this ticket adds it |

This is the same trap `.status-row`'s comment and #796's spec both record (`#32628d` was the light
primary). Trust the variable names and the resolved values; never the generated fallback.

Two things Figma's generated code must not contribute: its Tailwind classes (this repo has no Tailwind),
and any remote asset URL (the renderer's CSP declares no `img-src`, `index.html:6-9`). This node has no
image, so the second is a non-issue here — noted only so the rule stays visible.

## Files to read first

Codegraph is wired for this repo but **not indexed** — `codegraph_status` returns *"CodeGraph not
initialized"*, probed again 2026-08-27, third consistent probe. This list was built by grep + read; don't
spend a turn re-probing.

| Path | What to extract |
|---|---|
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:1184-1234` | `ComposerStatusArea` — the row this ticket extends. Its 26-line comment already names #797 and reserves the right-hand slot; read what it promises before changing the signature. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:2250-2279` | `ConnectionBanner` + `ConnectionBannerControl` — **the exact pattern to copy**: a pure `({ status })` view returning `null` off-arm, plus a thin store-bound container reading only `selectStatus`. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:262-287` | The container mount site. The `trailing` prop is added to the `<ComposerStatusArea>` element at :282. |
| `src/renderer/src/screens/conversation/composerSend.ts:143-166` | `composerAvailability` — the terse `'Connection error'` hint and its docstring on deliberately not surfacing `status.error.message`. The chip's copy must stay lexically distinct from all three hints. |
| `src/renderer/src/screens/conversation/composerSend.ts:190-224` | `CONNECTION_BANNER_COPY` + `shouldShowBanner` — the client-owned-constant docstring this ticket's constants mirror (apostrophe-free, zero daemon substring, lexically distinct). |
| `src/renderer/src/store/sessionStore.ts:15-32` | `ConnectionStatus`'s four arms and `ConnectionError { code, message, retryable }`. The chip reads the discriminant and nothing else. |
| `src/renderer/src/screens/conversation/conversation.css:744-865` | The whole `.composer-status` block: the fixed `height: 24px`, the `space-between` row, `__activity`'s `flex: 1 1 auto; min-width: 0`, and the three-link truncation chain the chip must not break. Note the recorded absence of a global `box-sizing` reset. |
| `src/renderer/src/theme/tokens.css:15-46, 114-119` | The colour block (where `--color-error-container` lands, beside `--color-error`) and `--radius-xs: 6px` — the Figma's 6px, already a token. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1161-1200` | The `ComposerStatusArea` describe, including the `markup.indexOf(...)` ordering idiom (:1195-1196) this ticket reuses to prove the chip is a **sibling of**, not a child of, the activity group. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1877-1930` | The `ConnectionBanner` describe — the four-arm matrix and the `DAEMON_SECRET_DETAIL` sentinel test at :1914. AC2's test is that test with a second sentinel added for `code`. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:2535-2595` | The container `describe`'s `beforeEach`, which `sessionStore.setState`s a clean `disconnected` session — the seam that makes the chip's **error** branch server-render-reachable in the container too (unlike `RepairControl`). |
| `docs/specs/architecture/796-composer-status-area.md` | The row's own spec. §5a (the truncation chain) and the "no placeholder in the right slot" ruling are the two constraints this ticket inherits. |
| `docs/knowledge/features/conversation-shell.md` | The shipped indicator-region tree, for orientation. **Read-only** — the documentation phase owns it. |

## Context

`.composer-status` (#796) is a 24px row above the message box with `justify-content: space-between`. Its
left half is built — turning mark plus working-indicator label. Its right half was left deliberately
empty for this ticket. This fills it with the connection-error chip.

Nothing new crosses IPC and no store gains a slice: `sessionStore`'s `ConnectionStatus` already carries
the `error` arm, and two other views already read it (`composerAvailability`'s terse hint,
`ConnectionBanner`'s prominent band). This is a third, narrower read of the same fact.

**The copy decision is already made in the ticket body and is not reopened here: the chip carries a
client-owned constant, and no part of `ConnectionError` reaches it.** The design carries that
independently — the mock's text node is a single 132×16 line, which a relayed `ErrorPayload.message`
would not fit. The spec's job is to make it *structural* rather than conventional: the view reads
`status.type` and never destructures `status.error`, so there is nothing to escape, length-bound, or
strip newlines from.

## Design

### 1. Copy constants — `composerSend.ts`

Two new module-level exported constants, placed beside `CONNECTION_BANNER_COPY` (`:206`).

```ts
export const COMPOSER_ERROR_CHIP_COPY = 'Host connection down!'
export const COMPOSER_ERROR_CHIP_PREFIX_COPY = 'Error: '
```

*Why `composerSend.ts` and not a module-level constant in `ConversationScreen.tsx`* (where
`THINKING_COPY` / `STALL_COPY` / `EMPTY_THREAD_COPY` live): every string that speaks about
`ConnectionStatus` already lives here, and `CONNECTION_BANNER_COPY`'s docstring reasons explicitly about
being lexically distinct from the three `composerAvailability` hints. The chip inherits that same
constraint, and keeping all four connection strings in one module is what makes that comparison
reviewable in one place. It is the third string about this fact; the odd one out would be the one that
moved.

Both carry `CONNECTION_BANNER_COPY`'s three-part contract in their docstring — (a) a client-owned
constant, (b) lexically distinct from the banner copy and the three composer hints, (c) zero
daemon-supplied substring — plus the apostrophe-free rule (`renderToStaticMarkup` escapes `'` →
`&#x27;`, so a `toContain` on the constant only matches verbatim without one). `Host connection down!`
satisfies (b): it shares no leading word with `Cannot reach pyrybox…`, `Connecting…`, `Not connected` or
`Connection error`.

`COMPOSER_ERROR_CHIP_PREFIX_COPY`'s **trailing space is load-bearing** — it is what separates the two
runs when a screen reader concatenates them into `Error: Host connection down!`. Comment it, or an
editor's trim silently degrades the announcement.

**No fourth predicate.** Do *not* add a `shouldShowErrorChip(status)` beside `shouldShowBanner`.
`shouldShowBanner` earned its place because "show unless connected" is a policy choice spanning three
arms; here the gate is literally the discriminant of the one arm the chip belongs to, so a named
predicate would add an export and a test file's worth of matrix to restate `status.type === 'error'`.
The view tests the arm inline. Stated here so review does not ask for the symmetry.

### 2. `ComposerErrorChip` — the pure view

New exported view in `ConversationScreen.tsx`, beside `ConnectionBanner` (`:2261`).

```tsx
export function ComposerErrorChip({ status }: { status: ConnectionStatus }): JSX.Element | null
```

Returns `null` unless `status.type === 'error'` (AC1). Otherwise one element:

- `<div className="composer-status__error">`
  - `<span className="composer-status__error-prefix">{COMPOSER_ERROR_CHIP_PREFIX_COPY}</span>` —
    visually hidden, present for AT only (AC4).
  - `{COMPOSER_ERROR_CHIP_COPY}` — the visible text, a direct text child.

**Four constraints on this component, all load-bearing:**

1. **It never destructures `status.error`.** The whole of AC2 is that structural fact. `status` is
   narrowed by its discriminant and then discarded; not `message`, not `code`, not as text, not in an
   attribute, not in a `title`, and not into a `console.*` while debugging. This is the
   `CONNECTION_BANNER_COPY` guarantee restated one component over.
2. **`<div>`, not `<p>`.** The banner uses `<p>` because it is a paragraph in a band. This chip lives in
   a row with a hard `height: 24px` and this repo ships no global reset, so a `<p>`'s UA margin would be
   a live layout hazard against AC3 for no semantic gain.
3. **No live region — no `role="status"`, no `role="alert"`, no `aria-live`.** This is the
   `ConnectionStatusIndicator` ruling (`:2347-2350`), quotable verbatim: *"a STATIC labelled group, not
   a live region — the banner (#279) already politely announces disconnects, so a second live region
   here would double-announce."* `shouldShowBanner` is true on the `error` arm, so a `connected → error`
   transition mounts the banner and this chip in the same commit; two polite regions would queue two
   announcements of one fact.
4. **The a11y marking is hidden text, not `aria-label`.** `aria-label` on a bare `<span>` or `<div>` is
   **prohibited by ARIA 1.2** — those elements map to `role="generic"`, which is in the name-prohibited
   list, and browsers drop the name. It would look right in the markup, assert green in a
   `toContain`, and do nothing for a real screen reader. A real text node cannot be dropped. Write this
   reasoning into the component comment or a future reviewer will "simplify" it back.

### 3. `ComposerErrorChipControl` — the store-bound container

Module-private, beside `ConnectionBannerControl` (`:2276`).

```tsx
function ComposerErrorChipControl(): JSX.Element | null
```

`useSessionStore(selectStatus)` → `<ComposerErrorChip status={status} />`. Byte-for-byte the
`ConnectionBannerControl` shape.

*Why a control rather than reading `selectStatus` in `ConversationScreen` and passing it down:* the
narrow-slice subscription is the point. `ConversationScreen` does not currently subscribe to
`sessionStore` at all; adding one there would re-render the entire screen — timeline included — on every
connection-status change. `RepairControl` and `ConnectionBannerControl` both exist for exactly this
reason. No new store wiring, no `window.pyry` dereference, no effects.

### 4. `ComposerStatusArea` — one new optional slot

Additive prop, no signature break:

```tsx
export function ComposerStatusArea({ isRunning, children, trailing }: {
  isRunning: boolean
  children?: ReactNode
  trailing?: ReactNode
}): JSX.Element
```

`{trailing}` renders as the **second direct child of `.composer-status`**, after
`.composer-status__activity` closes — not inside it (`children` is the activity group's slot; `trailing`
is the row's).

**Render `{trailing}` bare. Do not wrap it in a `.composer-status__trailing` div.** AC1 is explicit:
*"In every other arm nothing is rendered in that slot — not an empty element."* A wrapper would emit an
empty `<div>` in all three non-error arms. Rendered bare, a `null` trailing contributes nothing to the
markup, which is both what AC1 asks for and what makes it assertable.

`trailing`, not `error`: the row stays a layout primitive that knows a slot's position and nothing about
its occupant — the same reason #796 chose `children` over `label: string`. Extend that component's
comment block with one paragraph saying the reserved slot is now filled and by what.

### 5. Container wiring

At `:282`, one prop on the existing element — nothing else on that mount changes:

```tsx
<ComposerStatusArea isRunning={isTurnRunning(phase)} trailing={<ComposerErrorChipControl />}>
```

The two existing derivations and the `<ThinkingIndicator>` child stay verbatim.

### 6. CSS — `conversation.css`, after `.composer-status__label--tool` (`:865`)

| Selector | Substance |
|---|---|
| `.composer-status__error` | `flex: 0 0 auto`; `position: relative`; `padding: var(--space-1) var(--space-2)` (4px / 8px); `border-radius: var(--radius-xs)` (6px); `background: var(--color-error-container)`; `color: var(--color-error)`; the four `--text-body-small-*` values; `white-space: nowrap`. **No `height` declaration.** |
| `.composer-status__error-prefix` | The visually-hidden recipe: `position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0`. |

Six judgement calls, stated so review does not re-litigate them:

- **No `height: 24px` on the chip.** This repo has no global `box-sizing: border-box` reset — #796's own
  comment records that, and it is why `.composer-status` carries zero vertical padding. Under
  `content-box`, `height: 24px` *plus* `padding: 4px 0` would render a 32px chip inside a 24px row. The
  chip's height must come from `line-height: 16px` + `4px` × 2 = exactly 24, which is the Figma's own
  construction (`py-[4px]` around a 16px line). Set the padding; let the height fall out.
- **`flex: 0 0 auto` is required, not decorative.** `.composer-status__activity` is `flex: 1 1 auto;
  min-width: 0`; without `0 0 auto` here the chip would be a shrink candidate too, and a long daemon
  tool name in the label would squeeze the chip's text instead of ellipsizing the label — inverting
  #796's truncation chain. With it, the chain still terminates in the label: the activity group simply
  gets ~148px less room and ellipsizes sooner. **This is the one interaction between the two halves;
  verify it by rendering a long tool name with the chip up.**
- **`white-space: nowrap` is required, not decorative.** `.composer-status` sets a hard `height`, so a
  wrapped chip would overflow the row rather than grow it — visible breakage, not a silent one. `nowrap`
  is also what the Figma node declares.
- **`position: relative` on the chip** is the containing block for the absolutely-positioned prefix, so
  the hidden text cannot escape to some ancestor's coordinate space. It is one declaration and it is the
  standard pairing for this recipe.
- **The prefix is a BEM element of the chip, not a new global `visually-hidden` utility.** This repo has
  no utility layer and exactly one consumer exists. Inventing a shared class for a single use is
  speculative surface; promote it if and when a second consumer lands.
- **`clip-path: inset(50%)`, not the legacy `clip: rect(...)`.** The renderer is one known Chromium; the
  deprecated property buys nothing here.

### 7. New token — `tokens.css`

```css
--color-error-container: #93000a; /* M3 default (dark) Schemes/Error Container */
```

Placed directly after `--color-error` (`:40`). Sourced from `get_variable_defs` on node `112:3529`, not
from the export's `#ffdad6` light fallback. Comment it the way `--color-error` is commented, and name
the node so the provenance survives.

## State + concurrency model

None added. No store slice, no action, no effect, no subscription beyond the one narrow
`useSessionStore(selectStatus)` read that `ConnectionBannerControl` already performs on the same slice,
no async work, no timer, no listener, nothing across IPC.

Re-render: `ComposerErrorChipControl` re-renders exactly on a `ConnectionStatus` change (zustand's
`Object.is` short-circuit on the selected slice) and never on a timeline delta. `ComposerStatusArea`
re-renders with `ConversationScreen` as it already does; `trailing` holds an element, so the control's
own subscription drives its subtree independently.

Teardown: nothing to cancel. The chip is a pure function of one discriminant.

## Error handling

No new failure modes: no network call, no parse, no permission surface, no I/O. The component's entire
input is a four-arm discriminated union that the type system makes total.

The one untrusted datum *in reach* is `ConnectionError`, which the design deliberately does not touch —
see § Security review. There is no rendering path for it, so there is no escaping, length-bounding or
newline-stripping to specify: the guarantee is that the string never enters the component.

## Testing strategy

Renderer specs are static server renders (`environment: 'node'`, `renderToStaticMarkup`, no DOM, no
clicks). All four ACs are markup-assertable except AC3's layout half, addressed below.

### `ConversationScreen.test.tsx` — new `ComposerErrorChip` describe

Modelled on the `ConnectionBanner` describe (`:1877`), server-rendering the pure view with an injected
`status` and no store:

- `{ type: 'error', error: {...} }` → markup contains `composer-status__error` and
  `COMPOSER_ERROR_CHIP_COPY`. (AC1 present)
- `{ type: 'disconnected' }` → `expect(markup).toBe('')`. (AC1 absent — the strict form, which also
  proves "not an empty element")
- `{ type: 'connecting' }` → `toBe('')`.
- `{ type: 'connected', ack }` → `toBe('')`.
- **The two-sentinel test (AC2).** Render the `error` arm with `message: 'DAEMON_SECRET_DETAIL'` **and**
  `code: 'DAEMON_SECRET_CODE'`; assert the markup contains the copy and `not.toContain` either sentinel.
  Two sentinels, not one — the AC names both fields, and `ConnectionBanner`'s shipped test only ever
  needed one because its `code` was already `'x'`.
- **AC4.** The markup contains `composer-status__error-prefix` and `COMPOSER_ERROR_CHIP_PREFIX_COPY`,
  and the prefix's text precedes the visible copy (`indexOf` ordering — the concatenated announcement is
  the point).

### `ConversationScreen.test.tsx` — additions to the `ComposerStatusArea` describe (`:1161`)

- With `trailing` → the chip's markup appears **after** `.composer-status__activity` closes, i.e. as the
  row's sibling child. Use the `markup.indexOf(...)` ordering idiom already at `:1195-1196`; a
  `toContain('</div><div class="composer-status__error"')` is the tighter form if the developer prefers
  the `welcome__mark` attribute-order precedent. Either way the invariant to pin is *sibling, not
  descendant of the activity group*.
- Without `trailing` → markup still contains `class="composer-status"`, and `not.toContain`
  `composer-status__error`. (AC1 + AC3's markup half: the row exists at full identity with the slot
  empty.)

### `ConversationScreen.test.tsx` — container block (`:2535`)

That block's `beforeEach` already `setState`s the session store, so **both** branches are reachable here
— unlike `RepairControl`, whose visible branch is not:

- Default (`disconnected`, from `beforeEach`) → the full-screen markup contains `class="composer-status"`
  and `not.toContain('composer-status__error')`.
- `sessionStore.setState({ status: { type: 'error', error: { code: 'c', message: 'm', retryable: false } } })`
  then render → markup contains `composer-status__error` and the copy. This is the **only** test that
  proves the `trailing` wiring at `:282` actually reached the row; without it, an unwired prop passes
  every other assertion above.

### `composerSend.test.ts`

- The two constants are non-empty, apostrophe-free, and pairwise distinct from `CONNECTION_BANNER_COPY`
  and the three `composerAvailability` hints. Mirrors whatever shape that file already uses for
  `CONNECTION_BANNER_COPY`; if it has no such test, one assertion on the apostrophe-free rule is enough
  — it is the rule most likely to be broken by a copy tweak, and it breaks a `toContain` silently.
- The prefix constant ends in a space (the load-bearing separator).

### Not automated

- **AC3's layout half** ("does not move the composer") is structurally guaranteed by
  `.composer-status`'s shipped `height: 24px`, which #796 already tests and which this ticket does not
  touch. No new e2e spec: a Playwright tier for a fact a fixed `height` declaration already enforces
  would be a defence for a failure mode nobody has observed.
- **The chip × long-tool-name interaction** (§6, second bullet) is a real layout question a static
  render cannot answer. Verify it once during development in the running app — a long daemon tool name
  with the chip up must ellipsize the label and leave both the chip and the row width intact. If the
  chain does not hold, add an explicit `max-width` on the label rather than shipping a broken bound; do
  not pre-build that.

### Gates

`npm run typecheck`, `npm test`, `npm run build`. `npm run e2e` should stay green (no locator this
ticket touches is used there) but gains no new spec.

## Scope check

| Red line | Limit | This spec |
|---|---|---|
| New files | ≤ 3 | **0** |
| Production `.ts`/`.tsx` new-or-modified | < 5 | **2** — `composerSend.ts`, `ConversationScreen.tsx` |
| New exported symbols | ≤ 5 | **3** — `COMPOSER_ERROR_CHIP_COPY`, `COMPOSER_ERROR_CHIP_PREFIX_COPY`, `ComposerErrorChip` (`ComposerErrorChipControl` is module-private; `trailing` is an added optional prop, not a new symbol) |
| Total written lines | ≤ ~600 | **~330 projected**, at this repo's comment density: ~60 production, ~40 CSS + token, ~120 tests, ~110 comments |
| Consumer call sites | ≤ 10 | **1** — `ComposerStatusArea`'s single mount. The new prop is optional, so no existing call site or test breaks. |
| Acceptance criteria | ≤ 5 | **4** |
| Reject branches | < 10 | **0** |

Size **S**, unchanged from PO's label. Not overridden down to XS: a new design token, a new prop on a
shipped component, a pure view plus its container, and four test surfaces is more than an XS.

## Open questions

1. **Copy wording.** `Host connection down!` is the mock's string and a client-owned constant, so
   PO/design may tune it. The load-bearing contract is the three-part one in §1, not the exact words.
   The exclamation mark is the mock's; keep it unless design says otherwise.
2. **The hidden prefix's wording.** `Error: ` is the minimal marking that satisfies AC4. If a future
   ticket adds a second chip to this slot, that prefix is the natural place to differentiate them —
   a reason to keep it a named constant rather than an inline string.
3. **Chip and banner both visible in the `error` arm** is expected, not a bug: the banner is the
   prominent top-of-thread band, the chip is the at-a-glance marker beside the composer. §2's finding 3
   is what keeps that from being announced twice. If it reads as redundant on screen, that is a design
   question for a later slice, not a spec change here.
4. **`--color-error-container` has one consumer.** That is fine and matches how several tokens landed
   (`tokens.css:7-11` says so outright). No other slot in the desktop design uses an error container
   yet; the next one should reuse this token rather than re-derive `#93000a`.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings — and this is the ticket's central design decision rather than an
  incidental one. Exactly one untrusted datum is in reach: `ConnectionError { code, message }`
  (`sessionStore.ts:28-32`), whose fields are copied straight off the wire `ErrorPayload`. The design
  places the boundary at the *discriminant*: `ComposerErrorChip` narrows on `status.type` and never
  destructures `status.error` (§2, constraint 1). That makes AC2 structural — there is no rendering path
  for the string, so no escaping, length bound, or newline strip is needed, and none can be forgotten.
  The chip renders two module-level constants and nothing derived from its prop. This is deliberately
  the `CONNECTION_BANNER_COPY` guarantee one component over, and it is proven by the two-sentinel test
  in § Testing strategy rather than asserted by convention.
- **[Trust boundaries — the attribute sink]** No findings, but named because it is the near miss. AC2
  bans `ConnectionError` from *attributes*, not just text, and this component ships an attribute-shaped
  a11y affordance. The rejected `aria-label` design (§2, constraint 4) is the exact shape that would
  have invited `aria-label={status.error.message}` in a later "make it more informative" edit. Hidden
  *text* has no attribute to fill. CLAUDE.md's ruling cuts the other way for the client-owned prefix —
  the "must be a client-owned constant" rule is scoped to chrome speaking in the app's own voice, which
  this is — so a constant in the DOM is permitted where a relayed string in an attribute is not. The
  developer must not blur those two.
- **[Errors, logs, telemetry]** SHOULD FIX — the `error` arm is the one place a developer debugging this
  chip has `error.message` at their fingertips, and CLAUDE.md's rule is "never … a log" as flatly as it
  is "never an attribute". The view must reach no `console.*` at all, and neither must the control.
  Stated in §2; code review should check the diff for any `console` in either component and for any
  `status.error` dereference outside the discriminant test.
- **[Threat model — hostile daemon response]** No findings. A hostile or buggy daemon controls
  `ErrorPayload.code` and `.message`, which is precisely why the chip reads neither. The remaining
  daemon-controlled input to this *row* is the tool name in the sibling label, and this ticket's one
  interaction with it is a layout one, addressed next.
- **[Network & I/O / hostile daemon — remotely triggered layout]** No findings, with a required
  mitigation already in the design. #796 re-measured its truncation chain (3000-char tool name → row
  width unchanged, no horizontal overflow anywhere) with the right-hand slot **empty**. This ticket puts
  a second flex child in that row, so the measurement no longer covers the shipped configuration. Left
  shrinkable, the chip would absorb the squeeze from an oversized daemon tool name instead of the label
  ellipsizing — a remotely-triggered layout defect needing no exploit. §6 makes `flex: 0 0 auto` and
  `white-space: nowrap` required rather than cosmetic, and § Testing strategy requires the combined case
  be measured once in the running app rather than assumed. No new attack surface, but a real invariant
  that moved.
- **[Electron attack surface]** No findings — no `contextBridge` addition, no `ipcMain` channel, no
  `webPreferences` change, no custom protocol, no navigation or `window.open` surface, and no remote
  content. Nothing new crosses IPC (§ State + concurrency model); the transport is untouched. The Figma
  node carries no image, so the remote-`<img>` hazard #796 found does not recur here, and the CSP's
  absent `img-src` (`index.html:6-9`) would fail it closed regardless.
- **[Tokens, secrets, credentials]** Not applicable — the ticket adds no credential, no token path, no
  storage, and no key handling. `--color-error-container` is a colour literal.
- **[File / storage operations]** Not applicable — no path is constructed, no file read or written, no
  web storage touched. The chip is a pure function of one discriminant; nothing persists.
- **[Cryptographic primitives]** Not applicable — no RNG, hashing, key handling, comparison, or Noise
  surface anywhere in the design.
- **[Concurrency]** Not applicable — no async task, timer, listener, subscription, effect, or shared
  state mutation is added. The one store read is a synchronous selector on a slice another container
  already subscribes to, so there is nothing to cancel on teardown and no work that can outlive the
  window.
- **[Threat model — malicious relay]** Not applicable — the relay is content-blind and on-path; it
  cannot author an `ErrorPayload`, which travels inside the Noise session. It can *cause* the `error`
  arm by dropping the connection, which is exactly the state the chip is designed to report.
- **[Threat model — renderer compromise reaching the transport]** No findings — unchanged by this
  ticket. Both new components are renderer-side views with no bridge access; process isolation is
  untouched.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-27
