# #722 — redraw the tool row as a full-width bordered box

**Size:** S. Three files, no new files, no `.ts`/`.tsx` production file, no new exported symbol.
**Shape:** a CSS restyle plus one theme token plus one e2e width assertion. **No TSX.** The rendered
markup, the class names and the collapsed prefix stay byte-stable; every existing tool-row unit test
passes unchanged. A diff that touches `ConversationScreen.tsx` has overshot the ticket.

---

## Files to read first

Codegraph is wired but **not indexed** for this repo (`codegraph_status` → "CodeGraph not initialized",
confirmed 2026-08-27, same as the 2026-08-24 probe). Everything below was located by grep/Read; the list
is complete, so no exploratory sweep is needed.

| Path | What to extract |
| --- | --- |
| `src/renderer/src/screens/conversation/conversation.css:1108-1240` | The whole tool-row region — every rule this ticket edits, plus `.tool-row`, `.tool-row--resolved`, `.tool-row--error` and `.tool-row__body`, which it does **not**. |
| `src/renderer/src/screens/conversation/conversation.css:534-566` | `.code-block` (#721) — the exact box treatment being adopted, and the light-scheme-fallback warning on `--color-primary-container`. |
| `src/renderer/src/screens/conversation/conversation.css:642-652` | `.code-block__body` — the precedent for "three quarters of a type quartet from a real step + one component-named line token", and for a sans `letter-spacing` on a mono run. |
| `src/renderer/src/screens/conversation/conversation.css:1552-1575` | `.status-row` / `.status-row:hover` — **the hover answer.** A full-width `<button>` resting on `--color-surface` that hovers to `--color-surface-container`. Same situation, already shipped. |
| `src/renderer/src/screens/conversation/conversation.css:233-241` | `.conversation__thread` — the flex column whose content box *is* "the message column". `.tool-row` is a stretch item of it and is already full width. |
| `src/renderer/src/theme/tokens.css:16-34` | `--color-surface` `#101418`, the surface-container ladder, `--color-on-surface` `#e0e2e8`, `--color-primary-container` `#134a74`. |
| `src/renderer/src/theme/tokens.css:107-115, 145-155` | The `body-medium` quartet, and `--text-code-body-line` — the naming precedent for the one new token below. |
| `src/renderer/src/theme/tokens.css:173-177` | `--radius-xs: 6px`. |
| `src/renderer/src/pairedShell.css:20-22` | The file-family precedent for declaring `box-sizing: border-box` at a call site, with the reason ("index.css sets no global box-sizing"). |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:781-860` | `ToolRow` — read it to confirm the `<button>`/`<div>` fork and that `chipRuns` is shared. **Read only. Do not edit.** |
| `e2e/tool-row-toggle.spec.ts` | The whole spec (136 lines). It already drives pending → resolved → expanded → collapsed on this row; the width assertions bolt onto the states it already reaches. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:354-620` | The tool-row unit tests. Confirm they assert markup and text only — nothing here should go red. |

**Trap:** the line numbers written *inside* `conversation.css` comments (`:943`, `:1029`, `:602`, `:553`,
`:2462`, …) have drifted and are wrong. Trust the class names in those comments, never their numbers, and
do not "fix" them — that is unrelated churn.

---

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4225

The four `Tool use` instances at the foot of the message area (`134:4939`, `134:4940`, `134:4941`,
`134:4942`) are all one box: a full-width row on the thread's own `Schemes/background` fill, a 1px
`Schemes/primary-container` border, a 6px corner, `px 12 / py 8`, `gap 12`, `items-center`,
`overflow-clip`. `134:4939` is the variant this ticket draws — a monospace `Schemes/tertiary` run at a raw
`14px / 16px` (bound to no type style at all), then a `M3/body/medium` run in `Schemes/on-background`.
The third run, the chevron and the expanded body drawn on the other three variants are **held** (#773/#774).

Design-context readback, so the developer need not re-fetch:

| Figma | Value | Token |
| --- | --- | --- |
| `Schemes/background` | `#101418` | `--color-surface` |
| `Schemes/primary-container` | `#134a74` | `--color-primary-container` |
| `Schemes/on-background` | `#e0e2e8` | `--color-on-surface` |
| `Schemes/tertiary` | `#ffb59f` | `--color-tertiary` (already on the rule) |
| radius | `6px` | `--radius-xs` |
| padding | `8px / 12px` | `--space-2 / --space-3` (unchanged) |
| gap | `12px` | `--space-3` |
| `M3/body/medium` | 14 / 20 / 0.25px / 400 | the `--text-body-medium-*` quartet |
| tool-name run | mono, 14px, 16px line, no tracking bound | see § "The 14/16 run" |

Note `134:4939` prints `#134a74` for `primary-container`, which agrees with the dark token — the
light-scheme transposition trap that `--color-inverse-primary` and `.code-block:545-548` warn about does
**not** bite on this one. Don't "correct" it.

---

## Context

`.tool-row` still wears the mobile mock (#218, Figma 16-28): an inline pill that hugs its content, filled
`--color-surface-container`, outlined `--color-outline-variant`, 12px corner, both runs at 12/16. The
desktop design draws it as a full-width bordered box on the thread's own background — the same box
`.code-block` already ships from #721, one row over in the same stylesheet. This ticket adopts that
treatment. Nothing about how the row collapses, expands, picks its headline, lists its inputs or shows its
result changes.

---

## Design

### The width mechanic — the one change with consequences

`.tool-row` is a stretch item of `.conversation__thread`'s flex column, so **the row is already full
width**; only the chip hugs. Two shipped declarations stand in the way, and the ticket is right that both
must be revisited rather than worked around:

1. `.tool-row__chip { max-width: 100% }` — a *ceiling* on a hug-width box.
2. `.tool-row__chip--toggle { box-sizing: content-box }` — held so `max-width: 100%` bounds both branches
   alike. Under `width: 100%` it is exactly backwards: the `<button>` would overflow its row by
   `2×12px` padding `+ 2×1px` border.

**The resolution:** on the base rule `.tool-row__chip` — which reaches *both* branches — replace
`max-width: 100%` with `width: 100%` and add `box-sizing: border-box`. Then **delete**
`box-sizing: content-box` from `.tool-row__chip--toggle`.

Why this and not a flex-based stretch (`flex: 1` / `align-self: stretch`): the chip lives in a container
whose `flex-direction` **flips** between collapsed (`row`) and expanded (`column`). A main-axis remedy
(`flex: 1`) fills the row when collapsed and grows the chip *vertically* when expanded; a cross-axis
remedy (`align-self: stretch`) does the opposite. `width: 100%` is direction-agnostic and is what
`.status-row` and `.unrecognized-row__summary` already use for the same job. It is also the smaller diff.

`min-width: 0` **stays**: it is the flex-item automatic-minimum-size remedy that lets the chip be narrower
than its own min-content, which is what makes the summary's ellipsis reachable at a narrow window.

`overflow: hidden` stays (Figma's `overflow-clip`).

`display: inline-flex` **stays unchanged and is inert**: the chip is always a flex item of `.tool-row`, so
it has always been blockified. `flex` would be the honest keyword now, but the `ToolRow` TSX comment at
`ConversationScreen.tsx:842` names it, and this ticket may not touch TSX. Record the inertness in the CSS
comment rather than stranding a stale TSX comment.

**Both branches end up identical by construction** — same `width`, same `box-sizing`, same `padding`, same
`border`, and `chipRuns` is one shared fragment. A `<button>` carries no UA margin in Chromium, and every
UA property that could differ is already explicitly overridden by `--toggle`. That is AC1's "a resolving
row does not shift", and the e2e below pins it.

### `.tool-row--expanded { align-items: flex-start }` — keep the declaration, replace its reason

The shipped comment calls it load-bearing "because `stretch` would blow the hug-width pill out to the full
row — the thing this ticket now wants." That reason is dead. The declaration is not, and it must **stay**,
for a different reason: `.tool-row__body` is the column's *other* child. Under `stretch` the body would go
full width too, which would stretch `.tool-row__result` and the `.code-block` #780 puts inside it —
a change to the expanded body, which is explicitly out of scope and is #774's. Under `flex-start` the body
stays content-sized inside its own `max-width: 100%`, exactly as `.code-block:555-561` documents.

The chip is unaffected either way, because it now carries its own `width: 100%`.

**Rewrite the comment to say all of that.** Leaving the old sentence in place is the failure mode: it
would read as an argument against the box this ticket just built.

### The rules, as a delta

Only these five rules change. `.tool-row`, `.tool-row--resolved`, `.tool-row--error .tool-row__chip`,
`.tool-row__body` and everything below it are **untouched**.

| Rule | Change |
| --- | --- |
| `.tool-row--expanded` | Comment only. No declaration changes. |
| `.tool-row__chip` | `gap` → `--space-3`; `max-width: 100%` → `width: 100%`; add `box-sizing: border-box`; `background` → `--color-surface`; `border` colour → `--color-primary-container`; `border-radius` → `--radius-xs`. Padding, `display`, `align-items`, `min-width`, `overflow` unchanged. |
| `.tool-row__chip--toggle` | Delete `box-sizing: content-box`. Everything else unchanged. |
| `.tool-row__chip--toggle:hover` | `background` → `--color-surface-container`. |
| `.tool-row__name` | The three sans-derived quartet members move to `--text-body-medium-*`; `line-height` takes the new token below. `flex`, `white-space`, `font-family`, `color` unchanged. |
| `.tool-row__summary` | The whole quartet moves to `--text-body-medium-*`; `color` → `--color-on-surface`. `min-width`, `overflow`, `text-overflow`, `white-space` unchanged. |

**`border` must stay unmentioned on `.tool-row__chip--toggle`, in any form.**
`.tool-row--error .tool-row__chip` retints at specificity (0,2,0) against that rule's (0,1,0) and keeps
winning *only* while the toggle rule stays silent about it. A `border` shorthand there kills the error
accent on every failed row — AC4 going red with no test to catch it. The rule's existing comment already
says so; keep that paragraph.

### The hover fill

Resting was `--color-surface-container` `#1d2024` and hover was `--color-surface-container-highest`
`#32353a`. Resting is now `--color-surface` `#101418`, so the hover value has to move or the step becomes
a three-rung jump.

`.status-row` settles it without a judgment call: a full-width `<button>` that rests on `--color-surface`
and hovers to `--color-surface-container` — this file's own answer to this exact question, already shipped
and reviewed. Take it. `#101418 → #1d2024` is one ladder rung and a visible step, which is what the
"what must survive" note asks for. Cite `.status-row:hover` in the comment so the value has a stated
source rather than a taste.

### The 14/16 run — one new token

The headline's 14/20 is `--text-body-medium` exactly. The tool name's 14/16 is not a pair anywhere in the
scale: both 14px steps (`body-medium`, `label-large`) carry a 20px line, and every 16px line belongs to a
12px or 11px step.

**Resolution: a new line token, `--text-tool-name-line: 16px`, with the size still coming from a real
step.** That is `--text-code-body-line`'s exact shape — added by #721, the ticket this one adopts the box
from, for the identical situation one row over — and its comment is an explicit ruling that borrowing a
line from a step the run shares nothing else with is the wrong move. Borrowing `--text-body-small-line`
here would leave a 14px run wearing half of the 12px step's quartet: a Frankenstein that reads as a
leftover rather than as a decision.

```css
/* tokens.css, immediately after --text-code-body-line */
--text-tool-name-line: 16px;
```

Its comment must record: the tool row's monospace run (#722, Figma node 134:4939); the design binds that
run to no type style at all, so there is no step to read; there is no `--text-tool-name-size`, because the
size still comes from `body-medium`, the step its sibling run takes whole; `--text-body-small-line` reads
16 for a *12px* step and borrowing it would couple this run to a step it shares nothing else with; the
precedents are `--text-code-body-line` above and `--space-bubble-x`.

`.tool-row__name` then takes `--text-body-medium-size / --text-tool-name-line /
--text-body-medium-tracking / --text-body-medium-weight`. The design binds no tracking on that run
(implicitly `normal`); taking `body-medium`'s `0.25px` is deliberate — it is sub-perceptual on a short
mono identifier, it is inside the ±1px convention this file already runs on, the shipped rule already
applied a *sans* tracking (`0.4px`) to this same mono run, and `.code-block__body` does the same thing for
the same reason. Dropping the declaration instead would break the invariant
`.tool-row__chip--toggle`'s comment states — "both child runs set all four explicitly" — and force a
second comment edit for no visible gain.

`--color-tertiary` and `--font-mono` on that rule are unchanged: the design still draws the tool's
identity in tertiary monospace.

---

## What must survive, and why it does

| Behaviour | Why the restyle cannot touch it |
| --- | --- |
| Pending 50% dimming | `.tool-row { opacity: 0.5 }` and `.tool-row--resolved { opacity: 1 }` are not edited. AC3. |
| Pending renders the `<div>` branch | The fork is in `ToolRow`, which is not edited. AC3. |
| Error border | `.tool-row--error .tool-row__chip` is not edited and still outspecifies the base. AC4 — **provided** `border` stays unmentioned on `--toggle`. |
| Single-line ellipsis | `min-width: 0` + `overflow: hidden` + `text-overflow: ellipsis` + `white-space: nowrap` all stay on `.tool-row__summary`. A wider box gives an untrusted string more room; it does not make the geometric bound optional. AC5. |
| A newline in the headline cannot break the row | `white-space: nowrap` collapses `\n` to a space. Unchanged. AC5. |
| The button branch's UA reset | `font-family`, `color`, `text-align`, `cursor` all stay. Only `box-sizing` leaves, and the base rule replaces it for both branches at once. |

---

## Error handling

None. No new failure mode: this is presentation for content already on screen, with no new state, no new
async work and no new daemon-supplied value reaching a new sink. The untrusted string (`toolHeadline`)
keeps the same element, the same class and the same geometric bound; it still reaches only a text node
(`CLAUDE.md`'s "may be rendered, escaped and length-bounded").

---

## Testing strategy

### Unit — `npm test`

**Nothing to add and nothing to change.** The renderer tier is `renderToStaticMarkup` under
`environment: 'node'` — no DOM, no computed style, no `<link>` resolution. It cannot observe a single value
in this diff. The existing tool-row tests in `ConversationScreen.test.tsx` assert markup and text; they
must pass **unchanged**, and a diff that edits one of them means the markup moved, which this ticket
forbids. Do not add a DOM environment; nothing here justifies one.

### e2e — `e2e/tool-row-toggle.spec.ts` (`npm run e2e`)

AC1's "the two branches render at the same width" is a computed value, so it belongs here. The spec already
walks the three reachable states in order, so the assertions bolt onto states it reaches for free — **no
new spec file, no new frame, no new fixture.** (Pending + expanded is unreachable by construction: `body`
is non-null only when `result` is, and the toggle only exists on a resolved row. Assert three states, not
four, and say so in a comment.)

Scenarios to add, in the spec's existing flow:

- After the pending row lands (`<div>` branch, collapsed): the chip's bounding-box width equals the
  `.tool-row`'s. Capture it.
- After `tool_result` resolves the row (`<button>` branch, collapsed): same equality, **and** the width
  equals the pending measurement — that is "a resolving row does not shift", the assertion the whole
  `box-sizing` change exists to make safe.
- After the first `toggle.click()` (`<button>` branch, expanded, inside the column flex): same equality,
  same measurement. This is the one that would go red if `.tool-row--expanded`'s `align-items` were
  changed without the chip carrying its own width.

Notes for whoever writes it:

- Compare against `.tool-row`'s own width rather than deriving the thread's content box. The row is a
  stretch item of `.conversation__thread`'s column and is full width by construction; going through the
  thread's `clientWidth` minus computed padding adds arithmetic that can drift without adding coverage.
- Keep every locator scoped under `.tool-row`, per the comment at the head of the spec (#670's
  strict-mode collisions).
- Widths are floats. Compare with a sub-pixel tolerance rather than `toBe`.
- Follow the spec's secret-hygiene note: bounding boxes and class locators only.

Do **not** add a hover-fill or border-colour assertion. A computed-colour check would pass against any
visible value, so it pins nothing the CSS review does not already read directly, and it would couple the
e2e to a token swap.

### Build

`npm run build` (typecheck + build) must be clean. No `.ts`/`.tsx` production file changes, so a type error
here would mean the ticket overshot.

---

## Open questions

None blocking. Two things deliberately settled above rather than left open, both flagged by the ticket as
the architect's call:

1. **14/16 → a new `--text-tool-name-line`**, not a borrowed `--text-body-small-line`. Reversible in one
   line if review disagrees; the rest of the spec does not depend on it.
2. **`align-items: flex-start` stays on `.tool-row--expanded`**, with a replaced reason. Removing it would
   pull the expanded body's width into this ticket, which is #774's.

The four questions the ticket used to hold — the third run, the chevron, the description-first row and the
expanded body — remain out of scope and are answered on the ticket. Nothing below the chip is drawn here.

---

## Acceptance criteria → where each lands

| AC | Where |
| --- | --- |
| 1 — chip fills the column in every shipped state, both branches equal width | `width: 100%` + `box-sizing: border-box` on `.tool-row__chip`; `content-box` deleted from `--toggle`. Pinned by the three e2e width assertions. |
| 2 — fill, border, corner, gap, both type runs, hover, all tokens | The five-rule delta table + `--text-tool-name-line`. Read by code review against the Design source table above. |
| 3 — pending still 50% opacity, still the `<div>` branch | Untouched `.tool-row` / `.tool-row--resolved` and untouched `ToolRow`. Already asserted by the spec's pending block. |
| 4 — error border still `--color-error` over the new colour | Untouched `.tool-row--error .tool-row__chip`, plus `border` staying unmentioned on `--toggle`. **The one thing code review must check by reading the diff.** |
| 5 — long headline still ellipsizes on one line; a newline cannot break the row | Untouched `.tool-row__summary` geometry. |
