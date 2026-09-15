# #1435 — the task count pill, the status row's last reading

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ComposerErrorSlot` — the `??` chain
  this ticket appends to, and its recorded one-occupant contract; `ComposerErrorSlotControl` — the
  store-bound container that already reads the open conversation and owns every occupant's element;
  `ComposerUsageLimitNotice` — the nearest analogue (a pure view fed a prop, null when there is nothing
  to draw); `ComposerStatusArea` — the row whose `trailing` seam the slot fills; `NO_USAGE_LIMIT_READING`
  — the hoisted stable no-open-conversation selector this ticket's roster read copies.
- `src/renderer/src/store/backgroundTaskRosterStore.ts` → `selectRosterFor`, `BackgroundTaskRosterEntry` —
  the count's source, and the docblock that states the true roster size is `tasks.size + droppedTasks`
  and that a `null` entry means "no frame has ever arrived". Its SECURITY paragraph names `description`
  and `latestUpdate.patch` as untrusted, model-influenced text; this ticket renders neither.
- `src/renderer/src/screens/conversation/BackgroundTaskPanel.tsx` → `BackgroundTaskPanel` — the panel the
  pill opens, already mounted by the screen behind `panelOpen`, reading the roster itself off a
  `conversationId` prop.
- `src/renderer/src/screens/conversation/conversation.css` → `.composer-status`, `.composer-status__usage`,
  `.composer__attachment-name`, `.button-small` — the row's 24px floor and end-alignment, the Pill
  treatment's declarations, and the shrink chain a later occupant must not invert.
- `src/main/transport/inboundMessage.ts` → `parseBackgroundTaskRoster` — `dropped_tasks` decodes through
  plain `requireNumber`, so the count's second addend is an unvalidated daemon-supplied JSON number.
- `docs/knowledge/features/conversation-shell-composer-status.md` § "The usage-limit notice, the slot's
  third occupant" and § "The layout hazard the first review cleared, wrongly" — two lessons that change
  how this is built: an absent occupant must reach the chain as actual `null` (a non-null element whose
  component renders null still wins `??`), and a client-owned string in this slot has already blown the
  row 79px past the pane once, so the last occupant takes the compressible flex treatment rather than
  `flex: 0 0 auto`.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6617 (Pill),
https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=111-3525 (Status area)

The Status area is a full-width row: the turning brand mark and status label at the left, one occupant
right-aligned in the trailing slot (the render shows the actionable-error button there). The Pill is a
single centred text run on a filled rounded rectangle — `px-8 py-4`, `rounded-6px`, M3/body/small at
weight 400 (12px size, 16px line, 0.4px tracking), ground `Schemes/Primary Container`, ink
`Schemes/On Primary Container`. Every one of those measurements is already a token in this app
(`--space-2`/`--space-1`, `--radius-xs`, the `--text-body-small-*` run, `--color-primary-container` /
`--color-on-primary-container`), which is what `.composer__attachment-name` implements today. The
component set draws one state, `Default` — no hover and no focus variant. 16px of line plus 4px twice is
a 24px box under this repo's content-box default, which is exactly `.composer-status`'s rest height.

The tokens are taken BY NAME, never by the export's hex fallbacks: the export bakes `#cfe4ff` as the
ground and `#134a74` as the ink, which is the pair transposed against this app's dark-only scheme —
the standing trap `.composer__attachment-name`, `.composer-status__usage--exhausted` and `.status-row`
each already record.

## Context

The daemon's live background tasks are readable in exactly one place today: the `BackgroundTaskPanel`
behind the More actions menu. Nothing on the conversation surface says a task exists, so a turn that ends
with six tasks still running looks finished. This ticket puts the count in the status row's trailing slot
— the row's attention slot — as its LAST reading, so the operator sees it without opening a menu and
without it ever competing with a fact that matters more.

No ADR is warranted: this adds a fifth occupant to an existing, documented precedence chain rather than a
new seam.

## Design

Three edits, one production module plus one stylesheet.

**`ComposerTaskCount({ count, onOpen })`** — a new pure, exported view in `ConversationScreen.tsx`, the
`ComposerUsageLimitNotice` shape verbatim: a prop, not a store read, because zustand v5's `useStore` reads
`getInitialState()` under `renderToStaticMarkup` and a container test can therefore reach exactly one arm.

- `count: number`, `onOpen: () => void`.
- Returns `null` when `count <= 0`; otherwise one `<button type="button" className="composer-status__tasks"
  onClick={onOpen}>` holding a single text run.
- The run is `count === 1 ? '1 task running' : `${count} tasks running`` — an explicit two-way conditional,
  both literals client-owned. No copy module: #1321 shipped one because its three runs and their
  omission rules needed pinning without rendering; one number and one word do not, and the refiner's
  estimate names that module as the thing this slice does not carry.
- A real `<button>`, not a div with a handler: the accessible name, keyboard activation and the UA focus
  ring all come from the element. No `aria-label` — the visible text is the name. No live region, on the
  standing `ComposerErrorChip` ruling for this row.
- NOT `button-small`: that treatment is the 32px error button, and AC5 requires the row stay at its 24px
  rest height.

**`ComposerErrorSlot`** gains `taskCount?: JSX.Element | null`, appended to the end of the existing chain:
`recovery ?? refusal ?? notice ?? history ?? taskCount ?? null`, still inside the `status.type ===
'connected'` arm. One precedence rule, not a second beside it — every reading above outranks the pill
(AC3) and the non-connected arms keep returning `null` (AC2) with no new branch. OPTIONAL, matching
`recovery` / `refusal` / `history`: `notice`'s required-rather-than-optional docblock argues the other
way, and following it here would rewrite every pre-existing `ComposerErrorSlot` render in the unit suite
for no gain.

**`ComposerErrorSlotControl`** gains `onOpenBackgroundTasks: () => void` and one narrow-slice store read.
It already holds `open` (the active conversation), so nothing but the callback threads down from the
screen — to `() => setPanelOpen(true)`, the same setter the More actions item calls, so the panel and its
menu entry are untouched (AC4).

- `useBackgroundTaskRosterStore(open === null ? NO_TASK_ROSTER : selectRosterFor(open.id))`, mirroring the
  `usageLimit` read two lines up rather than the panel's `useMemo` idiom: a fresh selector identity per
  render costs a re-subscribe and never a loop, because `selectRosterFor` returns the HELD ENTRY ITSELF
  or `null` — both stable references, so `useSyncExternalStore`'s `Object.is` short-circuits even when
  another conversation's write produces a new outer map. `NO_TASK_ROSTER` is hoisted to module scope
  beside `NO_USAGE_LIMIT_READING` for that constant's stated reason.
- `const taskCount = roster === null ? 0 : roster.tasks.size + roster.droppedTasks` — the true roster
  size the store's docblock names, so a capped roster reads its real count. A derived primitive, so no
  memo is needed for reference stability.
- The element is created ONLY when there is something to draw: `taskCount === 0 ? null :
  <ComposerTaskCount count={taskCount} onOpen={onOpenBackgroundTasks} />`. This is the discipline the
  package overview records after #1321 — an absent occupant must reach the chain as actual `null`,
  because `??` does not filter a non-null element whose component renders nothing. At the chain's LAST
  position that rule is not yet load-bearing for precedence (there is nothing below to hide), and saying
  so is more honest than claiming it is; it is kept because it is the house rule the day a sixth occupant
  is appended, and because it makes "no roster observed" and "observed, nothing alive" collapse to the
  one reading AC2 asks for at the one place that decides it.

**`.composer-status__tasks`** in `conversation.css` — its own block, the `.composer-status__usage`
precedent for the same reason that one is not lifted out of `.composer-status__error`: this occupant
shares no colour with any neighbour. It carries the Pill's declarations (padding `var(--space-1)
var(--space-2)`, `--radius-xs`, the four `--text-body-small-*` values at regular weight, the
primary-container pair), the `<button>` resets the UA stylesheet makes necessary (`border: none`,
`font-family: inherit`, `cursor: pointer`), and — deliberately, not by copy-paste from the chip —
`flex: 0 1 auto; min-width: 0` with the `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`
chain rather than `flex: 0 0 auto`. That divergence is the #1321 rework leg's finding applied in advance
rather than re-learned: the one string this element can render is short, but its second addend is an
unvalidated daemon number (see § Error handling), and this is the slot where an unshrinkable occupant has
already pushed the row past its pane. No hover rule and no `outline: none`: the component set draws one
state, so inventing a hover is a client decision with no mandate, and the UA focus ring is the only
treatment the design gives a keyboard operator. No `height` declaration — 16px of line plus 4px twice is
the 24px the row already reserves, and a height beside the padding would render a 32px pill (the trap
`.button-small--error`'s comment records one variant up).

## State + concurrency model

No new store, no new slice, no store change. One additional narrow-slice subscription on the control that
already owns this slot — `backgroundTaskRosterStore` via `selectRosterFor`, which the roster bridge in
`App.tsx` already feeds app-wide. A roster write for a DIFFERENT conversation hands back the same entry
object, so this control does not re-render. Nothing new crosses IPC, no daemon change, no timer, no
effect, no async work, and therefore no cancellation path to define. The panel's open/closed state stays
screen-local `useState` (ADR 0006) with the pill as a second writer of the same setter.

## Error handling

There is no failure mode to surface: every input is already-parsed renderer state and the view is total.
Two inputs are nonetheless worth naming.

- `droppedTasks` reaches the sum as an unvalidated daemon-supplied JSON number (`requireNumber` in
  `parseBackgroundTaskRoster` checks the type and nothing else). A negative or hostile value cannot
  inject anything — it is a number, and React renders numbers as text with no markup, attribute or URL
  sink — so the only reachable consequence is a nonsense or oversized READING. The `count <= 0` gate
  makes a negative sum read as absent, and the shrink chain above bounds an oversized one to the slot.
  No clamp and no integer check is added: those would defend a failure nobody has observed, and a hostile
  daemon that can set this field already authors the conversation's entire contents.
- `roster === null` ("no frame has ever arrived") and an entry holding nothing alive are distinct store
  readings, deliberately kept apart by `selectRosterFor`. Both are `count === 0` here and both are absent
  (AC2), which is a collapse this surface is entitled to make and the panel is not.

## Testing strategy

Vitest only, in `ConversationScreen.test.tsx`, on the pure views — the ticket's own call, and correct:
nothing under `e2e/` sends roster frames today, and the container's server render can only ever reach the
`disconnected` arm.

- **`ComposerTaskCount`**, a new describe: six tasks render the plural copy and the pill class; one task
  renders the singular and NOT the plural string; a zero count renders the exact empty string (the strict
  form the neighbouring describes use — a `not.toContain` passes on a rendered-but-empty wrapper, which
  is precisely AC2's failure); the markup carries `composer-status__tasks` and NOT
  `composer-status__error`; it is a real `<button type="button">` with no `aria-label`.
- **`ComposerErrorSlot` precedence**, extending the existing describe with a sentinel pill element (the
  #1321 sentinel technique, so this block asserts ordering and nothing about the pill's own markup): it
  yields to the repair button, to the connection-error chip, and to each of `recovery`, `refusal`,
  `notice` and `history` in turn, every arm asserted in BOTH directions per the describe's standing rule;
  it fills the slot while connected with nothing above it; it renders nothing at all while
  `disconnected` and while `connecting`; and a connected slot with the prop OMITTED renders the exact
  empty string, which is what pins the prop as genuinely optional.
- No new assertion can distinguish "never observed" from "observed, nothing alive" — both are
  `count === 0` by design, and the collapse happens in the container expression rather than in a view.
- Existing `ComposerErrorSlot` renders are untouched: the prop is optional.

Visual check per `docs/visual-review.md`: a static component screenshot of the pill compared against the
Figma Pill node, recorded in the PR.

## Open questions

- Whether the pill should carry a hover treatment. Resolved in the design above rather than left open:
  the component set draws only `Default`, so none is added.

## Documentation handoff

**Pending — owned by the documentation stage.** Fold the new reading into
`docs/knowledge/features/conversation-shell-composer-status.md`, whose occupant list and precedence order
this changes (the slot's chain becomes recovery → refusal → notice → history → task count). That file is
49764 bytes against `npm run check:docs`'s 50000-byte cap, so the fold needs the split the guard's message
prescribes — split at its `##` headings, keeping the parent as a map — not an append. Not done in this
ticket: the builder does not write under `docs/knowledge/`.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings, and the boundary is structural rather than conventional. The roster
  store holds four classes of untrusted, model-influenced daemon text — `description` (for
  `taskType: local_bash` the literal command line claude ran), `latestUpdate.patch`, `taskType` and
  `truncatedFields` — and this slice reads NONE of them. The boundary is the single expression
  `roster.tasks.size + roster.droppedTasks` in `ComposerErrorSlotControl`, and `ComposerTaskCount`'s prop
  is typed `count: number`, so no string from that store can reach the view at all. Downstream of it, the
  only interpolation is `${count}` into a TEXT run, which React escapes; `className` is a single literal
  with no interpolation, avoiding by construction the trap `ComposerUsageLimitNotice`'s docblock records
  (a treatment interpolated into a template being one edit from an untrusted value in an attribute).
  Nothing here reads a `Record` keyed by a daemon string, so the `__proto__` / `constructor` hazard that
  governs `usageLimitNotice`'s window lookup has no analogue.
- **[Tokens, secrets, credentials]** No findings — no credential is read, stored or derived. The related
  decision is that NOTHING here is logged: no diagnostic on render, none on click, no `console.*`. That is
  deliberate on `usageLimitNotice`'s recorded reasoning, sharpened: a task count is a fact about the
  operator's session, and even a content-free count in a log file is the first crack in a property that
  has to be total. It is also what keeps this ticket clear of `setUpdatedTask`'s deliberately silent miss
  branches, which exist precisely so patch text never reaches a file.
- **[File / storage operations]** No findings — no path, no `fs`, no `localStorage`, no IndexedDB. The
  decision that makes this hold is that the pill keeps NO state of its own: it holds no `useState`, caches
  no count, and derives the number at render from the store. `backgroundTaskRosterStore`'s docblock
  requires that a departed pairing's command lines and patches cannot survive `clearAllRosters`; a cached
  count in component state would have survived that boundary until the next unrelated render, and a
  persisted one would have survived it outright. Neither exists.
- **[Inter-process / Electron attack surface]** No findings — nothing new crosses IPC, no preload API, no
  channel, no `webPreferences` change, no navigation guard, no protocol handler, no remote content. Worth
  naming: `onOpenBackgroundTasks` is a pure renderer `setState` and does NOT dereference `window.pyry`,
  unlike `handleRepair` in the same control. A renderer compromise gains no capability from this control
  that it did not already hold.
- **[Cryptographic primitives]** Not applicable — no RNG, no hashing, no key material, no comparison
  against a secret. No Noise surface is touched; the transport stays in the main process, untouched.
- **[Network & I/O]** Not applicable — no socket, no URL, no fetch, no frame, no timeout to set. The data
  path is `backgroundTaskRosterBridge`, already app-wide in `App.tsx`; this ticket adds a reader to an
  existing store and nothing to the wire.
- **[Error messages, logs, telemetry]** No findings — the views are total (no throw, no reject branch)
  and emit no error surface and no telemetry. See the logging decision under Tokens above.
- **[Concurrency]** No findings, and one hazard the design avoids rather than never had: the click
  closure captures NO conversation id. `onOpenBackgroundTasks` flips a screen-local boolean, and
  `BackgroundTaskPanel` resolves `activeConversation?.id` at its OWN mount — so a conversation switch
  between the pill's render and the operator's click opens the panel for the conversation now on screen,
  not the stale one. Threading `open.id` through the callback would have been the natural shape and would
  have opened a departed conversation's command lines. Otherwise: no async work, no timer, no listener,
  no effect; the one added subscription is `useSyncExternalStore`'s, torn down by React on unmount.
- **[Threat model — hostile daemon response]** Stated residual, no fix. `dropped_tasks` decodes through
  plain `requireNumber` in `parseBackgroundTaskRoster`, so any JSON number reaches the sum. Walked
  concretely rather than waved past, because #1321's review failed in this exact slot by clearing a
  layout hazard on the grounds that no daemon string entered the path while never weighing string LENGTH:
  a negative or fractional value yields an absent pill (the `count <= 0` gate) or a nonsense reading;
  a maximal one yields at most ~24 characters, because JS `Number`→`String` is bounded (`Number.MAX_VALUE`
  stringifies to 23 characters), so the widest reachable run is roughly 37 characters against the 294px
  this slot has at the app's 800px minimum window — it fits without even compressing. The value is a
  number, not a string, so there is no markup, attribute, URL or `className` sink to reach. No clamp and
  no integer check is added: that would defend a failure nobody has observed, and a daemon that can set
  this field already authors the conversation's entire contents. The shrink chain in
  `.composer-status__tasks` stands on the OBSERVED #1321 overflow in this slot, not on this residual.
- **[Threat model — malicious / compromised relay]** No findings. The relay is on-path and content-blind:
  it can drop, delay, reorder or flood roster frames, so the count can be stale or inflated. That is a
  reading, and nothing acts on it — `backgroundTaskRosterStore`'s docblock warns that `tasks` is a DISPLAY
  set and not a work list something iterates, and this slice reads `.size` without iterating it at all.
- **[Threat model — cross-conversation / cross-server disclosure]** OUT OF SCOPE, pre-existing, named
  rather than skipped. `selectRosterFor(open.id)` keys on the open conversation, and no open conversation
  reads `null`, so nothing leaks between conversations by this ticket's own construction. The residual is
  one layer down: `backgroundTaskRosterStore` is keyed by conversation id ALONE, with no server origin, so
  two paired servers issuing the same conversation id would share an entry. That is a property of the
  store's keying — `BackgroundTaskPanel` has the identical exposure today and shows the task DESCRIPTIONS
  where this pill shows only a number, so this ticket strictly reduces what is reachable rather than
  widening it. Not this ticket's to fix; it belongs to whoever next revisits that store's key, alongside
  `resetRostersFor`'s already-documented "a conversation in no server's list is left alone".

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-15
