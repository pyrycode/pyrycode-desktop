# #873 — the amber input-required status and its dot

The fourth and highest-precedence `ConversationStatus`, its resolver branch, its accessible label and its
amber ring. Everything except the call site, which is #874.

## Files to read first

Codegraph is **not indexed for this repo** (`codegraph_status` → "CodeGraph not initialized", still true on
2026-09-01), so this list is grep- and Read-derived. Do not spend a turn re-probing it.

- `src/renderer/src/store/conversationStatus.ts` (whole file, 119 lines) — the module this ticket changes.
  Read the header's HARD IMPORT CONSTRAINT and SECURITY paragraphs before touching anything: the single
  `import type` is the module's only import and must stay one, and there is deliberately no
  `conversationId` parameter. Lines 63-66 are the reserved slot this ticket fills.
- `src/renderer/src/store/conversationStatus.test.ts` (whole file, 85 lines) — the 10 existing calls that
  gain a leading argument, plus the `activity()` fixture builder and the header's list of properties
  invisible to `tsc`.
- `src/renderer/src/screens/channels/ConversationStatusDot.tsx:20-73` — `STATUS_LABELS`
  (`Record<ConversationStatus, string>`, exhaustive **by type**) and the one-`<span>` component.
- `src/renderer/src/screens/channels/ConversationStatusDot.test.tsx` (whole file, 79 lines) — the marker
  constants, `ALL_STATUSES`, and the pairwise-distinct / collision-guard assertions. `ALL_STATUSES` is the
  silent-miss hazard called out under § The one hazard `tsc` will not catch.
- `src/renderer/src/screens/channels/channels.css:850-919` — #800's whole dot block: the geometry base, the
  inset-`box-shadow` ring rationale, the two painted modifiers, the `--idle` no-rule comment, the blink
  keyframes and the reduced-motion guard. The new rule joins this block.
- `src/renderer/src/screens/channels/ChannelList.tsx:713-770` — `ConversationStatusDotControl`, the one
  production caller. Read the "Five things this must not become" list; the call site edit here is a single
  argument and nothing else.
- `src/renderer/src/screens/channels/ChannelList.test.tsx:167-176` and `:790-834` — the seeded-row status
  assertions. **No edit is needed in this file**; it is already the regression guard for the call-site
  change (see § The call site).
- `src/renderer/src/theme/tokens.css:61-74` — `--color-success`, `--color-error`, `--color-warning`
  (`#ffca45`) and the comment recording why the amber exists and what it already means.
- `src/renderer/src/store/modalPrompts.ts:234-257` — `selectHasOutstandingFor`, the boolean this status
  will eventually be fed from. **Context only — do not import it in this ticket.** That is #874.
- `docs/knowledge/features/conversation-status.md` — the resolver's shipped doc, including the
  mutation-check discipline and the note that a precedence-test failure alone is ambiguous.
- `docs/knowledge/features/conversation-status-dot.md:33-77` — why the label map is a `Record` and not a
  `switch`, why the ring is an inset shadow, and why the working ring is `--color-primary` rather than the
  Figma node's bound `#32628d` (a 2.90:1 contrast rejection inherited from #719).

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=106-3051

Read on 2026-09-01: node `106:3051` (`Status dot`) is a local instance with **no variants** — a 6×14 frame
whose only content is a single unfilled 6×6 circle stroked 1px, rendered as one flat SVG. That one drawn
state is the blue *working* ring; there is no amber node in the file and none is missing. This ticket's
**colour** comes from the operator's design-notes table in the ticket body (yellow = input required) and its
**form** — a 1px unfilled ring in a 6×6 box, no background — is the family the three shipped states already
established in `channels.css:850-892`. Nothing about the frame, the box or the geometry changes.

## Context

`resolveConversationStatus` ships three of the sidebar's four designed dot states. The fourth, input
required, was reserved at position 0 in the resolver's docstring (`conversationStatus.ts:63-66`) with the
reason it could not be built: no `conversation_id` rode a modal frame, so an outstanding prompt could not be
attributed to a conversation.

That reason has cleared, over four tickets — #870 put the id on the wire, #871 onto `DaemonEvent`, #877 onto
`ModalEvent`'s `shown` arm, #878 onto the held `ModalPrompt` with `selectHasOutstandingFor(conversationId):
boolean`. The resolver has a boolean to consume; it does not consume it yet.

This ticket adds the status, the branch, the label and the paint. It lands **correct but unreachable**: the
one production call site passes a literal `false` until #874 composes the selector there, the same way #799
and #800 each landed before #801 wired them.

Two things make the scope of the work non-obvious and both are settled below: the union member and its label
cannot be split apart (the label map is exhaustive by type, so the member alone reds the typecheck — which
is the salvage gate), and the new parameter goes **first**, which forces a one-argument edit at the existing
call site.

## Design

### 1. The union member — `conversationStatus.ts`

`ConversationStatus` gains `'input-required'` as its **first** member, above `'working'`, so the type keeps
reading as the precedence rule (AC1). Kebab-case, matching the three siblings and every other client-owned
union in the repo; not a wire string, never rendered directly.

The type's docstring says "none of the three carries a payload" — that count becomes four. The reasoning
(literal union rather than a discriminated union of objects) is unchanged and stays.

### 2. The signature — a leading required boolean

```ts
resolveConversationStatus(
  inputRequired: boolean,
  activity: ConversationActivityEntry | null,
  unread: boolean
): ConversationStatus
```

**First position, required, not optional-and-trailing.** The docstring states "PARAMETER ORDER IS THE
PRECEDENCE ORDER — a reader who has the signature has the rule", and input required is precedence 0. An
optional parameter cannot occupy the first position in TypeScript, so "keep the order the rule" and "leave
the existing call site untouched" are mutually exclusive here; the ticket's Technical Notes pick the order,
and this spec follows it. The consequence — `tsc` red at `ChannelList.tsx:767` until that call is updated —
is the enforcement, not a cost: it makes the placeholder impossible to forget and makes #874 a one-token
change at a marked point.

A `boolean`, not a `conversationId`. The id-to-fact lookup stays at the caller, exactly as the activity
entry and the unread boolean already do; the module's SECURITY paragraph states the absence of an id
parameter as a condition of its own signature and that condition is preserved unchanged. **The single
`import type` stays the module's only import** — do not import `selectHasOutstandingFor`, `modalStore`, or
anything else. The module must keep zero runtime dependencies.

### 3. The branch

One early return, first, above the `isWorking` check. The flat one-line-per-level shape stays; do not
convert it to a `switch` or a lookup table.

The docstring's reserved slot 0 (`:63-66`) is **replaced**, not amended: it names #802 (since split into
#873/#874) and states the blocker as open, both stale. The replacement states the real branch — the
`inputRequired` boolean, derived at #874's call site from `selectHasOutstandingFor` — and keeps the existing
"the order is what a green suite most easily misses" paragraph, extended to name the new precedence test.

Also update, in the same file, the SECURITY paragraph's "returns one of three client-owned literals" →
"one of four", and its "reads four booleans" → "reads booleans only" (the module now takes a sixth boolean
input, and the count was already loose).

**Out of scope, deliberately:** the file header's `:3-4` claim that "#800 draws the dot ... neither exists
yet, so nothing imports this today" is already false on `main` and is not made false by this ticket. Leave
it. The documentation phase owns it.

### 4. The label — `ConversationStatusDot.tsx`

`STATUS_LABELS` gains `'input-required': 'Input required'`, placed **first** in the record so its key order
keeps mirroring the type's declaration order. The copy is the design-notes table's own wording, a
client-owned constant in the app's own voice.

This entry and the union member **must land in the same commit**. `STATUS_LABELS` is a
`Record<ConversationStatus, string>`, exhaustive by type — that was #800's deliberate choice so a fourth
status would be a `npm run typecheck` failure rather than a silently unlabelled dot, and `npm run build`
runs typecheck first, so a member without a label fails the salvage gate. This is why the usual
type-then-component split does not apply.

Update the record's docstring, which currently forecasts this ticket as "#802's reserved fourth status":
rewrite it to record that the record now carries all four and that exhaustiveness-by-type is what forced the
member and the label to ship together. Update the component's header count, "one of three client-owned
literals" → four.

The component body itself does **not change**. The class is already interpolated from the status
(`conversation-status-dot--${status}`) over a closed, client-owned union, and `role="img"` +
`aria-label` already carry the name.

### 5. The paint — `channels.css`

One new rule, appended after `.conversation-status-dot--new-messages` (`:886-888`) so the modifier family
stays contiguous. Do **not** insert it between the shared ring comment (`:867-880`) and
`--working`; that comment governs the whole family and splitting it from its first rule loses the pairing.

- `box-shadow: inset 0 0 0 1px var(--color-warning)` and nothing else. Identical form and width to its two
  painted siblings.
- **No `background`.** It is a ring. A filled amber disc would collide with `.conn-dot--in-progress`
  (`conversation.css:1817`), which is filled amber and reports whether a *machine* is reachable; the ring
  form is the whole of what keeps the two readings apart six pixels away in the same sidebar.
- **Never a `border`.** This repo has no global `box-sizing` reset (`conversation.css:750`), so a 1px border
  would grow the 6px box to 8px and shift the row title — which is AC4. An inset shadow has zero layout
  effect by construction.
- **No animation, and no `prefers-reduced-motion` entry.** The blink and its fallback belong to `--working`
  alone; a dot blocked on the operator has no reason to animate, and the reduced-motion guard at `:915-919`
  stays scoped to the working modifier.
- Token name only, never the hex.

Contrast, so it is not re-measured: `#ffca45` reads **12.3:1** against `--color-surface` (`#101418`) and
**8.1:1** against `--color-surface-container-highest` (`#32353a`). The #719 rejection that forced
`--color-primary` over the Figma node's bound `#32628d` (2.90:1) does not recur here, and no substitution is
needed.

Add a short comment above the rule covering the three rulings above (amber token, ring-not-disc against the
`.conn-dot--in-progress` reading, deliberately no blink). Keep it to a few lines; the family's shared
comment already carries the inset-shadow rationale.

### 6. The call site — `ChannelList.tsx:767`

One argument, a literal `false` in first position, with a short inline comment naming #874 as what replaces
it. That is the entire edit to this file.

**Do not wire `selectHasOutstandingFor` here.** A fourth `use*Store` subscription in
`ConversationStatusDotControl` is #874's whole deliverable, including its own tests and the re-render
argument for a boolean-returning selector. Adding it here would make this ticket reachable, untested at the
call site, and would leave #874 with nothing.

`ChannelList.test.tsx` needs **no edit** and is already the guard for this line. Its seeded-unread case
(`:816-819`) asserts the `--new-messages` marker on a specific row; a transposed call —
`resolveConversationStatus(isConversationUnread(…), activity, false)`, which `tsc` cannot catch since both
outer parameters are `boolean` — renders `--input-required` there instead and fails that assertion. The
seeded-working (`:794-799`) and all-idle (`:764`) cases pin the rest.

### The one hazard `tsc` will not catch

`ALL_STATUSES` in `ConversationStatusDot.test.tsx:26` is `readonly ConversationStatus[]` — an **array**, not
a `Record`. Adding a union member does not make a three-element array a type error, so if the array is left
at three: the new status goes untested, `expect(new Set(ALL_STATUSES.map(dot)).size).toBe(3)` still passes,
the collision guard never sees the new class, and the suite is green with a quarter of the component
uncovered.

Extend the array to four (`'input-required'` first, mirroring the type) **and** bump the distinctness
assertion to `4`. Do not restructure the constant into a type-exhaustive form: the design's status table has
exactly four states and no fifth is planned, so a guard for a fifth would be a defense for a failure mode
that has not been observed.

## State, concurrency, and error handling

Nothing to model. `resolveConversationStatus` stays a total pure function with no store, no async work, no
subscription and no teardown; `ConversationStatusDot` stays a pure function of one prop with no state and no
effect. Every input is a defined reading — there is no throw path, no failure mode, no result type and no UI
error path, so the module keeps its log-free construction and no `console.*` appears on any path.

The only new runtime cost at the (unwired) call site is one extra `false` per row per render.

## Testing strategy

`npm test` (vitest, `environment: 'node'`) plus `npm run typecheck`. **Do not add a DOM environment.**

### `conversationStatus.test.ts`

All 10 existing calls gain a leading literal `false`. Pass the literal at every call — do not introduce a
wrapper that defaults the parameter, which would hide from the existing tests exactly the argument this
ticket adds. The existing assertions and their comments are otherwise unchanged; the working-and-unread
precedence test (`:70-74`) now additionally pins that `inputRequired: false` does not hijack.

New scenarios, all asserting `'input-required'`:

- The fact alone: input required, no activity entry, not unread.
- **Input required and working** — the precedence-0 test. An implementation that checks `isWorking` first
  compiles clean, passes every other test in the file, and fails only here.
- Input required and unread, with no activity entry — outranks new messages.
- Input required, all four activity facts true, and unread — AC2's "also working, also unread, or both" at
  full strength.

Extend the file header's list of properties invisible to `tsc` with the new precedence level, and record the
mutation check in the PR the way the module's doc already does for the other three: moving the
`inputRequired` return below `isWorking` fails the second and fourth scenarios above and nothing else.

### `ConversationStatusDot.test.tsx`

- A fourth marker constant, the **full** class attribute value
  (`class="conversation-status-dot conversation-status-dot--input-required"`, closing quote included) — the
  same form as its three siblings, which is what pins base and modifier together and defends AC4.
- `ALL_STATUSES` extended to four; the pairwise-distinct assertion bumped from 3 to 4.
- `aria-label="Input required"` asserted as a literal, alongside the three shipped ones.
- The `role="img"`, one-dot-per-status and class-collision loops all iterate `ALL_STATUSES` and extend for
  free once the array grows.
- Header comment: "the whole matrix is three renders" → four.

### What is not covered, and must not be claimed as covered

**The amber itself.** Renderer specs are `renderToStaticMarkup` with no DOM and no CSSOM, so the unit tier
proves the union member, the resolver's precedence, the class token and the label — never a computed colour.
The colour ships with exactly the standing the other three colours already have: a CSS-level guarantee.
Do not write an assertion that appears to check it, and do not add a DOM environment for it.

e2e coverage for this component stays at zero, as it has since #800. Not a deliverable here.

## Scope

Six files, of which **three** are production `.ts`/`.tsx`:

| File | Change |
| --- | --- |
| `src/renderer/src/store/conversationStatus.ts` | union member, leading parameter, branch, docstrings |
| `src/renderer/src/store/conversationStatus.test.ts` | 10 calls + 4 new scenarios |
| `src/renderer/src/screens/channels/ConversationStatusDot.tsx` | one label entry + docstrings |
| `src/renderer/src/screens/channels/ConversationStatusDot.test.tsx` | marker, array, count, label |
| `src/renderer/src/screens/channels/channels.css` | one modifier rule + comment |
| `src/renderer/src/screens/channels/ChannelList.tsx` | one literal argument + comment |

Projected total written work ~120 lines. Size **XS**, agreeing with PO.

**Call-site count, stated rather than glossed.** `resolveConversationStatus` has 11 call sites: 1 in
production (`ChannelList.tsx:767`) and 10 in `conversationStatus.test.ts`. The raw 11 is above the
10-call-site red line, so it is worth being explicit about why this is not a split rather than leaving the
count implicit:

- Ten of the eleven are inside the module's **own** suite, which this ticket rewrites regardless — the new
  precedence scenarios land in that same file. They are not a consumer cascade across modules, which is the
  shape the red line was calibrated on (#29: five test files; #75: 26 sites across many files).
- **The work is atomic by construction and has no buildable seam.** `STATUS_LABELS` is exhaustive by type,
  so a child shipping the union member without the label fails `npm run typecheck` — the salvage gate. Any
  split of type / label / branch produces at least one child that cannot go green. The only clean seam is
  the call site, and that is already split off as #874.

No branch overlap: `git fetch origin --prune` plus a diff of every `origin/feature/<n>` against `main` on
2026-09-01 found no other in-flight branch touching any of the six files.

## Open questions

1. **The idle dot's always-announced label does not generalise into a problem here.** #800 recorded that a
   sidebar of mostly-idle rows announces "Idle" once per row and left a possible `aria-hidden` fix unfiled.
   Input required is precisely the state that *should* be announced, so it needs no such treatment — noted
   only so the next reader does not import the idle question into this one.
2. **Row ordering is unchanged, and the sidebar sorts by recency rather than by status.** A conversation
   waiting on an answer can still sit far down the list where an amber dot is easy to miss. Out of scope for
   this ticket and for #874; worth filing separately if the operator finds it in use.
