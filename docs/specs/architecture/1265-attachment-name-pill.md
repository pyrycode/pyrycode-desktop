# #1265 — an attachment tile's file name in a pill on hover and on focus

## Files read

- `src/renderer/src/screens/conversation/ComposerAttach.tsx` → `ComposerAttachmentStrip` (the slot's
  `map`, where the pill becomes the slot's third child), `ComposerAttachmentRemoveButton` /
  `REMOVE_ATTACHMENT_LABEL` (the sibling the pill must not displace, and the docblock that already
  reserves this ticket's tooltip as "escaped CHILDREN, the other half of that same rule"),
  `pendingAttachmentKeys` (the slot's key — the pill adds no identity of its own).
- `src/renderer/src/screens/conversation/conversation.css` → `.composer__attachment-slot` (the
  unclipped `position: relative` wrapper #1264 introduced, which the pill hangs on with no new
  positioning context), `.composer__attachment` (the `overflow: hidden` frame the pill must stay
  outside of), `.composer__attachment-ext` (body-small **emphasized** — the weight the pill must not
  copy), `.composer`, `.composer__attachments`, `.composer-status` (the arithmetic that decides where
  the pill lands), `.conversation__workspace-chip-cwd` (the ellipsis chain the bound follows).
- `src/renderer/src/pairedShell.css` → `.paired-shell`, `.paired-shell__pane` — the shell's 20px
  padding / 20px gap / 400px sidebar, and the pane's `overflow: hidden`, which is the **only** clipping
  ancestor above the strip and therefore the whole of the width bound's derivation.
- `src/renderer/src/screens/conversation/ComposerAttach.test.tsx` → the `ComposerAttachmentStrip`
  describe: `tileCount`, `slots(markup)`'s `startsWith` guards, the `aria-label` enumeration and the
  two hostile-name negatives — three of these are aimed at markup this ticket legitimately changes and
  are re-aimed rather than deleted (see Testing strategy).
- `e2e/composer-attachment-remove.spec.ts` → its launch-and-drive shape, its `push` helper, its
  `labelAt` hit-test probe, and its `stripMarkup` negatives — the last of which this ticket falsifies
  by design and must restate as an attribute enumeration.
- `docs/knowledge/features/composer-attach-pending.md` → the pending-set page: the ref-not-state
  paragraph and the "one fold, two writes" idiom. This ticket touches neither holding — worth stating,
  because it is what makes the change render-only.
- `CLAUDE.md` § Conventions → the 2026-08-20 ruling on daemon text: renderable, escaped and
  length-bounded, but never a raw-markup sink, an attribute, a URL, a filename or a log.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=347-6617 (Pill),
with https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=134-5013 (Input area)
for the tile it hangs off.

A hug-width rounded rectangle: `--color-primary-container` ground, `--radius-xs` (6px) corners, 8px
horizontal and 4px vertical padding, holding one line of M3 body-small **regular** (12/16, 0.4
tracking, weight 400) in `--color-on-primary-container`, `whitespace-nowrap`. The node draws no arrow,
no border and no shadow. Where the pill sits relative to a tile is **not drawn** — the ticket's stated
assumption (above the tile, left-aligned to it, overlaying the status row) is what ships.

**The export's baked hexes are the light scheme and are transposed against their own variable names** —
`bg-[var(--schemes/primary-container,#cfe4ff)]` and `text-[color:var(--schemes/on-primary-container,#134a74)]`,
where `tokens.css` has `--color-primary-container: #134a74` and `--color-on-primary-container: #cfe4ff`.
The rendered screenshot settles it in favour of the **names**: a dark navy ground under light text. This
is exactly the transposition `tokens.css` warns about and that #1262 and #969 each hit; the tokens ship
by name and no hex appears anywhere.

## Context

The strip draws one 45×60 tile per completed upload and neither of its two drawings identifies the file:
an extension label makes two PDFs identical, and a thumbnail makes two screenshots near-identical. The
remove control #1264 added is what makes that dangerous rather than merely vague — the operator can now
take the wrong file back. This slice names the file on hover and on keyboard focus.

Nothing crosses the wire, nothing is stored, no state is added: the pill is a rendered element whose
visibility is two CSS pseudo-classes on an element that already exists. No ADR is warranted.

## Design

### Where it hangs — the slot, and no new positioning context

`.composer__attachment-slot` is already `position: relative` and already declares no `overflow`; it
exists because `.composer__attachment` clips. So the pill is the slot's **third child**, absolutely
positioned against it:

```
<span class="composer__attachment-slot">
  …the tile, unchanged…
  <button class="composer__attachment-remove" …/>
  <span class="composer__attachment-name">…the file name, as children…</span>
</span>
```

**Last, not first**, and that ordering is load-bearing against three shipped assertions rather than a
preference: `slots(markup)[n].startsWith('<span class="composer__attachment"…')` reads each slot's
opening, and `/<\/span><button type="button" class="composer__attachment-remove"/` reads the control as
the frame's immediate successor. Appending keeps both byte-identical. It also puts the pill last in
paint order within the slot, which is what a transient overlay wants.

**Its class shares no whole class token** with `.composer__attachment` (whose closing quote both unit
tests count), `.composer__attach-outcome` or `.composer__attach-progress`. A class selector does not
prefix-match, so no shipped locator, tile count or `toHaveText('PDF')` reaches it — and the pill is
outside the frame, so it contributes no text to the tile either. Nothing is added to the footer.

### The trigger — two pseudo-classes, no JS and no state

`.composer__attachment-slot:hover` and `.composer__attachment-slot:focus-within` each flip the pill from
`display: none` to `display: block`. The slot rather than the tile, for the reason the ticket records:
the remove control is the tile's **sibling**, so `:focus-within` on the tile could never fire from it.
Hover on the slot is geometrically the tile's own box (the slot is the tile's 45×60 exactly), and it
additionally covers the control's 5px overhang, since `:hover` matches every ancestor of the hovered
element.

`display`, not `visibility` or `opacity`: a hidden pill then occupies no accessibility tree entry, takes
no hit test, and reports no bounding box — the last of which is what makes the e2e's "showing" and
"hidden" readings two different kinds of answer rather than one number compared against itself.

`:focus-within`, not `:has(:focus-visible)`. AC1 says focusing the control shows the pill, with no
qualification, and the keyboard operator is the one who needs it; a click that focuses the control is a
click that is about to remove the tile anyway.

**No arbitration between two showing pills.** A pointer hover plus a keyboard focus on a different tile
is the only way to reach two, so the arbitration would be JS state for a case a pointer alone cannot
produce. If two adjacent pills overlap, the later slot's paints over the earlier one's (both are
positioned descendants of `z-index: auto` slots, so painting is tree order) — accepted, not solved.

### The name — escaped children, and nothing else

`{attachment.filename}` as React children of a `<span>`. No `title`, no `alt`, no `aria-label`, no
`data-*`, no URL: the name is untrusted display text (a picker/drop basename of an operator-chosen path,
or a client-minted paste name) arriving over `ipcRenderer.on`, and the sinks CLAUDE.md's 2026-08-20
ruling closes are all attributes. `.bubble__file-name` is the shipped precedent for rendering one as
children, and `REMOVE_ATTACHMENT_LABEL` stays the strip's only accessible name.

No `aria-hidden`. The pill is the only place the name is exposed at all, and `display: none` already
keeps it out of the accessibility tree until it shows — so it enters the tree exactly when a keyboard
operator focuses the control, which is the behaviour AC1 asks for. There is deliberately **no**
`aria-describedby` from the control to the pill: that needs a unique `id`, and the only unique thing to
mint one from is `attachmentId`, which #1262 kept out of the DOM on purpose.

### Geometry — one row up, out of flow

`position: absolute; left: 0; bottom: calc(100% + var(--space-2));`

`bottom` resolves against the slot's 60px box, so the pill's bottom edge sits 8px above the slot's top.
The slot's top **is** `.composer`'s content top (the column's `padding-top` is `--space-2`), so the
pill's bottom edge lands exactly on `.composer`'s border-box top and its 24px height (4 + 16 + 4) is
exactly the 24px `min-height` of `.composer-status` above it. The pill therefore occupies the status
row's bottom 24px — which paints nothing and clips nothing — and clears the remove control's 5px top
overhang by 3px, so the two never touch.

Absolutely positioned, so AC3's second half holds by construction: the pill is out of flow and cannot
change the strip's height or the message box's position, showing or hidden.

`pointer-events: none`. While the pill shows on `:focus-within` the pointer is free to roam, and the
pill sits over the status row; without this it could swallow a pointer event aimed at something there.
It is also a non-interactive overlay in every state, so there is nothing to lose.

No `z-index`, and none is needed: the pill is a positioned descendant, so it paints in the positioned
layer — above `.composer-status`'s in-flow content — with no stacking context to declare.

### The width bound

The chain is `.conversation__workspace-chip-cwd`'s, the untrusted-cwd precedent the ticket names:
`overflow: hidden; text-overflow: ellipsis; white-space: nowrap` plus a `max-width`. Deliberately **not**
`.bubble__file-name`'s, which wraps and whose computed `normal` is pinned by
`e2e/attachment-file-row.spec.ts`. `min-width: 0` is not restated: it is a flex-item declaration and this
element is absolutely positioned, where shrink-to-fit already bounds at `max-width`.

**`max-width: 200px`, derived against the composer's own narrowest width.** At the 800px minimum window
the pane is `800 − 20 − 400 − 20 − 20 = 340px` and `.composer`'s horizontal padding is `--space-3` each
side, so the strip is 316px wide. With no global `box-sizing` reset, `max-width` bounds the content run,
so the pill's border box tops out at 216px — under two thirds of that strip, and comfortably inside the
pane from the first three slot positions (x = 0, 57, 114).

**The residual, named rather than defended against.** A full row at the minimum window wraps after the
slot at x = 228, which leaves 88px of strip plus `.composer`'s 12px padding before `.paired-shell__pane`'s
clip. A 216px pill hung there is cut by the pane. Reaching it needs the narrowest supported window, five
or more pending attachments, a name long enough to fill the bound, and a hover on the row's last tile at
once. The pure-CSS fix is conditional anchoring (`position-try-fallbacks: flip-inline`) and the portable
one is a measured flip in JS; neither is built here, because the failure has not been observed and both
buy a case the operator can already resolve by hovering the tile from a wider window. A smaller bound is
the alternative and is worse: the largest bound that cannot be clipped from *any* slot position is 100px,
which truncates two same-prefix screenshot names to the same string and closes none of the failure this
ticket exists for.

### CSS — one new rule and one selector pair

- `.composer__attachment-name` — the position and the offset above, `display: none`, the ellipsis chain
  and the bound, `padding: var(--space-1) var(--space-2)`, `border-radius: var(--radius-xs)`,
  `background: var(--color-primary-container)`, `color: var(--color-on-primary-container)`,
  `pointer-events: none`, and body-small at `--text-body-small-weight` (400 — explicitly not the
  `-emphasized` 500 that `.composer__attachment-ext` beside it wears). No `font-family`: the composer
  column already resolves `--font-sans`, and restating it is a second place for it to drift.
- `.composer__attachment-slot:hover .composer__attachment-name`,
  `.composer__attachment-slot:focus-within .composer__attachment-name` — `display: block`.

## State + concurrency model

None added. No store slice, no `useState`, no `useRef`, no effect, no subscription, no timer, no async
work and therefore no cancellation path. The pill is a pure function of a prop the strip already has, and
its two states are the browser's own pseudo-classes rather than anything this app holds. The pending
set's two holdings (`pendingRef` and its display copy) are untouched — this ticket does not read, write
or reorder either.

## Error handling

No I/O, no IPC, no parse, no failure mode to type. The filename is carried verbatim with no trim, no
non-empty guard and no truncation in JS: an empty name renders an empty pill (invisible under
`shrink-to-fit` but for its 16px of padding), and an arbitrarily long or hostile one is bounded by CSS
and escaped by React. Truncating in JS would be the wrong layer twice over — it would put a derived
string where the raw one is safe, and it would still need the CSS bound for a name with no break
opportunity.

## Testing strategy

**Renderer (vitest, `renderToStaticMarkup`) — `ComposerAttach.test.tsx`.** The markup and the absence of
the name from every attribute, plus the structural half of AC3:

- One pill per tile, and it is the slot's **last** child — outside `.composer__attachment`. This is the
  detector for the ticket's central trap (a pill inside the clipping frame is laid out exactly where a
  `boundingBox()` says and painted nowhere), and it is a markup fact, so it is provable here and only
  here. Asserted as the closing-tag adjacency `</button><span class="composer__attachment-name">`.
- The name reaches the DOM only as escaped children: the hostile fixture's `<img …>` arrives as
  `&lt;img …&gt;`, `<img` appears nowhere, and **every** attribute value in the strip is enumerated and
  none contains any fragment of the name. The existing `aria-label` enumeration keeps its exact form.
  `title=` and `alt=` stay absent, and `attachmentId` still reaches nothing.
- No hex literal in the markup — the property assertion #863 established, which catches the transposed
  light-scheme pair as well as the intended one.
- Three shipped assertions are **re-aimed rather than deleted**, each because the ticket makes its
  premise false: `not.toContain(filename)` / `not.toContain('passwd')` / `not.toContain('onerror')` in
  "puts nothing of the record in the DOM", and `not.toContain('quarterly'|'secrets')` in "names the
  control with a constant". Each is restated as what it always meant — the name reaches no **attribute**
  — which is strictly stronger than the substring negative it replaces.

**Playwright fake tier — new `e2e/composer-attachment-name.spec.ts`**, one launch, one continuous drive,
`composer-attachment-remove.spec.ts`'s shape, tiles minted by pushing `completed` upload events:

- Two tiles with distinct names. Resting: both pills present in the DOM and **hidden**.
- AC1 hover: hover tile 0 → tile 0's pill visible and reads that file's name, tile 1's still hidden (the
  positive, auto-waiting read that makes the sibling's absence non-vacuous). Computed style pins the
  ground, the ink, the 400 weight, the 12/16 type, the 6px radius and the 4/8 padding.
- AC1 leave: move the pointer off the strip → hidden. Ordered **after** the positive read above, per the
  closing-absence rule.
- AC1 focus: `focus()` the tile-1 control → tile 1's pill visible; `blur()` → hidden.
- AC3 geometry, measured while showing: the pill's box is entirely above the tile's, left-aligned to it
  (`toBeCloseTo`, with #868's `-0` normalisation on any rounded delta compared to `toBe(0)`), its top is
  above `.composer`'s top (it is over the status row), and its whole box is inside `.paired-shell__pane`'s
  — the one clipping ancestor. `toBeVisible()` is used only as the display toggle's reading, never as the
  clip detector, which the ticket rules out and the unit tier answers structurally.
- AC3 layout: `.composer__attachments`'s height and `.composer__row`'s `y` read before hovering and again
  while a pill shows, and equal.
- AC2 on the live DOM: the strip's rendered `outerHTML` carries each name as text, `<img` appears
  nowhere, and every attribute of every element in the strip is enumerated and contains no fragment of
  either name.
- **Nothing reaches the host across the whole hover-and-focus sequence** (§ Security review, Network &
  I/O): the spec-local `buildReplyFrames` capture records every inbound envelope, a baseline is read
  before the first hover and asserted unchanged after the last blur, and the send at the end of the drive
  is the mutation check that the count was ever capable of moving.

`e2e/composer-attachment-remove.spec.ts`'s two `stripMarkup` name negatives are re-aimed the same way as
their unit-test twins — they asserted the name reached no attribute *by asserting it reached nothing at
all*, which this ticket makes false by design. Its `labelAt` probes are unaffected: both sit below the
pill's band and neither hovers.

## Open questions

- **Does the 8px offset actually clear the remove control at every DPI?** The arithmetic says 3px of air.
  Resolved by the e2e geometry read rather than by the stylesheet; if it turns out to touch, the fix is
  the offset on this rule and it lands in `## Revisions`.
- **Does a pill on the strip's last slot get clipped at the minimum window?** Named above as an accepted
  residual rather than an open design question — recorded here so the verifier reads it as a decision.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** **This slice creates the strip's first render sink for an untrusted string**, and
  that is the whole of its security surface — unlike #1264, which added none. The value is
  `MessageAttachment.filename`, arriving over `ipcRenderer.on` on `ATTACHMENT_UPLOAD_EVENT_CHANNEL`. Two
  bounds already stand at that boundary and neither is this ticket's: `sanitizeAttachmentFilename`
  normalises the picker/drop/paste name in the background process, and `driveUpload` emits
  `trimToBytes(file.filename, ATTACHMENT_FILENAME_MAX_BYTES)` on the `completed` event — so "length-bounded"
  in CLAUDE.md's 2026-08-20 ruling is satisfied *before* the renderer sees the string, and this ticket's
  `max-width` is a display bound on top of it rather than the only one. The remaining half of that ruling
  — escaped, and never into a raw-markup sink, an attribute, a URL, a filename, a cache key or a log — is
  what the design turns into React children of a `<span>` and what the tests enumerate. No
  `dangerouslySetInnerHTML`, no `innerHTML`, no `attr()`, no custom property carrying the name.
  **Concrete check carried into Phase B:** the attribute assertion must be an *enumeration* of every
  attribute value in the strip, not a `not.toContain('title=')` pair — a substring negative on attribute
  *names* cannot see a name interpolated into an attribute that is legitimately present.
- **[Tokens, secrets, credentials]** Not applicable by construction: no credential, no device token, no key
  material, no storage of any kind, and no new value retained. `attachmentId` — the host-minted storage
  handle — gains no sink here; #1262's "it stays out of the DOM" is re-asserted rather than relaxed, and it
  is deliberately *not* borrowed to mint an `id` for an `aria-describedby` (see Design).
- **[File / storage operations]** No path is resolved, joined, opened or written, and this is worth stating
  precisely because the new element renders something *shaped* like a path. The name decides only which
  drawing the tile uses (`isImageAttachmentName`) and now what the pill says; every fetch is addressed by
  `attachmentId`, which the predicate never sees. **The trap for the next slice, named:** a name rendered
  in a pill is exactly where a "make it a download link" or a `title`-on-the-anchor follow-up would put the
  untrusted string into a URL. It must not.
- **[Inter-process / Electron attack surface]** No IPC channel, no `contextBridge` member, no
  `ipcMain.handle`, no protocol handler, no `webPreferences`, no navigation. `window.pyry` is dereferenced
  by no new code path — the pill is a pure function of a prop, so the standing rule that a static render of
  the composer touches no bridge survives untouched.
- **[Cryptographic primitives]** Not applicable — no randomness, no comparison against a secret, no key or
  nonce read or derived.
- **[Network & I/O]** Nothing is sent, and the design forecloses it structurally: the pill mounts no `<img>`,
  requests no resource and closes over no sender. **SHOULD FIX, carried into Phase B:** prove it rather than
  assert it in prose — a hover that triggered a fetch would make a pointer movement observable to an on-path
  relay as a timed frame, which is an operator-behaviour leak the content-blind relay should not get. The
  e2e drive therefore reads an envelope baseline before the first hover and asserts it unchanged after the
  last blur, **ordered after** a positive auto-waiting read of the hover's own effect (the recorded
  closing-absence trap) and mutation-checked by the send that follows.
- **[Error messages, logs, telemetry]** Nothing is logged, and this is the category with the sharpest edge in
  this ticket: `attachmentUpload.ts` records its own log discipline as "`DiagnosticEvent` has no field shaped
  to hold a filename or a path", and the renderer's strip emits no log line at all. The pill is the first
  element to *render* the name, which makes it the first place a well-meaning `console.warn('showing pill for',
  filename)` would leak it. None is added, and none should be.
- **[Concurrency]** No async work, no listener, no timer, no `AbortSignal`, no shared state read across an
  `await` — nothing to cancel and nothing that can outlive the mount. Both hover and focus are the browser's
  own pseudo-class matching, so there is not even a handler to leak.
- **[Threat model alignment]** *Malicious/compromised relay*: unreachable — no frame is produced, which the
  Network & I/O assertion above turns into a measured claim. *Hostile daemon response*: the hostile input is
  the filename, handled above; a name of any content is escaped and a name of any length is bounded twice.
  *Renderer compromise reaching the transport*: unchanged — this slice adds no capability to the renderer.
  *Token theft from disk*: not in scope, no at-rest state.
- **[Trust boundaries — display integrity] OUT OF SCOPE:** a filename carrying bidi control characters
  (U+202E and friends) renders reversed, so a hostile name could present itself as a different file in the
  very pill that exists to tell files apart. This is **not introduced here**: `.bubble__file-name` already
  renders the same untrusted string as children with no `unicode-bidi` handling and ships with no rule of
  its own by measurement (#815), so the correct fix is one `unicode-bidi: isolate` decision taken for both
  sinks at once, in its own ticket. Fixing only the pill would be a production edit outside this ticket's
  scope (§ Scope Discipline) and would leave the two filename sinks disagreeing. The derived extension label
  is unaffected — `attachmentExtensionLabel` produces an ASCII-uppercased suffix, not the name.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
