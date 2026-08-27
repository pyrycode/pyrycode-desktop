# #690 — Redraw the session boundary as the inline session-reset separator

Restyle + copy change. No new plumbing, no new exported types, no store change. The
`sessionBoundary` item, the `timelineBridge` decode and the `threadTimeline` fold are all untouched.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=119-3843

Frame `119:3843` "Session reset" (741×16) is a single horizontal row: `display: flex`, `align-items:
center`, `gap: 12px`, holding rule → label → rule. Both rules (`119:3846`, `119:3841`) are `flex: 1 0
0; height: 1px; min-width: 1px` bands in `Schemes/Inverse Primary` **at 60% opacity**; the label
(`119:3844`) is M3 `body/small` (Roboto 400, 12/16, tracking 0.4) in `Schemes/Primary`, centred.

**Two things read off the node that the ticket's measurement table does not carry — both verified, both
load-bearing:**

1. **The rules are at `opacity: 0.6`.** `get_design_context` emits `opacity-60` on both rectangles. The
   table lists the variable's colour, not the composited result. Keep the `opacity: 0.6` that
   `.session-delimiter__rule` already carries — it is the Figma, not a leftover from #286.
2. **Figma's *generated code* prints the two hexes swapped relative to its own variable names**
   (`--schemes/inverse-primary, #9dcbfc` on the rules, `--schemes/primary, #32628d` on the label). That
   fallback is the light-scheme resolution; in an M3 dark scheme Inverse Primary *is* the light scheme's
   Primary, which is exactly why the pair looks transposed. `get_variable_defs` on the node is
   authoritative and agrees with the ticket and with `tokens.css:24`:

   | Figma variable | Value | Token |
   | --- | --- | --- |
   | `Schemes/Primary` | `#9dcbfc` | `--color-primary` (exists, `tokens.css:24`) |
   | `Schemes/Inverse Primary` | `#32628d` | `--color-inverse-primary` (**new**) |

   Do not "fix" the assignment against the generated snippet. Label → `--color-primary`; rules →
   `--color-inverse-primary`.

"Rounded" in the ticket's table is a no-op at 1px tall (radius 0.5px is sub-pixel). Skip it; declare no
`border-radius`.

## Files to read first

Codegraph is not indexed for this repo (`codegraph_context` returns *CodeGraph not initialized*, still
true 2026-08-27), so this list is grep/Read-derived.

- `src/renderer/src/screens/conversation/sessionBoundaryViewModel.ts:1-97` — the whole file. Everything
  above `labelFor` is deleted; `labelFor` + `sessionBoundaryTitle` collapse into one function.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:628-644` — the `sessionBoundary` arm of
  `TimelineRow`. The JSX block and its comment are both rewritten.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:509-565` — `Timeline` and `TimelineRow`
  signatures + the `#286` comment paragraphs that exist only to justify the `now` prop.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:228-240` — the container's single
  `<Timeline>` render site, plus the comment at :232 naming *"Timeline's `{ items, now }` contract"*.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:200-211,317-336` — proof that the
  container's own `now` (`:211`) **stays**: the two detail sheets (`:324`, `:335`) read it for their
  `formatLastActivity` line. Only the `Timeline` hand-off goes.
- `src/renderer/src/screens/conversation/conversation.css:1293-1321` — the three rules being replaced.
- `src/renderer/src/screens/conversation/conversation.css:233-241` — `.conversation__thread`: a flex
  column with `gap: var(--space-3)`. **This is the arithmetic input for the 16px clearance** (§ Clearance).
- `src/renderer/src/screens/conversation/conversation.css:15` — `.conversation` sets `font-family:
  var(--font-sans)`. Read together with the comments at `:563` and `:709` ("*No font-family — --font-sans
  inherits from .conversation*"): this repo declares `font-family` only where a UA rule would win.
- `src/renderer/src/screens/conversation/conversation.css:131-136` — the house idiom for the `<p>` margin
  reset, comment included. `.session-delimiter__title` is missing it today.
- `src/renderer/src/theme/tokens.css:18-30` — the primary colour group; the insertion point for
  `--color-inverse-primary`.
- `src/renderer/src/theme/tokens.css:88-93,104-114` — `--text-body-small-*` (already 12 / 16 / 0.4 / 400)
  and the space scale. `--space-1` = 4px, `--space-3` = 12px, `--space-4` = 16px.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:989-1046` — the four existing row
  tests, including the `<b>x</b>` escaping fixture at `:1027`. Updated, never deleted.
- `src/renderer/src/screens/conversation/sessionBoundaryViewModel.test.ts:1-109` — the whole file; one
  describe block goes, the other is rewritten.
- `e2e/thread-scroll-pin.spec.ts:120-135,298-302` — the `.session-delimiter` locator. **Read to confirm
  no edit is needed**, then leave it alone: the class name survives, so does the row count of 1.

## Context

#286 shipped the boundary row from the mobile-derived design (Figma `16-35`): a monospace title line
stacked above a full-width rule, with a long-form relative time appended after an em dash. The desktop
chat screen redraws it as one 16px row — hairline, centred label, hairline — and the operator has taken
two copy decisions (2026-08-22): the reason stays in the words (`clear` and `idle_evict` must read
differently, so the Figma's single "Session reset" sets the shape, not the vocabulary), and the relative
time goes (every message above and below already carries its own timestamp).

`workspace_change` is dead on the wire — the daemon's `toWirePayload` emits only `clear` and
`idle_evict` and nulls `workspace_cwd` unconditionally. The branch stays (the wire type admits the
reason and `assertNever` depends on it) and its copy is unchanged from #286. Spend no design effort
there.

## Design

### 1. `sessionBoundaryViewModel.ts` — delete the time, collapse the label

Delete `formatSessionBoundaryTime` and the constants that exist only to serve it (`MS_MINUTE`,
`MS_HOUR`, `MS_DAY`, `MS_WEEK`, `MONTHS`). Verified by grep: the only references anywhere in `src/` are
its own test file and `sessionBoundaryTitle`. Rewrite the module header — its current justification
("a LONG-FORM sibling of `formatLastActivity` … the delimiter's locked Figma copy is the long form")
dies with the function.

Delete the private `labelFor` and make the exported entry point the switch itself. Keeping a
one-line pass-through wrapper over a private helper is dead structure once the time is gone.

```ts
/** The reason-appropriate delimiter label. Exhaustive over SessionBoundaryReason (assertNever default). */
export function sessionBoundaryTitle(item: SessionBoundaryItem): string
```

- `clear` → `Session reset`  *(was `New session`)*
- `idle_evict` → `Session reset after idle`  *(was `New session after idle`)*
- `workspace_change` → `` `Workspace changed to ${item.workspaceCwd}` ``, degrading to
  `Workspace changed` when `workspaceCwd` is `null`  *(unchanged)*

Keep `assertNever` and keep the `SessionBoundaryItem` `Extract` type. Keep the apostrophe-free
constraint on all copy (`renderToStaticMarkup` escapes `'` → `&#x27;`, which complicates assertions) —
the new copy already satisfies it.

`item.occurredAt` becomes unread by this module. It **stays on the `ThreadItem`** — the store owns it
and no store change is in scope. Do not touch `threadTimeline.ts`.

### 2. `ConversationScreen.tsx` — new markup, `now` removed from the Timeline subtree

The `sessionBoundary` arm becomes rule / label / rule as siblings of one flex row:

```tsx
<div className="session-delimiter">
  <div className="session-delimiter__rule" aria-hidden="true" />
  <p className="session-delimiter__title">{sessionBoundaryTitle(item)}</p>
  <div className="session-delimiter__rule" aria-hidden="true" />
</div>
```

Three invariants carried forward from #286, all still true and all still covered by the tests being
updated: no `data-thread-role` on the row (it is not attributed to assistant/user/tool), the rules are
decorative styled `div`s with `aria-hidden="true"` (not semantic `<hr>`s), and `workspaceCwd` reaches
the DOM only as auto-escaped React children inside the title string — never
`dangerouslySetInnerHTML`, never an attribute, never a URL.

Keep `<p>` for the label (with the margin reset in § 3) rather than switching to `<span>`. Same class,
same house idiom, no churn; the reset is explicit either way and an explicit reset beats relying on an
element's UA default.

**Keep the class names.** `.session-delimiter` is `e2e/thread-scroll-pin.spec.ts:301`'s locator and
`.session-delimiter__rule` is asserted by regex in the unit tier. A rename breaks the e2e tier, which
the unit suite cannot catch.

The `now` removal, all five call sites:

| Site | Change |
| --- | --- |
| `Timeline` props + type | drop `now = Date.now()` / `now?: number`; drop `now={now}` on `<TimelineRow>` |
| `TimelineRow` props + type | drop `now = Date.now()` / `now?: number` |
| `ConversationScreen.tsx:239` | `<Timeline items={items} scrollPin={scrollPin} />` |
| `ConversationScreen.test.tsx` ×4 (`:1001`, `:1016`, `:1027`, `:1038`) | `<Timeline items={items} />` |

The container's own `now` at `:211` **stays** — the two detail sheets read it. Delete the `#286`
comment paragraphs at `:509-512` and `:555-556` (they exist solely to explain the prop) and correct
`:232`'s *"Timeline's `{ items, now }` contract"* to `{ items }`. `scrollPin`'s own comment paragraph
at `:513-518` references `now`'s optionality as its precedent; leave the paragraph, adjust the
back-reference so it does not cite a prop that no longer exists.

### 3. `conversation.css` — the row

Replace `.session-delimiter`, `.session-delimiter__title` and `.session-delimiter__rule` in place.
Declarations below; the rationale for each is in the bullets, and the developer writes the code
comments in the file's house voice.

```css
.session-delimiter {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-1) 0;
}

.session-delimiter__title {
  min-width: 0;
  margin: 0;
  font-size: var(--text-body-small-size);
  line-height: var(--text-body-small-line);
  letter-spacing: var(--text-body-small-tracking);
  font-weight: var(--text-body-small-weight);
  color: var(--color-primary);
  text-align: center;
  word-break: break-word;
}

.session-delimiter__rule {
  flex: 1 0 0;
  min-width: 1px;
  height: 1px;
  background: var(--color-inverse-primary);
  opacity: 0.6;
}
```

- **`flex-wrap` is left at its `nowrap` default, and that is the whole of AC5.** Two siblings with an
  identical `flex: 1 0 0` split the leftover width into equal halves at every container width, with
  nothing to keep in sync — no `width`, no percentage. `nowrap` is what makes "a rule stranded on a line
  of its own" unreachable rather than merely unobserved. State this in the comment; it is the load-bearing
  line of the whole file.
- <a id="clearance"></a>**Clearance is `--space-1`, not `--space-4`.** `.conversation__thread`
  (`conversation.css:233`) is a flex column with `gap: var(--space-3)` = 12px, which already separates
  this row from its neighbours. 12 + 4 = the 16px the AC asks for, and the row's own content box stays
  the Figma's exact 16px (the label's 16px line-height). Writing `--space-4` here yields 28px. Padding
  rather than margin, matching what `.session-delimiter` used before. **Verify the container's `gap` at
  implementation time and put the arithmetic in the comment** — a future change to that gap silently
  breaks this number, and the comment is the only thing that will point at it.
- **The `font-family` declaration is deleted, not swapped.** `.session-delimiter__title` is
  `var(--font-mono)` today; the Figma's body small is Roboto. `.conversation` (`:15`) already sets
  `font-family: var(--font-sans)` and a `<p>` has no UA font-family to fight, so deleting the line
  satisfies the AC by inheritance. Adding `font-family: var(--font-sans)` would work but contradicts
  this file's own stated convention (`:563`, `:709`: *restating a settled value* is the thing those
  comments decline to do). Note the absence in the comment, as `:563` does.
- **`margin: 0` is a fix, not a formality.** `#286` never reset the `<p>` and there is no global `p`
  reset (`index.css` resets `body` only), so the row carries two stray 12px UA margins today. The 16px
  row is unreachable without this.
- **`min-width: 0` on the label.** A flex item's automatic minimum size is its min-content width. The
  legacy `word-break: break-word` (kept from #286) is defined to behave as `overflow-wrap: anywhere`,
  which *does* shrink min-content, so in principle the auto-minimum already collapses — but the property
  being relied on is a compatibility alias whose behaviour is defined by a special-case rule rather than
  by its own name. One declaration buys the guarantee that an unbroken workspace path shrinks and wraps
  inside the row instead of squeezing both rules to their floor and overflowing. Judgment call, called
  out here so review can take it or leave it.
- **`min-width: 1px` on the rules** mirrors the Figma's `min-w-px`; it is what a rule falls back to when
  the label consumes the row.

### 4. `tokens.css` — one new token

```css
--color-inverse-primary: #32628d; /* M3 Schemes/Inverse Primary */
```

Place it in the primary group beside `--color-primary` (`:24`). Comment it the way `--color-on-primary`
(`:26`) is commented: name the Figma variable and the node (`119:3843`) it was read from, and record
that `get_variable_defs` — not the generated snippet's inline fallback — is the source, for the reason
in § Design source. No literal hex may appear in `conversation.css`.

## State + concurrency model

None. `Timeline` and `TimelineRow` are pure props-in / markup-out and stay that way; this ticket
*removes* their one impure input (`Date.now()` defaults). No store slice, no subscription, no async
work, no effect, nothing to cancel. The change strictly narrows two component prop types.

## Error handling

Two degradation paths, both unchanged in behaviour:

- `workspaceCwd === null` on a `workspace_change` (a wire-contract violation — the field is
  `string | null` unconditionally) degrades to the pathless `Workspace changed`, never the literal
  `null`.
- A fourth `SessionBoundaryReason` arriving on the wire is a **compile error** at `assertNever`, which
  is the no-drift guard. Keep it.

The unparseable-`occurredAt` path disappears along with `formatSessionBoundaryTime` — nothing in the
row reads a timestamp any more, so there is no longer a parse to fail.

The untrusted-daemon-string posture is unchanged and is the reason the markup shape above is prescribed
literally: escaped React children only, no raw-markup sink, no attribute, no URL, no filename, no
lookup key. Per the 2026-08-20 operator ruling, the daemon's path is text this row reports and may
render escaped — the client-owned-constant rule does not apply to it.

## Testing strategy

`npm test` (vitest, `environment: 'node'`) + `npm run typecheck` + `npm run build`. `npm run e2e`
unchanged and expected green with no edit.

**`sessionBoundaryViewModel.test.ts`** — delete the `formatSessionBoundaryTime` describe entirely (8
cases) along with the `now` / `isoAgo` helpers. Rewrite the second describe over the reasons:

- `clear` → **exactly** `Session reset`. Assert with `toBe`, not `toContain` — this is AC3's pure-tier
  guard, and only an exact match fails when a time is re-appended.
- `idle_evict` → exactly `Session reset after idle`.
- `workspace_change` with a path → exactly `Workspace changed to <path>`, path verbatim.
- `workspace_change` with `workspaceCwd: null` → exactly `Workspace changed`, never the string `null`.
- One case fixing `occurredAt` at a value that *would* have produced a time under #286 and asserting the
  title is still exactly the bare label — the direct statement that `occurredAt` no longer reaches the
  copy. Drop the old "unparseable occurredAt" case; it no longer describes anything.

**`ConversationScreen.test.tsx`** — update the four existing cases, delete none:

- The structure case: assert **two** `session-delimiter__rule` occurrences (count the regex matches, do
  not just `toContain`), and assert index ordering `rule < title < rule` in the markup. This is the
  unit tier's honest stand-in for AC5 — it cannot measure widths, but it *can* prove the two identically
  classed siblings that make equal halves structural are both present and bracket the label. Keep the
  existing `not.toContain('data-thread-role')`, `threadBubbleCount === 0` and no-cursor assertions.
- The aria case: keep the `/session-delimiter__rule[^>]*aria-hidden="true"/` regex (it still matches),
  and update its copy assertion to `Session reset`. Prefer `toContain('>Session reset<')` over a bare
  substring so a re-appended time fails the assertion.
- The escaping case at `:1027`: fixture and assertions unchanged apart from dropping `now={now}`. This
  is the untrusted-string guard; it must survive verbatim.
- The arrival-order case: drop `now={now}`; assertions otherwise unchanged.
- Delete the `now` / `twoHoursAgo` describe-level consts as their last use goes. `occurredAt` is still a
  required field on the fixture — keep a fixed ISO literal.

**AC5 (equal halves under resize, and the long-path wrap) — settled here, not left to the developer.**
Cover it by **explicit review-by-inspection**, not by a new Playwright spec. Three reasons:

1. The property is a CSS invariant, not a behaviour. Two siblings with an identical `flex: 1 0 0` inside
   a `nowrap` flex row are equal at every width by definition; there is no state, no ordering and no
   timing that could make them diverge. A measurement would assert the flexbox spec.
2. Nothing in this repo's e2e tier resizes a window. `launchPairedApp` sets no viewport, and Playwright's
   `setViewportSize` does not apply to an Electron page — proving the 800px-to-fullscreen half of the
   criterion means adding a `BrowserWindow.setSize` capability to the shared fixture. That is a new
   harness capability, a new flake surface and a larger change than the ticket, bought for one invariant
   with no observed failure.
3. The genuinely fragile part — a long unbroken path wrapping instead of overflowing — is addressed
   structurally by `min-width: 0` + `word-break: break-word` and is visible in five seconds of manual
   inspection.

The reviewer's checklist, to be pasted into the PR description:

- At the 800px minimum and at full screen, the two rules are visibly the same length, with the label
  centred between them.
- Swapping the fixture reason so the label changes width (`Session reset` vs `Session reset after
  idle`) keeps them equal.
- A `workspace_change` with a long unbroken path wraps to a second line **inside** the row, with both
  rules still on the first line and neither pushed onto a line of its own.
- The row's vertical clearance from the messages above and below reads as 16px, not 28px.

## Open questions

- **The rules' 60% opacity.** Kept because the Figma node carries it, but it is absent from the ticket's
  measurement table. If the operator intended the flat `#32628d`, dropping one declaration is the whole
  change. Flagging rather than deciding silently.
- **`--color-inverse-primary` has exactly one consumer.** That is fine for a design token — it names a
  scheme slot, not a use — but it is the first inverse-* token in `tokens.css`, so it sets the precedent
  for how the rest of the inverse group gets named when a later slice needs one.

## Size

**S — no split.** Verified against every red line:

| Red line | This ticket |
| --- | --- |
| > 3 new files | **0 new files** |
| > ~600 LOC total written (prod + tests + helpers + per-branch logs + spec edits) | ~70 lines written, net **negative** — the change is dominated by deleting `formatSessionBoundaryTime`, its 5 constants and its 8 test cases |
| > 5 new exported types / components / interfaces | **0**; two prop types *narrow* |
| > 10 consumer call sites updated simultaneously | **5** (`now`: 1 production, 4 test), all in two files |
| > 5 acceptance criteria of work | **5** |
| ≥ ~10 reject branches in a state machine | **4** (3 reasons + the null-cwd degrade); no state machine, no log calls |

Production `.ts` / `.tsx` files with new or modified content: **2** (`sessionBoundaryViewModel.ts`,
`ConversationScreen.tsx`), plus two CSS files. Under the 5-file commit gate with room to spare. No
rationalization paragraph was needed to reach any of these numbers — none of them is near its line.

**File-overlap check: clean.** `git fetch origin --prune` then a scan of every `origin/feature/<n>`
branch's diff against `main` for the six files this touches returned no overlap. No `blockedBy` set.

The ticket is not labelled `security-sensitive`, so the § 3 security-review pass does not apply. The
untrusted-string posture is nonetheless carried explicitly through § Error handling and the test plan,
because this row renders a daemon-supplied path.
