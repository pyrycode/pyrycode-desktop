# Spec #141 — Channel List screen: two-tier Channels / Recent discussions with last-activity time and empty state

**Ticket:** [#141](https://github.com/pyrycode/pyrycode-desktop/issues/141) · size **S**, no split · **not** security-sensitive
**Lineage:** #139 (transport decode) → #208 (store observer) → **#141 (this screen)**. Mirror of mobile #312.
**Replaces:** the throwaway `PlaceholderList` in `PairedShell.tsx` (the `list` arm from #140).

## Context

The paired region's inner shell (#140) lands on a throwaway `PlaceholderList` — a single "Open conversation"
button. This slice replaces that placeholder with the real **Channel List** home screen: the daemon's
conversations, split into **Channels** (saved) and **Recent discussions** (ad-hoc), each row showing its
title and when it was last active, plus an empty state.

It is a **pure render slice over an already-shipped store** — the #208 `conversationListStore`, read through
`useConversationListStore(selectConversations)`. **No transport, IPC, store, wire, or bridge code is added**
(AC1). It mirrors the shipped render-slice pattern of #203 (timeline) and #218 (tool-call row): a pure view +
small pure helpers with unit tests, hosted by a thin container, styled token-only from the mobile Figma.

**Load-bearing data constraint (read before scoping the row).** The wire `ConversationSummary`
(`src/shared/wire/types.ts:362`) carries **no message text** — only `last_message_ts` (RFC3339), plus `id`,
`name` (`string | null`), `is_promoted`, `is_archived`, `cwd`, `last_used_at`. So the Figma "Recent
discussions" rows' **2-line body-preview** and **message-derived titles** are **not buildable today** and are
deferred (see § Out of scope / deferred). Every desktop row instead shows the **last-activity relative time**
derived from `last_message_ts` — the honest "last message" signal we do have. This collapses both Figma row
shapes (avatar-bearing channel rows, preview-bearing discussion rows) to a single **title + time** row.

## Files to read first

- `src/renderer/src/PairedShell.tsx:23-45` — **the file you edit.** `PairedShellView`'s `case 'list'`
  (line 24-25) is the arm you swap from `<PlaceholderList …>` to `<ChannelList …>`; the `PlaceholderList`
  function (lines 33-45) is deleted. The `PairedShell` container, `onOpen`/`onBack` seams, and the
  `nextPairedRoute` reducer are **unchanged** (AC1, ADR 0006).
- `src/renderer/src/store/conversationListStore.ts:22-64` — the store you read. Extract: `selectConversations`
  + `useConversationListStore` signatures; and the **`null` (not-yet-loaded) vs `[]` (loaded-zero)**
  distinction (lines 22-29) that AC4 turns on. Rows are held **verbatim snake_case** — no camelCase remap.
- `src/shared/wire/types.ts:351-370` — `ConversationSummary` field semantics. Extract: `name: string | null`
  (a literal `null` is "unnamed", distinct from `''`); `is_promoted` (`true` = channel, `false` = discussion);
  `last_message_ts` is a **timestamp, not preview text**; `cwd` is opaque and **not rendered here**.
- `src/renderer/src/screens/conversation/messageViewModel.ts` (whole file, 36 lines) — the **framework-free
  `.ts` view-model + `assertNever`** idiom your `channelListViewModel.ts` mirrors (pure functions,
  unit-tested without React or a store).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:1-40` — the **container / pure-view split**
  and the `import './conversation.css'` convention `ChannelList` mirrors (a co-located `channels.css`).
- `src/renderer/src/theme/tokens.css` (whole file, 92 lines) — the tokens you reference. **`title-medium`
  is ABSENT** and must be added (§ Design gives the exact values); `label-large` (66-69), `body-small`
  (60-63), `on-surface` / `on-surface-variant` / `outline-variant` (22-30), `space-1/3/4/6` (77-82) all exist.
- `src/renderer/src/PairedShell.test.tsx:13-53` **and** `src/renderer/src/App.test.tsx:46-64` — the two
  fixtures asserting the string `'Open conversation'` (`PairedShell.test.tsx:17` `LIST_MARKER`;
  `App.test.tsx:60`). Both move to the new list marker (§ Testing strategy).
- `docs/specs/architecture/218-tool-call-render.md` — the render-slice precedent this spec follows: the
  container-reads / pure-view split, the **server-render-with-injected-props** testing idiom, and the
  untrusted-daemon-string escaping posture (React auto-escaped children, never `dangerouslySetInnerHTML`).

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=15-8

Node 15-8 is a **surface-colored vertical scroll column**: a top app bar (Pyry logo + "Pyrycode" title +
settings gear), then a body with a **"Channels"** section (`label-large`, `on-surface-variant`, 85% opacity
header at `15:58`; rows `15:59+` = 40px monogram avatar · `title-medium` name · right-aligned `body-small`
last-activity time), a 1px `outline-variant` divider (`15:85`), a **"Recent discussions"** section (same
header; rows `15:88+` stack title · 2-line `body-medium` preview · `label-small` time), a "See all
discussions (N)" link, and a bottom-right `add` FAB. **Deferred to other tickets, per the ticket's Out of
Scope:** the top app bar (logo/title/settings gear → Settings #17-2), the monogram avatars, the 2-line body
previews + message-derived titles, the "See all" collapse, and the FAB (#142). **This ticket renders only
the two-section list of title-+-time rows and the empty state** — every deferred element is intentionally
absent (visual-fidelity check is scoped to the list body, not the full frame; see § Open questions).

## Design

Three units: a pure view-model module, a container + pure view, and CSS. New directory
`src/renderer/src/screens/channels/`.

### 1. `channelListViewModel.ts` (new, pure `.ts` — no React)

Mirrors `messageViewModel.ts`. Three exports (contracts, not bodies):

- `UNNAMED_LABEL = 'Untitled'` — the AC3 fallback label.
- `titleFor(name: string | null): string` — returns `name` when it is present and non-blank
  (`name.trim() !== ''`), else `UNNAMED_LABEL`. Guards `null` **and** empty/whitespace-only, honoring AC3's
  "never a blank row." Asserted by `channelListViewModel.test.ts`.
- `partitionByPromotion(rows: readonly ConversationSummary[]): { channels: readonly ConversationSummary[]; discussions: readonly ConversationSummary[] }`
  — two **order-preserving** filters on `is_promoted` (`true` → `channels`, `false` → `discussions`). No
  sort — the daemon's order is authoritative (AC2). Asserted for both split and order preservation.
- `formatLastActivity(iso: string, now: number): string` — the relative-time formatter. **`now` is injected**
  (not `Date.now()` inside) so the function is pure and deterministic under test. Bucket contract:

  | condition (delta = `now - Date.parse(iso)`) | output |
  |---|---|
  | `Date.parse(iso)` is `NaN` | `''` (row renders title only — untrusted daemon input degrades silently) |
  | `delta < 0` (clock skew, future ts) | `'just now'` (clamp, never `'-3m ago'`) |
  | `delta < 60_000` (1 min) | `'just now'` |
  | `delta < 3_600_000` (1 h) | `` `${Math.floor(delta/60_000)}m ago` `` |
  | `delta < 86_400_000` (24 h) | `` `${Math.floor(delta/3_600_000)}h ago` `` |
  | `delta < 172_800_000` (48 h) | `'Yesterday'` |
  | `delta < 604_800_000` (7 d) | `` `${Math.floor(delta/86_400_000)} days ago` `` (yields 2–6) |
  | else | a **deterministic, timezone-independent** short date |

  The `else` (older than a week) short date must not depend on the test runner's locale/timezone: derive it
  from **UTC** parts (e.g. `Mon DD` via a fixed month-name lookup) or slice the RFC3339 date (`iso.slice(0,10)`).
  Developer's choice of the two; the test asserts a stable substring, not a locale rendering. Buckets match the
  Figma exemplars ("2m ago", "3h ago", "Yesterday", "2 days ago").

### 2. `ChannelList.tsx` (new — container + pure view)

`import './channels.css'` at the top (the `ConversationScreen.tsx` convention). Two exports:

- **`ChannelList` (container)** — `function ChannelList({ onOpen }: { onOpen: () => void }): JSX.Element`.
  Reads `const conversations = useConversationListStore(selectConversations)`, captures
  `const now = Date.now()`, and returns `<ChannelListView conversations={conversations} now={now} onOpen={onOpen} />`.
  The store read and `Date.now()` are the container's only impurities (both safe under `renderToStaticMarkup`
  in Node — the store yields its initial `null` there, exactly like #218's container).
- **`ChannelListView` (pure view)** — props `{ conversations: readonly ConversationSummary[] | null; now: number; onOpen: () => void }`.
  Always returns a stable root `<section className="channel-list" aria-label="Conversations">` (the test hook,
  present in every state), with content by state:
  - `conversations === null` → **empty section, no children** (AC4: not-yet-loaded shows neither rows nor the
    empty state — the neutral-first-paint posture; #203 `Timeline` null-on-empty).
  - `conversations.length === 0` → the **empty state**: one centered `<p className="channel-list__empty">No
    conversations yet</p>` (AC4). (Mobile #312's "Tap + to start a conversation" is adapted — the `+` FAB is
    #142, deferred; do not reference an affordance that isn't here.)
  - non-empty → `partitionByPromotion`, then render each **non-empty** section as a header + its rows, with a
    divider **only between two present sections**:
    - `channels.length > 0` → `<header>Channels</header>` + channel rows.
    - `channels.length > 0 && discussions.length > 0` → `<div className="channel-list__divider" />`.
    - `discussions.length > 0` → `<header>Recent discussions</header>` + discussion rows.
    A section with zero rows renders **no header** (AC2).

  **Row** (one `Row` sub-component, same shape both sections):
  `<button type="button" className="channel-list__row" onClick={onOpen}>` containing
  `<span className="channel-list__title">{titleFor(row.name)}</span>` and
  `<span className="channel-list__time">{formatLastActivity(row.last_message_ts, now)}</span>`.
  React key = **`row.id`** (`ConversationSummary.id` is a stable per-conversation string — unlike the timeline's
  array-index keying, a real identity is available and correct here). When `formatLastActivity` returns `''`,
  render no time text (or an empty span) — never `NaN`.

  **`onClick={onOpen}` is deliberate and interim.** Per the ticket's Out of Scope, per-row opening of a
  *specific* conversation needs a select-and-load transport path that does not exist. So **every** row invokes
  the shell's existing conversation-agnostic `onOpen`, which opens the single active conversation
  (sessionStore) — preserving #140's list→thread round-trip (AC1, "stays reachable, no regression") without
  new transport. The future select-and-load ticket changes only *what* `onClick` passes (the row's `id`); the
  seam is already the row. Note this honestly in the component comment.

### 3. `channels.css` (new — token-only, no literals)

Follows `conversation.css`'s discipline: **every** color/type/space value is a `var(--…)` token; opacity is a
de-emphasis device (the #218 precedent), not a color literal.

- `.channel-list` — the scroll column: `display: flex; flex-direction: column; overflow-y: auto;`
  `padding: var(--space-1) 0 var(--space-6);` fills the paired-shell area (`flex: 1 1 auto; min-height: 0`).
- `.channel-list__section-header` (`15:58`) — `label-large` quad, `color: var(--color-on-surface-variant);`
  `opacity: 0.85;` `padding: var(--space-3) var(--space-4) var(--space-1);`.
- `.channel-list__row` (`15:59`) — reset the button (`appearance: none; background: none; border: 0;
  text-align: left; cursor: pointer; width: 100%;`) then `display: flex; align-items: center;
  gap: var(--space-4); padding: var(--space-3) var(--space-4);`.
- `.channel-list__title` (`15:63`) — **`title-medium` quad** (new token, below); `color: var(--color-on-surface);`
  `flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` (bound an
  arbitrarily long untrusted `name`).
- `.channel-list__time` (`15:64`) — `body-small` quad; `color: var(--color-on-surface-variant);`
  `opacity: 0.75;` `flex: 0 0 auto; white-space: nowrap;`.
- `.channel-list__divider` (`15:85`) — `height: 1px; background: var(--color-outline-variant); opacity: 0.6;`
  `margin: var(--space-3) var(--space-4) 0;`.
- `.channel-list__empty` — centered neutral message: `body-medium` quad, `color: var(--color-on-surface-variant);`
  `text-align: center; padding: var(--space-6) var(--space-4);`.

**New token in `tokens.css`** — the row title's `title-medium` slot is absent. Add the four-property quad
beside the existing scale (matching #230's precedent of extending `tokens.css`), using the exact M3 values
from Figma node 15-8:

```
--text-title-medium-size: 16px;
--text-title-medium-line: 24px;
--text-title-medium-tracking: 0.15px;
--text-title-medium-weight: 500;
```

Do **not** approximate with `body-large` (weight 400, tracking 0.5px) plus an inline literal weight — that
would put a type literal in a component stylesheet, which `tokens.css` explicitly forbids.

### `PairedShell.tsx` edit

`import { ChannelList } from './screens/channels/ChannelList'`; change `case 'list'` to
`return <ChannelList onOpen={props.onOpen} />`; delete the `PlaceholderList` function and refresh the stale
`list` comment. `PairedShellView`'s prop shape, `PairedShell`, the reducer, and every other arm are untouched.

## State + concurrency model

**No new state, no async, no subscription, no teardown.** Single source of truth stays the #208
`conversationListStore` singleton, written only by `conversationListBridge` (unchanged). `ChannelList` reads a
narrow slice via `useConversationListStore(selectConversations)` — a list arrival re-renders only this
subtree. `now` is captured once per render at the container; the relative times are approximate and do **not**
tick (a live-updating clock is out of scope — a future ticket could add an interval; not here). Unidirectional
holds: the view reads and dispatches `onOpen`, never writes the store.

## Error handling

The only adversarial surface is the daemon-supplied strings actually rendered — **`row.name`** (via
`titleFor`) and the time (derived from `last_message_ts`). `cwd`, `id`, and the booleans are not rendered as
text. Failure modes:

- **Malformed / non-RFC3339 `last_message_ts`** → `Date.parse` is `NaN` → `formatLastActivity` returns `''`
  → the row still renders its title with no time. No throw, no `NaN ago`.
- **Clock skew (future `last_message_ts`)** → negative delta clamps to `'just now'`.
- **Markup in `name`** → rendered as an **auto-escaped React child** (never `dangerouslySetInnerHTML`, never a
  path/href) — identical posture to #203/#218; asserted below. This discharges "row fields are displayed as
  opaque text."
- **`name === null` or blank** → `UNNAMED_LABEL` ("Untitled"), never a blank row (AC3).

No banner/dialog surface — a list-render slice has no network or permission failure of its own; the store's
loading/empty states are the only conditions, handled by the `null` / `[]` / non-empty branches.

## Testing strategy

Vitest. Pure helpers unit-tested directly; the view server-rendered with injected props (the #218 idiom — no
DOM harness, no store). Bounded matrices — **representative bucket boundaries, not exhaustive enumeration.**

**`channelListViewModel.test.ts`** (new):
- `titleFor`: present name → the name; `null` → `'Untitled'`; `''` and `'   '` → `'Untitled'`.
- `partitionByPromotion`: a mixed list → correct `{channels, discussions}` split **with array order preserved
  within each** (assert by `id` sequence); all-promoted → `discussions` empty; all-unpromoted → `channels`
  empty.
- `formatLastActivity` (inject a fixed `now`): `'just now'` (delta 0 and 30 s); `'5m ago'`; `'3h ago'`;
  `'Yesterday'` (30 h); `'2 days ago'` and `'6 days ago'`; older-than-a-week → a non-empty stable date
  substring; malformed iso (`'not-a-date'`, `''`) → `''`; future ts (negative delta) → `'just now'`.

**`ChannelList.test.tsx`** (new — `renderToStaticMarkup(<ChannelListView … />)` with injected
`conversations`, `now`, and a `noop` `onOpen`):
- `null` → the `aria-label="Conversations"` wrapper is present, with **no** section header and **no** empty
  message (not-yet-loaded shows nothing).
- `[]` → the empty message ("No conversations yet") is present; no headers.
- both sections present → both `'Channels'` and `'Recent discussions'` headers, a `channel-list__divider`, and
  rows in array order (assert relative `indexOf` of two ids within a section).
- only promoted rows → `'Channels'` header, **no** `'Recent discussions'` header, **no** divider; symmetric
  discussions-only case.
- a row with `name: null` renders `'Untitled'`; a row's `last_message_ts` renders its expected bucket string
  for the injected `now`.
- **escaping (AC / opaque-text):** a row whose `name` contains markup (e.g. `<b>x</b>`, apostrophe-free — a
  prior desktop lesson: `renderToStaticMarkup` escapes `'` → `&#x27;`) renders escaped (`&lt;b&gt;…`), never
  live markup.

**Fixture moves (from #140):**
- `PairedShell.test.tsx:17` — `LIST_MARKER = 'Open conversation'` → `LIST_MARKER = 'aria-label="Conversations"'`
  (the always-present wrapper). The two `list`/enters-at-list assertions (lines 25, 50) then pass on the new
  surface. Row-content assertions live in `ChannelList.test.tsx`, not here.
- `App.test.tsx:60` — `expect(markup).toContain('Open conversation')` →
  `expect(markup).toContain('aria-label="Conversations"')`; the surrounding `not.toContain(CONVERSATION_MARKER/PAIRING_MARKER)`
  assertions are unchanged. (Both server-render without seeding the store, so the wrapper is present but empty
  inside — asserting the wrapper marker is sufficient and stable.)

`npm run build` (typecheck + build) and `npm test` green closes the build/QA gate.

## Out of scope / deferred (do NOT build here)

- **Body-preview text + message-derived titles** — blocked on the no-message-text wire gap; needs a daemon +
  wire change first (**@Juhana** flag carried from the ticket). Rows show title + last-activity time only.
- **Per-row opening of a specific conversation** — needs a select-and-load transport path; every row calls the
  conversation-agnostic `onOpen` in the interim.
- **Top app bar** (logo / "Pyrycode" title / settings gear → Settings #17-2), **monogram avatars**, **"See all
  discussions (N)"**, and the **new-discussion FAB** (#142). Each is its own concern.
- **`cwd` display / workspace label** — `cwd` is carried in the store but not rendered here (the workspace-label
  affordance and cwd→path resolution are deferred, per #208's carry-forward).

## Open questions

- **Archived rows (flag, non-blocking).** `ConversationSummary.is_archived` exists but the ACs never mention
  filtering. This spec renders **every** row the store holds, partitioned only by `is_promoted` (AC2 as
  written) — i.e. no `is_archived` filter. This is correct if the daemon already excludes archived
  conversations from the `conversations` list response (the likely case). If archived rows *do* arrive and
  should be hidden from the home list, that is a scoped follow-up (a one-line filter), not a change to this
  slice — no defense is built for an unobserved case.
- **Visual fidelity is scoped to the list body.** Because the top app bar, avatars, previews, "See all", and
  FAB are all deferred, a screenshot of this ticket's output will not match the full Figma frame 15-8. The
  fidelity check applies to the two-section list rows + headers + divider + empty state only; the developer
  should eyeball those against the node 15-8 body, not the whole frame.
- **Relative times don't tick.** `now` is captured per render. Acceptable for a first cut; a live-updating
  interval is a deferred enhancement, not part of this ticket.
