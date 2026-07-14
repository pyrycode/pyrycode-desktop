# Spec #365 — Channel Info sheet: shell + overflow entry + conversation detail

**Size:** S · **Security-sensitive:** no (renderer-contained; no transport/IPC/wire; the daemon strings
it renders are already rendered elsewhere in this file — no new trust boundary).
**Split from #155.** Sibling downstream tickets #366 (Archive) / #367 (Delete) / #368 (Rename) fill the
empty Actions slot this ticket ships.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-48

A bottom sheet (mobile stretched to the window) reusing the Run-config `StatusSheet` chrome: a centered
drag handle, a title row (the conversation name, left; a 40×40 close × target, right), a scrollable body
holding an **About** section-header + detail rows (label left in on-surface body-large, value right in
on-surface-variant), an **Actions** section-header, and a monospace **Channel ID** footer at ~55% opacity.
This ticket renders the About detail (Workspace + Last activity only), the empty Actions slot, and the
Channel ID footer; the deferred rows/sections are called out below.

## Files to read first

- `src/renderer/src/screens/conversation/ConversationScreen.tsx:757-808` — `StatusSheet` pure view: the
  overlay/scrim/panel/handle/header/title/close/body chrome + role/aria to clone for the new sheet.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:92-96,128,140-151` — the `sheetOpen`
  useState + `<StatusSheet onClose=…>` mount pattern; mirror it exactly for `channelInfoOpen`.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:1085-1207` — `ThreadOverflowMenuView` +
  `ThreadOverflowMenu`: the seam that calls `onChannelInfo` (line 1170-1173), **and** the document
  `keydown` Escape / outside-click effect idiom (1176-1195) to clone for the sheet's Escape.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:48-68,109` — `ConversationScreenProps`,
  the destructure, and the overflow mount `{onBack && <ThreadOverflowMenu onChannelInfo={onChannelInfo} />}`
  — the two lines to rewire.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:356-408` — `WorkspaceChip`: the
  untrusted-`cwd`-as-opaque-display posture + `WORKSPACE_CHIP_LABEL` client-constant idiom to follow for
  the sheet's copy and `cwd` rendering.
- `src/renderer/src/store/activeConversationStore.ts:19-61` — `activeConversation` slice + selector; the
  sheet's sole data source (already read in ConversationScreen at line 91).
- `src/shared/wire/types.ts:554-572` — `ConversationCreatedPayload` = `{ id, is_promoted, cwd,
  name: string | null, last_used_at }`. Note `name` can be a literal `null` (unnamed scratch, not empty
  string); `cwd`/`id` are opaque daemon strings; `last_used_at` is RFC3339.
- `src/renderer/src/screens/channels/channelListViewModel.ts:65` — `formatLastActivity(iso, now): string`
  ('just now' / '5m ago' / 'Yesterday' / 'Mmm DD'; `''` on invalid). Reuse for the Last-activity row.
- `src/renderer/src/screens/conversation/conversation.css:841-943` — `.status-sheet-overlay` /
  `__scrim` / `.status-sheet` / `__handle` / `__header` / `__title` / `__close` / `__close-icon` /
  `__body`: the chrome classes to **reuse**. And `:1132-1141` `.status-sheet__section-header` — reuse for
  the About / Actions headers.
- `src/renderer/src/screens/conversation/conversation.css:186-198` — `.conversation__workspace-chip-cwd`:
  the mono `cwd` treatment (`--font-mono` + body-small + on-surface-variant) to mirror for the Workspace
  value and the Channel ID footer.
- `src/renderer/src/theme/tokens.css:44,62-80` — `--font-mono`; `--text-body-large-*` /
  `--text-body-medium-*` / `--text-body-small-*` / `--text-label-large-*` token vocabulary.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1-40,971-1010` — the **server-render-only**
  test idiom (no jsdom / Testing Library) and the `ThreadOverflowMenuView` test shape to mirror.
- `src/renderer/src/PairedShell.tsx:51-52` — the `thread` route case (context: why it does **not** change
  under this design — see "Design decision: open-state ownership").

## Context

The thread overflow menu (#276, merged) already renders a **Channel info** menuitem whose `onChannelInfo`
callback is a **live no-op**: `ConversationScreen` accepts `onChannelInfo?` and forwards it to
`ThreadOverflowMenu`, but nothing supplies a handler that opens anything. This ticket makes the seam live
and introduces the sheet it opens — the render-first shell of the Channel Info sheet, following the
`StatusSheet` precedent (#177 shipped the run-config sheet shell; #181/#182 layered content in). No wire
messages are dispatched.

The active conversation is `activeConversationStore.activeConversation` (#278) — the daemon's
`ConversationCreatedPayload` held verbatim, written on **exactly one path**: the FAB create-nav callback in
`PairedShell` (`useConversationCreatedNav`). A thread opened from the channel list does **not** populate it
(the desktop app is single-active-conversation until the deferred select-and-load transport lands), so
`activeConversation` is `null` for a list-opened thread. **The sheet must open gracefully in that case** —
chrome + a placeholder About, never a crash. `ConversationScreen` already reads this slice at line 91.

## Design

Everything lands in `ConversationScreen.tsx` + `conversation.css` (+ the test). One production `*.tsx` file.
The shape mirrors `StatusSheet`: a pure exported view + a thin in-file container, open-state a
screen-local `useState` in `ConversationScreen` (ADR 0006).

### Design decision: open-state ownership (reconciles AC2)

The sheet's open-state (`channelInfoOpen`) lives in **`ConversationScreen`** as a new `useState(false)` —
the exact `sheetOpen` precedent AC2 cites (same component, ADR 0006), and identical to how the Run-config
`StatusSheet` is wired. `ConversationScreen` supplies the opener to its own overflow menu:

```
const [channelInfoOpen, setChannelInfoOpen] = useState(false)
// overflow mount becomes:
{onBack && <ThreadOverflowMenu onChannelInfo={() => setChannelInfoOpen(true)} />}
```

Consequently the `onChannelInfo?` prop on `ConversationScreenProps` (a speculative #276 seam that assumed
the sheet would live *above* `ConversationScreen`) is **retired** — remove it from the interface
(`:48-62`) and the destructure (`:64-68`). Verified no caller passes it: neither `PairedShell`'s thread
case, nor `App.tsx`, nor any test references it (`ThreadOverflowMenuView` is tested via injected props, not
through `ConversationScreen`).

**Why not thread it through `PairedShell` (AC2's literal wording):** the sheet's trigger (overflow menu),
data (`activeConversationStore`, already read here), and chrome (an absolute overlay positioned inside
`.conversation`) are **all** `ConversationScreen`-local, exactly like `StatusSheet` — whose `sheetOpen` is
likewise *not* threaded through `PairedShell`. Putting the boolean in `PairedShell` would split one sheet's
control across two files and add two carrier props for zero behavioral gain, contradicting the very
`sheetOpen` precedent AC2 names. AC2's **substance** — the seam is no longer a no-op, and open-state is a
screen-local `useState` (never the session store) — is met more faithfully this way. `PairedShell` needs
no change. (If code-review prefers the literal `PairedShell`-passes wiring, the fallback is: state +
`onCloseChannelInfo` in `PairedShell`, two new optional props on `ConversationScreen`/`PairedShellView` —
strictly more plumbing; not recommended.)

### Components (all in `ConversationScreen.tsx`)

**`ChannelInfoSheetView`** — exported pure view (props → markup, no store, no effects, no `window.pyry`),
server-render-tested with injected props. Contract:

```
export function ChannelInfoSheetView(props: {
  conversation: ConversationCreatedPayload | null
  now?: number            // defaulted to Date.now() (the Timeline precedent), so bare renders stay green
  onClose: () => void
}): JSX.Element
```

Renders (reusing the `.status-sheet__*` chrome classes verbatim, with a distinct title id
`CHANNEL_INFO_SHEET_TITLE_ID = 'channel-info-sheet-title'`):
- `.status-sheet-overlay` → `.status-sheet-overlay__scrim` (`onClick={onClose}`, `aria-hidden`) →
  `.status-sheet` (`role="dialog"`, `aria-modal="true"`, `aria-labelledby={titleId}`).
- `.status-sheet__handle`.
- `.status-sheet__header`: title `<p id={titleId} className="status-sheet__title">` + the same close
  `<button className="status-sheet__close" aria-label="Close" onClick={onClose}>` + × SVG as `StatusSheet`.
- `.status-sheet__body`: the About section, Actions section, and Channel ID footer (below).

**Title text:** `conversation.name` when present; `UNNAMED_CONVERSATION_LABEL` when `name === null`;
`CHANNEL_INFO_FALLBACK_TITLE` when `conversation === null`.

**About section** (`.status-sheet__section-header` header reading `CHANNEL_INFO_ABOUT_HEADER`):
- `conversation !== null`: two `.channel-info__row` rows —
  - **Workspace** — `.channel-info__row-label` `CHANNEL_INFO_WORKSPACE_LABEL` + `.channel-info__row-value--mono`
    holding `conversation.cwd` (opaque, auto-escaped; never path-resolved — the `WorkspaceChip` posture).
  - **Last activity** — label `CHANNEL_INFO_LAST_ACTIVITY_LABEL` + `.channel-info__row-value` holding
    `formatLastActivity(conversation.last_used_at, now)`. If that returns `''` (shouldn't — `last_used_at`
    is always present), render an em-dash `—` so the row never looks broken.
- `conversation === null`: one `.channel-info__empty` line reading `CHANNEL_INFO_EMPTY_COPY` (no rows).

**Deferred rows (do NOT build):** Created, Total sessions, Total messages — no desktop wire field exists
(`ConversationCreatedPayload` carries none); not invented. This is expected divergence from Figma 20-48.

**Actions section** — `.status-sheet__section-header` reading `CHANNEL_INFO_ACTIONS_HEADER`, followed by an
**empty** `<div className="channel-info__actions" />`. This is the mount point #366/#367/#368 fill. No
buttons, no `window.pyry`, no wire (AC5/AC6).

**Channel ID footer** — `conversation !== null` only: `<p className="channel-info__footer">` reading
`CHANNEL_ID_PREFIX + conversation.id` (mono, auto-escaped). Omitted when `conversation === null` (no id).

**`ChannelInfoSheet`** — thin in-file container (not exported), the `ThreadOverflowMenu` idiom minus its own
state: it owns **only** an Escape effect and renders the pure view.

```
function ChannelInfoSheet(props: {
  conversation: ConversationCreatedPayload | null
  now: number
  onClose: () => void
}): JSX.Element
```

- `useEffect` attaches a `document` `keydown` listener (`event.key === 'Escape' → onClose()`), torn down on
  unmount. Because the element only mounts while open (gated in `ConversationScreen`), the listener attaches
  on open and detaches on close — no `open` flag needed. Index the DOM event map
  (`DocumentEventMap['keydown']`), **not** a bare `KeyboardEvent` annotation (this file's top import shadows
  the DOM type — same note as `ThreadOverflowMenu`:1178-1179).
- Renders `<ChannelInfoSheetView conversation={props.conversation} now={props.now} onClose={props.onClose} />`.

**`ConversationScreen`** — add `const [channelInfoOpen, setChannelInfoOpen] = useState(false)` beside
`sheetOpen`; rewire the overflow mount (above); render the sheet as a sibling of the `{sheetOpen && …}`
block, reusing the existing `now` (line 100) and `activeConversation` (line 91):

```
{channelInfoOpen && (
  <ChannelInfoSheet
    conversation={activeConversation}
    now={now}
    onClose={() => setChannelInfoOpen(false)}
  />
)}
```

### Copy constants (module-level, client-owned, apostrophe-free)

`renderToStaticMarkup` escapes `'` → `&#x27;`, so every literal must be apostrophe-free (the standing
desktop lesson). Following the `EMPTY_THREAD_COPY` / `WORKSPACE_CHIP_LABEL` idiom:

- `CHANNEL_INFO_FALLBACK_TITLE = 'Channel info'`
- `UNNAMED_CONVERSATION_LABEL = 'Unnamed conversation'`
- `CHANNEL_INFO_ABOUT_HEADER = 'About'`
- `CHANNEL_INFO_ACTIONS_HEADER = 'Actions'`
- `CHANNEL_INFO_WORKSPACE_LABEL = 'Workspace'`
- `CHANNEL_INFO_LAST_ACTIVITY_LABEL = 'Last activity'`
- `CHANNEL_INFO_EMPTY_COPY = 'No conversation details yet'`
- `CHANNEL_ID_PREFIX = 'Channel ID: '`
- `CHANNEL_INFO_SHEET_TITLE_ID = 'channel-info-sheet-title'` (distinct from `STATUS_SHEET_TITLE_ID`)

### CSS (`conversation.css`) — reuse chrome, add content classes

**Reuse** all `.status-sheet__*` chrome classes + `.status-sheet__section-header` (generic, token-based
bottom-sheet chrome). The ticket sanctions this ("clone … its `.status-sheet__*` CSS, already in
conversation.css"). Add only content classes (all token-based — no color/size literals):

- `.channel-info__row` — `display:flex; justify-content:space-between; align-items:center; gap:var(--space-4);
  padding:var(--space-2) var(--space-4);` (Figma px-16 py-8).
- `.channel-info__row-label` — body-large, `--color-on-surface`.
- `.channel-info__row-value` — body-medium, `--color-on-surface-variant`; `min-width:0; text-align:right`.
- `.channel-info__row-value--mono` — as `.channel-info__row-value` but `font-family:var(--font-mono)` +
  body-small, with `overflow:hidden; text-overflow:ellipsis; white-space:nowrap` (the `…-chip-cwd`
  treatment) so a long `cwd` truncates instead of overflowing.
- `.channel-info__actions` — `display:flex; flex-direction:column; gap:var(--space-2);
  padding:var(--space-1) var(--space-4) 0;` (Figma 20:87 — the empty slot; the `.log-data` shape).
- `.channel-info__empty` — body-medium, `--color-on-surface-variant`, `padding:var(--space-2) var(--space-4)`.
- `.channel-info__footer` — `font-family:var(--font-mono)` + body-small, `--color-on-surface-variant`,
  `opacity:0.55` (opacity, not a color literal — the scrim/handle idiom), `padding:var(--space-6) var(--space-6) 0`.

## State + concurrency model

- One new screen-local `useState` (`channelInfoOpen`) in `ConversationScreen`; resets to closed on remount
  for free (ADR 0006). No store touched — `activeConversationStore` is read (existing selector), never
  written. Unidirectional preserved.
- The Escape listener is the only effect: a `document` `keydown` subscription scoped to the sheet's mount
  lifetime (attach on mount, remove on unmount via cleanup). No timers, no async, no `AbortController`
  needed. No `window.pyry` anywhere in the sheet (pure view + a document-only effect).

## Error handling

- `conversation === null` (list-opened thread): graceful — chrome + About placeholder + empty Actions slot;
  Channel ID footer omitted. No crash (AC4).
- `name === null` (unnamed scratch): title falls back to `UNNAMED_CONVERSATION_LABEL`.
- `formatLastActivity` returning `''` (defensive; `last_used_at` is always present): em-dash placeholder.
- Untrusted daemon strings `name` / `cwd` / `id` render as **auto-escaped React children** — never
  `dangerouslySetInnerHTML`, never path/markup interpretation. Same posture as `WorkspaceChip.cwd`,
  `toolCall`, and `sessionBoundary` already in this file. These strings are already rendered elsewhere in
  the renderer, so no new trust boundary → not security-sensitive.

## Testing strategy

**Suite constraint (load-bearing): no jsdom / Testing Library — `renderToStaticMarkup` only.** So pure
views are server-render-tested with injected props; interactive effects (the Escape document-listener; the
overflow-select → `setChannelInfoOpen(true)` wiring) are **not** unit-testable here — exactly as
`ThreadOverflowMenu`'s Escape/outside-click effect and `StatusSheet`'s open-on-`StatusRow`-click wiring are
untested (only their pure views are). Do **not** add interaction tests the suite cannot run, and do not
overstate coverage. The wiring is guarded by `npm run typecheck` + the build, not a test.

Add to `ConversationScreen.test.tsx`, mirroring the `ThreadOverflowMenuView` block — export
`ChannelInfoSheetView`, server-render it, assert on the markup (bullet scenarios; developer writes the
assertions in the suite idiom):

- **Chrome present:** renders `role="dialog"`, `aria-modal`, `aria-labelledby` matching the title id, the
  handle, and the `aria-label="Close"` control.
- **Populated header + About:** given a conversation, title shows `name`; a Workspace row shows `cwd`; a
  Last-activity row shows the formatted time (inject a fixed `now` = `last_used_at + 2h` → asserts `2h ago`
  deterministically); the Channel ID footer shows `CHANNEL_ID_PREFIX + id`.
- **Unnamed:** `name === null` → title shows `Unnamed conversation` (not empty, no crash).
- **Null conversation:** `conversation === null` → renders chrome + `CHANNEL_INFO_EMPTY_COPY` + the Actions
  header + empty actions slot; **no** Workspace/Last-activity rows; **no** Channel ID footer; no throw.
- **Empty Actions slot:** markup contains the Actions header but none of `Rename` / `Archive` / `Delete` /
  `Change workspace` (proves no action buttons this ticket).
- **Untrusted-string escape:** a conversation with `name`/`cwd` containing `<b>`, `&`, `'` renders escaped
  (`&lt;b&gt;`, `&#x27;`) — the daemon-string sink is inert (the existing escape-assertion idiom).
- **Deferred rows absent:** markup contains none of `Created` / `Total sessions` / `Total messages` /
  `Memory` (confirms the deferred Figma content was not invented).

## Open questions

- **Two sheets open at once:** `sheetOpen` (run-config) and `channelInfoOpen` are independent booleans, so
  in principle both overlays could stack. Not reachable through normal use (separate triggers, one at a
  time) and no AC requires mutual exclusion — left as-is for this shell; a future consolidation (or a
  shared `<BottomSheet>` extraction, if a third sheet appears) could enforce it. Evidence-based deferral.
- **`.status-sheet__*` reuse vs. rename:** reusing run-config-named chrome for a second sheet is a mild
  semantic coupling. The ticket sanctions the reuse and it avoids ~100 lines of duplicated chrome CSS; a
  rename to a generic `.bottom-sheet` is a separate refactor, out of scope.
