# Composer attach — the name pill (#1265)

Split from [Composer attach — pending attachments and the strip](composer-attach-pending.md) on
2026-09-08 to stay under the size cap. Part of the same feature: the pending set (#1039), the tile strip
(#1262), the picture inside an image tile (#1263) and [the remove control](composer-attach-pending.md#the-remove-control-1264--taking-a-tile-back-out-before-send)
(#1264) are documented on the parent page; this page covers only the Pill each tile shows on hover or
keyboard focus, naming its file.

## Telling tiles apart on hover and focus

Two identical tiles — two PDFs, two screenshots pasted a minute apart — became a real hazard once #1264
gave each one a remove control: the operator can now take back the wrong file. This slice names the file,
drawn as a **Pill** (Figma `347:6617`) above the tile on `:hover` or `:focus-within`.

**Hangs on the slot, not the tile — the same clip #1264 already solved.** `.composer__attachment`'s
`overflow: hidden` (the clip #1263's picture needs) would swallow a pill drawn inside it with nothing
reddening to say so — a Playwright box is reported regardless of ancestor clipping. `.composer__attachment-slot`,
\#1264's unclipped `position: relative` wrapper, needs no new positioning context. The pill is the slot's
**third child**, appended after the remove control:

```
<span class="composer__attachment-slot">
  …the tile…
  <button type="button" class="composer__attachment-remove" …/>
  <span class="composer__attachment-name">{attachment.filename}</span>
</span>
```

Appending, not inserting, is load-bearing: two shipped assertions read the slot's markup by adjacency (the
slot must still *open* with the tile's frame, and the remove control must still *follow* its closing tag),
and appending leaves both byte-identical.

**The trigger is on the slot for the same reason the fix had to be.** The remove control is the tile's
**sibling**, not its child, so a tile-scoped `:focus-within` could never fire from it.
`.composer__attachment-slot:hover` and `:focus-within` each flip `display: none` to `display: block` —
`display`, not `visibility`/`opacity`, so a hidden pill holds no accessibility-tree entry and reports no box
at all, letting a test tell "showing" from "hidden" by the *kind* of answer rather than a number compared to
itself. No JS, no state: two pseudo-classes are the whole mechanism, which is also why two pills can show at
once (a pointer hover plus a keyboard focus elsewhere) and stays unarbitrated — a pointer alone can never
produce it.

**The name is escaped children, nothing else — the same sink `.bubble__file-name` already opened.**
`{attachment.filename}` inside a plain `<span>`; no `title`, no `alt`, no `aria-label`, no
`aria-describedby`. CLAUDE.md's 2026-08-20 ruling closes every attribute, URL, filename and log as a sink
for untrusted text like this, and #696's review already rejected `title={daemonText}` as a MUST FIX for the
same shape. `REMOVE_ATTACHMENT_LABEL` stays the strip's only accessible name — **the shared-name NIT
\#1264's review carried forward is declined, not forgotten**: distinguishing controls for assistive tech
would need `aria-describedby`, which needs a unique `id`, and the only unique thing to mint one from is
`attachmentId`, kept out of the DOM by #1262 on purpose. The focus-after-removal NIT is untouched — this
ticket renders; it does not change what a removal does to focus.

**Geometry: one row up, out of flow.** `position: absolute; left: 0; bottom: calc(100% + var(--space-2))` —
the slot's top is `.composer`'s own content top, so the pill's bottom edge lands there, occupying
`.composer-status`'s bottom 24px (paints and clips nothing) and clearing the remove control's 5px overhang
by 3px. Absolutely positioned, so AC3's "moves nothing" holds by construction. `pointer-events: none` (the
pill sits over the status row while showing on focus, and the pointer must stay free) and no `z-index`
needed (a positioned descendant with no stacking context already paints above the row's in-flow content).

**The width bound is `.conversation__workspace-chip-cwd`'s ellipsis chain, not `.bubble__file-name`'s**,
which wraps and is pinned to computed `normal` by `e2e/attachment-file-row.spec.ts`. `max-width: 200px`,
derived against the 800px minimum window (pane 340px, strip 316px after `.composer`'s padding) — inside the
pane from the first three slot positions. **Accepted residual:** a pill on the last tile of a full row at
the minimum width can be clipped by `.paired-shell__pane`, reachable only at the narrowest window with
five-plus attachments and a full-length name on that exact tile — a smaller bound would instead truncate
two same-prefix screenshot names to the same string, closing none of the confusion this ticket removes.

## Testing

`ComposerAttach.test.tsx` covers the pill as the slot's last child, outside `.composer__attachment` (the
closing-tag adjacency `</button><span class="composer__attachment-name">`), and re-aims three shipped
hostile-name negatives (`filename`/`'passwd'`/`'onerror'`) as an **enumeration of every attribute in the
strip**, none carrying a fragment of the name — a substring negative can't tell a name in an attribute from
a name in a text node, the enumeration can. `e2e/composer-attachment-name.spec.ts` (new, fake transport)
mints two tiles with distinct names and drives hover, leave, focus and blur in one sequence: a positive
read of the hovered tile's own pill before the sibling's absence is checked (the closing-absence trap),
computed style pinned to the design's ground/ink/weight/radius/padding, and AC3's geometry measured while a
pill shows — its box entirely above the tile's, inside `.paired-shell__pane`, with
`.composer__attachments`'s height and `.composer__row`'s `y` unchanged from resting. An envelope-count
baseline is read before the first hover and asserted unchanged after the last blur, mutation-checked by the
send that follows.

**A rework found the same "name reaches no attribute" shape shipped in two more specs than the plan
named** — `composer-attach.spec.ts` and `composer-attachment-image.spec.ts` each carried a
`not.toContainText(name)` negative the pill now makes true only by accident; both are re-aimed the same
way. The plan's reading list reached only `composer-attachment-remove.spec.ts` because that is the spec
this ticket's own drive is modelled on; the assertion is not attached to any symbol this ticket touches, so
no reading of the code would have surfaced it — a grep for `not.toContainText` across `e2e/` at plan time,
keyed on the criterion rather than the code, would have.

### Controlled hover and geometry verification

Visibility and treatment can pass before native pointer interference removes the pill's box.
The retained historical `188fd6b7` transcript records this named test failing at `pillBox.height`
after those checks: 322 executed, 321 passed, 1 failed, 4 skipped, three actual workers,
zero retries. The [controlled diagnosis](https://github.com/pyrycode/pyrycode-desktop/issues/1833#issuecomment-6127206600)
reproduces that geometry-loss mechanism and confirms merged
[PR #1836](https://github.com/pyrycode/pyrycode-desktop/pull/1836) protects it.
The overwritten original #1818 occurrence remains explicitly unconfirmed; the controlled
reproduction does not establish the contemporaneous trigger of the historical #1819 failure.

The diagnostic reuses both attachment completions and ordinary first-tile hover, then maps
an independent input-enabled cover between the original visibility/treatment checks and geometry.
All comparisons used Linux x86_64, Electron 33.4.11, dedicated 1920×1080 Xvfb and shown
1100×800 app windows, serially with one actual worker and zero retries. Each comparison
executed/passed two scenarios, with zero failed, skipped or flaky results:

| Revision / retained report | Cover over native pointer | Corner focus control |
| --- | --- | --- |
| Historical `188fd6b7`, `historical-final.json` | New pointer exit; hover true → false, display block → none, pill box present → null | Native focus lost; hover and identical pill box retained, zero new exits |
| Protected main `f2e0d6104c9593e83bfc0241d506b118def8bc52`, `protected-final.json` | Hover and identical pill box retained, zero new exits | Hover/box retained despite native focus loss |
| Same protected main, initial-window protection deleted, `deleted.json` | Historical hover loss and null box reproduced | Hover/box retained despite native focus loss |

Slot focus-within is false throughout, excluding keyboard focus as the pill trigger.
Timestamped pointer events and synchronous nullable pill/tile/composer/pane/strip/input boxes
are recorded before/after, alongside exact treatment, renderer focus/active element and native
focus/bounds. Strip height and input-row y stay at their resting baselines. See
[native display-pointer protection](e2e-harness-desktop-isolation.md#native-display-pointer-protection)
for actual cover bounds and the independent-process requirement.

This is an evidence-only resolution. The attachment spec is byte-identical to `188fd6b7`:
filename identity and sibling absence, hover/leave, focus/blur, exact computed treatment,
placement/containment, unchanged strip/input geometry, escaped text/attribute exclusions,
envelope absence and the subsequent send remain intact. Input, actionability, timeouts,
retries and suite parallelism are unchanged. Separate protected negative controls each
executed this exact test once and failed on attempt 0, with actual hover true, focus-within
false, display block and a present 24px box: a transparent-background mutation fails the
original `drawn` equality; changing bottom to `100%` fails pill-bottom/composer-top equality
(589 versus 581px). Source and built CSS mutations were restored byte-for-byte before acceptance.

The [verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/1943#issuecomment-6127503162)
audited the raw reports for final revision `1254902c67099fdf21cad652a93509bdd2a29942`
on Ubuntu 24.04.5 Linux x86_64, with the same Electron/display/window presentation above.
The exact named test, `a tile’s pill names its file on hover and on focus, one row up and moving nothing`,
was present and passed in every acceptance run:

| Report | Actual workers | Named executed / passed / failed / skipped / flaky | Suite executed / passed / failed / skipped / flaky |
| --- | --- | --- | --- |
| `named-one.json` | 1 | 20 / 20 / 0 / 0 / 0 | 20 / 20 / 0 / 0 / 0 |
| `named-three.json` | 3 | 20 / 20 / 0 / 0 / 0 | 20 / 20 / 0 / 0 / 0 |
| `full-default.json` | 3 | 1 / 1 / 0 / 0 / 0 | 386 / 386 / 0 / 3 / 0 |

Every named result is attempt 0, with retries explicitly disabled; no unrelated failure occurred.
The dispatcher verifier gate 6 at the same revision independently records 386 executed/passed,
0 failed and 3 skipped, with this named test and
`an independent input-enabled cover preserves isolated hover` both present and passed.
Acceptance is fake transport; no live-Claude run applies.

Raw reports, observation folders, exact diagnostic/deletion/CSS patches and negative-control
failure traces/error context are retained under `/tmp/builder-1833/`; the complete bundle is
`retained-proof.tar.gz`, with file hashes in `evidence-manifest.json`. These are local retained
artifacts, not GitHub uploads or documentation-stage test runs. The committed
[plan and diagnosis](../../specs/architecture/1833-attachment-pill-reliability.md#revisions)
and linked verdict preserve provenance. Setup failures are retained separately and excluded
from acceptance counts.

## Security

**PASS.** The strip's first render sink for an untrusted string — unlike #1264, which added none. The
value is length-bounded twice before this pill sees it (`sanitizeAttachmentFilename` in the background
process, `driveUpload`'s `trimToBytes` on the wire event), so `max-width` here is a display bound layered
on an existing one; it is escaped by React children with no raw-markup sink, matching CLAUDE.md's
2026-08-20 ruling. No new channel, no new bridge member, no `window.pyry` dereference the strip didn't
already make.

**Named as the trap for the next slice to avoid:** a name rendered in a pill is exactly where a download
link or a `title`-on-the-anchor follow-up would put the untrusted string into a URL — it must not.

**Out of scope, not a gap:** a name carrying bidi control characters renders reversed, so a hostile name
could present as a different file in the very pill meant to tell files apart — not introduced here
(`.bubble__file-name` already renders the same string with no `unicode-bidi` handling); the fix is one
`unicode-bidi: isolate` decision for both sinks at once, its own ticket.

See `docs/specs/architecture/1265-attachment-name-pill.md` § Security review for the full write-up.

## Related

- [Composer attach — pending attachments and the strip](composer-attach-pending.md) — the parent page:
  the pending set, the tile strip, the image tile and the remove control this pill hangs beside.
- [Composer attach](composer-attach.md) — the family's root page: the button, the outcome line and the
  copy module.
- `docs/specs/architecture/1265-attachment-name-pill.md` — the full plan and its security review.
- [Channel List — the row's desktop geometry § The control's own name](channel-list-control-name-pill.md)
  — #1172 restates this treatment, sidebar-scoped, onto the Rename/Save-as-channel controls rather than
  lifting this class; the two colours' Figma-export transposition is the same trap in both places.
