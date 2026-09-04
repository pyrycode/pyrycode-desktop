# #815 — draw the non-image attachment file row in the message bubble

## Files read

Codegraph is not initialized in this repo (`codegraph_*` answers "CodeGraph not initialized" — a hard
error, not an empty result), so this list came from Grep + Read rather than `codegraph_context`. Noted
here as the gap the brief asks be recorded rather than silently worked around.

- `src/renderer/src/store/threadTimeline.ts` → `MessageAttachment`, the `userText` arm of `ThreadItem` —
  the record #1039 shipped and the only source this row draws from. Its contract paragraph decides three
  things for this ticket: `attachments` **absent** means none (`[]` never reaches the store, normalised at
  the producer), `filename` is the operator's own display name, and both fields are plain text under the
  never-HTML constraint.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `TimelineRow`'s `userText` arm,
  `BubbleMeta`, `.bubble__copy-icon` — the mount site, the sibling this row must precede, and the
  inline-SVG idiom (`fill: currentColor`, `aria-hidden`, no shared component, drop a no-op clipPath).
  `BubbleMeta`'s own header already names this slot: "#691/#686's attachment slots will insert themselves
  above this row simply by being written before it."
- `src/renderer/src/screens/conversation/conversation.css` → `.bubble`, `.bubble__meta`, `.bubble__copy` —
  why `.bubble` is deliberately **not** a flex column (the in-progress cursor is a sibling text node), why
  the 12px rhythm is a `margin-top` on the following sibling, and the recorded contrast ruling this row
  inherits rather than reopens.
- `src/renderer/src/screens/conversation/conversation.css` → `.conversation__workspace-chip-pill` /
  `-label` / `-cwd`, and `.code-block__header`'s "No `min-width: 0` — that is a flex-item remedy and this
  is a block box" — the file's existing vocabulary for a flex row with a fixed lead and a shrinkable text
  run. This ticket takes the same two declarations for the opposite outcome (wrap, not ellipsis).
- `src/renderer/src/theme/tokens.css` → `--color-inverse-primary` (`:25`, with the transposition warning),
  `--text-body-small-*` including `-weight-emphasized: 500` (`:159`), `--space-3`.
- `src/renderer/src/screens/conversation/composerSend.ts` → the `taken` read and the empty-normalises-to-
  absent comment — confirms a rendered item can never carry `[]`, and that the list is in upload-completion
  order with no display opinion attached.
- `src/renderer/src/screens/conversation/ComposerAttach.tsx` → `useAttachmentUpload`'s pending ref — names
  this row as one of its two consumers and confirms nothing else renders the pending set.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → the #969 meta-row `describe`
  (`META`, `TIME_SLOT`) and the `userText` byte-string pins at `:1259` / `:1661` — the two assertions that
  constrain where this row may be inserted, and the count-assertion idiom for "this row renders nowhere
  else".
- `docs/knowledge/features/conversation-shell-message-bubble.md` § "What stays untouched" / § "Testing" —
  the lesson that carries into this ticket: the queued row and the `MessageBubble` residue reuse
  `.bubble--user` but render **no** `BubbleMeta`, and the way that was proved is a **count** over the whole
  markup rather than a per-string absence. This row takes the same posture and the same proof shape.
- `e2e/fixtures/bubbleText.ts` → `bubbleTextExactly` — an **anchored whole-bubble** matcher used by six
  specs. Read to confirm the hazard direction: no existing spec seeds an attachment, so this ticket reddens
  none of them; the constraint is that the *new* spec must not reach for this helper.
- `e2e/composer-attach.spec.ts` → the `app.evaluate` stub that pushes an `AttachmentUploadEvent` on
  `ATTACHMENT_UPLOAD_EVENT_CHANNEL` — the only route from a fake-tier spec to a settled attachment, and the
  standing rule it observes (a fake-tier spec may stand in for the *sender*, never for the event shape).

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4605 (the file field), inside
https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=121-3860 (the bubble).

A single horizontal row, vertically centred, 12px between two items: an outlined document glyph with a
folded top-right corner, 45×60, and the filename to its right in body-small. The extension — `PDF` in the
drawing — is overlaid on the glyph, top-aligned across its lower half in a 44px centred slot, at body-small
*emphasized*. Both runs and the glyph's stroke are the one colour, `Schemes/Inverse Primary` #32628d.
Inside the bubble the row sits under the message text and above the meta row, `--space-3` clear of each.

**Two reads taken off the file rather than off the export, both confirmed against the render:**

1. **The glyph is a STROKE, not a fill.** The exported SVG is `fill="none"` with `stroke="#32628D"`, and the
   screenshot is an outline. The layer name `file-solid-full 1` is the trap the ticket flags, and it has a
   second edge the ticket did not catch — see § Deviation from AC3 below.
2. **The bound variable is `Schemes/Inverse Primary`.** `--color-inverse-primary`, never `--color-primary`.
   The meta row directly below already resolves the same variable the same way.

## Context

#1039 landed the missing half: a `userText` timeline item now carries the `MessageAttachment[]` its send
consumed. Until then there was no name to draw. This ticket draws the row for a settled, non-image
attachment; #816 makes it a control and #868 draws the image case into the same slot.

The drawing is an *assistant* bubble, but the mount is the **`userText` arm only**, and deliberately: an
assistant-produced file cannot reach the window at all (`MessagePayload` carries no attachment field and
there is no list verb), so `attachments` can only ever describe files this client minted itself. Building an
assistant-side mount would be building for a wire change nobody has filed.

**No ADR is warranted.** Every decision here is either a restatement of an existing one (ADR 0003's
token discipline, ADR 0006's state placement, the 2026-08-20 daemon-text ruling) or a local geometry choice
whose reasoning belongs in the CSS comment beside it.

## Design

### Where it attaches

Each attachment renders as its **own direct child of `.bubble`**, written between the message text and
`<BubbleMeta>` in the `userText` arm of `TimelineRow`. No wrapper element.

That is not a shortcut, it is the shape `.bubble` already dictates. `.bubble` is deliberately not a flex
column, so the 12px rhythm in this box is expressed as a `margin-top` on the *following* sibling —
`.bubble__meta` already carries exactly that. Giving each file row the same `margin-top` makes the whole
sequence (text → file → file → meta) fall out at 12px with no wrapper, no gap property, and no second
rhythm mechanism to keep in step. A wrapper would need its own margin *and* an internal gap, i.e. two
declarations expressing one number.

Order is load-bearing in one direction only: `interactiveRoundtrip.test.tsx` pins the byte string
`data-thread-role="assistant"><div class="bubble__markdown"><p>`, so nothing may precede the bubble's
opening child. Writing the rows after the text and before `<BubbleMeta>` satisfies that and AC1 together.

The row renders **nowhere else** — not on the assistant arm (nothing can put an attachment there), not on
the queued row, not on the unmounted `MessageBubble` residue. That is the same posture the meta row took
and it is proved the same way, with a count over the whole markup.

### Markup contract

```
.bubble__file            one attachment; flex row, the bubble's direct child
  .bubble__file-icon     45x60 positioning frame, never shrinks
    <svg>                the outlined glyph, stroke: currentColor, aria-hidden
    .bubble__file-ext    the extension overlay, aria-hidden (it restates the name)
  .bubble__file-name     the filename, wraps, never truncates
```

Both `filename` and the extension label reach the DOM as **React children only** — never an attribute,
never a URL, never `dangerouslySetInnerHTML`. The extension is `aria-hidden` because it is a decorative
restatement of characters the name already carries, which keeps the row's accessible text exactly the
filename and nothing doubled.

React key is the array index. The list is append-only per message and never reordered — it is a frozen
record written once at send — so index identity is stable, the same argument `Timeline` already makes.

### `attachmentExtensionLabel(filename: string): string`

New module `src/renderer/src/screens/conversation/attachmentExtensionLabel.ts`, beside `attachmentUploadCopy.ts`
and `messageTime.ts`. Pure, no React, no store.

Contract, in order: take the text after the **last** dot; uppercase; keep `[A-Za-z0-9]` only; cap at 4
characters. Returns `''` — never a fallback word — whenever any step leaves nothing.

The four ordering decisions, each with a case that pins it:

- **Last dot, not first** — `archive.tar.gz` is `GZ`.
- **Strip before capping** — the cap is the last act, so it bounds what is *drawn* rather than what was
  parsed.
- **ASCII-only class, not `\p{L}`** — a 44px slot cannot hold an arbitrary script, and admitting one would
  make the row's width depend on the name's alphabet. `файл.документ` yields `''`, which is the designed
  empty case, not a defect.
- **No leading-dot carve-out** — `.hidden` yields `HIDD`. The AC's rule is mechanical and this follows it
  literally; flagged in § Open questions as the one place a reasonable person could want different.

### The glyph

Inline `<svg>` transcribed from the Figma export, following `.bubble__copy-icon` in this same bubble:
sized by its own `width`/`height` (45/60) with a matching `viewBox`, `aria-hidden="true"`, no shared
component. Three export artefacts are dropped rather than transcribed — `preserveAspectRatio="none"` and
`overflow="visible"` (both only meaningful for the `<img>` wrapper Figma generates), and a `clipPath` whose
rect is a full-bleed 45×60 no-op. `.bubble__copy-icon` dropped its own no-op clipPath for the same reason.

**Deviation from AC3, stated rather than smoothed over.** AC3 asks for `fill="currentColor"`. The drawing is
an outline: `fill="none"` with a 1px stroke. Filling that path renders a *solid* document, which contradicts
§ Context's own "outlined document glyph" in the same ticket. So the implementation writes `fill="none"` and
`stroke="currentColor"`, which satisfies the criterion's substance — the ink comes from the row's `color`
rather than a hardcoded hex, and a theme change moves it — while its literal attribute name would defeat the
criterion's own first clause. This is the second edge of the trap the ticket already caught once: the layer
is named `file-solid-full` and the ticket says take the render, not the name; AC3's `fill=` is that same name
leaking one line further. Recorded in the code comment and in the PR body.

### CSS

All in `conversation.css`, beside `.bubble__meta`.

- `.bubble__file` — `margin-top: var(--space-3)`, flex, `align-items: center`, `gap: var(--space-3)`,
  `color: var(--color-inverse-primary)`, and **all four** body-small axes restated. The fourth is the point:
  `.bubble` sets title-small *emphasized* (14/20/0.1/600), so size, line-height, tracking and weight each
  differ and three of them are easy to leave inherited by accident.
- `.bubble__file-icon` — `flex: 0 0 auto` (AC5's "never squeezed narrower than 45px", as a declaration
  rather than a hope), `position: relative` for the overlay, `width`/`height` 45/60.
- `.bubble__file-ext` — `position: absolute; top: 50%; left: 0; width: 44px; text-align: center`, weight
  `var(--text-body-small-weight-emphasized)`. `top: 50%` *is* "top-aligned in the lower half" and lands 1px
  above the drawn y=31 — the same tolerance `.bubble__copy` records for its own glyph. The 44 and the 45
  are drawn constants with no theme role, so they appear as literals with the comment that says so; that is
  the `.bubble` `max-width: min(680px, 75%)` precedent in this file, not a token gap.
- `.bubble__file-name` — `min-width: 0` and `overflow-wrap: anywhere`.

**Why `.bubble__file-name` needs two declarations, not one.** They address different mechanisms and neither
substitutes for the other. `min-width: 0` disables the flex item's *automatic minimum size*, which is what
would otherwise force the item to its longest unbreakable word and push the icon out of the bubble.
`overflow-wrap: anywhere` supplies the break opportunities inside that word, without which a `min-width: 0`
item merely spills its text instead of wrapping. `.bubble`'s inherited `word-break: break-word` plausibly
covers the second half already, but the ticket is right that this is not the mechanism `word-break`
addresses, and an inherited declaration from a rule this ticket does not own is not a guarantee. Stating both
locally makes the row's wrapping a property of the row. The static tier cannot see any of it — the proof is
Playwright.

## State + concurrency model

None. This slice adds no store slice, no effect, no subscription, no async work and no cancellation path.
`TimelineRow` stays a pure function of its `item`; `attachmentExtensionLabel` is pure. `Timeline`'s prop
surface is unchanged, so the ~30 existing `<Timeline` render sites are untouched.

## Error handling

No I/O and no IPC, so no result type. The two degenerate inputs are both *legal*, not errors:

- `attachments` absent → no rows. The read is `item.attachments === undefined`, never
  `'attachments' in item` (the field is assigned unconditionally by the reducer, so `in` is always true).
- A name with no usable extension → an empty overlay `<span>`, drawn as nothing. The empty inline element
  is the `.bubble__meta-time` empty-slot precedent and needs no CSS of its own; the glyph beside it holds
  the row's height regardless.

`[]` is unreachable from the shipped producer but is representable, and it renders as no rows — the same
bytes as absence. That is the row's decision to make, per the store's own contract, and it is the only
reading consistent with "absent means none".

## Testing strategy

**vitest** — `attachmentExtensionLabel.test.ts` (new): the drawing's own `report.pdf`; last-dot-wins
(`archive.tar.gz`); the cap (`notes.torrent` → `TORR`, `photo.jpeg` → `JPEG` unclipped at exactly 4); the
three empty paths (no dot, trailing dot, non-ASCII extension); the strip (`a.p-d-f` → `PDF`); the
leading-dot case (`.hidden` → `HIDD`) pinned as documented behaviour, not left to chance.

**vitest** — a new `describe` in `ConversationScreen.test.tsx`: the row's presence and its **position**
between the text and `.bubble__meta` (index ordering against both neighbours, the #969 idiom, so the
assertion reddens if the row is ever prepended); the two class-and-content pins for the icon frame and the
name; the extension overlay present for `report.pdf` and *empty* for an extensionless name; two
attachments rendering two rows in list order; and a **count** of `.bubble__file` over the whole markup for
the arms that must render none — the assistant bubble, the queued row and the `MessageBubble` residue. The
count, not a per-string absence, is what the meta row's equivalent proof used.

**Playwright** — `e2e/attachment-file-row.spec.ts` (new), fake tier, one launch, one continuous drive: push
two `completed` `AttachmentUploadEvent`s through `ATTACHMENT_UPLOAD_EVENT_CHANNEL` with the
`composer-attach.spec.ts` `app.evaluate` stub (the only route to a settled attachment that does not open a
native dialog), send a message, then read **layout** — the only thing this tier is here for:

- AC5 under a pathological space-free name: the name's box stays inside the bubble's content box, the icon's
  measured width is still 45, the icon's left edge is still left of the name's, and the name's box is
  **taller than one line** — i.e. it actually wrapped rather than ellipsised. The last two together are what
  distinguish "wrapped in the column beside the icon" from "wrapped under the icon" and from "truncated",
  which is the failure mode the criterion names.
- The 12px rhythm above and below, read as computed geometry rather than as a declaration.

This spec **must not use `bubbleTextExactly`**: it is an anchored whole-bubble matcher and this is the first
bubble in the suite with a text-bearing child beside the message text. No existing spec seeds an attachment,
so none of the six current callers is affected by this ticket — the hazard runs only toward new specs.

## Open questions

1. **`.hidden` → `HIDD`.** The mechanical rule has no leading-dot carve-out, so a dotfile's whole name reads
   as its extension. Resolve by shipping the literal rule and pinning it in a test; revisit only if the
   operator says a dotfile should draw an empty slot.
2. **Whether AC3's `fill="currentColor"` was meant literally.** Resolved in § Design above: it cannot be,
   without contradicting the same ticket's "outlined". Shipping `stroke="currentColor"` and flagging it.
3. **Multiple attachments.** The design draws one row; the record is a list. Resolved as one row each,
   stacked on the same 12px rhythm, because that is what the existing sibling-margin mechanism yields with
   no new construct.

Each resolution that changed the design is recorded here; anything that moves during Phase B gets a
`## Revisions` entry in the same commit as the code that departs.

## Size — re-counted against this plan, with one stated overage

Five of the six boundaries hold with room: **2** production `.ts`/`.tsx` files (`ConversationScreen.tsx`,
`attachmentExtensionLabel.ts`; 3 counting `conversation.css`, which the rule's file class excludes), **1**
new exported symbol plus one module-local component, **1** consumer call site, **5** acceptance criteria,
**0** reject branches.

The sixth — total written work — projects at roughly **815 lines** including this plan and its security
review, against a 800 ceiling. **Building rather than splitting, and saying so rather than trimming to
fit.** Every cut available makes the result worse, and the floor rule decides it: the extension helper has
exactly one consumer, and the CSS cannot be verified without the markup it styles, so any child of this
ticket would be a slice nothing outside the family calls. That is the failure no resume fixes, whereas a
~2% overage costs at most a continuation leg. It is also the shape already measured on this repo — the
five `.composer__footer` UI slices landed 854/854/1137/1143/1515, five for five over, which says the
ceiling under-sizes UI work rather than that this ticket is oversized.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] SHOULD FIX — this row is the first DOM sink the uploaded `filename` has ever had.**
  Until now the composer renders it nowhere on purpose (`attachmentUploadCopy.test.ts` and
  `ComposerAttach.test.tsx` both assert its absence), so this ticket newly turns an IPC-delivered string
  into rendered output. The boundary is explicit and singular: `filename` and the derived extension reach
  the DOM as **React children only**, auto-escaped — never an attribute, a URL, a `title`, an `alt`, or
  `dangerouslySetInnerHTML`. Two adjacent invitations are declined deliberately and must stay declined:
  the React `key` is the **array index, not `filename`** (a name-derived key is harmless in itself but is
  the step that makes `id={att.filename}` look natural next), and `attachmentId` is **not rendered at all**
  — it is a host-side storage handle with no display value, and #816 needs it in a click handler, not in
  markup. The verifier should check all four.
- **[Trust boundaries] No findings on provenance — and it is structural, not a check.** `attachments` can
  only ever describe files *this window* minted: `MessagePayload` carries no attachment field and there is
  no list verb, so neither the relay nor the daemon can populate it. `filename` is the operator's own
  `basename`, or `clipboardImageFilename`'s client-owned stem. No parser, no allowlist and no validation is
  the right answer here because there is no adversarial input path to validate.
- **[File / storage] MUST NOT — do not sanitise, trim, or normalise the name in this row.** It is tempting
  (it *is* a path component) and it is wrong twice: the store's own contract forbids a second sanitiser on
  this side as the divergent-checks shape, and `sanitizeAttachmentFilename` already re-runs in main on the
  value a save actually builds a path from. Cleaning it here would make the name the operator *sees* differ
  from the name a save *writes* — a worse defect than the tidiness it buys. This slice builds no path,
  opens no file and resolves nothing.
- **[File / storage] OUT OF SCOPE — bidi/control-character extension spoofing, deferred to #816.** A name
  like `report<U+202E>gpj.exe` renders visually as `report…jpg.exe` reversed, the classic filename spoof.
  It is not live in this slice because the row is **drawn, not wired** — there is no action to mis-trigger —
  and the fix belongs where the name gains a download action, which is #816. Two things make deferring
  honest rather than lazy: a fix here would create exactly the display-vs-action divergence the finding
  above rules out, and the extension overlay is an accidental but real *mitigation* — it is derived by a
  mechanical last-dot rule whose `[A-Za-z0-9]` filter drops bidi controls, so it draws the true `EXE` while
  the name run reads spoofed. #816 should treat that overlay as the trustworthy half.
- **[Network & I/O] MUST NOT — the glyph is inlined, never referenced.** Figma's export hands back
  `imgFileSolidFull1 = "https://www.figma.com/api/mcp/asset/….svg"`, and transcribing that URL would ship a
  **remote subresource into a renderer whose CSP is `default-src 'self'`** — it would fail closed, but it
  would also be an outbound request from a privileged window to a third party on every message render. The
  design inlines the path data, which is why this is a no-finding rather than a bug; it is recorded because
  the lazy transcription is the one the export actively suggests. No socket, no fetch, no `url()`, no
  `<image href>` in this slice.
- **[Availability / DoS] SHOULD FIX — `attachmentExtensionLabel` must stay linear-time.** "Parse the
  extension" invites a backtracking pattern like `/(\.\w+)+$/`, which is the ReDoS shape. The contract is
  `lastIndexOf` + `slice` + a single-character-class `replace` + `slice(0, 4)` — every step linear, no
  nested quantifier, no overlapping alternation. The verifier should check no such regex appeared.
- **[Availability / DoS] Accepted, quantified, not fixed — an unbounded name grows the bubble's height.**
  AC5 forbids truncation outright, so there is no geometric cap by design. The bound is external and
  adequate: a path component is capped at 255 bytes by every filesystem this app runs on, and the name is
  the operator's own file on the operator's own machine, so the worst realistic case is a handful of wrapped
  lines authored by the person reading them. Recorded rather than defended against, the posture the meta
  row's contrast ruling set in this same box.
- **[Electron attack surface] No findings — this slice adds zero surface.** No new `contextBridge` API, no
  new `ipcMain` handler, no new channel, no protocol registration, no navigation, no `window.open`. The
  preload attachment APIs exist but this ticket wires none of them (`requestAttachment` is #868's,
  `saveAttachment` is #816's). The new e2e spec's `app.evaluate` stub is harness-only, in the fake tier, and
  stands in for the *sender* on an existing channel — never for the event shape.
- **[Tokens / secrets] No findings, and the record's shape is why.** `MessageAttachment` has exactly two
  fields, neither of them a credential. Nothing is stored, nothing is at rest, `safeStorage` is not reached.
- **[Cryptographic primitives] No findings — none are used.** No RNG (the React key is an array index, not
  a generated id), no hashing, no comparison against a secret. No `Math.random()` anywhere in this slice.
- **[Error messages, logs, telemetry] No findings — no log call is added.** The standing rule that a
  filename never reaches a log (the reason `attachmentUpload.test.ts` walks every emitted string) is kept by
  adding no logging at all. One forward-looking note: a Playwright failure prints surrounding DOM, so the new
  spec seeds an **invented literal** name, the `composer-attach.spec.ts` rule, and a later edit must not
  substitute a real one.
- **[Concurrency] No findings — nothing async is introduced.** No effect, no subscription, no timer, no
  promise, so there is no cancellation path to define and nothing that can outlive the window.
- **[Threat model alignment] Malicious relay and hostile daemon are both structurally excluded** by the
  provenance finding above — neither can reach this field. Renderer compromise reaching the transport is
  unchanged, since no bridge surface is added. Token theft from disk is not applicable: nothing persists.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-04
