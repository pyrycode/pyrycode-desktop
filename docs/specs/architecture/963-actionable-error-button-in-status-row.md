# #963 — The actionable-error button in the status row's error slot

The composer status row's right-hand slot gains a second occupant: a filled `Button small` in the
design's Error type, reading `Pairing error - Re-pair`, shown exactly when `shouldOfferRepair` is true.
The row grows from 24 to 32 to fit it and end-aligns so the status label does not move. `RepairPrompt`,
`RepairControl` and `.composer__repair` — #167's separate block beneath the composer — are deleted.

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ComposerStatusArea` (the row and its
  `trailing` slot — the seam this ticket fills), `ComposerErrorChip` / `ComposerErrorChipControl` (#797's
  occupant, which stays), `RepairPrompt` / `RepairControl` (#167's block, which goes), `ConnectionBanner`
  / `ConnectionBannerControl` (the pure-view/store-bound-container split all four follow), `UnpairControl`
  (the other `runUnpair` caller, untouched)
- `src/renderer/src/screens/conversation/composerSend.ts` → `shouldOfferRepair` (the gate, reused
  verbatim), `COMPOSER_ERROR_CHIP_COPY` / `COMPOSER_ERROR_CHIP_PREFIX_COPY` / `CONNECTION_BANNER_COPY` /
  `composerAvailability` — the four client-owned strings the new label owes lexical distinctness to, and
  the docstring stating why they live together
- `src/renderer/src/screens/conversation/unpairAction.ts` → `runUnpair`, `UnpairDeps`,
  `UNPAIR_FAILED_ERROR` — the flow the button runs, and the `code: 'unpair'` the gate excludes
- `src/renderer/src/store/sessionStore.ts` → `selectStatus`, `ConnectionStatus`, `ConnectionError` — the
  slice the control subscribes to and the type the view must never destructure
- `src/renderer/src/screens/conversation/conversation.css` → `.composer-status` (the fixed height and the
  centre alignment this ticket changes), `.composer-status__activity` (the group that must stay 24 tall),
  `.composer-status__label--tool` and `.composer-status__error` (the two ends of the truncation chain),
  `.composer__repair` (deleted), `.question-panel__cancel` / `__previous` / `__continue` (the three-rule
  small-button treatment the new base class is extracted from), `.composer__actions` (the repo's own
  "One consumer is not a pattern" ruling on when to extract)
- `src/renderer/src/theme/tokens.css` → `--color-error`, `--color-error-container` (both already present
  and both used by this button), `--radius-xs`, `--text-body-small-*`, and the standing
  never-the-generated-fallback warning `--color-error-container`'s own comment carries
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → the `RepairPrompt` describe and
  the `ComposerErrorChip` describe (the pure-view matrix idiom), and the container block's
  `mounts the error chip in the status row once the session is in the error arm` test
- `e2e/unpair-repair.spec.ts` → the `re-pair:` test, its `forwarder.closeClientLeg(4401)` trigger, and
  the header comment's four-button claim
- `docs/knowledge/features/conversation-shell-composer.md` § "Composer status row (#796)" and § "Composer
  error chip (#797)" — **the load-bearing lesson for this ticket's tests**: a store-bound container's
  non-initial branch is NOT reachable by a `setState` in `beforeEach`, because zustand v5's `useStore`
  reads `getInitialState()` under `renderToStaticMarkup`. The shipped #797 container test spies
  `sessionStore.getInitialState` and restores it in a `finally`; the new container test copies that seam
  rather than rediscovering it. Also the re-measured truncation chain the new occupant must not invert.
- `docs/knowledge/features/conversation-shell-chrome.md` § "Re-pair control (#167)" — the split this
  ticket collapses, and the reason there is no confirm phase and no busy guard
- `docs/knowledge/features/composer-send.md` § 5 and § 8 — the gate and the chip copy in their own words

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-5408

The status area (`I347:5408;111:3525`) is a 780×32 row, `flex items-end justify-between` — confirmed at
the node, which returns exactly those classes. The 24-tall status group (snowflake plus `Thinking…`) sits
flush with the row's bottom edge on the left; on the right a filled dark-red button reads
`Pairing error - Re-pair` and fills the row's full 32px height. The button (`Button small`, instance
`I347:5408;354:7093`, variant `354:7088`) is 16px horizontal / 8px vertical padding, a 6px corner, M3
body/small-emphasized at weight 500, label nowrap; its fill is `Schemes/On Error` and its text
`Schemes/Error`, and on hover (`354:7090`) the fill becomes `Schemes/Error Container` with the text
unchanged.

Variable values read from `get_variable_defs` on `354:7088` (never the generated export, whose fill
fallback prints `white` and whose text fallback prints `#ba1a1a` — both the light scheme):
`Schemes/On Error` = `#690005`, `Schemes/Error` = `#ffb4ab`, `Schemes/Error Container` = `#93000a`,
Body Small = 12 / 16 / 0.4 at weight 500.

## Context

Two surfaces carry a terminal connection error today and neither is what the design draws: #797's red
`Host connection down!` chip in the row's `trailing` slot, and #167's bare `Re-pair` text button in its
own `.composer__repair` block beneath the composer. Juhana's ruling of 2026-09-02 is that an error the
operator can act on becomes a button in the chip's slot, labelled "Type of error - Action", and the block
beneath the composer goes. `shouldOfferRepair` is already a strict subset of `status.type === 'error'`,
so the two occupants are mutually exclusive by construction and no new predicate is needed.

No ADR is warranted. The one general decision here — a shared small-button treatment extracted from the
question panel's three-rule list — is a stylesheet-local extraction the repo's own `.composer__actions`
comment already prescribes the trigger for ("One consumer is not a pattern"), not an architectural
choice. The documentation phase should fold it into
`docs/knowledge/features/conversation-shell-composer.md` beside the #797 section.

## Design

### The slot becomes a three-way pure view

`ComposerStatusArea`'s `trailing` slot is unchanged as a seam — it still renders its occupant bare, with
no wrapper — and the choice of occupant moves into a new pure view.

```ts
export function ComposerErrorSlot(props: {
  status: ConnectionStatus
  onRepair: () => void
}): JSX.Element | null
```

Three arms, in this order: `shouldOfferRepair(status)` → the button; otherwise delegate to the existing
`ComposerErrorChip`, which returns the chip on the `error` arm and `null` on the other three. Ordering is
the whole of AC1's "one occupant per slot" — the predicate is the narrower gate, so it must be asked
first — and delegating rather than inlining the chip's markup is what keeps #797's entire test describe
and its two container assertions true, unedited.

`status` is a **prop, not a store read**, for `RepairPrompt`'s and `ComposerErrorChip`'s stated reason:
the populated branches are unreachable under `renderToStaticMarkup`, so the three-way matrix is only
assertable if the view takes an injected status. `onRepair` is likewise a prop, so no `window.pyry`
dereference exists anywhere in this view's render path.

`ComposerRepairButton` is deliberately **not** a fourth component. The button is six lines of markup with
no branch of its own; a component whose only job is to be rendered unconditionally by its single caller
adds a name and a test surface without adding a decision.

### The store-bound container

`ComposerErrorChipControl` and `RepairControl` collapse into one module-private container:

```ts
function ComposerErrorSlotControl(props: { onUnpaired?: () => void }): JSX.Element | null
```

It selects `status` via `selectStatus` and `dispatch` from `useSessionStore` — the same two narrow slices
`RepairControl` reads today, so the re-render footprint is unchanged: a status change re-renders this
control and the composer, never the thread. `handleRepair` is `RepairControl`'s body verbatim —
`void runUnpair({ unpair: window.pyry.unpair, dispatch, onUnpaired: () => onUnpaired?.() })` — with the
bridge dereference inside the handler, never in render. No confirm phase and no busy guard, for #167's
recorded reasons: the button only ever appears in an already-terminal error, and it self-hides on both
outcomes (`ok` → route unmounts the screen; `error` → the store lands on `code: 'unpair'`, which the
predicate excludes).

At the mount site, `trailing={<ComposerErrorChipControl />}` becomes
`trailing={<ComposerErrorSlotControl onUnpaired={onUnpaired} />}`, and the `<RepairControl
onUnpaired={onUnpaired} />` line after `ComposerSlot` is deleted. `onUnpaired` is already a destructured
prop of `ConversationScreen`, so nothing new is threaded.

### Deletions

`RepairPrompt` (exported), `RepairControl` (module-private) and `.composer__repair` go entirely, along
with `RepairPrompt`'s import in the test file and its pure-view describe. `.conversation__unpair` stays —
`UnpairControl`'s three buttons still wear it.

### The label constant

`COMPOSER_REPAIR_BUTTON_COPY = 'Pairing error - Re-pair'` joins `composerSend.ts` beside
`COMPOSER_ERROR_CHIP_COPY`, as the fifth client-owned string that module owns about the single
`ConnectionStatus` fact, for the reason `COMPOSER_ERROR_CHIP_COPY`'s docstring already gives: the lexical
distinctness the five owe each other is only reviewable if they sit together. It leads with `Pairing`,
sharing no leading word with `Host connection down!` / `Cannot reach pyrybox…` / `Connecting…` /
`Not connected` / `Connection error`. Apostrophe-free, and the separator is an ASCII hyphen-minus, so a
`renderToStaticMarkup` `toContain` matches it verbatim.

### CSS — height by content, and end alignment

`.composer-status` changes two declarations:

- `height: 24px` → `min-height: 24px`. The 32px button then sets the row's height when present and
  nothing else does. No `--tall` modifier: the button being there IS the state, and a modifier would be a
  second source of truth for a fact the box model already has.
- `align-items: center` → `align-items: flex-end`, the design's own `items-end`.

**The alignment change forces a third edit that a `min-height` change alone would miss in the other
direction.** `.composer-status__activity` has no height of its own today; at a fixed 24px row with
`align-items: center`, centring its ~16px content produced the Figma group's 24px box for free — the
row's own comment records that trade explicitly. Under `flex-end` that equivalence breaks and the label
would sit flush against the row's bottom edge, dropping 4px in the *chip and empty* cases. So the group
gains `min-height: 24px` — the Figma status group's own height (`112:3530`) — and keeps its internal
`align-items: center`. The 16px line is then centred in a 24px box that is itself flush with the row's
bottom edge, which is identical geometry at both row heights. That is what AC3's "the label does not
move" reduces to, and it is the half AC3 exists to pin.

`min-height` is safe under this repo's absent `box-sizing` reset: the row carries zero vertical padding
and the group carries none either, so both boxes are exactly their declared minimum.

### CSS — the shared small-button base class

The button's reset, type, corner, nowrap and `flex: 0 0 auto` are the same declarations
`.question-panel__cancel` / `__previous` / `__continue` already share in one rule. Extract them into a
base class both families wear:

- `.button-small` — `flex: 0 0 auto`, `border-radius: var(--radius-xs)`, `font-family: inherit`, the four
  body-small type tokens at `--text-body-small-weight-emphasized`, `white-space: nowrap`, `cursor:
  pointer`. Named after the design's own `Button small` component set (`347:6645`) rather than after any
  one block, because it is worn by elements of two different blocks; it is a BEM *block*, which is what
  every other top-level class in these stylesheets is.
- `.button-small--error` — the design's `Type=Error` variant: `padding: var(--space-2) var(--space-4)`
  (8/16), `border: none`, `background: var(--color-on-error)`, `color: var(--color-error)`, and a
  `:hover` rule swapping the fill to `var(--color-error-container)`. No `outline: none` — AC3 requires a
  visible focus ring, and the question-panel rule's own comment already declines that property for the
  same reason.

Padding stays in the variants, not the base: the outlined pair needs `7px` to compensate for its 1px
border under content-box, and that rule's comment explains why. The three question-panel elements keep
their class names and their fill rules; they gain `button-small` in their `class` attributes. That is the
two-class mix this repo already ships one row up (`class="conversation__thinking composer-status__label"`)
and its own comment calls ordinary BEM.

Extraction rather than a fourth selector on the panel's list is the ticket's ruling and the right one:
joining is correct within the panel's family, and a composer-status button is not in it. The
`.composer__footer-button` note is a different family — four bare text buttons with no fill, no padding
and no corner — and this button is filled with 16/8 padding and a 6px corner, so it is not wired there.

`flex: 0 0 auto` arriving with the base class is also what keeps #797's truncation chain pointing the
same way with a wider occupant in the slot: the activity group (`flex: 1 1 auto; min-width: 0`) absorbs
the whole squeeze and an oversized daemon tool name ellipsizes the label rather than shrinking the
button. Re-measured in Phase B the way #797 re-measured it with the chip up.

### The new token

`--color-on-error: #690005` joins `tokens.css` beside `--color-error` and `--color-error-container`, read
from the Figma **variable** on `354:7088`, never from the generated export's `white` fallback, which is
the light scheme. The `--color-error-container` comment's standing warning applies verbatim and the new
token's comment restates it. `--color-error`, `--color-error-container`, `--radius-xs` and
`--text-body-small-weight-emphasized` all already exist; this is the only addition.

### Comments that go stale in this edit

Three, all corrected in the same commit rather than left contradicting the code beneath them:

1. `.composer-status`'s own comment — "the fixed height is the whole point (AC2)", "no vertical padding
   so 24px is the exact box", and "the trailing slot's occupant is itself 24 tall, so appending it grows
   nothing". The anti-jitter reason ("reserved whether or not there is a label inside") survives
   `min-height` intact and stays; the centring trade it records is what the group's new `min-height`
   replaces, and the comment must say so.
2. `ComposerStatusArea`'s docblock — the slot "gets no placeholder element: the `height` declaration is
   what reserves the row, and the Figma error frame is itself 24 tall, so a second flex child grows
   nothing". The bare-render argument in the same block is untouched and stays.
3. `.composer-status__error`'s `white-space: nowrap` clause — "the row sets a hard height, so a wrapped
   chip would overflow it rather than grow it". The declaration is still required and its *effect* is
   unchanged; only the stated reason inverts (a wrapped chip would now grow the row), so that one clause
   is corrected in place.

## State + concurrency model

No new state, no new store slice, no new IPC, no new async work. The container subscribes to the same
`selectStatus` slice `RepairControl` and `ComposerErrorChipControl` read today — one subscription where
there were two, so the re-render footprint narrows slightly. `handleRepair` fires the existing
`runUnpair`, which is a one-shot promise that never rejects (it catches internally) and is therefore
fired as a bare `void` with no `.then` — #167's recorded call shape, unchanged. There is nothing
long-lived to cancel: no effect, no listener, no timer, no `AbortSignal`. The affordance self-hides on
both outcomes, so no teardown path is needed for the button itself.

## Error handling

The only failure mode is `runUnpair`'s own: `window.pyry.unpair` rejecting or returning `result: 'error'`
both dispatch `UNPAIR_FAILED_ERROR` (`code: 'unpair'`, `retryable: false`) and stay on the screen. That
code is excluded by `shouldOfferRepair`, so the button disappears and the plain chip takes the slot —
the same self-hiding #167 designed and #167's AC5. No new error type, no new surface, and no failure path
that renders anything derived from `ConnectionError`.

## Testing strategy

**vitest, renderer (`ConversationScreen.test.tsx`)** — static server renders; the three-way matrix and
the constant label are markup assertions:

- `ComposerErrorSlot` pure-view describe, replacing the `RepairPrompt` describe:
  - terminal non-retryable error → markup contains `COMPOSER_REPAIR_BUTTON_COPY` inside a `<button>`, and
    does **not** contain `composer-status__error` (the chip is absent — AC1's exclusivity, asserted in
    both directions rather than only the present one)
  - retryable daemon error (`server.binary_offline`, `retryable: true`) → the chip renders and the button
    does not (#167's AC4, preserved)
  - self-inflicted `code: 'unpair'`, `retryable: false` → the chip renders and the button does not
    (#167's AC5, preserved)
  - each of `disconnected` / `connecting` / `connected` → `toBe('')`, the strict exact-empty form #797's
    describe uses, which is what proves "not an empty element"
  - a hostile `ConnectionError` with sentinel `code` and `message` → neither string appears anywhere in
    the markup on the button arm (AC4, the structural guarantee restated for the new occupant)
- The `ComposerErrorChip` describe and both container chip assertions stay **unedited** — the view is
  reused, not rewritten.
- Container: the mounted `ConversationScreen` renders the button inside the row once the session is in a
  terminal error arm, asserted with a `vi.spyOn(sessionStore, 'getInitialState')` restored in a
  `finally` — **not** a `beforeEach` `setState`, which cannot reach a non-initial branch under
  `renderToStaticMarkup` (the #797 lesson, measured 2026-08-27). Index-ordering proves the button trails
  `class="composer-status"` rather than sitting loose in the region, which is the only assertion that
  proves the `trailing` prop was actually wired.
- Container: `.composer__repair` and the old `>Re-pair</button>` string appear in **no** state — the
  disconnected default and the spied error arm both.

**vitest, pure (`composerSend.test.ts`)** — the label constant is lexically distinct from the other four
strings this module owns and is apostrophe-free, the assertion shape
`COMPOSER_ERROR_CHIP_PREFIX_COPY`'s own test already uses.

**Playwright, fake tier (`e2e/unpair-repair.spec.ts`)** — the height, the label's position across the
transition and the click, none of which a static render can reach. The existing `re-pair:` test already
drives the fatal close (`forwarder.closeClientLeg(4401)`), so it extends rather than gaining a sibling:
measure `.composer-status`'s bounding box and the label's offset from the row's bottom edge **before** the
close (row 24, slot empty) and **after** it (row 32, button present), assert the row's height changes 24
→ 32 and the bottom-edge offset does not change, then click the button by its new accessible name and
assert the app-root pairing screen. The locator moves from
`getByRole('button', { name: 'Re-pair', exact: true })` to the full label, and the header comment's
"four Unpair/Cancel/Confirm/Re-pair buttons all carry `conversation__unpair`" becomes three, since this
button does not wear it.

The **chip** case of AC3's height assertion is not driven in e2e: reaching it needs a retryable daemon
error frame the fake forwarder has no hook for, and building one is disproportionate. It holds by
construction and is already measured — the chip is 24 tall by its own 16px line plus 4px twice (#797's
comment records the measurement), and 24 is the row's `min-height`, so the row cannot be any other height
with only the chip in it.

Fakes over mocks throughout: no new mock, no new fake. The one `vi.spyOn` is on the store's own
`getInitialState`, which is the narrowest seam to a branch server rendering cannot otherwise reach.

## Open questions

1. **Does the message box actually move 8px?** The ticket accepts an 8px shift as a terminal-state cost.
   Under the shipped column layout it may not happen at all: `.conversation` is `height: 100%` with
   `.conversation__thread` at `flex: 1 1 auto; min-height: 0; overflow-y: auto`, so the thread should
   absorb the row's growth and everything below the row should stay put. Confirm by measurement in Phase
   B. Either outcome satisfies AC3, which pins the row's height and the label's offset from the row's
   bottom edge, not the message box; no assertion depends on the answer. Record the finding.
2. **Does the truncation chain still terminate in the label with the wider button up?** #797 re-measured
   it with the 155px chip; the button is ~157px, so the answer is almost certainly unchanged. Re-measure
   the way #797 did (a 3000-char tool name, no horizontal overflow on `.conversation` or `document.body`)
   rather than reasoning from the 2px difference, and record the numbers in the CSS comment.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] SHOULD FIX — the slot view cannot inherit `ComposerErrorChip`'s "never
  destructures `status.error`" guarantee verbatim, and the difference must be held deliberately.**
  `ConnectionStatus` carries daemon- and relay-influenced content (`ConnectionError.code`, `.message`)
  across the IPC boundary into the renderer. `ComposerErrorChip` narrows on `status.type` alone, so #797
  could state that no field of the error arm has *any* rendering path. `ComposerErrorSlot` is different:
  it calls `shouldOfferRepair`, which reads `status.error.retryable` and `status.error.code`. Those two
  reads are confined to a boolean decision inside a pure predicate that returns no daemon data — but the
  code now sits one line away from a value a future implementer could render ("we already have the code,
  let's show it"). Phase B must keep this structural rather than conventional: `ComposerErrorSlot` binds
  no local to `status.error`, and the button arm's markup is `COMPOSER_REPAIR_BUTTON_COPY` and nothing
  else. The sentinel-`code`/`message` test on the **button** arm (Testing strategy above) is what makes
  the guarantee falsifiable rather than a comment; it is required, not optional. The verifier should
  check that test exists and asserts both sentinels absent.
- **[Trust boundaries] No finding on the predicate's own exposure.** A hostile peer inside the Noise
  session can choose `retryable: false` with any `code` other than `unpair` and thereby force the button
  to render and suppress the chip. That exposure is `shouldOfferRepair`'s, is unchanged by this ticket
  (the predicate is reused byte-for-byte), and its maximal effect is that a client-authored offer to
  re-pair appears when the peer says the pairing is dead — which is the affordance's honest meaning. The
  suppressed chip carried strictly *less* information than the button that replaces it, so nothing is
  hidden by the swap.
- **[Tokens, secrets, credentials] No findings.** No token is read, rendered, stored or logged on this
  path. The click reaches `window.pyry.unpair()`, an existing zero-argument IPC invoke that clears the
  stored pairing in main; no credential crosses into the renderer in either direction. Revocation is
  local-clear-only — the daemon is not told the device is gone — but that is `runUnpair`'s pre-existing
  contract from #166/#173, identical for the header's Unpair control, and is **out of scope** here.
- **[File / storage operations] Not applicable, structurally.** This ticket adds no filesystem code and
  no path handling. The only storage effect is main's existing pairing clear, behind an IPC handler that
  takes no arguments — so there is no attacker-controlled value to traverse, resolve or boundary-check,
  and no check-then-open gap to race.
- **[Inter-process / Electron attack surface] No findings.** No new `contextBridge` API, no new
  `ipcMain` channel, no new `BrowserWindow`, no protocol or deep-link handler. `window.pyry` is
  dereferenced only inside `handleRepair` (interaction time), never during render, so a server render or
  a module-eval order change never touches the bridge — #167's shipped posture, carried over. The
  occupant is a `<button type="button">` with an explicit type so it cannot become a form submit; it
  carries no `href`, `formaction`, `target` or any other navigation sink, and nothing on this path uses
  `dangerouslySetInnerHTML` or writes an attribute from `status`.
- **[Cryptographic primitives] Not applicable.** No RNG, no key material, no hashing, no comparison of an
  attacker-controlled value against a secret. The Noise session and every key stay in main and are not
  read, referenced or re-derived by any code this ticket touches.
- **[Network & I/O] Not applicable.** No socket, no fetch, no frame parsing, no timeout or size cap to
  set. This is renderer presentation plus one existing IPC invoke; the transport is untouched.
- **[Error messages, logs, telemetry] No findings, and the absence of a log call is deliberate.** AC4 is
  this category: the button's visible text and its accessible name are the same client-owned constant,
  and no part of `ConnectionError` reaches the DOM, an attribute, a `title`, or a `console.*`. No
  structured log is added on this path **on purpose** — a renderer-side log of a connection error would
  put a daemon-influenced string into the renderer console, which CLAUDE.md forbids ("never into a log"),
  and the main-process transport already logs the classified failure at the boundary where it is
  content-free. Adding one here would be a regression, not coverage.
- **[Concurrency] No findings.** No effect, no listener, no timer, no `AbortSignal` — nothing long-lived
  is launched, so nothing needs cancelling. `handleRepair` fires `runUnpair` as a bare `void`, which is
  safe because `runUnpair` catches internally and never rejects. A double-click can fire it twice (the
  button has no busy guard, unlike `UnpairControl`); both invokes are idempotent (clearing an
  already-cleared pairing) and both route flips are the same `setRoute('pairing')`, so the race is
  benign. This is #167's shipped behaviour, unchanged — adding a busy guard now would be a defence for a
  failure mode nobody has observed.
- **[Threat model alignment] No findings; one accepted risk named.** *Malicious relay:* on-path and
  content-blind, it can drop the connection and thereby make the button appear — the correct response,
  and it cannot alter the label (a constant) or the action (a fixed, argument-free handler). *Hostile
  daemon response:* can only toggle which of two client-authored occupants shows. *Renderer compromise:*
  no new capability is exposed — injected script could already call `window.pyry.unpair` directly, so
  the button widens nothing. *Accepted risk:* the destructive clear still has **no confirmation step**,
  and this ticket makes the control markedly more prominent (a 157×32 filled button in the row's
  information slot, replacing a bare de-emphasised text button below the composer), so a misclick is
  somewhat likelier than before. The consequence is bounded and recoverable — the operator re-pairs by
  scanning a QR — and the no-confirm design is Juhana's 2026-09-02 ruling on top of #167's recorded
  rationale (the affordance only ever appears in an already-terminal state, where a confirm step is pure
  friction). Named here so the decision is visible rather than implicit; **out of scope** to revisit.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-03

## Revisions

### 2026-09-03 — implementation

**One of #797's two container assertions did NOT survive, contrary to the ticket's note and this plan's
Testing strategy.** The ticket states "the chip tests stay true: the `ComposerErrorChip` describe and the
two container assertions on `composer-status__error`", and the plan repeated it. The pure-view describe
and the *disconnected* container assertion did survive untouched. The chip's *error-arm* container test
did not, and it went red rather than vacuous: it staged `code: 'transport', retryable: false`, which is
exactly the status `shouldOfferRepair` admits, so the slot correctly filled with the button and the chip
was correctly absent. Repointed onto a retryable daemon error (`server.binary_offline`), which is an arm
the chip still owns (#167's AC4) and which keeps the test's actual claim — the `trailing` prop reaches
the row with the chip in it — intact. This is #796's own "test-file vacuity repoint" hazard, one degree
better: the exact-status form made it fail loudly instead of passing against a state nothing can produce.

**A fifth production file: `QuestionPanel.tsx`.** The plan's CSS section prescribed a `.button-small`
base class the question panel's three buttons "wear", which means their `className` attributes, not only
the stylesheet — so the panel's view is edited too (three class attributes) and `QuestionPanel.test.tsx`'s
exact-string assertion on the Cancel button's markup moves with it. That assertion is #921's structural
"nothing leaked into an attribute" guard; it keeps its exact-string shape with the class list updated,
because the exactness is the point. Five production files against the boundary's five: still inside it,
and named here because the plan's own file list said four.

**Open question 1 is answered, and the ticket's premise was wrong in both magnitude and cause.** The
ticket accepts "the message box moves 8px on that transition". Measured in the fake tier, the message box
moves 20px *upward*, and none of it is the row's growth: the same status change mounts #279's connection
banner above the thread and the composer's own `Connection error` hint inside `.composer`. The row's own
8px is absorbed by `.conversation__thread` (`flex: 1 1 auto; min-height: 0`) as the plan predicted. No
assertion was added for it — an assertion on the box's absolute position would pin the banner's and the
hint's geometry under a name claiming to be about this row. The e2e reads all three geometry facts
relative to the row for the same reason, and the spec records this.

**Open question 2 is answered by measurement, not by the 2px reasoning.** Re-measured the way #797 did
(this row's markup, both stylesheets, headless Chromium at the 800px minimum window width, 640px pane, a
3000-char tool name): the row stays 640×32, the button is unshrunk at **167.88px** — not the ~157 this
plan guessed from the Figma frame, the standing Roboto→system-ui substitution — the activity group
absorbs the entire squeeze at 448.13px and the label at 426.13px, and both `.conversation` and
`document.body` report a `scrollWidth` equal to their `clientWidth`. The chain still terminates in the
label. The real numbers are in `.button-small`'s comment.

**AC3's focus-ring clause is asserted in e2e after a keypress.** Chromium only paints the ring for
keyboard-driven focus, so a bare programmatic `focus()` proves nothing; the spec presses a key first,
which makes the subsequent focus count as keyboard intent, then reads `outline-style`/`outline-width`.
Confirmed to pass deterministically. No focus rule was added to the stylesheet — the Figma component set
draws Default and Hover only, so the UA ring is the treatment and the requirement is that nothing
suppresses it.

**Four prose citations in `ConversationScreen.tsx` were repointed**, not left dangling: `ConnectionBanner`,
`ConnectionBannerControl` and `ThreadOverflowMenu`'s containers each cited `RepairPrompt` or
`RepairControl` as the precedent for a pattern, and this ticket deleted both symbols out of that same
file. They now name `ComposerErrorSlot`/`ComposerErrorSlotControl`, which carry the same properties.
Citations of the retired names in files this ticket does not touch (`PermissionModal.tsx`,
`CreateFolderDialog.tsx`) were left alone as out of scope.
</content>
</invoke>
