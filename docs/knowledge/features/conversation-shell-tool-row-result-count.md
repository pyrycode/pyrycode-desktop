# Conversation shell — tool row result count

Split out of [Conversation shell — tool row layout](conversation-shell-tool-row-layout.md) on 2026-09-05 to
keep every section under the size cap; see that document for the layout arc as a whole and
[Conversation shell](conversation-shell.md) for the screen itself.

## Tool row result count (#856)

Draws `ToolResult.resultDetail` — the daemon's short précis of what a call returned, `"265 lines"` or
`"110 of 1676 lines"` — as [#854](conversation-shell-tool-row-header-groups.md#tool-row-header-groups-854)'s right group's first child, 12px before
the chevron. The field has carried on the item since #773, which deliberately deferred every display
decision to this ticket, including whether absent and empty differ at all. They don't, here: this row is
the one place upstream's carefully-kept distinction is allowed to collapse.

**The predicate is written out, not collapsed into a truthiness check:**
`result.resultDetail !== undefined && result.resultDetail !== ''`. The wire decoder, the IPC event, the
bridge and the reducer all keep absent and empty distinct on purpose and say so at every stage; this row
is where they finally mean the same thing (draw nothing), and naming both falsy values makes that
collapse legible at the one place that performs it rather than hiding it behind `Boolean(...)`. `!==
undefined`, never `'resultDetail' in result` — structured clone carries the key across the IPC bridge
whether or not the wire set it, so `in` is true for both and would silently drop the distinction #773 paid
to keep.

**This inverts #855's rule on the runs beside it, in the same file, on purpose.** In `.tool-row__left`,
`''` means "draw the element with no text" and a bare `&&` would be a bug. Here `''` means "this daemon
looked and found no count" — the correct answer for a failed call and for the long tail — so it must draw
nothing. Two opposite conventions for the same falsy value, because the value means opposite things in
the two groups.

**AC2's "no gap" is structural, not a modifier.** `.tool-row__right`'s `gap: var(--space-3)` only falls
*between* children; not rendering the count element is the whole of AC2 — no `--empty` modifier, no
pending variant. #854's "gate the whole group, not just the chevron" argument, one level down. No second
predicate either: the group is already gated on `result !== null`, so a pending row has no group to put a
count in and the question does not arise there.

**Element choice again follows #854's ruling: `<span>`, never Figma's `<p>`.** A resolved chip is a real
`<button>`, which admits phrasing content only — `<p>` inside it is invalid HTML and a React DOM-nesting
warning. The element is chosen for validity, the box for layout, same as the two group wrappers one level
up.

**The count is body-medium — `.tool-row__summary`'s four type tokens taken whole** (`--text-body-medium-
size`/`-line`/`-tracking`/`-weight`), inked `--color-on-surface`. Body-medium is the step #855's
`.tool-row__left { min-height: var(--text-body-medium-line) }` floors every row at, so the count changes
no row's collapsed height — half of why AC4 holds before a line was written; the other half is that the
count sits in the *right* group, which #855's height floor doesn't depend on either.

**The security finding, and where the fix actually landed.** Drawn as an unshrinkable `nowrap` run in a
`flex: 0 0 auto` group, an unbounded `result_detail` (the wire only type-checks it, `parseInboundMessage`'s
whole-message cap leaves ample room) gives the trailing group a base size wider than the chip, collapses
the left group to nothing, and pushes the chevron — client-owned chrome, not daemon text — past
`.tool-row__chip`'s `overflow: hidden` edge, where it vanishes. Every other untrusted run on this row lives
in the left group and is already bounded by its own ellipsis; this is the first daemon string that can
displace the client's own affordance.

The fix is a `max-width: 50%` on **`.tool-row__right`**, not on `.tool-row__count` — a percentage
`max-width` resolves against its element's containing block, and the count's containing block is the right
group itself, whose width depends on the count. That's circular: the percentage would resolve against an
indefinite size, behave as `none` during the group's intrinsic sizing, and bound nothing. The right group's
containing block is `.tool-row__chip`, whose `width: 100%` (#722) is definite, so 50% resolves there. This
was a revision made after the plan's initial draft placed the bound on the count itself and shipped it
there anyway before the CSS containing-block fact was caught — worth remembering for any future percentage
bound on a flex child whose own size is content-driven.

The group keeps `flex: 0 0 auto` — the cap clamps its *base* size without making it a shrink candidate, so
\#854's truncation chain is unchanged in both directions: an oversized tool name still ellipsizes the
headline rather than squeezing the chevron. `.tool-row__count` alone takes `flex: 0 1 auto; min-width: 0`
(Figma says `shrink-0`, and the deviation *is* the control) plus the summary's own
`overflow: hidden; text-overflow: ellipsis; white-space: nowrap` — the group's only shrink candidate, so
all the negative free space the cap creates lands on it and none on the chevron. In every real case
(the design's longest example, `"110 of 1676 lines"`, is an order of magnitude short of 50% even at the
800px minimum window) the group is nowhere near its cap and the rendered box is exactly Figma's `shrink-0`
box. The ellipsis is a **visual** clip only: the DOM text node stays the verbatim, untrimmed string (AC3)
— nothing parses the count, measures its length, or turns it back into the number it describes.

**Safety posture — the fourth untrusted string on this chip**, alongside `name`, the picked input value,
and `resultSummary`: auto-escaped `<span>` children, nothing else. Four sinks this string makes newly
tempting are declined and named in `ToolRow`'s SAFETY comment as MUST-FIX-if-reintroduced: `title` (a
seventh no, with a new pull since the count is the one run that visibly ellipsizes, which makes "hover for
the rest" tempting — the answer stays that the row opens); parsing the précis back into a number (it has
unit words and interior spaces, a number derived from it would be a client-owned claim about a
daemon-owned value); `aria-label`/`data-*` (the count joins the button's accessible name for free as one
more text child, needing no attribute — interpolating it into an attribute is #697's declined shape); and
a log line (any useful one carries daemon text into a log, which ADR 0007 and CLAUDE.md both forbid).

**Tests.** Unit: a resolved call with `resultDetail` draws the span as one contiguous byte fragment between
`.tool-row__right`'s open tag and the chevron's `<svg`; absent draws no `tool-row__count` node; empty
renders **byte-identical** to absent (`toBe`, not two `not.toContain`s — the strongest form of "both draw
the same thing"); a detail with HTML metacharacters and leading/trailing spaces draws escaped and
untrimmed, in no `title=`/`aria-label`/bare `data-*` attribute (the chip's own `data-thread-role="tool"`
means that last check reads the exact attribute list on the count's own span, not a blanket
`not.toContain('data-')`, which would fail on correct markup). The two pre-existing byte-level chip
fixtures (`RESOLVED_CHIP_HEAD`/`TAIL`) needed **no edit** — they carry no `resultDetail`, so they already
pinned the absent-count chip; a new constant pins the with-count chip beside them. e2e (`tool-row-toggle
.spec.ts`, a fourth sibling test with its own `launchPairedApp`, driven from `result_detail` on the wire
payload so the whole #773 carry is exercised, not just the render): three counts of different string
widths line up their **trailing** edges within `WIDTH_TOLERANCE_PX` (the leading edge can't be the check,
since the strings differ in length); every row's chip height matches the path row's (the #855 height-parity
lesson, restated); the count sits one `--space-3` before the chevron, flush against the chip's padding
edge; and a fourth row with an absurdly long count proves the chevron's right edge stays inside the chip's
clip box and the count itself is what ellipsizes — turning the CSS bound from an unexercised defence into
a proven property.

**A shipped-code lesson for whoever next edits a comment mid-revision:** the first commit's
`.tool-row__count` comment described the plan's *pre-revision* shape (`flex: 0 0 auto`, "NO min-width: 0")
side by side with the *shipped* rule (`flex: 0 1 auto; min-width: 0`) — both narrating the same property in
contradictory terms, because the plan's Revisions section moved the bound from the count to the group after
the comment prose was drafted and the superseded paragraphs weren't deleted. A follow-up commit removed the
two stale paragraphs. Not cosmetic: a reader trusting the "NO min-width: 0" line would restore the exact
clipped-chevron failure the hostile-count e2e row exists to catch. When a design revision changes which
rule owns a property, re-read every comment that states the old shape before shipping, not just the CSS
declarations.

See PR for the full record; there is no `docs/knowledge/codebase/856.md` — that directory was frozen
2026-08-26, and this section is #856's only home.

