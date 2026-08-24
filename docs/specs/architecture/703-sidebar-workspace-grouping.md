# #703 — Group each sidebar tree's rows by workspace under the host row

## Files to read first

- `src/renderer/src/screens/channels/channelListViewModel.ts:1-49` — the whole derivation half lands here. `UNNAMED_LABEL:9` + `titleFor:16` are the client-owned-fallback idiom this ticket copies; `partitionActive:44` is the function whose output gets grouped (archived rows are already gone by then, so grouping composes on top and needs no archive check of its own).
- `src/renderer/src/screens/channels/ChannelList.tsx:233-283` — `HOST_ROW_LABEL` + `HostRow`, shipped by #710. The new `WorkspaceRow` is its exact structural twin one indent deeper; read the comment block for the class-token / text-collision discipline it records.
- `src/renderer/src/screens/channels/ChannelList.tsx:285-341` — `renderBody`. The two `length > 0` gates at `:306` / `:321` and the two `<HostRow />` call sites at `:309` / `:324` are the anchors; the `.map` bodies below each are what this ticket wraps.
- `src/renderer/src/screens/channels/ChannelList.tsx:359-378` — `Row`. Read for its class vocabulary only (`channel-list__row`, `__row-open`, `__title`, `__time`): the new row must collide with none of them (§ 6).
- `src/renderer/src/screens/channels/ChannelList.test.tsx:59-80` — the marker constants and `countOf:72` (`markup.split(needle).length - 1`). The new tests reuse both. The closing `"` in each marker is load-bearing: it is what stops `class="channel-list__row"` matching `__row-open`.
- `src/renderer/src/screens/channels/ChannelList.test.tsx:220-278` — #710's seven host-row tests. The new tests extend this `describe`'s idiom; **none of these seven change** (§ Testing).
- `src/renderer/src/screens/channels/ChannelList.test.tsx:144-151` — the "escapes markup in an untrusted name" test. The `cwd` twin (§ Security review, category 1) is modelled on it verbatim.
- `src/renderer/src/screens/channels/channelListViewModel.test.ts:12-24` — the `row()` fixture (`cwd: '/tmp'`) and the file's plain-function test idiom. Note the fixture cwd: every existing `ChannelList.test.tsx` row also seeds `/tmp`, so all pre-existing tests keep rendering exactly one group.
- `src/renderer/src/screens/channels/channels.css:41-74` — `.channel-list__host` / `__host-icon` / `__host-label`. The three new rules are these three with one padding value changed and the ellipsize quartet added (§ 7).
- `src/renderer/src/screens/channels/channels.css:168-181` — `.channel-list__title`, the file's ellipsize idiom for unbounded untrusted text. The workspace label needs it; the host label deliberately does not (its label is a 6-char constant).
- `src/renderer/src/screens/conversation/WorkspacePickerSheet.tsx:58-66` — `FolderIcon`, the Material `folder` path already in the codebase. **Copy the `d` string, do not import the component** (it is module-local and hardcoded to 24px; extracting a shared icon module is out of scope).
- `src/main/transport/inboundMessage.ts:1049-1062` — `parseConversationSummary`. `requireString(payload, 'cwd')` is the fail-closed decode boundary that guarantees `cwd` is a `string` before it reaches the store, and `:1049` records why decoder errors never echo it.
- `src/shared/wire/types.ts:914-922` — `ConversationSummary.cwd`, required `string`, "carried as opaque display text… never resolved into a filesystem path".
- `e2e/fixtures/launchPairedApp.ts:64-72, 216-232` — `SEEDED_ROW.cwd = '/fake/workspace'` and the unfiltered `page.locator('.channel-list__row-open').click()` that 28 specs ride. **Do not edit** (§ 6).
- `e2e/save-as-channel-promote.spec.ts:102-144` — the `.channel-list__section-header` + `hasText` locator pair. **Do not edit.**
- `docs/specs/architecture/710-sidebar-host-row.md` — the predecessor. Its § 2 (the two selector hazards) and § 5 (the token table) are the templates for § 6 and § 7 here.

**Tooling note.** `codegraph` is wired but still not indexed for this repo — `codegraph_context` errors `CodeGraph not initialized` (probed 2026-08-24 for #709 and #710, same result). This list was built by grep + Read, which is also the right tool for the load-bearing question: *which CSS class strings and which literal texts appear inside Playwright locators*. Those are string literals a symbol graph does not index.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=102-4

The workspace row (`106:3098`, second child of `Host container` `106:3104`) is a 28px row — `padding: 4px 16px 4px 24px`, `gap: 10px` — holding a 12×10 folder glyph (`106:3108`, inside the `Row icon` wrapper `106:3110` at x=24) beside a single text label (`106:3100` at x=46) in M3 title-small on `schemes/on-surface`. It is the same 28px rhythm and the same type + color as the host row `106:3094` above it; the **only** visual difference is the 8px deeper left inset (24 vs 16), which is how the design shows the nesting. One text node, one line, no disclosure glyph, no status dots.

**Trap in the design — the label node is named "Second Brain".** That is a display name with a space in it, not a path segment: placeholder content, exactly as "Pyrybox" was on the host row for #710. The string this ticket ships is derived per § 2, never read off the node.

**Screenshots were unavailable this session.** `get_screenshot` returned a 1×1 PNG for every node tried (`106:3098`, `106:3104`, `102:4`; confirmed by downloading the asset — `PNG image data, 1 x 1`), a renderer-side failure unrelated to the design. The geometry above is therefore taken from `get_metadata` child x/y/w/h (padding and gap by subtraction) and `get_design_context`'s resolved token names — the arithmetically checkable path, which is the stronger of the two anyway. Nothing in this ticket depends on a visual judgement that the numbers do not settle.

## Context

Each sidebar tree is now `<section label> → <host row> → <conversation rows>` (#710, PR#715). This slice inserts the workspace level between the host row and the rows: one group per distinct `cwd`, each headed by a workspace row, so a machine with six projects on it stops reading as one undifferentiated list.

No new data and no wire change: `ConversationSummary.cwd` already carries the workspace — the daemon has no separate workspace-id concept, a workspace *is* a conversation's cwd (pyrycode#823). Both trees repeat the host and workspace levels independently, on purpose (operator, 2026-08-21); a workspace with rows in both trees appears in both. Groups render expanded — collapse is #704. Two workspaces whose last segment matches render two groups with the same label; that ambiguity is real, deliberately unsolved here, and owned by #716.

## Scope check

| Red line | Limit | This ticket |
|---|---|---|
| New files | 3 | **0** |
| Total written LOC (prod + tests + CSS) | ~600 | **~330** — ~50 viewModel, ~50 TSX, ~25 CSS, ~120 viewModel tests, ~85 view tests |
| New exported types / components | 5 | **4** — `WorkspaceGroup`, `workspaceLabelFor`, `groupByWorkspace`, `UNKNOWN_WORKSPACE_LABEL`. `WorkspaceRow` is module-local, the `HostRow` posture |
| Acceptance criteria | 5 | **4** |
| Reject / error branches | 10 | **1** — the no-usable-segment fallback. No state machine, no async, no log call |
| Consumer call sites needing simultaneous update | 10 | **0** — purely additive. No signature change, no prop change, no type rename; `partitionActive` and `Row` are untouched |

Production source files (`*.ts` / `*.tsx`, excluding tests) touched: **2** — `channelListViewModel.ts`, `ChannelList.tsx`. Under the ≥5 self-check. Sizing stands at **S**.

**Branch-overlap check (§1.5): clean.** `git fetch origin --prune` then a per-branch diff of all 14 `origin/feature/<N>` branches against `main`, for all five files this ticket touches (`ChannelList.tsx`, `ChannelList.test.tsx`, `channels.css`, `channelListViewModel.ts`, `channelListViewModel.test.ts`): zero overlaps. No `blockedBy` needed.

## Design

### 1. Where the work goes — derivation in the view model, structure in the view

The split the file already makes holds: everything that reads `cwd` is a pure framework-free function in `channelListViewModel.ts`, unit-tested without React; `ChannelList.tsx` only arranges the result. That matters more than usual here, because `cwd` is the untrusted string and a single named function is what makes its handling auditable (§ Security review, category 1).

Four new exports in `channelListViewModel.ts`:

```ts
export const UNKNOWN_WORKSPACE_LABEL = 'Unknown workspace'

export type WorkspaceGroup = {
  readonly key: string
  readonly label: string
  readonly rows: readonly ConversationSummary[]
}

export function workspaceLabelFor(cwd: string): string | null
export function groupByWorkspace(rows: readonly ConversationSummary[]): readonly WorkspaceGroup[]
```

### 2. `workspaceLabelFor` — the hostile string

**Contract.** Returns the last usable path segment of `cwd`, or `null` when there is none. Total: never throws, for any string. No `path`, no `fs`, no `node:*`, no `URL`, no regex over the whole string — split on `/` and walk.

**The rule, in one sentence:** split `cwd` on `/`, walk the segments from the end, and return the first one that is non-blank after trimming; if every segment is blank, return `null`.

That single rule covers every case the ticket names, which is why it is one walk and not a chain of special cases:

| `cwd` | Result | Why |
|---|---|---|
| `/home/me/pyrycode` | `pyrycode` | the ordinary case (AC2 — the segment, not the full path) |
| `/home/me/pyrycode/` | `pyrycode` | trailing separator: the last segment is `''`, skipped |
| `/home/me/pyrycode//` | `pyrycode` | repeated trailing separators, same walk |
| `/home/me/  ` | `me` | trailing whitespace-only segment, same walk |
| `pyrycode` | `pyrycode` | relative, no separator — one segment, usable |
| `C:\Users\me\proj` | `C:\Users\me\proj` | an unfamiliar separator convention: no `/`, so the whole value is its own single segment. Not blank, no throw — **survived**, which is what the ticket asks. It is not silently reinterpreted |
| `/` · `//` · `''` · `'   '` | `null` | nothing but separators or whitespace → the fallback group (AC3) |

**The returned segment is not trimmed.** The trim is only the *usability predicate*; the value handed to the label is the raw segment. The client normalises nothing (AC1's posture), and HTML collapses incidental whitespace at render anyway.

**`\` is deliberately not a separator.** Treating it as one would be an assumption about the daemon's host OS — an interpretation of a string CLAUDE.md says this client never interprets — and it would corrupt a legal Unix directory whose name contains a backslash. No Windows daemon has been observed; the pipeline's rule is not to ship a defense for an unobserved failure mode. If one ever appears, this is the one function that changes, and the table row above is the test that pins today's behaviour so the change is visible.

**Why `string | null` and not the `titleFor` shape.** `titleFor` folds its fallback in because its only caller renders the result. `workspaceLabelFor`'s caller is a *grouper* that must tell "no usable label" from "a label that happens to read like the fallback" — so the distinction has to survive the return. Deriving the grouping key by comparing the label against `UNKNOWN_WORKSPACE_LABEL` would merge a real directory named `Unknown workspace` into the fallback bucket, which AC3 forbids in both directions. Different job, different contract; this is intentional, not an inconsistency with `titleFor`.

### 3. `groupByWorkspace` — the key, and the one fallback bucket

One pass over `rows` in array order. For each row: `label = workspaceLabelFor(row.cwd)`.

- **Usable** (`label !== null`) → key is `row.cwd`, **the exact string, normalised in no way** (AC1). `/a/b` and `/a/b/` are two keys, therefore two groups, both labelled `b`. That is the honest surface the ticket asks for, not a bug.
- **Unusable** (`label === null`) → key is the module-local sentinel `UNKNOWN_WORKSPACE_KEY = ''`, label is `UNKNOWN_WORKSPACE_LABEL`.

**The sentinel is collision-proof by construction, and that is why it is `''`.** A collision would need a `cwd` that equals the sentinel *and* has a usable label — but `''` has no usable label, so any row whose `cwd` is `''` is already in the fallback bucket. No prefix hack, no `Symbol`, no impossible-string guess. Every unusable `cwd` (`''`, `'   '`, `'/'`, `'//'`) collapses into **one** group, which is exactly AC3's "one clearly-labelled fallback group" — N groups all reading "Unknown workspace" would be the #716 ambiguity, self-inflicted.

**The fallback group is ordered by first appearance like any other group.** It is not pinned last. AC4 says no sort anywhere, and "push the unknowns to the bottom" is a sort.

### 4. Ordering — a `Map`, never a plain object

AC4 is a correctness requirement, and there is a concrete trap between it and the obvious implementation: **a plain object enumerates integer-like string keys first, in numeric order, regardless of insertion order.** `cwd` is arbitrary untrusted text, so a relative `cwd` of `'2'` is a legal key — and with an object accumulator it would jump ahead of every earlier group. (The same trap this codebase already hit on `Object.entries` in `threadTimeline.ts`, spec #706.)

`Map` preserves insertion order for *all* keys, including integer-like strings. So: accumulate into `new Map<string, ConversationSummary[]>()`, then materialise with `Array.from`. Row order inside each group is push order, which is the daemon's array order. No `sort`, no `localeCompare`, no `Object.keys`, no `Object.entries`, no object literal as an accumulator — anywhere in this ticket. § Testing pins it with a bare-numeric `cwd`.

### 5. Render placement — a keyed `Fragment`, and a DOM that stays flat

`renderBody` keeps its exact shape. Inside each of the two existing `length > 0` blocks, the `.map` over rows is wrapped one level:

```tsx
{groupByWorkspace(channels).map((g) => (
  <Fragment key={g.key}>
    <WorkspaceRow label={g.label} />
    {g.rows.map((c) => (
      <Row key={c.id} row={c} now={now} onOpen={() => onOpen(c)} onRename={() => onRename(c)} />
    ))}
  </Fragment>
))}
```

…and the identical wrap in the `discussions` block, keeping that block's `onSaveAsChannel` prop. `import { Fragment } from 'react'` joins the existing `useState` import — the first `Fragment` in the renderer, and the shorthand `<>` cannot carry a `key`.

Three things this placement gets for free, all worth not breaking:

- **The gates are untouched.** The workspace rows live *inside* the same `length > 0` block as the host row, so "a tree with zero rows renders neither a section label, nor a host row, nor a workspace row" holds by construction with no new condition — and the promote specs' zero-row-section proof survives. Do not hoist.
- **`Fragment` emits no DOM.** The rendered list stays a flat sequence of siblings — `header`, host, workspace, rows, workspace, rows — so `.channel-list__row` keeps the exact ancestry it has today. A per-group wrapper `<div>` would instead become the flex item of the `.channel-list` column and change every existing locator's tree position for no gain. No wrapper.
- **Keys cannot collide.** React keys are scoped per sibling list, so the group keys (`cwd` strings) and the row keys (`c.id`) never share a namespace. A hand-flattened `flatMap` would put both in one list and need a prefix hack to stay safe.

`WorkspaceRow` is module-local (the `HostRow` / `SettingsButton` posture — proven through `ChannelListView`, not directly) and takes one prop:

```tsx
function WorkspaceRow({ label }: { label: string }): JSX.Element
// <div class="channel-list__workspace">
//   <svg class="channel-list__workspace-icon" aria-hidden="true" …folder path…/>
//   <span class="channel-list__workspace-label">{label}</span>
// </div>
```

Not interactive: a plain `<div>`, no `<button>`, no `onClick`, no `aria-label` (collapse is #704). The glyph is `aria-hidden` — the visible label already carries the row's meaning. `label` is daemon-derived and goes in as an auto-escaped React **child**, and nowhere else: never `title=`, never any other attribute, never a URL (§ Security review).

The glyph is a seventh inline Material path in this file's idiom — `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">` with the `folder` `d` copied from `WorkspacePickerSheet.tsx:63`, sized 12px to match `.channel-list__host-icon` rather than that file's 24px. Same shape as the Figma's `folder-solid-full`; the design's 12×10 is that shape's natural aspect inside a 12px box.

### 6. The selector and text hazards — what decides the class name and the copy

Same failure mode as #710 at the same two blast radii: Playwright locators run in strict mode, so a new element that *joins* an existing locator's match set raises a strict-mode violation rather than an assertion failure — and `launchPairedApp.ts:224` clicks an unfiltered `.channel-list__row-open` that 28 specs ride. Both halves are closed by construction, and re-verified for this ticket:

**Class-token guard.** Class selectors match whole tokens. `channel-list__workspace` shares no token — and no substring — with `channel-list__row`, `__row-open`, `__section-header`, `__host`, `__save`, `__rename`, `__title`, `__time`, `__divider`, `__archive`, `__settings`, `__fab`, `__empty`. It is also distinct from every *other* `workspace`-bearing class in the app: `workspace-picker__row` (`WorkspacePickerSheet.tsx:149`), `settings__default-workspace-row` / `-value` (`DefaultWorkspaceRow.tsx:49-52`), `conversation__workspace-chip*` (`ConversationScreen.tsx:979-985`) — all different tokens, and none of those specs scope inside `.channel-list`. Grep confirms **zero** `[class*=]` / `[class^=]` / `[class$=]` selectors anywhere in `e2e/` or `src/renderer`, so no substring selector can reach it either.

**Text guard — and this is the half that is new.** Unlike #710's constant, the visible label is *daemon-derived*, so the check is against what the fixtures actually seed. Every fake fixture seeds `cwd: '/fake/workspace'` (`conversationStateFake.ts:56,65`, `launchPairedApp.ts:69`, and each spec's own seed), so in the default e2e tier every workspace row renders the literal **`workspace`**, twice per launch. Verified against every text locator that can reach it:

- The six `.channel-list`-scoped `getByText(…, { exact: true })` calls (`save-as-channel-promote.spec.ts:125,143,157,180`; `conversation-create-rename.spec.ts:63,112,115`; `conversation-state-fake.spec.ts:71,76`; `conversation-archive-lifecycle.spec.ts:190,192`; `real-daemon-rename.spec.ts:87,92`) match `Seeded channel`, `Scratch discussion`, `Dedicated discussion`, `Original channel`, `Untitled`, `NEW_TITLE`. `exact: true` — `workspace` equals none of them.
- The `hasText` header locators (`save-as-channel-promote.spec.ts:110,112`; `real-daemon-promote.spec.ts:87,89`) are scoped to `.channel-list__section-header`, a class the new row does not carry, so they cannot reach it at all.
- The `.channel-list__row`-based `.filter({ hasText })` chains (`conversation-switch-remount.spec.ts:101,114`; `conversation-archive-lifecycle.spec.ts:153`) filter a base set the new row is not in.
- `.workspace-picker__row` `hasText` locators (`default-workspace.spec.ts:119`, `workspace-picker.spec.ts:163`) are a different class on a different screen.

**The fallback label `'Unknown workspace'` never renders in the default e2e tier** — every seeded `cwd` yields a usable segment — and equals none of the exact-match strings above regardless.

**The invariant this ticket must leave standing:** `e2e/` is not edited. Not one file, not one comment. The existing default-tier suite (`npm run e2e`, 40/40 as of PR#715) passing **unchanged** is the proof. If implementing this makes an e2e edit look necessary, the class name is wrong — fix the new code, do not adjust the spec's locators.

**What the default e2e tier does *not* prove, and must not be asked to.** One seeded `cwd` per launch means exactly one group per tree. Multiple groups, first-appearance ordering, and the fallback group have **zero** e2e coverage and are unit-tested only. Do not add an e2e AC for them: a spec asserting "groups render in daemon order" against a one-group fixture passes vacuously, which is worse than no test.

### 7. Styles — `channels.css`, three rules

Append directly after the `.channel-list__host-label` rule at `:74`, keeping the file's "read top-down as the list reads" order. Every value is a token; the glyph's 12px box is structural component geometry set on the `<svg>` (the `.channel-list__host-icon` precedent).

| Selector | Property | Value | Source |
|---|---|---|---|
| `.channel-list__workspace` | `display` / `align-items` | `flex` / `center` | Figma row; centering the 12px glyph against the 20px line box reproduces the `Row icon` wrapper (`106:3110`, 12×20) without a wrapper element — the `.channel-list__host` treatment |
| | `gap` | `var(--space-3)` | Figma `gap: 10px`. The scale has no 10px slot; `--space-2` (8px) and `--space-3` (12px) are both ±2, so the tie breaks toward **12px**, which makes the glyph→label rhythm identical to the host row directly above. Design intent, not a coincidence to preserve — the file's established ±token-mapping practice (`--radius-md` +4px at `:315`, `--text-label-small` 1px at `:422`) |
| | `padding` | `var(--space-1) var(--space-4) var(--space-1) var(--space-6)` | Figma `py-4 pl-24 pr-16`. **The 24px left inset is the whole point of the row** — it is the 8px-deeper indent that shows the workspace nested under the host's 16px. Right stays 16px, matching the host row's edge |
| `.channel-list__workspace-icon` | `display` / `flex` | `block` / `0 0 auto` | the `__host-icon` rule verbatim — file icon convention, never shrink the glyph |
| `.channel-list__workspace-label` | the four `--text-label-large-*` | size / line / tracking / weight | Figma M3 title-small = `14 / 20 / 0.1 / 500`, an **exact** match for the theme's label-large set (`tokens.css:89-92`). No mapping delta — same type as the host label above it |
| | `color` | `var(--color-on-surface)` | Figma `schemes/on-surface` (#191c20). No `opacity` — same full-strength role as the host label |
| | `flex` / `min-width` / `overflow` / `text-overflow` / `white-space` | `1 1 auto` / `0` / `hidden` / `ellipsis` / `nowrap` | **The one rule that is not a copy of `.channel-list__host-label`.** The `.channel-list__title:170-181` ellipsize treatment, verbatim, because unlike the host's 6-character constant this label is unbounded untrusted daemon text and must be bounded rather than blowing out the 400px sidebar |

No `border-radius` (the Figma's 6px corner has nothing to clip — no background, no hover in this slice), no background, no hover, no focus rule: the row is not interactive.

### 8. State, concurrency, error handling

**State:** none added. No store slice, no selector, no `useState`, no `useEffect`, no IPC, no wire change. `groupByWorkspace` is a pure synchronous function of the array `partitionActive` already returns.

**Re-render seam:** `groupByWorkspace` runs inside `renderBody` on every render of `ChannelListView`, alongside the two `partitionActive` filters that already run there. It is a single O(n) pass over the active rows — same order as what it sits next to, no memoization. `useMemo` here would add a dependency array to keep honest for no measured win; the list is bounded by the conversation count and the component re-renders only when the store's `conversations` slice changes.

**Concurrency:** none. No async, no promise, no subscription, no timer, no teardown path — nothing to cancel.

**Error handling:** one branch, no throw path. `workspaceLabelFor` is total over `string`, and `cwd` is guaranteed to *be* a `string` upstream by `requireString` at `inboundMessage.ts:1059` (fail-closed at decode, so a malformed frame is rejected before the store ever holds it). The single failure mode — no usable segment — is not an error: it is the fallback group, surfaced in the UI as a labelled group and **never** logged, never thrown, never a banner. See § Security review, category 7 for why the tempting "log the unusable cwd" diagnostic is forbidden.

## Testing strategy

`npm test` (vitest) is the liveness proof; `npm run build` is the gate. No new e2e spec, and **zero files under `e2e/` may be edited** (§ 6).

**`channelListViewModel.test.ts`** — two new `describe`s, in the file's existing plain-function idiom.

`workspaceLabelFor` — one case per row of § 2's table:
- Ordinary absolute path → the last segment, not the full path (AC2).
- Trailing separator, repeated trailing separators, trailing whitespace-only segment → the last *non-blank* segment.
- Relative single-segment `cwd` → itself.
- A backslash-separated value → returned whole; asserts non-null and non-blank (survives, no throw), and pins today's deliberate no-`\`-splitting behaviour.
- `''`, `'   '`, `'/'`, `'//'` → `null` (AC3).
- A value containing a `<script>`-shaped substring → returned as an ordinary string; proves the function does no parsing of its own.

`groupByWorkspace`:
- Rows with identical `cwd` → one group, rows in array order (AC1, AC4).
- Rows with `cwd` values differing only by a trailing `/` → **two** groups, both labelled with the same segment. The explicit "normalises nothing" pin (AC1).
- Interleaved workspaces (`A`, `B`, `A`) → two groups in first-appearance order, group `A` holding rows 1 and 3 in that order (AC4).
- **Integer-like key ordering:** a row with `cwd: '/x'` followed by one with `cwd: '2'` → group order is `['x', '2']`. Fails against a plain-object accumulator, passes against a `Map` (§ 4). This is the test that makes AC4 real.
- Several rows with *different* unusable `cwd`s (`''`, `'   '`, `'/'`) → exactly **one** fallback group holding all of them, labelled `UNKNOWN_WORKSPACE_LABEL` (AC3).
- An unusable row followed by a usable one → the fallback group comes **first** (first appearance, not pinned last).
- A row whose `cwd` is literally `'Unknown workspace'` → its **own** group, separate from a fallback group in the same input, even though both render the same label (AC3's "never folded into a real workspace's group", both directions).
- Empty input → empty array.

**`ChannelList.test.tsx`** — a new `describe` beside #710's, reusing `countOf` and adding two markers (`class="channel-list__workspace"`, `class="channel-list__workspace-label"`).

- **One workspace row per group, per tree.** Two promoted rows sharing a `cwd` + one non-promoted → workspace-row count is 2 (one per tree). Give the promoted pair distinct `cwd`s → 3.
- **Order within a tree.** `indexOf('>Channels<')` < host marker < workspace marker < first `class="channel-list__row"` — the level sits below the host row and above that group's conversation rows.
- **Empty and not-yet-loaded render no workspace row.** `render([])` and `render(null)` → count 0. Pairs with #710's `:247-253`.
- **The conversation-row match set is unchanged (the 28-spec hazard, unit-level mirror).** With one row per tree: `class="channel-list__row"` occurs exactly 2×, `class="channel-list__row-open"` exactly 2×, `class="channel-list__section-header"` exactly 2×, `class="channel-list__host"` exactly 2× — every count they had before this ticket.
- **An untrusted `cwd` renders as escaped text, never live markup.** A `cwd` ending in a `<img src=x onerror=…>`-shaped segment → the markup contains the escaped form and no live tag; modelled on `:144-151`. Also assert the markup contains **no** `title=` substring at all.
- **The fallback group renders its label.** A row with `cwd: '/'` → the rendered workspace label is `UNKNOWN_WORKSPACE_LABEL`, read back out of the markup by splitting on `class="channel-list__workspace-label">` rather than restating the constant.

**None of #710's seven host-row tests change**, and none of the file's earlier tests change: the `row()` fixtures all seed one `cwd` (`/tmp`), so every pre-existing assertion still sees exactly one group per tree.

**Also run `npm run e2e` unchanged.** Not a new spec — the unchanged default tier going green *is* § 6's proof.

## Open questions

None blocking. Three things handed forward:

- **#704** adds collapse. The seam is ready: `WorkspaceGroup.key` is already a stable per-group identity to hold collapsed-state against, and the flat `Fragment` structure means collapsing is a conditional on `g.rows.map`, not a DOM restructure. It will also turn the row interactive (`<button>`, `aria-expanded`), at which point the `border-radius: 6px` + hover/focus rules the Figma draws and § 7 skips become live.
- **#716** owns the same-last-segment ambiguity. Note for whoever writes it: the ambiguity has *two* sources under this design — two real workspaces whose last segments match, and a real workspace literally named `Unknown workspace` sitting beside the fallback group. Both are separate groups with separate keys; only the rendered label collides. Whatever mechanism #716 lands must not be an HTML attribute (CLAUDE.md 2026-08-20, #696's MUST FIX), and the Figma row has no spare text node for a second line — that is why the mechanism is a PO/design question, not an architect coin-flip.
- **A Windows-hosted daemon**, if one ever appears, changes exactly one function (§ 2) and one test row. Deliberately not pre-built.

## Security review

**Verdict:** PASS

**Findings:**

- **[1. Trust boundaries]** No MUST FIX. This ticket adds one untrusted-data path: `ConversationSummary.cwd` → grouping key + rendered label. The boundary is explicit and singular — `workspaceLabelFor` in `channelListViewModel.ts`, a framework-free total function whose contract is its doc comment — rather than scattered inline string work in the view. Upstream the value is already fail-closed-decoded as a `string` (`requireString`, `inboundMessage.ts:1059`), so the function never sees a non-string at runtime; it must still not throw on any string, which § 2's walk guarantees (no indexing that can be out of range, no regex backtracking, no parse). Downstream there is no type-level "now trusted" signal — both sides are `string` — which is the same posture `ConversationSummary.name` already has through `titleFor`; the mitigation is that exactly one function reads `cwd` and the rest of the ticket handles only its output. **SHOULD FIX (test-covered):** the markup-escaping test for `cwd` listed in § Testing is the check that keeps this honest; code-review should confirm it exists, since it is the twin of the shipped `name` test at `ChannelList.test.tsx:144`.
- **[2. Tokens, secrets, credentials]** No findings — not applicable by design. No token, key, or credential is read, written, rendered, or compared. `serverInfoStore` / `pairedServerStore` are **not** imported: #710 established that prohibition for the host row's label and it extends unchanged here. The only data the new code touches is `cwd`, which is display text.
- **[3. File / storage operations]** No findings, and this is the category the ticket's shape most invites. `cwd` *looks* like a path, and `path.basename()` is the obvious implementation — it is forbidden. **MUST NOT:** no `path`, no `fs`, no `node:*` import, no preload helper, and no resolve / join / normalize / stat / open, anywhere on this path. `cwd` is split as an opaque string and never becomes a filesystem argument, so path traversal is not mitigated here, it is structurally absent — there is no filesystem call to traverse into. TOCTOU, storage scope, encryption-at-rest and atomic writes are all inapplicable: nothing is read from or written to disk. Per CLAUDE.md's 2026-08-20 ruling the derived label is also never a filename, cache key, or lookup path. The two "key" uses are a `Map` key and a React reconciliation key, both in-memory list identities that index nothing outside the render — and daemon-supplied strings are already React keys in this exact file (`key={c.id}`, `ChannelList.tsx:314`).
- **[4. Inter-process / Electron attack surface]** No findings — no surface is added. No new `contextBridge` API, no `ipcMain` channel, no command type, no wire change, no `BrowserWindow` option, no protocol handler, no navigation. The change is a pure derivation over data the renderer store already holds, so a renderer compromise gains nothing it did not already have.
- **[5. Cryptographic primitives]** No findings — not applicable. No randomness (no `Math.random()`, none needed), no hashing, no key material, no Noise interaction. The only equality comparison is `Map` key lookup between two `cwd` strings; neither operand is a secret, so `crypto.timingSafeEqual` does not apply and plain string equality is the correct primitive.
- **[6. Network & I/O]** No findings — no network surface is added. Considered and declined: a hostile daemon could return many conversations with long, all-distinct `cwd` values. Amplification is bounded — grouping adds at most one row per conversation the list *already* renders a row for, a ≤2× DOM growth, not an unbounded fan-out — and an unbounded label string is visually bounded by the ellipsize rule in § 7. Truncating the label string itself was rejected under the evidence-based rule: `.channel-list__title` has rendered unbounded untrusted `name` with exactly this treatment since #141 with no observed failure, and diverging here would be a new posture for no observed cause.
- **[7. Error messages, logs, telemetry]** No MUST FIX, one explicit prohibition. **`cwd` must never be logged, in whole or in part.** The tempting diagnostic — a `console.warn` on the fallback path, "cwd yielded no workspace label: …" — would put untrusted workspace-path text into the renderer console, and is exactly what the content-free logger (#126) and the decoder's own discipline forbid (`inboundMessage.ts:1049` names the failure category only, precisely because "a `name` / `cwd` could echo a conversation title or workspace path"). The design closes this by having **zero** log calls and **zero** throw paths in the new code: a thrown error would carry the offending `cwd` in its message into any error boundary or crash reporter, which is the second reason § 2's function must be total rather than validating-and-throwing. No telemetry, no user-facing error surface.
- **[8. Concurrency]** No findings — not applicable. `groupByWorkspace` is synchronous and pure; no async task, no `AbortController` to thread, no timer, no listener, no store write, no check-then-act across an `await`, nothing that outlives a render. Shutdown and duplicate-connection concerns are untouched.
- **[9. Threat model alignment]** Hostile daemon response is the applicable threat and is addressed by categories 1, 3, 6 and 7 together: `cwd` is decoded fail-closed upstream, handled by one total non-throwing function, rendered as an auto-escaped React child with a bounding CSS rule, and never logged, never resolved, never made an attribute. Malicious/compromised relay is out of scope for a renderer-side derivation — it is content-blind and cannot inject inside the Noise session. Token theft from disk and renderer-compromise-reaching-the-transport are unaffected: this ticket grants the renderer no new capability. The same-label ambiguity (two real workspaces sharing a last segment, or a real workspace named `Unknown workspace` beside the fallback group) is a **display** ambiguity, not a trust one — the groups keep distinct keys and are never merged — and is explicitly deferred to **#716**.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-24
