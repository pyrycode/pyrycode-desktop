# #1181 — the workspace row's plus names itself in a pill

The plus #1178 and #1179 put on every workspace row is a bare 16px glyph with an `aria-label` and nothing
a pointer can read. This slice gives it the name pill #1172 already minted one level down the tree: the
same class, the same treatment, the same trigger shape, fired from this control instead.

A short plan (§ A4): one `<span>`, one CSS rule, no new type, no new state, no new failure mode. What is
not routine here is the shared class's reach into a shipped spec, recorded under **Change** below.

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` → `WorkspaceRow` — the plus this appends a child to,
  and `create.label` (the `WorkspaceCreateControl` field) which is already the single definition the
  ticket asks for: the `aria-label` and the pill both read it, so the two cannot drift by construction.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__workspace-create` — the control's
  block. `position: absolute` makes it a containing block; `top: var(--space-1)` + `height: var(--space-5)`
  is the 20px box inside the 28px head row, which is the whole of the geometry below.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__control-name` and its trigger rule —
  #1172's pill, reused verbatim, and the four-selector trigger this ticket adds two selectors beside.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__workspace-head` (`position: relative`,
  the row the control pins to) and `.channel-list` (`overflow-y: auto`, so it clips on **both** axes —
  which is why the criterion is containment and not `toBeVisible()`).
- `docs/specs/architecture/1172-row-control-name-pill.md` — the placement, the `display`-not-`opacity`
  ruling, the `pointer-events: none` reason, and the measured finding that the **band** assertion is the
  placement detector while containment is the criterion. All four carry over unchanged.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → `createTagsIn`, `CREATE_CHAT_MARKER`,
  `CREATE_CHANNEL_MARKER`, `WORKSPACE_ROW_MARKER`, `WORKSPACE_HEAD_MARKER` — AC2's "markers unchanged".
  `createTagsIn` slices the control's **opening tag** only and every marker is an `aria-label=` or
  `class=` run, so appending a text-node child leaves all of them byte-identical.
- `e2e/sidebar-control-name-pill.spec.ts` → its `pills` locator — the one shipped consumer this reuse
  reaches. See **Change**.
- `e2e/sidebar-create-channel.spec.ts` — the two-tree seed idiom and its `getByRole` name queries, which
  an `aria-hidden` child cannot perturb.
- `e2e/sidebar-workspace-create.spec.ts` — the Chats plus's shipped geometry drive, which reads the
  control's own box and its glyph's; an out-of-flow child changes neither.
- `docs/knowledge/features/composer-attach-name-pill.md` — #1265's lesson that a criterion-keyed grep
  (`toContainText` / `getByText` / `hasText` / `toHaveText`), not a symbol-keyed one, is what surfaces the
  specs a new text node collides with. Run below.

## Design source

**Figma:** Pill https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6617 on the workspace row
https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=106-3160 (Hover `399:1060`, plus `399:1065`)

The Pill is the same single-line box #1172 shipped: dark navy ground behind a 6px corner, light blue ink at
body-small regular, 4px above and below and 8px each side, hugging its text with no wrap. The Hover
variant of the workspace row (399:1060) draws no tooltip of its own — it is the Idle row plus its two
trailing controls revealed, and the Pill is the treatment this ticket borrows onto the plus among them.

**The export's two colours are transposed and neither hex is used**, exactly as #1172 records: the node
prints `#cfe4ff` under the name `primary-container` and `#134a74` under `on-primary-container`, the
reverse of `tokens.css`. This ticket adds no colour declaration at all — it reuses the shipped class — so
the trap is already closed and its detector is `e2e/sidebar-control-name-pill.spec.ts`'s two constants.

## Change

**The markup.** `WorkspaceRow`'s plus gains one child, **appended after its `</svg>`** — #1172's shape,
for its reason: `ChannelList.test.tsx` asserts the glyph's opening run whole, and a child after the
closing tag leaves it byte-identical, while a child in front of it would redden that assertion.

```
<span className="channel-list__control-name" aria-hidden="true">{create.label}</span>
```

`create.label` and nothing else. The two trees hand down `CREATE_CHAT_CONTROL_LABEL` and
`CREATE_CHANNEL_CONTROL_LABEL`, so the pill reads "Create chat" under Chats and "Create channel" under
Channels off the same constant the `aria-label` carries — the lift the ticket asks for is already the
shape `WorkspaceCreateControl` bundles, and no new constant is introduced. `aria-hidden` is
belt-and-braces (a button's `aria-label` already overrides its child text for the accessible name), which
is why the unit tier pins it: nothing else in either tier would redden if it were dropped.

**The trigger.** Two selectors, placed beside the control's own reveal rather than beside #1172's rule,
because that is where a reader looking at this plus already is:

```
.channel-list__workspace-create:hover  .channel-list__control-name,
.channel-list__workspace-create:focus-visible .channel-list__control-name { display: block }
```

The control's own `:hover` and never the head row's — AC1's "hovering the row's label shows nothing" is
exactly that scoping, and it is deliberately a *different* scope from the glyph's own reveal
(`.channel-list__workspace-head:hover`), which fires from the row so the glyph is already there when the
pointer arrives at it. `:focus-visible` and not `:focus`, matching the control's opacity rule directly
above it, so the keyboard case cannot half-fire. No new CSS *properties*: the pill's whole drawing is
`.channel-list__control-name`, untouched.

**The geometry follows from the control block and needs no new number.** The pill is `position: absolute;
right: 0; top: 50%; translateY(-50%)` in its containing block, which here is the plus itself
(`position: absolute`, so it is one). The plus is a 20px box at `top: var(--space-1)` in a 28px head row,
so its centre is 14px down — the head row's own centre. The pill is 24px tall (`--space-1` + the 16px
body-small line + `--space-1`), so it spans 2…26 of the row's 28 and **sits inside the row's own band**,
the property that makes AC2's containment hold at every scroll position rather than at the one a test
visits. `right: 0` pins it to the plus's right edge, which is the head row's right edge, which is
`.channel-list`'s content right edge — so it grows **leftward**, reaches neither horizontal edge, and adds
no scrollable overflow (an out-of-flow box contributes it only rightward or downward).

The cost, stated as #1172 stated its own: while the plus is hovered its pill covers the trailing ~90px of
that workspace row's label. Accepted — the pill is up only while the pointer sits on a 20px control.

**`pointer-events: none` is what keeps the shipped clicks working**, and it is already on the class. The
pill fully covers the 20px plus (it is wider and right-aligned to it), so without it every drive that
clicks the plus — `sidebar-workspace-create.spec.ts`, `sidebar-create-channel.spec.ts` — would have its
hit test swallowed by a `<span>` that appeared as the pointer arrived. It also stops the pill hovering
itself, so there is no feedback loop with its own trigger.

**⭐ THE SHARED CLASS REACHES ONE SHIPPED SPEC, AND IT IS A COUNT.**
`e2e/sidebar-control-name-pill.spec.ts` locates `page.locator('.channel-list__control-name')`
**document-wide** and asserts `toHaveCount(rowCount)` plus a whole-set `display` read. Its render draws a
workspace group in each tree, so this ticket adds two elements wearing that class and takes the count from
41 to 43 — and worse, `pills.first()` would stop being the first row's Rename pill and become the Channels
tree's *workspace* pill, because the workspace head precedes its group's rows in document order. That is a
silent re-aiming, not just an arithmetic break.

The fix is one locator, scoped to say what it already meant: `.channel-list__row .channel-list__control-name`.
The row controls live inside `.channel-list__row`; the workspace plus does not, so the scope restores every
count and every `first()` / `last()` to exactly the element it was written for, with no assertion changed
and no expected value moved. Its sibling locator on line-adjacent `highRow` is already row-scoped. This is
the only consumer: `grep -rn "control-name" src/ e2e/` returns that spec, the two unit-tier adjacency
assertions (which are `toContain` on a substring and unaffected), and the production sites themselves.

**Collision check on the new text node** (#1265's rework lesson, keyed on the criterion). `getByText` /
`toContainText` / `hasText` / `toHaveText` across `e2e/`: every `.channel-list`-scoped one is an
`exact: true` match on a daemon-derived row title (`Seeded channel`, `Scratch discussion`,
`Original channel`, `Dedicated channel`) or on `.channel-list__workspace-label` /
`.channel-list__row-open`, none of which the pill is or equals. `sidebar-create-channel.spec.ts`'s
`toHaveText(CREATE_CHANNEL_NAME)` is scoped to `.create-channel__title`, the dialog's own heading. The
`getByRole('button', { name: … })` queries in both plus specs are unmoved: `aria-label` wins over child
text and the child is `aria-hidden`. No other spec is edited.

**No ADR.** This adds no decision the token layer and #1172's page do not already record.

**No state, no async, no error path, no log line.** Two pseudo-classes are the whole mechanism, and the
only thing a log could carry is which workspace the pointer is on — a daemon-derived `cwd`, which ADR 0007
and `CLAUDE.md` both forbid in a log. The pill's text is a client-owned compile-time constant in every
caller; the workspace label reaches it in none, on the four-sink rule `WorkspaceRow` already states.

## Testing strategy

**Unit — `ChannelList.test.tsx`**, the only tier that can assert adjacency (`environment: 'node'`, static
render). Two additions in the #1181 describe, both against the shipped two-tree fixture:

- each tree's plus emits its pill as the control's **last child**, asserted as the closing-tag adjacency
  `</svg><span class="channel-list__control-name" aria-hidden="true">Create channel</span>` (and the Chats
  twin), so a pill that drifted in front of the glyph or out of the button fails rather than passing on a
  substring;
- the drift guard, counted per tree: one `aria-label="Create channel"` and one `>Create channel</span>` in
  the Channels slice, the Chats pair in the Chats slice — which is what says the pill text and the
  accessible name come off one constant.

AC2's "markers unchanged" needs no new test: `createTagsIn`, `WORKSPACE_ROW_MARKER`,
`WORKSPACE_HEAD_MARKER` and both `aria-label` counts are asserted by the shipped #1178/#1179 describes and
must stay green untouched. That they do is the assertion.

**E2E — `e2e/sidebar-workspace-plus-name-pill.spec.ts`** (new, fake transport). A dedicated file rather
than an addition to #1172's, on #1179's precedent: that spec owns the row controls, must pass with its
assertions untouched, and needs a seed this drive cannot use. One launch, one continuous drive; every
absence assertion placed **after** a positive auto-waiting read of the same gesture's own effect.

- *The seed.* `launchPairedApp` reaches the thread by clicking a single **strict**
  `.channel-list__row-open`, so both trees cannot be populated at launch. One unpromoted row launches
  (Chats group, one plus); a `conversations` envelope pushed after launch (`daemon.pushFrame`, #1172's
  idiom — the inbound arm dispatches on the inner frame's `type` with no correlation-id match) carries
  that row plus one promoted one, minting the Channels group and its plus. Two pluses, two pills,
  different names.
- *Resting:* both workspace pills mounted **and** hidden — a count and a hidden-ness, since an absent pill
  satisfies `toBeHidden` vacuously. Read with the pointer parked on the actions cluster, not on a row.
- *Hover the Channels plus:* its pill visible, text exactly `Create channel`, the other still hidden.
- *Hover the Chats plus:* text exactly `Create chat`. Both names read as operator literals, not imported
  from the screen — an imported constant would agree with itself if both moved together.
- *The band and the criterion, at scroll top on the Channels tree's workspace row* (AC2): the pill's box
  is the drawn 24 tall, its vertical centre coincides with the head row's, its right edge with the head
  row's right edge — and it lies inside `.channel-list`'s own box. The band is what makes containment true
  on rows no test visits; containment is the criterion. Read while the pill is up: the sidebar is still
  400px and `.channel-list`'s `scrollWidth` no greater than its `clientWidth`.
- *Scoping:* hovering `.channel-list__workspace-label` shows no pill — ordered after a positive read, so
  it measures the trigger's scope rather than a pill that never showed. A reveal hung off the head row's
  hover (the scope the glyph's own reveal uses, and the natural thing to copy) fails here.
- *Leaving:* pointer off the list, both pills hidden.
- *Keyboard:* focus the workspace disclosure button, press `Tab`, assert the plus is focused and its pill
  shows; blur hides it. `Tab` and never `locator.focus()` — `:focus-visible` is Chromium's
  keyboard-modality heuristic and a programmatic focus after a pointer interaction does not match it, the
  reason `sidebar-row-geometry.spec.ts` already records for this control's opacity reveal.
- *The click still lands:* the plus clicked with no prior hover opens its dialog — the path the shipped
  specs take, and the one a pill that swallowed the hit test would break.

**Nothing typechecks `e2e/`** (no tsconfig includes it, Playwright strips types with esbuild), so the new
spec is typechecked by hand with an ad-hoc `tsc --noEmit` and read by filename. Real-daemon and
real-claude tiers are untouched.
