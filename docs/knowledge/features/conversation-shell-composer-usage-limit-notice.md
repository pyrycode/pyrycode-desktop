# Conversation shell — the usage-limit notice (#1321, moved to the Top overlay by #1604)

Split from [Conversation shell — composer status row and error slot](conversation-shell-composer-status.md)
on 2026-09-15 to stay under the size cap. Part of [Composer](conversation-shell-composer.md); see the
parent page for the composer status slot's own precedence order and occupants — the usage notice is no
longer one of them.

## The usage-limit notice, now a Top overlay pill (#1321, moved by #1604)

Draws [the usage-limit store](usage-limit-store.md)'s per-conversation reading. Through #1604 this drew in
the composer status row's trailing slot, below the actionable-error button, connection-error chip,
stopped-turn recovery, refusal Switch back, model rejection and Claude stopping reports, and ahead of
history failure — a single-occupant chain, so a usage warning could sit unseen behind any one of those.
**#1604 moved the reading out of the slot entirely**, into the conversation's **Top overlay**
(`TopOverlay.tsx`, `TopOverlayControl` in `ConversationScreen.tsx`), a right-aligned stack of pills pinned
over the message area's top edge, shared with mobile. The reading now shows **whatever the slot holds and
whatever the connection state**, and no longer competes with any slot occupant in either direction — see
[Composer status row § model settings rejection](conversation-shell-composer-status.md#model-settings-rejection)
for what the slot's own `notice` carries today. `status` and `limitType` are claude-authored open strings
that crossed the subprocess trust boundary; this slice is where the "no DOM sink" constraint that store
inherited is **discharged** rather than passed on further, and #1604 added a second decision on the same
two strings — which pill variant to draw (below).

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
  source into the pill. `Map.prototype.get` makes both ordinary misses by construction.
- **The reset clause** is a local-getter formatter (`formatMessageTime`'s discipline verbatim — no
  `Intl`, no `toLocale*`) that carries the date **only when the reset does not fall on the local day the
  notice is read** — a seven-day window resets days out, so a bare time of day would read as "later
  today." It returns `null`, dropping the clause, in two wire-reachable cases: `resetsAt === 0` (claude
  reported no reset — never formatted as 1970) and an unrepresentable instant (`resetsAt` is unvalidated
  in both directions upstream, so a magnitude past `Date`'s ±8.64e15 ms range passes `selectUsageLimitFor`'s
  readability test and would otherwise render `NaN.NaN.NaN`; guarded by `Number.isNaN(at.getTime())`, not
  by a range check on the input). Both parameters are unix seconds, matching `selectUsageLimitFor`'s
  `nowSeconds` — one unit across the whole vertical closes that selector's millisecond trap.

**#1604 adds a second, independent decision on `status`: `variant`.** Pill colour follows *dismissibility*,
not wording — `status === 'allowed_warning'` (exact equality again, against a module-private
`DISMISSIBLE_STATUS`) returns `variant: 'default'`, the pill that carries the X; every other status,
`rejected` included, returns `variant: 'error'` with no X, so a status this client has never seen cannot be
waved away. `variant` is decided independently of `treatment`: `rejected` still wears the exhausted *text*
on an *error* pill, and an unrecognised status still wears the warning text on an error pill too — colour
and wording answer different questions, and keeping them on separate switches is what stops a future edit
from reading one off the other.

**`isUsageReadingDismissed(reading, dismissed)`** is the second new export: `true` only when `status`,
`limitType` and `resetsAt` are each `===` the dismissed triple, compared **field by field**. Never
concatenated and never used as a `Map` or object key — both strings are daemon-authored, and joining them
(`a|b` + `c` colliding with `a` + `b|c`) is the same key-shaped daemon-text hazard the `Map`-not-`Record`
rule above already guards against, in a different shape. No trim, no case fold: a normalised comparison
would silently dismiss a reading the operator never actually saw.

Nothing here is scheduled from `resetsAt` — no timer, no interval, no re-arming handler. Expiry is
`selectUsageLimitFor`'s one read-time comparison, so an expired reading leaves the pill on the next render.
Nothing here is logged, on the store's own reasoning sharpened one layer down: the pair discloses the
account's quota posture, a fact about the operator, and even a content-free count would be the first
crack in a property that has to be total.

**`ComposerUsageLimitNotice` was retired by #1604** — no consumer once the reading moved out of the slot.
Its replacement, **`TopOverlay({ reading, nowSeconds, dismissed, repair, onDismissUsage, onRepair })`**
(`TopOverlay.tsx`), is the pure, exported view for the whole overlay, not the notice alone — it also draws
the Re-pair pill; see [Actionable-error button](conversation-shell-composer-repair-button.md). It returns
`null`, rendering no element, only when there is no usage pill to show (`reading` is `null`, or
`isUsageReadingDismissed` says the operator already dismissed this exact triple) **and** `repair` is
false — an empty overlay takes no space and leaves nothing in the tree. Otherwise it renders
`<div className="conversation__top-overlay">` holding the usage pill first
(`top-overlay-pill top-overlay-pill--default` or `--error`, chosen by an explicit two-way conditional over
`notice.variant`, never a template) and the Re-pair pill second. Only the default pill carries the X
button, `aria-label={USAGE_PILL_DISMISS_LABEL}` ("Dismiss usage notice"), wrapping an `aria-hidden` inline
SVG glyph inked by `currentColor`. Props, not a store read — the `ComposerErrorChip`/`ConnectionBanner`
discipline this view inherits, and here it remains the only way the matrix is assertable at all, since
zustand v5's `useStore` reads `getInitialState()` under `renderToStaticMarkup`. No live region and no
hidden prefix: both leads already say what they are in plain words, so the visible text is already the
accessible name — #279's connection banner still owns the disconnect announcement.

**`TopOverlayControl`** (`ConversationScreen.tsx`) is the store-bound container, mounted as a sibling leaf
of `Timeline` inside `.conversation__message-area` rather than anything read inside
`ComposerErrorSlotControl`. It reads the active conversation, `selectUsageLimitFor` with
`Math.floor(Date.now() / 1000)` (the stable `NO_USAGE_LIMIT_READING` selector covers no open conversation
without a conditional hook call), the dismissal store's `dismissed`, and `shouldOfferRepair(status)` for
`repair` — **with no connection gate on the reading itself**: an account's quota does not change when a
socket drops, which is the whole point of the move — a warning that used to disappear behind #279's banner
on disconnect now keeps showing. Its `onDismissUsage` writes straight to `usagePillDismissalStore`; its
`onRepair` is #963's former `handleRepair`, moved verbatim — it still re-resolves the host from the stores
at click time and still never calls `runUnpair` or clears a store. These reads add no timer.

**`usagePillDismissalStore`** (`src/renderer/src/store/usagePillDismissalStore.ts`) holds one triple for
the whole app process, not one per conversation — the reading describes the account's quota, so an
identical triple dismissed in another conversation is the same fact already acknowledged. Renderer memory
only: no persistence, no IPC, gone on reload. It is a store rather than `ConversationScreen`-local state
because [Paired shell](paired-shell.md) keys that screen by pane and unmounts it off the thread route, so
a `useState` there would forget the dismissal on every navigation between panes.

**`ComposerErrorSlot` no longer takes a usage reading.** #1604 also moved Re-pair out of the slot (see
[Actionable-error button](conversation-shell-composer-repair-button.md)), so the slot's own chain now opens
on reconnect, then the connection-error chip; while connected it returns
`recovery ?? refusal ?? notice ?? history ?? mcpFailure ?? taskCount ?? null`, where `notice` now carries
only the settings-rejection message and the stopping report. Usage no longer competes for this chain in
either direction: it cannot be held back by a higher-priority slot occupant, and it no longer holds back
history, the MCP failure notice or the task count the way it did through #1321.

### The layout hazard the first review cleared, wrongly — retired history (#1321, superseded by #1604)

This subsection describes a shipped defect and its fix inside the *composer status row*. **The CSS classes
it names (`.composer-status__usage`) and the row geometry they describe no longer exist** — #1604 moved the
notice off the row entirely, into the Top overlay, whose own geometry (below) takes the opposite approach:
wrap the text instead of shrinking and ellipsizing it. Kept here as the incident that shaped the #1321
rework and because the *lesson* — that a security review cleared a hazard by reasoning about trust when the
actual defect was about a client-owned string's *length* — outlives the CSS it was found in.

Shipped in the first PR as `flex: 0 0 auto` with `white-space: nowrap`, matching both existing occupants.
At the app's own 800px minimum window the widest string this element could produce — 404px, the warning
lead on a seven-day window with a far-future reset, which always takes the formatter's long form — left
only 316px of row content to share. Neither existing occupant nor the notice could shrink, so the *activity
group* (the only remaining flexible item) absorbed the whole squeeze, went to zero width, took the turning
brand mark off the row entirely, and the row still spilled 79px past the pane.

The builder's own security review had cleared this exact hazard as "No findings," reasoning that no
daemon-controlled string enters this path so `white-space: nowrap` "cannot be blown out" — true, and
irrelevant: the string that overflowed was the *client's own copy*, which the review never weighed. The
review's Revisions section retracts that finding by name rather than silently correcting it, since the
argument that cleared it and the fact that broke it are both worth keeping.

The fix, a rework leg landing two stylesheet changes: `.composer-status__usage` became
`flex: 0 1 auto; min-width: 0` plus an `overflow: hidden; text-overflow: ellipsis` chain, and
`.composer-status__activity`'s `min-width` rose from `0` to the brand mark's box plus its gap
(`calc(14px + var(--space-2))`) so proportional shrink alone could not paint the mark under the notice
again. Both rules, and the element they styled, were deleted with the view by #1604.

### The Top overlay's own geometry (#1604)

`.conversation__message-area` wraps the thread and the overlay: `position: relative; flex: 1 1 auto;
min-height: 0`, so `Timeline` and `EmptyThread` still fill it exactly as before. It is **always rendered**,
even when `Timeline` itself is skipped (an offline host with nothing to draw) — the region then stays
empty, not missing, so the overlay's Re-pair pill still has somewhere to sit. The known side effect: with
`Timeline` skipped, the composer then sits at the pane's bottom rather than directly under the notices,
since the flexible region above it is empty rather than absent.

`.conversation__top-overlay` is absolutely positioned at the message area's top edge (`top: 0; left: 0;
right: 0`), a column with `align-items: flex-end`, a `gap: var(--space-3)` (12px) and a single
`drop-shadow(...)` filter over the whole stack, as the Figma export draws it — not a per-pill `box-shadow`.
`pointer-events: none` on the full-width box, switched back on for each `.top-overlay-pill`, keeps the
thread beneath scrollable and clickable around and between the pills.

Each pill **hugs its text and wraps rather than truncates** — the deliberate opposite of the retired
row-based fix above: `max-width: 100%`, `overflow-wrap: anywhere`, `text-align: right`, no `white-space:
nowrap` and no ellipsis. The 404px warning string that once forced the row-shrink rework now simply wraps
inside the pill at the 800px floor, verified in `e2e/composer-usage-limit.spec.ts` by asserting the pill's
rendered height is greater than one line and that its box stays inside the message area with no horizontal
overflow.

### Testing

**`usageLimitNotice.test.ts`** pins the copy/treatment matrix as before, plus #1604's additions: `variant`
is `default` for exactly `allowed_warning` and `error` for `rejected`, `allowed_warning ` (trailing space),
`ALLOWED_WARNING`, a sentinel and the empty string; `isUsageReadingDismissed` returns `false` for a `null`
dismissed value, `true` for an equal triple, and `false` when any one of the three fields differs
(`it.each` over the three fields) — never a composite comparison.

**`usagePillDismissalStore.test.ts`** pins the initial value as `null`, and that `dismiss` stores a fresh
copy of the triple rather than the caller's own object reference.

**`TopOverlay.test.tsx`**, all via `renderToStaticMarkup`: the empty overlay renders nothing in three
cases (no reading and no repair; a dismissed reading and no repair; a dismissed reading whose fields have
not changed); the default pill carries the client-owned `aria-label` on its X and no error class; an error
pill for `rejected` and for an unrecognised sentinel status carries no `<button`, and the sentinel `status`/
`limitType` never appear in the markup; the Re-pair-only and both-pills arms pin exact markup, with the
usage pill always ahead of Re-pair; a dismissed triple that differs in one field shows the pill again.

**`e2e/composer-usage-limit.spec.ts`** (Playwright fake tier, rewritten by #1604) drives the overlay end to
end: the warning appears as a default pill; the X hides it; pushing the identical reading again keeps it
hidden; a changed reading (a new reset time) brings it back; `rejected` renders as an error pill with no X;
`allowed` clears it; at 800×600 the warning pill wraps, with no horizontal overflow past the message area.

**`ConversationScreen.test.tsx`**'s `ComposerUsageLimitNotice` describe was deleted — its coverage moved to
`TopOverlay.test.tsx` — and the `ComposerErrorSlot` precedence tests dropped `notice`'s usage arm along
with every `onRepair` prop.

**A rework lesson, from the verifier's gate on PR #1611.** Two unit specs — `banner.test.tsx` and
`historyRetry.test.tsx` — still pinned the old single-occupant priority (usage yields to a settings error,
usage yields to a stopping report) through the mounted screen; the pure `ComposerErrorSlot` describe alone
did not cover them, since neither test constructs the slot directly. Separately, four Playwright specs
(`composer-status-spacing`, `model-refusal`, `question-answer-continue`, `stopped-turn`) still located the
notice by the retired `.composer-status__usage` class and failed outright once that view was deleted. All
six were repointed to assert the pill stays visible in the overlay rather than yielding, and their
assertions inverted accordingly. The plan's own Open Question — "does any other spec assert priority?" —
was resolved by running only the specs the plan named, which missed all four e2e regressions; the check
that actually finds this class of miss is a repo-wide grep for the retired selector,
`grep -rn 'composer-status__usage' e2e/`, run *before* declaring a renamed or relocated class's blast radius
closed, not just the specs a plan happens to list.

Security review PASS (builder self-review, #1604), extending #1321's own PASS with the variant/dismissal
addition: neither `status` nor `limitType` reaches markup, an attribute, a class name (chosen by explicit
conditional over the client-owned `variant`) or a key at any of the three new sites (`variant`,
`isUsageReadingDismissed`, the dismissal store). See [#1321](https://github.com/pyrycode/pyrycode-desktop/issues/1321)
and its [architecture spec](../../specs/architecture/1321-usage-limit-in-status-row.md); see
[#1604](https://github.com/pyrycode/pyrycode-desktop/issues/1604) and its
[architecture spec](../../specs/architecture/1604-top-overlay-pills.md) for the move.
