# #704 — Collapse a workspace group by clicking its row

## Files to read first

- `src/renderer/src/screens/channels/ChannelList.tsx:290-331` — `WorkspaceRow`, shipped by #703. This is the element that becomes the disclosure control. Read its whole comment block: the class-token / text-collision discipline and the "not interactive in this slice — collapse is #704" note are the two things this ticket edits.
- `src/renderer/src/screens/channels/ChannelList.tsx:352-416` — `renderBody`. The two `<Fragment key={group.key}>` wrappers at `:370` and `:399` are the only call sites that change; the two `length > 0` gates at `:354` / `:388` do not.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:700-746` — `ToolRow` (#697). **The template for this whole ticket**: `defaultExpanded = false` seeding `useState`, the `<button type="button" … aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>` shape, and the reason the prop is `default*` rather than a controlled `expanded`. Note that `ToolRow` is *exported* purely so both disclosure states are reachable from `renderToStaticMarkup` — § 7 copies that.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:645-672` — the four sinks a disclosure control invites, declined **by name** (no `aria-label`, no `aria-controls`/`id`, no `title`, no log line). AC5 forbids the same four here, sourced from the workspace label instead of `resultSummary`. Reuse the wording; do not re-derive it.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:846-880` — `UnrecognizedRow`, the second shipped disclosure. Confirms the functional-updater form and that the codebase ships disclosures *without* `aria-controls`.
- `src/renderer/src/screens/channels/channels.css:76-117` — the three `.channel-list__workspace*` rules #703 shipped. § 6 appends to the first and adds two state rules; the other two are untouched.
- `src/renderer/src/screens/channels/channels.css:127-150` — `.channel-list__row-open` + its `:hover` / `:focus-visible`. **The file's button-reset precedent**, and the source of every value § 6 adds. Note that *every* `<button>` in this file sets an explicit `color` — § 6 explains why that is load-bearing here.
- `src/renderer/src/screens/channels/ChannelList.test.tsx:59-98` — the marker constants, `countOf`, and `workspaceLabelsIn`. `WORKSPACE_ROW_MARKER:76` is an **exact attribute-value substring**; § 5 explains what keeps it matching and what would silently zero it.
- `src/renderer/src/screens/channels/ChannelList.test.tsx:300-370` — #703's six workspace-row tests. **None of them change** (§ 7). `:344-348` is the unit-level mirror of the 28-spec fixture hazard; `:352-362` is the untrusted-`cwd` escaping test whose `not.toContain('title=')` line AC5 extends.
- `e2e/conversation-switch-remount.spec.ts:36-130` — **the drive § 7's new e2e spec clones**: one promoted seed (so `launchPairedApp`'s strict `.channel-list__row-open` click has exactly one target), the FAB minting a second row, and the composer draft as the "the pane did not remount" observable.
- `e2e/fixtures/conversationStateFake.ts:54-66` — `DEFAULT_CREATED_CWD = '/fake/workspace'` and `DEFAULT_SEED.cwd = '/fake/workspace'`. This is why a FAB-minted row lands in the **same** workspace as the seed but the **other** tree — which is exactly AC3's scenario, for free.
- `e2e/tool-row-toggle.spec.ts:85-135` — the shipped `aria-expanded` toggle drive (click → `'true'` → click → `'false'`). The assertion vocabulary § 7 reuses.
- `docs/specs/architecture/703-sidebar-workspace-grouping.md` — the predecessor. § 5 (keyed `Fragment`, flat DOM), § 6 (the two hazards), § 7 (the styles deliberately deferred *here*) and its Open questions § are this ticket's inheritance.
- `docs/knowledge/decisions/0006-ephemeral-screen-state-usereducer-not-store.md` — read the **Consequences** section: "`useState` is still fine for trivial, single-value local UI state… it does not push every one-off boolean through a reducer." That sentence is the whole state decision (§ 1).
- `src/renderer/src/PairedShell.tsx:118-144` — the comment explaining that `list` and `thread` render `ChannelList` at the **same element position on purpose**, so React preserves its subtree instead of remounting. This is why component-local state satisfies AC4 with no store (§ 1).

**Tooling note.** `codegraph` is wired but still not indexed for this repo — `codegraph_context` errors `CodeGraph not initialized` (probed three times today for #703, #709 and #710; `.codegraph/` holds a config and a `.gitignore`, no database). This list was built by grep + Read, which is also the right tool for the load-bearing questions here: *which CSS class strings and which literal texts appear inside Playwright locators*, and *which exact substrings the unit-test markers pin*. Those are string literals a symbol graph does not index.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=102-4 — workspace row `106:3098`.

The row is drawn exactly as #703 shipped it, plus one property that ticket deliberately skipped: `rounded-[6px]`. `get_design_context` on `106:3098` returns `pl-[24px] pr-[16px] py-[4px] gap-[10px] rounded-[6px]`, a 12×10 folder glyph in the `Row icon` wrapper `106:3110`, and one M3 title-small label on `schemes/on-surface` — **no chevron, no caret, no disclosure glyph, no second state**. The screenshot confirms it: a folder and a word on the surface, nothing else.

So the collapsed appearance is genuinely unpinned by the design, exactly as the ticket says. This ticket therefore takes **only** the 6px radius (now that there is a hover fill for it to clip) and invents nothing visual: no chevron, no rotation, no colour change between states. The one thing the design *does* settle is that the whole row is the hit target — there is no inner control to attach the click to.

## Context

#703 (PR#717) put a workspace row above each group of conversation rows in each of the sidebar's two trees. Every group renders expanded, and the row is an inert `<div>`. This slice makes it a disclosure control: clicking it folds its group away and nothing else.

The seam is already there and this ticket is deliberately small because of it. #703 chose a keyed `Fragment` per group precisely so that collapsing would be *a conditional on `group.rows.map`*, not a DOM restructure, and it left `WorkspaceGroup.key` as a stable per-group identity to hang state on. Both hold. What this ticket adds is one boolean per rendered group, a `<button>`, and the visual states #703's § 7 named and skipped "because the row was not yet interactive".

Nothing about the grouping itself moves: no change to `workspaceLabelFor`, `groupByWorkspace`, `UNKNOWN_WORKSPACE_LABEL` or `WorkspaceGroup`; no wire change, no store, no IPC. #716 still owns the same-last-segment label ambiguity and is untouched — grouping is keyed by `cwd`, and collapse is keyed by the group, so an ambiguous *label* has no bearing on which group folds.

## Scope check

| Red line | Limit | This ticket |
|---|---|---|
| New files | 3 | **1** — `e2e/workspace-collapse.spec.ts` |
| Total written LOC (prod + CSS + unit tests + e2e) | ~600 | **~295** — ~55 TSX, ~25 CSS, ~95 unit tests, ~120 e2e |
| New exported types / components | 5 | **1** — `CollapsibleWorkspaceGroup`. `WorkspaceRow` stays module-local (the `HostRow` posture) |
| Acceptance criteria | 5 | **5** |
| Reject / error branches | 10 | **0** — no state machine, no async, no failure path, no log call |
| Consumer call sites needing simultaneous update | 10 | **2**, both inside `ChannelList.tsx`'s own `renderBody` |

Production source files (`*.ts` / `*.tsx`, excluding `*.test.ts(x)` and `*.spec.ts`) touched: **1** — `ChannelList.tsx`. Well under the ≥5 self-check.

**Sizing stands at S.** The work is one boolean of state, one element swap, six CSS declarations and their tests.

**Branch-overlap check (§1.5): clean.** `git fetch origin --prune`, then a per-branch diff of all 14 `origin/feature/<N>` remote branches against `main`, for each of `ChannelList.tsx`, `ChannelList.test.tsx` and `channels.css`: zero overlaps. No `blockedBy` needed. (The new e2e spec is a new path and cannot collide.)

## Design

### 1. Where the state lives — component-local `useState`, and why nothing else

**One boolean per rendered group, held in the component that renders that group.** No store, no reducer, no context, no lifted map in `ChannelListView`.

That is not the convenient answer; it is the correct one, and AC4 is what makes it so. AC4 asks for state that is gone on a fresh app start and reaches no store, no disk and no wire. ADR 0006's rule is "the lowest scope that resets correctly", and its Consequences section says in as many words that a one-off boolean does not need a reducer. The component scope is the lowest scope here, and it resets correctly — but the *reason* it resets correctly is worth stating, because the naive read of it is wrong:

> `PairedShell.tsx:118-144` renders `ChannelList` at the **same element position** on both the `list` and `thread` routes, on purpose. React therefore reconciles the two routes by **preserving** the sidebar's subtree rather than remounting it.

So component-local state in the sidebar survives opening a conversation and coming back — which is what a user expects of a fold — and is destroyed with the renderer on app start, which is AC4's other half. Both halves come free from where the state sits. A store would have to be manually cleared to get the second half and would break the first; that is scope the state does not need, and the exact footgun ADR 0006 exists to avoid.

**The two lifted alternatives are worse, concretely.** A `Set<string>` of collapsed keys in `ChannelListView` would have to be keyed by *tree plus* `cwd` to satisfy AC3 (the two trees repeat the same workspace on purpose), which means inventing a composite key out of a daemon-derived string — new complexity in the one place this ticket must be careful. And a lifted set would need explicit pruning when a workspace disappears from the list, where per-component state is pruned by React unmounting the component. Neither buys anything.

**What AC4 forbids is proven structurally, not by a test.** The diff adds no store import, no `window.pyry` call, no `localStorage`/`sessionStorage`/IndexedDB access, no IPC channel and no wire type. There is no persistence path to fail, so no relaunch e2e is built to prove one absent — that would be testing for code that was never written. Code-review checks the diff instead; § 7 says what the two live tests do cover.

### 2. The component split — one new component, one changed one

```ts
// Exported — the ToolRow posture: exported so both disclosure states are reachable from a test.
// Holds `useState(defaultExpanded)`; renders <WorkspaceRow …/> then `{expanded && children}`
// inside a shorthand fragment, emitting no wrapper element of its own (§ 4).
export function CollapsibleWorkspaceGroup(props: {
  label: string
  defaultExpanded?: boolean   // mount-time seed, default true; production never passes it
  children: ReactNode
}): JSX.Element

// Module-local (the HostRow posture), unchanged but for its element and these three props.
function WorkspaceRow(props: {
  label: string
  expanded: boolean
  onToggle: () => void
}): JSX.Element
```

Two functions rather than one, deliberately: `WorkspaceRow` stays the **drawn row** — the Figma-traced markup, the class vocabulary and #703's whole safety comment block, which stays attached to the element it describes. `CollapsibleWorkspaceGroup` is the **state and the conditional**, and nothing else. The diff to `WorkspaceRow` is then an element swap plus three props, instead of a rewrite.

**The name.** `channelListViewModel.ts` already exports a *type* called `WorkspaceGroup`. Naming the component `WorkspaceGroup` would put two different things under one name in the same feature folder, and would collide outright the moment anyone imports the type into this file. `CollapsibleWorkspaceGroup` is longer than this file's other component names on purpose — it is disambiguation, not verbosity.

**Call sites.** Both `renderBody` blocks change from a keyed `Fragment` to a keyed `CollapsibleWorkspaceGroup`, with the rows becoming its children:

```tsx
{groupByWorkspace(channels).map((group) => (
  <CollapsibleWorkspaceGroup key={group.key} label={group.label}>
    {group.rows.map((c) => (
      <Row key={c.id} row={c} now={now} onOpen={() => onOpen(c)} onRename={() => onRename(c)} />
    ))}
  </CollapsibleWorkspaceGroup>
))}
```

…and the identical shape in the `discussions` block, keeping that block's `onSaveAsChannel` prop. The `key` moves from the `Fragment` to the component and keeps the exact same meaning (§ 4).

**`Fragment` becomes unused and its import goes.** `import { Fragment, useState } from 'react'` at `:2` becomes `import { useState, type ReactNode } from 'react'`. This is the only import change; it is a consequence of the edit, not a tidy-up. (`noUnusedLocals` is not set — only `strict` — so nothing forces this; leave no dead import anyway.)

### 3. The disclosure control — what the `<button>` carries, and what it must not

`WorkspaceRow` renders a real `<button>` in place of its `<div>`. Everything else about it — class names, glyph, `aria-hidden`, the label as an auto-escaped React child — is unchanged.

The complete attribute set, and it is complete on purpose:

| Attribute | Value | Why |
|---|---|---|
| `type="button"` | constant | the file's convention on every button; without it a button defaults to `submit` |
| `className` | `"channel-list__workspace"` | **the sole class token — see § 5** |
| `aria-expanded` | `{expanded}` | AC5. React serialises it to `"true"` / `"false"`; the value is client-owned, never daemon-derived |
| `onClick` | `() => onToggle()` | the parent's `setExpanded((open) => !open)` |

Nothing else. **Four sinks are declined by name**, each a MUST FIX if it appears — the same four `ConversationScreen.tsx:645-672` already declines for the tool row, recurring here sourced from the workspace label and from `group.key`:

- **NO `aria-label`.** `Collapse ${label}` interpolates daemon text into an attribute. The button's accessible name already comes from its text child plus `aria-expanded`: a screen reader announces "*second-brain*, button, expanded". The glyph stays `aria-hidden`, so it adds nothing to that name.
- **NO `aria-controls` / `id` pair.** The APG disclosure pattern invites it and the obvious id source is `group.key` — which is `row.cwd`, a daemon string, forbidden as an attribute value *and* as a lookup key. `aria-controls` is optional in that pattern and both shipped disclosures ship without it. If a future ticket wants one, the id comes from `useId()`, never from the wire.
- **NO `title`.** `.channel-list__workspace-label` ellipsizes (#703 § 7), which makes `title={label}` ("hover for the rest") the natural next edit. It is the exact shape CLAUDE.md's 2026-08-20 ruling forbids and #696's security review made a MUST FIX. The full `cwd` staying undiscoverable is #716's problem, not this ticket's.
- **NO log line for the toggle.** Any useful one carries the label or the `cwd`; ADR 0007's content-free rule and CLAUDE.md both forbid it. This ticket adds **zero** log calls.

**The updater is functional: `setExpanded((open) => !open)`, never `setExpanded(!expanded)`.** The latter reads a value captured at render and is a check-then-act race against React's batching. Both shipped disclosures say so in a comment (`ConversationScreen.tsx:743`, `UnrecognizedRow`); match them.

**`defaultExpanded` is a mount-time seed, not a controlled prop** — the same contract, and the same reason, as `ToolRow`'s. `renderBody` never passes it, so production is always `true` (AC4's "every group renders expanded on a fresh app start"). Only the tests pass it. A prop named `expanded` that a re-render could not change would be a quiet lie.

### 4. Independence per tree, and identity across re-renders

**AC3 falls out of component identity and needs no key engineering.** The two trees are two separate sibling lists inside `renderBody` — the `channels` block and the `discussions` block — and React scopes reconciliation per sibling list. A group with `key === '/home/me/second-brain'` in the Channels block and a group with the *same* key in the Chats block are therefore two distinct component instances holding two distinct `useState` cells. Folding one cannot reach the other. There is nothing to implement for AC3; there is something to **not** do, namely lift the state (§ 1).

**Identity across re-renders is what the key already guarantees.** Keying on `group.key` (the exact `cwd`, or `''` for the unknown bucket) means:

- a group whose rows change — a conversation renamed, added, archived — keeps its instance and therefore its fold;
- a group that moves position, because first-appearance order changed, keeps its fold, since React reconciles by key and not by index;
- a group that disappears from the list is unmounted and its fold is discarded; if that workspace comes back it comes back expanded.

The last one is correct behaviour for ephemeral disclosure state and is not worth defending against. Do not attempt to preserve a fold across a group's disappearance — that would need exactly the lifted, manually-pruned map § 1 rejected.

**The rendered DOM stays flat.** `CollapsibleWorkspaceGroup` returns a shorthand fragment, so like the `Fragment` it replaces it emits **no** element. The sequence under `.channel-list` remains `header`, host, workspace, rows, workspace, rows — every `.channel-list__row` keeps the exact ancestry it has today, which is what #703 § 5 protected and what 28 e2e specs depend on. **No wrapper `<div>`, no `role="group"`, no `<ul>`/`<li>`.** (PR#717's review NIT proposing heading / `role="group"` semantics across the workspace row *and* the host row *and* the section headers is out of scope per the ticket body — a second concern spanning rows this ticket does not otherwise touch. Whoever picks it up gets a clean seam: the wrapper would go here.)

### 5. The marker trap — the class token stays sole

`ChannelList.test.tsx:76` pins:

```ts
const WORKSPACE_ROW_MARKER = 'class="channel-list__workspace"'
```

It is an **exact attribute-value substring**, deliberately: the closing `"` is what stops it also matching `__workspace-icon` / `__workspace-label`. `renderToStaticMarkup` emits attributes in JSX prop order, so `<button type="button" className="channel-list__workspace" aria-expanded={…}>` renders `class="channel-list__workspace"` verbatim and the marker keeps matching. **The `<div>` → `<button>` swap is safe.**

What is not safe is a **modifier class**. `className={expanded ? 'channel-list__workspace' : 'channel-list__workspace channel-list__workspace--collapsed'}` makes the attribute value `"channel-list__workspace channel-list__workspace--collapsed"`, which the marker no longer matches — silently zeroing the counts at `:313-322` and `:334-335` and the strict-mode guard at `:344-348`. They would not fail loudly; they would pass against nothing.

**So: the class token stays sole, and this ticket needs no modifier anyway** — the Figma draws no collapsed appearance (§ Design source), so there is nothing to style differently. If a later ticket does want a collapsed style, the escape that preserves every marker is the attribute selector `.channel-list__workspace[aria-expanded='false']`, not a second class. Say so in the CSS comment.

The same rule applies to `ROW_MARKER`, `ROW_OPEN_MARKER`, `HOST_ROW_MARKER` and `SECTION_HEADER_MARKER`: none of those elements change, so none of those markers move.

### 6. Styles — `channels.css`, one rule extended and two added

`.channel-list__workspace` is now a `<button>`, and a `<button>` does not inherit what a `<div>` inherited. Two of the six additions are **not** cosmetic — they repair inheritance the element swap breaks:

| Selector | Property | Value | Why |
|---|---|---|---|
| `.channel-list__workspace` (append) | `appearance` / `border` / `background` / `cursor` / `text-align` | `none` / `0` / `none` / `pointer` / `left` | the `.channel-list__row-open:129-141` button reset, verbatim |
| | `font-family` | `var(--font-sans)` | **repairs inheritance.** A `<button>` does not inherit `font-family`; `.channel-list__workspace-label` sets size/line/tracking/weight but *not* family, so without this the label renders in the UA button font. `.channel-list__row-open` carries it for the same reason |
| | `color` | `var(--color-on-surface)` | **repairs inheritance, and this is the easy one to miss.** The folder glyph is `fill="currentColor"` and today inherits `--color-on-surface` from `.channel-list`. A `<button>` resets `color` to the UA `buttontext`, which would mis-paint the glyph — visibly wrong in the dark scheme. Every other button in this file sets an explicit `color` for exactly this reason (`__save`, `__rename`, `__archive`, `__settings`, `__fab`) |
| | `border-radius` | `var(--radius-xs)` | Figma `rounded-[6px]`; `--radius-xs` is 6px — an **exact** match, no ±token mapping. #703 § 7 skipped it because there was no fill to clip; the hover below is that fill |
| `.channel-list__workspace:hover` | `background` | `var(--color-surface-container)` | the `.channel-list__row-open:hover:144-146` value. The design pins no hover state (`get_variable_defs` on `106:3098` returns only the label's colour and type), so the file's own interactive precedent decides it rather than an invention |
| `.channel-list__workspace:focus-visible` | `outline` | `1px solid var(--color-outline)` | the file convention on every interactive element, and the visible half of AC5's "focusable and operable by keyboard" |

The three existing declarations (`display: flex`, `align-items: center`, `gap`, `padding`) and both sibling rules (`__workspace-icon`, `__workspace-label`) are **unchanged**.

**No `width: 100%`.** `.channel-list` is a flex column with the default `align-items: stretch`, and a `<button>`'s width is `auto`, so the row stretches to the sidebar's 400px exactly as the `<div>` did. Adding a width would fight the padding; if the row ever fails to fill, the fix is `align-self: stretch`, never a width.

### 7. State, concurrency, error handling

**State:** one `boolean` per rendered group, in `CollapsibleWorkspaceGroup`. No store slice, no selector, no `useEffect`, no `useMemo`, no IPC, no wire change, no persistence of any kind.

**Re-render seam:** a toggle re-renders exactly one `CollapsibleWorkspaceGroup` and its children. `ChannelListView` and the sibling groups are untouched, and `PairedShell` — which does not subscribe to this state — does not re-render at all, so `ConversationScreen` is neither re-rendered nor remounted. That is AC2's mechanism, and § 8's e2e observable is chosen to prove it.

**Concurrency:** none. No async, no promise, no subscription, no timer, no `AbortController`, nothing to cancel or tear down.

**Error handling:** no failure modes and no branches. `label` is already-derived display text arriving as a prop, and `expanded` is a client-owned boolean. There is no parse, no throw path, no reject arm, no banner, and — per § 3 — no log call.

## Testing strategy

`npm test` (vitest, `environment: 'node'`) is the unit tier; `npm run e2e` is where the clicks live; `npm run build` is the gate.

**Note the constraint that shapes this split:** vitest runs in the `node` environment with no jsdom and no Testing Library, so `renderToStaticMarkup` is the only unit tool and **a unit test cannot click**. AC1, AC2 and AC3 are interaction claims and are therefore proven in Playwright — which is exactly what both shipped disclosures do (`e2e/tool-row-toggle.spec.ts`, `e2e/unrecognized-message.spec.ts`). The unit tier proves the two *rendered shapes* and the attribute discipline.

### Unit — `ChannelList.test.tsx`

Two new markers (`aria-expanded="true"` / `aria-expanded="false"`) and one helper that slices out each workspace-row **opening tag** so its attribute set can be asserted whole. Against `ChannelListView` (rendered through the existing `render()` helper):

- **Every workspace row is a button, expanded by default.** With rows in both trees, the count of `aria-expanded="true"` equals the `WORKSPACE_ROW_MARKER` count, and `aria-expanded="false"` does not occur. Pins AC4's fresh-start default and AC5's real `<button>`.
- **The opening tag carries exactly `type`, `class`, `aria-expanded` — and nothing else.** Assert against the sliced tag, not the whole markup: `aria-label` and `title` legitimately appear elsewhere in the render (the FAB, the gear, Rename, Save-as), so a document-wide `not.toContain` would be either vacuous or wrong. Assert the tag contains no `aria-label`, no `title`, no `aria-controls`, no `id=` and no `data-`. This is AC5's prohibition made executable.
- **The untrusted-`cwd` escaping test still holds through the swap.** Reuse `:352-362`'s `<img src=x onerror=…>`-shaped `cwd` and additionally assert the sliced opening tag contains no substring of the label. Its existing `not.toContain('title=')` line is unchanged and must stay green.

Against the exported `CollapsibleWorkspaceGroup`, rendered directly with a probe child (the `ToolRow` idiom — this is the seam that makes the collapsed shape reachable at all):

- **Expanded (no prop):** the workspace row renders, `aria-expanded="true"`, and the probe child is present.
- **Collapsed (`defaultExpanded={false}`):** the workspace row **and its label** still render, `aria-expanded="false"`, and the probe child is **absent**. This is AC1's structural claim — the row stays, the body goes — and the "row stays visible" half is the part a naive implementation gets wrong.
- **The label is an escaped text child in the collapsed state too**, and the collapsed opening tag carries the same attribute set as the expanded one.

**None of #703's six workspace-row tests change, and none of the file's earlier tests change.** Every existing fixture seeds one `cwd` (`/tmp`) and renders expanded, so every pre-existing count and ordering assertion sees exactly the markup it saw before. If an existing test needs editing, the implementation has drifted — fix the code, not the test.

### e2e — one new spec, `e2e/workspace-collapse.spec.ts`

Default tier (the filename does not match the real-claude config's `real-*` ignore). One `test`, one launch, one sequential drive, cloning `conversation-switch-remount.spec.ts`'s shape:

- **Setup.** `conversationStateFake({ conversations: [SEED] })` with a single **promoted** seed (`cwd: '/fake/workspace'`) — exactly one clickable row, so `launchPairedApp`'s strict `.channel-list__row-open` click still resolves. The launch lands in that row's thread. Then click `.channel-list__fab`: the minted row is unnamed and unpromoted with `cwd: '/fake/workspace'` (`conversationStateFake`'s `DEFAULT_CREATED_CWD`), so it lands in the **Chats** tree under a workspace group with the **same label** as the Channels one. That is AC3's scenario for free, with no fixture edit.
- **Baseline.** `.channel-list__workspace` count 2, both `aria-expanded="true"`, `.channel-list__row` count 2, `.conversation` count 1. Then fill the composer with a fixed non-secret literal and assert `toHaveValue` — the non-vacuity anchor, and the AC2 observable: the draft is plain `useState` in `Composer` behind no store, so it can only survive if the chat pane was not remounted and the active conversation did not change (`PairedShell` keys the pane on that id, #670).
- **AC1 + AC5.** Click the Channels group's workspace row (`.nth(0)` — DOM order is Channels-then-Chats, structural in `renderBody`; there is no per-tree wrapper to scope to, by design). Assert its `aria-expanded` is `'false'`, `.channel-list__row` count drops to 1, and `.channel-list__workspace` count is **still 2** (the row itself stayed). Click again: `'true'`, count back to 2.
- **AC3, both directions.** With Channels collapsed, assert the Chats workspace row is still `aria-expanded="true"` and its row (filtered by `Untitled`) is still visible. Then collapse the Chats group and assert the Channels one is unaffected — one-directional independence would pass a one-sided check.
- **AC5's keyboard half.** Drive one of those toggles with `locator.press('Enter')` rather than `click()`. Playwright focuses before pressing, so a single call proves both focusable and keyboard-operable — which a `<div onClick>` would fail.
- **AC2.** Throughout: `.conversation` stays `toHaveCount(1)` (no navigation), the composer still holds its draft (no pane change, no change of active conversation), and the total `.channel-list__row` count returns to 2 after re-expanding (no conversation created).

**Secret hygiene**, carried verbatim from the siblings: every assertion reads DOM counts, attribute values and display literals only. The draft is a non-secret literal typed into a composer that is never sent — no Send is clicked, so no message text reaches the wire. The pairing plumbing (synthetic token, fake static key) lives in `launchPairedApp` and is never echoed.

**No existing `e2e/` file is edited — not one, not a comment.** Groups render expanded by default, so launch-time markup is byte-identical and the existing default tier passing **unchanged** (40/40 as of PR#717) is § 8's proof. If implementing this makes an edit to an existing spec look necessary, the new markup is wrong; fix the code.

### 8. The selector and text hazards — re-verified for the new `<button>`

Same failure mode as #703 and #710: Playwright runs locators in strict mode, so a new element that *joins* an existing locator's match set raises a strict-mode violation at launch rather than an assertion failure — and `launchPairedApp.ts:224` clicks an unfiltered `.channel-list__row-open` that 28 specs ride. Turning an existing `<div>` into a `<button>` opens a **third** hazard the previous two tickets did not have: role-based locators. All three are closed, and re-checked for this ticket rather than inherited:

- **Class token.** Unchanged from #703 — `channel-list__workspace` shares no token, and no substring, with `__row`, `__row-open`, `__section-header`, `__host`, `__save`, `__rename`, `__title`, `__time`, `__divider`, `__archive`, `__settings`, `__fab`, `__empty`. Grep confirms **zero** references to `.channel-list__workspace` anywhere under `e2e/`, and zero `[class*=]` / `[class^=]` / `[class$=]` selectors in `e2e/` or `src/renderer`.
- **Role — the new one.** There is **no** unfiltered `page.locator('button')` and **no** unfiltered `getByRole('button')` anywhere in `e2e/`. Every one of the 60 `getByRole('button', …)` call sites is name-scoped. Name matching is a *case-insensitive substring of the accessible name*, so the question is whether the new button's accessible name **contains** any queried string. In the default tier every fixture seeds `cwd: '/fake/workspace'`, so that name is the single word **`workspace`** — and none of `Send`, `Archive`, `Delete`, `Rename`, `Pair`, `Confirm`, `Cancel`, `Dismiss`, `Settings`, `Pair another server`, `I already have pyrycode`, `New discussion`, `Run configuration`, `Close`, `Change workspace`, `Unpair`, `Re-pair`, `Stop the running turn`, `Drop queued message`, `Deny` or `Allow` is a substring of it. Note the near-miss and why it is not one: `workspace-picker.spec.ts` queries `{ name: 'Change workspace' }`, which is *longer* than the accessible name, so the containment runs the safe way.
- **Text.** Unchanged from #703 and still fixture-decided rather than constant-decided. The six `.channel-list`-scoped `getByText(…, { exact: true })` calls match conversation titles, never `workspace`; the `hasText` header locators are scoped to `.channel-list__section-header`, a class this row does not carry; the `.filter({ hasText })` chains have `.channel-list__row` as their base set.

**The invariant this ticket must leave standing:** the existing default tier goes green **unchanged**, with the new spec added beside it.

## Open questions

None blocking. Three things handed forward:

- **A collapsed appearance, if one is ever wanted**, is a Figma-side change first — the design draws the row in one state only and carries no chevron. If it lands, style it via `.channel-list__workspace[aria-expanded='false']`, never a modifier class (§ 5).
- **Grouping semantics for both levels** — the `role="group"` / heading association PR#717's review proposed for the workspace row, the host row *and* the section headers — is deliberately not here (§ 4). Whoever files it gets a clean seam: `CollapsibleWorkspaceGroup` is where a wrapper would go, and it would be the first element this level of the tree emits.
- **#716** (the same-last-segment label ambiguity) is unaffected. Grouping is keyed by `cwd` and collapse is keyed by the group, so two groups that render the same label still fold independently — which is correct, and worth knowing when #716 changes what the label says.

## Security review

**Verdict:** PASS

**Findings:**

- **[1. Trust boundaries]** No MUST FIX. This ticket **adds no untrusted-data path** — it adds a client-owned boolean beside one that already exists. The single untrusted value in the neighbourhood is the workspace label, and its boundary is unchanged: derived once by `workspaceLabelFor` (`channelListViewModel.ts`), decoded fail-closed as a `string` upstream by `requireString` (`inboundMessage.ts:1059`), and consumed here only as an auto-escaped React child. What *did* change is that the element carrying it became interactive, which is why § 3 re-declines the four attribute sinks rather than assuming #703's declination carries over — a `<button>` invites `aria-label` and `aria-controls` in a way a `<div>` does not, and both invitations are newly live. **SHOULD FIX (test-covered):** the opening-tag attribute-set assertion in § 7 is what keeps this honest; code-review should confirm it asserts the tag, not the document — a document-wide `not.toContain('aria-label')` would be wrong (the FAB legitimately has one) and would either fail or be quietly weakened into vacuity.
- **[2. Tokens, secrets, credentials]** No findings — not applicable by design. No token, key or credential is read, written, rendered, compared or stored. `serverInfoStore` / `pairedServerStore` are not imported; #710 established that prohibition for the host row and #703 extended it here, and this ticket touches neither. The only data in scope is a display label and a boolean.
- **[3. File / storage operations]** No findings, and the category is closed by construction rather than by care. The new state is a React `useState` cell: it reaches no disk, no `localStorage`, no `sessionStorage`, no IndexedDB, no `userData` file and no IPC channel — which is AC4 stated as a security property. No `path`, `fs` or `node:*` import appears or may appear; the workspace label is still never a filename, cache key or lookup path (CLAUDE.md 2026-08-20). `group.key` remains what #703 made it — a `Map` key and a React reconciliation key, both in-memory list identities that index nothing outside the render — and § 3 forbids the one new thing this ticket could have done with it, namely turning it into a DOM `id`. Path traversal, TOCTOU, atomic writes and encryption-at-rest are all structurally absent: there is no filesystem call.
- **[4. Inter-process / Electron attack surface]** No findings — no surface is added. No `contextBridge` API, no `ipcMain` channel, no command type, no wire change, no `BrowserWindow` option, no protocol handler, no navigation. AC2's "the click has no other effect" is enforced structurally, and that is worth naming as the security-relevant part: the handler's entire body is `setExpanded((open) => !open)`. It calls no `window.pyry` method, dispatches to no store and triggers no navigation — so a renderer compromise gains nothing from this control that it did not already have from the row buttons beside it.
- **[5. Cryptographic primitives]** No findings — not applicable. No randomness (no `Math.random()`, none needed — `defaultExpanded` is a fixed `true` and React's own keying does the identity work), no hashing, no key material, no Noise interaction, no comparison of any attacker-influenced value against a secret.
- **[6. Network & I/O]** No findings — no network surface is added, and no new amplification. Considered and declined: a hostile daemon returning many conversations with all-distinct `cwd` values now mounts one extra component per group. That is bounded by the group count, which #703 already bounded by the conversation count the list *already* renders a row for, and a component holding one boolean is cheaper than the DOM row beside it. Also considered: collapsing is a **reduction** in rendered DOM, so it cannot be driven into growth. The label stays bounded by the ellipsize rule #703 shipped.
- **[7. Error messages, logs, telemetry]** No MUST FIX, one explicit prohibition restated because the ticket newly invites it. **The toggle must not be logged.** A per-toggle diagnostic is the natural instinct for a new interactive control, and any useful one carries the workspace label or the `cwd` — untrusted daemon text in the renderer console, which ADR 0007's content-free rule and the decoder's own discipline forbid (`inboundMessage.ts:1049` names failure *categories* only, precisely because "a `name` / `cwd` could echo a conversation title or workspace path"). The design closes it by having **zero** log calls, **zero** throw paths and no user-facing error surface in the new code. No telemetry.
- **[8. Concurrency]** No findings, and one real trap named rather than waved past. There is no async task, no `AbortController`, no timer, no listener and nothing that outlives a render — but there *is* a check-then-act shape available in the state update, and it is the one this category exists to catch in a React file: `setExpanded(!expanded)` reads a value captured at render time and races React's batching. § 3 mandates the functional updater `setExpanded((open) => !open)`, matching both shipped disclosures, and code-review should treat the non-functional form as a defect rather than a style note.
- **[9. Threat model alignment]** Hostile daemon response is the only applicable threat and is addressed by categories 1, 3, 6 and 7 together: the workspace label is decoded fail-closed upstream, derived by one total non-throwing function, rendered as an auto-escaped React child inside a bounded row, never logged, never resolved, and — the one thing this ticket adds — never promoted into an attribute by the control the row became. Malicious / compromised relay is out of scope for a renderer-side disclosure toggle: the relay is content-blind and cannot inject inside the Noise session. Token theft from disk and renderer-compromise-reaching-the-transport are unaffected — this ticket grants the renderer no new capability and persists nothing. The same-label ambiguity remains a **display** concern, not a trust one, and stays with **#716**.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-24
