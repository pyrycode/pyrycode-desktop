# 1107 — the input footer's whole-row shrink policy

## Files read

- `src/renderer/src/screens/conversation/conversation.css` → `.composer__footer` — the row under repair:
  `height: 20px`, `gap: var(--space-5)`, `padding: 0 var(--space-4)`, `flex` with no `wrap`.
- `src/renderer/src/screens/conversation/conversation.css` → `.composer__footer-button` — the shared
  treatment worn by all four triggers, by the model/effort INERT arms, and by the attach button. It is the
  one selector that reaches every control in the row, which is what makes it the right place for a policy
  rather than a per-control number.
- `src/renderer/src/screens/conversation/conversation.css` → `.composer__model-label`,
  `.composer__effort-label`, `.composer__permission-label` — the three `min-width: 0` + `max-width` +
  `overflow: hidden` + `text-overflow: ellipsis` chains. Two of their comments name this ticket's remedy
  ("a whole-row shrink policy on `.composer__footer`, not a number in a single control's rule") and both
  decline to perform it. Neither bound is touched here.
- `src/renderer/src/screens/conversation/conversation.css` → `.composer__context` — the reading. `nowrap`,
  no `min-width: 0`, no non-visible `overflow`. That combination is load-bearing for AC3 (below).
- `src/renderer/src/screens/conversation/conversation.css` → `.composer__attach` — `flex: 0 0 auto` plus
  `margin-left: auto`; its comment already states the intent this ticket implements, "a narrow window
  degrades by squeezing rather than by overflowing".
- `src/renderer/src/screens/conversation/conversation.css` → `.composer-options-anchor` — the wrapper each
  menu trigger sits inside, so it and not the `<button>` is the row's flex item. Its own comment defers
  exactly this question: "how `.composer__footer` behaves when five controls overflow the row is
  #680/#682/#683's question, not the anchor's".
- `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx` → the `composer-options-anchor` wrapper
  → `<button className={triggerClassName}>` nesting — the two levels a shrink has to pass through.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → the `.composer__footer` JSX — the six
  children and their order; no markup changes here.
- `src/renderer/src/pairedShell.css` → `.paired-shell__pane` — `flex: 1 1 0` with `overflow: hidden`, and
  the shell's 20px inset and 20px gap beside a `flex: 0 0 400px` sidebar. This is where the row's width
  comes from: footer border box = window − 484px, so 316px at the 800px minimum and 616px at the 1100px
  default. It also says why the defect is invisible rather than painted: the pane CLIPS the overflow, so
  the operator simply loses the attach button off the pane's right edge.
- `src/main/index.ts` → the `BrowserWindow` options — `width: 1100`, `minWidth: 800`. Both are the
  derivation anchors below and neither moves.
- `docs/knowledge/features/conversation-shell-composer-message-box.md` § "Composer footer row (#811)" —
  the row's membership and order, and the note that #1062's five-character growth "lands on a row that was
  already overflowing its 800px-minimum-window content box before this ticket touched it".
- `e2e/composer-context-severity.spec.ts` — the priming shape the detector copies: answer
  `request_session_settings`, and the reading mounts on conversation open since #1166.
- `e2e/composer-effort-menu.spec.ts` — the `model_list` push that turns the model and effort triggers from
  their INERT arms (label only) into their operable arms (label + chevron), which is the wider rendering
  and therefore the one the detector must measure.
- `e2e/composer-options-clamp.spec.ts` — the `app.evaluate` / `BrowserWindow.setSize` precedent. This spec
  narrows to 800, which is AT the shipped floor, so unlike that one it borrows nothing and restores
  nothing.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=110-3494

The footer is drawn 780×20: a single `justify-between` row with `pt-[4px] px-[16px]`, holding an
`Info and buttons` group on the left — four `Input footer button` instances (`Actions ⌃`, `Auto ⌃`,
`Opus ⌃`, `Max ⌃`, each a M3 body/small word in `schemes/primary` beside an 8×4 chevron, 4px apart) then
the `Context: 84%` reading, all five at a 20px rhythm — and the 11×12 attachment glyph alone at the right
edge. The drawing fixes membership, order, the 20px rhythm and the 20px height at ONE width and says
nothing about narrower ones, so this ticket treats membership, order and height as invariants and the
rhythm as the design's own proportion (20 of 748px of content) rather than as a constant.

## Context

At the app's documented 800px minimum the chat pane is 340px wide and `.composer__footer`'s border box is
316px — 284px of content once the row's two `--space-4` paddings are removed. The row is `nowrap` and
nothing in it can give:

- the five `--space-5` gaps are a fixed 100px, 35% of the content box;
- `.composer__actions` and `.composer__context` are `nowrap` flex items with the default `min-width: auto`,
  so their automatic minimum size is their full text;
- the three bounded labels DO ellipsize, but only against their own `max-width` — the `min-width: 0` that
  makes that reachable stops at the label, while the `<button>` above it and the `.composer-options-anchor`
  above THAT both keep `min-width: auto`, so each trigger's floor is its clamped content and no shrink ever
  propagates down to the label;
- `.composer__attach` is `flex: 0 0 auto`.

So the row's content is its floor, the floor exceeds the box, and the overflow is clipped by
`.paired-shell__pane` — the attach button and the tail of the reading are simply gone. Measured at
`2ef4e41`: 429px of content in a 316px box with the pre-#1062 reading, 465px with `Context high: 100%`.
#1095 shrank the model trigger by showing a derived family, which moves those figures without touching the
defect; the numbers this plan derives against are re-measured at HEAD in Phase B and recorded there.

This ticket ships the fix the two shipped CSS comments assigned and both declined to perform, and it also
answers the question `.composer-options-anchor`'s comment deferred to "#680/#682/#683".

No ADR is warranted: this is a layout policy on one row, and the reasoning belongs in the rules' own
comments where the two declining comments already put it.

## Design

Three rules in `conversation.css`, four declarations, no markup change and no new file. The policy, stated
once: **whitespace gives first, then every labelled control gives together, and the context reading never
gives.**

### 1. The row's rhythm becomes a proportion of the row — `.composer__footer`

`gap: var(--space-5)` becomes `column-gap: min(<P>%, var(--space-5))`.

- `column-gap` rather than the `gap` shorthand: the row is single-line `nowrap`, so `row-gap` has no
  meaning here and the axis the policy acts on should be the one it names.
- A percentage `column-gap` on a flex container resolves against the container's OWN content box, and this
  row's inline size is definite (a stretched child of the `.composer` column), so there is no
  indefinite-size resolution to fall foul of. **This is the one mechanism assumption in the plan and the
  detector proves it** (below): if percentage gaps resolved to zero the rhythm assertion at the default
  width fails rather than passing quietly.
- `min(…)` rather than `clamp(…)`: the cap is the design's own 20px, and a floor argument would be inert —
  `<P>%` of the narrowest row the app permits is already several pixels, and the app cannot go narrower.
- `<P>` is DERIVED, not chosen: the smallest tenth of a percent that still reaches the 20px cap at the
  app's own default 1100px window, whose footer content box is 584px (20 / 584 = 3.43%). Phase B measures
  that content box in the built app and records the resulting literal. The consequence is the property
  this fix wants: **at every width from the shipped default upward the row is pixel-identical to today**,
  and the rhythm only compresses where the row was already broken.

### 2. Every control may give — `.composer-options-anchor`, `.composer__footer-button`

`min-width: 0` on both. A shrink has to pass through two boxes to reach a label: the row's flex item is
the anchor, and the `<button>` is a flex item of the anchor. Each defaults to `min-width: auto`, whose
content-based minimum is the trigger's clamped content — which is precisely why the labels' existing
truncation chains never fire from row pressure today. `min-width: 0` at both levels is what hands the
label the deficit; the chevrons keep their own `flex: 0 0 auto` and the labels their own `max-width`, so
nothing else about the controls changes. `.composer__attach` wears `.composer__footer-button` and is
`flex: 0 0 auto`, so the declaration reaches it and does nothing there.

`overflow: hidden` on `.composer__footer-button` as well: a control squeezed below its chevron would
otherwise paint that chevron outside its own box and re-create the row's overflow from the inside. This is
the structural half of AC3 — with it, **no footer control can contribute scrollable overflow to the row
whatever the daemon publishes**, rather than that guarantee resting on arithmetic. It cannot clip a focus
ring (an outline is not clipped by the element's own overflow) and it must NOT be added to
`.composer-options-anchor`, which is the open panel's containing block and would clip the panel away.

### 3. The reading gives nothing — `.composer__context`, unchanged

No declaration. Its guarantee is what it does NOT wear: with `white-space: nowrap`, no `min-width: 0` and
a visible `overflow`, its automatic minimum size is its own full text, so flexbox cannot shrink it at any
deficit. A `flex-shrink: 0` here would be exactly equivalent and therefore inert; the invariant is
recorded in the rule's comment instead, naming the two properties whose later addition would retire it.

### What is deliberately not done

- No label `max-width` is retuned. That is the "number in a single control's rule" both shipped comments
  rule out, and retuning one would make the row's fit depend on the vocabulary the daemon happens to
  publish.
- No media query and no breakpoint: the row's own width is the input, not the window's.
- No container query and no `container-type`: a percentage gap already resolves against the box that
  matters, and `container-type` appears nowhere in this repo.
- No markup change, no component change, no new class.

## State + concurrency model

None. Three CSS declarations on shipped selectors; no store slice, no subscription, no async work, no IPC.
The detector drives the shipped `BrowserWindow` through `app.evaluate` and starts no long-lived task.

## Error handling

None to add. The failure this ticket removes is a layout overflow, not a runtime error; nothing in the
change can throw and no code path gains a branch. The one behaviour under adverse input — a hostile or
merely buggy published model/effort/permission string — is handled structurally by § Design 2 and 3 and
audited under § Security review.

## Testing strategy

**Renderer (vitest) — nothing new.** `vitest.config.ts` runs `environment: 'node'` and every renderer spec
is a `renderToStaticMarkup` string: there is no layout, so an overflow is unobservable there by
construction. No markup changes, so no existing renderer assertion moves.

**e2e (Playwright, fake transport) — one new spec, `e2e/composer-footer-overflow.spec.ts`.** One `test()`,
one launch, one continuous drive; the sibling specs' secret-hygiene rule carried verbatim (every assertion
reads geometry, counts or DOM text).

- *Priming.* Answer `list_conversations` with the seeded frame and `request_session_settings` with a
  worst-content snapshot; push one `model_list` for the seeded conversation so the model and effort
  triggers render their OPERABLE arms (label + chevron) rather than their narrower inert ones. Both frames
  are ones the daemon really sends — the standing fake-tier rule.
- *Worst realistic content.* `used_tokens == window_tokens`, so the reading is its longest possible string,
  `Context high: 100%`; a published model value whose derived family is far past
  `.composer__model-label`'s bound and a published effort level far past `.composer__effort-label`'s, so
  both labels sit AT their `max-width`; `permission_mode: 'bypassPermissions'`, whose client-owned label
  `Bypass permissions` is the widest in that control's vocabulary. Long seeds are the point: the shipped
  specs seed short labels and a short-seeded row can fit even unfixed.
- *AC1 — the detector.* At an 800×600 window (reached with `BrowserWindow.setSize`; 800 is AT the shipped
  floor, so nothing is borrowed), poll `.composer__footer`'s `scrollWidth <= clientWidth`. Width-based
  because the row's hard `height: 20px` makes any height assertion structurally undetecting.
- *AC2 — the invariants.* All four anchors, the reading and the attach button present at 800; their
  bounding boxes strictly ascending in x, which is the Figma's order as geometry rather than as DOM order;
  the row's measured height still 20; and `BrowserWindow.getMinimumSize()` still reporting the shipped 800.
- *The mechanism, at the default width.* Before narrowing, at the 1100 launch width, the measured distance
  between two adjacent footer items is still the design's 20px. This is the assertion that fails loudly if
  a percentage `column-gap` resolves to zero, and it pins "the fix is invisible where the row was not
  broken".
- *RED first.* The spec is written and run against the unmodified stylesheet and must fail on the AC1
  assertion, for the measured overflow, before the CSS is touched.

## Open questions

1. **Does a percentage `column-gap` resolve against the content box in this Electron's Chromium?** Assumed
   yes (per CSS Box Alignment, and the row's inline size is definite). Resolved in Phase B by the
   default-width rhythm assertion; if it resolves to zero the fallback is `container-type: inline-size` on
   `.composer` with the same proportion expressed in `cqi`, which is a one-line change to the same rule.
2. **The exact `<P>`.** Derived in Phase B from the footer's measured content box at the 1100px default;
   recorded here under `## Revisions` with the measurement.
3. **How narrow do the labels actually get at 800 with worst-case content?** Arithmetic says roughly two
   characters plus the ellipsis. That is the honest floor of a six-control row in a 284px content box and
   it is what "the row compresses" means; if the measurement shows a control squeezed below its own
   chevron, § Design 2's `overflow: hidden` is what keeps that from re-creating the overflow, and the fact
   is recorded rather than papered over.

## Security review

**Verdict:** PASS

**Findings:**

**1. Trust boundaries — the row is a daemon-text display surface, and every declaration here narrows it.**
Three of the row's six occupants render strings that crossed the subprocess trust boundary: the model
family (derived from a published `resolved_model` / `value` / `display_name`), the effort level, and the
permission mode (`permissionModeLabel` renders a mode this client cannot name VERBATIM). This ticket adds
no parse, no sink and no new consumer of any of them. Every declaration it does add is monotonically
reducing — `min-width: 0` and `overflow: hidden` can only take space away from a label, and
`min(<P>%, var(--space-5))` can never exceed the `var(--space-5)` the row already declares — so no
published string can claim more of the row after this change than before it, at any window width. No
`max-width` bound is touched. The one selector whose blast radius is wider than the row,
`.composer-options-anchor`, is rendered in exactly one place (`ComposerOptionsPanel`) and worn by exactly
the four footer triggers; `ConversationScreen`'s type-ahead row deliberately does not wear it, so the
declaration cannot reach a surface this plan has not reasoned about. **Phase B re-greps that before
shipping** rather than trusting this sentence.

**2. SHOULD FIX — the permission-mode label becomes ellipsizable by row pressure at the 800px minimum,
which `.composer__permission-label`'s own comment refuses to do by `max-width`.** That comment rules:
"ellipsizing `Bypass permis…` would make the one label naming a security posture the one label the
operator cannot read." Under this policy that label CAN be truncated at 800px. It is accepted, with
reasons that are checkable rather than rhetorical: (a) the status quo is strictly worse for the same
concern — today the row's overflow is CLIPPED by `.paired-shell__pane`'s `overflow: hidden`, so the tail
of the row vanishes with no truncation signal at all, where an ellipsis is a visible one; (b) at 800px
there is no arrangement that keeps `Bypass permissions` (~114px) whole beside `Context high: 100%`
(~114px) in a 284px content box without dropping an occupant, which AC2 forbids — so an exemption is
arithmetically impossible, not merely against the ticket's "no number in a single control's rule";
(c) the mode's full name remains in the control's accessible name and in its open menu, and the label's
own 120px bound is untouched; (d) the `min()` cap makes this a no-op at every width from the app's
default upward, so the degradation is confined to the minimum window. If the operator finds the mode
illegible there, the follow-up is a row-level shrink ORDER, not a width in one control's rule.

**3. SHOULD FIX — `overflow: hidden` must not reach `.composer-options-anchor`.** The anchor is the open
options panel's containing block (`position: relative`, panel at `bottom: 100%`), so a non-visible
overflow there would clip the panel out of existence — a control that silently opens nothing. The plan
puts the clip on `.composer__footer-button` (inside the anchor) and `min-width: 0` alone on the anchor;
Phase B keeps that split and the rule's comment states why. Two shipped detectors cover a regression:
`e2e/composer-options-clamp.spec.ts` (which also proves the panel's resting position is unaffected — it
measures the anchor's LEFT edge, which no declaration here moves) and every menu spec that opens a panel.
Related, and checked rather than assumed: a `:focus-visible` outline is not clipped by the focused
element's own `overflow`, so the keyboard-focus ring on these controls stays visible — and it becomes
MORE visible, since the row no longer overflows into the pane's clip.

**4. Accepted residual — a hostile daemon can shorten every label in the row, but cannot remove a
control.** With a maximally long published family and level, the four labels compress to roughly two
characters at 800px. Each control keeps its chevron, its hit target, its accessible name and its menu, and
the bound is the row's own geometry rather than anything the daemon chooses; the context reading cannot be
touched at all (§ Design 3). This is a strict improvement on the shipped behaviour, where the same input
pushes the reading and the attach button off the pane entirely — a remotely triggerable denial of a UI
affordance, which is the defect this ticket exists to remove.

**Categories with no finding, and the design decision that makes each one inapplicable:**

- **Tokens, secrets, credentials** — the change is three declarations in a stylesheet. No token is read,
  stored, compared or rendered; the row displays no secret. The detector's `SESSION_ID` and token FIGURES
  are the non-secret display/routing literals every sibling spec already seeds.
- **File / storage operations** — no path is constructed, no file is read or written, nothing is
  persisted. There is no code path to traverse, race or truncate.
- **Inter-process / Electron attack surface** — no IPC channel, no `contextBridge` addition, no protocol
  handler, no navigation guard, no `webPreferences` change. The detector's `app.evaluate` on
  `BrowserWindow.setSize` is Playwright's main-process handle in a test process, not a shipped capability,
  and unlike `e2e/composer-options-clamp.spec.ts` this spec does not call `setMinimumSize` at all — it
  narrows to 800, which is AT the shipped floor — so it cannot leave the window's minimum mutated by a
  mid-drive failure. AC2's `getMinimumSize()` assertion is the detector for a future edit that starts
  borrowing it.
- **Cryptographic primitives** — no randomness, no hash, no key, no comparison. The ticket adds no
  executable code at all.
- **Network & I/O** — no socket, no frame cap, no timeout, no reconnect. The `session_settings` and
  `model_list` frames the detector seeds are inbound fixtures decoded by the shipped codec exactly as
  production decodes them.
- **Error messages, logs, telemetry** — no log call and no error message is added. The detector's
  diagnostics are numeric (`scrollWidth`, `clientWidth`, pixel geometry) and counts, so no published
  string reaches a failure message; Phase B keeps them that way.
- **Concurrency** — no async work, no listener, no timer, no shared state. The spec's waits are
  Playwright's auto-retrying assertions with bounded timeouts, and the drive is READ-ONLY: it opens no
  menu and sends no `set_session_settings`, so it exercises no write path.

## Revisions

### 2026-09-08 — measured at HEAD, and one thing the plan said it would not do

**Open questions 1 and 2, resolved.** A percentage `column-gap` does resolve against the row's own content
box in this Electron's Chromium; the detector's launch-width rhythm assertion measures the design's 20px
and passes, so the `cqi` fallback is not needed. `<P>` is **3.5%** — the smallest tenth of a percent that
still reaches the `var(--space-5)` ceiling at the app's own default 1100px window, whose footer content box
is 584px (20 / 584 = 3.43%). The ceiling therefore holds from a 1088px window upward, and the row is
unchanged at every width from the shipped default up.

**Open question 3, resolved by measurement rather than by arithmetic.** At 800×600 with the detector's
worst-case seeds, `.composer__footer` measures `clientWidth` 316 and `scrollWidth` 316 — the row fits
exactly — and its six items measure: Actions 15.2, permission 34.9 (label 22.9), model 35.1 (label 23.1),
effort 20.2 (label 8.2), reading 117.9 (whole, as § Design 3 requires), attach 11.0, with five ~9.9px gaps.

**The gap rule is NOT required for AC1, and it stays anyway.** Mutation-tested: with `column-gap` reverted
to a flat `var(--space-5)` and the two `min-width: 0` declarations kept, the detector still passes — the
truncation chain alone is enough to make the row fit. What the flat gap costs is the row's legibility, and
that is measurable too: at the same width it draws Actions 7.9, permission 34.9 → 18.3 (label 6.3), model
→ 18.3 (label 6.3) and effort → 10.5 with a label of **exactly 0px**. So the proportional gap is what
turns "every label is an ellipsis" into "every label keeps two or three characters", and 35% of a 284px
content box spent on whitespace is the row's largest single anomaly whether or not an assertion can see it.
Kept, with the measurement recorded here rather than an assertion invented to protect it: the honest
detector for a legibility difference is the numbers above.

**A markup change the plan said it would not make: `.composer__actions-label`.** The measurement above
found the Actions trigger at 15.2px for content that wants 56px — its word HARD-CLIPPED with the chevron
clipped off the end entirely, while its three siblings ellipsized and kept theirs. The cause is that this
trigger's label is a bare text node, so it is an anonymous flex item: no selector can reach it, it cannot
carry a truncation chain, it refuses to shrink below its min-content, and `.composer__footer-button`'s
`overflow: hidden` takes the glyph instead. This is a regression **this ticket introduces** (nothing in the
row could shrink before it), not a pre-existing defect to file elsewhere, so it is fixed here:
`ComposerActionsMenu` wraps `COMPOSER_ACTIONS_LABEL` in a `<span className="composer__actions-label">` and
`conversation.css` gives that class the same `min-width: 0` + `overflow: hidden` + `text-overflow: ellipsis`
chain its three siblings carry — and **no `max-width`**, which is the one line where it differs from them:
they bound daemon-authored text, this bounds a client-owned constant, and a number here would be the
"number in a single control's rule" the whole policy exists instead of. `ComposerActionsMenu.test.tsx`'s
exact-equality assertion on the trigger's announced content moves to the wrapped form and stays an exact
equality. The detector gains the row-wide statement of the invariant: every trigger's own
`scrollWidth <= clientWidth` at 800, so compressing a control never costs it a part of itself.

**Re-audited against § Security review, no verdict change.** The added element renders
`COMPOSER_ACTIONS_LABEL`, a client-owned constant, into the same text position it already occupied — no new
sink, no daemon-authored string, and no new bound to defend. The added rule is the third monotonically
reducing declaration in the policy (finding 1): it can only take width away from a label, never grant it.
Finding 2's residual is unchanged, and finding 3's split still holds — the clip stays on
`.composer__footer-button` and never reaches `.composer-options-anchor`;
`e2e/composer-options-clamp.spec.ts` and `e2e/composer-actions.spec.ts` both re-run green, which covers the
open panel's placement and the accessible name the Actions e2e locator matches.
