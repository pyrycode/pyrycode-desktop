# 697 — Toggle a resolved tool row open and closed

Ticket: [#697](https://github.com/pyrycode/pyrycode-desktop/issues/697) · size **S** · labels `enhancement`, `size:s`, `security-sensitive`
Split from #669. Consumes #696 (`ToolRow` + the expanded body). Feeds #645 (per-input-field list inside the same body).

---

## Files to read first

> **Tooling note.** `codegraph_context` was run first, per the architect workflow, and failed with
> `CodeGraph not initialized for this project` — `.codegraph/` in this repo holds only `.gitignore` +
> `config.json`, no database. Every `codegraph_*` query fails identically, so this reading list and the
> call-site counts below were built from `grep -n` + targeted `Read` and each line ref was re-verified
> against `f77ba3c`. Treat the list as hand-built, not as a skipped codegraph step.

| Path | What to extract |
|---|---|
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:601-674` | `ToolRow` as #696 left it: the `expanded` prop, `const body = expanded ? result : null`, the chip/body sibling split, and the SAFETY block at `:616-626`. **This is the only production file you change.** |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:679-733` | `UnrecognizedRow` — the repo's existing expand/collapse. `useState(false)` at `:700`, the real `<button aria-expanded onClick>` at `:703-707`, the rationale comments at `:679-694`. Copy this shape. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:550-556` | The `toolCall` switch arm. It returns `<ToolRow item={item} />` and **stays exactly as it is** — nothing new is threaded through it. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:452-498` | `Timeline` / `TimelineRow`. Read the index-key comment at `:466-471`; you are relying on it, not changing it. Neither signature is touched. |
| `src/renderer/src/screens/conversation/conversation.css:920-1000` | `.tool-row`, the three modifiers, `.tool-row__chip` (`:960-971`), `.tool-row__name` (`:976-985`), `.tool-row__summary` (`:990-1000`). Note which of these set `font-family` and which inherit — § 5 turns on it. |
| `src/renderer/src/screens/conversation/conversation.css:2534-2559` | `.unrecognized-row__summary` — the in-repo "a real button, reset to look like a row" treatment, plus its `:hover`. The semantic precedent; **not** the visual one. |
| `src/renderer/src/screens/conversation/conversation.css:9-19` | `.conversation` sets `font-family: var(--font-sans)` at `:15`. This is the inheritance chain a `<button>` would break. |
| `src/renderer/src/store/threadTimeline.ts:252-275` | `fillResult` — resolves a `toolCall` **at its own index** via `items.map`. The evidence for AC3's "no row inherits another row's expansion". |
| `src/renderer/src/store/threadTimeline.ts:540-551`, `:609-616` | The `reset` arm returns `initialTimelineState`, whose `items` is `[]`. The evidence for AC3's second half. |
| `src/renderer/src/activateConversation.ts:68-80` | The one reset path that leaves the screen mounted: `dispatchTimeline({ type: 'reset' })` at `:75`, guarded on the id changing. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:341-450` | #696's `ToolRow` block — the 8 render sites, 7 of which pass the flag. Your rename lands here. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:2260-2300` | The `UnrecognizedRow` unit tests — the pattern for asserting a disclosure button's markup under `renderToStaticMarkup`. |
| `e2e/unrecognized-message.spec.ts` (whole file, 131 lines) | **The template for AC5.** Push a frame → assert collapsed + `aria-expanded="false"` + payload absent → click → assert expanded → click → assert absent → keyboard path. Your spec is this file with tool frames substituted. |
| `e2e/thread-scroll-pin.spec.ts:105-117` | `toolUseFrame()` — the existing pending-tool-call frame helper, and the proof (`:275`, `:327`) that `daemon.pushFrame` delivers a `tool_use` unsolicited. |
| `src/shared/wire/types.ts:720-747` | `ToolUsePayload` and `ToolResultPayload` field-for-field. You need both to build the two e2e frames. |
| `docs/knowledge/decisions/0006-ephemeral-screen-state-usereducer-not-store.md` | The ADR this design cites. Read what it actually says about scope before writing the placement comment. |
| `CLAUDE.md` § Conventions, the 2026-08-20 operator ruling | The daemon-text rule that § 6 enforces. Read the exact wording — it draws a line between *rendered children* and *attributes/logs*, and this ticket sits right on it. |

---

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-28

Node `16-28` is a 380×33 frame at 50% opacity (the pending dimming) wrapping chip `16-29`: a hug-width
single-line pill — `surface-container` fill, 1px `outline-variant` border, 12px radius, 12/8px padding,
8px gap, `overflow: clip` — holding `read_file` in 13px Roboto Mono `tertiary` (`16-30`) and
`kitchenclaw/db/schema.ts · 184 lines` in M3 body-small `on-surface-variant` (`16-31`). It is already
implemented exactly by `.tool-row__chip` and its two child rules; **the collapsed form must not move off
it**, and this ticket adds no element to it.

**N/A for the toggle affordance itself.** `16-28` models no disclosure control — no chevron, no third
slot, no hover or pressed state; at 33px there is nowhere to put one. Per the ticket body, the
affordance takes `.unrecognized-row__summary`'s *semantics* (a real `<button>`, `aria-expanded`,
`cursor: pointer`, a hover tint) inside the chip's *own* box, and the expanded body's visual language was
already settled by #696 off `.unrecognized-row__raw`. Nothing here needs the operator.

---

## Context

#696 gave `ToolRow` an expanded branch and a result body, and deliberately shipped no way to reach it:
the arm at `:550-556` passes no flag, so every row in the product renders collapsed. The flag exists only
so the server-render test tier can observe the expanded markup at all.

This slice supplies the missing half — the control that flips it — and the one test tier that can prove a
click works. It is the last piece of the tool-row expand feature before #645 lands its input-field list
inside the same body.

The whole design question is *where the boolean lives*, and the ticket body already settled it against
the hoisted `toolUseId`-keyed set that an earlier revision mandated. § 2 records why, because the comment
you write in the code has to say it.

---

## Design

### 1. Scope of change

| File | Change | New? |
|---|---|---|
| `src/renderer/src/screens/conversation/ConversationScreen.tsx` | `ToolRow` only (`:601-674`): one `useState`, one prop rename, one element fork, comment updates | no |
| `src/renderer/src/screens/conversation/conversation.css` | one new rule + its `:hover`, appended after `.tool-row__chip` | no |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` | 7 mechanical attribute renames + 3 new cases | no |
| `e2e/tool-row-toggle.spec.ts` | the AC5 spec | **yes** (the only new file) |

Not touched, and this is load-bearing: `Timeline`, `TimelineRow`, the `toolCall` arm, `threadTimeline.ts`,
`timelineBridge.ts`, `activateConversation.ts`, `pairedRoute.ts`, any store, any IPC channel, any wire type.

### 2. The state lives in `ToolRow`

`ToolRow` becomes uncontrolled: `const [expanded, setExpanded] = useState(defaultExpanded)`.

This is the same shape `UnrecognizedRow:700` has shipped with since the row landed, and it is what ADR
0006 asks for — *the lowest scope that resets correctly*, not "the container". The container's four
booleans (`sheetOpen` / `channelInfoOpen` / `pickerOpen` / `panelOpen`, `:140-156`) sit at the screen
because they are screen-level facts (one sheet at a time for the whole screen); a per-row disclosure is a
row-level fact. Write that distinction into the placement comment — the next reader will otherwise
re-derive the hoist from the same four neighbours.

The note at `:539-540` ("hooks cannot be called from inside this switch") does **not** block this. It
forbids hooks written *inline in a switch arm*; an arm may return a component that holds hooks, which is
exactly what `:597` already does for `UnrecognizedRow`.

**AC3, first half — no row inherits another row's expansion.** Rows are keyed by array index
(`Timeline:472-477`), so this holds only if index → logical item is stable. It is, and the evidence is
every write to `items` in the reducer: `appendDelta` grows the tail in place (`:295`), six arms append a
new tail (`:306`, `:387`, `:414`, `:426`, `:454`, …), `fillResult` replaces one `toolCall` **at its own
index** via `items.map` (`:265-274`), `reset` returns `[]` (`:551`), and every remaining arm returns
`state.items` unchanged. There is no insert, no reorder, and no wholesale replacement anywhere in the
file — verified across all 16 `items:` sites. A `ToolRow` instance therefore stays bound to one logical
tool call for its whole life, including across the pending → resolved transition (`fillResult` changes
the item's `result`, not its position, so React keeps the instance and its `false`).

**AC3, second half — no row survives expanded across a thread reset.** `reset` returns
`initialTimelineState` (`threadTimeline.ts:551`) whose `items` is `[]` (`:609-616`); `Timeline` then
returns `<EmptyThread />` (`:461`) instead of the thread container, so every row unmounts and its boolean
goes with it. The one reset path that leaves the screen mounted is the in-thread `conversation_created`
confirm (`activateConversation.ts:75`, guarded on `previous?.id !== conversation.id`), and it goes through
that same arm. **Nothing needs clearing.** This is the concrete saving over the hoisted design, which
would have had to clear a `Set` explicitly on a path that is easy to miss.

Do not add a `useEffect` to reset anything. There is nothing to reset.

### 3. The chip element forks on `result`

The chip *is* the control — the whole pill is clickable. The Figma pill has two runs and no third slot,
so a separate glyph button would add an element the design does not model; making the pill itself the
button adds none and leaves the collapsed geometry identical.

Contract sketch (`ToolRow`'s return, the chip half only — the body half from #696 is unchanged):

```tsx
// resolved → the control
<button
  type="button"
  className="tool-row__chip tool-row__chip--toggle"
  data-thread-role="tool"
  aria-expanded={expanded}
  onClick={() => setExpanded((open) => !open)}
>
  {/* the same two spans, unchanged */}
</button>

// pending (result === null) → today's markup, byte-for-byte
<div className="tool-row__chip" data-thread-role="tool">…</div>
```

Both branches carry the identical two children (`.tool-row__name`, `.tool-row__summary`) and the identical
`data-thread-role="tool"`. Fork the element, never the children.

**Why a fork and not one always-rendered `<button disabled>`:** AC2 says a pending row's treatment is
*unchanged*, and a disabled button is still a control in the accessibility tree, still needs the reset CSS,
and still changes the pending markup. Forking leaves `:646` literally untouched for the pending case, which
makes AC2 provable from the diff rather than from a test.

**Gate the fork on `result`, not on `expanded`.** `result !== null` is the same condition `rowClass`
already reads at `:635`; reuse it rather than introducing a second predicate that could drift. A pending
row must be non-activatable *regardless* of what `defaultExpanded` says — `const body = expanded ? result
: null` (`:642`) already makes the body structurally unreachable when pending, and the chip fork must be
the same kind of structural fact.

### 4. `expanded` → `defaultExpanded`

The prop's meaning genuinely changes: it was a controlled value, it becomes the mount-time initial value.
Rename it. `defaultExpanded` is React's own convention for exactly this (`defaultValue`, `defaultChecked`),
and the alternative — a prop named `expanded` that a re-render cannot change — is the kind of quiet lie
that costs the next reader a debugging session. `renderToStaticMarkup` never re-renders, so #696's
assertions hold verbatim under the new name.

Seven call sites, all in `ConversationScreen.test.tsx`: `:369`, `:386`, `:398`, `:404`, `:414`, `:425`,
`:438`. (The eighth `<ToolRow` site, `:358`, passes no flag; the one production site, `:556`, passes no
flag either and is not edited.)

> **Do not `replace_all` the bare token `expanded` in that file.** It would corrupt `aria-expanded` at
> `:1718`, `:1729`, `:2273` and the class token `tool-row--expanded` at `:361`, `:372`, `:388`, `:406`,
> `:449`. Edit the seven JSX attribute occurrences.

`ToolRow` stays exported and its prop stays optional, so #696's default (`= false`) survives unchanged.

### 5. CSS — one additive rule

`.tool-row__chip` (`:960-971`) is **not edited**. Zero deletions in that rule is what makes AC2's "pending
treatment unchanged" readable straight off the diff. Append a new rule after it:

`.tool-row__chip--toggle` supplies only what a UA `<button>` would otherwise inject or override:

| Declaration | Why |
|---|---|
| `font-family: var(--font-sans)` | **Load-bearing, not cosmetic.** `.tool-row__summary` (`:990-1000`) deliberately sets no `font-family` and inherits `--font-sans` from `.conversation:15`. A `<button>` sets its own `font-family`, which would silently re-parent that inheritance to the UA font. `.tool-row__name` sets `--font-mono` explicitly and is unaffected. |
| `color: var(--color-on-surface)` | Parity with `.unrecognized-row__summary:2547`. Both children set their own colour, so this is defensive rather than observable — keep it for the precedent's shape. |
| `text-align: left` | The UA's `center` would centre `.tool-row__summary`'s text inside its ellipsized box. |
| `cursor: pointer` + `:hover { background: var(--color-surface-container-highest) }` | `.unrecognized-row__summary:2554` / `:2557-2559` verbatim — this file's only precedent for a row-shaped control, and the tint token is already the one it uses. |

Deliberately **absent**: `display`, `align-items`, `gap`, `padding`, `background`, `border`,
`border-radius`, `max-width`, `min-width`, `overflow` (all already on `.tool-row__chip`, which the button
also carries); `font-size` / `line-height` / `letter-spacing` / `font-weight` (both children set all four
explicitly, so the UA button font-size reaches no rendered text, and every `--space-*` / `--radius-*` token
is px, so no box metric depends on it); `margin` (UA buttons are `margin: 0`, and
`.unrecognized-row__summary` ships without it as a flex item); and **`border-color` in any form**.

That last one matters: `.tool-row--error .tool-row__chip` (`:943`) retints the border and has specificity
(0,2,0) against `.tool-row__chip--toggle`'s (0,1,0). It keeps winning — but only as long as the new rule
says nothing about the border. Adding `border: …` here would silently kill the error accent on every
failed tool row.

No new token, no `tokens.css` change, no change to `.tool-row--expanded`, `.tool-row__body`,
`.tool-row__result`, `.tool-row__empty`.

---

## State + concurrency model

One `useState<boolean>` per mounted resolved `ToolRow`. No store slice, no reducer arm, no event type, no
selector, no IPC message, no async work, no subscription, no cleanup. Nothing is cancellable because
nothing is in flight.

Lifecycle in full:

- **Mount** — `useState(defaultExpanded)`; in the product that is `false` (the arm passes nothing).
- **Pending → resolved** (`fillResult`) — same index, same key, same component type, so React keeps the
  instance and the `false` with it. The chip re-renders from `<div>` to `<button>`; the row appears
  already collapsed, which is what AC1 asks for.
- **Toggle** — `setExpanded((open) => !open)`. Functional updater, per `UnrecognizedRow:707`.
- **Thread reset** — `items: []` → `<EmptyThread />` → unmount → state gone (§ 2).
- **Conversation switch** — `#670` keys the chat pane on the active conversation, so the whole screen
  remounts; the reset above happens anyway. Belt and suspenders, both deterministic.
- **Reconnect** (`reduceTimeline`'s `reconnected` arm, `:552`) — chrome-only, `items` survive, so rows stay
  mounted and stay as the reader left them. Correct: a reconnect is not a reset.

## Error handling

There are no new failure modes. No I/O, no parsing, no async, no daemon round-trip — a local boolean flips.
The two states the design has to be right about are both structural rather than handled:

- `result === null` → no control is rendered at all (§ 3), so "activated while pending" is unreachable
  rather than guarded.
- `resultSummary === ''` → #696's `TOOL_RESULT_EMPTY_COPY` note (`:656-660`). Unchanged; an expanded empty
  result shows the client-owned note, not a blank box.

Nothing in this slice logs. Do not add a diagnostic for the toggle: it would be a renderer-sourced UI event
carrying `name` or `toolUseId`, which ADR 0007's content-free rule and CLAUDE.md's "never a log line" both
forbid, for zero observed gain.

---

## Security review (`security-sensitive`)

Run against this spec per the architect security pass. The ticket carries the label because a disclosure
control's *natural* attribute surface is exactly the sink CLAUDE.md's 2026-08-20 ruling closes.

**Trust boundaries.** Four daemon-supplied strings are in reach inside `ToolRow`: `item.name`,
`item.inputSummary`, `item.toolUseId`, and `item.result.resultSummary`. The boundary is enforced at
`ConversationScreen.tsx:616-626` (#696's SAFETY block) — they may be auto-escaped React children and
nothing else. This slice adds an element to that component but no new source of untrusted text.

**Findings — four sinks this design must actively decline:**

1. **`aria-label` on the button.** The obvious "improvement" is
   `aria-label={\`Show result for ${item.name}\`}` — client copy interpolating daemon text into an
   **attribute**. Forbidden. *Correct alternative:* the button's accessible name comes from its existing
   text children (`name` + `inputSummary`) plus `aria-expanded`, which is precisely how
   `UnrecognizedRow:703-720` composes its own name from client copy and the daemon's `messageType`. A
   screen reader announces "read_file, src/main/index.ts, button, collapsed" with no attribute involved.
   **Add no `aria-label`.**
2. **`aria-controls` / `id` pairing.** The APG disclosure pattern invites `aria-controls={id}` on the
   button and `id={id}` on the body, and the obvious id source is `toolUseId` — a daemon-supplied string
   as both an **attribute value** and a **lookup key**, forbidden twice. `aria-controls` is optional in
   that pattern and poorly supported, and `UnrecognizedRow` ships without it. **Add neither.** If a future
   ticket does want it, the id must come from React's `useId()`, never from the wire.
3. **`title` on the chip.** `.tool-row__summary` ellipsizes (`:990-994`), which makes
   `title={item.inputSummary}` ("hover to see the rest") the natural next edit. Same forbidden shape #696
   already declined for `resultSummary`. **Add no `title`.**
4. **A toggle log line.** Covered under Error handling — no diagnostic, on either the renderer or the main
   side.

**Integrity — result misattribution.** The one way this design could mislead rather than leak is a row
rendering *another* call's result: the boolean and the item would have to disagree about which tool call a
row is. Under component-local state that reduces entirely to the index-key invariant, which § 2 establishes
from every `items` write in the reducer rather than assuming it. Verify that argument rather than taking
it — it is the load-bearing one, and it is the reason the hoisted `toolUseId`-keyed alternative (which
makes a daemon-supplied string a lookup key) buys nothing here.

**Resource use — newly reachable, still bounded.** The toggle makes the expanded branch reachable for the
first time, and a reader can hold *many* rows open at once where previously none could open. Each body is
bounded by `max-height: 240px` + `overflow: auto` (`:1028-1040`) and each `resultSummary` by the Noise
envelope ceiling (65519 B), the text is already resident in the store whether rendered or not, and every
expansion is one deliberate user action. No new unbounded growth; no cap needed. Stated because it is the
one genuinely new capability in the slice.

**Not findings, stated so the reviewer does not re-open them:** the button carries `data-thread-role="tool"`,
a client-owned constant; the `onClick` closure reads no daemon value; `defaultExpanded` is a client-owned
boolean; no IPC channel, wire field, store write, markdown path or external-open path is added, so the
privileged renderer gains no new reach; the e2e's fixture strings (`SEEDED_ROW.id`, the invented tool name
and needle) are non-secret display/routing literals, matching `unrecognized-message.spec.ts:19-21`'s stated
hygiene posture.

**No new attack surface** is introduced: no new IPC channel, no new wire field, no new store write, no
markdown path, no URL, no filename, no cache key. The `<pre>`-with-text-children posture that keeps an
`<img src>` beacon out of a privileged renderer (#696's second MUST FIX) is untouched.

**Verdict: PASS.**

---

## Testing strategy

### Unit (`npm test`, vitest, `environment: 'node'`)

`renderToStaticMarkup` only — no DOM, no effects, no clicks. **Do not add jsdom, happy-dom or
@testing-library.** If you become convinced one is necessary, stop and say so on the ticket instead.

Existing cases that must stay green untouched apart from the § 4 rename: `:200`, `:277`, `:374`, `:448`
(`toContain('tool-row__chip')` — substring, so the appended modifier is fine), `:201`, `:278`, `:375`
(`toContain('data-thread-role="tool"')` — rides the button), `:372` / `:388` (exact wrapper class strings —
the wrapper is not touched), and `interactiveRoundtrip.test.tsx:66-67`.

New cases, in #696's `ToolRow` describe block:

- A resolved row with no flag renders the chip as a `<button type="button">` carrying
  `aria-expanded="false"`, and still contains `tool-row__chip` and `data-thread-role="tool"`.
- The same row with `defaultExpanded` renders `aria-expanded="true"` — pinning that the prop still reaches
  the mount-time value after the rename.
- A **pending** row (`toolItem(null)`) renders **no** `<button` and no `aria-expanded` at all, and its chip
  markup is the `<div className="tool-row__chip" data-thread-role="tool">` form. This is AC2's unit half.
- An error row keeps `tool-row--error` on the wrapper while its chip is a button — cheap insurance for the
  specificity claim in § 5 at the markup level (the CSS half is unobservable in this tier; say so in a
  comment rather than pretending the test proves it).

### e2e (`npm run e2e`, fake transport) — AC5

New file `e2e/tool-row-toggle.spec.ts`, modelled directly on `e2e/unrecognized-message.spec.ts`. Plain
`launchPairedApp()` — no `buildReplyFrames` override; the fixture's default seed plus its list→thread click
already land you in the thread with Send enabled.

Two local frame helpers, in the shape of `thread-scroll-pin.spec.ts:105-117`:

- `toolUseFrame()` — `type: 'tool_use'`, `ToolUsePayload` with `conversation_id: SEEDED_ROW.id` and a fixed
  `tool_use_id`. Lift the existing helper's shape.
- `toolResultFrame()` — `type: 'tool_result'`, `ToolResultPayload`
  (`{ conversation_id, turn_id, tool_use_id, is_error: false, result_summary }`, `src/shared/wire/types.ts:741-747`)
  carrying the **same** `tool_use_id`, so `fillResult` correlates it. `result_summary` holds a distinctive
  non-secret needle whose presence and absence are the assertions.

Both go out via `daemon.pushFrame` — unsolicited server pushes, already proven for `tool_use` at
`thread-scroll-pin.spec.ts:275` and `:327`. Fixed envelope id and fixed `ts`, per the fakeDaemon
no-`Date.now()`/no-randomness convention.

Scenario, in order:

1. Push `toolUseFrame()`. `.tool-row` becomes visible; it is **pending** — assert the chip is not a button
   (`.tool-row__chip[aria-expanded]` has count 0) and the row does not contain the needle. *This is AC2 in
   the tier that can actually observe activatability.*
2. Push `toolResultFrame()`. The row gains `tool-row--resolved`; the chip now carries
   `aria-expanded="false"`; the needle is still absent from the DOM (withheld, not merely hidden —
   `.tool-row__result` has count 0).
3. Click the chip. `aria-expanded="true"`, `.tool-row__result` visible and containing the needle.
4. Click again. `aria-expanded="false"`, `.tool-row__result` back to count 0, needle gone. *This is AC5's
   "activates it again and asserts the result text is gone."*
5. Focus the chip and press `Enter`. It expands again — the assertion that would fail had this shipped as a
   `<div onClick>`. *This is AC1's "reachable by keyboard, not by mouse only."* (`unrecognized-message.spec.ts:104-109`
   is the same step, verbatim in shape.)

Scope every locator under `page.locator('.tool-row')` rather than the page root. Post-#670 the sidebar is
always mounted, and cheap top-level selectors are what produced three Playwright strict-mode collisions on
that ticket.

Run the whole tier (`npm run e2e`, 39 tests / ~29s) before you push — a fresh worktree has no
`node_modules`, so `npm install` first. `npm run build` is the salvage gate; run it too.

---

## Out of scope — declined deliberately

- **Extracting a shared collapsible.** `ConversationScreen.tsx:679-681` says the unrecognized row was built
  specific and "when a second one arrives, extract then" — this toggle is that second one, and the answer
  is still **no**. A shared collapsible only earns its keep if `UnrecognizedRow` migrates onto it too;
  otherwise it is a "shared" component with one caller, which is the speculative work that comment warns
  against. That migration is a behaviour-neutral refactor of a different component and reviews cheaply on
  its own — worth its own ticket, not a rider on this one. CLAUDE.md's "don't refactor adjacent code while
  you are there" points the same way. **Do not extract.**
- **`tabIndex={0}` on the scroll regions.** #696's review noted that `.tool-row__result:1028-1040` and
  `.unrecognized-row__raw` are both `overflow: auto` with no `tabindex`, so their content is
  keyboard-unscrollable in Blink. Real, but it is a property of the *body*, not of the control AC1 is about,
  it predates this ticket in both components, and fixing only one of the two would leave the pair
  inconsistent. **File a follow-up covering both;** do not fix it here.
- **Collapsing consecutive uses of the same tool** into one entry — deferred on #645, 2026-08-20.
- **Any DOM test environment.** See Testing strategy.
- **`docs/knowledge/codebase/697.md`** — owned by the documentation phase, written from the merged diff.
  Not a developer deliverable.

## Open questions

None blocking. Two judgement calls the developer may resolve while implementing:

1. **Does the hover tint need a `:focus-visible` companion?** `.unrecognized-row__summary` ships without
   one and relies on the UA focus ring, which survives because the rule sets no `outline`. Follow that —
   set no `outline` on `.tool-row__chip--toggle` and the ring is inherited for free. Only add an explicit
   `:focus-visible` if the UA ring turns out to be invisible against `--color-surface-container`, and if it
   is, say so on the ticket rather than inventing a token.
2. **Where the new unit cases sit in the file.** #696's `ToolRow` describe block (`:341-450`) is the natural
   home and keeps the `defaultExpanded` rename local to one region. If the pending-row case reads better
   beside the existing collapsed-default guard at `:319-335`, either is fine — the block boundary is not
   load-bearing.
