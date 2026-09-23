# Conversation shell — the usage-limit notice (#1321)

Split from [Conversation shell — composer status row and error slot](conversation-shell-composer-status.md)
on 2026-09-15 to stay under the size cap. Part of [Composer](conversation-shell-composer.md); see the
parent page for the slot's full precedence order and its other occupants.

## The usage-limit notice, the slot's third occupant (#1321)

Draws [the usage-limit store](usage-limit-store.md)'s per-conversation reading in the trailing slot,
below the actionable-error button, connection-error chip, stopped-turn recovery,
refusal Switch back, model rejection and Claude stopping reports in precedence.
It precedes history failure. `status` and `limitType` are claude-authored open strings that crossed the
subprocess trust boundary; this slice is where the "no DOM sink" constraint that store inherited is
**discharged** rather than passed on further.

**`usageLimitNotice.ts`** (`src/renderer/src/screens/conversation/`) is a React-free module beside
`messageTime.ts`, for the same reason that one exists: the exact characters are pinnable without
rendering anything. `usageLimitNotice(reading, nowSeconds)` is total — no throw, no reject branch — and
composes three runs in a fixed order (lead, window, reset), each independently omittable except the lead:

- **The lead** decides the treatment and is the *only* place that happens: `status === 'rejected'`
  (exact equality, never a prefix or family test) takes `USAGE_LIMIT_EXHAUSTED_COPY` ("Usage limit
  reached"); every other status — including the one status ever observed live, `allowed_warning`
  (2026-08-22, claude 2.1.239, `limit_type: seven_day`, a weekly band where every turn still ran normally)
  — takes `USAGE_LIMIT_WARNING_COPY` ("Nearly at usage limit"). The asymmetry is deliberate: the status set
  is open, and the cost of under-claiming (one softly-worded row) is far below the cost of over-claiming
  (telling the operator they are blocked while their turns keep working). `treatment` is returned as a
  client-owned `'exhausted' | 'warning'` union beside the text, so the view picks a class without
  re-testing the status.
- **The window** is a `ReadonlyMap<string, string>` lookup on `limitType` (`five_hour` → "5-hour window",
  `seven_day` → "7-day window"), omitted for any other value — the four other documented values
  (`seven_day_opus`, `seven_day_sonnet`, `seven_day_overage_included`, `overage`) deliberately fall to the
  unnamed arm rather than getting invented copy. **`Record<string, string>` is forbidden here**, the same
  `Map`-not-`Record` rule the store this reads from already carries one layer up: against a `Record`,
  `'__proto__'` and `'constructor'` are non-`undefined` and would put `[object Object]` or a function's
  source into the status row; `Map.prototype.get` makes both ordinary misses by construction.
- **The reset clause** is a local-getter formatter (`formatMessageTime`'s discipline verbatim — no
  `Intl`, no `toLocale*`) that carries the date **only when the reset does not fall on the local day the
  notice is read** — a seven-day window resets days out, so a bare time of day would read as "later
  today." It returns `null`, dropping the clause, in two wire-reachable cases: `resetsAt === 0` (claude
  reported no reset — never formatted as 1970) and an unrepresentable instant (`resetsAt` is unvalidated
  in both directions upstream, so a magnitude past `Date`'s ±8.64e15 ms range passes `selectUsageLimitFor`'s
  readability test and would otherwise render `NaN.NaN.NaN`; guarded by `Number.isNaN(at.getTime())`, not
  by a range check on the input). Both parameters are unix seconds, matching `selectUsageLimitFor`'s
  `nowSeconds` — one unit across the whole vertical closes that selector's millisecond trap.

Nothing here is scheduled from `resetsAt` — no timer, no interval, no re-arming handler. Expiry is
`selectUsageLimitFor`'s one read-time comparison, so an expired reading leaves the row on the next render.
Nothing here is logged, on the store's own reasoning sharpened one layer down: the pair discloses the
account's quota posture, a fact about the operator, and even a content-free count would be the first
crack in a property that has to be total.

**`ComposerUsageLimitNotice({ reading, nowSeconds })`** is the pure, exported view: `null` on a `null`
reading; otherwise one `<div className="composer-status__usage composer-status__usage--{treatment}">`
holding `notice.text` and nothing else. Props, not a store read — the `ComposerErrorChip`/`ConnectionBanner`
discipline, and here it is the *only* way the matrix is assertable at all, since zustand v5's `useStore`
reads `getInitialState()` under `renderToStaticMarkup` and a container test can reach exactly one arm. The
class is chosen by an explicit two-way conditional over the `treatment` union, never by interpolating it
into a template — the same discipline that keeps `notice.text` itself free of either untrusted string. No
live region and no hidden prefix, unlike the chip: both leads already say what they are in plain words, so
the visible text is already the accessible name.

**`ComposerErrorSlot`** selects repair, then connection error; while connected it
returns `recovery ?? refusal ?? notice ?? history ?? mcpFailure ?? taskCount ?? null` (the
background-task count joined the end of this chain in
[#1435](conversation-shell-composer-status.md#background-task-count-pill-the-slots-last-occupant-1435);
the [MCP server failure notice](conversation-shell-composer-status.md#mcp-server-failure-notice-1494)
was inserted ahead of it in #1494). Otherwise it returns null. The container chooses model rejection, stopping report, then usage for
`notice`. Each absent occupant must be actual `null`: a non-null React element
whose component renders null still wins `??` and hides the next occupant.
`ComposerErrorSlotControl` therefore checks `usageLimit === null` before creating
`ComposerUsageLimitNotice`. A pure slot test with `notice={null}` alone cannot
catch this; the store-bound history markup test exercises the real composition.

The container reads the active conversation and `selectUsageLimitFor` with
`Math.floor(Date.now() / 1000)`, matching the selector's seconds unit. The stable
`NO_USAGE_LIMIT_READING` selector covers no open conversation without a conditional
hook call. These reads add no timer.

### The layout hazard the first review cleared, wrongly

Shipped in the first PR as `flex: 0 0 auto` with `white-space: nowrap`, matching both existing occupants.
At the app's own 800px minimum window the widest string this element can produce — 404px, the warning
lead on a seven-day window with a far-future reset, which always takes the formatter's long form — left
only 316px of row content to share. Neither existing occupant nor the notice could shrink, so the *activity
group* (the only remaining flexible item) absorbed the whole squeeze, went to zero width, took the turning
brand mark off the row entirely, and the row still spilled 79px past the pane.

The builder's own security review had cleared this exact hazard as "No findings," reasoning that no
daemon-controlled string enters this path so `white-space: nowrap` "cannot be blown out" — true, and
irrelevant: the string that overflowed was the *client's own copy*, which the review never weighed. The
review's Revisions section retracts that finding by name rather than silently correcting it, since the
argument that cleared it and the fact that broke it are both worth keeping.

The fix, a rework leg landing two stylesheet changes:

- **`.composer-status__usage` becomes `flex: 0 1 auto; min-width: 0`** plus an `overflow: hidden;
  text-overflow: ellipsis` chain — a deliberate divergence from both neighbours' `flex: 0 0 auto`, and the
  reason is copy *length* rather than trust: this element's longest string is a client-owned constant, so
  letting it compress cannot be triggered by a hostile or oversized daemon value the way shrinking the
  chip or the button could. Flex distributes shrink proportional to base size, so an oversized daemon tool
  name in the label still takes essentially all of the squeeze and this element still yields last only the
  three runs, in order (lead, window, reset) — the operator-facing lead is the last thing to clip.
- **`.composer-status__activity`'s `min-width` rises from `0` to the brand mark's box plus its gap**
  (`calc(14px + var(--space-2))`) — see the correction in [Composer status row](conversation-shell-composer-status-row.md#composer-status-row-796)
  above — so proportional shrink alone cannot paint the mark under the notice again.

`.composer-status__usage` is its own stylesheet block rather than a geometry lifted out of
`.composer-status__error`, a deliberate departure from `.button-small`'s "second consumer, extract"
precedent: the two occupants share no colour on either of the notice's two arms and the notice has no
`position: relative` (no hidden prefix to contain), so sharing would couple two occupants that draw
differently for the sake of six declarations.

Re-measured at the 800×600 floor rather than the 1100px launch width, where the fit could not fail (every
string the element can hold fit the 640px pane there, so that measurement was never a real test): the row
reads 340×24 with no horizontal overflow, the 316px of content divides as 22px to the activity group (its
new floor) and 294px to the notice, whose full content is 404px — so it fits by compressing, with 110px of
copy clipped. All of this is pinned in `e2e/composer-footer-overflow.spec.ts`'s shape, at the row rather
than the pane, since no vitest detector in this repo can read a resolved style.

### Testing

**`usageLimitNotice.test.ts`** (vitest, new) pins the copy/treatment matrix directly: `rejected` takes the
exhausted treatment, every other status (including an invented one) takes the warning treatment; the two
treatments' texts are asserted to agree on every run but the lead, by construction; `five_hour`/`seven_day`
produce their words while `seven_day_opus`, `overage`, `''` and hostile `__proto__`/`constructor` keys
produce no window clause and no `[object`, `function` or `undefined` in the text; `resetsAt: 0` drops the
clause with no `1970`; a same-local-day reset renders time-only and a different-day one carries the date,
both built from local getters in the test so no runner time zone can flake them; an unrepresentable
`resetsAt` drops the clause with no `NaN`; neither `status` nor `limitType` ever reaches the text, pinned
with sentinel values.

**`ConversationScreen.test.tsx`** gained two describes: `ComposerUsageLimitNotice` (the exact empty string
on a `null` reading; the two treatment classes asserted present and absent in both directions; no
`aria-label`, no `role`, no hidden prefix) and the extended `ComposerErrorSlot` precedence matrix (a
sentinel notice element on every arm — the button and chip arms render their own occupant and never the
sentinel; the `connected` arm renders the sentinel; `disconnected` and `connecting` render nothing at
all). The nine pre-existing `ComposerErrorSlot` renders gained `notice={null}` with no other change.

**`e2e/composer-usage-limit.spec.ts`** (Playwright fake tier, new) drives the transitions no static render
can reach, against the seeded row: empty at launch → push `allowed_warning`/`seven_day` (warning
treatment, `7-day window`, exhausted class absent) → push `rejected`/`five_hour` (flips to exhausted,
`5-hour window` — a different window on purpose, so the step is falsifiable by the one before it) → push
`allowed` (empties again, `usageLimitBridge`'s clear route driven end-to-end). The closing empty check is
a mutation check rather than a vacuous locator, since the two prior steps each proved the element present
first. `resets_at` is a fixed far-future literal and the spec asserts only the lead and window words, never
the formatted instant, whose exact characters depend on the runner's time zone and are pinned in vitest
instead. Every geometry assertion in the spec is taken at the 800×600 floor, against the row, per the
rework leg above.

Security review PASS (builder self-review), with the one retracted-and-corrected finding recorded above
under its own heading in the ticket's architecture spec rather than silently edited away. See
[#1321](https://github.com/pyrycode/pyrycode-desktop/issues/1321) and its
[architecture spec](../../specs/architecture/1321-usage-limit-in-status-row.md).
